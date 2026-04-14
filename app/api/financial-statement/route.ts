import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 30;

/**
 * 期間指定で journal_entries を集計し P/L・B/S・株主資本等変動計算書を返す。
 *
 * - opening_balances が指定されていれば「期首残高 + 期間内変動」で B/S を構築
 * - 指定がなければ「end_date 以前の累計」で B/S を構築（後方互換）
 * - 株主資本等変動計算書は 純資産科目ごとに 期首/変動/期末 を出力
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

const CARRY_FORWARD_NAME = '繰越利益剰余金';

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
  const periodId = params.get('periodId');
  const corporateTax = Number(params.get('corporateTax') ?? '0') || 0;

  if (!start || !end) return NextResponse.json({ error: 'start/end が必要です' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ error: '日付形式が不正です' }, { status: 400 });
  }

  const service = createServiceClient();

  // 期首残高（指定された期があれば取得）
  let openingBalances: Record<string, number> = {};
  if (periodId) {
    const { data: period } = await service
      .from('fiscal_periods')
      .select('opening_balances')
      .eq('id', periodId)
      .eq('user_id', user.id)
      .single();
    if (period?.opening_balances && typeof period.opening_balances === 'object') {
      openingBalances = period.opening_balances as Record<string, number>;
    }
  }
  const useOpening = Object.keys(openingBalances).length > 0;

  // クライアント情報（決算書ヘッダー用）
  let clientInfo: { name: string; legal_name: string | null; short_name: string | null; company_code: string | null } | null = null;
  if (clientId) {
    const { data: c } = await service
      .from('clients')
      .select('name, legal_name, short_name, company_code')
      .eq('id', clientId)
      .eq('user_id', user.id)
      .single();
    if (c) clientInfo = c;
  }

  // 勘定科目マスタ
  const { data: accounts, error: accErr } = await service
    .from('accounts')
    .select('id, name, category, sub_category')
    .eq('user_id', user.id);
  if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 });

  const accountMap = new Map<string, AccountRow>();
  for (const a of accounts ?? []) accountMap.set(a.name, a as AccountRow);

  // 仕訳取得（B/S 用に end_date 以前の全エントリ）
  const startCompact = start.replace(/-/g, '');
  const endCompact = end.replace(/-/g, '');

  let query = service
    .from('journal_entries')
    .select('debit_account, credit_account, amount, entry_date')
    .eq('user_id', user.id)
    .lte('entry_date', endCompact);

  if (clientId) query = query.eq('client_id', clientId);
  else query = query.is('client_id', null);

  const { data: entries, error: entErr } = await query;
  if (entErr) return NextResponse.json({ error: entErr.message }, { status: 500 });

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

  // 期間内変動の記録（B/S 用）
  type PeriodChange = { open: number; change: number; sub: string };
  const bsItemMap = new Map<string, PeriodChange>();

  // 既知の B/S 科目を opening_balances から先に登録
  // マスタにない（または sub_category 未設定）の場合は invalidOpening に集めて警告表示用に返す
  const invalidOpening: Breakdown[] = [];
  if (useOpening) {
    for (const [name, open] of Object.entries(openingBalances)) {
      const acc = accountMap.get(name);
      const sub = acc?.sub_category ?? null;
      if (!sub) {
        invalidOpening.push({ name, amount: Number(open) || 0 });
        continue;
      }
      if (BS_ASSET_SUBS.includes(sub) || BS_LIABILITY_SUBS.includes(sub) || BS_EQUITY_SUBS.includes(sub)) {
        bsItemMap.set(name, { open: Number(open) || 0, change: 0, sub });
      } else {
        invalidOpening.push({ name, amount: Number(open) || 0 });
      }
    }
  }

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
      const periodChange = b.periodDebit - b.periodCredit;
      const cum = b.cumDebit - b.cumCredit;
      if (useOpening) {
        const cur = bsItemMap.get(name) ?? { open: 0, change: 0, sub };
        cur.change += periodChange;
        bsItemMap.set(name, cur);
      } else {
        bsItemMap.set(name, { open: 0, change: cum, sub });
      }
    } else if (BS_LIABILITY_SUBS.includes(sub) || BS_EQUITY_SUBS.includes(sub)) {
      const periodChange = b.periodCredit - b.periodDebit;
      const cum = b.cumCredit - b.cumDebit;
      if (useOpening) {
        const cur = bsItemMap.get(name) ?? { open: 0, change: 0, sub };
        cur.change += periodChange;
        bsItemMap.set(name, cur);
      } else {
        bsItemMap.set(name, { open: 0, change: cum, sub });
      }
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
  const netIncome = netIncomeBeforeTax - corporateTax;

  // 当期純利益を 繰越利益剰余金 の change に加算
  {
    const cur = bsItemMap.get(CARRY_FORWARD_NAME) ?? { open: openingBalances[CARRY_FORWARD_NAME] ?? 0, change: 0, sub: '純資産' };
    cur.change += netIncome;
    bsItemMap.set(CARRY_FORWARD_NAME, cur);
  }

  // bsGroups を組み立て
  for (const [name, info] of bsItemMap) {
    const ending = info.open + info.change;
    if (!bsGroups[info.sub]) bsGroups[info.sub] = { sub_category: info.sub, total: 0, items: [] };
    bsGroups[info.sub].items.push({ name, amount: ending });
    bsGroups[info.sub].total += ending;
  }

  const assetsTotal = BS_ASSET_SUBS.reduce((s, k) => s + (bsGroups[k]?.total ?? 0), 0);
  const liabilitiesTotal = BS_LIABILITY_SUBS.reduce((s, k) => s + (bsGroups[k]?.total ?? 0), 0);
  const equityTotal = BS_EQUITY_SUBS.reduce((s, k) => s + (bsGroups[k]?.total ?? 0), 0);

  const orderedPl = [...PL_REVENUE_SUBS, ...PL_EXPENSE_SUBS]
    .map((k) => plGroups[k])
    .filter(Boolean);
  const orderedBs = [...BS_ASSET_SUBS, ...BS_LIABILITY_SUBS, ...BS_EQUITY_SUBS]
    .map((k) => bsGroups[k])
    .filter(Boolean);

  for (const g of orderedPl) g.items.sort((a, b) => b.amount - a.amount);
  for (const g of orderedBs) g.items.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  // 株主資本等変動計算書データ
  // 純資産科目それぞれの { name, opening, change, ending }
  type EquityRow = { name: string; opening: number; change: number; ending: number; isCarryForward: boolean };
  const equityRows: EquityRow[] = [];
  for (const [name, info] of bsItemMap) {
    if (info.sub !== '純資産') continue;
    equityRows.push({
      name,
      opening: info.open,
      change: info.change,
      ending: info.open + info.change,
      isCarryForward: name === CARRY_FORWARD_NAME,
    });
  }
  // 並び順: 資本金 → 資本準備金 → 利益準備金 → その他利益剰余金（繰越利益剰余金）→ その他
  const equityOrder = ['資本金', '資本準備金', '利益準備金', CARRY_FORWARD_NAME];
  equityRows.sort((a, b) => {
    const ai = equityOrder.indexOf(a.name);
    const bi = equityOrder.indexOf(b.name);
    if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const equityOpeningTotal = equityRows.reduce((s, r) => s + r.opening, 0);
  const equityChangeTotal = equityRows.reduce((s, r) => s + r.change, 0);
  const equityEndingTotal = equityOpeningTotal + equityChangeTotal;

  // 未分類
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
    client: clientInfo,
    useOpeningBalances: useOpening,
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
      corporateTax,
      netIncome,
    },
    bs: {
      groups: orderedBs,
      assetsTotal,
      liabilitiesTotal,
      equityTotal,
      liabilitiesAndEquityTotal: liabilitiesTotal + equityTotal,
    },
    equity: {
      rows: equityRows,
      openingTotal: equityOpeningTotal,
      changeTotal: equityChangeTotal,
      endingTotal: equityEndingTotal,
    },
    unclassified,
    invalidOpeningBalances: invalidOpening,
  });
}
