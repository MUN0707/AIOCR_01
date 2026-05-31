import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { resolveVendor } from '@/lib/vendor-resolve';
import { canWrite, resolveClientScope } from '@/lib/client-access';
import { normalizeDate } from '@/lib/normalize-date';

export const maxDuration = 15;

const ALLOWED_TAX_CATEGORIES = new Set([
  'taxable_sales',
  'tax_exempt_sales',
  'taxable_purchase',
  'non_taxable',
]);

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const entryDate = normalizeDate(body.entry_date);
  if (!entryDate) {
    return NextResponse.json({ error: '日付は YYYY-MM-DD 形式で入力してください' }, { status: 400 });
  }

  const debitAccount = typeof body.debit_account === 'string' ? body.debit_account.trim() : '';
  const creditAccount = typeof body.credit_account === 'string' ? body.credit_account.trim() : '';
  if (!debitAccount || !creditAccount) {
    return NextResponse.json({ error: '借方・貸方の勘定科目は必須です' }, { status: 400 });
  }

  const amountRaw = body.amount;
  const amount = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: '金額は1以上の数値で入力してください' }, { status: 400 });
  }

  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const vendorName = typeof body.vendor_name === 'string' ? body.vendor_name.trim() : '';

  let taxCategory: string | null = null;
  if (typeof body.tax_category === 'string' && body.tax_category) {
    if (!ALLOWED_TAX_CATEGORIES.has(body.tax_category)) {
      return NextResponse.json({ error: '消費税区分の値が不正です' }, { status: 400 });
    }
    taxCategory = body.tax_category;
  }

  const clientId = typeof body.client_id === 'string' && body.client_id ? body.client_id : null;

  const service = createServiceClient();

  // 権限解決: client 指定があれば member 含めてアクセス確認、無ければ owner 本人として処理
  let ownerUserId = user.id;
  if (clientId) {
    const scope = await resolveClientScope(service, user.id, clientId);
    if (!scope || !canWrite(scope.role)) {
      return NextResponse.json({ error: 'この会社への書き込み権限がありません' }, { status: 403 });
    }
    ownerUserId = scope.ownerUserId;
  }

  // 締め日チェック
  {
    let q = service.from('journal_closings').select('closed_until').eq('user_id', ownerUserId);
    if (clientId) q = q.eq('client_id', clientId);
    else q = q.is('client_id', null);
    const { data: closings } = await q.limit(1);
    const closedUntil = closings?.[0]?.closed_until;
    if (closedUntil && entryDate <= closedUntil) {
      return NextResponse.json({ error: `${closedUntil} までは締め済みのため登録できません` }, { status: 403 });
    }
  }

  // 取引先を解決（vendor_id を埋め、canonical name に揃える）
  const { vendorId, canonicalName } = await resolveVendor(service, ownerUserId, clientId, vendorName);

  const row = {
    user_id: ownerUserId,
    client_id: clientId,
    voucher_group_id: crypto.randomUUID(),
    entry_type: 'manual',
    entry_date: entryDate,
    debit_account: debitAccount,
    credit_account: creditAccount,
    amount: Math.round(amount),
    description,
    tax_type: '対象外',
    tax_category: taxCategory,
    vendor_name: canonicalName,
    vendor_id: vendorId,
    match_status: 'manual',
  };

  const { data: inserted, error: insertError } = await service
    .from('journal_entries')
    .insert(row)
    .select('id')
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // journal_audit_logs への created 記録は AFTER INSERT トリガ (log_journal_entry_changes) で実施
  return NextResponse.json({ success: true, id: inserted.id });
}
