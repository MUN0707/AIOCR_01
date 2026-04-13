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

    // ─── 改善分析用のログ保存（失敗してもレスポンスは返す） ───
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const service = createServiceClient();
        await service.from('journal_match_logs').insert({
          user_id: user.id,
          user_email: user.email ?? null,
          client_id: clientId,
          vouchers,
          transactions,
          results,
          summary,
        });
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
