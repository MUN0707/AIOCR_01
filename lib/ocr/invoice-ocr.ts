/**
 * 法人請求書 OCR
 *
 * TODO: IKANのコードが届いたら、PROMPT_INVOICE を
 *       IKANの実務最適化プロンプトで上書きする
 */

import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { InvoiceInfo, DocumentCategory } from './types';
import { sanitizeFileName, extractPages, parseJsonSafe } from './utils';
import { calcCost, UsageInfo } from './cost';

/**
 * 画像を正位置に補正する。
 * EXIF Orientation があれば（JPEG等）それに従って自動回転する。
 * EXIF がない横長画像は回転しない — 横長フォーマットの請求書を誤回転させる
 * リスクがあるため、Claude Vision の画像認識に向き判定を委ねる。
 */
async function autoRotateImage(buffer: Buffer): Promise<{ data: Buffer; mime: string }> {
  // EXIF 自動回転のみ適用（引数なし rotate() = EXIF に従う）
  const img = sharp(buffer).rotate();

  const result = await img.toBuffer({ resolveWithObject: true });
  const formatMap: Record<string, string> = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  const mime = formatMap[result.info.format] || 'image/jpeg';
  return { data: result.data, mime };
}

// ──────────────────────────────────────────────────────────
// プロンプト（IKANのプロンプトをここに差し替える）
// ──────────────────────────────────────────────────────────

const PROMPT_INVOICE = `このPDFには複数の請求書または領収書が含まれています。すべての書類を特定し、以下のJSON形式のみで返答してください。説明文や前置きは一切不要です。JSONのみ出力してください。

{
  "invoices": [
    {
      "pageStart": 1,
      "pageEnd": 1,
      "date": "20240201",
      "requesterName": "株式会社〇〇",
      "taxIncludedAmount": 110000,
      "documentCategory": "invoice",
      "invoiceNumber": "T1234567890123"
    }
  ]
}

抽出ルール：
- pageStart / pageEnd：1始まりのページ番号（整数）
- date：請求日・発行日・領収日をYYYYMMDD形式。不明な場合は"不明"
- requesterName：請求書の場合は発行元の**組織名・屋号のみ**、領収書の場合は店名のみ。代表者名・市長名・理事長名など**役職名や個人名は含めない**（例: ✕「南アルプス市長 金丸一元」→ ○「南アルプス市」、✕「代表取締役 山田太郎」→ ○「株式会社〇〇」）。個人事業主の場合は屋号を優先し、屋号がなければ個人名可。不明な場合は"不明"
- taxIncludedAmount：税込合計金額（整数・円）。不明な場合はnull
- documentCategory："invoice"（請求書）または"receipt"（領収書）。書類のタイトルや体裁から判断する。「領収書」「領収証」「レシート」と記載があれば"receipt"、「請求書」「御請求書」と記載があれば"invoice"。判断できない場合は"invoice"
- invoiceNumber：適格請求書発行事業者の登録番号（T+13桁の数字）。記載がある場合のみ抽出。ない場合はnull
- 1つの請求書/領収書が複数ページにまたがる場合はpageStartとpageEndで範囲を示す
- 画像が90°横向き・斜め・上下逆に撮影されている場合でも、文字の向きを正しく判断して全項目を抽出すること。回転や傾きを理由に「不明」を返さず、画像全体を注意深く確認して社名・屋号を特定すること。特に横向き画像では文字を1文字ずつ慎重に読み取ること
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

const PROMPT_INVOICE_SINGLE = `このPDFを1件の請求書または領収書として扱い、以下のJSON形式のみで返答してください。説明文や前置きは一切不要です。JSONのみ出力してください。

