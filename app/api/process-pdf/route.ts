import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { processInvoicePdf, processInvoicePdfSingle, InvoiceLineSumMismatchError } from '@/lib/ocr/invoice-ocr';
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
    const sessionId = (formData.get('sessionId') as string) || crypto.randomUUID();
    const clientId = (formData.get('clientId') as string) || null;

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
    let userId: string | null = user?.id ?? null;
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let responseBody: any;
    if (mode === 'tax-return') {
      const { items, totalPages, usage } = await processTaxReturnPdf(pdfBuffer, anthropic);
      responseBody = {
        mode: 'tax-return',
        invoices: items.map((item, i) => ({ index: i + 1, ...item })),
        totalPages,
        usage,
      };
    } else if (mode === 'bank-statement') {
      const { bankName, accountNumber, transactions, totalPages, usage } =
        await processBankStatementPdf(pdfBuffer, anthropic);
      responseBody = {
        mode: 'bank-statement',
        bankName,
        accountNumber,
        transactions,
        totalPages,
        usage,
      };
    } else if (mode === 'invoice-single') {
      const { items, totalPages, usage } = await processInvoicePdfSingle(pdfBuffer, anthropic, file.name);
      responseBody = {
        mode: 'invoice-single',
        invoices: items.map((item, i) => ({ index: i + 1, ...item })),
        totalPages,
        usage,
      };
    } else {
      const { items, totalPages, usage } = await processInvoicePdf(pdfBuffer, anthropic);
      responseBody = {
        mode: 'invoice',
        invoices: items.map((item, i) => ({ index: i + 1, ...item })),
        totalPages,
        usage,
      };
    }

    // OCR成功後に使用量をインクリメント（サービスクライアントでRLSをバイパス）
    const service = createServiceClient();
    if (trackUsage && userId) {
      await service.rpc('increment_usage', { p_user_id: userId, p_year_month: yearMonth });
    }

    // PDFをSupabase Storageに保存（バックグラウンド、失敗してもOCR結果は返す）
    let uploadId: string | null = null;
    try {
      const timestamp = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${sessionId}/${timestamp}_${safeName}`;

      await service.storage
        .from('ocr-uploads')
        .upload(storagePath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: false,
        });

      const { data: insertedUpload } = await service
        .from('ocr_uploads')
        .insert({
          user_id: userId,
          session_id: sessionId,
          file_name: file.name,
          storage_path: storagePath,
          mode,
          ocr_result: responseBody,
          file_size_bytes: pdfBuffer.byteLength,
          input_tokens: responseBody.usage?.inputTokens ?? null,
          output_tokens: responseBody.usage?.outputTokens ?? null,
          cost_jpy: responseBody.usage?.costJpy ?? null,
          ...(clientId ? { client_id: clientId } : {}),
        })
        .select('id')
        .single();
      uploadId = insertedUpload?.id ?? null;
    } catch (storageError) {
      console.error('PDF保存エラー（OCR結果は正常）:', storageError);
    }

    return NextResponse.json({ ...responseBody, uploadId });
  } catch (error) {
    if (error instanceof InvoiceLineSumMismatchError) {
      // 明細合計の不整合：フロントでスクショ依頼モーダルを出すための専用レスポンス
      return NextResponse.json(
        {
          error: error.message,
          errorCode: 'LINE_SUM_MISMATCH',
          detail: {
            taxIncludedAmount: error.taxIncludedAmount,
            linesSum: error.linesSum,
            fileName: error.fileName,
            lines: error.lines,
          },
        },
        { status: 422 }
      );
    }
    console.error('PDF処理エラー:', error);
    const message = error instanceof Error ? error.message : 'PDF処理中にエラーが発生しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
