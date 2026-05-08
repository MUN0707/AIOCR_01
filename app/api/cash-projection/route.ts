import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 30;

// 現金・預金系の科目を判定（名前ベース）
function isCashAccount(name: string): boolean {
  return /現金|普通預金|当座預金|定期預金|外貨預金|小口現金/.test(name);
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');
  const year = Number(searchParams.get('year') ?? new Date().getFullYear());

  const service = createServiceClient();

  // 科目カテゴリマップ
  const { data: accountsRaw } = await service
    .from('accounts')
    .select('name, category, sub_category')
    .eq('user_id', user.id);

  const categoryMap = new Map<string, string>();
  const subCategoryMap = new Map<string, string>();
  for (const a of accountsRaw ?? []) {
    categoryMap.set(a.name, a.category ?? '');
    subCategoryMap.set(a.name, a.sub_category ?? '');
  }

  // 仕訳取得（当年 + 期首残高計算のため前年まで）
  const periodStart = `${year}0101`;
  const periodEnd = `${year}1231`;

  let jeQuery = service
    .from('journal_entries')
    .select('entry_date, debit_account, credit_account, debit_amount, credit_amount, amount')
    .eq('user_id', user.id)
    .lte('entry_date', periodEnd);
  if (clientId) jeQuery = jeQuery.eq('client_id', clientId);
  const { data: allEntries, error: jeError } = await jeQuery;
  if (jeError) return NextResponse.json({ error: jeError.message }, { status: 500 });

  // 現金科目一覧（動的に仕訳に登場した科目から検出）
  const cashAccountSet = new Set<string>();
  for (const e of allEntries ?? []) {
    if (e.debit_account && isCashAccount(e.debit_account)) cashAccountSet.add(e.debit_account);
    if (e.credit_account && isCashAccount(e.credit_account)) cashAccountSet.add(e.credit_account);
  }
  // 科目マスタからも追加
  for (const a of accountsRaw ?? []) {
    if (isCashAccount(a.name)) cashAccountSet.add(a.name);
  }

  // 期首残高（年初より前のエントリで現金科目の累計）
  let openingBalance = 0;
  for (const e of allEntries ?? []) {
    if (e.entry_date >= periodStart) continue;
    const debitAmt = Number(e.debit_amount ?? e.amount ?? 0);
    const creditAmt = Number(e.credit_amount ?? e.amount ?? 0);
    if (e.debit_account && cashAccountSet.has(e.debit_account)) openingBalance += debitAmt;
    if (e.credit_account && cashAccountSet.has(e.credit_account)) openingBalance -= creditAmt;
  }

  // 月別 inflow/outflow 集計
  // inflow[month][counterAccount] = amount (borrowing to cash = cash in)
  // outflow[month][counterAccount] = amount (lending from cash = cash out)
  type BreakdownMap = Map<string, number>;
  const inflowByMonth: Map<number, BreakdownMap> = new Map();
  const outflowByMonth: Map<number, BreakdownMap> = new Map();

  for (let m = 1; m <= 12; m++) {
    inflowByMonth.set(m, new Map());
    outflowByMonth.set(m, new Map());
  }

  for (const e of allEntries ?? []) {
    if (e.entry_date < periodStart || e.entry_date > periodEnd) continue;
    const month = parseInt((e.entry_date as string).slice(4, 6), 10);
    if (!month) continue;

    const debitAmt = Number(e.debit_amount ?? e.amount ?? 0);
    const creditAmt = Number(e.credit_amount ?? e.amount ?? 0);

    // 現金科目が借方 → 収入（現金増加）
    if (e.debit_account && cashAccountSet.has(e.debit_account)) {
      const counterAccount = e.credit_account ?? '不明';
      const m2 = inflowByMonth.get(month)!;
      m2.set(counterAccount, (m2.get(counterAccount) ?? 0) + debitAmt);
    }
    // 現金科目が貸方 → 支出（現金減少）
    if (e.credit_account && cashAccountSet.has(e.credit_account)) {
      const counterAccount = e.debit_account ?? '不明';
      const m2 = outflowByMonth.get(month)!;
      m2.set(counterAccount, (m2.get(counterAccount) ?? 0) + creditAmt);
    }
  }

  // 月別サマリ構築
  let runningBalance = openingBalance;
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const inflowMap = inflowByMonth.get(m)!;
    const outflowMap = outflowByMonth.get(m)!;

    const totalInflow = [...inflowMap.values()].reduce((s, v) => s + v, 0);
    const totalOutflow = [...outflowMap.values()].reduce((s, v) => s + v, 0);

    const openBal = runningBalance;
    runningBalance = runningBalance + totalInflow - totalOutflow;

    months.push({
      month: m,
      openingBalance: Math.round(openBal),
      totalInflow: Math.round(totalInflow),
      totalOutflow: Math.round(totalOutflow),
      closingBalance: Math.round(runningBalance),
      inflowBreakdown: [...inflowMap.entries()]
        .filter(([, v]) => v !== 0)
        .sort((a, b) => b[1] - a[1])
        .map(([account, amount]) => ({
          account,
          amount: Math.round(amount),
          category: categoryMap.get(account) ?? '',
        })),
      outflowBreakdown: [...outflowMap.entries()]
        .filter(([, v]) => v !== 0)
        .sort((a, b) => b[1] - a[1])
        .map(([account, amount]) => ({
          account,
          amount: Math.round(amount),
          category: categoryMap.get(account) ?? '',
        })),
    });
  }

  return NextResponse.json({
    year,
    openingBalance: Math.round(openingBalance),
    cashAccounts: [...cashAccountSet].sort(),
    months,
  });
}
