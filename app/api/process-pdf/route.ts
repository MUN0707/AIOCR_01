import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { processInvoicePdf } from '@/lib/ocr/invoice-ocr';
import { processTaxReturnPdf } from '@/lib/ocr/tax-return-ocr';

export const maxDuration = 60;

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

    const pdfBuffer = Buffer.from(await file.arrayBuffer());

    if (mode === 'tax-return') {
      const { items, totalPages } = await processTaxReturnPdf(pdfBuffer, anthropic);
      return NextResponse.json({
        mode: 'tax-return',
        invoices: items.map((item, i) => ({ index: i + 1, ...item })),
        totalPages,
      });
    } else {
      const { items, totalPages } = await processInvoicePdf(pdfBuffer, anthropic);
      return NextResponse.json({
        mode: 'invoice',
        invoices: items.map((item, i) => ({ index: i + 1, ...item })),
        totalPages,
      });
    }
  } catch (error) {
    console.error('PDF処理エラー:', error);
    const message = error instanceof Error ? error.message : 'PDF処理中にエラーが発生しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
