import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 30;

/**
 * 勘定科目のマージ
 *
 * body: { keepId, mergeId }
 * 処理:
 *   1. keep / merge 両方を SELECT
 *   2. journal_entries の debit_account=merge.name → keep.name に置換
 *   3. journal_entries の credit_account=merge.name → keep.name に置換
 *   4. merge レコードを DELETE
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
      .from('accounts')
      .select('id, name, user_id, client_id')
      .in('id', [keepId, mergeId])
      .eq('user_id', user.id);

    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!rows || rows.length !== 2) {
      return NextResponse.json({ error: '対象の科目が見つかりません' }, { status: 404 });
    }

    const keep = rows.find((r) => r.id === keepId);
    const merge = rows.find((r) => r.id === mergeId);
    if (!keep || !merge) {
      return NextResponse.json({ error: '対象の科目が見つかりません' }, { status: 404 });
    }

    // journal_entries の科目名を keep.name に統一
    let updatedDebit = 0;
    let updatedCredit = 0;
    if (keep.name !== merge.name) {
      const { data: dRows } = await service
        .from('journal_entries')
        .update({ debit_account: keep.name })
        .eq('user_id', user.id)
        .eq('debit_account', merge.name)
        .select('id');
      updatedDebit = dRows?.length ?? 0;

      const { data: cRows } = await service
        .from('journal_entries')
        .update({ credit_account: keep.name })
        .eq('user_id', user.id)
        .eq('credit_account', merge.name)
        .select('id');
      updatedCredit = cRows?.length ?? 0;
    }

    // merge を削除
    const { error: delErr } = await service
      .from('accounts')
      .delete()
      .eq('id', mergeId)
      .eq('user_id', user.id);

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    return NextResponse.json({
      success: true,
      kept: { id: keep.id, name: keep.name },
      merged: { id: merge.id, name: merge.name },
      updatedDebit,
      updatedCredit,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'マージに失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
