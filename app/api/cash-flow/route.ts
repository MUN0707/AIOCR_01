import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 30;

const CASH_ACCOUNT_KEYWORDS = ['現金', '普通預金', '当座預金', '定期預金', '小口現金'];
const CARRY_FORWARD_NAME = '繰越利益剰余金';
const PL_REVENUE_SUBS = ['売上高', '営業外収益', '特別利益'];
const PL_EXPENSE_SUBS = ['売上原価', '販管費', '営業外費用', '特別損失'];

function isCashAccount(name: string): boolean {
  return CASH_ACCOUNT_KEYWORDS.some((k) => name.includes(k));
}

function isDepreciation(name: string, sub: string | null): boolean {
  return name.includes('減価償却') && (sub === '販管費' || sub === '売上原価');
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const p = request.nextUrl.searchParams;
  const start = p.get('start');
  const end = p.get('end');
  const clientId = p.get('clientId');
  const periodId = p.get('periodId');

  if (!start || !end) return NextResponse.json({ error: 'start/end が必要です' }, { status: 400 });

  const service = createServiceClient();

  let corporateTax = 0;
  if (periodId) {
    const { data: period } = await service
      .from('fiscal_periods')
      .select('corporate_tax')
      .eq('id', periodId)
      .eq('user_id', user.id)
      .single();
    corporateTax = Number(period?.corporate_tax ?? 0) || 0;
  }

  const { data: accounts, error: accErr } = await service
    .from('accounts')
    .select('name, category, sub_category')
    .eq('user_id', user.id);
  if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 });

  const accountMap = new Map<string, { sub_category: string | null }>();
  for (const a of accounts ?? []) accountMap.set(a.name, { sub_category: a.sub_category ?? null });

  const startCompact = start.replace(/-/g, '');
  const endCompact = end.replace(/-/g, '');

  let query = service
    .from('journal_entries')
    .select('debit_account, credit_account, amount')
    .eq('user_id', user.id)
    .gte('entry_date', startCompact)
    .lte('entry_date', endCompact);

  if (clientId) query = query.eq('client_id', clientId);
  else query = query.is('client_id', null);

  const { data: entries, error: entErr } = await query;
  if (entErr) return NextResponse.json({ error: entErr.message }, { status: 500 });

  type Bucket = { debit: number; credit: number };
  const buckets = new Map<string, Bucket>();
  const ensure = (name: string): Bucket => {
    let b = buckets.get(name);
    if (!b) { b = { debit: 0, credit: 0 }; buckets.set(name, b); }
    return b;
  };

  for (const e of entries ?? []) {
    const amount = Number(e.amount ?? 0);
    if (!amount) continue;
    if (e.debit_account) ensure(e.debit_account).debit += amount;
    if (e.credit_account) ensure(e.credit_account).credit += amount;
  }

  let plRevenue = 0;
  let plExpense = 0;
  let depreciationTotal = 0;

  const operatingWC: { label: string; amount: number }[] = [];
  const investingItems: { label: string; amount: number }[] = [];
  const financingItems: { label: string; amount: number }[] = [];

  for (const [name, b] of buckets) {
    const sub = accountMap.get(name)?.sub_category ?? null;

    if (sub && PL_REVENUE_SUBS.includes(sub)) {
      plRevenue += b.credit - b.debit;
    } else if (sub && PL_EXPENSE_SUBS.includes(sub)) {
      const exp = b.debit - b.credit;
      plExpense += exp;
      if (isDepreciation(name, sub)) depreciationTotal += exp;
    } else if (sub === '流動資産') {
      if (!isCashAccount(name)) {
        const change = b.debit - b.credit;
        if (change !== 0) operatingWC.push({ label: `${name}の増減`, amount: -change });
      }
    } else if (sub === '流動負債') {
      const change = b.credit - b.debit;
      if (change !== 0) operatingWC.push({ label: `${name}の増減`, amount: change });
    } else if (sub === '固定資産' || sub === '繰延資産') {
      if (name.includes('累計額')) continue; // contra-asset — handled via depreciation add-back
      const change = b.debit - b.credit;
      if (change !== 0) investingItems.push({ label: `${name}の取得/売却`, amount: -change });
    } else if (sub === '固定負債') {
      const change = b.credit - b.debit;
      if (change !== 0) financingItems.push({ label: `${name}の増減`, amount: change });
    } else if (sub === '純資産' && name !== CARRY_FORWARD_NAME) {
      const change = b.credit - b.debit;
      if (change !== 0) financingItems.push({ label: `${name}の増減`, amount: change });
    }
  }

  const netIncome = plRevenue - plExpense - corporateTax;

  const operatingItems: { label: string; amount: number }[] = [
    { label: '当期純利益', amount: netIncome },
    ...(depreciationTotal > 0 ? [{ label: '減価償却費の加算', amount: depreciationTotal }] : []),
    ...operatingWC,
  ];

  const operatingSubtotal = operatingItems.reduce((s, i) => s + i.amount, 0);
  const investingSubtotal = investingItems.reduce((s, i) => s + i.amount, 0);
  const financingSubtotal = financingItems.reduce((s, i) => s + i.amount, 0);

  return NextResponse.json({
    period: { start, end },
    operating: { items: operatingItems, subtotal: operatingSubtotal },
    investing: { items: investingItems, subtotal: investingSubtotal },
    financing: { items: financingItems, subtotal: financingSubtotal },
    net: operatingSubtotal + investingSubtotal + financingSubtotal,
  });
}
