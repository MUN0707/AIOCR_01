import { PDFDocument } from 'pdf-lib';

export function sanitizeFileName(name: string): string {
  return stripTitleAndPersonName(name)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/_$/, '')
    .substring(0, 60);
}

/**
 * 役職名＋個人名を除去する。
 * 例: 「南アルプス市長 金丸一元」→「南アルプス市」
 *     「代表取締役 山田太郎」→ そのまま（組織名がない場合は除去しない）
 */
function stripTitleAndPersonName(name: string): string {
  // 「組織名 + 役職 + 個人名」パターン（役職以降を除去）
  const titlePattern = /^(.+?)\s*(?:市長|町長|村長|区長|知事|理事長|代表理事|会長|代表取締役|取締役|社長|副社長|院長|学長|校長|園長|局長|部長|課長|所長|センター長|事務局長|理事|監事|幹事)\s*.+$/;
  const match = name.match(titlePattern);
  if (match) {
    return match[1].trim();
  }
  return name;
}

/**
 * 和暦（令和・平成・昭和）を西暦に変換する。
 * 例: "令和7年" → "2025年", "令和5年分" → "2023年分", "平成30年" → "2018年"
 * 変換できなければそのまま返す。
 */
export function convertToSeireki(yearStr: string): string {
  const eraMap: Record<string, number> = {
    '令和': 2018,
    '平成': 1988,
    '昭和': 1925,
    '大正': 1911,
  };
  const match = yearStr.match(/^(令和|平成|昭和|大正)\s*(\d{1,2})\s*(年.*)/);
  if (match) {
    const base = eraMap[match[1]];
    const num = parseInt(match[2], 10);
    return `${base + num}${match[3]}`;
  }
  return yearStr;
}

export async function extractPages(
  pdfBuffer: Buffer,
  pageStart: number,
  pageEnd: number
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();
  const newPdf = await PDFDocument.create();

  const startIdx = Math.max(0, pageStart - 1);
  const endIdx = Math.min(totalPages - 1, pageEnd - 1);
  const indices = Array.from({ length: endIdx - startIdx + 1 }, (_, i) => startIdx + i);

  const copied = await newPdf.copyPages(pdfDoc, indices);
  copied.forEach((page) => newPdf.addPage(page));

  return Buffer.from(await newPdf.save());
}

export function parseJsonSafe<T>(raw: string): T {
  const cleaned = raw
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`JSON解析失敗: ${cleaned.substring(0, 300)}`);
    return JSON.parse(match[0]) as T;
  }
}
