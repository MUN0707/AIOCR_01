import { PDFDocument } from 'pdf-lib';

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 60);
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
