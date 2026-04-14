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

// ──────────────────────────────────────────────────────────
// 単一請求書モード（自動仕訳用：分割しない）
// ──────────────────────────────────────────────────────────

const PROMPT_INVOICE_SINGLE = `このPDFを1件の請求書として扱い、以下のJSON形式のみで返答してください。説明文や前置きは一切不要です。JSONのみ出力してください。

{
  "date": "20240201",
  "requesterName": "株式会社〇〇",
  "taxIncludedAmount": 110000,
  "lines": [
    {
      "debitAccount": "仕入高",
      "amountInclTax": 55000,
      "taxType": "課税仕入10%",
      "description": "商品A"
    },
    {
      "debitAccount": "通信費",
      "amountInclTax": 55000,
      "taxType": "課税仕入10%",
      "description": "回線利用料"
    }
  ]
}

抽出ルール：
- date：請求日または発行日をYYYYMMDD形式。不明な場合は"不明"
- requesterName：請求書を発行した会社名または個人名（請求元）。不明な場合は"不明"
- taxIncludedAmount：税込合計金額（整数・円）。必ず請求書の合計額を入れる。不明な場合のみnull
- lines：明細行の配列。以下の場合は必ず2行以上に分けて返すこと：
  （a）勘定科目が明らかに異なる費目が混在（例：物品＋送料＋手数料、商品代＋通信費）
  （b）軽減税率8%と標準税率10%が混在している
  （c）非課税・不課税の費目が混ざっている（印紙代、保険料、立替金等）
  上記に該当せず1件で済む場合は lines は1要素の配列にする
- lines[].debitAccount：借方勘定科目。代表的なもの：仕入高 / 消耗品費 / 事務用品費 / 通信費 / 旅費交通費 / 接待交際費 / 支払手数料 / 地代家賃 / 水道光熱費 / 租税公課 / 新聞図書費 / 雑費。判断つかない場合は"仕入高"
- lines[].amountInclTax：その行の税込金額（整数・円）。**全ての行の合計が taxIncludedAmount と完全一致する必要がある**
- lines[].taxType：課税仕入10% / 課税仕入8%(軽減) / 非課税 / 対象外 のいずれか
- lines[].description：その行の品目・内容を簡潔に（10文字程度）
- 純粋なJSONのみ返すこと。マークダウンのコードブロックも不要`;

interface ClaudeLine {
  debitAccount?: string;
  amountInclTax?: number | null;
  taxType?: string;
  description?: string;
}

interface ClaudeInvoiceSingleResponse {
  date?: string;
  requesterName?: string;
  taxIncludedAmount?: number | null;
  lines?: ClaudeLine[];
}

/**
 * 明細合計 ≠ 税込合計 の場合のエラー。
 * フロント側でスクショ依頼モーダルに誘導するため、メタ情報を保持する。
 */
export class InvoiceLineSumMismatchError extends Error {
  constructor(
    public readonly taxIncludedAmount: number,
    public readonly linesSum: number,
    public readonly fileName: string | undefined,
    public readonly lines: Array<{ debitAccount: string; amountInclTax: number; description: string }>
  ) {
    super(
      `明細合計(¥${linesSum.toLocaleString()}) が税込合計(¥${taxIncludedAmount.toLocaleString()}) と一致しません`
    );
    this.name = 'InvoiceLineSumMismatchError';
  }
}

export interface InvoiceSingleItem extends InvoiceInfo {
  fileName: string;
  pdfBase64: string;
  lines: Array<{
    debitAccount: string;
    amountInclTax: number;
    taxType: string;
    description: string;
  }>;
}

export async function processInvoicePdfSingle(
  pdfBuffer: Buffer,
  anthropic: Anthropic,
  originalFileName?: string
): Promise<{ items: InvoiceSingleItem[]; totalPages: number }> {
  const pdfBase64 = pdfBuffer.toString('base64');

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: PROMPT_INVOICE_SINGLE },
        ],
      },
    ],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('Claudeからの応答が不正です');
  }

  const claudeData = parseJsonSafe<ClaudeInvoiceSingleResponse>(textContent.text);

  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();

  const date = String(claudeData.date || '不明');
  const requester = sanitizeFileName(String(claudeData.requesterName || '不明'));
  const amount =
    claudeData.taxIncludedAmount != null
      ? `${Number(claudeData.taxIncludedAmount).toLocaleString()}円`
      : '金額不明';

  // ─── 明細の整形と合計バリデーション ───────────────────────────
  // Claudeが返した行を正規化。空配列なら単一行（不明）として扱う。
  const rawLines = Array.isArray(claudeData.lines) ? claudeData.lines : [];
  const normalizedLines = rawLines
    .map((l) => ({
      debitAccount: String(l.debitAccount ?? '仕入高').trim() || '仕入高',
      amountInclTax: typeof l.amountInclTax === 'number' ? Math.round(l.amountInclTax) : NaN,
      taxType: String(l.taxType ?? '課税仕入10%').trim() || '課税仕入10%',
      description: String(l.description ?? '').trim(),
    }))
    .filter((l) => Number.isFinite(l.amountInclTax));

  const headerAmount = claudeData.taxIncludedAmount;
  // 明細が複数あり、税込合計が判明している場合のみ厳密チェック
  if (normalizedLines.length > 1 && typeof headerAmount === 'number') {
    const linesSum = normalizedLines.reduce((acc, l) => acc + l.amountInclTax, 0);
    if (linesSum !== headerAmount) {
      throw new InvoiceLineSumMismatchError(
        headerAmount,
        linesSum,
        originalFileName,
        normalizedLines.map((l) => ({
          debitAccount: l.debitAccount,
          amountInclTax: l.amountInclTax,
          description: l.description,
        }))
      );
    }
  }

  // 単一行で確定するケース：Claude が lines を返さなかった or 1要素のみ
  const finalLines: InvoiceSingleItem['lines'] =
    normalizedLines.length > 0
      ? normalizedLines
      : [
          {
            debitAccount: '仕入高',
            amountInclTax: typeof headerAmount === 'number' ? headerAmount : 0,
            taxType: '課税仕入10%',
            description: claudeData.requesterName || '',
          },
        ];

  const item: InvoiceSingleItem = {
    pageStart: 1,
    pageEnd: totalPages,
    date: claudeData.date || '不明',
    requesterName: claudeData.requesterName || '不明',
    taxIncludedAmount: claudeData.taxIncludedAmount ?? null,
    fileName: `${date}_${requester}_${amount}.pdf`,
    pdfBase64,
    lines: finalLines,
  };

  return { items: [item], totalPages };
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
