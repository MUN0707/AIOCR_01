/**
 * 確定申告書 OCR
 *
 * TODO: IKANの確定申告OCRコードが届いたら、
 *       PROMPT_TAX_RETURN と抽出ロジックをIKANのものに差し替える
 */

import Anthropic from '@anthropic-ai/sdk';
import { TaxReturnInfo } from './types';
import { sanitizeFileName, extractPages, parseJsonSafe } from './utils';
import { calcCost, UsageInfo } from './cost';

// ──────────────────────────────────────────────────────────
// プロンプト（IKANのプロンプトをここに差し替える）
// ──────────────────────────────────────────────────────────

const PROMPT_TAX_RETURN = `このPDFには確定申告関連書類が含まれています。すべての書類を特定し、以下のJSON形式のみで返答してください。説明文は一切不要です。JSONのみ出力してください。

{
  "documents": [
    {
      "pageStart": 1,
      "pageEnd": 2,
      "year": "令和5年分",
      "taxpayerName": "山田太郎",
      "documentType": "確定申告書B",
      "totalIncome": 5000000,
      "taxPayable": 120000
    }
  ]
}

抽出ルール：
- pageStart / pageEnd：1始まりのページ番号（整数）
- year：申告年度（例: "令和5年分" "2023年分"）。不明な場合は"不明"
- taxpayerName：納税者（申告者）の氏名。不明な場合は"不明"
- documentType：書類の種別。以下から最も近いものを選ぶ:
  "確定申告書A", "確定申告書B", "青色申告決算書", "収支内訳書",
  "医療費控除明細書", "寄附金控除証明書", "源泉徴収票", "その他"
- totalIncome：総所得金額または売上金額（整数・円）。不明な場合はnull
- taxPayable：納付すべき所得税額（整数・円）。不明な場合はnull
- 1つの書類が複数ページにまたがる場合はpageStartとpageEndで範囲を示す
- 純粋なJSONのみ返すこと。マークダウンのコードブロックも不要`;

// ──────────────────────────────────────────────────────────
// OCR処理
// ──────────────────────────────────────────────────────────

interface ClaudeTaxReturnResponse {
  documents: TaxReturnInfo[];
}

export async function processTaxReturnPdf(
  pdfBuffer: Buffer,
  anthropic: Anthropic
): Promise<{ items: Array<TaxReturnInfo & { fileName: string; pdfBase64: string }>; totalPages: number; usage: UsageInfo }> {
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
          { type: 'text', text: PROMPT_TAX_RETURN },
        ],
      },
    ],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('Claudeからの応答が不正です');
  }

  const claudeData = parseJsonSafe<ClaudeTaxReturnResponse>(textContent.text);

  if (!claudeData.documents || !Array.isArray(claudeData.documents)) {
    throw new Error('確定申告データの解析に失敗しました');
  }

  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();

  const items = await Promise.all(
    claudeData.documents.map(async (doc) => {
      const splitBuffer = await extractPages(
        pdfBuffer,
        doc.pageStart || 1,
        doc.pageEnd || doc.pageStart || 1
      );

      const year = sanitizeFileName(String(doc.year || '不明'));
      const name = sanitizeFileName(String(doc.taxpayerName || '不明'));
      const type = sanitizeFileName(String(doc.documentType || 'その他'));

      return {
        ...doc,
        fileName: `${year}_${name}_${type}.pdf`,
        pdfBase64: splitBuffer.toString('base64'),
      };
    })
  );

  const usage = calcCost(response.usage.input_tokens, response.usage.output_tokens);
  return { items, totalPages, usage };
}
