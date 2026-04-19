import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { processInvoicePdf, processInvoicePdfSingle, processInvoiceImage, InvoiceLineSumMismatchError } from '@/lib/ocr/invoice-ocr';
import { processTaxReturnPdf } from '@/lib/ocr/tax-return-ocr';
import { processBankStatementPdf } from '@/lib/ocr/bank-statement-ocr';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 60;

const PLAN_LIMITS: Record<string, number> = {
  lite: 30,
  standard: 100,
  pro: 300,
  enterprise: 1000,
  trial: 10,
};

const GUEST_MAX_USES = 5;

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
    const skipPdf = formData.get('skipPdf') === 'true';
    const pageOffset = parseInt(formData.get('pageOffset') as string) || 0;
    const fingerprintId = (formData.get('fingerprintId') as string) || null;

    if (!file) {
      return NextResponse.json({ error: 'ファイルが見つかりません' }, { status: 400 });
    }
    const SUPPORTED_TYPES = [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/heic',
      'image/heif',
    ];
    if (!SUPPORTED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'PDF・画像ファイル（PNG, JPEG, HEIC）のみ対応しています' }, { status: 400 });
    }
    const isImage = file.type.startsWith('image/');

    // 認証ユーザーの場合は使用量チェック
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    let trackUsage = false;
    let trackGuestUsage = false;
    let userId: string | null = user?.id ?? null;
    const yearMonth = new Date().toISOString().slice(0, 7); // '2026-03'

    const service = createServiceClient();

    // ゲストユーザーの場合：fingerprintIdでサーバーサイド制限
    if (!user) {
      if (!fingerprintId) {
        return NextResponse.json({ error: 'ゲスト利用にはブラウザ識別が必要です。ページを再読み込みしてください。' }, { status: 400 });
      }
      const { data: guestUsage } = await service
        .from('guest_usage')
        .select('count')
        .eq('fingerprint_id', fingerprintId)
        .eq('year_month', yearMonth)
        .maybeSingle();

      const guestCount = guestUsage?.count ?? 0;
      if (guestCount >= GUEST_MAX_USES) {
        return NextResponse.json(
          { error: `ゲストの無料お試し上限（${GUEST_MAX_USES}回）に達しました。ログインしてご利用ください。`, errorCode: 'GUEST_LIMIT_REACHED' },
          { status: 429 }
        );
      }
      trackGuestUsage = true;
    }

    if (user && user.email !== process.env.ADMIN_EMAIL) {
      const { data: subscription } = await supabase
        .from('subscriptions')
        .select('plan, status')
        .eq('user_id', user.id)
        .single();

      const plan = subscription?.plan ?? 'lite';
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

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    // HEIC/HEIF → JPEG変換はクライアント側で行う前提。サーバーではそのまま扱う。
    const pdfBuffer = fileBuffer; // 後方互換のため変数名維持

    // 重複チェック: 一時的に無効化（運用動画撮影のため同一ファイルの再アップロードを許可）
    const fileHash = createHash('sha256').update(pdfBuffer).digest('hex');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let responseBody: any;
    let usageCount = 1; // 分割後の件数でカウント
    const ocrOptions = { skipPdfExtraction: skipPdf, pageOffset };

    if (isImage) {
      // 画像ファイルは1枚＝1請求書として処理
      const { items, usage } = await processInvoiceImage(pdfBuffer, file.type, anthropic, file.name);
      usageCount = items.length;
      responseBody = {
        mode: 'invoice-single',
        invoices: items.map((item, i) => ({ index: i + 1, ...item })),
        totalPages: 1,
        usage,
      };
    } else if (mode === 'tax-return') {
      const { items, totalPages, usage } = await processTaxReturnPdf(pdfBuffer, anthropic, ocrOptions);
      usageCount = items.length;
      responseBody = {
        mode: 'tax-return',
        invoices: items.map((item, i) => ({ index: i + 1, ...item })),
        totalPages,
        usage,
      };
    } else if (mode === 'bank-statement') {
      const { bankName, accountNumber, transactions, totalPages, usage } =
        await processBankStatementPdf(pdfBuffer, anthropic);
      usageCount = 1; // 通帳はファイル単位
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
      usageCount = items.length;
      responseBody = {
        mode: 'invoice-single',
        invoices: items.map((item, i) => ({ index: i + 1, ...item })),
        totalPages,
        usage,
      };
    } else {
      const { items, totalPages, usage } = await processInvoicePdf(pdfBuffer, anthropic, ocrOptions);
      usageCount = items.length;
      responseBody = {
        mode: 'invoice',
        invoices: items.map((item, i) => ({ index: i + 1, ...item })),
        totalPages,
        usage,
      };
    }

    // OCR成功後に使用量をインクリメント（分割後の件数分）
    if (trackUsage && userId) {
      await service.rpc('increment_usage', { p_user_id: userId, p_year_month: yearMonth, p_amount: usageCount });
    }

    // ゲスト使用量をインクリメント
    if (trackGuestUsage && fingerprintId) {
      await service.rpc('increment_guest_usage', { p_fingerprint_id: fingerprintId, p_year_month: yearMonth, p_amount: usageCount });
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
          contentType: file.type,
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
          file_hash: fileHash,
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
