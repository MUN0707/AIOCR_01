import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 20;

/**
 * 仕訳の所属法人(client_id)を voucher_group 単位で一括移し替える（C6 / error_report 70cfd088）。
 * 「間違えた法人を選択して登録した」仕訳を正しい法人へ救済移動する。
 *
 * body:
 *   ids: string[]                     // 日記帳で選択した行 id（群は RPC 側で全展開）
 *   toClientId: string | null         // 移動先 client（null = 個人）
 *   expectedClientId?: string | null  // 表示中の顧問先（取り違え防止）。'' は省略扱い
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const callingUserId = user.id;

  const body = await request.json();
  const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
  const toClientId: string | null = body.toClientId ?? null;
  const expectedClientId: string | null | undefined =
    body.expectedClientId === undefined ? undefined : (body.expectedClientId ?? null);

  if (ids.length === 0) return NextResponse.json({ error: '対象の仕訳が選択されていません' }, { status: 400 });
  if (ids.length > 500) return NextResponse.json({ error: '一度に移せるのは500件までです' }, { status: 400 });

  const service = createServiceClient();

  // 対象を取得して所属の一貫性を確認
  const { data: targets, error: fetchError } = await service
    .from('journal_entries')
    .select('id, user_id, client_id')
    .in('id', ids);
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!targets || targets.length === 0) {
    return NextResponse.json({ error: '移動対象が見つかりません' }, { status: 404 });
  }

  const distinctClientIds = new Set<string | null>(targets.map((t) => t.client_id ?? null));
  if (distinctClientIds.size > 1) {
    const clientList = Array.from(distinctClientIds).map((c) => c ?? '(個人)').join(' / ');
    return NextResponse.json(
      { error: '異なる顧問先の仕訳が混在しているため一括で移せません', detail: `混在 scope: ${clientList}` },
      { status: 400 },
    );
  }
  const fromClientId: string | null = Array.from(distinctClientIds)[0] ?? null;

  if (expectedClientId !== undefined && fromClientId !== expectedClientId) {
    return NextResponse.json(
      {
        error: '移動対象の顧問先が現在表示中の顧問先と異なります',
        detail: `expected=${expectedClientId ?? '(個人)'} actual=${fromClientId ?? '(個人)'}`,
      },
      { status: 400 },
    );
  }
  if ((fromClientId ?? null) === (toClientId ?? null)) {
    return NextResponse.json({ error: '移動元と移動先の法人が同じです' }, { status: 400 });
  }

  // 権限解決: source / target 双方への書込権 + 同一 owner であることを要求
  async function resolveOwner(clientId: string | null): Promise<string | null> {
    if (!clientId) {
      // 個人スコープ: 対象がすべて呼び出しユーザー本人のものであること
      return callingUserId;
    }
    const scope = await resolveClientScope(service, callingUserId, clientId);
    if (!scope || !canWrite(scope.role)) return null;
    return scope.ownerUserId;
  }

  const fromOwner = await resolveOwner(fromClientId);
  const toOwner = await resolveOwner(toClientId);
  if (!fromOwner || !toOwner) {
    return NextResponse.json({ error: '移動元または移動先への書き込み権限がありません' }, { status: 403 });
  }
  if (fromOwner !== toOwner) {
    return NextResponse.json({ error: '所有者の異なる法人をまたいで移動することはできません' }, { status: 403 });
  }
  // 個人スコープ source の場合、対象がすべて本人所有か追加検証
  if (!fromClientId && targets.some((t) => t.user_id !== callingUserId)) {
    return NextResponse.json({ error: '移動対象に他ユーザーの仕訳が含まれています' }, { status: 403 });
  }

  const { data: result, error: rpcError } = await service.rpc('reassign_voucher_groups', {
    p_user_id: fromOwner,
    p_entry_ids: ids,
    p_from_client: fromClientId,
    p_to_client: toClientId,
  });

  if (rpcError) {
    if (rpcError.message && rpcError.message.includes('CLOSED_PERIOD')) {
      return NextResponse.json(
        { error: '締め済み期間の仕訳が含まれているため移動できません。締めを解除してから操作してください。' },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  const r = (result ?? {}) as {
    moved_entries?: number; moved_groups?: number; moved_uploads?: number; left_uploads?: number;
  };
  return NextResponse.json({
    success: true,
    movedEntries: r.moved_entries ?? 0,
    movedGroups: r.moved_groups ?? 0,
    movedUploads: r.moved_uploads ?? 0,
    leftUploads: r.left_uploads ?? 0,
  });
}
