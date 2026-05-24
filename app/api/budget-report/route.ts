import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { resolveClientScope } from '@/lib/client-access';

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');
  const year = Number(searchParams.get('year') ?? new Date().getFullYear());

  const service = createServiceClient();

  let ownerUserId = user.id;
  if (clientId) {
    const scope = await resolveClientScope(service, user.id, clientId);
    if (!scope) return NextResponse.json({ error: 'この会社へのアクセス権限がありません' }, { status: 403 });
    ownerUserId = scope.ownerUserId;
  }

  // 予算データ取得
  let budgetQuery = service
    .from('budgets')
    .select('account_name, month, amount')
    .eq('user_id', ownerUserId)
    .eq('year', year);
  if (clientId) budgetQuery = budgetQuery.eq('client_id', clientId);
  else budgetQuery = budgetQuery.is('client_id', null);
  const { data: budgetRows } = await budgetQuery;

  // 仕訳データ取得（当年の全エントリ）
  const startDate = `${year}0101`;
  const endDate = `${year}1231`;
  let jeQuery = service
    .from('journal_entries')
    .select('entry_date, debit_account, credit_account, debit_amount, credit_amount, amount')
    .eq('user_id', ownerUserId)
    .gte('entry_date', startDate)
    .lte('entry_date', endDate);
  if (clientId) jeQuery = jeQuery.eq('client_id', clientId);
  const { data: entries, error: jeError } = await jeQuery;
  if (jeError) return NextResponse.json({ error: jeError.message }, { status: 500 });

  // 科目カテゴリ取得
  const accQuery = service.from('accounts').select('name, category').eq('user_id', ownerUserId);
  const { data: accountsRaw } = await accQuery;
  const categoryMap = new Map<string, string>();
  for (const a of accountsRaw ?? []) categoryMap.set(a.name, a.category);

  // 実績を account + month で集計
  const actual: Map<string, Map<number, number>> = new Map();

  const addActual = (account: string, month: number, delta: number) => {
    if (!account || account === '不明') return;
    if (!actual.has(account)) actual.set(account, new Map());
    const m = actual.get(account)!;
    m.set(month, (m.get(month) ?? 0) + delta);
  };

  for (const e of entries ?? []) {
    const month = parseInt((e.entry_date as string).slice(4, 6), 10);
    if (!month) continue;
    const debitAmt = Number(e.debit_amount ?? e.amount ?? 0);
    const creditAmt = Number(e.credit_amount ?? e.amount ?? 0);
    const debitCat = categoryMap.get(e.debit_account ?? '') ?? '';
    const creditCat = categoryMap.get(e.credit_account ?? '') ?? '';

    if (debitCat === 'expense') addActual(e.debit_account!, month, debitAmt);
    if (creditCat === 'expense') addActual(e.credit_account!, month, -creditAmt);
    if (creditCat === 'revenue') addActual(e.credit_account!, month, creditAmt);
    if (debitCat === 'revenue') addActual(e.debit_account!, month, -debitAmt);
  }

  // 予算も同様に集計
  const budget: Map<string, Map<number, number>> = new Map();
  for (const b of budgetRows ?? []) {
    if (!budget.has(b.account_name)) budget.set(b.account_name, new Map());
    budget.get(b.account_name)!.set(b.month, Number(b.amount));
  }

  const allAccounts = new Set([...budget.keys(), ...actual.keys()]);
  const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  const rows = [...allAccounts].sort().map((acc) => {
    const cat = categoryMap.get(acc) ?? '';
    const budgetByMonth = budget.get(acc) ?? new Map();
    const actualByMonth = actual.get(acc) ?? new Map();

    const monthly = MONTHS.map((m) => {
      const b = budgetByMonth.get(m) ?? 0;
      const a = actualByMonth.get(m) ?? 0;
      return { month: m, budget: b, actual: a, diff: a - b };
    });

    const totalBudget = monthly.reduce((s, x) => s + x.budget, 0);
    const totalActual = monthly.reduce((s, x) => s + x.actual, 0);

    return {
      account_name: acc,
      category: cat,
      monthly,
      totalBudget,
      totalActual,
      totalDiff: totalActual - totalBudget,
      achievementRate: totalBudget !== 0 ? Math.round((totalActual / totalBudget) * 100) : null,
    };
  });

  return NextResponse.json({ year, rows });
}
