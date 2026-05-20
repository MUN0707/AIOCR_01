import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { resolveVendorsBatch } from '@/lib/vendor-resolve';

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

    // 取引先解決（group ごとに 1 件）
    const resolvedVendors = await resolveVendorsBatch(
      service, user.id, clientId, groups.map((g) => g.vendor_name ?? ''),
    );

    const rows: Record<string, unknown>[] = [];
    groups.forEach((g, gi) => {
      const voucherGroupId = crypto.randomUUID();
      const bankUploadId = g.paymentEntry?.bank_ocr_upload_id ?? null;
      const vendorCanonical = resolvedVendors[gi].canonicalName || g.vendor_name;
      const vendorId = resolvedVendors[gi].vendorId;
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
          vendor_name: vendorCanonical,
          vendor_id: vendorId,
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
          vendor_name: vendorCanonical,
          vendor_id: vendorId,
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
          vendor_name: vendorCanonical,
          vendor_id: vendorId,
          match_status: p.match_status,
          ocr_upload_id: p.ocr_upload_id ?? null,
          bank_ocr_upload_id: p.bank_ocr_upload_id ?? null,
        });
      }
    });

    const { error } = await service.from('journal_entries').insert(rows);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 借方が固定資産科目の仕訳を検出し、fixed_assets に仮登録
    const debitAccounts = Array.from(new Set(
      rows.map((r) => r.debit_account).filter((v): v is string => typeof v === 'string' && v.length > 0)
    ));
    let newAssets: Array<{ id: string; asset_number: number; name: string }> = [];
    if (debitAccounts.length > 0) {
      const { data: acctRows } = await service
        .from('accounts')
        .select('name, fixed_asset_type')
        .eq('user_id', user.id)
        .in('name', debitAccounts);
      const fixedAcctMap = new Map<string, string>();
      for (const a of acctRows ?? []) {
        if (a.fixed_asset_type && ['tangible', 'intangible', 'deferred'].includes(a.fixed_asset_type)) {
          fixedAcctMap.set(a.name, a.fixed_asset_type);
        }
      }

      if (fixedAcctMap.size > 0) {
        // 現在の最大 asset_number
        let nextNumQuery = service
          .from('fixed_assets')
          .select('asset_number')
          .eq('user_id', user.id)
          .order('asset_number', { ascending: false })
          .limit(1);
        if (clientId) nextNumQuery = nextNumQuery.eq('client_id', clientId);
        else nextNumQuery = nextNumQuery.is('client_id', null);
        const { data: maxRows } = await nextNumQuery;
        let nextNum = (maxRows && maxRows[0]?.asset_number ? maxRows[0].asset_number : 0) + 1;

        const inserts: Record<string, unknown>[] = [];
        for (const r of rows) {
          const debit = r.debit_account as string;
          const category = fixedAcctMap.get(debit);
          if (!category) continue;
          const amt = Number(r.amount ?? 0);
          if (amt <= 0) continue;
          inserts.push({
            user_id: user.id,
            client_id: clientId,
            asset_number: nextNum++,
            category,
            name: debit,
            account_name: debit,
            acquisition_date: null,
            depreciation_start_date: null,
            acquisition_cost: amt,
            residual_value: 0,
            useful_life_years: null,
            method: 'straight_line',
            status: 'pending',
            note: `仕訳自動登録: ${r.description ?? ''}`,
          });
        }
        if (inserts.length > 0) {
          const { data: created } = await service
            .from('fixed_assets')
            .insert(inserts)
            .select('id, asset_number, name');
          newAssets = created ?? [];
        }
      }
    }

    return NextResponse.json({ success: true, inserted: rows.length, newAssets });
  } catch (error) {
    console.error('persist-match エラー:', error);
    const message = error instanceof Error ? error.message : '保存に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
