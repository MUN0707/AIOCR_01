import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { PDFDocument } from 'pdf-lib';

// Vercel Pro: 最大60秒。さらに長い処理が必要な場合は Vercel ダッシュボードで Fluid Compute を有効化（最大800秒）
export const maxDuration = 60;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface InvoiceInfo {
  pageStart: number;
  pageEnd: number;
  date: string;
  requesterName: string;
  taxIncludedAmount: number | null;
}

interface ClaudeResponse {
  invoices: InvoiceInfo[];
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 60);
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('pdf') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'PDFファイルが見つかりません' },
        { status: 400 }
      );
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json(
        { error: 'PDFファイルのみ対応しています' },
        { status: 400 }
      );
    }

    const pdfBuffer = Buffer.from(await file.arrayBuffer());
    const pdfBase64 = pdfBuffer.toString('base64');

    // Claude API でOCR解析
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              type: 'text',
              text: `このPDFには複数の請求書が含まれています。すべての請求書を特定し、以下のJSON形式のみで返答してください。説明文や前置きは一切不要です。JSONのみ出力してください。

{
  "invoices": [
    {
      "pageStart": 1,
      "pageEnd": 1,
      "date": "20240201",
      "requesterName": "株式会社〇〇",
      "taxIncludedAmount": 110000
    }
  ]
}

抽出ルール：
- pageStart / pageEnd：1始まりのページ番号（整数）
- date：請求日または発行日をYYYYMMDD形式。不明な場合は"不明"
- requesterName：請求書を発行した会社名または個人名（請求元）。不明な場合は"不明"
- taxIncludedAmount：税込合計金額（整数・円）。不明な場合はnull
- 1つの請求書が複数ページにまたがる場合はpageStartとpageEndで範囲を示す
- 純粋なJSONのみ返すこと。マークダウンのコードブロックも不要`,
            },
          ],
        },
      ],
    });

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('Claudeからの応答が不正です');
    }

    // JSONを抽出（マークダウンコードブロックに包まれている場合も対応）
    const rawText = textContent.text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    let claudeData: ClaudeResponse;
    try {
      claudeData = JSON.parse(rawText);
    } catch {
      // JSONオブジェクト部分だけを抽出してリトライ
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error(`JSONの解析に失敗しました。Claude応答: ${rawText.substring(0, 500)}`);
      }
      claudeData = JSON.parse(jsonMatch[0]);
    }

    if (!claudeData.invoices || !Array.isArray(claudeData.invoices)) {
      throw new Error('請求書データの解析に失敗しました');
    }

    // PDFを読み込んで分割
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const totalPages = pdfDoc.getPageCount();

    const results = await Promise.all(
      claudeData.invoices.map(async (invoice: InvoiceInfo, index: number) => {
        const newPdf = await PDFDocument.create();

        const startIdx = Math.max(0, (invoice.pageStart || 1) - 1);
        const endIdx = Math.min(totalPages - 1, (invoice.pageEnd || invoice.pageStart || 1) - 1);

        const pageIndices = Array.from(
          { length: endIdx - startIdx + 1 },
          (_, i) => startIdx + i
        );

        const copiedPages = await newPdf.copyPages(pdfDoc, pageIndices);
        copiedPages.forEach((page) => newPdf.addPage(page));

        const splitPdfBytes = await newPdf.save();

        // ファイル名を生成
        const date = String(invoice.date || '不明');
        const requester = sanitizeFileName(String(invoice.requesterName || '不明'));
        const amount =
          invoice.taxIncludedAmount != null
            ? `${Number(invoice.taxIncludedAmount).toLocaleString()}円`
            : '金額不明';

        const fileName = `${date}_${requester}_${amount}.pdf`;

        return {
          index: index + 1,
          pageStart: invoice.pageStart,
          pageEnd: invoice.pageEnd,
          date: invoice.date,
          requesterName: invoice.requesterName,
          taxIncludedAmount: invoice.taxIncludedAmount,
          fileName,
          pdfBase64: Buffer.from(splitPdfBytes).toString('base64'),
        };
      })
    );

    return NextResponse.json({
      invoices: results,
      totalPages,
    });
  } catch (error) {
    console.error('PDF処理エラー:', error);
    const message =
      error instanceof Error ? error.message : 'PDF処理中にエラーが発生しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
