import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { processInvoicePdf } from '@/lib/ocr/invoice-ocr';
import { processTaxReturnPdf } from '@/lib/ocr/tax-return-ocr';
import { processBankStatementPdf } from '@/lib/ocr/bank-statement-ocr';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 60;

const PLAN_LIMITS: Record<string, number> = {
  light: 50,
  heavy: 200,
  trial: 50,
};

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('pdf') as File | null;
    const mode = (formData.get('mode') as string) || 'invoice';

    if (!file) {
      return NextResponse.json({ error: 'PDFファイルが見つかりません' }, { status: 400 });
    }
    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'PDFファイルのみ対応しています' }, { status: 400 });
    }

    // 認証ユーザーの場合は使用量チェック
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    let trackUsage = false;
    let userId: string | null = null;
    const yearMonth = new Date().toISOString().slice(0, 7); // '2026-03'

    if (user && user.email !== process.env.ADMIN_EMAIL) {
      const { data: subscription } = await supabase
        .from('subscriptions')
        .select('plan, status')
        .eq('user_id', user.id)
        .single();

      const plan = subscription?.plan ?? 'light';
      const status = subscription?.status ?? 'trial';
      const limit = PLAN_LIMITS[status === 'active' ? plan : 'trial'] ?? 50;

      const { data: usage } = await supabase
        .from('usage_logs')
        .select('count')
        .eq('user_id', user.id)
        .eq('year_month', yearMonth)
        .single();

      const currentCount = usage?.count ?? 0;
      if (currentCount >= limit) {
        return NextResponse.json(
          { error: `今月の処理上限（${limit}件）に達しました。プランのアップグレードをご検討ください。` },
          { status: 429 }
        );
      }

      trackUsage = true;
      userId = user.id;
    }

    const pdfBuffer = Buffer.from(await file.arrayBuffer());

    let result: NextResponse;
    if (mode === 'tax-return') {
      const { items, totalPages } = await processTaxReturnPdf(pdfBuffer, anthropic);
      result = NextResponse.json({
        mode: 'tax-return',
        invoices: items.map((item, i) => ({ index: i + 1, ...item })),
        totalPages,
      });
    } else if (mode === 'bank-statement') {
      const { bankName, accountNumber, transactions, totalPages } =
        await processBankStatementPdf(pdfBuffer, anthropic);
      result = NextResponse.json({
        mode: 'bank-statement',
        bankName,
        accountNumber,
        transactions,
        totalPages,
      });
    } else {
      const { items, totalPages } = await processInvoicePdf(pdfBuffer, anthropic);
      result = NextResponse.json({
        mode: 'invoice',
        invoices: items.map((item, i) => ({ index: i + 1, ...item })),
        totalPages,
      });
    }

    // OCR成功後に使用量をインクリメント（サービスクライアントでRLSをバイパス）
    if (trackUsage && userId) {
      const service = createServiceClient();
      await service.rpc('increment_usage', { p_user_id: userId, p_year_month: yearMonth });
    }

    return result;
  } catch (error) {
    console.error('PDF処理エラー:', error);
    const message = error instanceof Error ? error.message : 'PDF処理中にエラーが発生しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
