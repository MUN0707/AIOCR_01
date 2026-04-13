import { NextRequest, NextResponse } from 'next/server';
import {
  matchVouchersToTransactions,
  type VoucherInput,
  type TransactionInput,
} from '@/lib/ocr/journal-matcher';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const vouchers: VoucherInput[] = body.vouchers ?? [];
    const transactions: TransactionInput[] = body.transactions ?? [];
    const clientId: string | null = body.clientId ?? null;

    if (vouchers.length === 0 && transactions.length === 0) {
      return NextResponse.json(
        { error: '証票データまたは入出金データが必要です' },
        { status: 400 }
      );
    }

    const { results, summary } = matchVouchersToTransactions(vouchers, transactions);

    // ─── 改善分析用のログ保存＋仕訳明細テーブルにも保存 ───
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const service = createServiceClient();

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
        const logId = logRow?.id ?? null;
        const rows: Record<string, unknown>[] = [];
        for (const r of results) {
          const vendor = r.accrualEntry.voucher?.vendorName ?? '';
          rows.push({
            user_id: user.id,
            client_id: clientId,
            log_id: logId,
            entry_type: 'accrual',
            entry_date: r.accrualEntry.date,
            debit_account: r.accrualEntry.debitAccount,
            credit_account: r.accrualEntry.creditAccount,
            amount: r.accrualEntry.amount,
            description: r.accrualEntry.description,
            tax_type: r.accrualEntry.taxType,
            vendor_name: vendor,
            match_status: r.accrualEntry.matchStatus,
          });
          if (r.paymentEntry) {
            rows.push({
              user_id: user.id,
              client_id: clientId,
              log_id: logId,
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
