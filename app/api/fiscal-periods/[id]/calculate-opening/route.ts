import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 30;

/**
 * 期首日より前の全仕訳から期首残高を自動算出する
 *
 * ロジック:
 * - B/S 科目（資産/負債/純資産）: 期首日より前の累計残高
 *   - 資産: cumDebit - cumCredit
 *   - 負債/純資産: cumCredit - cumDebit
 * - PL 科目（収益/費用）: 期首日より前の純利益累計を「繰越利益剰余金」に加算
 *
 * 結果は { 科目名: 金額 } の形で返す。保存はクライアント側から PATCH で行う。
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const service = createServiceClient();

  // 期間取得
  const { data: period, error: perErr } = await service
    .from('fiscal_periods')
    .select('id, start_date, client_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();
  if (perErr || !period) return NextResponse.json({ error: '会計期間が見つかりません' }, { status: 404 });

  const startCompact = String(period.start_date).replace(/-/g, '');

  // 勘定科目マスタ
  const { data: accounts, error: accErr } = await service
    .from('accounts')
    .select('name, sub_category')
    .eq('user_id', user.id);
  if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 });

  const subByName = new Map<string, string | null>();
  for (const a of accounts ?? []) subByName.set(a.name, a.sub_category);

  // 期首日より前の仕訳
  let q = service
    .from('journal_entries')
    .select('debit_account, credit_account, amount, entry_date')
    .eq('user_id', user.id)
    .lt('entry_date', startCompact);
  if (period.client_id) q = q.eq('client_id', period.client_id);
  else q = q.is('client_id', null);

  const { data: entries, error: entErr } = await q;
  if (entErr) return NextResponse.json({ error: entErr.message }, { status: 500 });

  const ASSET_SUBS = ['流動資産', '固定資産', '繰延資産'];
  const LIAB_SUBS = ['流動負債', '固定負債'];
  const EQUITY_SUBS = ['純資産'];
  const REVENUE_SUBS = ['売上高', '営業外収益', '特別利益'];
  const EXPENSE_SUBS = ['売上原価', '販管費', '営業外費用', '特別損失'];

  type Bucket = { debit: number; credit: number; sub: string | null };
  const buckets = new Map<string, Bucket>();
  const ensure = (name: string): Bucket => {
    let b = buckets.get(name);
    if (!b) { b = { debit: 0, credit: 0, sub: subByName.get(name) ?? null }; buckets.set(name, b); }
    return b;
  };

  for (const e of entries ?? []) {
    const amount = Number(e.amount ?? 0);
    if (!amount) continue;
    if (e.debit_account) ensure(e.debit_account).debit += amount;
    if (e.credit_account) ensure(e.credit_account).credit += amount;
  }

  // B/S 科目: 残高をそのまま opening_balances に
  const opening: Record<string, number> = {};
  let priorPlNet = 0; // 期首日より前の累計純利益(税引前)

  for (const [name, b] of buckets) {
    const sub = b.sub;
    if (!sub) continue;
    if (ASSET_SUBS.includes(sub)) {
      const v = b.debit - b.credit;
      if (v !== 0) opening[name] = v;
    } else if (LIAB_SUBS.includes(sub) || EQUITY_SUBS.includes(sub)) {
      const v = b.credit - b.debit;
      if (v !== 0) opening[name] = v;
    } else if (REVENUE_SUBS.includes(sub)) {
      priorPlNet += b.credit - b.debit;
    } else if (EXPENSE_SUBS.includes(sub)) {
      priorPlNet -= b.debit - b.credit;
    }
  }

  // 過去PL純利益を繰越利益剰余金に加算
  if (priorPlNet !== 0) {
    opening['繰越利益剰余金'] = (opening['繰越利益剰余金'] ?? 0) + priorPlNet;
  }

  return NextResponse.json({ opening_balances: opening, prior_pl_net_income: priorPlNet });
}
