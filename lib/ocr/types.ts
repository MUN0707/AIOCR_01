// ============================================================
// 共通型定義 - 法人請求書 / 確定申告 両方で使用
// ============================================================

export type OcrMode = 'invoice' | 'tax-return';

// ──────────────────────────────────────────────────────────
// 法人請求書
// ──────────────────────────────────────────────────────────

export interface InvoiceInfo {
  pageStart: number;
  pageEnd: number;
  date: string;           // YYYYMMDD or "不明"
  requesterName: string;  // 請求元（発行者）
  taxIncludedAmount: number | null;
}

export interface InvoiceResult extends InvoiceInfo {
  index: number;
  fileName: string;
  pdfBase64: string;
  sourceFile: string;
}

// ──────────────────────────────────────────────────────────
// 確定申告
// ──────────────────────────────────────────────────────────

export interface TaxReturnInfo {
  pageStart: number;
  pageEnd: number;
  year: string;             // 申告年度 (e.g. "令和5年分" or "2023")
  taxpayerName: string;     // 納税者氏名
  documentType: string;     // 書類種別 (e.g. "確定申告書B", "青色申告決算書")
  totalIncome: number | null;      // 総所得金額
  taxPayable: number | null;       // 納付税額
}

export interface TaxReturnResult extends TaxReturnInfo {
  index: number;
  fileName: string;
  pdfBase64: string;
  sourceFile: string;
}

// ──────────────────────────────────────────────────────────
// API レスポンス共通
// ──────────────────────────────────────────────────────────

export interface OcrApiResponse<T> {
  items: T[];
  totalPages: number;
}
