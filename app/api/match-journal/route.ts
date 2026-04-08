import { NextRequest, NextResponse } from 'next/server';
import {
  matchVouchersToTransactions,
  type VoucherInput,
  type TransactionInput,
} from '@/lib/ocr/journal-matcher';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const vouchers: VoucherInput[] = body.vouchers ?? [];
    const transactions: TransactionInput[] = body.transactions ?? [];

    if (vouchers.length === 0 && transactions.length === 0) {
      return NextResponse.json(
        { error: '証票データまたは入出金データが必要です' },
        { status: 400 }
      );
    }

    const { results, summary } = matchVouchersToTransactions(vouchers, transactions);

    return NextResponse.json({ results, summary });
  } catch (error) {
    console.error('照合処理エラー:', error);
    const message = error instanceof Error ? error.message : '照合処理中にエラーが発生しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
