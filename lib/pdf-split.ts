import { PDFDocument } from 'pdf-lib';

const MAX_CHUNK_BYTES = 3.5 * 1024 * 1024; // 3.5MB（4.5MB上限に余裕を持たせる）
const MAX_PAGES_PER_CHUNK = 10; // Claude APIの処理時間・出力トークン上限を考慮

export interface PdfChunk {
  file: File;
  /** このチャンクの最初のページが、元PDFの何ページ目か（0始まり） */
  pageOffset: number;
}

/**
 * PDFファイルが大きすぎる場合やページ数が多い場合、
 * ページ単位で分割して複数のFileに分ける。
 * - ファイルサイズ: MAX_CHUNK_BYTES 以下
 * - ページ数: MAX_PAGES_PER_CHUNK 以下
 * の両方を満たすよう分割する。
 */
export async function splitPdfIfNeeded(file: File): Promise<PdfChunk[]> {
  const arrayBuffer = await file.arrayBuffer();
  const srcDoc = await PDFDocument.load(arrayBuffer);
  const totalPages = srcDoc.getPageCount();

  if (totalPages <= 1) return [{ file, pageOffset: 0 }];

  // サイズ基準のページ数
  const avgPageBytes = file.size / totalPages;
  const pagesBySize = Math.max(1, Math.floor(MAX_CHUNK_BYTES / avgPageBytes));

  // サイズとページ数の両方の上限を満たす方を採用
  const pagesPerChunk = Math.min(pagesBySize, MAX_PAGES_PER_CHUNK);

  // 分割不要ならそのまま返す
  if (pagesPerChunk >= totalPages) return [{ file, pageOffset: 0 }];

  const chunks: PdfChunk[] = [];
  for (let start = 0; start < totalPages; start += pagesPerChunk) {
    const end = Math.min(start + pagesPerChunk, totalPages);
    const chunkDoc = await PDFDocument.create();
    const pages = await chunkDoc.copyPages(srcDoc, Array.from({ length: end - start }, (_, i) => start + i));
    for (const page of pages) chunkDoc.addPage(page);
    const chunkBytes = await chunkDoc.save();

    const partLabel = chunks.length + 1;
    const chunkFile = new File(
      [chunkBytes.buffer as ArrayBuffer],
      file.name.replace(/\.pdf$/i, `_part${partLabel}.pdf`),
      { type: 'application/pdf' },
    );
    chunks.push({ file: chunkFile, pageOffset: start });
  }

  return chunks;
}
