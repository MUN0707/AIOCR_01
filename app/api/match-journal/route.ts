import { NextRequest, NextResponse } from 'next/server';
import {
  matchVouchersToTransactions,
  type VoucherInput,
  type TransactionInput,
  type AccountingMethod,
} from '@/lib/ocr/journal-matcher';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { normalizeVendorKey } from '@/lib/vendor-normalize';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawVouchers: VoucherInput[] = body.vouchers ?? [];
    const transactions: TransactionInput[] = body.transactions ?? [];
    const clientId: string | null = body.clientId ?? null;
    const accountingMethod: AccountingMethod = body.accountingMethod === 'cash' ? 'cash' : 'accrual';

    if (rawVouchers.length === 0 && transactions.length === 0) {
      return NextResponse.json(
        { error: '証票データまたは入出金データが必要です' },
        { status: 400 }
      );
    }

    // ─── 取引先の名寄せ（既存マスタの canonical name に統一・新規は自動登録） ───
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const service = createServiceClient();

    let vouchers: VoucherInput[] = rawVouchers;
    if (user) {
      const { data: existingVendors } = await service
        .from('vendors')
        .select('id, name, normalized_key')
        .eq('user_id', user.id);

      const keyToName = new Map<string, string>();
      for (const v of existingVendors ?? []) {
        keyToName.set(v.normalized_key, v.name);
      }

      const newVendorRows: { user_id: string; name: string; normalized_key: string }[] = [];
      vouchers = rawVouchers.map((v) => {
        const raw = v.vendorName?.trim() ?? '';
        if (!raw) return v;
        const key = normalizeVendorKey(raw);
        if (!key) return v;
        const canonical = keyToName.get(key);
        if (canonical) {
          return { ...v, vendorName: canonical };
        }
        // 新規取引先として登録（最初に来た表記を canonical にする）
        keyToName.set(key, raw);
        newVendorRows.push({ user_id: user.id, name: raw, normalized_key: key });
        return v;
      });

      if (newVendorRows.length > 0) {
        await service.from('vendors').upsert(newVendorRows, {
          onConflict: 'user_id,normalized_key',
          ignoreDuplicates: true,
        });
      }
    }

    const { results, summary } = matchVouchersToTransactions(vouchers, transactions, accountingMethod);

    // ─── 改善分析用のログ保存＋仕訳明細テーブルにも保存 ───
    try {
      if (user) {
        // 1) ログ保存（分析用）
        const { data: logRow } = await service
          .from('journal_match_logs')
          .insert({
            user_id: user.id,
            user_email: user.email ?? null,
            client_id: clientId,
            vouchers,
            transactions,
            results,
            summary,
          })
          .select('id')
          .single();

        // 2) フラットな仕訳明細として保存（日記帳・編集・残高計算に使用）
        // voucher_group_id で「1請求書から生まれた複数仕訳」をグループ化する。
        // 未設定の古いカラムには影響しない（NULL許容）。
        const logId = logRow?.id ?? null;
        const rows: Record<string, unknown>[] = [];
        for (const r of results) {
          const firstAccrual = r.accrualEntries[0];
          const vendor = firstAccrual?.voucher?.vendorName ?? '';
          // 同一請求書から派生した仕訳を紐付けるグループID
          const voucherGroupId = crypto.randomUUID();
          for (const e of r.accrualEntries) {
            rows.push({
              user_id: user.id,
              client_id: clientId,
              log_id: logId,
              voucher_group_id: voucherGroupId,
              entry_type: 'accrual',
              entry_date: e.date,
              debit_account: e.debitAccount,
              credit_account: e.creditAccount,
              amount: e.amount,
              description: e.description,
              tax_type: e.taxType,
              vendor_name: vendor,
              match_status: e.matchStatus,
            });
          }
          if (r.paymentEntry) {
            rows.push({
              user_id: user.id,
              client_id: clientId,
              log_id: logId,
              voucher_group_id: voucherGroupId,
              entry_type: 'payment',
              entry_date: r.paymentEntry.date,
              debit_account: r.paymentEntry.debitAccount,
              credit_account: r.paymentEntry.creditAccount,
              amount: r.paymentEntry.amount,
              description: r.paymentEntry.description,
              tax_type: r.paymentEntry.taxType,
              vendor_name: vendor,
              match_status: r.paymentEntry.matchStatus,
            });
          }
        }
        if (rows.length > 0) {
          await service.from('journal_entries').insert(rows);
        }
      }
    } catch (logError) {
      console.error('journal_match_logs 保存失敗:', logError);
    }

    return NextResponse.json({ results, summary });
  } catch (error) {
    console.error('照合処理エラー:', error);
    const message = error instanceof Error ? error.message : '照合処理中にエラーが発生しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
