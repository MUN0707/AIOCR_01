// ============================================================
// 共通型定義 - 法人請求書 / 確定申告 両方で使用
// ============================================================

export type OcrMode = 'invoice' | 'tax-return' | 'bank-statement';

// ──────────────────────────────────────────────────────────
// 法人請求書
// ──────────────────────────────────────────────────────────

export type DocumentCategory = 'invoice' | 'receipt';

export interface InvoiceInfo {
  pageStart: number;
  pageEnd: number;
  date: string;           // YYYYMMDD or "不明"
  requesterName: string;  // 請求元（発行者）/ 領収書の場合は店名
  taxIncludedAmount: number | null;
  documentCategory: DocumentCategory;  // 請求書 or 領収書
  invoiceNumber: string | null;        // インボイス番号（T+13桁）
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
// 通帳OCR
// ──────────────────────────────────────────────────────────

export interface BankTransaction {
  date: string;           // YYYYMMDD or "不明"
  description: string;   // 摘要・取引内容
  debit: number | null;  // 出金（引出し）
  credit: number | null; // 入金（預入れ）
  balance: number | null; // 残高
}

export interface BankStatementInfo {
  bankName: string;       // 銀行名 (例: "三菱UFJ銀行")
  accountNumber: string;  // 口座番号（下4桁など一部のみ）
  transactions: BankTransaction[];
}

// ──────────────────────────────────────────────────────────
// 自動仕訳
// ──────────────────────────────────────────────────────────

export interface JournalEntry {
  date: string;           // YYYYMMDD or "不明"
  debitAccount: string;   // 借方勘定科目
  creditAccount: string;  // 貸方勘定科目
  amount: number | null;  // 金額（円）
  description: string;   // 摘要
  taxType: string;        // 消費税区分 (課税仕入・非課税・対象外 etc.)
}

// ──────────────────────────────────────────────────────────
// API レスポンス共通
// ──────────────────────────────────────────────────────────

export interface OcrApiResponse<T> {
  items: T[];
  totalPages: number;
}
