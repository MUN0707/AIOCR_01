import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 30;

/**
 * 取引先のマージ
 *
 * body: { keepId, mergeId }
 * 処理:
 *   1. journal_entries の vendor_name=merge.name → keep.name に置換
 *   2. merge レコードを DELETE
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
      .in('id', [keepId, mergeId])
      .eq('user_id', user.id);

    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!rows || rows.length !== 2) {
      return NextResponse.json({ error: '対象の取引先が見つかりません' }, { status: 404 });
    }

    const keep = rows.find((r) => r.id === keepId);
    const merge = rows.find((r) => r.id === mergeId);
    if (!keep || !merge) {
      return NextResponse.json({ error: '対象の取引先が見つかりません' }, { status: 404 });
    }

    let updated = 0;
    if (keep.name !== merge.name) {
      const { data: rowsUpdated } = await service
        .from('journal_entries')
        .update({ vendor_name: keep.name })
        .eq('user_id', user.id)
        .eq('vendor_name', merge.name)
        .select('id');
      updated = rowsUpdated?.length ?? 0;
    }

    const { error: delErr } = await service
      .from('vendors')
      .delete()
      .eq('id', mergeId)
      .eq('user_id', user.id);

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
