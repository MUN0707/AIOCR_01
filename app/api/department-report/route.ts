import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');
  const startDate = searchParams.get('startDate'); // YYYYMMDD
  const endDate = searchParams.get('endDate');

  const service = createServiceClient();

  // 部門一覧取得
  let deptQuery = service
    .from('departments')
    .select('id, name, code')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('code', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });
  if (clientId) deptQuery = deptQuery.eq('client_id', clientId);
  const { data: departments } = await deptQuery;

  // 仕訳取得（部門別集計のため department_id + 勘定科目の category で集計）
  let jeQuery = service
    .from('journal_entries')
    .select('department_id, debit_account, credit_account, debit_amount, credit_amount, amount')
    .eq('user_id', user.id);
  if (clientId) jeQuery = jeQuery.eq('client_id', clientId);
  if (startDate) jeQuery = jeQuery.gte('entry_date', startDate);
  if (endDate) jeQuery = jeQuery.lte('entry_date', endDate);
  const { data: entries, error: jeError } = await jeQuery;
  if (jeError) return NextResponse.json({ error: jeError.message }, { status: 500 });

  // 科目の category マップ取得
  let accQuery = service
    .from('accounts')
    .select('name, category')
    .eq('user_id', user.id);
  const { data: accountsRaw } = await accQuery;
  const categoryMap = new Map<string, string>();
  for (const a of accountsRaw ?? []) {
    categoryMap.set(a.name, a.category);
  }

  // 部門別 revenue / expense 集計
  const deptMap = new Map<string | null, { revenue: number; expense: number }>();
  deptMap.set(null, { revenue: 0, expense: 0 }); // 未設定部門

  for (const e of entries ?? []) {
    const did = e.department_id ?? null;
    if (!deptMap.has(did)) deptMap.set(did, { revenue: 0, expense: 0 });
    const rec = deptMap.get(did)!;

    const debitAmt = Number(e.debit_amount ?? e.amount ?? 0);
    const creditAmt = Number(e.credit_amount ?? e.amount ?? 0);
    const debitCat = categoryMap.get(e.debit_account ?? '') ?? '';
    const creditCat = categoryMap.get(e.credit_account ?? '') ?? '';

    if (debitCat === 'expense') rec.expense += debitAmt;
    if (debitCat === 'revenue') rec.revenue -= debitAmt;
    if (creditCat === 'revenue') rec.revenue += creditAmt;
    if (creditCat === 'expense') rec.expense -= creditAmt;
  }

  const rows = (departments ?? []).map((d) => {
    const totals = deptMap.get(d.id) ?? { revenue: 0, expense: 0 };
    return {
      id: d.id,
      name: d.name,
      code: d.code,
      revenue: Math.round(totals.revenue),
      expense: Math.round(totals.expense),
      profit: Math.round(totals.revenue - totals.expense),
    };
  });

  // 未設定分
  const unassigned = deptMap.get(null) ?? { revenue: 0, expense: 0 };
  rows.push({
    id: null as unknown as string,
    name: '（部門未設定）',
    code: null as unknown as string,
    revenue: Math.round(unassigned.revenue),
    expense: Math.round(unassigned.expense),
    profit: Math.round(unassigned.revenue - unassigned.expense),
  });

  return NextResponse.json({ rows });
}