{
  "date": "20240201",
  "requesterName": "株式会社〇〇",
  "taxIncludedAmount": 110000,
  "documentCategory": "invoice",
  "invoiceNumber": "T1234567890123",
  "withholdingTax": 10210,
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
- date：請求日・発行日・領収日をYYYYMMDD形式。不明な場合は"不明"
- requesterName：請求書の場合は発行元の**組織名・屋号のみ**、領収書の場合は店名のみ。代表者名・市長名・理事長名など**役職名や個人名は含めない**（例: ✕「南アルプス市長 金丸一元」→ ○「南アルプス市」、✕「代表取締役 山田太郎」→ ○「株式会社〇〇」）。個人事業主の場合は屋号を優先し、屋号がなければ個人名可。不明な場合は"不明"
- taxIncludedAmount：税込合計金額（整数・円）。必ず書類の合計額を入れる。不明な場合のみnull
- documentCategory："invoice"（請求書）または"receipt"（領収書）。書類のタイトルや体裁から判断する。「領収書」「領収証」「レシート」と記載があれば"receipt"、「請求書」「御請求書」と記載があれば"invoice"。判断できない場合は"invoice"
- invoiceNumber：適格請求書発行事業者の登録番号（T+13桁の数字）。記載がある場合のみ抽出。ない場合はnull
- withholdingTax：源泉徴収税額（整数・円）。**書類上に「源泉徴収税」「源泉税」「源泉所得税」「源泉徴収額」「源泉徴収」等の文言と金額が明示されている場合のみ**、その金額を抽出する。明示されていない場合は必ず null を返す。報酬・料金（士業報酬・原稿料・講演料・デザイン料・広告料等）でも、書類に源泉税の記載が無ければ null を返すこと。推測や自動計算はしない
- lines：明細行の配列。以下の場合は必ず2行以上に分けて返すこと：
  （a）勘定科目が明らかに異なる費目が混在（例：物品＋送料＋手数料、商品代＋通信費）
  （b）軽減税率8%と標準税率10%が混在している
  （c）非課税・不課税の費目が混ざっている（印紙代、保険料、立替金等）
  上記に該当せず1件で済む場合は lines は1要素の配列にする
  ※ 源泉徴収税は lines に含めない（withholdingTax に分離する）。lines の合計はあくまで taxIncludedAmount と一致させる
- lines[].debitAccount：借方勘定科目。代表的なもの：仕入高 / 消耗品費 / 事務用品費 / 通信費 / 旅費交通費 / 接待交際費 / 支払手数料 / 地代家賃 / 水道光熱費 / 租税公課 / 新聞図書費 / 雑費 / 支払報酬。判断つかない場合は"仕入高"
- lines[].amountInclTax：その行の税込金額（整数・円）。**全ての行の合計が taxIncludedAmount と完全一致する必要がある**
- lines[].taxType：課税仕入10% / 課税仕入8%(軽減) / 非課税 / 対象外 のいずれか
- lines[].description：その行の品目・内容を簡潔に（10文字程度）
- **【重要】画像の向きについて**: 画像が90°横向き（文字が左右に寝ている）・斜め・上下逆に撮影されている場合でも、文字の向きを正しく判断して全項目を抽出すること。手順: (1) まず画像内の文字がどの方向を向いているか特定する (2) その方向に沿って1文字ずつ慎重に読み取る (3) 読み取った文字列が日本語として自然かどうか確認する。回転や傾きを理由に「不明」を返さず、画像全体を注意深く確認して社名・屋号を特定すること。**横向き画像で別の書類の文字と混同しないよう、書類のヘッダー部分（「請求書」「御請求書」等のタイトル付近）に記載された社名を優先すること**
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
  documentCategory?: DocumentCategory;
  invoiceNumber?: string | null;
  withholdingTax?: number | null;
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
  withholdingTax: number | null;
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
): Promise<{ items: InvoiceSingleItem[]; totalPages: number; usage: UsageInfo }> {
  const pdfBase64 = pdfBuffer.toString('base64');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
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

  const withholdingTax =
    typeof claudeData.withholdingTax === 'number' && claudeData.withholdingTax > 0
      ? Math.round(claudeData.withholdingTax)
      : null;

  const docCat: DocumentCategory = claudeData.documentCategory === 'receipt' ? 'receipt' : 'invoice';
  const docLabel = docCat === 'receipt' ? '領収' : '請求';

  const item: InvoiceSingleItem = {
    pageStart: 1,
    pageEnd: totalPages,
    date: claudeData.date || '不明',
    requesterName: claudeData.requesterName || '不明',
    taxIncludedAmount: claudeData.taxIncludedAmount ?? null,
    documentCategory: docCat,
    invoiceNumber: claudeData.invoiceNumber || null,
    fileName: `${docLabel}_${date}_${requester}_${amount}.pdf`,
    pdfBase64,
    withholdingTax,
    lines: finalLines,
  };

  const usage = calcCost(response.usage.input_tokens, response.usage.output_tokens);
  return { items: [item], totalPages, usage };
}

// ──────────────────────────────────────────────────────────
// 画像ファイル対応（PNG / JPEG / WebP / HEIC）
// ──────────────────────────────────────────────────────────

