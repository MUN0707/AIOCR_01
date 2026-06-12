import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const from = params.get('from');
  const to = params.get('to');
  const clientId = params.get('clientId') || null;

  if (!from || !to) return NextResponse.json({ error: 'from/to が必要です' }, { status: 400 });

  const service = createServiceClient();

  let ownerUserId = user.id;
  // [C5] クライアントの課税事業者設定
  let isTaxable = true;
  let taxMethod: 'honsoku' | 'kani' = 'honsoku';
  let simplifiedRate: number | null = null;
  if (clientId) {
    const scope = await resolveClientScope(service, user.id, clientId);
    if (!scope) return NextResponse.json({ error: 'この会社へのアクセス権限がありません' }, { status: 403 });
    ownerUserId = scope.ownerUserId;

    const { data: client } = await service
      .from('clients')
      .select('is_taxable, tax_method, simplified_rate')
      .eq('id', clientId)
      .single();
    if (client) {
      isTaxable = client.is_taxable !== false;
      taxMethod = client.tax_method === 'kani' ? 'kani' : 'honsoku';
      simplifiedRate = client.simplified_rate != null ? Number(client.simplified_rate) : null;
    }
  }

  // [C5] 免税事業者は消費税集計を行わない
  if (!isTaxable) {
    return NextResponse.json({
      period: { from, to },
      is_taxable: false,
      tax_method: taxMethod,
      message: '免税事業者のため消費税集計は行いません。',
      categories: null,
    });
  }

  // 対象期間の仕訳を tax_category 別に集計
  const fromYmd = from.replace(/-/g, '');
  const toYmd = to.replace(/-/g, '');

  let q = service
    .from('journal_entries')
    .select('tax_category, amount, debit_amount, credit_amount')
    .eq('user_id', ownerUserId)
    .gte('entry_date', fromYmd)
    .lte('entry_date', toYmd);

  if (clientId) q = q.eq('client_id', clientId);
  else q = q.is('client_id', null);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // カテゴリ別に集計
  type CategoryKey = 'taxable_sales' | 'tax_exempt_sales' | 'taxable_purchase' | 'non_taxable' | 'unclassified';
  const totals: Record<CategoryKey, { count: number; amount: number }> = {
    taxable_sales: { count: 0, amount: 0 },
    tax_exempt_sales: { count: 0, amount: 0 },
    taxable_purchase: { count: 0, amount: 0 },
    non_taxable: { count: 0, amount: 0 },
    unclassified: { count: 0, amount: 0 },
  };

  for (const row of rows ?? []) {
    // 金額: amount を優先、なければ借方・貸方の大きい方
    const amt =
      row.amount != null
        ? Number(row.amount)
        : Math.max(Number(row.debit_amount ?? 0), Number(row.credit_amount ?? 0));

    const key: CategoryKey = (row.tax_category as CategoryKey) ?? 'unclassified';
    if (totals[key]) {
      totals[key].count += 1;
      totals[key].amount += amt;
    }
  }

  // 消費税計算（内税10%前提）
  const salesTax = Math.floor((totals.taxable_sales.amount * 10) / 110);
  // 本則課税: 実際の課税仕入に係る消費税を控除
  const purchaseTax = Math.floor((totals.taxable_purchase.amount * 10) / 110);
  const honsokuPayable = salesTax - purchaseTax;

  // [C5] 簡易課税: みなし仕入率で控除税額を算出（控除 = 売上税額 × みなし仕入率）
  // simplified_rate 未設定の場合は控除0として計算し、要設定フラグを返す
  const deemedPurchaseTax = simplifiedRate != null ? Math.floor(salesTax * simplifiedRate) : 0;
  const kaniPayable = salesTax - deemedPurchaseTax;

  const payable = taxMethod === 'kani' ? kaniPayable : honsokuPayable;

  // 課税売上割合
  const totalSales = totals.taxable_sales.amount + totals.tax_exempt_sales.amount;
  const taxableRatio = totalSales > 0 ? totals.taxable_sales.amount / totalSales : null;

  return NextResponse.json({
    period: { from, to },
    is_taxable: true,
    tax_method: taxMethod,
    categories: totals,
    // 本則課税の内訳（互換のため honzoku キーは従来通り残す）
    honzoku: { sales_tax: salesTax, purchase_tax: purchaseTax, payable: honsokuPayable },
    // 簡易課税の内訳
    kani: {
      sales_tax: salesTax,
      deemed_rate: simplifiedRate,
      deemed_purchase_tax: deemedPurchaseTax,
      payable: kaniPayable,
      needs_rate_setup: simplifiedRate == null,
    },
    // 採用方式での納付見込み
    payable,
    totals: { total_sales: totalSales, taxable_ratio: taxableRatio },
  });
}
