import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, listAccessibleClientIds, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const callingUserId = user.id;

  const body = await request.json();
  const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'IDが空です' }, { status: 400 });
  }
  if (ids.length > 500) {
    return NextResponse.json({ error: '一度に削除できるのは500件までです' }, { status: 400 });
  }

  const service = createServiceClient();

  // 対象エントリを取得（id のみで、所有判定は client_id 経由で後段）
  const { data: targets, error: fetchError } = await service
    .from('journal_entries')
    .select('id, user_id, client_id, entry_date')
    .in('id', ids);

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!targets || targets.length === 0) {
    return NextResponse.json({ error: '削除対象が見つかりません' }, { status: 404 });
  }

  // 個人スコープ (client_id null) は自身の user_id 一致のみ可
  // client スコープは canWrite で判定。アクセス可能 client の owner を解決。
  const accessibleClients = await listAccessibleClientIds(service, callingUserId);
  const accessibleSet = new Set(accessibleClients);
  // client_id -> ownerUserId / role キャッシュ
  const scopeCache = new Map<string, { ownerUserId: string; writable: boolean }>();
  async function resolveCached(clientId: string) {
    let v = scopeCache.get(clientId);
    if (v) return v;
    const scope = await resolveClientScope(service, callingUserId, clientId);
    v = scope
      ? { ownerUserId: scope.ownerUserId, writable: canWrite(scope.role) }
      : { ownerUserId: '', writable: false };
    scopeCache.set(clientId, v);
    return v;
  }

  // 締め日マップ取得（user_id ごとに 1 回ずつ取得しキャッシュ）
  const closingsByOwner = new Map<string, Map<string | null, string>>();
  async function getClosedUntil(ownerUserId: string, clientId: string | null): Promise<string | undefined> {
    let m = closingsByOwner.get(ownerUserId);
    if (!m) {
      m = new Map<string | null, string>();
      const { data: rows } = await service
        .from('journal_closings')
        .select('client_id, closed_until')
        .eq('user_id', ownerUserId);
      for (const c of rows ?? []) m.set(c.client_id ?? null, c.closed_until);
      closingsByOwner.set(ownerUserId, m);
    }
    return m.get(clientId);
  }

  // 権限 + ロック判定で振り分け
  // 同一 owner_user_id ごとに delete 文を発行する必要があるので、owner ごとに id をまとめる
  const allowedByOwner = new Map<string, string[]>();
  const blockedIds: string[] = [];
  let denied = 0;

  for (const t of targets) {
    let ownerUserId: string;
    if (t.client_id) {
      if (!accessibleSet.has(t.client_id)) {
        denied += 1;
        continue;
      }
      const s = await resolveCached(t.client_id);
      if (!s.writable) {
        denied += 1;
        continue;
      }
      ownerUserId = s.ownerUserId;
    } else {
      if (t.user_id !== callingUserId) {
        denied += 1;
        continue;
      }
      ownerUserId = callingUserId;
    }

    const closedUntil = await getClosedUntil(ownerUserId, t.client_id ?? null);
    if (closedUntil && t.entry_date !== '不明' && t.entry_date <= closedUntil) {
      blockedIds.push(t.id);
    } else {
      const arr = allowedByOwner.get(ownerUserId) ?? [];
      arr.push(t.id);
      allowedByOwner.set(ownerUserId, arr);
    }
  }

  const allowedTotal = Array.from(allowedByOwner.values()).reduce((sum, a) => sum + a.length, 0);
  if (allowedTotal === 0) {
    if (denied > 0 && blockedIds.length === 0) {
      return NextResponse.json({ error: '削除権限がありません' }, { status: 403 });
    }
    return NextResponse.json({ error: 'すべて締め済みのため削除できません' }, { status: 403 });
  }

  let deletedTotal = 0;
  for (const [ownerUserId, ids] of allowedByOwner) {
    const { error: deleteError } = await service
      .from('journal_entries')
      .delete()
      .in('id', ids)
      .eq('user_id', ownerUserId);
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
    deletedTotal += ids.length;
  }

  return NextResponse.json({
    success: true,
    deleted: deletedTotal,
    skipped: blockedIds.length,
    denied,
  });
}