export async function processInvoiceImage(
  imageBuffer: Buffer,
  mimeType: string,
  anthropic: Anthropic,
  originalFileName?: string
): Promise<{ items: InvoiceSingleItem[]; usage: UsageInfo }> {
  // EXIF Orientation に従って自動回転（スマホ横撮り・上下逆を補正）
  const rotated = await autoRotateImage(imageBuffer);
  const imageBase64 = rotated.data.toString('base64');

  // 回転後の MIME タイプを使用
  const mediaType = rotated.mime as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
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

  const date = String(claudeData.date || '不明');
  const requester = sanitizeFileName(String(claudeData.requesterName || '不明'));
  const amount =
    claudeData.taxIncludedAmount != null
      ? `${Number(claudeData.taxIncludedAmount).toLocaleString()}円`
      : '金額不明';

  // 明細の整形
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
  // 画像OCRは精度が落ちるため、明細合計の不一致ではエラーにせず
  // ヘッダー金額を信頼して単一行にフォールバックする
  let finalLines: InvoiceSingleItem['lines'];
  if (normalizedLines.length > 1 && typeof headerAmount === 'number') {
    const linesSum = normalizedLines.reduce((acc, l) => acc + l.amountInclTax, 0);
    if (linesSum !== headerAmount) {
      // 不一致 → 単一行にフォールバック（画像OCRでは厳密な明細分割より全体の結果を優先）
      console.warn(`画像OCR明細合計不一致: header=${headerAmount}, lines=${linesSum}, file=${originalFileName}`);
      finalLines = [
        {
          debitAccount: normalizedLines[0]?.debitAccount || '仕入高',
          amountInclTax: headerAmount,
          taxType: normalizedLines[0]?.taxType || '課税仕入10%',
          description: claudeData.requesterName || '',
        },
      ];
    } else {
      finalLines = normalizedLines;
    }
  } else if (normalizedLines.length > 0) {
    finalLines = normalizedLines;
  } else {
    finalLines = [
      {
        debitAccount: '仕入高',
        amountInclTax: typeof headerAmount === 'number' ? headerAmount : 0,
        taxType: '課税仕入10%',
        description: claudeData.requesterName || '',
      },
    ];
  }

  const withholdingTax =
    typeof claudeData.withholdingTax === 'number' && claudeData.withholdingTax > 0
      ? Math.round(claudeData.withholdingTax)
      : null;

  const docCat: DocumentCategory = claudeData.documentCategory === 'receipt' ? 'receipt' : 'invoice';
  const docLabel = docCat === 'receipt' ? '領収' : '請求';

  // 元の拡張子を保持
  const ext = (originalFileName?.split('.').pop() || 'jpg').toLowerCase();

  const item: InvoiceSingleItem = {
    pageStart: 1,
    pageEnd: 1,
    date: claudeData.date || '不明',
    requesterName: claudeData.requesterName || '不明',
    taxIncludedAmount: claudeData.taxIncludedAmount ?? null,
    documentCategory: docCat,
    invoiceNumber: claudeData.invoiceNumber || null,
    fileName: `${docLabel}_${date}_${requester}_${amount}.${ext}`,
    pdfBase64: imageBase64, // 画像データをそのまま返す
    withholdingTax,
    lines: finalLines,
  };

  const usage = calcCost(response.usage.input_tokens, response.usage.output_tokens);
  return { items: [item], usage };
}

export async function processInvoicePdf(
  pdfBuffer: Buffer,
  anthropic: Anthropic,
  options?: { skipPdfExtraction?: boolean; pageOffset?: number }
): Promise<{ items: Array<InvoiceInfo & { fileName: string; pdfBase64: string }>; totalPages: number; usage: UsageInfo }> {
  const pdfBase64 = pdfBuffer.toString('base64');
  const pageOffset = options?.pageOffset ?? 0;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
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
      const pStart = (invoice.pageStart || 1) + pageOffset;
      const pEnd = (invoice.pageEnd || invoice.pageStart || 1) + pageOffset;

      let splitBase64 = '';
      if (!options?.skipPdfExtraction) {
        const splitBuffer = await extractPages(pdfBuffer, pStart - pageOffset, pEnd - pageOffset);
        splitBase64 = splitBuffer.toString('base64');
      }

      const date = String(invoice.date || '不明');
      const requester = sanitizeFileName(String(invoice.requesterName || '不明'));
      const amount =
        invoice.taxIncludedAmount != null
          ? `${Number(invoice.taxIncludedAmount).toLocaleString()}円`
          : '金額不明';
      const docCat: DocumentCategory = invoice.documentCategory === 'receipt' ? 'receipt' : 'invoice';
      const docLabel = docCat === 'receipt' ? '領収' : '請求';

      return {
        ...invoice,
        pageStart: pStart,
        pageEnd: pEnd,
        documentCategory: docCat,
        invoiceNumber: invoice.invoiceNumber || null,
        fileName: `${docLabel}_${date}_${requester}_${amount}.pdf`,
        pdfBase64: splitBase64,
      };
    })
  );

  const usage = calcCost(response.usage.input_tokens, response.usage.output_tokens);
  return { items, totalPages, usage };
}
