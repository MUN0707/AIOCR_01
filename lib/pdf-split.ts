import { PDFDocument } from 'pdf-lib';

const MAX_CHUNK_BYTES = 3.5 * 1024 * 1024; // 3.5MB（4.5MB上限に余裕を持たせる）

/**
 * PDFファイルが大きすぎる場合、ページ単位で分割して複数のFileに分ける。
 * 各チャンクは MAX_CHUNK_BYTES 以下になるよう調整する。
 * 小さいファイルはそのまま [file] を返す。
 */
export async function splitPdfIfNeeded(file: File): Promise<File[]> {
  if (file.size <= MAX_CHUNK_BYTES) return [file];

  const arrayBuffer = await file.arrayBuffer();
  const srcDoc = await PDFDocument.load(arrayBuffer);
  const totalPages = srcDoc.getPageCount();

  if (totalPages <= 1) return [file]; // 1ページなら分割不可

  // 平均ページサイズから1チャンクあたりのページ数を推定
  const avgPageBytes = file.size / totalPages;
  const pagesPerChunk = Math.max(1, Math.floor(MAX_CHUNK_BYTES / avgPageBytes));

  const chunks: File[] = [];
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
    chunks.push(chunkFile);
  }

  return chunks;
}
