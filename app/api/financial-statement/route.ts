import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 30;

/**
 * 期間指定で journal_entries を集計し P/L・B/S を返す。
 *
 * P/L: 期間内(start_date〜end_date)の収益・費用を中区分別に集計
 * B/S: 期首以前(〜end_date)の累計残高を中区分別に集計（純資産の繰越利益剰余金は当期純利益を加算）
 */

type AccountRow = {
  id: string;
  name: string;
  category: string | null;
  sub_category: string | null;
};

type Breakdown = { name: string; amount: number };
type Group = { sub_category: string; total: number; items: Breakdown[] };

const PL_REVENUE_SUBS = ['売上高', '営業外収益', '特別利益'];
const PL_EXPENSE_SUBS = ['売上原価', '販管費', '営業外費用', '特別損失'];
const BS_ASSET_SUBS = ['流動資産', '固定資産', '繰延資産'];
const BS_LIABILITY_SUBS = ['流動負債', '固定負債'];
const BS_EQUITY_SUBS = ['純資産'];

function isRevenueSub(sub: string | null) {
  return sub ? PL_REVENUE_SUBS.includes(sub) : false;
}
function isExpenseSub(sub: string | null) {
  return sub ? PL_EXPENSE_SUBS.includes(sub) : false;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const start = params.get('start');
  const end = params.get('end');
  const clientId = params.get('clientId');

  if (!start || !end) return NextResponse.json({ error: 'start/end が必要です' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ error: '日付形式が不正です' }, { status: 400 });
  }

  const service = createServiceClient();

  // 勘定科目マスタ
  const { data: accounts, error: accErr } = await service
    .from('accounts')
    .select('id, name, category, sub_category')
    .eq('user_id', user.id);
  if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 });

  const accountMap = new Map<string, AccountRow>();
  for (const a of accounts ?? []) accountMap.set(a.name, a as AccountRow);

  // 仕訳（B/S 用に end_date 以前の全エントリを取得）
  // entry_date は 'YYYYMMDD' 形式で保存されている想定（既存コードより）
  const startCompact = start.replace(/-/g, '');
  const endCompact = end.replace(/-/g, '');

  let query = service
    .from('journal_entries')
    .select('debit_account, credit_account, amount, entry_date')
    .eq('user_id', user.id)
    .lte('entry_date', endCompact);

  if (clientId) query = query.eq('client_id', clientId);

  const { data: entries, error: entErr } = await query;
  if (entErr) return NextResponse.json({ error: entErr.message }, { status: 500 });

  // 科目別の期間内(借方/貸方)、累計(借方/貸方)
  type Buckets = { periodDebit: number; periodCredit: number; cumDebit: number; cumCredit: number };
  const buckets = new Map<string, Buckets>();
  const ensure = (name: string): Buckets => {
    let b = buckets.get(name);
    if (!b) { b = { periodDebit: 0, periodCredit: 0, cumDebit: 0, cumCredit: 0 }; buckets.set(name, b); }
    return b;
  };

  for (const e of entries ?? []) {
    const amount = Number(e.amount ?? 0);
    if (!amount) continue;
    const ed = String(e.entry_date ?? '');
    const inPeriod = ed >= startCompact && ed <= endCompact;
    if (e.debit_account) {
      const b = ensure(e.debit_account);
      b.cumDebit += amount;
      if (inPeriod) b.periodDebit += amount;
    }
    if (e.credit_account) {
      const b = ensure(e.credit_account);
      b.cumCredit += amount;
      if (inPeriod) b.periodCredit += amount;
    }
  }

  // P/L 集計
  const plGroups: Record<string, Group> = {};
  const bsGroups: Record<string, Group> = {};

  for (const [name, b] of buckets) {
    const acc = accountMap.get(name);
    const sub = acc?.sub_category ?? null;
    if (!sub) continue;

    if (isRevenueSub(sub)) {
      const amount = b.periodCredit - b.periodDebit;
      if (!plGroups[sub]) plGroups[sub] = { sub_category: sub, total: 0, items: [] };
      plGroups[sub].items.push({ name, amount });
      plGroups[sub].total += amount;
    } else if (isExpenseSub(sub)) {
      const amount = b.periodDebit - b.periodCredit;
      if (!plGroups[sub]) plGroups[sub] = { sub_category: sub, total: 0, items: [] };
      plGroups[sub].items.push({ name, amount });
      plGroups[sub].total += amount;
    } else if (BS_ASSET_SUBS.includes(sub)) {
      const amount = b.cumDebit - b.cumCredit;
      if (!bsGroups[sub]) bsGroups[sub] = { sub_category: sub, total: 0, items: [] };
      bsGroups[sub].items.push({ name, amount });
      bsGroups[sub].total += amount;
    } else if (BS_LIABILITY_SUBS.includes(sub) || BS_EQUITY_SUBS.includes(sub)) {
      const amount = b.cumCredit - b.cumDebit;
      if (!bsGroups[sub]) bsGroups[sub] = { sub_category: sub, total: 0, items: [] };
      bsGroups[sub].items.push({ name, amount });
      bsGroups[sub].total += amount;
    }
  }

  // P/L 小計
  const salesTotal = plGroups['売上高']?.total ?? 0;
  const cogsTotal = plGroups['売上原価']?.total ?? 0;
  const sgaTotal = plGroups['販管費']?.total ?? 0;
  const grossProfit = salesTotal - cogsTotal;
  const operatingProfit = grossProfit - sgaTotal;
  const nonOpIncome = plGroups['営業外収益']?.total ?? 0;
  const nonOpExpense = plGroups['営業外費用']?.total ?? 0;
  const ordinaryProfit = operatingProfit + nonOpIncome - nonOpExpense;
  const extraIncome = plGroups['特別利益']?.total ?? 0;
  const extraLoss = plGroups['特別損失']?.total ?? 0;
  const netIncomeBeforeTax = ordinaryProfit + extraIncome - extraLoss;
  // 法人税等は現状未計算 → netIncome = netIncomeBeforeTax
  const netIncome = netIncomeBeforeTax;

  // B/S 当期純利益を純資産に加算（繰越利益剰余金として別枠表示）
  if (!bsGroups['純資産']) bsGroups['純資産'] = { sub_category: '純資産', total: 0, items: [] };
  bsGroups['純資産'].items.push({ name: '当期純利益', amount: netIncome });
  bsGroups['純資産'].total += netIncome;

  const assetsTotal = BS_ASSET_SUBS.reduce((s, k) => s + (bsGroups[k]?.total ?? 0), 0);
  const liabilitiesTotal = BS_LIABILITY_SUBS.reduce((s, k) => s + (bsGroups[k]?.total ?? 0), 0);
  const equityTotal = BS_EQUITY_SUBS.reduce((s, k) => s + (bsGroups[k]?.total ?? 0), 0);

  // 空グループは order を保って整列
  const orderedPl = [...PL_REVENUE_SUBS, ...PL_EXPENSE_SUBS]
    .map((k) => plGroups[k])
    .filter(Boolean);
  const orderedBs = [...BS_ASSET_SUBS, ...BS_LIABILITY_SUBS, ...BS_EQUITY_SUBS]
    .map((k) => bsGroups[k])
    .filter(Boolean);

  // 各グループ内を金額降順
  for (const g of orderedPl) g.items.sort((a, b) => b.amount - a.amount);
  for (const g of orderedBs) g.items.sort((a, b) => b.amount - a.amount);

  // 未分類（sub_category 未設定だが使われている科目）
  const unclassified: Breakdown[] = [];
  for (const [name, b] of buckets) {
    const acc = accountMap.get(name);
    if (!acc?.sub_category) {
      const net = (b.periodDebit - b.periodCredit) + (b.cumDebit - b.cumCredit);
      if (net !== 0 || b.cumDebit !== 0 || b.cumCredit !== 0) {
        unclassified.push({ name, amount: b.cumDebit - b.cumCredit });
      }
    }
  }

  return NextResponse.json({
    period: { start, end },
    pl: {
      groups: orderedPl,
      salesTotal,
      cogsTotal,
      grossProfit,
      sgaTotal,
      operatingProfit,
      nonOpIncome,
      nonOpExpense,
      ordinaryProfit,
      extraIncome,
      extraLoss,
      netIncomeBeforeTax,
      netIncome,
    },
    bs: {
      groups: orderedBs,
      assetsTotal,
      liabilitiesTotal,
      equityTotal,
      liabilitiesAndEquityTotal: liabilitiesTotal + equityTotal,
    },
    unclassified,
  });
}
