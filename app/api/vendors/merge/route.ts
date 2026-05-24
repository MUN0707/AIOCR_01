import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 30;

/**
 * 取引先のマージ
 *
 * body: { keepId, mergeId }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const { keepId, mergeId } = await request.json();
    if (!keepId || !mergeId) {
      return NextResponse.json({ error: 'keepId と mergeId が必要です' }, { status: 400 });
    }
    if (keepId === mergeId) {
      return NextResponse.json({ error: '同じレコードはマージできません' }, { status: 400 });
    }

    const service = createServiceClient();
    const { data: rows, error: fetchErr } = await service
      .from('vendors')
      .select('id, name, user_id, client_id')
      .in('id', [keepId, mergeId]);

    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!rows || rows.length !== 2) {
      return NextResponse.json({ error: '対象の取引先が見つかりません' }, { status: 404 });
    }

    const keep = rows.find((r) => r.id === keepId);
    const merge = rows.find((r) => r.id === mergeId);
    if (!keep || !merge) {
      return NextResponse.json({ error: '対象の取引先が見つかりません' }, { status: 404 });
    }

    if (keep.user_id !== merge.user_id) {
      return NextResponse.json({ error: '所有者が異なる取引先はマージできません' }, { status: 400 });
    }
    if ((keep.client_id ?? null) !== (merge.client_id ?? null)) {
      return NextResponse.json({ error: '所属会社が異なる取引先はマージできません' }, { status: 400 });
    }

    let ownerUserId = user.id;
    if (keep.client_id) {
      const scope = await resolveClientScope(service, user.id, keep.client_id);
      if (!scope || !canWrite(scope.role)) {
        return NextResponse.json({ error: 'この会社の書き込み権限がありません' }, { status: 403 });
      }
      ownerUserId = scope.ownerUserId;
    } else {
      if (keep.user_id !== user.id) {
        return NextResponse.json({ error: '対象の取引先が見つかりません' }, { status: 404 });
      }
    }

    // vendor_id で参照されている仕訳をマージ先に張り替え
    const { data: byIdUpdated } = await service
      .from('journal_entries')
      .update({ vendor_id: keep.id, vendor_name: keep.name })
      .eq('user_id', ownerUserId)
      .eq('vendor_id', merge.id)
      .select('id');

    let byNameUpdated: { id: string }[] | null = null;
    if (keep.name !== merge.name) {
      const { data } = await service
        .from('journal_entries')
        .update({ vendor_name: keep.name, vendor_id: keep.id })
        .eq('user_id', ownerUserId)
        .is('vendor_id', null)
        .eq('vendor_name', merge.name)
        .select('id');
      byNameUpdated = data ?? null;
    }
    const updated = (byIdUpdated?.length ?? 0) + (byNameUpdated?.length ?? 0);

    const { error: delErr } = await service
      .from('vendors')
      .delete()
      .eq('id', mergeId)
      .eq('user_id', ownerUserId);

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    return NextResponse.json({
      success: true,
      kept: { id: keep.id, name: keep.name },
      merged: { id: merge.id, name: merge.name },
      updated,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'マージに失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
