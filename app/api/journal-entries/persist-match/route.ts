import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 30;

/**
 * 照合結果の部分登録用エンドポイント。
 * フロントが選択した voucher グループ（accrual + payment の組）を journal_entries に保存する。
 *
 * body:
 *   clientId: string | null
 *   groups: Array<{
 *     accrualEntries: Array<{ date, debit_account, credit_account, amount, description, tax_type, match_status, ocr_upload_id? }>;
 *     paymentEntry?: { date, debit_account, credit_account, amount, description, tax_type, match_status, ocr_upload_id?, bank_ocr_upload_id? };
 *     vendor_name: string;
 *   }>
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const body = await request.json();
    const clientId: string | null = body.clientId ?? null;
    const groups: Array<{
      accrualEntries: Array<{
        date: string;
        debit_account: string;
        credit_account: string;
        amount: number | null;
        description: string;
        tax_type: string;
        match_status: string;
        ocr_upload_id?: string | null;
        bank_ocr_upload_id?: string | null;
      }>;
      paymentEntry?: {
        date: string;
        debit_account: string;
        credit_account: string;
        amount: number | null;
        description: string;
        tax_type: string;
        match_status: string;
        ocr_upload_id?: string | null;
        bank_ocr_upload_id?: string | null;
      };
      withholdingPaymentEntry?: {
        date: string;
        debit_account: string;
        credit_account: string;
        amount: number | null;
        description: string;
        tax_type: string;
        match_status: string;
        ocr_upload_id?: string | null;
        bank_ocr_upload_id?: string | null;
      };
      vendor_name: string;
    }> = body.groups ?? [];

    if (groups.length === 0) {
      return NextResponse.json({ error: '保存対象がありません' }, { status: 400 });
    }

    const service = createServiceClient();
    const rows: Record<string, unknown>[] = [];
    for (const g of groups) {
      const voucherGroupId = crypto.randomUUID();
      const bankUploadId = g.paymentEntry?.bank_ocr_upload_id ?? null;
      for (const e of g.accrualEntries) {
        rows.push({
          user_id: user.id,
          client_id: clientId,
          voucher_group_id: voucherGroupId,
          entry_type: 'accrual',
          entry_date: e.date,
          debit_account: e.debit_account,
          credit_account: e.credit_account,
          amount: e.amount,
          description: e.description,
          tax_type: e.tax_type,
          vendor_name: g.vendor_name,
          match_status: e.match_status,
          ocr_upload_id: e.ocr_upload_id ?? null,
          bank_ocr_upload_id: bankUploadId,
        });
      }
      if (g.paymentEntry) {
        const p = g.paymentEntry;
        rows.push({
          user_id: user.id,
          client_id: clientId,
          voucher_group_id: voucherGroupId,
          entry_type: 'payment',
          entry_date: p.date,
          debit_account: p.debit_account,
          credit_account: p.credit_account,
          amount: p.amount,
          description: p.description,
          tax_type: p.tax_type,
          vendor_name: g.vendor_name,
          match_status: p.match_status,
          ocr_upload_id: p.ocr_upload_id ?? null,
          bank_ocr_upload_id: bankUploadId,
        });
      }
      if (g.withholdingPaymentEntry) {
        const p = g.withholdingPaymentEntry;
        rows.push({
          user_id: user.id,
          client_id: clientId,
          voucher_group_id: voucherGroupId,
          entry_type: 'payment',
          entry_date: p.date,
          debit_account: p.debit_account,
          credit_account: p.credit_account,
          amount: p.amount,
          description: p.description,
          tax_type: p.tax_type,
          vendor_name: g.vendor_name,
          match_status: p.match_status,
          ocr_upload_id: p.ocr_upload_id ?? null,
          bank_ocr_upload_id: p.bank_ocr_upload_id ?? null,
        });
      }
    }

    const { error } = await service.from('journal_entries').insert(rows);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, inserted: rows.length });
  } catch (error) {
    console.error('persist-match エラー:', error);
    const message = error instanceof Error ? error.message : '保存に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
