/**
 * 法人請求書 OCR
 *
 * TODO: IKANのコードが届いたら、PROMPT_INVOICE を
 *       IKANの実務最適化プロンプトで上書きする
 */

import Anthropic from '@anthropic-ai/sdk';
import { InvoiceInfo } from './types';
import { sanitizeFileName, extractPages, parseJsonSafe } from './utils';

// ──────────────────────────────────────────────────────────
// プロンプト（IKANのプロンプトをここに差し替える）
// ──────────────────────────────────────────────────────────

const PROMPT_INVOICE = `このPDFには複数の請求書が含まれています。すべての請求書を特定し、以下のJSON形式のみで返答してください。説明文や前置きは一切不要です。JSONのみ出力してください。

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
- 純粋なJSONのみ返すこと。マークダウンのコードブロックも不要`;

// ──────────────────────────────────────────────────────────
// OCR処理
// ──────────────────────────────────────────────────────────

interface ClaudeInvoiceResponse {
  invoices: InvoiceInfo[];
}

export async function processInvoicePdf(
  pdfBuffer: Buffer,
  anthropic: Anthropic
): Promise<{ items: Array<InvoiceInfo & { fileName: string; pdfBase64: string }>; totalPages: number }> {
  const pdfBase64 = pdfBuffer.toString('base64');

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: PROMPT_INVOICE },
        ],
      },
    ],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('Claudeからの応答が不正です');
  }

  const claudeData = parseJsonSafe<ClaudeInvoiceResponse>(textContent.text);

  if (!claudeData.invoices || !Array.isArray(claudeData.invoices)) {
    throw new Error('請求書データの解析に失敗しました');
  }

  // 総ページ数を取得（pdf-libで）
  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();

  const items = await Promise.all(
    claudeData.invoices.map(async (invoice) => {
      const splitBuffer = await extractPages(
        pdfBuffer,
        invoice.pageStart || 1,
        invoice.pageEnd || invoice.pageStart || 1
      );

      const date = String(invoice.date || '不明');
      const requester = sanitizeFileName(String(invoice.requesterName || '不明'));
      const amount =
        invoice.taxIncludedAmount != null
          ? `${Number(invoice.taxIncludedAmount).toLocaleString()}円`
          : '金額不明';

      return {
        ...invoice,
        fileName: `${date}_${requester}_${amount}.pdf`,
        pdfBase64: splitBuffer.toString('base64'),
      };
    })
  );

  return { items, totalPages };
}
