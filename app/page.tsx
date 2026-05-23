'use client';

import { useState, useRef, useCallback, useEffect, useMemo, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { createClient } from '@/utils/supabase/client';
import type { User } from '@supabase/supabase-js';
import type { OcrMode } from '@/lib/ocr/types';
import type { MatchResult, MatchSummary, VoucherInput, TransactionInput } from '@/lib/ocr/journal-matcher';
import { CSV_PRESETS, parseCsvWithPreset, type NormalizedJournalRow } from '@/lib/csv-import-presets';
import { splitPdfIfNeeded, type PdfChunk } from '@/lib/pdf-split';
import { findSimilarPairs, type SimilarPair } from '@/lib/similarity';
import {
  isFixedAssetAccountName,
  isSmallAssetAmount,
  SMALL_ASSET_ADVICE_SHORT,
  SMALL_ASSET_ADVICE_DETAIL,
} from '@/lib/small-asset-advice';
import { JournalSidebarNav } from '@/components/JournalSidebarNav';
import Link from 'next/link';
import { normalizeVendorKey } from '@/lib/vendor-normalize';

// ─── 型定義 ────────────────────────────────────────────────────────────────

interface ClientItem {
  id: string;
  name: string;
  client_type: string;
  industry: string | null;
  company_code: string | null;
  legal_name: string | null;
  short_name: string | null;
  invoice_registration_number: string | null;
  created_at: string;
}

function clientDisplayLabel(c: { name: string; company_code: string | null; short_name: string | null }): string {
  const code = c.company_code?.trim();
  const short = c.short_name?.trim();
  if (code && short) return `${code} ${short}`;
  if (code) return `${code} ${c.name}`;
  if (short) return short;
  return c.name;
}

interface InvoiceResult {
  index: number;
  pageStart: number;
  pageEnd: number;
  // 請求書・領収書フィールド
  date?: string;
  requesterName?: string;
  taxIncludedAmount?: number | null;
  documentCategory?: 'invoice' | 'receipt';
  invoiceNumber?: string | null;
  // 確定申告フィールド
  year?: string;
  taxpayerName?: string;
  documentType?: string;
  totalIncome?: number | null;
  taxPayable?: number | null;
  // 共通
  fileName: string;
  pdfBase64: string;
  sourceFile: string;
}

interface BankTransactionRow {
  date: string;
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  sourceFile: string;
}

type ProcessResult =
  | { mode: 'invoice' | 'tax-return'; invoices: InvoiceResult[]; totalPages: number; processedFiles: number; totalCostJpy: number; totalInputTokens: number; totalOutputTokens: number }
  | { mode: 'bank-statement'; bankName: string; accountNumber: string; transactions: BankTransactionRow[]; totalPages: number; processedFiles: number; totalCostJpy: number; totalInputTokens: number; totalOutputTokens: number };

interface LedgerEntry {
  id: string;
  user_id: string;
  client_id: string | null;
  log_id: string | null;
  entry_type: 'accrual' | 'payment' | 'manual';
  entry_date: string;
  debit_account: string;
  credit_account: string;
  amount: number | null;
  debit_amount?: number | null;
  credit_amount?: number | null;
  tax_amount?: number | null;
  tax_rate?: string | null;
  is_internal_tax?: boolean | null;
  description: string;
  tax_type: string;
  tax_category?: string | null;
  department_id?: string | null;
  vendor_name: string;
  match_status: string;
  created_at: string;
  updated_at: string;
  locked: boolean;
  ocr_upload_id: string | null;
  bank_ocr_upload_id: string | null;
  voucher_group_id?: string | null;
  voucher_seq?: number | null;
  voucher_total_lines?: number | null;
  meta?: Record<string, string> | null;
  approval_status?: string | null;
}

const TAX_CATEGORY_LABELS: Record<string, string> = {
  taxable_sales: '課税売上',
  tax_exempt_sales: '非課税売上',
  taxable_purchase: '課税仕入',
  non_taxable: '免税・不課税',
};

const TAX_CATEGORY_COLORS: Record<string, string> = {
  taxable_sales: 'bg-sky-100 text-sky-700',
  tax_exempt_sales: 'bg-slate-100 text-slate-600',
  taxable_purchase: 'bg-lime-100 text-lime-700',
  non_taxable: 'bg-amber-100 text-amber-700',
};

async function openJournalPdf(entryId: string, source: 'invoice' | 'bank' = 'invoice'): Promise<void> {
  try {
    const res = await fetch(`/api/journal-pdf?entryId=${entryId}&source=${source}`);
    if (!res.ok) {
      alert('PDFが取得できませんでした');
      return;
    }
    const data = await res.json();
    if (data.pdfUrl) {
      window.open(data.pdfUrl, '_blank', 'noopener,noreferrer');
    }
  } catch {
    alert('PDFの取得に失敗しました');
  }
}

// ─── ユーティリティ ────────────────────────────────────────────────────────

function mimeFromFileName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  return 'application/pdf';
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const bytes = atob(base64);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    array[i] = bytes.charCodeAt(i);
  }
  return new Blob([array], { type: mimeType });
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCsv(rows: string[][], fileName: string) {
  const bom = '\uFEFF';
  const csv = bom + rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, fileName);
}

const GUEST_MAX_USES = 5;

/** YYYYMMDD の月末化（不明/不正はそのまま） */
function toMonthEndClient(ymd: string): string {
  if (!ymd || ymd === '不明') return ymd;
  const c = ymd.replace(/[-/]/g, '');
  if (c.length !== 8) return ymd;
  const y = parseInt(c.slice(0, 4), 10);
  const m = parseInt(c.slice(4, 6), 10);
  if (!y || !m) return ymd;
  const last = new Date(y, m, 0).getDate();
  return `${y}${String(m).padStart(2, '0')}${String(last).padStart(2, '0')}`;
}

// ─── SVG アイコン（line スタイル・装飾なし） ────────────────────────────────

/** クラウドアップロードアイコン */
const IconUpload = ({ className = 'w-10 h-10' }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="16 16 12 12 8 16" />
    <line x1="12" y1="12" x2="12" y2="21" />
    <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
  </svg>
);

/** ドキュメントアイコン */
const IconFile = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

/** ダウンロードアイコン */
const IconDownload = ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

/** チェックアイコン */
const IconCheck = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/** 閉じる（×）アイコン */
const IconX = ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

/** 鍵アイコン */
const IconLock = ({ className = 'w-8 h-8' }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0110 0v4" />
  </svg>
);

/** 警告アイコン */
const IconAlertCircle = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

/** ZIPアーカイブアイコン */
const IconArchive = ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="21 8 21 21 3 21 3 8" />
    <rect x="1" y="3" width="22" height="5" />
    <line x1="10" y1="12" x2="14" y2="12" />
  </svg>
);

// ─── テーブル行（法人請求書） ─────────────────────────────────────────────────

function InvoiceRow({
  invoice,
  onDownload,
}: {
  invoice: InvoiceResult;
  onDownload: () => void;
}) {
  const isUnknownDate = !invoice.date || invoice.date === '不明';
  const isUnknownName = !invoice.requesterName || invoice.requesterName === '不明';

  const isReceipt = invoice.documentCategory === 'receipt';

  return (
    <tr className="group hover:bg-sky-50/40 transition-colors duration-150">
      <td className="px-5 py-4 text-slate-300 font-mono text-xs tabular-nums">
        {String(invoice.index).padStart(2, '0')}
      </td>
      <td className="px-5 py-4">
        <span className="text-[11px] font-mono text-slate-400 bg-slate-100 px-2 py-1 rounded-md tracking-wide">
          {invoice.pageStart === invoice.pageEnd
            ? `p${invoice.pageStart}`
            : `p${invoice.pageStart}–${invoice.pageEnd}`}
        </span>
      </td>
      <td className="px-5 py-4">
        <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${
          isReceipt
            ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
            : 'bg-sky-50 text-sky-600 border border-sky-200'
        }`}>
          {isReceipt ? '領収書' : '請求書'}
        </span>
      </td>
      <td className="px-5 py-4">
        <span className={`text-sm font-medium tracking-wide ${isUnknownDate ? 'text-amber-400' : 'text-slate-700'}`}>
          {isUnknownDate ? '—' : invoice.date}
        </span>
      </td>
      <td className="px-5 py-4 max-w-[200px]">
        <span className={`text-sm block truncate ${isUnknownName ? 'text-amber-400' : 'text-slate-800 font-medium'}`}>
          {isUnknownName ? '—' : invoice.requesterName}
        </span>
      </td>
      <td className="px-5 py-4 text-right">
        {invoice.taxIncludedAmount != null ? (
          <span className="text-base font-semibold text-slate-900 tabular-nums tracking-tight">
            ¥{invoice.taxIncludedAmount.toLocaleString()}
          </span>
        ) : (
          <span className="text-amber-400 text-sm">—</span>
        )}
      </td>
      <td className="px-5 py-4 hidden xl:table-cell">
        <span className="text-[11px] text-slate-400 font-mono">
          {invoice.invoiceNumber || '—'}
        </span>
      </td>
      <td className="px-5 py-4 hidden lg:table-cell">
        <span className="text-[11px] text-slate-300 font-mono truncate block max-w-[120px]" title={invoice.fileName}>
          {invoice.fileName}
        </span>
      </td>
      <td className="px-5 py-4 text-center sticky right-0 bg-white group-hover:bg-sky-50/40">
        <button
          onClick={onDownload}
          aria-label={`${invoice.fileName} をダウンロード`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
            bg-sky-400 text-white text-xs font-medium
            hover:bg-sky-500 hover:-translate-y-px active:translate-y-0
            transition-all duration-150 shadow-sm shadow-sky-200/60"
        >
          <IconDownload />
          <span className="hidden sm:inline">DL</span>
        </button>
      </td>
    </tr>
  );
}

// ─── テーブル行（確定申告） ─────────────────────────────────────────────────────

function TaxReturnRow({
  invoice,
  onDownload,
}: {
  invoice: InvoiceResult;
  onDownload: () => void;
}) {
  const isUnknownYear = !invoice.year || invoice.year === '不明';
  const isUnknownName = !invoice.taxpayerName || invoice.taxpayerName === '不明';

  return (
    <tr className="group hover:bg-sky-50/40 transition-colors duration-150">
      <td className="px-5 py-4 text-slate-300 font-mono text-xs tabular-nums">
        {String(invoice.index).padStart(2, '0')}
      </td>
      <td className="px-5 py-4">
        <span className="text-[11px] font-mono text-slate-400 bg-slate-100 px-2 py-1 rounded-md tracking-wide">
          {invoice.pageStart === invoice.pageEnd
            ? `p${invoice.pageStart}`
            : `p${invoice.pageStart}–${invoice.pageEnd}`}
        </span>
      </td>
      <td className="px-5 py-4">
        <span className={`text-sm font-medium ${isUnknownYear ? 'text-amber-400' : 'text-slate-700'}`}>
          {isUnknownYear ? '—' : invoice.year}
        </span>
      </td>
      <td className="px-5 py-4 max-w-[140px]">
        <span className={`text-sm block truncate ${isUnknownName ? 'text-amber-400' : 'text-slate-800 font-medium'}`}>
          {isUnknownName ? '—' : invoice.taxpayerName}
        </span>
      </td>
      <td className="px-5 py-4">
        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-md">
          {invoice.documentType || '—'}
        </span>
      </td>
      <td className="px-5 py-4 text-right">
        {invoice.totalIncome != null ? (
          <span className="text-sm font-semibold text-slate-900 tabular-nums">
            ¥{invoice.totalIncome.toLocaleString()}
          </span>
        ) : (
          <span className="text-amber-400 text-sm">—</span>
        )}
      </td>
      <td className="px-5 py-4 hidden lg:table-cell">
        <span className="text-[11px] text-slate-300 font-mono truncate block max-w-[120px]" title={invoice.fileName}>
          {invoice.fileName}
        </span>
      </td>
      <td className="px-5 py-4 text-center sticky right-0 bg-white group-hover:bg-sky-50/40">
        <button
          onClick={onDownload}
          aria-label={`${invoice.fileName} をダウンロード`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
            bg-sky-400 text-white text-xs font-medium
            hover:bg-sky-500 hover:-translate-y-px active:translate-y-0
            transition-all duration-150 shadow-sm shadow-sky-200/60"
        >
          <IconDownload />
          <span className="hidden sm:inline">DL</span>
        </button>
      </td>
    </tr>
  );
}

// ─── テーブル行（通帳OCR） ─────────────────────────────────────────────────────

function BankRow({ row, index }: { row: BankTransactionRow; index: number }) {
  return (
    <tr className="group hover:bg-sky-50/40 transition-colors duration-150">
      <td className="px-5 py-3 text-slate-300 font-mono text-xs tabular-nums">
        {String(index).padStart(2, '0')}
      </td>
      <td className="px-5 py-3">
        <span className={`text-sm font-mono ${row.date === '不明' ? 'text-amber-400' : 'text-slate-600'}`}>
          {row.date === '不明' ? '—' : `${row.date.slice(0, 4)}/${row.date.slice(4, 6)}/${row.date.slice(6, 8)}`}
        </span>
      </td>
      <td className="px-5 py-3 max-w-[200px]">
        <span className="text-sm text-slate-700 block truncate">{row.description || '—'}</span>
      </td>
      <td className="px-5 py-3 text-right">
        {row.debit != null ? (
          <span className="text-sm font-semibold text-red-500 tabular-nums">
            ▼ ¥{row.debit.toLocaleString()}
          </span>
        ) : (
          <span className="text-slate-200 text-sm">—</span>
        )}
      </td>
      <td className="px-5 py-3 text-right">
        {row.credit != null ? (
          <span className="text-sm font-semibold text-emerald-500 tabular-nums">
            ▲ ¥{row.credit.toLocaleString()}
          </span>
        ) : (
          <span className="text-slate-200 text-sm">—</span>
        )}
      </td>
      <td className="px-5 py-3 text-right">
        {row.balance != null ? (
          <span className="text-sm text-slate-600 tabular-nums">¥{row.balance.toLocaleString()}</span>
        ) : (
          <span className="text-slate-200 text-sm">—</span>
        )}
      </td>
    </tr>
  );
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function Home() {
  const router = useRouter();
  const supabase = createClient();

  // ─── State ───────────────────────────────────────────────────────────────
  type AppMode = OcrMode | 'journal-entry' | 'financial-statement';
  const [mode, setMode] = useState<AppMode>('invoice');
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [processingIndex, setProcessingIndex] = useState(0);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // undefined = 初期ロード中 / null = ゲスト / User = ログイン済み
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [guestLimitReached, setGuestLimitReached] = useState(false);
  const [usageInfo, setUsageInfo] = useState<{ count: number; limit: number } | null>(null);
  const [fingerprintId, setFingerprintId] = useState<string | null>(null);

  // ─── クライアント管理 State ─────────────────────────────────────────────────
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [showClientModal, setShowClientModal] = useState(false);
  const [newClientForm, setNewClientForm] = useState({ company_code: '', name: '', legal_name: '', short_name: '', invoice_registration_number: '' });
  const [clientSaving, setClientSaving] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [editingClientForm, setEditingClientForm] = useState({ company_code: '', name: '', legal_name: '', short_name: '', invoice_registration_number: '' });
  const [clientError, setClientError] = useState<string | null>(null);

  // ─── 自動仕訳モード専用 State ─────────────────────────────────────────────
  const [bankFiles, setBankFiles] = useState<File[]>([]);
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([]);
  // bankOcr.files は bankFiles と同じインデックスで「口座情報＋預金科目マッピング」を保持
  const [bankOcr, setBankOcr] = useState<{
    transactions: TransactionInput[];
    bankName: string;
    accountNumber: string;
    files: Array<{
      bankName: string;
      accountNumber: string;
      depositAccount: string;   // この口座を何科目として扱うか（例: '普通預金'）
      mappingId: string | null; // bank_accounts.id（保存済みなら）
      saving?: boolean;
    }>;
  } | null>(null);
  const [invoiceOcr, setInvoiceOcr] = useState<{ vouchers: VoucherInput[]; count: number } | null>(null);
  const [journalMatchResult, setJournalMatchResult] = useState<{ results: MatchResult[]; summary: MatchSummary } | null>(null);
  const [currentMatchLogId, setCurrentMatchLogId] = useState<string | null>(null);
  // 照合後に投入する「請求書ごとの源泉徴収税額」バッファ（voucher index → 金額）
  const [withholdingTaxBuf, setWithholdingTaxBuf] = useState<Record<number, number>>({});
  // #9 部分登録: 「すでに登録した voucher index の集合」「今回登録対象として選択中の集合」
  const [registeredVoucherIdx, setRegisteredVoucherIdx] = useState<Set<number>>(new Set());
  const [selectedVoucherIdx, setSelectedVoucherIdx] = useState<Set<number>>(new Set());
  const [persisting, setPersisting] = useState(false);
  const [bankProcessing, setBankProcessing] = useState(false);
  const [invoiceProcessing, setInvoiceProcessing] = useState(false);
  const [matchProcessing, setMatchProcessing] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);
  const bankFileInputRef = useRef<HTMLInputElement>(null);
  const invoiceFileInputRef = useRef<HTMLInputElement>(null);
  const [bankDragOver, setBankDragOver] = useState(false);
  const [invoiceDragOver, setInvoiceDragOver] = useState(false);
  const [accountingMethod, setAccountingMethod] = useState<'accrual' | 'cash' | 'monthEnd'>('accrual');
  const [descriptionMode, setDescriptionMode] = useState<'vendor' | 'full'>('vendor');
  // 月末計上モードの期間確認モーダル
  const [periodConfirmOpen, setPeriodConfirmOpen] = useState(false);
  // voucher index -> periodEnd(YYYYMMDD) の編集バッファ
  const [periodEndBuf, setPeriodEndBuf] = useState<Record<number, string>>({});
  // 明細合計 ≠ 税込合計 のエラーをユーザーに通知してスクショ提出を依頼するモーダル
  const [lineSumMismatch, setLineSumMismatch] = useState<null | {
    fileName: string;
    taxIncludedAmount: number;
    linesSum: number;
    lines: Array<{ debitAccount: string; amountInclTax: number; description: string }>;
  }>(null);

  // ─── 既存OCRデータから再照合 State ──────────────────────────────────────
  type OcrUploadItem = { id: string; fileName: string; mode: string; itemCount: number; journalEntryCount: number; createdAt: string };
  const [journalInputMode, setJournalInputMode] = useState<'new' | 'existing'>('new');
  const [existingUploads, setExistingUploads] = useState<OcrUploadItem[]>([]);
  const [existingUploadsLoading, setExistingUploadsLoading] = useState(false);
  const [selectedBankUploadIds, setSelectedBankUploadIds] = useState<Set<string>>(new Set());
  const [selectedInvoiceUploadIds, setSelectedInvoiceUploadIds] = useState<Set<string>>(new Set());
  const [loadingExistingData, setLoadingExistingData] = useState(false);
  // ドラッグ複数選択（再照合用）
  const [isListDragging, setIsListDragging] = useState(false);
  const [dragSelecting, setDragSelecting] = useState(true); // true=追加, false=解除
  const [deletingUploadId, setDeletingUploadId] = useState<string | null>(null);

  // ドラッグ選択: window mouseup で確実に解除
  useEffect(() => {
    const handleMouseUp = () => setIsListDragging(false);
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  // ─── 照合結果の復元・ドラフト保存 ─────────────���─────────────────────────
  const DRAFT_KEY_PREFIX = 'aiocr_match_draft_';
  const getDraftKey = (cId: string) => `${DRAFT_KEY_PREFIX}${cId}`;

  // 最新照合ログを取得して UI に復元
  const restoreMatchLog = useCallback(async (clientId: string) => {
    try {
      const res = await fetch(`/api/match-logs/latest?clientId=${clientId}`);
      if (!res.ok) return;
      const { log } = await res.json();
      if (!log) return;

      // データ形状の簡易バリデーション
      const isValidMatchData = (d: { results?: unknown; summary?: unknown }) =>
        Array.isArray(d.results) && d.summary && typeof d.summary === 'object' && 'total' in d.summary;

      if (!log.id || !isValidMatchData(log)) return;
      setCurrentMatchLogId(log.id);

      // localStorage にドラフトがあればそちらを優先（ユーザー編集が反映される）
      const draftKey = `${DRAFT_KEY_PREFIX}${clientId}`;
      const draftJson = localStorage.getItem(draftKey);
      if (draftJson) {
        try {
          const draft = JSON.parse(draftJson);
          // ドラフトが同じ log ID のものか確認
          if (draft.logId === log.id && isValidMatchData(draft)) {
            setJournalMatchResult({ results: draft.results, summary: draft.summary });
            if (Array.isArray(draft.registeredVoucherIdx)) {
              setRegisteredVoucherIdx(new Set(draft.registeredVoucherIdx));
            }
            return;
          } else {
            localStorage.removeItem(draftKey);
          }
        } catch {
          localStorage.removeItem(draftKey);
        }
      }

      // ドラフトがなければ DB のログから復元
      setJournalMatchResult({ results: log.results, summary: log.summary });
    } catch {
      // silent
    }
  }, []);

  const fetchExistingUploads = useCallback(async (clientId: string) => {
    setExistingUploadsLoading(true);
    try {
      const res = await fetch(`/api/ocr-uploads?clientId=${clientId}`);
      if (!res.ok) return;
      const data = await res.json();
      setExistingUploads(data.uploads ?? []);
    } catch {
      // silent
    } finally {
      setExistingUploadsLoading(false);
    }
  }, []);

  // 証票削除ハンドラー
  const handleDeleteUpload = useCallback(async (uploadId: string) => {
    if (!window.confirm('この証票を削除しますか？')) return;
    setDeletingUploadId(uploadId);
    try {
      const res = await fetch(`/api/ocr-uploads/${uploadId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || '削除に失敗しました');
        return;
      }
      setExistingUploads((prev) => prev.filter((u) => u.id !== uploadId));
      setSelectedInvoiceUploadIds((prev) => { const next = new Set(prev); next.delete(uploadId); return next; });
    } catch {
      alert('削除に失敗しました');
    } finally {
      setDeletingUploadId(null);
    }
  }, []);

  const handleLoadExistingData = useCallback(async () => {
    // 通帳は自動で全件ロード、請求書はユーザー選択
    const bankIds = existingUploads.filter((u) => u.mode === 'bank-statement').map((u) => u.id);
    const invoiceIds = Array.from(selectedInvoiceUploadIds);
    if (invoiceIds.length === 0) {
      alert('請求書を1つ以上選択してください');
      return;
    }

    // 選択した請求書に紐づく旧仕訳を削除するか確認
    const deleteOld = window.confirm(
      '選択した請求書に紐づく既存の仕訳を削除してから再照合しますか？\n\n' +
      '「OK」→ 旧仕訳を削除して再照合\n' +
      '「キャンセル」→ 旧仕訳はそのまま残して再照合'
    );

    setLoadingExistingData(true);
    setJournalError(null);
    try {
      // 旧仕訳を削除する場合
      if (deleteOld) {
        let totalDeleted = 0;
        let totalSkipped = 0;
        for (const uid of invoiceIds) {
          const delRes = await fetch(`/api/history/${uid}?target=journal_entries`, { method: 'DELETE' });
          if (delRes.ok) {
            const d = await delRes.json();
            totalDeleted += d.deleted ?? 0;
            totalSkipped += d.skipped ?? 0;
          }
        }
        if (totalDeleted > 0 || totalSkipped > 0) {
          alert(`旧仕訳 ${totalDeleted} 件を削除しました${totalSkipped ? `（締め済み ${totalSkipped} 件はスキップ）` : ''}`);
        }
      }

      const res = await fetch('/api/ocr-uploads/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankUploadIds: bankIds, invoiceUploadIds: invoiceIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'データ読み込み失敗');

      // bankOcr を復元
      if (data.bankData && data.bankData.length > 0) {
        // 口座マスタを取得して預金科目を自動復元
        const mapRes = await fetch(`/api/bank-accounts${selectedClientId ? `?clientId=${selectedClientId}` : ''}`);
        const mapData = mapRes.ok ? await mapRes.json() : { accounts: [] };
        const mapByKey = new Map<string, { id: string; depositAccount: string }>();
        for (const a of (mapData.accounts ?? []) as Array<{ id: string; bank_name: string; account_number: string; deposit_account: string }>) {
          mapByKey.set(`${a.bank_name}||${a.account_number}`, { id: a.id, depositAccount: a.deposit_account });
        }

        const allTransactions: TransactionInput[] = [];
        const filesInfo: Array<{ bankName: string; accountNumber: string; depositAccount: string; mappingId: string | null }> = [];
        for (const bd of data.bankData) {
          const mapping = mapByKey.get(`${bd.bankName}||${bd.accountNumber}`);
          const depositAccount = mapping?.depositAccount ?? '普通預金';
          for (const t of bd.transactions) {
            allTransactions.push({
              transactionDate: t.transactionDate,
              description: t.description,
              debit: t.debit,
              credit: t.credit,
              ocrUploadId: bd.uploadId,
              sourceFileName: bd.fileName,
              bankAccountName: depositAccount,
            });
          }
          filesInfo.push({
            bankName: bd.bankName,
            accountNumber: bd.accountNumber,
            depositAccount,
            mappingId: mapping?.id ?? null,
          });
        }
        setBankOcr({
          transactions: allTransactions,
          bankName: data.bankData[0].bankName,
          accountNumber: data.bankData[0].accountNumber,
          files: filesInfo,
        });
      }

      // invoiceOcr を復元
      if (data.invoiceData && data.invoiceData.length > 0) {
        const vouchers: VoucherInput[] = [];
        for (const inv of data.invoiceData) {
          for (const item of inv.invoices) {
            vouchers.push({
              vendorName: item.requesterName ?? '不明',
              invoiceDate: item.date ?? '不明',
              amountInclTax: item.taxIncludedAmount ?? null,
              debitAccount: '未分類',
              description: item.requesterName ?? '',
              taxType: '課税仕入10%',
              withholdingTax: item.withholdingTax ?? undefined,
              lines: item.lines?.map((l: { description?: string; amount?: number; taxRate?: number }) => ({
                debitAccount: '未分類',
                amountInclTax: l.amount ?? 0,
                description: l.description ?? '',
                taxType: l.taxRate === 8 ? '課税仕入8%（軽減）' : '課税仕入10%',
              })),
              ocrUploadId: inv.uploadId,
              sourceFileName: inv.fileName,
            });
          }
        }
        setInvoiceOcr({ vouchers, count: vouchers.length });
      }

      // マッチ結果をリセット
      setJournalMatchResult(null);
      setRegisteredVoucherIdx(new Set());
      setSelectedVoucherIdx(new Set());
      setWithholdingTaxBuf({});
      setUnmatchedTxAccounts({});
      setUnmatchedTxDescriptions({});
      setUnmatchedSelected(new Set());
    } catch (e) {
      setJournalError(e instanceof Error ? e.message : 'データ読み込み失敗');
    } finally {
      setLoadingExistingData(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingUploads, selectedInvoiceUploadIds, selectedClientId]);

  // ─── 未照合トランザクションの勘定科目選択 State ───────────────────────────
  const [unmatchedTxAccounts, setUnmatchedTxAccounts] = useState<Record<number, string>>({});
  const [unmatchedTxDescriptions, setUnmatchedTxDescriptions] = useState<Record<number, string>>({});
  const [unmatchedSelected, setUnmatchedSelected] = useState<Set<number>>(new Set());
  const [unmatchedBulkAccount, setUnmatchedBulkAccount] = useState<string>('');
  const [unmatchedBulkDescription, setUnmatchedBulkDescription] = useState<string>('');
  // 固定資産の売却などで消込済みの unmatched idx（元配列のインデックス）
  const [consumedUnmatchedIdx, setConsumedUnmatchedIdx] = useState<Set<number>>(new Set());

  // ─── 勘定科目ルール（相手先→科目 / 摘要→科目） ──────────────────────────
  interface AccountRule { id: string; pattern_type: 'vendor' | 'description'; pattern: string; debit_account: string; created_at?: string }
  const [rulesList, setRulesList] = useState<AccountRule[]>([]);

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch('/api/account-rules', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setRulesList(data.rules ?? []);
    } catch {
      // silent
    }
  }, []);

  const addRule = useCallback(async (pattern_type: 'vendor' | 'description', pattern: string, debit_account: string) => {
    try {
      const res = await fetch('/api/account-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern_type, pattern, debit_account }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'ルール追加に失敗しました');
        return null;
      }
      setRulesList((prev) => {
        const without = prev.filter((r) => !(r.pattern_type === data.rule.pattern_type && r.pattern === data.rule.pattern));
        return [...without, data.rule];
      });
      return data.rule as AccountRule;
    } catch {
      alert('ルール追加に失敗しました');
      return null;
    }
  }, []);

  const deleteRule = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/account-rules?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) return;
      setRulesList((prev) => prev.filter((r) => r.id !== id));
    } catch {
      // silent
    }
  }, []);

  // ─── 勘定科目マスタ State（起動時に1回だけロード） ────────────────────────
  interface AccountItem { id: string; name: string; reading: string; category: string; sub_category?: string | null; display_order?: number | null; client_id?: string | null; auto_registered?: boolean; confirmed?: boolean }
  const [accountsList, setAccountsList] = useState<AccountItem[]>([]);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/accounts', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setAccountsList(data.accounts ?? []);
    } catch {
      // silent
    }
  }, []);

  const addAccountLocal = useCallback(async (name: string, reading?: string, sub_category?: string): Promise<AccountItem | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    // 既存に同名があれば再利用
    const existing = accountsList.find((a) => a.name === trimmed);
    if (existing) return existing;
    // sub_category から大区分(category)を逆引き
    const SUB_TO_CATEGORY: Record<string, string> = {
      '流動資産': 'asset', '固定資産': 'asset', '繰延資産': 'asset',
      '流動負債': 'liability', '固定負債': 'liability',
      '純資産': 'equity',
      '売上高': 'revenue', '営業外収益': 'revenue', '特別利益': 'revenue',
      '売上原価': 'expense', '販管費': 'expense', '営業外費用': 'expense', '特別損失': 'expense',
    };
    const category = sub_category ? (SUB_TO_CATEGORY[sub_category] ?? '') : '';
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed, reading: reading?.trim() ?? '', sub_category: sub_category ?? '', category }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status !== 409) alert(data.error || '科目追加失敗');
      return null;
    }
    setAccountsList((prev) => [...prev, data.account].sort((a, b) => a.name.localeCompare(b.name)));
    return data.account;
  }, [accountsList]);

  // ─── 取引先マスタ State ──────────────────────────────────────────────────
  interface VendorItem { id: string; name: string; normalized_key: string; reading: string; client_id?: string | null }
  const [vendorsList, setVendorsList] = useState<VendorItem[]>([]);

  const fetchVendors = useCallback(async () => {
    try {
      const res = await fetch('/api/vendors');
      if (!res.ok) return;
      const data = await res.json();
      setVendorsList(data.vendors ?? []);
    } catch {
      // silent
    }
  }, []);

  const addVendorLocal = useCallback(async (name: string, reading?: string): Promise<VendorItem | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const res = await fetch('/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed, reading: reading?.trim() ?? '' }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status !== 409) alert(data.error || '取引先追加失敗');
      return null;
    }
    setVendorsList((prev) => {
      if (prev.some((v) => v.id === data.vendor.id)) return prev;
      return [...prev, data.vendor].sort((a, b) => a.name.localeCompare(b.name));
    });
    return data.vendor;
  }, []);

  // ─── 部門マスタ State ───────────────────────────────────────────────────────
  interface DepartmentItem { id: string; name: string; code: string | null; client_id: string | null }
  const [departmentsList, setDepartmentsList] = useState<DepartmentItem[]>([]);

  const fetchDepartments = useCallback(async () => {
    try {
      const res = await fetch('/api/departments');
      if (!res.ok) return;
      const data = await res.json();
      setDepartmentsList(data.departments ?? []);
    } catch {}
  }, []);

  // ─── 仕訳日記帳サブビュー State ────────────────────────────────────────────
  const [journalSubView, setJournalSubView] = useState<'execute' | 'unmatched' | 'ledger' | 'balance' | 'master' | 'bank-tx'>('execute');
  const [ledgerAccountFilter, setLedgerAccountFilter] = useState<string>('');
  // LedgerView は自前で fetch するので、親はリフレッシュ通知だけ持つ（ミューテーション後にBumpする）
  const [ledgerRefreshKey, setLedgerRefreshKey] = useState(0);
  const bumpLedgerRefresh = useCallback(() => setLedgerRefreshKey((k) => k + 1), []);

  // ─── 手動仕訳入力モーダル State ────────────────────────────────────────────
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const [manualEntrySubmitting, setManualEntrySubmitting] = useState(false);
  const [manualEntryError, setManualEntryError] = useState<string | null>(null);
  const todayYmd = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const [manualEntryForm, setManualEntryForm] = useState<{
    entry_date: string;
    debit_account: string;
    credit_account: string;
    amount: string;
    description: string;
    tax_category: string;
    vendor_name: string;
  }>({
    entry_date: todayYmd(),
    debit_account: '',
    credit_account: '',
    amount: '',
    description: '',
    tax_category: '',
    vendor_name: '',
  });

  const resetManualEntry = () => {
    setManualEntryForm({
      entry_date: todayYmd(),
      debit_account: '',
      credit_account: '',
      amount: '',
      description: '',
      tax_category: '',
      vendor_name: '',
    });
    setManualEntryError(null);
  };

  const handleManualEntrySubmit = async () => {
    if (manualEntrySubmitting) return;
    setManualEntryError(null);

    const { entry_date, debit_account, credit_account, amount, description, tax_category, vendor_name } = manualEntryForm;
    if (!entry_date) { setManualEntryError('日付を入力してください'); return; }
    if (!debit_account.trim()) { setManualEntryError('借方科目を選択してください'); return; }
    if (!credit_account.trim()) { setManualEntryError('貸方科目を選択してください'); return; }
    const amt = Number(amount.replace(/,/g, ''));
    if (!Number.isFinite(amt) || amt <= 0) { setManualEntryError('金額は1以上の数値で入力してください'); return; }

    setManualEntrySubmitting(true);
    try {
      const res = await fetch('/api/journal-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_date,
          debit_account: debit_account.trim(),
          credit_account: credit_account.trim(),
          amount: amt,
          description: description.trim(),
          tax_category: tax_category || null,
          vendor_name: vendor_name.trim(),
          client_id: selectedClientId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '登録に失敗しました');
      setManualEntryOpen(false);
      resetManualEntry();
      bumpLedgerRefresh();
    } catch (e) {
      setManualEntryError(e instanceof Error ? e.message : '登録に失敗しました');
    } finally {
      setManualEntrySubmitting(false);
    }
  };

  const handleSaveField = async (id: string, patch: Partial<LedgerEntry>) => {
    const res = await fetch(`/api/journal-entries/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || '更新失敗');
      return;
    }
    bumpLedgerRefresh();
  };

  const handleBulkDelete = async (ids: string[]) => {
    const res = await fetch('/api/journal-entries/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || '一括削除失敗');
      return;
    }
    if (data.skipped > 0) {
      alert(`${data.deleted} 件削除しました（${data.skipped} 件は締め済みのためスキップ）`);
    }
    bumpLedgerRefresh();
  };

  const handleCloseAt = async (closedUntilYmd: string) => {
    const res = await fetch('/api/journal-closings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: selectedClientId, closedUntil: closedUntilYmd }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || '締め設定失敗');
      return;
    }
    bumpLedgerRefresh();
  };

  const handleReopenClosing = async () => {
    if (!confirm('締めを解除しますか？（締め済み期間の仕訳が再度編集可能になります）')) return;
    const url = selectedClientId
      ? `/api/journal-closings?clientId=${encodeURIComponent(selectedClientId)}`
      : '/api/journal-closings';
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || '解除失敗');
      return;
    }
    bumpLedgerRefresh();
  };

  // ─── PDFプレビューモーダル State ───────────────────────────────────────────
  const [pdfPreview, setPdfPreview] = useState<{ url: string; name: string } | null>(null);

  // 別ウインドウで PDF を開く（見比べ用に複数同時に開ける）
  const openPdfInNewWindow = (file: File, title: string) => {
    const url = URL.createObjectURL(file);
    const win = window.open('', '_blank', 'width=900,height=1000,menubar=no,toolbar=no');
    if (!win) {
      // ポップアップブロック時のフォールバック: モーダル表示
      setPdfPreview({ url, name: title });
      return;
    }
    win.document.title = title;
    win.document.body.style.margin = '0';
    const iframe = win.document.createElement('iframe');
    iframe.src = url;
    iframe.style.width = '100%';
    iframe.style.height = '100vh';
    iframe.style.border = 'none';
    win.document.body.appendChild(iframe);
    // ウインドウが閉じられたら blob URL を解放
    win.addEventListener('beforeunload', () => URL.revokeObjectURL(url));
  };

  const showVoucherPdf = (voucher: VoucherInput) => {
    if (voucher.sourceFileIndex == null) return;
    const file = invoiceFiles[voucher.sourceFileIndex];
    if (!file) return;
    openPdfInNewWindow(file, voucher.sourceFileName || file.name);
  };

  const showTransactionPdf = (tx: TransactionInput) => {
    if (tx.sourceFileIndex == null) return;
    const file = bankFiles[tx.sourceFileIndex];
    if (!file) return;
    openPdfInNewWindow(file, tx.sourceFileName || file.name);
  };

  const closePdfPreview = () => {
    if (pdfPreview) URL.revokeObjectURL(pdfPreview.url);
    setPdfPreview(null);
  };

  // ─── エラー報告 State ─────────────────────────────────────────────────────
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportComment, setReportComment] = useState('');
  const [reportScreenshot, setReportScreenshot] = useState<string | null>(null);
  const [reportSending, setReportSending] = useState(false);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  // #3 ドラッグ可能モーダル: 位置 + ドラッグ状態
  const [reportModalPos, setReportModalPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const reportDragRef = useRef<{ dragging: boolean; offsetX: number; offsetY: number }>({ dragging: false, offsetX: 0, offsetY: 0 });

  const onReportDragStart = useCallback((e: React.MouseEvent) => {
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    reportDragRef.current = {
      dragging: true,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    e.preventDefault();
  }, []);

  useEffect(() => {
    if (!showReportModal) return;
    const handleMove = (e: MouseEvent) => {
      if (!reportDragRef.current.dragging) return;
      setReportModalPos({
        x: e.clientX - reportDragRef.current.offsetX,
        y: e.clientY - reportDragRef.current.offsetY,
      });
    };
    const handleUp = () => {
      reportDragRef.current.dragging = false;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [showReportModal]);

  const openReportModal = () => {
    setReportComment('');
    setReportScreenshot(null);
    setReportMessage(null);
    // 画面中央より少し上に初期配置（clientWidth/clientHeight を使って中央に）
    if (typeof window !== 'undefined') {
      const w = 520;
      setReportModalPos({
        x: Math.max(20, (window.innerWidth - w) / 2),
        y: Math.max(20, window.innerHeight * 0.12),
      });
    }
    setShowReportModal(true);
  };

  const handleReportPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => setReportScreenshot(typeof reader.result === 'string' ? reader.result : null);
        reader.readAsDataURL(file);
        e.preventDefault();
        return;
      }
    }
  };

  const handleReportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setReportScreenshot(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const handleSendReport = async () => {
    if (!reportComment.trim() || reportSending) return;
    setReportSending(true);
    setReportMessage(null);
    try {
      const res = await fetch('/api/report-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comment: reportComment,
          screenshot: reportScreenshot,
          mode,
          context: {
            summary: journalMatchResult?.summary ?? null,
            bankCount: bankOcr?.transactions.length ?? 0,
            invoiceCount: invoiceOcr?.vouchers.length ?? 0,
            clientId: selectedClientId,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '送信失敗');
      setReportMessage('送信しました。管理者に届きました。');
      setReportComment('');
      setReportScreenshot(null);
      setTimeout(() => setShowReportModal(false), 1500);
    } catch (e) {
      setReportMessage(e instanceof Error ? e.message : '送信に失敗しました');
    } finally {
      setReportSending(false);
    }
  };

  const ACCEPT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
  const isAcceptedFile = (f: File) => ACCEPT_TYPES.includes(f.type) || /\.(heic|heif)$/i.test(f.name);

  const addPdfFiles = (
    incoming: FileList | File[] | null,
    setter: React.Dispatch<React.SetStateAction<File[]>>
  ) => {
    const sel = Array.from(incoming || []).filter(isAcceptedFile);
    if (sel.length === 0) return false;
    setter((prev) => {
      const ex = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...sel.filter((f) => !ex.has(f.name + f.size))];
    });
    return true;
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      setUser(data.user);
      if (!data.user) {
        // ゲスト：FingerprintJSでブラウザ識別→サーバーサイドで使用回数チェック
        try {
          const fp = await FingerprintJS.load();
          const result = await fp.get();
          const fpId = result.visitorId;
          setFingerprintId(fpId);
          const res = await fetch(`/api/guest-usage?fingerprintId=${fpId}`);
          const d = await res.json();
          if (d.count != null && d.count >= GUEST_MAX_USES) setGuestLimitReached(true);
        } catch {
          // fingerprint取得失敗時はゲスト利用不可にはしない（APIで弾く）
        }
      } else {
        fetch('/api/usage')
          .then((r) => r.json())
          .then((d) => { if (d.count != null) setUsageInfo({ count: d.count, limit: d.limit }); })
          .catch(() => {});
        // クライアント一覧を取得（0件かつ未完了なら /onboarding へ誘導）
        fetch('/api/clients')
          .then((r) => r.json())
          .then((d) => {
            if (d.clients) setClients(d.clients);
            try {
              const done = localStorage.getItem('aiocr_onboarding_done') === '1';
              if (Array.isArray(d.clients) && d.clients.length === 0 && !done) {
                router.replace('/onboarding');
              }
            } catch {
              // localStorage 利用不可なら誘導はスキップ
            }
          })
          .catch(() => {});
        // 勘定科目・取引先マスタ・ルールを起動時に1回ロード
        fetchAccounts();
        fetchVendors();
        fetchDepartments();
        fetchRules();
      }
    });
  }, [fetchAccounts, fetchVendors, fetchRules]);

  const isGuest = user === null;

  // ─── 照合結果ドラフト自動保存（localStorage, debounce 1秒） ─────────────────
  useEffect(() => {
    if (!journalMatchResult || !selectedClientId || !currentMatchLogId) return;
    const timer = setTimeout(() => {
      try {
        const draft = {
          logId: currentMatchLogId,
          results: journalMatchResult.results,
          summary: journalMatchResult.summary,
          registeredVoucherIdx: Array.from(registeredVoucherIdx),
          savedAt: new Date().toISOString(),
        };
        localStorage.setItem(getDraftKey(selectedClientId), JSON.stringify(draft));
      } catch {
        // localStorage full or unavailable — silent
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [journalMatchResult, selectedClientId, currentMatchLogId, registeredVoucherIdx]);

  // ─── ドラッグ&ドロップハンドラ（既存ロジックと同じ） ───────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files).filter(
      (f) => ACCEPT_TYPES.includes(f.type) || /\.(heic|heif)$/i.test(f.name)
    );
    if (dropped.length > 0) {
      setFiles((prev) => {
        const existing = new Set(prev.map((f) => f.name + f.size));
        return [...prev, ...dropped.filter((f) => !existing.has(f.name + f.size))];
      });
      setResult(null);
      setError(null);
    } else {
      setError('PDF・画像ファイル（PNG, JPEG, HEIC）のみ対応しています');
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []).filter(isAcceptedFile);
    if (selected.length > 0) {
      setFiles((prev) => {
        const existing = new Set(prev.map((f) => f.name + f.size));
        return [...prev, ...selected.filter((f) => !existing.has(f.name + f.size))];
      });
      setResult(null);
      setError(null);
    }
    e.target.value = '';
  };

  const handleRemoveFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // ─── OCR処理（既存ロジックと同じ） ────────────────────────────────────────

  const handleProcess = async () => {
    if (mode === 'journal-entry' || mode === 'financial-statement' || files.length === 0) return;

    if (isGuest && guestLimitReached) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      let totalPages = 0;
      const sessionId = crypto.randomUUID();

      if (mode === 'bank-statement') {
        const allTransactions: BankTransactionRow[] = [];
        let bankName = '不明';
        let accountNumber = '不明';
        let bankCostJpy = 0;
        let bankInTok = 0;
        let bankOutTok = 0;
        let isFirstChunk = true;
        for (let i = 0; i < files.length; i++) {
          setProcessingIndex(i + 1);
          const bkIsImage = files[i].type.startsWith('image/') || /\.(heic|heif)$/i.test(files[i].name);
          const chunks = bkIsImage ? [{ file: files[i], pageOffset: 0 }] : await splitPdfIfNeeded(files[i]);
          for (const { file: chunkFile, pageOffset } of chunks) {
            const formData = new FormData();
            formData.append('pdf', chunkFile);
            formData.append('mode', mode);
            formData.append('sessionId', sessionId);
            formData.append('pageOffset', String(pageOffset));
            if (selectedClientId) formData.append('clientId', selectedClientId);
            if (isGuest && fingerprintId) formData.append('fingerprintId', fingerprintId);
            const res = await fetch('/api/process-pdf', { method: 'POST', body: formData });
            let data;
            try { data = await res.json(); } catch { throw new Error(`${files[i].name}: サーバーエラーが発生しました（ファイルサイズが大きすぎる可能性があります）`); }
            if (!res.ok) {
              if (data.errorCode === 'DUPLICATE_FILE') {
                alert(`⚠️ ${files[i].name}\n${data.error}\nこのファイルをスキップして続行します。`);
                break;
              }
              throw new Error(`${files[i].name}: ${data.error || 'エラーが発生しました'}`);
            }
            if (isFirstChunk) { bankName = data.bankName; accountNumber = data.accountNumber; isFirstChunk = false; }
            allTransactions.push(...(data.transactions || []).map((t: Omit<BankTransactionRow, 'sourceFile'>) => ({ ...t, sourceFile: files[i].name })));
            totalPages += data.totalPages;
            if (data.usage) {
              bankCostJpy += data.usage.costJpy || 0;
              bankInTok += data.usage.inputTokens || 0;
              bankOutTok += data.usage.outputTokens || 0;
            }
          }
        }
        if (isGuest && fingerprintId) {
          fetch(`/api/guest-usage?fingerprintId=${fingerprintId}`)
            .then((r) => r.json())
            .then((d) => { if (d.count != null && d.count >= GUEST_MAX_USES) setGuestLimitReached(true); })
            .catch(() => {});
        }
        setResult({ mode: 'bank-statement', bankName, accountNumber, transactions: allTransactions, totalPages, processedFiles: files.length, totalCostJpy: bankCostJpy, totalInputTokens: bankInTok, totalOutputTokens: bankOutTok });
        return;
      }

      // invoice / tax-return
      const allInvoices: InvoiceResult[] = [];
      let invCostJpy = 0;
      let invInTok = 0;
      let invOutTok = 0;
      for (let i = 0; i < files.length; i++) {
        setProcessingIndex(i + 1);
        const fileIsImage = files[i].type.startsWith('image/') || /\.(heic|heif)$/i.test(files[i].name);
        const chunks = fileIsImage
          ? [{ file: files[i], pageOffset: 0 }]
          : await splitPdfIfNeeded(files[i]);
        const needsClientExtraction = !fileIsImage && chunks.length > 1;
        let fileSkipped = false;
        for (const { file: chunkFile, pageOffset } of chunks) {
          const formData = new FormData();
          formData.append('pdf', chunkFile);
          formData.append('mode', mode);
          formData.append('sessionId', sessionId);
          formData.append('pageOffset', String(pageOffset));
          if (needsClientExtraction) formData.append('skipPdf', 'true');
          if (selectedClientId) formData.append('clientId', selectedClientId);
          if (isGuest && fingerprintId) formData.append('fingerprintId', fingerprintId);

          const res = await fetch('/api/process-pdf', {
            method: 'POST',
            body: formData,
          });

          let data;
          try { data = await res.json(); } catch { throw new Error(`${files[i].name}: サーバーエラーが発生しました（ファイルサイズが大きすぎる可能性があります）`); }
          if (!res.ok) {
            if (data.errorCode === 'DUPLICATE_FILE') {
              alert(`⚠️ ${files[i].name}\n${data.error}\nこのファイルをスキップして続行します。`);
              fileSkipped = true;
              break;
            }
            throw new Error(`${files[i].name}: ${data.error || 'エラーが発生しました'}`);
          }

          const invoicesWithSource = data.invoices.map(
            (inv: Omit<InvoiceResult, 'sourceFile'>) => ({
              ...inv,
              index: allInvoices.length + inv.index,
              sourceFile: files[i].name,
            })
          );
          allInvoices.push(...invoicesWithSource);
          totalPages += data.totalPages;
          if (data.usage) {
            invCostJpy += data.usage.costJpy || 0;
            invInTok += data.usage.inputTokens || 0;
            invOutTok += data.usage.outputTokens || 0;
          }
        }
        if (fileSkipped) continue;

        // クライアント側でPDF抽出（skipPdf使用時・画像はスキップ）
        if (needsClientExtraction) {
          const { PDFDocument } = await import('pdf-lib');
          const srcBytes = await files[i].arrayBuffer();
          const srcDoc = await PDFDocument.load(srcBytes);
          for (const inv of allInvoices) {
            if (inv.sourceFile === files[i].name && !inv.pdfBase64) {
              const newPdf = await PDFDocument.create();
              const startIdx = Math.max(0, inv.pageStart - 1);
              const endIdx = Math.min(srcDoc.getPageCount() - 1, inv.pageEnd - 1);
              const indices = Array.from({ length: endIdx - startIdx + 1 }, (_, j) => startIdx + j);
              const copied = await newPdf.copyPages(srcDoc, indices);
              copied.forEach((p) => newPdf.addPage(p));
              const pdfBytes = await newPdf.save();
              // チャンク単位でbase64変換（大きいPDFでもスタックオーバーフローしない）
              const uint8 = new Uint8Array(pdfBytes);
              let binary = '';
              const CHUNK = 8192;
              for (let k = 0; k < uint8.length; k += CHUNK) {
                binary += String.fromCharCode(...uint8.subarray(k, k + CHUNK));
              }
              inv.pdfBase64 = btoa(binary);
            }
          }
        }
      }

      if (isGuest && fingerprintId) {
        fetch(`/api/guest-usage?fingerprintId=${fingerprintId}`)
          .then((r) => r.json())
          .then((d) => { if (d.count != null && d.count >= GUEST_MAX_USES) setGuestLimitReached(true); })
          .catch(() => {});
      }

      if (mode === 'invoice' || mode === 'tax-return') {
        setResult({ invoices: allInvoices, totalPages, processedFiles: files.length, mode, totalCostJpy: invCostJpy, totalInputTokens: invInTok, totalOutputTokens: invOutTok });
      }

      // ログインユーザーの使用量を再取得
      if (!isGuest) {
        fetch('/api/usage')
          .then((r) => r.json())
          .then((d) => { if (d.count != null) setUsageInfo({ count: d.count, limit: d.limit }); })
          .catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setLoading(false);
      setProcessingIndex(0);
    }
  };

  // ─── ダウンロードハンドラ（既存ロジックと同じ） ────────────────────────────

  const handleDownloadOne = (invoice: InvoiceResult) => {
    const blob = base64ToBlob(invoice.pdfBase64, mimeFromFileName(invoice.fileName));
    downloadBlob(blob, invoice.fileName);
  };

  const handleDownloadAll = async () => {
    if (!result) return;
    if (result.mode === 'bank-statement') {
      const header = ['取引日', '摘要', '出金', '入金', '残高', 'ファイル名'];
      const rows = result.transactions.map((t) => [
        t.date, t.description,
        t.debit != null ? String(t.debit) : '',
        t.credit != null ? String(t.credit) : '',
        t.balance != null ? String(t.balance) : '',
        t.sourceFile,
      ]);
      downloadCsv([header, ...rows], `通帳_${result.bankName}_${result.accountNumber}.csv`);
      return;
    }
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    result.invoices.forEach((invoice) => {
      zip.file(invoice.fileName, base64ToBlob(invoice.pdfBase64, mimeFromFileName(invoice.fileName)));
    });
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, '請求書_分割済み.zip');
  };

  const handleCsvExport = () => {
    if (!result || result.mode === 'bank-statement') return;
    if (result.mode === 'tax-return') {
      const header = ['#', 'ページ', '年度', '氏名', '書類種別', '所得金額', '納税額', 'ファイル名'];
      const rows = result.invoices.map((inv, i) => [
        String(i + 1),
        inv.pageStart === inv.pageEnd ? `p${inv.pageStart}` : `p${inv.pageStart}-${inv.pageEnd}`,
        inv.year || '',
        inv.taxpayerName || '',
        inv.documentType || '',
        inv.totalIncome != null ? String(inv.totalIncome) : '',
        inv.taxPayable != null ? String(inv.taxPayable) : '',
        inv.fileName,
      ]);
      downloadCsv([header, ...rows], 'OCR結果_確定申告.csv');
    } else {
      const header = ['#', 'ページ', '種別', '日付', '発行者名', '税込金額', 'インボイス番号', 'ファイル名'];
      const rows = result.invoices.map((inv, i) => [
        String(i + 1),
        inv.pageStart === inv.pageEnd ? `p${inv.pageStart}` : `p${inv.pageStart}-${inv.pageEnd}`,
        inv.documentCategory === 'receipt' ? '領収書' : '請求書',
        inv.date || '',
        inv.requesterName || '',
        inv.taxIncludedAmount != null ? String(inv.taxIncludedAmount) : '',
        inv.invoiceNumber || '',
        inv.fileName,
      ]);
      downloadCsv([header, ...rows], 'OCR結果_請求書領収書.csv');
    }
  };

  const handleReset = () => {
    setFiles([]);
    setResult(null);
    setError(null);
  };

  // ─── 自動仕訳モード: 通帳OCR ──────────────────────────────────────────────
  const handleBankProcess = async () => {
    if (bankFiles.length === 0) return;
    setBankProcessing(true);
    setJournalError(null);
    try {
      // 既存の口座マスタを取得
      const mapRes = await fetch(`/api/bank-accounts${selectedClientId ? `?clientId=${selectedClientId}` : ''}`);
      const mapData = mapRes.ok ? await mapRes.json() : { accounts: [] };
      const existing: Array<{
        id: string;
        bank_name: string;
        account_number: string;
        deposit_account: string;
      }> = mapData.accounts ?? [];
      const mapByKey = new Map<string, { id: string; depositAccount: string }>();
      for (const a of existing) {
        mapByKey.set(`${a.bank_name}||${a.account_number}`, {
          id: a.id,
          depositAccount: a.deposit_account,
        });
      }

      const allTx: TransactionInput[] = [];
      const fileInfos: NonNullable<typeof bankOcr>['files'] = [];
      let topBankName = '不明';
      let topAccountNumber = '不明';
      const bankSessionId = crypto.randomUUID();
      for (let fi = 0; fi < bankFiles.length; fi++) {
        const file = bankFiles[fi];
        const bfIsImage = file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name);
        const chunks = bfIsImage ? [{ file, pageOffset: 0 }] : await splitPdfIfNeeded(file);
        let fileSkipped = false;
        let fileBankName = '不明';
        let fileAccountNumber = '不明';
        for (const { file: chunkFile, pageOffset } of chunks) {
          const fd = new FormData();
          fd.append('pdf', chunkFile);
          fd.append('mode', 'bank-statement');
          fd.append('sessionId', bankSessionId);
          fd.append('pageOffset', String(pageOffset));
          if (selectedClientId) fd.append('clientId', selectedClientId);
          const res = await fetch('/api/process-pdf', { method: 'POST', body: fd });
          let data;
          try { data = await res.json(); } catch { throw new Error(`${file.name}: サーバーエラーが発生しました（ファイルサイズが大きすぎる可能性があります）`); }
          if (!res.ok) {
            if (data.errorCode === 'DUPLICATE_FILE') {
              alert(`⚠️ ${file.name}\n${data.error}\nこのファイルをスキップして続行します。`);
              fileSkipped = true;
              break;
            }
            throw new Error(`${file.name}: ${data.error}`);
          }
          if (fileBankName === '不明') { fileBankName = data.bankName || '不明'; fileAccountNumber = data.accountNumber || '不明'; }
          const mapped = mapByKey.get(`${fileBankName}||${fileAccountNumber}`);
          const deposit = mapped?.depositAccount || '普通預金';
          const uploadId: string | null = data.uploadId ?? null;
          allTx.push(...(data.transactions || []).map((t: { date: string; description: string; debit: number | null; credit: number | null }) => ({
            transactionDate: t.date,
            description: t.description,
            debit: t.debit,
            credit: t.credit,
            sourceFileIndex: fi,
            sourceFileName: file.name,
            ocrUploadId: uploadId,
            bankAccountName: deposit,
          })));
        }
        if (fileSkipped) continue;
        const mapped = mapByKey.get(`${fileBankName}||${fileAccountNumber}`);
        const deposit = mapped?.depositAccount || '普通預金';
        fileInfos.push({ bankName: fileBankName, accountNumber: fileAccountNumber, depositAccount: deposit, mappingId: mapped?.id ?? null });
        if (topBankName === '不明') { topBankName = fileBankName; topAccountNumber = fileAccountNumber; }
      }
      setBankOcr({ transactions: allTx, bankName: topBankName, accountNumber: topAccountNumber, files: fileInfos });
    } catch (e) {
      setJournalError(e instanceof Error ? e.message : '通帳OCRエラー');
    } finally {
      setBankProcessing(false);
    }
  };

  // 口座毎の預金科目をローカル更新（transactions にも反映）
  const updateBankAccountDeposit = (fileIdx: number, depositAccount: string) => {
    setBankOcr((prev) => {
      if (!prev) return prev;
      const files = prev.files.map((f, i) => i === fileIdx ? { ...f, depositAccount } : f);
      const transactions = prev.transactions.map((t) =>
        t.sourceFileIndex === fileIdx ? { ...t, bankAccountName: depositAccount } : t
      );
      return { ...prev, files, transactions };
    });
  };

  // 口座マスタに保存（既存なら更新）
  const saveBankAccountMapping = async (fileIdx: number) => {
    if (!bankOcr) return;
    const f = bankOcr.files[fileIdx];
    if (!f) return;
    setBankOcr((prev) => prev ? {
      ...prev,
      files: prev.files.map((x, i) => i === fileIdx ? { ...x, saving: true } : x),
    } : prev);
    try {
      const res = await fetch('/api/bank-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankName: f.bankName,
          accountNumber: f.accountNumber,
          depositAccount: f.depositAccount,
          clientId: selectedClientId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '口座マスタ保存失敗');
      setBankOcr((prev) => prev ? {
        ...prev,
        files: prev.files.map((x, i) => i === fileIdx
          ? { ...x, mappingId: data.account?.id ?? x.mappingId, saving: false }
          : x),
      } : prev);
    } catch (e) {
      alert(e instanceof Error ? e.message : '口座マスタ保存失敗');
      setBankOcr((prev) => prev ? {
        ...prev,
        files: prev.files.map((x, i) => i === fileIdx ? { ...x, saving: false } : x),
      } : prev);
    }
  };

  // ─── 自動仕訳モード: 請求書OCR ───────────────────────────────────────────
  const handleInvoiceProcess = async () => {
    if (invoiceFiles.length === 0) return;
    setInvoiceProcessing(true);
    setJournalError(null);
    try {
      const allVouchers: VoucherInput[] = [];
      const autoWhBuf: Record<number, number> = {};
      const invoiceSessionId = crypto.randomUUID();
      for (let fi = 0; fi < invoiceFiles.length; fi++) {
        const file = invoiceFiles[fi];
        const ifIsImage = file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name);
        const chunks = ifIsImage ? [{ file, pageOffset: 0 }] : await splitPdfIfNeeded(file);
        for (const { file: chunkFile, pageOffset } of chunks) {
          const fd = new FormData();
          fd.append('pdf', chunkFile);
          // 自動仕訳モードでは1PDF=1請求書として扱う（自動分割しない）
          fd.append('mode', 'invoice-single');
          fd.append('sessionId', invoiceSessionId);
          fd.append('pageOffset', String(pageOffset));
          if (selectedClientId) fd.append('clientId', selectedClientId);
          const res = await fetch('/api/process-pdf', { method: 'POST', body: fd });
          let data;
          try { data = await res.json(); } catch { throw new Error(`${file.name}: サーバーエラーが発生しました（ファイルサイズが大きすぎる可能性があります）`); }
          if (!res.ok) {
            // 明細合計不整合の場合は専用モーダルで通知（スクショ提出依頼）
            if (data.errorCode === 'LINE_SUM_MISMATCH' && data.detail) {
              setLineSumMismatch({
                fileName: file.name,
                taxIncludedAmount: data.detail.taxIncludedAmount,
                linesSum: data.detail.linesSum,
                lines: data.detail.lines ?? [],
              });
              return; // OCR全体を中断
            }
            throw new Error(`${file.name}: ${data.error}`);
          }
          const uploadId: string | null = data.uploadId ?? null;
          for (const inv of (data.invoices || [])) {
            const ocrLines: { debitAccount: string; amountInclTax: number; taxType: string; description: string }[] =
              Array.isArray(inv.lines) ? inv.lines : [];
            const hasMultipleLines = ocrLines.length > 1;
            const voucherIdx = allVouchers.length;
            if (typeof inv.withholdingTax === 'number' && inv.withholdingTax > 0) {
              autoWhBuf[voucherIdx] = inv.withholdingTax;
            }
            allVouchers.push({
              vendorName: inv.requesterName || '',
              invoiceDate: inv.date || '不明',
              amountInclTax: inv.taxIncludedAmount,
              debitAccount: hasMultipleLines ? '' : (ocrLines[0]?.debitAccount || '仕入高'),
              description: inv.requesterName || '',
              taxType: hasMultipleLines ? '課税仕入10%' : (ocrLines[0]?.taxType || '課税仕入10%'),
              lines: hasMultipleLines ? ocrLines : undefined,
              sourceFileIndex: fi,
              sourceFileName: file.name,
              ocrUploadId: uploadId,
            });
          }
        }
      }
      setInvoiceOcr({ vouchers: allVouchers, count: allVouchers.length });
      // 源泉税を自動プリフィル（ユーザーが編集すれば上書き）
      if (Object.keys(autoWhBuf).length > 0) {
        setWithholdingTaxBuf((prev) => ({ ...autoWhBuf, ...prev }));
      }
    } catch (e) {
      setJournalError(e instanceof Error ? e.message : '請求書OCRエラー');
    } finally {
      setInvoiceProcessing(false);
    }
  };

  // ─── 自動仕訳モード: 照合実行 ─────────────────────────────────────────────
  const handleRunMatch = async () => {
    if (!bankOcr || !invoiceOcr) return;
    // 月末計上モードは periodEnd 確認モーダルを通してから実行する
    if (accountingMethod === 'monthEnd' && !periodConfirmOpen) {
      // 初期値を matcher の期間抽出で埋める
      const { extractPeriodEndFromVoucher } = await import('@/lib/ocr/journal-matcher');
      const buf: Record<number, string> = {};
      invoiceOcr.vouchers.forEach((v, idx) => {
        const hit = extractPeriodEndFromVoucher(v);
        // 抽出できなければ請求書日の月末で補完
        buf[idx] = hit ?? toMonthEndClient(v.invoiceDate);
      });
      setPeriodEndBuf(buf);
      setPeriodConfirmOpen(true);
      return;
    }
    setMatchProcessing(true);
    setJournalError(null);
    try {
      // 月末計上モード: 各 voucher に periodEnd を埋め込んで送る
      // 源泉税バッファは全モード共通で適用
      const base = invoiceOcr.vouchers.map((v, idx) => ({
        ...v,
        withholdingTax: withholdingTaxBuf[idx] && withholdingTaxBuf[idx] > 0 ? withholdingTaxBuf[idx] : null,
      }));
      const vouchers = accountingMethod === 'monthEnd'
        ? base.map((v, idx) => ({ ...v, periodEnd: periodEndBuf[idx] ?? null }))
        : base;
      const res = await fetch('/api/match-journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactions: bankOcr.transactions,
          vouchers,
          clientId: selectedClientId,
          accountingMethod,
          descriptionMode,
          save: false, // 照合時は DB 保存しない（部分登録対応）
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setJournalMatchResult({ results: data.results, summary: data.summary });
      if (data.logId) setCurrentMatchLogId(data.logId);
      // 摘要ルールによる未照合取引の科目自動提案を state に反映
      if (data.suggestedUnmatchedAccounts && typeof data.suggestedUnmatchedAccounts === 'object') {
        setUnmatchedTxAccounts((prev) => ({ ...data.suggestedUnmatchedAccounts, ...prev }));
      }
      // 登録状態リセット
      setRegisteredVoucherIdx(new Set());
      setSelectedVoucherIdx(new Set());
      setPeriodConfirmOpen(false);
    } catch (e) {
      setJournalError(e instanceof Error ? e.message : '照合エラー');
    } finally {
      setMatchProcessing(false);
    }
  };

  // 部分登録: 選択した voucher グループだけを DB に保存
  const handlePersistSelected = async (onlySelected: boolean) => {
    if (!journalMatchResult || persisting) return;
    const targetIdx: number[] = [];
    journalMatchResult.results.forEach((_, i) => {
      if (registeredVoucherIdx.has(i)) return;
      if (onlySelected && !selectedVoucherIdx.has(i)) return;
      targetIdx.push(i);
    });
    if (targetIdx.length === 0) {
      alert('登録対象がありません');
      return;
    }
    // 欠陥チェック（日付なし / 金額なし / 科目未入力）
    const invalidMsgs: string[] = [];
    const isValidDate = (d: string) => /^\d{8}$/.test(d);
    for (const i of targetIdx) {
      const r = journalMatchResult.results[i];
      const vendor = r.accrualEntries[0]?.voucher.vendorName || `#${i + 1}`;
      r.accrualEntries.forEach((e, j) => {
        const prefix = `${vendor}（計上 ${j + 1}/${r.accrualEntries.length}）`;
        if (!isValidDate(e.date)) invalidMsgs.push(`${prefix}: 日付が未入力`);
        if (e.amount == null || e.amount <= 0) invalidMsgs.push(`${prefix}: 金額が未入力`);
        if (!e.debitAccount?.trim()) invalidMsgs.push(`${prefix}: 借方科目が未入力`);
        if (!e.creditAccount?.trim()) invalidMsgs.push(`${prefix}: 貸方科目が未入力`);
      });
      if (r.paymentEntry) {
        if (!isValidDate(r.paymentEntry.date)) invalidMsgs.push(`${vendor}（支払消込）: 日付が未入力`);
        if (r.paymentEntry.amount == null || r.paymentEntry.amount <= 0) invalidMsgs.push(`${vendor}（支払消込）: 金額が未入力`);
        if (!r.paymentEntry.debitAccount?.trim()) invalidMsgs.push(`${vendor}（支払消込）: 借方科目が未入力`);
        if (!r.paymentEntry.creditAccount?.trim()) invalidMsgs.push(`${vendor}（支払消込）: 貸方科目が未入力`);
      }
    }
    if (invalidMsgs.length > 0) {
      alert(`以下の欠陥があるため登録できません:\n\n${invalidMsgs.slice(0, 20).join('\n')}${invalidMsgs.length > 20 ? `\n...他 ${invalidMsgs.length - 20} 件` : ''}`);
      return;
    }
    const groups = targetIdx.map((i) => {
      const r = journalMatchResult.results[i];
      const vendor = r.accrualEntries[0]?.voucher.vendorName ?? '';
      return {
        vendor_name: vendor,
        accrualEntries: r.accrualEntries.map((e) => ({
          date: e.date,
          debit_account: e.debitAccount,
          credit_account: e.creditAccount,
          amount: e.amount,
          description: e.description,
          tax_type: e.taxType,
          match_status: e.matchStatus,
          ocr_upload_id: e.voucher.ocrUploadId ?? null,
          bank_ocr_upload_id: r.paymentEntry?.transaction.ocrUploadId ?? null,
        })),
        paymentEntry: r.paymentEntry
          ? {
              date: r.paymentEntry.date,
              debit_account: r.paymentEntry.debitAccount,
              credit_account: r.paymentEntry.creditAccount,
              amount: r.paymentEntry.amount,
              description: r.paymentEntry.description,
              tax_type: r.paymentEntry.taxType,
              match_status: r.paymentEntry.matchStatus,
              ocr_upload_id: r.paymentEntry.voucher.ocrUploadId ?? null,
              bank_ocr_upload_id: r.paymentEntry.transaction.ocrUploadId ?? null,
            }
          : undefined,
        withholdingPaymentEntry: r.withholdingPaymentEntry
          ? {
              date: r.withholdingPaymentEntry.date,
              debit_account: r.withholdingPaymentEntry.debitAccount,
              credit_account: r.withholdingPaymentEntry.creditAccount,
              amount: r.withholdingPaymentEntry.amount,
              description: r.withholdingPaymentEntry.description,
              tax_type: r.withholdingPaymentEntry.taxType,
              match_status: r.withholdingPaymentEntry.matchStatus,
              ocr_upload_id: null,
              bank_ocr_upload_id: r.withholdingPaymentEntry.transaction.ocrUploadId ?? null,
            }
          : undefined,
      };
    });
    setPersisting(true);
    try {
      const res = await fetch('/api/journal-entries/persist-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: selectedClientId, groups }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '登録失敗');
      setRegisteredVoucherIdx((prev) => {
        const next = new Set(prev);
        for (const i of targetIdx) next.add(i);
        return next;
      });
      setSelectedVoucherIdx(new Set());
      const newAssets: Array<{ id: string; asset_number: number; name: string }> = data.newAssets ?? [];
      if (newAssets.length > 0) {
        alert(`${targetIdx.length} 件の仕訳を登録しました\n固定資産 ${newAssets.length} 件を検出しました。詳細登録画面を開きます。`);
        for (const a of newAssets) {
          window.open(`/fixed-assets/${a.id}`, '_blank');
        }
      } else {
        alert(`${targetIdx.length} 件の仕訳を登録しました`);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : '登録失敗');
    } finally {
      setPersisting(false);
    }
  };

  const handleResetJournal = () => {
    setBankFiles([]);
    setInvoiceFiles([]);
    setBankOcr(null);
    setInvoiceOcr(null);
    setJournalMatchResult(null);
    setJournalError(null);
    setUnmatchedTxAccounts({});
    setUnmatchedTxDescriptions({});
    setUnmatchedSelected(new Set());
    setUnmatchedBulkAccount('');
    setUnmatchedBulkDescription('');
    setWithholdingTaxBuf({});
    setRegisteredVoucherIdx(new Set());
    setSelectedVoucherIdx(new Set());
  };

  /** 仕訳CSVの行データを組み立てる */
  const buildJournalCsvRows = (): { header: string[]; rows: string[][] } => {
    const header = ['種別', '日付', '借方科目', '貸方科目', '金額', '摘要', '消費税区分', '照合ステータス', '照合スコア'];
    const rows: string[][] = [];
    if (!journalMatchResult) return { header, rows };
    for (const r of journalMatchResult.results) {
      for (const e of r.accrualEntries) {
        rows.push([
          '費用計上', e.date, e.debitAccount, e.creditAccount,
          e.amount != null ? String(e.amount) : '',
          e.description, e.taxType, e.matchStatus, '',
        ]);
      }
      if (r.paymentEntry) {
        const p = r.paymentEntry;
        rows.push([
          '支払消込', p.date, p.debitAccount, p.creditAccount,
          p.amount != null ? String(p.amount) : '',
          p.description, p.taxType, p.matchStatus, String(p.matchScore),
        ]);
      }
      if (r.withholdingPaymentEntry) {
        const p = r.withholdingPaymentEntry;
        rows.push([
          '源泉納付', p.date, p.debitAccount, p.creditAccount,
          p.amount != null ? String(p.amount) : '',
          p.description, p.taxType, p.matchStatus, String(p.matchScore),
        ]);
      }
    }
    const unmatched = journalMatchResult.summary.unmatchedTransactions ?? [];
    unmatched.forEach((tx, idx) => {
      const account = unmatchedTxAccounts[idx];
      if (!account) return;
      const desc = unmatchedTxDescriptions[idx] ?? tx.description;
      rows.push([
        '出金単独', tx.transactionDate, account, '普通預金',
        tx.debit != null ? String(tx.debit) : '',
        desc, '課税仕入10%', 'manual', '',
      ]);
    });
    return { header, rows };
  };

  const handleDownloadJournal = () => {
    const { header, rows } = buildJournalCsvRows();
    if (rows.length === 0) return;
    downloadCsv([header, ...rows], '自動仕訳.csv');
  };

  const [csvSaving, setCsvSaving] = useState(false);
  const [csvSaveSuccess, setCsvSaveSuccess] = useState(false);

  const handleSaveJournalCsv = async () => {
    const { header, rows } = buildJournalCsvRows();
    if (rows.length === 0) return;
    setCsvSaving(true);
    setCsvSaveSuccess(false);
    try {
      const bom = '\uFEFF';
      const csv = bom + [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const now = new Date();
      const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const clientLabel = clients.find((c) => c.id === selectedClientId)?.name || 'all';
      const fileName = `仕訳_${clientLabel}_${ts}.csv`;
      const fd = new FormData();
      fd.append('csv', blob, fileName);
      fd.append('fileName', fileName);
      if (selectedClientId) fd.append('clientId', selectedClientId);
      const res = await fetch('/api/journal-csv', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'CSV保存に失敗しました');
      setCsvSaveSuccess(true);
      setTimeout(() => setCsvSaveSuccess(false), 3000);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'CSV保存に失敗しました');
    } finally {
      setCsvSaving(false);
    }
  };

  // ─── クライアント管理ハンドラ ───────────────────────────────────────────────
  const handleAddClient = async () => {
    const name = newClientForm.name.trim();
    if (!name || clientSaving) return;
    setClientSaving(true);
    setClientError(null);
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          company_code: newClientForm.company_code.trim(),
          legal_name: newClientForm.legal_name.trim(),
          short_name: newClientForm.short_name.trim(),
          invoice_registration_number: newClientForm.invoice_registration_number.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '追加失敗');
      setClients((prev) => [...prev, data.client]);
      setNewClientForm({ company_code: '', name: '', legal_name: '', short_name: '', invoice_registration_number: '' });
      if (!selectedClientId) setSelectedClientId(data.client.id);
    } catch (e) {
      setClientError(e instanceof Error ? e.message : '追加に失敗しました');
    } finally {
      setClientSaving(false);
    }
  };

  const handleStartEditClient = (c: ClientItem) => {
    setEditingClientId(c.id);
    setEditingClientForm({
      company_code: c.company_code ?? '',
      name: c.name,
      legal_name: c.legal_name ?? '',
      short_name: c.short_name ?? '',
      invoice_registration_number: c.invoice_registration_number ?? '',
    });
    setClientError(null);
  };

  const handleSaveEditClient = async () => {
    if (!editingClientId || clientSaving) return;
    setClientSaving(true);
    setClientError(null);
    try {
      const res = await fetch(`/api/clients?id=${editingClientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingClientForm.name.trim(),
          company_code: editingClientForm.company_code.trim(),
          legal_name: editingClientForm.legal_name.trim(),
          short_name: editingClientForm.short_name.trim(),
          invoice_registration_number: editingClientForm.invoice_registration_number.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '更新失敗');
      setClients((prev) => prev.map((c) => (c.id === editingClientId ? data.client : c)));
      setEditingClientId(null);
    } catch (e) {
      setClientError(e instanceof Error ? e.message : '更新に失敗しました');
    } finally {
      setClientSaving(false);
    }
  };

  const handleDeleteClient = async (id: string) => {
    if (!confirm('このクライアントを削除しますか？')) return;
    try {
      await fetch(`/api/clients?id=${id}`, { method: 'DELETE' });
      setClients((prev) => prev.filter((c) => c.id !== id));
      if (selectedClientId === id) setSelectedClientId(null);
      if (editingClientId === id) setEditingClientId(null);
    } catch {
      // silent
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  // ファイルごとに請求書をグループ化（invoice / tax-return モードのみ使用）
  const invoicesByFile: Record<string, InvoiceResult[]> =
    result && (result.mode === 'invoice' || result.mode === 'tax-return')
      ? result.invoices.reduce(
          (acc, inv) => {
            if (!acc[inv.sourceFile]) acc[inv.sourceFile] = [];
            acc[inv.sourceFile].push(inv);
            return acc;
          },
          {} as Record<string, InvoiceResult[]>
        )
      : {};

  // ─── レンダリング ──────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-white relative overflow-x-hidden">

      {/* 背景: ごく薄いブラーグラデーション装飾（fixed で固定） */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        {/* 上部: 水色の光源 */}
        <div className="absolute -top-64 left-1/2 -translate-x-1/2 w-[900px] h-[700px]
          rounded-full bg-sky-100 opacity-40 blur-3xl" />
        {/* 右下: 薄い黄緑のアクセント */}
        <div className="absolute bottom-0 right-0 w-[500px] h-[400px]
          rounded-full bg-lime-50 opacity-60 blur-3xl" />
      </div>

      {/* ─── ヘッダー ─────────────────────────────────────────────────────── */}
      <header className="relative bg-white/70 backdrop-blur-md border-b border-slate-100/80 sticky top-0 z-20">
        <div className="max-w-[900px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">

          {/* ロゴ */}
          <button
            type="button"
            onClick={() => {
              setMode('invoice');
              setResult(null);
              setFiles([]);
              setError(null);
              setJournalSubView('execute');
            }}
            className="flex items-center gap-3 rounded-xl hover:opacity-80 transition-opacity
              focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            aria-label="ホームへ戻る"
          >
            {/* ロゴアイコン */}
            <div className="w-8 h-8 bg-sky-400 rounded-xl flex items-center justify-center
              shadow-sm shadow-sky-200 flex-shrink-0">
              <svg
                className="w-4 h-4 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-slate-900 leading-tight tracking-tight">
                Invoice OCR
              </p>
              <p className="text-[10px] text-slate-400 leading-tight tracking-widest uppercase">
                AI-Powered PDF Splitter
              </p>
            </div>
          </button>

          {/* 認証ボタン */}
          {user === undefined ? null : isGuest ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push('/lp/invoice')}
                className="text-xs font-semibold text-sky-600 bg-sky-50 border border-sky-200 rounded-xl
                  px-4 py-2 hover:bg-sky-100 hover:border-sky-300
                  transition-all duration-200 tracking-wide"
              >
                サービス紹介・料金
              </button>
              <button
                onClick={() => router.push('/login')}
                className="text-xs font-medium text-sky-500 border border-sky-200 rounded-xl
                  px-4 py-2 hover:bg-sky-50 hover:border-sky-300
                  transition-all duration-200 tracking-wide"
              >
                Googleでサインイン
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push('/lp/invoice')}
                className="text-xs font-medium text-slate-500 border border-slate-200 rounded-xl
                  px-4 py-2 hover:bg-slate-50 hover:text-slate-700
                  transition-all duration-200 tracking-wide"
              >
                サービス紹介
              </button>
              <button
                onClick={() => router.push('/history')}
                className="text-xs font-medium text-sky-600 border border-sky-200 rounded-xl
                  px-4 py-2 hover:bg-sky-50 hover:border-sky-300
                  transition-all duration-200 tracking-wide"
              >
                履歴
              </button>
              <button
                onClick={handleSignOut}
                className="text-xs text-slate-400 border border-slate-200 rounded-xl
                  px-4 py-2 hover:bg-slate-50 hover:text-slate-600
                  transition-all duration-200 tracking-wide"
              >
                サインアウト
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ─── メインコンテンツ ──────────────────────────────────────────────── */}
      <main className={`mx-auto px-4 sm:px-6 py-10 sm:py-14 relative space-y-6 ${
        (mode === 'journal-entry' && (journalSubView === 'ledger' || journalSubView === 'master' || journalSubView === 'unmatched' || journalSubView === 'bank-tx')) || mode === 'financial-statement' ? 'max-w-[1280px]' : 'max-w-[900px]'
      }`}>

        {/* ─── モード切替タブ ──────────────────────────────────────────────── */}
        {!result && !loading && (
          <div className="flex justify-center">
            <div className="inline-flex bg-slate-100 rounded-2xl p-1 gap-1 flex-wrap justify-center">
              {(
                [
                  { key: 'invoice', label: '請求書・領収書' },
                  { key: 'tax-return', label: '確定申告' },
                  { key: 'bank-statement', label: '通帳OCR' },
                  { key: 'journal-entry', label: '自動仕訳' },
                  { key: 'financial-statement', label: '決算書' },
                ] as const
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setMode(key); setFiles([]); setError(null); if (key === 'tax-return') setSelectedClientId(null); }}
                  className={`px-5 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                    mode === key
                      ? 'bg-white text-sky-500 shadow-sm'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ─── クライアント選択バー（ログインユーザーのみ、確定申告モードでは非表示） */}
        {!isGuest && user && !result && !loading && mode !== 'tax-return' && (
          <div className="flex justify-center">
            <div className="flex items-center gap-3 bg-white/70 border border-slate-100 rounded-2xl px-5 py-3 shadow-sm">
              <span className="text-xs text-slate-500 tracking-wide whitespace-nowrap">クライアント</span>
              <select
                value={selectedClientId || ''}
                onChange={(e) => {
                  const newId = e.target.value || null;
                  setSelectedClientId(newId);
                  // クライアント変更時にOCRデータ・照合結果をリセット
                  setBankOcr(null);
                  setInvoiceOcr(null);
                  setBankFiles([]);
                  setInvoiceFiles([]);
                  setJournalMatchResult(null);
                  setCurrentMatchLogId(null);
                  setRegisteredVoucherIdx(new Set());
                  setSelectedVoucherIdx(new Set());
                  setWithholdingTaxBuf({});
                  setUnmatchedTxAccounts({});
                  setUnmatchedTxDescriptions({});
                  setUnmatchedSelected(new Set());
                  setExistingUploads([]);
                  setSelectedBankUploadIds(new Set());
                  setSelectedInvoiceUploadIds(new Set());
                  // クライアント選択時に既存OCRデータ＋前回の照合結果を自動フェッチ
                  if (newId) {
                    fetchExistingUploads(newId);
                    restoreMatchLog(newId);
                  }
                }}
                className="text-sm bg-white border border-slate-200 rounded-xl px-3 py-1.5
                  text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300
                  transition-all duration-200 min-w-[160px]"
              >
                {/* 日記帳含む自動仕訳モードでは未選択を不可にする（誤って個人扱いで仕訳登録するのを防止） */}
                {mode !== 'journal-entry' && <option value="">未選択（個人）</option>}
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{clientDisplayLabel(c)}</option>
                ))}
              </select>
              <button
                onClick={() => setShowClientModal(true)}
                className="text-xs font-medium text-sky-500 border border-sky-200 rounded-xl
                  px-3 py-1.5 hover:bg-sky-50 hover:border-sky-300
                  transition-all duration-200 whitespace-nowrap"
              >
                管理
              </button>
            </div>
          </div>
        )}

        {/* ─── クライアント管理モーダル ─────────────────────────────────────── */}
        {showClientModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
            onClick={() => { setShowClientModal(false); setEditingClientId(null); setClientError(null); }}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 p-6 space-y-5 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-800">クライアント管理</h3>
                <button onClick={() => { setShowClientModal(false); setEditingClientId(null); setClientError(null); }}
                  className="text-slate-400 hover:text-slate-600 transition-colors">
                  <IconX className="w-5 h-5" />
                </button>
              </div>

              {/* 新規追加フォーム */}
              <div className="border border-slate-100 rounded-2xl p-4 bg-slate-50/40 space-y-3">
                <p className="text-xs font-semibold text-slate-500 tracking-wide">新規クライアント追加</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">会社番号（英数字・例: 443, a01）</label>
                    <input
                      type="text"
                      value={newClientForm.company_code}
                      onChange={(e) => setNewClientForm({ ...newClientForm, company_code: e.target.value })}
                      placeholder="443"
                      maxLength={8}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">略称（例: J41gk）</label>
                    <input
                      type="text"
                      value={newClientForm.short_name}
                      onChange={(e) => setNewClientForm({ ...newClientForm, short_name: e.target.value })}
                      placeholder="J41gk"
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-400 block mb-1">クライアント名（必須・社内表示用）</label>
                    <input
                      type="text"
                      value={newClientForm.name}
                      onChange={(e) => setNewClientForm({ ...newClientForm, name: e.target.value })}
                      placeholder="Jインフラ41号"
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-400 block mb-1">正式名（決算書に出力する正式社名）</label>
                    <input
                      type="text"
                      value={newClientForm.legal_name}
                      onChange={(e) => setNewClientForm({ ...newClientForm, legal_name: e.target.value })}
                      placeholder="Jインフラ41号合同会社"
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-400 block mb-1">適格請求書登録番号（T + 13桁）</label>
                    <input
                      type="text"
                      value={newClientForm.invoice_registration_number}
                      onChange={(e) => setNewClientForm({ ...newClientForm, invoice_registration_number: e.target.value })}
                      placeholder="T1234567890123"
                      maxLength={14}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400 font-mono"
                    />
                  </div>
                </div>
                <button
                  onClick={handleAddClient}
                  disabled={!newClientForm.name.trim() || clientSaving}
                  className="w-full px-4 py-2 rounded-xl text-sm font-medium text-white bg-sky-400 hover:bg-sky-500 disabled:opacity-40 transition-all duration-200 shadow-sm shadow-sky-200/60"
                >
                  {clientSaving ? '保存中...' : '追加'}
                </button>
              </div>

              {clientError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{clientError}</div>
              )}

              {/* クライアント一覧 */}
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {clients.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-6">
                    まだクライアントが登録されていません
                  </p>
                ) : (
                  clients.map((c) => editingClientId === c.id ? (
                    <div key={c.id} className="border border-sky-200 bg-sky-50/30 rounded-xl px-4 py-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={editingClientForm.company_code}
                          onChange={(e) => setEditingClientForm({ ...editingClientForm, company_code: e.target.value })}
                          placeholder="会社番号"
                          maxLength={8}
                          className="text-xs border border-slate-200 rounded px-2 py-1.5 font-mono"
                        />
                        <input
                          type="text"
                          value={editingClientForm.short_name}
                          onChange={(e) => setEditingClientForm({ ...editingClientForm, short_name: e.target.value })}
                          placeholder="略称"
                          className="text-xs border border-slate-200 rounded px-2 py-1.5"
                        />
                        <input
                          type="text"
                          value={editingClientForm.name}
                          onChange={(e) => setEditingClientForm({ ...editingClientForm, name: e.target.value })}
                          placeholder="クライアント名"
                          className="text-xs border border-slate-200 rounded px-2 py-1.5 col-span-2"
                        />
                        <input
                          type="text"
                          value={editingClientForm.legal_name}
                          onChange={(e) => setEditingClientForm({ ...editingClientForm, legal_name: e.target.value })}
                          placeholder="正式名"
                          className="text-xs border border-slate-200 rounded px-2 py-1.5 col-span-2"
                        />
                        <input
                          type="text"
                          value={editingClientForm.invoice_registration_number}
                          onChange={(e) => setEditingClientForm({ ...editingClientForm, invoice_registration_number: e.target.value })}
                          placeholder="T + 13桁（例: T1234567890123）"
                          maxLength={14}
                          className="text-xs border border-slate-200 rounded px-2 py-1.5 col-span-2 font-mono"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={handleSaveEditClient} disabled={clientSaving}
                          className="text-xs text-white bg-sky-500 rounded-lg px-3 py-1.5 hover:bg-sky-600 disabled:opacity-40">保存</button>
                        <button onClick={() => { setEditingClientId(null); setClientError(null); }}
                          className="text-xs text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50">キャンセル</button>
                        <div className="flex-1" />
                        <button onClick={() => handleDeleteClient(c.id)}
                          className="text-xs text-red-500 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-50">削除</button>
                      </div>
                    </div>
                  ) : (
                    <div key={c.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 group">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-700 font-medium tabular-nums">{clientDisplayLabel(c)}</div>
                        {c.legal_name && <div className="text-[10px] text-slate-400 truncate">{c.legal_name}</div>}
                        {c.invoice_registration_number && (
                          <div className="text-[9px] text-sky-600 font-mono">{c.invoice_registration_number}</div>
                        )}
                      </div>
                      <button onClick={() => handleStartEditClient(c)}
                        className="text-[11px] text-sky-500 border border-sky-200 rounded-lg px-2.5 py-1 hover:bg-sky-50 mr-2 opacity-0 group-hover:opacity-100 transition-opacity">編集</button>
                      <button
                        onClick={() => handleDeleteClient(c.id)}
                        className="text-slate-300 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                        title="削除"
                      >
                        <IconX className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* 使用量バー（ログインユーザーのみ・初期表示） */}
        {!isGuest && usageInfo && !result && !loading && (
          <div className="flex justify-center">
            <div className="flex items-center gap-3 bg-white/70 border border-slate-100 rounded-2xl px-5 py-3 shadow-sm">
              <span className="text-xs text-slate-500 tracking-wide whitespace-nowrap">今月の使用量</span>
              <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    usageInfo.count / usageInfo.limit >= 0.9
                      ? 'bg-red-400'
                      : usageInfo.count / usageInfo.limit >= 0.7
                      ? 'bg-amber-400'
                      : 'bg-sky-400'
                  }`}
                  style={{ width: `${Math.min((usageInfo.count / usageInfo.limit) * 100, 100)}%` }}
                />
              </div>
              <span className="text-xs font-semibold text-slate-700 tabular-nums whitespace-nowrap">
                {usageInfo.count}<span className="text-slate-400 font-normal">/{usageInfo.limit}件</span>
              </span>
            </div>
          </div>
        )}

        {/* キャッチコピー（初期表示のみ） */}
        {files.length === 0 && !result && !loading && (
          <div className="text-center pb-4">
            {mode === 'invoice' && (
              <>
                <h2 className="text-2xl sm:text-[2rem] font-light text-slate-800 tracking-tight leading-snug">
                  複数の請求書PDFを<span className="text-sky-400 font-semibold"> AI </span>で自動整理
                </h2>
                <p className="text-sm text-slate-400 mt-2 tracking-wider">
                  アップロードするだけで、1件1ファイルに分割・命名まで完了
                </p>
              </>
            )}
            {mode === 'tax-return' && (
              <>
                <h2 className="text-2xl sm:text-[2rem] font-light text-slate-800 tracking-tight leading-snug">
                  確定申告書類を<span className="text-sky-400 font-semibold"> AI </span>で自動整理
                </h2>
                <p className="text-sm text-slate-400 mt-2 tracking-wider">
                  申告書・決算書・明細書・寄付金受領証明書・医療費明細書をまとめてアップロード → 1書類1ファイルに分割
                </p>
              </>
            )}
            {mode === 'bank-statement' && (
              <>
                <h2 className="text-2xl sm:text-[2rem] font-light text-slate-800 tracking-tight leading-snug">
                  通帳・口座明細を<span className="text-sky-400 font-semibold"> AI </span>でデータ化
                </h2>
                <p className="text-sm text-slate-400 mt-2 tracking-wider">
                  通帳PDFをアップロード → 取引一覧をCSVで出力
                </p>
              </>
            )}
            {mode === 'journal-entry' && (
              <>
                <h2 className="text-2xl sm:text-[2rem] font-light text-slate-800 tracking-tight leading-snug">
                  通帳 × 請求書を<span className="text-sky-400 font-semibold"> AI </span>で自動照合・仕訳
                </h2>
                <p className="text-sm text-slate-400 mt-2 tracking-wider">
                  通帳と請求書をそれぞれアップロード → 金額・日付・相手先で照合 → 仕訳CSV出力
                </p>
              </>
            )}
            {mode === 'financial-statement' && (
              <>
                <h2 className="text-2xl sm:text-[2rem] font-light text-slate-800 tracking-tight leading-snug">
                  仕訳日記帳から<span className="text-sky-400 font-semibold"> 決算書 </span>を自動生成
                </h2>
                <p className="text-sm text-slate-400 mt-2 tracking-wider">
                  会計期間を指定 → P/L・B/S を集計 → PDF 出力
                </p>
              </>
            )}
          </div>
        )}

        {/* ─── 未サインイン時のロック画面（自動仕訳・決算書） ─────────────── */}
        {(mode === 'journal-entry' || mode === 'financial-statement') && isGuest && (
          <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center shadow-sm max-w-xl mx-auto">
            <div className="text-slate-200 flex justify-center mb-5">
              <IconLock className="w-10 h-10" />
            </div>
            <p className="text-base font-semibold text-slate-800 mb-1.5 tracking-tight">
              この機能はサインインが必要です
            </p>
            <p className="text-sm text-slate-400 mb-8 leading-relaxed">
              {mode === 'journal-entry' ? '自動仕訳' : '決算書'}機能をご利用いただくには
              <br className="sm:hidden" />Googleアカウントでサインインしてください
            </p>
            <button
              onClick={() => router.push('/login')}
              className="px-8 py-3 rounded-xl bg-sky-400 text-white text-sm font-semibold
                hover:bg-sky-500 hover:-translate-y-0.5 active:translate-y-0
                transition-all duration-200 shadow-md shadow-sky-200/60 tracking-wide"
            >
              Googleでサインイン
            </button>
          </div>
        )}

        {/* ─── 自動仕訳モード専用UI ────────────────────────────────────────── */}
        {mode === 'journal-entry' && !isGuest && (
          <section className="space-y-5">
            {/* サブビュー切替: 実行 / 日記帳 / 残高 / マスタ + 常駐のエラー報告ボタン */}
            <div className="relative max-w-xl mx-auto">
              <div className="flex items-center justify-center gap-1 bg-slate-100/60 rounded-xl p-1">
                {([
                  { key: 'execute', label: '仕訳実行' },
                  { key: 'unmatched', label: '未照合' },
                  { key: 'bank-tx', label: '入出金明細' },
                  { key: 'ledger', label: '日記帳' },
                  { key: 'balance', label: '残高' },
                  { key: 'master', label: 'マスタ' },
                ] as const).map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setJournalSubView(item.key)}
                    className={`flex-1 text-xs font-semibold px-4 py-2 rounded-lg transition-all tracking-wide ${
                      journalSubView === item.key
                        ? 'bg-white text-sky-600 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={openReportModal}
                className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-[calc(100%+8px)] inline-flex items-center gap-1 text-[11px] text-amber-700 border border-amber-200 bg-amber-50 rounded-lg px-2.5 py-1.5 hover:bg-amber-100 transition-all whitespace-nowrap"
                title="この画面について開発者にフィードバックを送る"
              >
                <IconAlertCircle className="w-3 h-3" />
                エラー報告
              </button>
            </div>

            {journalError && journalSubView === 'execute' && (
              <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-3 text-sm text-red-600">
                {journalError}
              </div>
            )}

            {journalSubView === 'unmatched' ? (
              <div className="space-y-5">
                {/* 未登録の仕訳（照合済みだが DB にまだ保存されていないもの） */}
                {journalMatchResult && journalMatchResult.results.some((_, i) => !registeredVoucherIdx.has(i)) && (
                  <div className="space-y-3">
                    <div className="bg-white border border-sky-100 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 tracking-tight">
                          未登録の仕訳 <span className="text-sky-600">
                            {journalMatchResult.results.filter((_, i) => !registeredVoucherIdx.has(i)).length}
                          </span> 件
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          照合済みですが、まだ DB に保存されていません。チェックして「選択を登録」か「残り全て登録」で確定できます。
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => handlePersistSelected(true)}
                          disabled={persisting || selectedVoucherIdx.size === 0}
                          className="text-xs text-white bg-sky-500 rounded-xl px-4 py-2 font-semibold hover:bg-sky-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          選択を登録（{selectedVoucherIdx.size}）
                        </button>
                        <button
                          onClick={() => handlePersistSelected(false)}
                          disabled={persisting}
                          className="text-xs text-white bg-lime-600 rounded-xl px-4 py-2 font-semibold hover:bg-lime-700 transition-all disabled:opacity-40"
                        >
                          残り全て登録
                        </button>
                        <button
                          onClick={() => setJournalSubView('execute')}
                          className="text-xs text-slate-500 border border-slate-200 rounded-xl px-3 py-2 hover:bg-slate-50"
                        >
                          仕訳実行タブへ
                        </button>
                      </div>
                    </div>
                    <MatchResultTable
                      journalMatchResult={journalMatchResult}
                      setJournalMatchResult={setJournalMatchResult}
                      accountsList={accountsList}
                      addAccountLocal={addAccountLocal}
                      selectedVoucherIdx={selectedVoucherIdx}
                      setSelectedVoucherIdx={setSelectedVoucherIdx}
                      registeredVoucherIdx={registeredVoucherIdx}
                      showVoucherPdf={showVoucherPdf}
                      showTransactionPdf={showTransactionPdf}
                      onCreateVendorRule={async (vendorName, debitAccount) => {
                        if (!vendorName.trim() || !debitAccount.trim()) return;
                        await addRule('vendor', vendorName, debitAccount);
                        alert(`取引先ルールを追加しました: ${vendorName} → ${debitAccount}`);
                      }}
                      onlyUnregistered
                    />
                  </div>
                )}

                {/* 証憑がない入出金（従来の未照合） */}
                <UnmatchedView
                  transactions={(journalMatchResult?.summary.unmatchedTransactions ?? []).filter((_, i) => !consumedUnmatchedIdx.has(i))}
                  accounts={unmatchedTxAccounts}
                  setAccounts={setUnmatchedTxAccounts}
                  descriptions={unmatchedTxDescriptions}
                  setDescriptions={setUnmatchedTxDescriptions}
                  selected={unmatchedSelected}
                  setSelected={setUnmatchedSelected}
                  bulkAccount={unmatchedBulkAccount}
                  setBulkAccount={setUnmatchedBulkAccount}
                  bulkDescription={unmatchedBulkDescription}
                  setBulkDescription={setUnmatchedBulkDescription}
                  accountsList={accountsList}
                  vendorsList={vendorsList}
                  addAccountLocal={addAccountLocal}
                  onShowPdf={showTransactionPdf}
                  onGoExecute={() => setJournalSubView('execute')}
                />
              </div>
            ) : journalSubView === 'ledger' ? (
              <LedgerView
                refreshKey={ledgerRefreshKey}
                accountFilter={ledgerAccountFilter}
                setAccountFilter={setLedgerAccountFilter}
                clientId={selectedClientId}
                clientName={clients.find((c) => c.id === selectedClientId)?.name ?? null}
                onSaveField={handleSaveField}
                onBulkDelete={handleBulkDelete}
                onClose={handleCloseAt}
                onReopen={handleReopenClosing}
                accountsList={accountsList}
                addAccountLocal={addAccountLocal}
                vendorsList={vendorsList}
                addVendorLocal={addVendorLocal}
                onAddRule={addRule}
                departmentsList={departmentsList}
              />
            ) : journalSubView === 'balance' ? (
              <BalanceView
                clientName={clients.find((c) => c.id === selectedClientId)?.name ?? null}
                clientId={selectedClientId}
                onRefresh={bumpLedgerRefresh}
                accountsList={accountsList}
                onOpenGeneralLedger={(account, vendor, from, to) => {
                  // 総勘定元帳を新しいタブで開く（複数科目を並べて見られるように）
                  // 残高画面で絞り込んでいた期間を URL に乗せて引き継ぐ
                  const params = new URLSearchParams();
                  if (selectedClientId) params.set('clientId', selectedClientId);
                  if (account) params.set('account', account);
                  if (vendor) params.set('vendor', vendor);
                  if (from) params.set('from', from);
                  if (to) params.set('to', to);
                  window.open(`/general-ledger?${params.toString()}`, '_blank');
                }}
                unmatchedTransactions={journalMatchResult?.summary.unmatchedTransactions ?? []}
                consumedUnmatchedIdx={consumedUnmatchedIdx}
                onConsumeUnmatched={(idx) => setConsumedUnmatchedIdx((prev) => new Set(prev).add(idx))}
              />
            ) : journalSubView === 'bank-tx' ? (
              <BankTransactionsView
                clientId={selectedClientId}
                clientName={clients.find((c) => c.id === selectedClientId)?.name ?? null}
                accountsList={accountsList}
                addAccountLocal={addAccountLocal}
                onRefreshLedger={bumpLedgerRefresh}
              />
            ) : journalSubView === 'master' ? (
              <MasterView
                accountsList={accountsList}
                vendorsList={vendorsList}
                clients={clients}
                onReloadAccounts={fetchAccounts}
                onReloadVendors={fetchVendors}
                onCreateAccount={addAccountLocal}
                onCreateVendor={addVendorLocal}
                rulesList={rulesList}
                onCreateRule={addRule}
                onDeleteRule={deleteRule}
              />
            ) : journalMatchResult ? (
              <div className="space-y-4">
                {/* サマリー */}
                <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-lime-100/60 flex items-center justify-center">
                      <IconCheck className="w-4 h-4 text-lime-500" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-slate-900 tracking-tight">
                        {journalMatchResult.summary.total} 件の証票を処理
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        自動照合 {journalMatchResult.summary.autoMatched} 件 ·
                        要確認 {journalMatchResult.summary.needsReview} 件 ·
                        未照合 {journalMatchResult.summary.unmatched} 件
                        {registeredVoucherIdx.size > 0 && (
                          <span className="ml-2 text-lime-600">· 登録済 {registeredVoucherIdx.size} 件</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={handleResetJournal}
                      className="text-xs text-slate-500 border border-slate-200 rounded-xl px-4 py-2.5 hover:bg-slate-50 transition-all duration-200 tracking-wide"
                    >
                      最初からやり直す
                    </button>
                    <button
                      onClick={openReportModal}
                      className="inline-flex items-center gap-1.5 text-xs text-amber-700 border border-amber-200 bg-amber-50 rounded-xl px-4 py-2.5 hover:bg-amber-100 transition-all duration-200 tracking-wide"
                    >
                      <IconAlertCircle className="w-3.5 h-3.5" />
                      エラー報告
                    </button>
                    <button
                      onClick={() => handlePersistSelected(true)}
                      disabled={persisting || selectedVoucherIdx.size === 0}
                      className="text-xs text-white bg-sky-500 rounded-xl px-4 py-2.5 font-semibold hover:bg-sky-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed tracking-wide"
                    >
                      選択を登録（{selectedVoucherIdx.size}）
                    </button>
                    <button
                      onClick={() => handlePersistSelected(false)}
                      disabled={persisting}
                      className="text-xs text-white bg-lime-600 rounded-xl px-4 py-2.5 font-semibold hover:bg-lime-700 transition-all disabled:opacity-40 tracking-wide"
                    >
                      残り全て登録
                    </button>
                    <button
                      onClick={handleDownloadJournal}
                      className="inline-flex items-center gap-1.5 text-xs text-white bg-lime-500 rounded-xl px-4 py-2.5 font-semibold hover:bg-lime-600 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 shadow-sm shadow-lime-200/60 tracking-wide"
                    >
                      <IconArchive className="w-3.5 h-3.5" />
                      CSV DL
                    </button>
                  </div>
                </div>

                {/* 仕訳テーブル */}
                <MatchResultTable
                  journalMatchResult={journalMatchResult}
                  setJournalMatchResult={setJournalMatchResult}
                  accountsList={accountsList}
                  addAccountLocal={addAccountLocal}
                  selectedVoucherIdx={selectedVoucherIdx}
                  setSelectedVoucherIdx={setSelectedVoucherIdx}
                  registeredVoucherIdx={registeredVoucherIdx}
                  showVoucherPdf={showVoucherPdf}
                  showTransactionPdf={showTransactionPdf}
                  onCreateVendorRule={async (vendorName, debitAccount) => {
                    if (!vendorName.trim() || !debitAccount.trim()) return;
                    await addRule('vendor', vendorName, debitAccount);
                    alert(`取引先ルールを追加しました: ${vendorName} → ${debitAccount}`);
                  }}
                />
                <p className="text-[11px] text-slate-400 px-2 leading-relaxed">
                  行をクリックで元PDF表示 / 科目セルをクリックで編集・新規作成 / チェックした行だけ先に登録できます。
                  <br />
                  「🏷️ ルール登録」ボタンで「この相手先は常にこの科目」という自動仕訳ルールをマスタに登録できます。
                </p>

                {/* 証憑なしの入出金は「未照合」タブで編集 */}
                {journalMatchResult.summary.unmatchedTransactions && journalMatchResult.summary.unmatchedTransactions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setJournalSubView('unmatched')}
                    className="w-full bg-amber-50/60 border border-amber-100 rounded-2xl px-5 py-4 text-left hover:bg-amber-50 transition-colors"
                  >
                    <p className="text-sm font-semibold text-amber-700 tracking-tight">
                      証憑がない出金が {journalMatchResult.summary.unmatchedTransactions.length} 件あります →
                    </p>
                    <p className="text-[11px] text-amber-500/80 mt-0.5 tracking-wide">
                      「未照合」タブで勘定科目を割り当ててください（一括選択可）
                    </p>
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
              {/* 新規 / 既存データ 切替 */}
              {selectedClientId && (
                <div className="flex items-center gap-2 bg-white border border-slate-100 rounded-2xl p-1 shadow-sm max-w-xs">
                  {([
                    { key: 'new' as const, label: '新規アップロード' },
                    { key: 'existing' as const, label: '既存データから再照合' },
                  ]).map((item) => (
                    <button
                      key={item.key}
                      onClick={() => {
                        setJournalInputMode(item.key);
                        if (item.key === 'existing' && selectedClientId) fetchExistingUploads(selectedClientId);
                      }}
                      className={`flex-1 text-xs font-semibold px-3 py-2 rounded-xl transition-all ${
                        journalInputMode === item.key
                          ? 'bg-sky-50 text-sky-600 shadow-sm border border-sky-200'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}

              {/* ─── 既存データ復元バナー（新規モードで既存データがある場合） ─── */}
              {journalInputMode === 'new' && selectedClientId && existingUploads.length > 0 && !bankOcr && !invoiceOcr && (
                <div className="bg-sky-50 border border-sky-200 rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-sky-800">前回のOCRデータがあります</p>
                    <p className="text-[11px] text-sky-600 mt-0.5">
                      請求書 {existingUploads.filter(u => u.mode === 'invoice-single').length}件のOCR済みデータ（未反映 {existingUploads.filter(u => u.mode === 'invoice-single' && u.journalEntryCount === 0).length}件）
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setJournalInputMode('existing');
                    }}
                    className="text-xs font-semibold text-white bg-sky-500 hover:bg-sky-600 rounded-xl px-4 py-2.5 transition-colors whitespace-nowrap"
                  >
                    既存データから復元
                  </button>
                </div>
              )}

              {/* ─── 既存データから再照合（請求書のみ） ─── */}
              {journalInputMode === 'existing' && selectedClientId ? (
                <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-800 tracking-tight">請求書を選択して再照合</p>
                    <p className="text-xs text-slate-400 mt-0.5">仕訳未反映の請求書を選択してください（ドラッグで複数選択可）。通帳データは自動で読み込まれます。</p>
                  </div>
                  {existingUploadsLoading ? (
                    <p className="text-xs text-slate-400">読み込み中...</p>
                  ) : (() => {
                    const unmatchedInvoices = existingUploads.filter((u) => u.mode === 'invoice-single' && u.journalEntryCount === 0);
                    const matchedInvoices = existingUploads.filter((u) => u.mode === 'invoice-single' && u.journalEntryCount > 0);
                    const bankCount = existingUploads.filter((u) => u.mode === 'bank-statement').length;
                    return unmatchedInvoices.length === 0 && matchedInvoices.length === 0 ? (
                      <p className="text-xs text-slate-400">この法人にはまだ請求書のOCRデータがありません。「新規アップロード」で作成してください。</p>
                    ) : (
                      <>
                        {bankCount > 0 && (
                          <div className="flex items-center gap-2 text-xs text-sky-600 bg-sky-50 rounded-xl px-3 py-2">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" /></svg>
                            通帳 {bankCount}件が自動で照合に使用されます
                          </div>
                        )}
                        {/* 未反映の請求書（選択可能） */}
                        {unmatchedInvoices.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">未反映の請求書（{unmatchedInvoices.length}件）</p>
                              <button
                                type="button"
                                onClick={() => {
                                  const allIds = unmatchedInvoices.map((u) => u.id);
                                  const allSelected = allIds.every((id) => selectedInvoiceUploadIds.has(id));
                                  setSelectedInvoiceUploadIds(allSelected ? new Set() : new Set(allIds));
                                }}
                                className="text-[10px] text-sky-500 hover:text-sky-600 font-medium"
                              >
                                {unmatchedInvoices.every((u) => selectedInvoiceUploadIds.has(u.id)) ? 'すべて解除' : 'すべて選択'}
                              </button>
                            </div>
                            <div
                              className="space-y-1.5 select-none"
                              onMouseLeave={() => setIsListDragging(false)}
                            >
                              {unmatchedInvoices.map((u) => (
                                <div
                                  key={u.id}
                                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                                    selectedInvoiceUploadIds.has(u.id) ? 'border-sky-300 bg-sky-50/40' : 'border-slate-100 hover:border-slate-200'
                                  }`}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    const willSelect = !selectedInvoiceUploadIds.has(u.id);
                                    setIsListDragging(true);
                                    setDragSelecting(willSelect);
                                    setSelectedInvoiceUploadIds((prev) => {
                                      const next = new Set(prev);
                                      willSelect ? next.add(u.id) : next.delete(u.id);
                                      return next;
                                    });
                                  }}
                                  onMouseEnter={() => {
                                    if (!isListDragging) return;
                                    setSelectedInvoiceUploadIds((prev) => {
                                      const next = new Set(prev);
                                      dragSelecting ? next.add(u.id) : next.delete(u.id);
                                      return next;
                                    });
                                  }}
                                  onMouseUp={() => setIsListDragging(false)}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedInvoiceUploadIds.has(u.id)}
                                    readOnly
                                    className="rounded border-slate-300 text-sky-500 focus:ring-sky-400 pointer-events-none"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-slate-700 truncate">{u.fileName}</p>
                                    <p className="text-[10px] text-slate-400">
                                      {u.itemCount}件の証票 · {new Date(u.createdAt).toLocaleDateString('ja-JP')}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleDeleteUpload(u.id); }}
                                    disabled={deletingUploadId === u.id}
                                    className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                                    title="この証票を削除"
                                  >
                                    {deletingUploadId === u.id ? (
                                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>
                                    ) : (
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    )}
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* 反映済みの請求書（参考表示） */}
                        {matchedInvoices.length > 0 && (
                          <details className="group">
                            <summary className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-500 list-none flex items-center gap-1">
                              <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                              反映済み（{matchedInvoices.length}件）
                            </summary>
                            <div className="space-y-1.5 mt-1.5">
                              {matchedInvoices.map((u) => (
                                <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-50 bg-slate-50/50 opacity-60">
                                  <svg className="w-4 h-4 text-lime-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-slate-500 truncate">{u.fileName}</p>
                                    <p className="text-[10px] text-slate-400">
                                      {u.itemCount}件の証票 · 仕訳{u.journalEntryCount}件 · {new Date(u.createdAt).toLocaleDateString('ja-JP')}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                        <button
                          onClick={handleLoadExistingData}
                          disabled={loadingExistingData || selectedInvoiceUploadIds.size === 0}
                          className="w-full bg-sky-400 text-white text-xs font-semibold rounded-xl py-2.5 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
                        >
                          {loadingExistingData ? 'データ読み込み中...' : `選択した請求書で照合を実行（${selectedInvoiceUploadIds.size}件）`}
                        </button>
                        {(bankOcr || invoiceOcr) && (
                          <div className="flex items-center gap-2 text-xs text-lime-600 bg-lime-50 rounded-xl px-3 py-2">
                            <IconCheck className="w-4 h-4" />
                            データ読み込み済み — 下の設定で照合を実行してください
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              ) : (
              /* 2パネルアップロード（新規） */
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                {/* 通帳パネル */}
                <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-800 tracking-tight">① 通帳 / 口座明細</p>
                    <p className="text-xs text-slate-400 mt-0.5">入出金データを抽出します</p>
                  </div>
                  <input
                    ref={bankFileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      addPdfFiles(e.target.files, setBankFiles);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => bankFileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setBankDragOver(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setBankDragOver(false); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setBankDragOver(false);
                      addPdfFiles(e.dataTransfer.files, setBankFiles);
                    }}
                    className={`w-full border-2 border-dashed rounded-xl p-4 text-xs transition-all duration-200 ${
                      bankDragOver
                        ? 'border-sky-400 bg-sky-50 text-sky-600'
                        : 'border-slate-200 text-slate-400 hover:border-sky-300 hover:text-sky-500'
                    }`}
                  >
                    <IconUpload className="w-6 h-6 mx-auto mb-2" />
                    PDFをドラッグ＆ドロップ または クリックで選択
                  </button>
                  {bankFiles.length > 0 && (
                    <div className="space-y-1">
                      {bankFiles.map((f, i) => (
                        <div key={i} className="flex items-center justify-between text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-1.5">
                          <span className="truncate max-w-[160px]">{f.name}</span>
                          <button onClick={() => setBankFiles(prev => prev.filter((_, j) => j !== i))} className="text-slate-300 hover:text-red-400 ml-2">
                            <IconX className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {bankOcr ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs text-lime-600 bg-lime-50 rounded-xl px-3 py-2">
                        <IconCheck className="w-4 h-4" />
                        {bankOcr.transactions.length}件の取引を抽出済み
                      </div>
                      {/* 口座マスタ紐付け */}
                      <div className="border border-slate-100 rounded-xl p-2 space-y-2 bg-slate-50/40">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">口座 → 預金科目</p>
                        {bankOcr.files.map((f, i) => (
                          <div key={i} className="space-y-1 pb-2 border-b border-slate-100 last:border-b-0 last:pb-0">
                            <div className="text-[11px] text-slate-600 font-medium truncate">
                              {f.bankName} <span className="text-slate-400">{f.accountNumber}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <div className="flex-1 min-w-0">
                                <AccountCombobox
                                  value={f.depositAccount}
                                  onChange={(v) => updateBankAccountDeposit(i, v)}
                                  onCommit={(v) => updateBankAccountDeposit(i, v)}
                                  accounts={accountsList}
                                  onCreate={addAccountLocal}
                                  dense
                                />
                              </div>
                              <button
                                type="button"
                                disabled={f.saving || !f.bankName || f.bankName === '不明' || !f.accountNumber || f.accountNumber === '不明'}
                                onClick={() => saveBankAccountMapping(i)}
                                className="text-[10px] text-sky-600 border border-sky-200 bg-sky-50 hover:bg-sky-100 rounded-md px-2 py-1 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                                title="この口座と預金科目の紐付けを保存（次回OCR時に自動復元）"
                              >
                                {f.saving ? '保存中…' : f.mappingId ? '更新' : '保存'}
                              </button>
                            </div>
                          </div>
                        ))}
                        <p className="text-[9px] text-slate-400 leading-relaxed">
                          保存しておくと次回の通帳OCR時に自動で同じ預金科目が割り当てられます。<br />
                          仕訳照合時、この口座の入出金は上記科目で起票されます。
                        </p>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={handleBankProcess}
                      disabled={bankFiles.length === 0 || bankProcessing}
                      className="w-full bg-sky-400 text-white text-xs font-semibold rounded-xl py-2.5 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
                    >
                      {bankProcessing ? '解析中...' : 'OCRで抽出'}
                    </button>
                  )}
                </div>

                {/* 請求書パネル */}
                <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-800 tracking-tight">② 請求書 / 領収書</p>
                    <p className="text-xs text-slate-400 mt-0.5">相手先・金額・日付を抽出します</p>
                  </div>
                  <input
                    ref={invoiceFileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      addPdfFiles(e.target.files, setInvoiceFiles);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => invoiceFileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setInvoiceDragOver(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setInvoiceDragOver(false); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setInvoiceDragOver(false);
                      addPdfFiles(e.dataTransfer.files, setInvoiceFiles);
                    }}
                    className={`w-full border-2 border-dashed rounded-xl p-4 text-xs transition-all duration-200 ${
                      invoiceDragOver
                        ? 'border-sky-400 bg-sky-50 text-sky-600'
                        : 'border-slate-200 text-slate-400 hover:border-sky-300 hover:text-sky-500'
                    }`}
                  >
                    <IconUpload className="w-6 h-6 mx-auto mb-2" />
                    PDF・画像をドラッグ＆ドロップ または クリックで選択
                  </button>
                  {invoiceFiles.length > 0 && (
                    <div className="space-y-1">
                      {invoiceFiles.map((f, i) => (
                        <div key={i} className="flex items-center justify-between text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-1.5">
                          <span className="truncate max-w-[160px]">{f.name}</span>
                          <button onClick={() => setInvoiceFiles(prev => prev.filter((_, j) => j !== i))} className="text-slate-300 hover:text-red-400 ml-2">
                            <IconX className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {invoiceOcr ? (
                    <div className="flex items-center gap-2 text-xs text-lime-600 bg-lime-50 rounded-xl px-3 py-2">
                      <IconCheck className="w-4 h-4" />
                      {invoiceOcr.count}件の証票を抽出済み
                    </div>
                  ) : (
                    <button
                      onClick={handleInvoiceProcess}
                      disabled={invoiceFiles.length === 0 || invoiceProcessing}
                      className="w-full bg-sky-400 text-white text-xs font-semibold rounded-xl py-2.5 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
                    >
                      {invoiceProcessing ? '解析中...' : 'OCRで抽出'}
                    </button>
                  )}
                </div>
              </div>
              )}
              </div>
            )}

            {/* 経理方式 + 摘要モード */}
            {!journalMatchResult && bankOcr && invoiceOcr && (
              <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-4">
                <div>
                  <p className="text-sm font-semibold text-slate-700 tracking-tight mb-3">計上方式</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <label className={`cursor-pointer border rounded-xl p-3 transition-all ${
                      accountingMethod === 'cash' ? 'border-lime-400 bg-lime-50/40' : 'border-slate-200 hover:border-slate-300'
                    }`}>
                      <input
                        type="radio"
                        name="accountingMethod"
                        value="cash"
                        checked={accountingMethod === 'cash'}
                        onChange={() => setAccountingMethod('cash')}
                        className="mr-2"
                      />
                      <span className="text-sm font-semibold text-slate-700">① 現金主義</span>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed pl-5">
                        支払日に費用 / 普通預金 を直接計上（シンプル）
                      </p>
                    </label>
                    <label className={`cursor-pointer border rounded-xl p-3 transition-all ${
                      accountingMethod === 'accrual' ? 'border-sky-400 bg-sky-50/40' : 'border-slate-200 hover:border-slate-300'
                    }`}>
                      <input
                        type="radio"
                        name="accountingMethod"
                        value="accrual"
                        checked={accountingMethod === 'accrual'}
                        onChange={() => setAccountingMethod('accrual')}
                        className="mr-2"
                      />
                      <span className="text-sm font-semibold text-slate-700">② 請求書日</span>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed pl-5">
                        請求書日で費用計上 → 支払日で未払消込（発生主義）
                      </p>
                    </label>
                    <label className={`cursor-pointer border rounded-xl p-3 transition-all ${
                      accountingMethod === 'monthEnd' ? 'border-violet-400 bg-violet-50/40' : 'border-slate-200 hover:border-slate-300'
                    }`}>
                      <input
                        type="radio"
                        name="accountingMethod"
                        value="monthEnd"
                        checked={accountingMethod === 'monthEnd'}
                        onChange={() => setAccountingMethod('monthEnd')}
                        className="mr-2"
                      />
                      <span className="text-sm font-semibold text-slate-700">③ 役務提供月末</span>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed pl-5">
                        摘要から「〇月分」等を読み取り、その月の月末に計上（照合前に確認）
                      </p>
                    </label>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-semibold text-slate-700 tracking-tight mb-3">摘要</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className={`cursor-pointer border rounded-xl p-3 transition-all ${
                      descriptionMode === 'vendor' ? 'border-sky-400 bg-sky-50/40' : 'border-slate-200 hover:border-slate-300'
                    }`}>
                      <input
                        type="radio"
                        name="descriptionMode"
                        value="vendor"
                        checked={descriptionMode === 'vendor'}
                        onChange={() => setDescriptionMode('vendor')}
                        className="mr-2"
                      />
                      <span className="text-sm font-semibold text-slate-700">① 会社名のみ</span>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed pl-5">
                        摘要は「◯◯株式会社」だけ
                      </p>
                    </label>
                    <label className={`cursor-pointer border rounded-xl p-3 transition-all ${
                      descriptionMode === 'full' ? 'border-lime-400 bg-lime-50/40' : 'border-slate-200 hover:border-slate-300'
                    }`}>
                      <input
                        type="radio"
                        name="descriptionMode"
                        value="full"
                        checked={descriptionMode === 'full'}
                        onChange={() => setDescriptionMode('full')}
                        className="mr-2"
                      />
                      <span className="text-sm font-semibold text-slate-700">② 会社名 + 内訳</span>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed pl-5">
                        複数行は「最初の内容 ほか」とまとめる
                      </p>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* 月末計上モードの期間確認モーダル */}
            {periodConfirmOpen && invoiceOcr && (
              <div
                className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
                onClick={() => setPeriodConfirmOpen(false)}
              >
                <div
                  className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">計上日（役務提供期間の末日）を確認</h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        請求書摘要から抽出した期間末日です。違う場合は手動で修正してください。
                      </p>
                    </div>
                    <button
                      onClick={() => setPeriodConfirmOpen(false)}
                      className="text-slate-400 hover:text-slate-700 transition-colors"
                      aria-label="閉じる"
                    >
                      <IconX className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
                    {invoiceOcr.vouchers.map((v, idx) => {
                      const buf = periodEndBuf[idx] ?? '';
                      const dateInput = buf && buf.length === 8
                        ? `${buf.slice(0, 4)}-${buf.slice(4, 6)}-${buf.slice(6, 8)}`
                        : '';
                      return (
                        <div key={idx} className="flex items-center gap-3 border border-slate-200 rounded-xl px-3 py-2">
                          <span className="text-[10px] text-slate-400 w-6 text-right">#{idx + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-slate-700 truncate">{v.vendorName || '(不明)'}</p>
                            <p className="text-[10px] text-slate-400 truncate">
                              請求書日 {v.invoiceDate} / {v.amountInclTax != null ? `¥${Number(v.amountInclTax).toLocaleString()}` : '金額不明'}
                            </p>
                          </div>
                          <input
                            type="date"
                            value={dateInput}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/-/g, '');
                              setPeriodEndBuf((prev) => ({ ...prev, [idx]: raw }));
                            }}
                            className="text-xs font-mono border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-400"
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
                    <button
                      onClick={() => setPeriodConfirmOpen(false)}
                      className="text-xs text-slate-500 border border-slate-200 rounded-xl px-4 py-2 hover:bg-slate-50 transition-colors"
                    >
                      キャンセル
                    </button>
                    <button
                      onClick={() => {
                        setPeriodConfirmOpen(false);
                        // 次の tick で handleRunMatch を呼ぶと modal の条件分岐を抜けて本処理に入る
                        setTimeout(() => handleRunMatch(), 0);
                      }}
                      className="text-xs font-semibold bg-violet-500 text-white rounded-xl px-5 py-2 hover:bg-violet-600 transition-colors"
                    >
                      この期間で照合
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 源泉徴収税の入力（請求書 OCR が終わっていて未照合のあいだ表示） */}
            {!journalMatchResult && invoiceOcr && invoiceOcr.vouchers.length > 0 && journalSubView === 'execute' && (
              <details className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm" open={Object.keys(withholdingTaxBuf).length > 0}>
                <summary className="text-xs font-semibold text-slate-600 cursor-pointer select-none">
                  源泉徴収税を設定する（支払報酬などに該当する請求書のみ・任意）
                  {Object.keys(withholdingTaxBuf).length > 0 && (
                    <span className="ml-2 text-[10px] text-lime-600 bg-lime-50 rounded px-1.5 py-0.5">
                      OCR自動検知 {Object.keys(withholdingTaxBuf).length} 件
                    </span>
                  )}
                </summary>
                <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                  {invoiceOcr.vouchers.map((v, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 truncate text-slate-600">{v.vendorName || '(相手先不明)'}</span>
                      <span className="text-slate-400 tabular-nums">¥{v.amountInclTax?.toLocaleString() ?? '—'}</span>
                      <span className="text-slate-300">源泉</span>
                      <input
                        type="number"
                        min={0}
                        value={withholdingTaxBuf[idx] ?? ''}
                        onChange={(e) => {
                          const val = e.target.value === '' ? 0 : Number(e.target.value);
                          setWithholdingTaxBuf((prev) => ({ ...prev, [idx]: val }));
                        }}
                        placeholder="0"
                        className="w-24 border border-slate-200 rounded-md px-2 py-1 text-xs text-right tabular-nums focus:outline-none focus:border-sky-400"
                      />
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[10px] text-slate-400 leading-relaxed">
                  入力した源泉税は「未払費用 / 預り金」の振替仕訳として計上され、
                  支払消込は「税込 − 源泉」のネット金額で通帳と照合されます。
                </p>
              </details>
            )}

            {/* 照合実行ボタン */}
            {!journalMatchResult && bankOcr && invoiceOcr && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={handleRunMatch}
                  disabled={matchProcessing}
                  className="inline-flex items-center gap-2 bg-lime-500 text-white text-sm font-semibold rounded-2xl px-8 py-3 hover:bg-lime-600 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 shadow-sm shadow-lime-200/60 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {matchProcessing ? '照合中...' : '照合して仕訳を生成'}
                </button>
              </div>
            )}
          </section>
        )}

        {/* ─── 決算書モード ──────────────────────────────────────────────── */}
        {mode === 'financial-statement' && !isGuest && (
          <FinancialStatementView
            selectedClientId={selectedClientId}
            accountsList={accountsList}
            addAccountLocal={addAccountLocal}
          />
        )}

        {/* ─── アップロードセクション ─────────────────────────────────────── */}
        {mode !== 'journal-entry' && mode !== 'financial-statement' && !result && (
          <section>
            {guestLimitReached ? (

              /* ゲスト上限到達 */
              <div className="bg-white border border-slate-100 rounded-2xl p-16
                text-center shadow-sm">
                <div className="text-slate-200 flex justify-center mb-5">
                  <IconLock className="w-10 h-10" />
                </div>
                <p className="text-base font-semibold text-slate-800 mb-1.5 tracking-tight">
                  無料お試しを使用済みです
                </p>
                <p className="text-sm text-slate-400 mb-8 leading-relaxed">
                  続けてご利用いただくには<br className="sm:hidden" />Googleアカウントでサインインしてください
                </p>
                <button
                  onClick={() => router.push('/login')}
                  className="px-8 py-3 rounded-xl bg-sky-400 text-white text-sm font-semibold
                    hover:bg-sky-500 hover:-translate-y-0.5 active:translate-y-0
                    transition-all duration-200 shadow-md shadow-sky-200/60 tracking-wide"
                >
                  Googleでサインイン
                </button>
              </div>

            ) : (
              <div className="space-y-5">

                {/* ドロップゾーン */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="PDF・画像ファイルをドラッグ＆ドロップ、またはクリックして選択"
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => !loading && fileInputRef.current?.click()}
                  onKeyDown={(e) =>
                    (e.key === 'Enter' || e.key === ' ') && !loading && fileInputRef.current?.click()
                  }
                  className={`
                    relative border-2 border-dashed rounded-2xl cursor-pointer select-none
                    transition-all duration-250
                    ${
                      isDragging
                        ? 'border-sky-400 bg-sky-50/60 scale-[1.01] shadow-lg shadow-sky-100/40'
                        : files.length > 0
                          ? 'border-lime-400/50 bg-lime-50/10 hover:border-lime-400/80'
                          : 'border-sky-200 bg-white hover:border-sky-400 hover:bg-sky-50/20 hover:shadow-md hover:shadow-sky-100/30'
                    }
                  `}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif"
                    multiple
                    className="sr-only"
                    onChange={handleFileChange}
                    disabled={loading}
                  />

                  {files.length > 0 ? (

                    /* ─ ファイル選択済み状態 ─ */
                    <div className="p-6 sm:p-8">
                      {/* ヘッダー行 */}
                      <div className="flex items-center gap-2.5 mb-4">
                        <div
                          className="w-5 h-5 rounded-full bg-lime-400 flex items-center justify-center flex-shrink-0"
                          aria-hidden="true"
                        >
                          <IconCheck className="w-2.5 h-2.5 text-white" />
                        </div>
                        <span className="text-sm font-semibold text-slate-700 tracking-tight">
                          {files.length}件のPDFを選択中
                        </span>
                        {!loading && (
                          <span className="ml-auto text-xs text-sky-400 font-medium">
                            + クリックで追加
                          </span>
                        )}
                      </div>

                      {/* ファイルリスト */}
                      <ul className="space-y-2" onClick={(e) => e.stopPropagation()}>
                        {files.map((f, i) => (
                          <li
                            key={i}
                            className="flex items-center gap-3 bg-white rounded-xl
                              px-4 py-3 border border-slate-100 shadow-sm"
                          >
                            <span className="text-sky-400 flex-shrink-0">
                              <IconFile className="w-4 h-4" />
                            </span>
                            <span className="flex-1 text-sm text-slate-700 font-medium truncate">
                              {f.name}
                            </span>
                            <span className="text-xs text-slate-300 flex-shrink-0 tabular-nums">
                              {(f.size / 1024 / 1024).toFixed(1)} MB
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveFile(i);
                              }}
                              aria-label={`${f.name} を削除`}
                              className="text-slate-300 hover:text-red-400 transition-colors
                                flex-shrink-0 p-0.5 rounded"
                            >
                              <IconX className="w-3.5 h-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>

                  ) : (

                    /* ─ 初期（空）状態 ─ */
                    <div className="py-16 sm:py-20 flex flex-col items-center gap-4">
                      <div
                        className={`text-sky-400 transition-transform duration-300
                          ${isDragging ? 'scale-110 -translate-y-1' : ''}`}
                      >
                        <IconUpload className="w-10 h-10" />
                      </div>
                      <div className="text-center space-y-1.5">
                        <p className="text-base font-medium text-slate-700 tracking-tight">
                          PDF・画像をドラッグ＆ドロップ
                        </p>
                        <p className="text-sm text-slate-400">
                          またはクリックしてファイルを選択
                          <span className="text-slate-300 ml-1">（複数可）</span>
                        </p>
                      </div>
                      {isGuest && (
                        <span className="text-xs text-amber-500 bg-amber-50 border border-amber-100
                          px-3.5 py-1.5 rounded-full tracking-wide">
                          ゲスト：5回まで無料でお試し
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* 処理ボタン */}
                <div className="flex justify-center">
                  <button
                    onClick={handleProcess}
                    disabled={files.length === 0 || loading}
                    className={`
                      inline-flex items-center gap-2.5 px-10 py-3.5 rounded-xl
                      font-semibold text-sm tracking-wide
                      transition-all duration-200
                      ${
                        files.length === 0 || loading
                          ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                          : `bg-sky-400 text-white
                             hover:bg-sky-500 hover:-translate-y-0.5 active:translate-y-0
                             shadow-md shadow-sky-200/60 hover:shadow-lg hover:shadow-sky-200/80`
                      }
                    `}
                  >
                    {loading ? (
                      <>
                        {/* インラインスピナー */}
                        <span
                          className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
                          aria-hidden="true"
                        />
                        解析中...
                      </>
                    ) : (
                      <>
                        {/* 検索（スキャン）アイコン */}
                        <svg
                          className="w-4 h-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <circle cx="11" cy="11" r="8" />
                          <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        {mode === 'bank-statement'
                          ? files.length > 1
                            ? `${files.length}件のPDFを解析する`
                            : 'AI OCRで解析する'
                          : files.length > 1
                            ? `${files.length}件のPDFを解析・分割する`
                            : 'AI OCRで解析・分割する'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ─── ローディング ─────────────────────────────────────────────────── */}
        {loading && (
          <section className="bg-white border border-slate-100 rounded-2xl p-14 text-center shadow-sm">
            {/* スピナー */}
            <div className="flex justify-center mb-7" aria-live="polite" aria-label="解析中">
              <div className="relative w-12 h-12">
                <div className="absolute inset-0 rounded-full border-4 border-sky-100" />
                <div
                  className="absolute inset-0 rounded-full border-4 border-transparent
                    border-t-sky-400 animate-spin"
                />
              </div>
            </div>
            <p className="text-base font-semibold text-slate-800 tracking-tight mb-1.5">
              {mode === 'bank-statement' ? 'AIが通帳を解析しています' : 'AIが書類を解析しています'}
            </p>
            {files.length > 1 && processingIndex > 0 && (
              <p className="text-sm font-medium text-sky-400 tabular-nums mb-1">
                {processingIndex} / {files.length} ファイル処理中
              </p>
            )}
            {processingIndex > 0 && files[processingIndex - 1] && (
              <p className="text-xs text-slate-400 truncate max-w-xs mx-auto">
                {files[processingIndex - 1].name}
              </p>
            )}
            <p className="text-xs text-slate-300 mt-3 tracking-wide">
              ページ数によっては 1〜2 分かかる場合があります
            </p>
          </section>
        )}

        {/* ─── エラー ───────────────────────────────────────────────────────── */}
        {error && (
          <section
            role="alert"
            className="bg-white border border-red-100 rounded-2xl p-6 shadow-sm"
          >
            <div className="flex items-start gap-3.5">
              <div
                className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center
                  flex-shrink-0 mt-0.5"
                aria-hidden="true"
              >
                <span className="text-red-400">
                  <IconAlertCircle className="w-4 h-4" />
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 mb-1 tracking-tight">
                  エラーが発生しました
                </p>
                <p className="text-xs text-slate-500 whitespace-pre-wrap leading-relaxed">
                  {error}
                </p>
              </div>
            </div>
            <button
              onClick={handleReset}
              className="mt-4 text-xs text-slate-400 hover:text-slate-600
                underline underline-offset-2 transition-colors tracking-wide"
            >
              最初からやり直す
            </button>
          </section>
        )}

        {/* ─── 結果表示 ─────────────────────────────────────────────────────── */}
        {result && mode !== 'journal-entry' && (
          <section className="space-y-4">

            {/* サマリーバー */}
            <div
              className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm
                flex flex-wrap items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl bg-lime-100/60 flex items-center justify-center flex-shrink-0"
                  aria-hidden="true"
                >
                  <span className="text-lime-500">
                    <IconCheck className="w-4 h-4" />
                  </span>
                </div>
                <div>
                  <p className="text-base font-semibold text-slate-900 tracking-tight">
                    {result.mode === 'bank-statement'
                      ? `${result.transactions.length} 件の取引を検出 · ${result.bankName} ${result.accountNumber}`
                      : `${result.invoices.length} 件の${result.mode === 'tax-return' ? '確定申告書類' : '請求書・領収書'}を検出`}
                  </p>
                  {result.mode !== 'bank-statement' && (
                    <p className="text-[10px] text-white bg-sky-400 rounded-full px-2 py-0.5 inline-block mt-1 tracking-wide font-medium">
                      {result.mode === 'tax-return' ? '確定申告モード' : '請求書・領収書モード'}
                    </p>
                  )}
                  <p className="text-xs text-slate-400 mt-0.5 tracking-wide">
                    {result.processedFiles > 1
                      ? `${result.processedFiles}件のPDF · 計${result.totalPages}ページを処理`
                      : `${result.totalPages}ページ · ${files[0]?.name}`}
                  </p>
                  {/* API実コスト表示: 動画撮影のため一時非表示
                  <p className="text-[11px] text-amber-600 mt-1 tracking-wide font-mono">
                    API実コスト: ¥{result.totalCostJpy.toFixed(2)}
                    <span className="text-slate-400 ml-2">
                      (in {result.totalInputTokens.toLocaleString()} / out {result.totalOutputTokens.toLocaleString()} tok)
                    </span>
                  </p>
                  */}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleReset}
                  className="text-xs text-slate-500 border border-slate-200 rounded-xl
                    px-4 py-2.5 hover:bg-slate-50 hover:border-slate-300
                    transition-all duration-200 tracking-wide"
                >
                  別ファイルを処理
                </button>
                {result.mode !== 'bank-statement' && (
                  <button
                    onClick={handleCsvExport}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-600
                      border border-slate-200 rounded-xl px-4 py-2.5 font-semibold
                      hover:bg-slate-50 hover:border-slate-300
                      transition-all duration-200 tracking-wide"
                  >
                    <IconDownload className="w-3.5 h-3.5" />
                    CSV保存
                  </button>
                )}
                <button
                  onClick={handleDownloadAll}
                  className="inline-flex items-center gap-1.5 text-xs text-white
                    bg-lime-500 rounded-xl px-4 py-2.5 font-semibold
                    hover:bg-lime-600 hover:-translate-y-0.5 active:translate-y-0
                    transition-all duration-200 shadow-sm shadow-lime-200/60 tracking-wide"
                >
                  <IconArchive className="w-3.5 h-3.5" />
                  {result.mode === 'bank-statement' ? 'CSVダウンロード' : 'ZIPで一括DL'}
                </button>
              </div>
            </div>

            {/* ゲスト向け案内 */}
            {isGuest && (
              <div
                className="bg-sky-50/40 border border-sky-100 rounded-2xl p-5
                  flex flex-wrap items-center justify-between gap-4"
              >
                <div>
                  <p className="text-sm font-semibold text-sky-900 tracking-tight">
                    サインインで継続利用できます
                  </p>
                  <p className="text-xs text-sky-600/70 mt-0.5 leading-relaxed">
                    Googleアカウントでサインインするとサブスクリプション期間中は無制限でご利用いただけます
                  </p>
                </div>
                <button
                  onClick={() => router.push('/login')}
                  className="text-xs bg-sky-400 text-white rounded-xl px-5 py-2.5 font-semibold
                    hover:bg-sky-500 hover:-translate-y-0.5 active:translate-y-0
                    transition-all duration-200 shadow-sm shadow-sky-200/60 flex-shrink-0 tracking-wide"
                >
                  Googleでサインイン
                </button>
              </div>
            )}

            {/* 結果テーブル */}
            <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                {result.mode === 'bank-statement' ? (
                  <table className="w-full text-sm min-w-[600px]">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="px-5 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest w-10">#</th>
                        <th className="px-5 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">Date</th>
                        <th className="px-5 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">摘要</th>
                        <th className="px-5 py-4 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">出金</th>
                        <th className="px-5 py-4 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">入金</th>
                        <th className="px-5 py-4 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">残高</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {result.transactions.map((t, i) => (
                        <BankRow key={i} row={t} index={i + 1} />
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-sm min-w-[560px]">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="px-5 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest w-10">#</th>
                        <th className="px-5 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">Page</th>
                        {result.mode === 'tax-return' ? (
                          <>
                            <th className="px-5 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">Year</th>
                            <th className="px-5 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">Name</th>
                            <th className="px-5 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">Type</th>
                            <th className="px-5 py-4 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">Income</th>
                          </>
                        ) : (
                          <>
                            <th className="px-5 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest w-14">Type</th>
                            <th className="px-5 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">Date</th>
                            <th className="px-5 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">Requester</th>
                            <th className="px-5 py-4 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">Amount</th>
                            <th className="px-5 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest hidden xl:table-cell">Invoice No.</th>
                          </>
                        )}
                        <th className="px-5 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest hidden lg:table-cell">File</th>
                        <th className="px-5 py-4 text-center text-[10px] font-semibold text-slate-300 uppercase tracking-widest w-16 sticky right-0 bg-white">DL</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {result.processedFiles > 1
                        ? Object.entries(invoicesByFile).map(([sourceFile, invoices]) => (
                            <Fragment key={sourceFile}>
                              <tr className="bg-slate-50/50">
                                <td colSpan={result.mode === 'tax-return' ? 8 : 9}
                                  className="px-5 py-2.5 text-xs text-slate-400 font-medium tracking-wide">
                                  <span className="inline-flex items-center gap-1.5">
                                    <IconFile className="w-3.5 h-3.5" />
                                    {sourceFile}
                                  </span>
                                </td>
                              </tr>
                              {invoices.map((invoice) =>
                                result.mode === 'tax-return' ? (
                                  <TaxReturnRow key={invoice.index} invoice={invoice} onDownload={() => handleDownloadOne(invoice)} />
                                ) : (
                                  <InvoiceRow key={invoice.index} invoice={invoice} onDownload={() => handleDownloadOne(invoice)} />
                                )
                              )}
                            </Fragment>
                          ))
                        : result.invoices.map((invoice) =>
                            result.mode === 'tax-return' ? (
                              <TaxReturnRow key={invoice.index} invoice={invoice} onDownload={() => handleDownloadOne(invoice)} />
                            ) : (
                              <InvoiceRow key={invoice.index} invoice={invoice} onDownload={() => handleDownloadOne(invoice)} />
                            )
                          )}
                    </tbody>
                  </table>
                )}
              </div>

              {/* テーブルフッター */}
              <div className="px-5 py-3 border-t border-slate-50 bg-slate-50/30">
                <p className="text-[10px] text-slate-300 tracking-widest uppercase">
                  {result.mode === 'bank-statement'
                    ? `Output: CSV · ${result.bankName} ${result.accountNumber}`
                    : <>File format :{' '}
                          <code className="bg-white border border-slate-100 px-1.5 py-0.5 rounded-md font-mono text-slate-400 normal-case tracking-normal">
                            {result.mode === 'tax-return' ? '年度_氏名_書類種別.pdf' : '日付_発行者名_金額_摘要.pdf'}
                          </code>
                        </>}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ─── 使い方ガイド（請求書/通帳モードの初期表示のみ） ───────────── */}
        {(mode === 'invoice' || mode === 'tax-return') && files.length === 0 && !result && !loading && (
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            {[
              {
                num: '01',
                title: 'PDFをアップロード',
                desc: '複数の請求書・領収書がまとまったPDFをドロップ。複数ファイルを同時に指定することも可能です。',
                accent: 'text-sky-400',
                border: 'hover:border-sky-200',
              },
              {
                num: '02',
                title: 'AI OCRで自動解析',
                desc: 'Claude AIが各書類の境界・種別（請求書/領収書）・日付・発行者名・金額・インボイス番号を自動で抽出します。',
                accent: 'text-sky-400',
                border: 'hover:border-sky-200',
              },
              {
                num: '03',
                title: '分割PDFをダウンロード',
                desc: '日付_発行者名_金額_摘要で命名された1書類1PDFを個別またはZIPで一括ダウンロード。',
                accent: 'text-lime-500',
                border: 'hover:border-lime-200',
              },
            ].map((item) => (
              <div
                key={item.num}
                className={`bg-white rounded-2xl p-6 border border-slate-100 shadow-sm
                  ${item.border} hover:-translate-y-0.5 hover:shadow-md
                  transition-all duration-300`}
              >
                <span className={`text-2xl font-bold ${item.accent} tracking-tight`}>
                  {item.num}
                </span>
                <p className="font-semibold text-slate-800 mt-3 mb-2 text-sm tracking-tight">
                  {item.title}
                </p>
                <p className="text-xs text-slate-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </section>
        )}
      </main>

      {/* ─── フッター ─────────────────────────────────────────────────────── */}
      <footer className="relative max-w-[900px] mx-auto px-4 sm:px-6 py-8 space-y-2">
        <p className="text-center text-[10px] text-slate-300 tracking-widest uppercase">
          Invoice OCR · Powered by Claude AI · © {new Date().getFullYear()}
        </p>
        <p className="text-center">
          <a
            href="/tokusho"
            className="text-[10px] text-slate-300 hover:text-sky-400 transition-colors underline underline-offset-2"
          >
            特定商取引法に基づく表記
          </a>
        </p>
      </footer>

      {/* ─── PDFプレビューモーダル ───────────────────────────────────── */}
      {pdfPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
          onClick={closePdfPreview}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-800 truncate">{pdfPreview.name}</p>
              <button
                onClick={closePdfPreview}
                className="text-slate-400 hover:text-slate-700 p-1"
                aria-label="閉じる"
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>
            <iframe src={pdfPreview.url} title={pdfPreview.name} className="flex-1 w-full" />
          </div>
        </div>
      )}

      {/* ─── エラー報告モーダル（ドラッグ可能・背景透過） ─────────────── */}
      {showReportModal && (
        <div
          className="fixed z-50 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
          style={{
            left: `${reportModalPos.x}px`,
            top: `${reportModalPos.y}px`,
            width: '520px',
            maxHeight: '80vh',
          }}
          onPaste={handleReportPaste}
        >
          <div
            className="bg-white overflow-y-auto"
            style={{ maxHeight: '80vh' }}
          >
            <div
              className="px-6 pt-4 pb-3 border-b border-slate-100 cursor-move select-none bg-slate-50/60"
              onMouseDown={onReportDragStart}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <IconAlertCircle className="w-4 h-4 text-amber-500" />
                  <h3 className="text-base font-semibold text-slate-900 tracking-tight">エラー報告</h3>
                  <span className="text-[10px] text-slate-400 ml-1">(ここをドラッグで移動)</span>
                </div>
                <button
                  onClick={() => !reportSending && setShowReportModal(false)}
                  disabled={reportSending}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100"
                  aria-label="閉じる"
                >
                  <IconX className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                スクショとコメントを管理者に送信します。
                スクショは <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px]">Win+Shift+S</kbd> で切り取り後、下の枠内に <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px]">Ctrl+V</kbd> で貼付、またはファイル選択。
              </p>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-600 tracking-wide">スクリーンショット</label>
                <div className="mt-2">
                  {reportScreenshot ? (
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={reportScreenshot} alt="screenshot" className="w-full rounded-xl border border-slate-200" />
                      <button
                        onClick={() => setReportScreenshot(null)}
                        className="absolute top-2 right-2 bg-white/90 border border-slate-200 rounded-full p-1.5 hover:bg-white"
                      >
                        <IconX className="w-3.5 h-3.5 text-slate-500" />
                      </button>
                    </div>
                  ) : (
                    <div className="border-2 border-dashed border-slate-200 rounded-xl px-4 py-6 text-center">
                      <p className="text-xs text-slate-400 mb-2">ここに Ctrl+V で貼付</p>
                      <label className="inline-block text-xs text-sky-600 border border-sky-200 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-sky-50">
                        またはファイルを選択
                        <input type="file" accept="image/*" className="hidden" onChange={handleReportFileChange} />
                      </label>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 tracking-wide">コメント <span className="text-red-500">*</span></label>
                <textarea
                  value={reportComment}
                  onChange={(e) => setReportComment(e.target.value)}
                  rows={5}
                  placeholder="何がおかしかったか、期待した結果などをご記入ください"
                  className="mt-2 w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 resize-none"
                />
              </div>

              {reportMessage && (
                <div className={`text-xs rounded-xl px-3 py-2 ${reportMessage.includes('送信しました') ? 'bg-lime-50 text-lime-700 border border-lime-100' : 'bg-red-50 text-red-600 border border-red-100'}`}>
                  {reportMessage}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
              <button
                onClick={() => setShowReportModal(false)}
                disabled={reportSending}
                className="text-xs text-slate-500 border border-slate-200 rounded-xl px-4 py-2.5 hover:bg-slate-50 transition-all disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleSendReport}
                disabled={reportSending || !reportComment.trim()}
                className="text-xs text-white bg-sky-500 rounded-xl px-4 py-2.5 font-semibold hover:bg-sky-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {reportSending ? '送信中...' : '管理者に送信'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 明細合計不整合エラーモーダル ─────────────────────────────
          複数科目按分OCRで、明細合計 ≠ 税込合計 になった場合の通知。
          ユーザーにスクショ提出を依頼して開発者にフィードバックを送ってもらう。 */}
      {lineSumMismatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 bg-amber-50/40">
              <p className="text-sm font-semibold text-amber-700 tracking-tight">
                明細の自動分割でエラーが発生しました
              </p>
              <p className="text-[11px] text-amber-500/80 mt-0.5 tracking-wide">
                OCRが返した明細行の合計が請求書の税込合計と一致しませんでした
              </p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="text-xs text-slate-600 leading-relaxed">
                <span className="font-mono bg-slate-50 px-1.5 py-0.5 rounded">{lineSumMismatch.fileName}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-[10px] text-slate-400 tracking-wider uppercase">税込合計</p>
                  <p className="text-sm font-semibold text-slate-900 tabular-nums mt-1">
                    ¥{lineSumMismatch.taxIncludedAmount.toLocaleString()}
                  </p>
                </div>
                <div className="bg-red-50 rounded-xl p-3">
                  <p className="text-[10px] text-red-400 tracking-wider uppercase">明細合計</p>
                  <p className="text-sm font-semibold text-red-600 tabular-nums mt-1">
                    ¥{lineSumMismatch.linesSum.toLocaleString()}
                    <span className="text-[10px] text-red-400 ml-2">
                      差額 ¥{(lineSumMismatch.linesSum - lineSumMismatch.taxIncludedAmount).toLocaleString()}
                    </span>
                  </p>
                </div>
              </div>
              {lineSumMismatch.lines.length > 0 && (
                <div className="border border-slate-100 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">科目</th>
                        <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">内容</th>
                        <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest">金額</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {lineSumMismatch.lines.map((l, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 text-slate-700">{l.debitAccount}</td>
                          <td className="px-3 py-2 text-slate-500 truncate max-w-[140px]">{l.description || '—'}</td>
                          <td className="px-3 py-2 text-right text-slate-700 tabular-nums">¥{l.amountInclTax.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="bg-sky-50/60 rounded-xl p-3 text-[11px] text-sky-700 leading-relaxed">
                お手数ですが、<strong className="font-semibold">この画面のスクリーンショット</strong>と<strong className="font-semibold">該当の請求書PDF</strong>を開発者にお送りください。プロンプト改善に使用させていただきます。
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/30 flex justify-end gap-2">
              <button
                onClick={() => setLineSumMismatch(null)}
                className="text-xs text-slate-600 bg-white border border-slate-200 rounded-xl px-4 py-2.5 font-medium hover:bg-slate-50 transition-all"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── フローティング「+ 新規仕訳」ボタン（ログインユーザー全ビュー共通） ─── */}
      {!isGuest && user && (
        <button
          onClick={() => { resetManualEntry(); setManualEntryOpen(true); }}
          aria-label="新規仕訳を入力"
          title="新規仕訳を入力"
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2
            bg-sky-400 hover:bg-sky-500 active:scale-95 text-white
            shadow-lg shadow-sky-200/70 rounded-2xl
            px-5 py-3 text-sm font-semibold tracking-tight
            transition-all duration-200"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="hidden sm:inline">新規仕訳</span>
        </button>
      )}

      {/* ─── 手動仕訳入力モーダル ───────────────────────────────────────────── */}
      {manualEntryOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => { if (!manualEntrySubmitting) { setManualEntryOpen(false); resetManualEntry(); } }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <p className="text-base font-semibold text-slate-900 tracking-tight">新規仕訳を入力</p>
                <p className="text-[11px] text-slate-400 mt-0.5">振替伝票として1件登録します</p>
              </div>
              <button
                onClick={() => { if (!manualEntrySubmitting) { setManualEntryOpen(false); resetManualEntry(); } }}
                className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
                aria-label="閉じる"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {/* 日付 */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  日付 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  value={manualEntryForm.entry_date}
                  onChange={(e) => setManualEntryForm((p) => ({ ...p, entry_date: e.target.value }))}
                  className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2
                    focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300"
                />
              </div>

              {/* 借方科目 / 貸方科目 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    借方科目 <span className="text-rose-500">*</span>
                  </label>
                  <AccountCombobox
                    value={manualEntryForm.debit_account}
                    onChange={(v) => setManualEntryForm((p) => ({ ...p, debit_account: v }))}
                    accounts={accountsList}
                    onCreate={addAccountLocal}
                    placeholder="科目を選択"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    貸方科目 <span className="text-rose-500">*</span>
                  </label>
                  <AccountCombobox
                    value={manualEntryForm.credit_account}
                    onChange={(v) => setManualEntryForm((p) => ({ ...p, credit_account: v }))}
                    accounts={accountsList}
                    onCreate={addAccountLocal}
                    placeholder="科目を選択"
                  />
                </div>
              </div>

              {/* 金額 */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  金額 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={manualEntryForm.amount}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d,]/g, '');
                    setManualEntryForm((p) => ({ ...p, amount: v }));
                  }}
                  placeholder="0"
                  className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 text-right tabular-nums
                    focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300"
                />
              </div>

              {/* 摘要 */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">摘要</label>
                <input
                  type="text"
                  value={manualEntryForm.description}
                  onChange={(e) => setManualEntryForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="例: 1月分家賃"
                  className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2
                    focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300"
                />
              </div>

              {/* 消費税区分 / 取引先 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">消費税区分</label>
                  <select
                    value={manualEntryForm.tax_category}
                    onChange={(e) => setManualEntryForm((p) => ({ ...p, tax_category: e.target.value }))}
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white
                      focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300"
                  >
                    <option value="">指定なし</option>
                    <option value="taxable_sales">課税売上</option>
                    <option value="tax_exempt_sales">非課税売上</option>
                    <option value="taxable_purchase">課税仕入</option>
                    <option value="non_taxable">免税・不課税</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">取引先</label>
                  <input
                    type="text"
                    value={manualEntryForm.vendor_name}
                    onChange={(e) => setManualEntryForm((p) => ({ ...p, vendor_name: e.target.value }))}
                    list="manual-entry-vendors"
                    placeholder="任意"
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2
                      focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300"
                  />
                  <datalist id="manual-entry-vendors">
                    {vendorsList.map((v) => (
                      <option key={v.id ?? v.name} value={v.name} />
                    ))}
                  </datalist>
                </div>
              </div>

              {manualEntryError && (
                <div className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
                  {manualEntryError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100">
              <button
                onClick={() => { if (!manualEntrySubmitting) { setManualEntryOpen(false); resetManualEntry(); } }}
                disabled={manualEntrySubmitting}
                className="text-sm text-slate-600 hover:text-slate-800 px-4 py-2 rounded-xl
                  disabled:opacity-50 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleManualEntrySubmit}
                disabled={manualEntrySubmitting}
                className="text-sm text-white bg-sky-500 hover:bg-sky-600 disabled:opacity-50
                  rounded-xl px-5 py-2 font-semibold transition-all"
              >
                {manualEntrySubmitting ? '登録中…' : '登録'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 共通ユーティリティ ────────────────────────────────────────────────────

function formatDateYmd(s: string): string {
  if (!s || s === '不明') return '—';
  if (s.length === 8) return `${s.slice(0,4)}/${s.slice(4,6)}/${s.slice(6,8)}`;
  return s;
}

// 「不明」「空」を集計対象外とするヘルパ
function isValidAccountName(name: string | null | undefined): boolean {
  if (!name) return false;
  if (name === '不明' || name === '(不明)') return false;
  return true;
}

// 取引先未登録のラベル（取引先別ドリルダウンで使用）
const UNREGISTERED_VENDOR = '(取引先未登録)';

export interface VendorBreakdownRow {
  vendor: string;
  debit: number;
  credit: number;
  entryCount: number;
  isUnregistered: boolean;
}

function computeBalances(entries: LedgerEntry[]) {
  const accountSet = new Set<string>();
  const accountBalances: Record<string, { debit: number; credit: number }> = {};
  // 各科目について vendor 別の借方/貸方/件数
  const vendorByAccount: Record<string, Record<string, { debit: number; credit: number; entryCount: number }>> = {};

  const ensureVendorBucket = (account: string, vendor: string) => {
    if (!vendorByAccount[account]) vendorByAccount[account] = {};
    if (!vendorByAccount[account][vendor]) {
      vendorByAccount[account][vendor] = { debit: 0, credit: 0, entryCount: 0 };
    }
    return vendorByAccount[account][vendor];
  };

  for (const e of entries) {
    const amt = e.amount ?? 0;
    // 多明細仕訳では debit_amount / credit_amount が異なるので per-side を採用
    // （単一行仕訳では両方とも amount に等しい）
    const dAmt = Number(e.debit_amount ?? amt);
    const cAmt = Number(e.credit_amount ?? amt);
    const vRaw = (e.vendor_name ?? '').trim();
    const v = vRaw || UNREGISTERED_VENDOR;
    if (isValidAccountName(e.debit_account)) {
      accountSet.add(e.debit_account);
      if (!accountBalances[e.debit_account]) accountBalances[e.debit_account] = { debit: 0, credit: 0 };
      accountBalances[e.debit_account].debit += dAmt;
      const bucket = ensureVendorBucket(e.debit_account, v);
      bucket.debit += dAmt;
      bucket.entryCount += 1;
    }
    if (isValidAccountName(e.credit_account)) {
      accountSet.add(e.credit_account);
      if (!accountBalances[e.credit_account]) accountBalances[e.credit_account] = { debit: 0, credit: 0 };
      accountBalances[e.credit_account].credit += cAmt;
      const bucket = ensureVendorBucket(e.credit_account, v);
      bucket.credit += cAmt;
      bucket.entryCount += 1;
    }
  }
  const accounts = Array.from(accountSet).sort();

  // 科目→vendor別残高行（ソート: 残高絶対値の大きい順、未登録は末尾に寄せる）
  const vendorBreakdownByAccount: Record<string, VendorBreakdownRow[]> = {};
  for (const acc of accounts) {
    const vendorMap = vendorByAccount[acc] ?? {};
    const rows: VendorBreakdownRow[] = Object.entries(vendorMap).map(([vendor, v]) => ({
      vendor,
      debit: v.debit,
      credit: v.credit,
      entryCount: v.entryCount,
      isUnregistered: vendor === UNREGISTERED_VENDOR,
    }));
    rows.sort((a, b) => {
      if (a.isUnregistered !== b.isUnregistered) return a.isUnregistered ? 1 : -1;
      return Math.abs(b.debit - b.credit) - Math.abs(a.debit - a.credit);
    });
    vendorBreakdownByAccount[acc] = rows;
  }

  return { accounts, accountBalances, vendorBreakdownByAccount };
}

// ─── 振込手数料判定 ────────────────────────────────────────────────────────
// 通帳の未マッチ出金行が振込手数料に該当する候補かを判定する。
// 条件: 出金額が 100〜880円 / 1.1 で割って整数（= 11 の倍数）/ 摘要に既存vendor名を含まない
// （税抜 100/150/200/...800 × 1.1 を網羅。実銀行手数料の 110/165/220/275/330/440/495/550/660/770/880 等）
function isBankFeeCandidate(
  tx: TransactionInput,
  vendorsList: { name: string; normalized_key?: string }[]
): boolean {
  const debit = tx.debit ?? 0;
  if (debit <= 0) return false;
  if (debit < 100 || debit > 880) return false;
  if (debit % 11 !== 0) return false;
  const normDesc = normalizeVendorKey(tx.description ?? '');
  if (!normDesc) return true;
  for (const v of vendorsList) {
    const key = (v.normalized_key && v.normalized_key.length > 0)
      ? v.normalized_key
      : normalizeVendorKey(v.name);
    if (key && key.length >= 2 && normDesc.includes(key)) return false;
  }
  return true;
}

// ─── 未照合入出金ビュー（一括選択 + 一括適用） ─────────────────────────────

function UnmatchedView({
  transactions,
  accounts,
  setAccounts,
  descriptions,
  setDescriptions,
  selected,
  setSelected,
  bulkAccount,
  setBulkAccount,
  bulkDescription,
  setBulkDescription,
  accountsList,
  vendorsList,
  addAccountLocal,
  onShowPdf,
  onGoExecute,
}: {
  transactions: TransactionInput[];
  accounts: Record<number, string>;
  setAccounts: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  descriptions: Record<number, string>;
  setDescriptions: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  selected: Set<number>;
  setSelected: React.Dispatch<React.SetStateAction<Set<number>>>;
  bulkAccount: string;
  setBulkAccount: (v: string) => void;
  bulkDescription: string;
  setBulkDescription: (v: string) => void;
  accountsList: AccountOption[];
  vendorsList: { name: string; normalized_key?: string }[];
  addAccountLocal: (name: string, reading?: string, sub_category?: string) => Promise<AccountOption | null> | void;
  onShowPdf: (tx: TransactionInput) => void;
  onGoExecute: () => void;
}) {
  // ─── 振込手数料 自動判定（Hooks は early return より前で宣言） ─────────────
  // 候補抽出: 100-880円 / 11の倍数 / 摘要に既存vendor名なし、かつ未割当な行
  const bankFeeCandidateIdx = useMemo(() => {
    const result: number[] = [];
    transactions.forEach((tx, i) => {
      if (accounts[i]) return;
      if (isBankFeeCandidate(tx, vendorsList)) result.push(i);
    });
    return result;
  }, [transactions, accounts, vendorsList]);

  const [bankFeeExcluded, setBankFeeExcluded] = useState<Set<number>>(new Set());
  const [bankFeeDismissed, setBankFeeDismissed] = useState(false);

  if (transactions.length === 0) {
    return (
      <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center shadow-sm">
        <p className="text-sm font-semibold text-slate-700">未照合の入出金はありません</p>
        <p className="text-xs text-slate-400 mt-2">「仕訳実行」タブで照合するとここに証票なし取引が表示されます</p>
        <button
          type="button"
          onClick={onGoExecute}
          className="mt-5 text-xs font-semibold text-sky-600 hover:text-sky-700"
        >
          仕訳実行へ →
        </button>
      </div>
    );
  }

  const allSelected = selected.size === transactions.length && transactions.length > 0;
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(transactions.map((_, i) => i)));
  };
  const toggleOne = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const applyBulkAccount = () => {
    if (!bulkAccount || selected.size === 0) return;
    setAccounts((prev) => {
      const next = { ...prev };
      selected.forEach((i) => { next[i] = bulkAccount; });
      return next;
    });
  };
  const applyBulkDescription = () => {
    if (!bulkDescription || selected.size === 0) return;
    setDescriptions((prev) => {
      const next = { ...prev };
      selected.forEach((i) => { next[i] = bulkDescription; });
      return next;
    });
  };

  const applyBankFee = () => {
    const targets = bankFeeCandidateIdx.filter((i) => !bankFeeExcluded.has(i));
    if (targets.length === 0) return;
    setAccounts((prev) => {
      const next = { ...prev };
      targets.forEach((i) => { next[i] = '支払手数料'; });
      return next;
    });
    setDescriptions((prev) => {
      const next = { ...prev };
      targets.forEach((i) => {
        if (!next[i]) next[i] = '振込手数料';
      });
      return next;
    });
    setBankFeeExcluded(new Set());
    setBankFeeDismissed(true);
  };

  const assignedCount = transactions.filter((_, i) => accounts[i]).length;
  const showBankFeeBanner = !bankFeeDismissed && bankFeeCandidateIdx.length > 0;

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="bg-white border border-amber-100 rounded-2xl p-5 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-slate-900 tracking-tight">
            証憑がない入出金 <span className="text-amber-600">{transactions.length}</span> 件
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            科目割当済み {assignedCount} / {transactions.length} 件 — CSVに含まれるのは科目を設定したものだけです
          </p>
        </div>
        <p className="text-[11px] text-slate-400">例：銀行手数料 → 支払手数料</p>
      </div>

      {/* 振込手数料 自動判定バナー */}
      {showBankFeeBanner && (
        <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <p className="text-sm font-semibold text-amber-800">
                💡 振込手数料の候補が <span className="font-bold">{bankFeeCandidateIdx.length}</span> 件あります
              </p>
              <p className="text-[11px] text-amber-700 mt-0.5">
                100〜880円・1.1で割って整数・摘要に既存取引先名なし。違うものはチェックを外してください。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setBankFeeDismissed(true)}
              className="text-[11px] text-amber-700 hover:text-amber-900 underline whitespace-nowrap"
            >
              閉じる
            </button>
          </div>
          <div className="bg-white rounded-xl border border-amber-100 divide-y divide-amber-50 max-h-60 overflow-y-auto">
            {bankFeeCandidateIdx.map((i) => {
              const tx = transactions[i];
              const excluded = bankFeeExcluded.has(i);
              return (
                <label
                  key={i}
                  className={`flex items-center gap-3 px-3 py-2 text-xs cursor-pointer hover:bg-amber-50/40 ${excluded ? 'opacity-50' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={!excluded}
                    onChange={() => {
                      setBankFeeExcluded((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      });
                    }}
                    className="w-4 h-4 accent-amber-500"
                  />
                  <span className="font-mono text-slate-500 w-20 shrink-0">{tx.transactionDate}</span>
                  <span className="flex-1 text-slate-700 truncate">{tx.description || '（摘要なし）'}</span>
                  <span className="tabular-nums font-semibold text-slate-800 w-20 text-right shrink-0">
                    ¥{(tx.debit ?? 0).toLocaleString()}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="flex items-center justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={() => setBankFeeDismissed(true)}
              className="text-xs px-3 py-1.5 border border-amber-200 text-amber-700 rounded-lg hover:bg-amber-50"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={applyBankFee}
              disabled={bankFeeCandidateIdx.filter((i) => !bankFeeExcluded.has(i)).length === 0}
              className="text-xs font-semibold px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white shadow-sm disabled:bg-slate-200 disabled:text-slate-400"
            >
              OK：振込手数料として一括計上（{bankFeeCandidateIdx.filter((i) => !bankFeeExcluded.has(i)).length}件）
            </button>
          </div>
        </div>
      )}

      {/* 一括適用バー */}
      <div className={`sticky top-2 z-10 bg-white border rounded-2xl p-4 shadow-sm transition-all ${
        selected.size > 0 ? 'border-sky-300 ring-2 ring-sky-100' : 'border-slate-100'
      }`}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="text-xs font-semibold text-slate-700">
            {selected.size > 0 ? (
              <span className="text-sky-600">{selected.size} 件を選択中</span>
            ) : (
              <span className="text-slate-400">行を選択すると一括適用できます</span>
            )}
          </p>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-[11px] text-slate-500 hover:text-slate-700 underline"
            >
              選択解除
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">借方科目（一括）</span>
            <div className="mt-1 flex gap-2">
              <div className="flex-1">
                <AccountCombobox
                  value={bulkAccount}
                  onChange={setBulkAccount}
                  accounts={accountsList}
                  onCreate={addAccountLocal}
                  placeholder="科目名 / ローマ字"
                />
              </div>
              <button
                type="button"
                disabled={!bulkAccount || selected.size === 0}
                onClick={applyBulkAccount}
                className="text-xs font-semibold px-3 py-2 rounded-lg bg-sky-500 text-white disabled:bg-slate-200 disabled:text-slate-400 hover:bg-sky-600 transition-colors whitespace-nowrap"
              >
                選択に適用
              </button>
            </div>
          </div>
          <div>
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">摘要（一括）</span>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={bulkDescription}
                onChange={(e) => setBulkDescription(e.target.value)}
                placeholder="例：振込手数料"
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-sky-400"
              />
              <button
                type="button"
                disabled={!bulkDescription || selected.size === 0}
                onClick={applyBulkDescription}
                className="text-xs font-semibold px-3 py-2 rounded-lg bg-lime-500 text-white disabled:bg-slate-200 disabled:text-slate-400 hover:bg-lime-600 transition-colors whitespace-nowrap"
              >
                選択に適用
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 明細テーブル */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-50/80">
              <tr className="border-b border-slate-100">
                <th className="px-3 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="w-4 h-4 accent-sky-500 cursor-pointer"
                  />
                </th>
                <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">日付</th>
                <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">元摘要</th>
                <th className="px-3 py-3 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest">出金</th>
                <th className="px-3 py-3 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest">入金</th>
                <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">借方科目</th>
                <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">摘要（上書き）</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {transactions.map((tx, i) => {
                const isSelected = selected.has(i);
                return (
                  <tr
                    key={i}
                    className={`transition-colors ${isSelected ? 'bg-sky-50/40' : 'hover:bg-slate-50/40'}`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(i)}
                        className="w-4 h-4 accent-sky-500 cursor-pointer"
                      />
                    </td>
                    <td
                      className="px-3 py-2 text-xs font-mono text-slate-500 cursor-pointer"
                      onClick={() => onShowPdf(tx)}
                    >
                      {tx.transactionDate.length === 8
                        ? `${tx.transactionDate.slice(0,4)}/${tx.transactionDate.slice(4,6)}/${tx.transactionDate.slice(6,8)}`
                        : tx.transactionDate}
                    </td>
                    <td
                      className="px-3 py-2 text-xs text-slate-600 max-w-[220px] truncate cursor-pointer"
                      title={tx.description}
                      onClick={() => onShowPdf(tx)}
                    >
                      {tx.description}
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-semibold text-slate-900 tabular-nums">
                      {tx.debit != null ? `¥${tx.debit.toLocaleString()}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-semibold text-lime-600 tabular-nums">
                      {tx.credit != null ? `¥${tx.credit.toLocaleString()}` : '—'}
                    </td>
                    <td className="px-3 py-2 min-w-[200px]">
                      <AccountCombobox
                        value={accounts[i] ?? ''}
                        onChange={(v) => setAccounts((prev) => ({ ...prev, [i]: v }))}
                        accounts={accountsList}
                        onCreate={addAccountLocal}
                        placeholder="科目名 / ローマ字"
                        dense
                      />
                    </td>
                    <td className="px-3 py-2 min-w-[200px]">
                      <input
                        type="text"
                        value={descriptions[i] ?? ''}
                        onChange={(e) => setDescriptions((prev) => ({ ...prev, [i]: e.target.value }))}
                        placeholder={tx.description}
                        className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-sky-400"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 text-center">
        設定が終わったら「仕訳実行」タブに戻ってCSVをダウンロードしてください
      </p>
    </div>
  );
}

// ─── 仕訳日記帳ビュー（明細 + 編集削除 + 締め） ─────────────────────────────

function LedgerView({
  refreshKey,
  accountFilter,
  setAccountFilter,
  clientId,
  clientName,
  onSaveField,
  onBulkDelete,
  onClose,
  onReopen,
  accountsList,
  addAccountLocal,
  vendorsList,
  addVendorLocal,
  onAddRule,
  departmentsList,
}: {
  refreshKey: number;
  accountFilter: string;
  setAccountFilter: (v: string) => void;
  clientId: string | null;
  clientName: string | null;
  onSaveField: (id: string, patch: Partial<LedgerEntry>) => Promise<void>;
  onBulkDelete: (ids: string[]) => Promise<void>;
  onClose: (closedUntil: string) => void;
  onReopen: () => void;
  accountsList: AccountOption[];
  addAccountLocal: (name: string, reading?: string, sub_category?: string) => Promise<AccountOption | null>;
  vendorsList: AccountOption[];
  addVendorLocal: (name: string, reading?: string) => Promise<AccountOption | null>;
  onAddRule: (pattern_type: 'vendor' | 'description', pattern: string, debit_account: string) => Promise<unknown>;
  departmentsList: { id: string; name: string; code: string | null }[];
}) {
  const [closingInput, setClosingInput] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // パフォーマンス対策: 期間/科目/検索/件数を全てサーバ側に渡してフィルタ + LIMIT する
  const [ledgerStartDate, setLedgerStartDate] = useState<string>(''); // YYYY-MM-DD
  const [ledgerEndDate, setLedgerEndDate] = useState<string>('');
  const [displayLimit, setDisplayLimit] = useState<number>(50);
  // カラム別検索（借方科目/貸方科目/金額/日付/摘要）
  const [searchDebit, setSearchDebit] = useState<string>('');
  const [searchCredit, setSearchCredit] = useState<string>('');
  const [searchAmount, setSearchAmount] = useState<string>('');
  const [searchDate, setSearchDate] = useState<string>('');
  const [searchDescription, setSearchDescription] = useState<string>('');

  // ─── サーバ側フィルタ済みの仕訳 ──────────────────────────────────────────
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filteredCount, setFilteredCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [closedUntil, setClosedUntil] = useState<string | null>(null);

  // 検索は Enter キー押下時のみ確定（自動検索なし）
  const [debouncedSearchDebit, setDebouncedSearchDebit] = useState('');
  const [debouncedSearchCredit, setDebouncedSearchCredit] = useState('');
  const [debouncedSearchAmount, setDebouncedSearchAmount] = useState('');
  const [debouncedSearchDate, setDebouncedSearchDate] = useState('');
  const [debouncedSearchDescription, setDebouncedSearchDescription] = useState('');

  const commitSearch = useCallback(() => {
    setDebouncedSearchDebit(searchDebit);
    setDebouncedSearchCredit(searchCredit);
    setDebouncedSearchAmount(searchAmount);
    setDebouncedSearchDate(searchDate);
    setDebouncedSearchDescription(searchDescription);
    setDisplayLimit(50);
  }, [searchDebit, searchCredit, searchAmount, searchDate, searchDescription]);

  // フィルタ/検索条件が変わったら表示件数を 50 にリセット
  useEffect(() => {
    setDisplayLimit(50);
  }, [
    ledgerStartDate, ledgerEndDate, accountFilter,
    debouncedSearchDebit, debouncedSearchCredit, debouncedSearchAmount,
    debouncedSearchDate, debouncedSearchDescription,
  ]);

  const buildLedgerParams = useCallback((limit: number) => {
    const params = new URLSearchParams();
    if (clientId) params.set('clientId', clientId);
    if (ledgerStartDate) params.set('startDate', ledgerStartDate.replace(/-/g, ''));
    if (ledgerEndDate) params.set('endDate', ledgerEndDate.replace(/-/g, ''));
    if (accountFilter) params.set('account', accountFilter);
    if (debouncedSearchDebit) params.set('searchDebit', debouncedSearchDebit);
    if (debouncedSearchCredit) params.set('searchCredit', debouncedSearchCredit);
    if (debouncedSearchAmount) params.set('searchAmount', debouncedSearchAmount.replace(/[^0-9]/g, ''));
    if (debouncedSearchDate) params.set('searchDate', debouncedSearchDate.replace(/[^0-9]/g, ''));
    if (debouncedSearchDescription) params.set('searchDescription', debouncedSearchDescription);
    params.set('limit', String(limit));
    return params;
  }, [
    clientId, ledgerStartDate, ledgerEndDate, accountFilter,
    debouncedSearchDebit, debouncedSearchCredit, debouncedSearchAmount,
    debouncedSearchDate, debouncedSearchDescription,
  ]);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = buildLedgerParams(displayLimit);
      const res = await fetch(`/api/journal-ledger?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '取得失敗');
      setEntries(data.entries ?? []);
      setFilteredCount(data.filteredCount ?? 0);
      setTotalCount(data.totalCount ?? 0);
      setClosedUntil(data.closedUntil ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '日記帳の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [buildLedgerParams, displayLimit]);

  useEffect(() => {
    fetchEntries();
    // refreshKey は親からのミューテーション通知。依存に含めて再 fetch を起動する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchEntries, refreshKey]);

  // 期間プリセット
  const setLedgerPeriod = (preset: 'all' | 'thisMonth' | 'lastMonth' | 'thisFiscal') => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    if (preset === 'all') { setLedgerStartDate(''); setLedgerEndDate(''); return; }
    if (preset === 'thisMonth') {
      const y = now.getFullYear(), m = now.getMonth();
      const last = new Date(y, m + 1, 0).getDate();
      setLedgerStartDate(`${y}-${pad(m + 1)}-01`);
      setLedgerEndDate(`${y}-${pad(m + 1)}-${pad(last)}`);
      return;
    }
    if (preset === 'lastMonth') {
      const y = now.getFullYear(), m = now.getMonth() - 1;
      const d = new Date(y, m, 1);
      const yy = d.getFullYear(), mm = d.getMonth();
      const last = new Date(yy, mm + 1, 0).getDate();
      setLedgerStartDate(`${yy}-${pad(mm + 1)}-01`);
      setLedgerEndDate(`${yy}-${pad(mm + 1)}-${pad(last)}`);
      return;
    }
    if (preset === 'thisFiscal') {
      const y = now.getFullYear(), m = now.getMonth();
      const fyStart = m >= 3 ? y : y - 1;
      setLedgerStartDate(`${fyStart}-04-01`);
      setLedgerEndDate(`${fyStart + 1}-03-31`);
      return;
    }
  };

  // ─── CSV インポートモーダル State ───────────────────────────
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<'select' | 'preview' | 'done'>('select');
  const [importPresetId, setImportPresetId] = useState(CSV_PRESETS[0].id);
  const [importPreview, setImportPreview] = useState<NormalizedJournalRow[]>([]);
  const [importSkipped, setImportSkipped] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ inserted: number; skipped: number } | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [csvSubmitting, setCsvSubmitting] = useState(false);
  const [csvSubmitted, setCsvSubmitted] = useState(false);
  const [csvSubmitComment, setCsvSubmitComment] = useState('');
  const importFileRef = useRef<HTMLInputElement>(null);

  const resetImport = () => {
    setImportStep('select');
    setImportPreview([]);
    setImportSkipped(0);
    setImportError(null);
    setImportLoading(false);
    setImportResult(null);
    setImportFile(null);
    setCsvSubmitted(false);
    setCsvSubmitComment('');
    if (importFileRef.current) importFileRef.current.value = '';
  };

  const handleSubmitCsvForReview = async () => {
    if (!importFile || csvSubmitting) return;
    if (importFile.size > 50 * 1024 * 1024) {
      alert('CSVは50MB以下にしてください');
      return;
    }
    setCsvSubmitting(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert('ログインしてからお試しください');
        return;
      }

      // gzip圧縮（CSVは可逆圧縮が非常に効くので5〜20倍縮む）
      const compressedBlob = await new Response(
        importFile.stream().pipeThrough(new CompressionStream('gzip'))
      ).blob();
      const compressedSize = compressedBlob.size;

      const safeName = importFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${user.id}/${Date.now()}-${safeName}.gz`;
      const { error: uploadError } = await supabase.storage
        .from('error-screenshots')
        .upload(storagePath, compressedBlob, { contentType: 'application/gzip', upsert: false });
      if (uploadError) throw new Error(`CSVアップロード失敗: ${uploadError.message}`);

      const res = await fetch('/api/csv-submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storagePath,
          presetId: importPresetId,
          errorMessage: importError || '',
          comment: csvSubmitComment,
          siteName: 'aiocr',
          fileName: importFile.name,
          fileSize: importFile.size,
          compressedSize,
          compressed: true,
        }),
      });
      const text = await res.text();
      let data: { success?: boolean; error?: string } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`サーバーから予期しない応答 (status ${res.status}): ${text.slice(0, 200)}`);
      }
      if (!res.ok) throw new Error(data.error || `送信に失敗しました (status ${res.status})`);
      setCsvSubmitted(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'CSV送信に失敗しました');
    } finally {
      setCsvSubmitting(false);
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportFile(file);
    setCsvSubmitted(false);

    const preset = CSV_PRESETS.find((p) => p.id === importPresetId);
    if (!preset) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const result = parseCsvWithPreset(text, preset);
      if (result.errors.length > 0) {
        setImportError(result.errors.join(', '));
        return;
      }
      if (result.rows.length === 0) {
        setImportError('インポート可能なデータ行がありません');
        return;
      }
      setImportPreview(result.rows);
      setImportSkipped(result.skipped);
      setImportStep('preview');
    };
    reader.onerror = () => setImportError('ファイルの読み込みに失敗しました');

    // Shift_JIS の場合は encoding 指定
    if (preset.encoding === 'shift_jis') {
      reader.readAsText(file, 'Shift_JIS');
    } else {
      reader.readAsText(file, 'UTF-8');
    }
  };

  const handleImportSubmit = async () => {
    if (!importFile || importPreview.length === 0) return;
    setImportLoading(true);
    setImportError(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('ログインしてからお試しください');

      // 大容量CSV対策: gzip圧縮 → Storage 直接アップロード → API には storagePath だけ渡す
      // （Vercel の 4.5MB body 上限による 413 を回避。「その他」CSV送信と同じ方式）
      const compressedBlob = await new Response(
        importFile.stream().pipeThrough(new CompressionStream('gzip'))
      ).blob();

      const safeName = importFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${user.id}/import-${Date.now()}-${safeName}.gz`;
      const { error: uploadError } = await supabase.storage
        .from('error-screenshots')
        .upload(storagePath, compressedBlob, { contentType: 'application/gzip', upsert: false });
      if (uploadError) throw new Error(`CSVアップロード失敗: ${uploadError.message}`);

      const res = await fetch('/api/journal-entries/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presetId: importPresetId,
          storagePath,
          compressed: true,
          clientId: clientId || null,
        }),
      });
      const text = await res.text();
      let data: { success?: boolean; inserted?: number; skipped?: number; error?: string } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`サーバー応答が不正 (status ${res.status}): ${text.slice(0, 200)}`);
      }
      if (!res.ok) throw new Error(data.error || `インポートに失敗 (status ${res.status})`);

      setImportResult({ inserted: data.inserted ?? 0, skipped: data.skipped ?? 0 });
      setImportStep('done');
      fetchEntries();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'インポートに失敗しました');
    } finally {
      setImportLoading(false);
    }
  };

  // モーダルレンダリング関数（空状態からも呼べるように抽出）
  const renderImportModal = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setImportOpen(false)}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <p className="text-base font-semibold text-slate-900">仕訳CSVインポート</p>
            <p className="text-[11px] text-slate-400 mt-0.5">会計ソフトから出力したCSVを取り込みます</p>
          </div>
          <button onClick={() => setImportOpen(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {importStep === 'select' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2">会計ソフトを選択</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {CSV_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setImportPresetId(p.unsupported ? '__other__' : p.id)}
                      className={`text-sm rounded-xl px-4 py-3 border-2 transition-all text-left relative ${
                        p.unsupported
                          ? importPresetId === '__other__'
                            ? 'border-amber-400 bg-amber-50 text-amber-700 cursor-pointer'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-amber-300 hover:bg-amber-50/50 cursor-pointer'
                          : importPresetId === p.id
                            ? 'border-sky-400 bg-sky-50 text-sky-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      <span className="font-semibold block">{p.label}</span>
                      {p.unsupported ? (
                        <span className="text-[10px] text-amber-500 mt-0.5 block">現在未対応 — 「その他」からCSVを送信してください</span>
                      ) : (
                        <span className="text-[10px] text-slate-400 mt-0.5 block">{p.description}</span>
                      )}
                    </button>
                  ))}
                  <button
                    onClick={() => setImportPresetId('__other__')}
                    className={`text-sm rounded-xl px-4 py-3 border-2 transition-all text-left ${
                      importPresetId === '__other__'
                        ? 'border-amber-400 bg-amber-50 text-amber-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <span className="font-semibold block">その他</span>
                    <span className="text-[10px] text-slate-400 mt-0.5 block">未対応ソフトのCSVを送信</span>
                  </button>
                </div>
              </div>
              {importPresetId === '__other__' ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-5 space-y-3">
                  <p className="text-sm font-semibold text-amber-800">
                    未対応の会計ソフトのCSVを送信
                  </p>
                  <p className="text-[11px] text-amber-600 leading-relaxed">
                    CSVファイルを送信していただければ、列マッピングを分析してインポートに対応します。
                    <br />
                    <span className="text-amber-500">※ 送信時はブラウザ内で gzip 圧縮します（5〜20倍縮みます）</span>
                  </p>
                  <input
                    ref={importFileRef}
                    type="file"
                    accept=".csv,.txt"
                    onChange={(e) => { setImportFile(e.target.files?.[0] ?? null); setCsvSubmitted(false); }}
                    className="block w-full text-sm text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-amber-100 file:text-amber-700 hover:file:bg-amber-200 cursor-pointer"
                  />
                  <textarea
                    value={csvSubmitComment}
                    onChange={(e) => setCsvSubmitComment(e.target.value)}
                    placeholder="会計ソフト名・バージョン・補足など"
                    className="w-full text-xs border border-amber-200 rounded-lg px-3 py-2 bg-white placeholder:text-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-400"
                    rows={2}
                  />
                  {!csvSubmitted ? (
                    <button
                      onClick={handleSubmitCsvForReview}
                      disabled={csvSubmitting || !importFile}
                      className="text-xs text-white bg-amber-500 rounded-xl px-5 py-2.5 font-semibold hover:bg-amber-600 transition-all disabled:opacity-40"
                    >
                      {csvSubmitting ? '送信中...' : 'CSVを送信して対応依頼'}
                    </button>
                  ) : (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700 font-medium">
                      送信しました。対応完了後にお知らせします。
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-2">CSVファイルを選択</label>
                    <input
                      ref={importFileRef}
                      type="file"
                      accept=".csv,.txt"
                      onChange={handleImportFile}
                      className="block w-full text-sm text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-sky-50 file:text-sky-600 hover:file:bg-sky-100 cursor-pointer"
                    />
                    <p className="text-[10px] text-slate-400 mt-1.5">
                      {CSV_PRESETS.find((p) => p.id === importPresetId)?.encoding === 'shift_jis'
                        ? 'Shift_JIS / UTF-8 どちらにも対応しています'
                        : 'UTF-8 形式のCSVに対応しています'}
                    </p>
                  </div>
                  {importError && (
                    <div className="space-y-3">
                      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{importError}</div>
                      {importFile && !csvSubmitted && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-4 space-y-2">
                          <p className="text-xs font-semibold text-amber-800">
                            このCSVの対応を依頼しますか？
                          </p>
                          <textarea
                            value={csvSubmitComment}
                            onChange={(e) => setCsvSubmitComment(e.target.value)}
                            placeholder="補足コメント（任意）"
                            className="w-full text-xs border border-amber-200 rounded-lg px-3 py-2 bg-white placeholder:text-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-400"
                            rows={2}
                          />
                          <button
                            onClick={handleSubmitCsvForReview}
                            disabled={csvSubmitting}
                            className="text-xs text-white bg-amber-500 rounded-xl px-4 py-2 font-semibold hover:bg-amber-600 transition-all disabled:opacity-40"
                          >
                            {csvSubmitting ? '送信中...' : 'CSVを送信して対応依頼'}
                          </button>
                        </div>
                      )}
                      {csvSubmitted && (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700 font-medium">
                          送信しました。対応完了後にお知らせします。
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {importStep === 'preview' && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-700">プレビュー: {importPreview.length} 件の仕訳</p>
                  {importSkipped > 0 && <p className="text-[11px] text-slate-400">{importSkipped} 件の空行をスキップ</p>}
                </div>
                <button onClick={resetImport} className="text-xs text-slate-500 border border-slate-200 rounded-xl px-3 py-1.5 hover:bg-slate-50">やり直す</button>
              </div>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="max-h-[320px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-400">#</th>
                        <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-400">日付</th>
                        <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-400">借方</th>
                        <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-400">貸方</th>
                        <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-400">金額</th>
                        <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-400">摘要</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {importPreview.slice(0, 100).map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50/50">
                          <td className="px-3 py-1.5 text-slate-300">{i + 1}</td>
                          <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap">
                            {r.entry_date.length === 8
                              ? `${r.entry_date.slice(0,4)}/${r.entry_date.slice(4,6)}/${r.entry_date.slice(6,8)}`
                              : r.entry_date}
                          </td>
                          <td className="px-3 py-1.5 text-slate-700">{r.debit_account}</td>
                          <td className="px-3 py-1.5 text-slate-700">{r.credit_account}</td>
                          <td className="px-3 py-1.5 text-right text-slate-700 tabular-nums">
                            {r.amount != null ? r.amount.toLocaleString() : '-'}
                          </td>
                          <td className="px-3 py-1.5 text-slate-500 truncate max-w-[200px]">{r.description || r.vendor_name || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {importPreview.length > 100 && (
                  <div className="px-3 py-2 bg-slate-50 text-[10px] text-slate-400 text-center">他 {importPreview.length - 100} 件は省略表示</div>
                )}
              </div>
              {importError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{importError}</div>
              )}
            </>
          )}
          {importStep === 'done' && importResult && (
            <div className="text-center py-8">
              <div className="w-14 h-14 bg-lime-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-lime-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-lg font-semibold text-slate-900">インポート完了</p>
              <p className="text-sm text-slate-500 mt-1">
                {importResult.inserted} 件の仕訳を取り込みました
                {importResult.skipped > 0 && `（${importResult.skipped} 件スキップ）`}
              </p>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          {importStep === 'preview' && (
            <button
              onClick={handleImportSubmit}
              disabled={importLoading}
              className="text-sm text-white bg-sky-500 rounded-xl px-5 py-2.5 font-semibold hover:bg-sky-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importLoading ? 'インポート中...' : `${importPreview.length} 件をインポート`}
            </button>
          )}
          <button
            onClick={() => { setImportOpen(false); resetImport(); }}
            className="text-sm text-slate-500 border border-slate-200 rounded-xl px-5 py-2.5 hover:bg-slate-50"
          >
            {importStep === 'done' ? '閉じる' : 'キャンセル'}
          </button>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="bg-white border border-slate-100 rounded-2xl p-10 text-center">
        <div className="w-8 h-8 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin mx-auto" />
        <p className="text-xs text-slate-400 mt-3">読み込み中...</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-4 text-sm text-red-600">{error}</div>
    );
  }
  // 初回 fetch 完了前 + 全くデータがない場合のみ「データなし」の空状態を出す
  if (entries === null) {
    return (
      <div className="bg-white border border-slate-100 rounded-2xl p-10 text-center">
        <div className="w-8 h-8 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin mx-auto" />
        <p className="text-xs text-slate-400 mt-3">読み込み中...</p>
      </div>
    );
  }
  if (totalCount === 0) {
    return (
      <div className="space-y-5">
        <div className="bg-white border border-slate-100 rounded-2xl p-10 text-center">
          <p className="text-sm text-slate-400">
            {clientName ? `${clientName} の` : ''}仕訳データはまだありません
          </p>
          <p className="text-xs text-slate-300 mt-2">「仕訳実行」タブで照合するか、CSVインポートで取り込めます</p>
          <button
            onClick={() => { resetImport(); setImportOpen(true); }}
            className="mt-4 text-sm text-white bg-sky-500 rounded-xl px-5 py-2.5 font-semibold hover:bg-sky-600 transition-all"
          >
            CSVインポート
          </button>
        </div>
        {/* インポートモーダル（空状態でも表示可能） */}
        {importOpen && renderImportModal()}
      </div>
    );
  }

  // ドロップダウン用の科目候補はマスタを優先（fetch される entries は表示分だけなので
  // 全候補が含まれない可能性がある）。マスタ未登録の科目で絞りたい場合は検索行を使用
  const accounts = accountsList.map((a) => a.name).sort();

  // entries は既にサーバ側でフィルタ + ソート + LIMIT (+群末尾保持) 済み
  const filtered = entries;
  const displayed = filtered;
  const hasMore = filteredCount > displayed.length;

  const editableFiltered = displayed.filter((e) => !e.locked);
  const allSelected = editableFiltered.length > 0 && editableFiltered.every((e) => selectedIds.has(e.id));
  const toggleAll = () => {
    setSelectedIds((prev) => {
      if (allSelected) return new Set();
      const next = new Set(prev);
      for (const e of editableFiltered) next.add(e.id);
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulk = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`${ids.length} 件の仕訳を削除しますか？`)) return;
    await onBulkDelete(ids);
    setSelectedIds(new Set());
  };

  return (
    <div className="flex gap-5 items-start">
      <JournalSidebarNav clientId={clientId} active="ledger" />
      <div className="flex-1 min-w-0 space-y-5">
      {/* ヘッダ */}
      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-slate-900 tracking-tight">
            仕訳日記帳 {clientName && <span className="text-sky-500">· {clientName}</span>}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            全 {totalCount.toLocaleString()} 件 · 該当 {filteredCount.toLocaleString()} 件 · 表示 {displayed.length.toLocaleString()} 件
            {loading && <span className="ml-2 text-sky-500">更新中...</span>}
            {selectedIds.size > 0 && <span className="ml-2 text-sky-600">· {selectedIds.size} 件選択中</span>}
            {closedUntil && (
              <span className="ml-2 text-amber-600">
                · 締め日 {formatDateYmd(closedUntil)} まで
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:border-sky-400"
          >
            <option value="">全勘定科目</option>
            {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {selectedIds.size > 0 && (
            <button
              onClick={handleBulk}
              className="text-xs text-white bg-red-500 rounded-xl px-4 py-2 font-semibold hover:bg-red-600 transition-all"
            >
              選択削除（{selectedIds.size}）
            </button>
          )}
          <button
            onClick={() => { resetImport(); setImportOpen(true); }}
            className="text-xs text-white bg-sky-500 rounded-xl px-4 py-2 font-semibold hover:bg-sky-600 transition-all"
          >
            CSVインポート
          </button>
          <div className="w-px h-5 bg-slate-200" aria-hidden />
          <button
            onClick={async () => {
              try {
                const params = buildLedgerParams(100000);
                const res = await fetch(`/api/journal-ledger?${params.toString()}`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'エクスポート失敗');
                const allEntries = (data.entries ?? []) as LedgerEntry[];
                const header = ['日付', '借方科目', '貸方科目', '金額', '摘要', '消費税区分', '取引先'];
                const rows = allEntries.map((e) => [
                  e.entry_date, e.debit_account, e.credit_account,
                  e.amount != null ? String(e.amount) : '',
                  e.description,
                  e.tax_category ? (TAX_CATEGORY_LABELS[e.tax_category] ?? e.tax_category) : (e.tax_type ?? ''),
                  e.vendor_name,
                ]);
                downloadCsv([header, ...rows], `仕訳日記帳${clientName ? '_' + clientName : ''}.csv`);
              } catch (e) {
                alert(e instanceof Error ? e.message : 'エクスポート失敗');
              }
            }}
            className="text-xs text-lime-700 bg-lime-50 border border-lime-200 rounded-xl px-4 py-2 font-semibold hover:bg-lime-100 transition-all"
          >
            CSVエクスポート
          </button>
          <button
            onClick={() => {
              const p2 = new URLSearchParams();
              p2.set('type', 'general-ledger');
              if (clientId) p2.set('clientId', clientId);
              if (ledgerStartDate) p2.set('startDate', ledgerStartDate.replace(/-/g, ''));
              if (ledgerEndDate) p2.set('endDate', ledgerEndDate.replace(/-/g, ''));
              if (accountFilter) p2.set('account', accountFilter);
              window.location.href = `/api/excel-export?${p2.toString()}`;
            }}
            className="text-xs text-lime-700 bg-lime-50 border border-lime-200 rounded-xl px-4 py-2 font-semibold hover:bg-lime-100 transition-all"
          >
            Excelエクスポート
          </button>
          <div className="w-px h-5 bg-slate-200" aria-hidden />
          <button
            onClick={fetchEntries}
            className="text-xs text-slate-500 border border-slate-200 rounded-xl px-3 py-2 hover:bg-slate-50"
          >
            再読み込み
          </button>
        </div>
      </div>

      {/* 期間フィルタ + 表示件数 */}
      <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3 justify-between">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">期間（開始）</p>
              <input
                type="date"
                value={ledgerStartDate}
                onChange={(e) => { setLedgerStartDate(e.target.value); setDisplayLimit(50); }}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-sky-400"
              />
            </div>
            <span className="text-slate-300 pb-2">〜</span>
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">期間（終了）</p>
              <input
                type="date"
                value={ledgerEndDate}
                onChange={(e) => { setLedgerEndDate(e.target.value); setDisplayLimit(50); }}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-sky-400"
              />
            </div>
            <div className="flex flex-wrap gap-1.5 ml-2">
              {([
                { key: 'all', label: '全期間' },
                { key: 'thisMonth', label: '今月' },
                { key: 'lastMonth', label: '先月' },
                { key: 'thisFiscal', label: '今年度' },
              ] as const).map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => { setLedgerPeriod(p.key); setDisplayLimit(50); }}
                  className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-600 transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">表示件数</p>
            <select
              value={displayLimit}
              onChange={(e) => setDisplayLimit(Number(e.target.value))}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-sky-400"
            >
              <option value={50}>50 件</option>
              <option value={100}>100 件</option>
              <option value={200}>200 件</option>
              <option value={500}>500 件</option>
              <option value={1000}>1000 件</option>
              <option value={5000}>5000 件</option>
              <option value={999999}>全件</option>
            </select>
          </div>
        </div>
      </div>

      {/* ─── CSV インポートモーダル ─── */}
      {importOpen && renderImportModal()}

      {/* 締め操作 */}
      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-700 tracking-tight">締め設定</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {closedUntil
                ? `${formatDateYmd(closedUntil)} 以前の仕訳は編集・削除できません`
                : 'まだ締められていません'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={closingInput}
              onChange={(e) => setClosingInput(e.target.value)}
              className="text-xs border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:border-sky-400"
            />
            <button
              onClick={() => {
                if (!closingInput) { alert('締め日を選択してください'); return; }
                const ymd = closingInput.replace(/-/g, '');
                if (!confirm(`${closingInput} までを締めますか？`)) return;
                onClose(ymd);
              }}
              className="text-xs text-white bg-amber-500 rounded-xl px-4 py-2 font-semibold hover:bg-amber-600 transition-all"
            >
              この日付で締める
            </button>
            {closedUntil && (
              <button
                onClick={onReopen}
                className="text-xs text-slate-500 border border-slate-200 rounded-xl px-3 py-2 hover:bg-slate-50"
              >
                締め解除
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 仕訳明細 */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-x-auto">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/40 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm font-semibold text-slate-700 tracking-tight">仕訳明細</p>
          {/* 借方 or 貸方に科目フィルタが入っているとき → その科目の総勘定元帳ショートカット */}
          {(debouncedSearchDebit || debouncedSearchCredit) && (
            <button
              type="button"
              onClick={() => {
                const acct = debouncedSearchDebit || debouncedSearchCredit;
                const params = new URLSearchParams();
                if (clientId) params.set('clientId', clientId);
                params.set('account', acct);
                if (ledgerStartDate) params.set('from', ledgerStartDate);
                if (ledgerEndDate) params.set('to', ledgerEndDate);
                window.open(`/general-ledger?${params.toString()}`, '_blank');
              }}
              className="text-[11px] text-sky-600 border border-sky-200 bg-sky-50 rounded-lg px-3 py-1.5 hover:bg-sky-100 transition-all whitespace-nowrap"
            >
              「{debouncedSearchDebit || debouncedSearchCredit}」の総勘定元帳を開く →
            </button>
          )}
        </div>
        <table className="w-full text-sm table-fixed" style={{ minWidth: '1260px' }}>
          <colgroup>
            <col style={{ width: '36px' }} />   {/* チェック */}
            <col style={{ width: '150px' }} />  {/* 日付（input[type=date] の曜日表示込みで折り返さない幅） */}
            <col style={{ width: '68px' }} />   {/* 種別 */}
            <col style={{ width: '44px' }} />   {/* 証憑 */}
            <col style={{ width: '150px' }} />  {/* 借方 */}
            <col style={{ width: '110px' }} />  {/* 借方金額 */}
            <col style={{ width: '150px' }} />  {/* 貸方 */}
            <col style={{ width: '110px' }} />  {/* 貸方金額 */}
            <col style={{ width: '160px' }} />  {/* 取引先 */}
            <col style={{ width: '90px' }} />   {/* 消費税区分 */}
            <col style={{ width: '90px' }} />   {/* 部門 */}
            <col style={{ width: '70px' }} />   {/* 承認 */}
            <col />                              {/* 摘要（残り） */}
          </colgroup>
          <thead className="bg-white">
            <tr className="border-b border-slate-100">
              <th className="px-2 py-3 text-center">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="cursor-pointer"
                />
              </th>
              <th className="px-2 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">日付</th>
              <th className="px-2 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">種別</th>
              <th className="px-2 py-3 text-center text-[10px] font-semibold text-slate-300 uppercase tracking-widest">証憑</th>
              <th className="px-2 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">借方</th>
              <th className="px-2 py-3 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">借方金額</th>
              <th className="px-2 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">貸方</th>
              <th className="px-2 py-3 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">貸方金額</th>
              <th className="px-2 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">取引先</th>
              <th className="px-2 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">消費税区分</th>
              <th className="px-2 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">部門</th>
              <th className="px-2 py-3 text-center text-[10px] font-semibold text-slate-300 uppercase tracking-widest">承認</th>
              <th className="px-2 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">摘要</th>
            </tr>
            {/* カラム別 検索行（部分一致） */}
            <tr className="border-b border-slate-100 bg-slate-50/30">
              <th className="px-1 py-1.5"></th>
              <th className="px-1 py-1.5">
                <input
                  type="text"
                  value={searchDate}
                  onChange={(e) => setSearchDate(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && commitSearch()}
                  placeholder="例 20251001 ↵"
                  className="w-full text-[11px] font-mono border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:border-sky-400 bg-white"
                />
              </th>
              <th className="px-1 py-1.5"></th>
              <th className="px-1 py-1.5"></th>
              <th className="px-1 py-1.5">
                <input
                  type="text"
                  value={searchDebit}
                  onChange={(e) => setSearchDebit(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && commitSearch()}
                  placeholder="借方科目 ↵"
                  className="w-full text-[11px] border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:border-sky-400 bg-white"
                />
              </th>
              <th className="px-1 py-1.5">
                <input
                  type="text"
                  value={searchAmount}
                  onChange={(e) => setSearchAmount(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && commitSearch()}
                  placeholder="金額 ↵"
                  inputMode="numeric"
                  className="w-full text-[11px] text-right tabular-nums border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:border-sky-400 bg-white"
                />
              </th>
              <th className="px-1 py-1.5">
                <input
                  type="text"
                  value={searchCredit}
                  onChange={(e) => setSearchCredit(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && commitSearch()}
                  placeholder="貸方科目 ↵"
                  className="w-full text-[11px] border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:border-sky-400 bg-white"
                />
              </th>
              <th className="px-1 py-1.5">
                {(searchDebit || searchCredit || searchAmount || searchDate || searchDescription || debouncedSearchDebit || debouncedSearchCredit || debouncedSearchAmount || debouncedSearchDate || debouncedSearchDescription) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchDebit('');
                      setSearchCredit('');
                      setSearchAmount('');
                      setSearchDate('');
                      setSearchDescription('');
                      setDebouncedSearchDebit('');
                      setDebouncedSearchCredit('');
                      setDebouncedSearchAmount('');
                      setDebouncedSearchDate('');
                      setDebouncedSearchDescription('');
                      setDisplayLimit(50);
                    }}
                    className="w-full text-[10px] text-slate-500 border border-slate-200 hover:bg-slate-50 rounded px-1.5 py-1"
                  >
                    検索クリア
                  </button>
                ) : null}
              </th>
              <th className="px-1 py-1.5"></th>
              <th className="px-1 py-1.5"></th>
              <th className="px-1 py-1.5"></th>
              <th className="px-1 py-1.5"></th>
              <th className="px-1 py-1.5">
                <input
                  type="text"
                  value={searchDescription}
                  onChange={(e) => setSearchDescription(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && commitSearch()}
                  placeholder="摘要キーワード ↵"
                  className="w-full text-[11px] border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:border-sky-400 bg-white"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              // voucher_group_id でグループ化された連続行に視覚的な区切りを付ける
              // - 連続するグループは交互に薄い帯背景
              // - グループ末尾の下にだけ太いボーダー
              // - 多明細グループの先頭行に貸借合計バッジ（一致確認用）

              // グループ全体の借方/貸方合計を entries 全件から事前集計
              // （displayed は表示制限で切られているため group の一部しか含まない場合がある）
              const groupTotalsAll = new Map<string, { debit: number; credit: number; lines: number }>();
              for (const e of entries) {
                if (!e.voucher_group_id) continue;
                const t = groupTotalsAll.get(e.voucher_group_id) || { debit: 0, credit: 0, lines: 0 };
                const hasD = !!e.debit_account && e.debit_account !== '不明';
                const hasC = !!e.credit_account && e.credit_account !== '不明';
                const dAmt = e.debit_amount ?? (hasD ? e.amount : null);
                const cAmt = e.credit_amount ?? (hasC ? e.amount : null);
                if (dAmt != null) t.debit += Number(dAmt);
                if (cAmt != null) t.credit += Number(cAmt);
                t.lines++;
                groupTotalsAll.set(e.voucher_group_id, t);
              }

              const groupRowSlots: Array<{ entry: LedgerEntry; groupKey: string; isFirstInGroup: boolean; isLastInGroup: boolean; bandIdx: number }> = [];
              let prevGroup = '';
              let bandIdx = 0;
              for (let i = 0; i < displayed.length; i++) {
                const e = displayed[i];
                const groupKey = e.voucher_group_id || `__single_${e.id}`;
                const isFirstInGroup = groupKey !== prevGroup;
                const next = displayed[i + 1];
                const nextGroup = next ? (next.voucher_group_id || `__single_${next.id}`) : '';
                const isLastInGroup = groupKey !== nextGroup;
                if (isFirstInGroup) bandIdx++;
                groupRowSlots.push({ entry: e, groupKey, isFirstInGroup, isLastInGroup, bandIdx });
                prevGroup = groupKey;
              }
              return groupRowSlots.map(({ entry: e, isFirstInGroup, isLastInGroup, bandIdx }) => {
                const summary = e.voucher_group_id ? groupTotalsAll.get(e.voucher_group_id) ?? null : null;
                return (
                <EditableRow
                  key={`${e.id}_${e.updated_at}`}
                  entry={e}
                  isFirstInGroup={isFirstInGroup}
                  isLastInGroup={isLastInGroup}
                  bandIdx={bandIdx}
                  groupSummary={summary && summary.lines > 1 ? summary : null}
                  selected={selectedIds.has(e.id)}
                  onToggleSelect={() => toggleOne(e.id)}
                  onSaveField={onSaveField}
                  accountsList={accountsList}
                  addAccountLocal={addAccountLocal}
                  vendorsList={vendorsList}
                  addVendorLocal={addVendorLocal}
                  onAddRule={onAddRule}
                  departmentsList={departmentsList}
                />
                );
              });
            })()}
          </tbody>
        </table>
        {hasMore && (
          <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/40 flex items-center justify-between text-xs">
            <p className="text-slate-500">
              残り <span className="font-semibold text-slate-700">{(filteredCount - displayed.length).toLocaleString()}</span> 件あります
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDisplayLimit((n) => n + 50)}
                className="text-sky-600 border border-sky-200 bg-sky-50 hover:bg-sky-100 rounded-lg px-3 py-1.5 font-semibold"
              >
                +50 件 表示
              </button>
              <button
                type="button"
                onClick={() => setDisplayLimit((n) => n + 500)}
                className="text-sky-600 border border-sky-200 bg-sky-50 hover:bg-sky-100 rounded-lg px-3 py-1.5 font-semibold"
              >
                +500 件 表示
              </button>
              <button
                type="button"
                onClick={() => setDisplayLimit(filteredCount)}
                className="text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg px-3 py-1.5 font-semibold"
              >
                すべて表示（{filteredCount.toLocaleString()} 件）
              </button>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

// ─── 承認ステータス表示コンポーネント ───────────────────────────────────────
const APPROVAL_LABELS: Record<string, string> = {
  approved: '承認済', rejected: '却下', pending: '承認待', draft: '草稿',
};
const APPROVAL_COLORS: Record<string, string> = {
  approved: 'bg-lime-100 text-lime-700',
  rejected: 'bg-red-100 text-red-600',
  pending: 'bg-amber-100 text-amber-700',
  draft: 'bg-slate-100 text-slate-500',
};

function ApprovalBadge({ status }: { status?: string | null }) {
  if (!status || status === 'approved') return null;
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${APPROVAL_COLORS[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {APPROVAL_LABELS[status] ?? status}
    </span>
  );
}

function ApprovalCell({
  status, onApprove, onReject, onReset,
}: {
  status?: string | null;
  onApprove: () => void;
  onReject: () => void;
  onReset: () => void;
}) {
  const s = status ?? 'approved';
  if (s === 'approved') {
    return (
      <button onClick={onReset} title="承認済み（クリックで承認待ちに戻す）"
        className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-lime-100 text-lime-700 hover:bg-lime-200 transition-colors">
        承認済
      </button>
    );
  }
  if (s === 'rejected') {
    return (
      <button onClick={onReset} title="却下（クリックで承認待ちに戻す）"
        className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-red-100 text-red-600 hover:bg-red-200 transition-colors">
        却下
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-0.5 items-center">
      <button onClick={onApprove} title="承認する"
        className="text-[8px] px-1.5 py-0.5 rounded bg-lime-50 text-lime-700 border border-lime-200 hover:bg-lime-100 transition-colors leading-tight w-full">
        ✓ 承認
      </button>
      <button onClick={onReject} title="却下する"
        className="text-[8px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors leading-tight w-full">
        ✕ 却下
      </button>
    </div>
  );
}

// ─── インライン編集行 ──────────────────────────────────────────────────────

function EditableRow({
  entry,
  isFirstInGroup,
  isLastInGroup,
  bandIdx,
  groupSummary,
  selected,
  onToggleSelect,
  onSaveField,
  accountsList,
  addAccountLocal,
  vendorsList,
  addVendorLocal,
  onAddRule,
  departmentsList,
}: {
  entry: LedgerEntry;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  bandIdx: number;
  groupSummary: { debit: number; credit: number; lines: number } | null;
  selected: boolean;
  onToggleSelect: () => void;
  onSaveField: (id: string, patch: Partial<LedgerEntry>) => Promise<void>;
  accountsList: AccountOption[];
  addAccountLocal: (name: string, reading?: string, sub_category?: string) => Promise<AccountOption | null>;
  vendorsList: AccountOption[];
  addVendorLocal: (name: string, reading?: string) => Promise<AccountOption | null>;
  onAddRule: (pattern_type: 'vendor' | 'description', pattern: string, debit_account: string) => Promise<unknown>;
  departmentsList: { id: string; name: string; code: string | null }[];
}) {
  const [date, setDate] = useState(entry.entry_date === '不明' ? '' : entry.entry_date);
  const [debitAccount, setDebitAccount] = useState(entry.debit_account);
  const [creditAccount, setCreditAccount] = useState(entry.credit_account);
  // 多明細仕訳では debit_amount と credit_amount が異なるので分けて編集する
  const initialDebitAmt = entry.debit_amount ?? entry.amount;
  const initialCreditAmt = entry.credit_amount ?? entry.amount;
  const [debitAmount, setDebitAmount] = useState(initialDebitAmt != null ? String(initialDebitAmt) : '');
  const [creditAmount, setCreditAmount] = useState(initialCreditAmt != null ? String(initialCreditAmt) : '');
  const [vendorName, setVendorName] = useState(entry.vendor_name);
  const [description, setDescription] = useState(entry.description);
  const [taxCategory, setTaxCategory] = useState(entry.tax_category ?? '');
  const [departmentId, setDepartmentId] = useState(entry.department_id ?? '');
  const isVoucherSplit = !!entry.voucher_group_id && (entry.voucher_total_lines ?? 1) > 1;

  const dateInputValue = date.length === 8
    ? `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`
    : '';

  const saveIfChanged = (patch: Partial<LedgerEntry>) => {
    if (entry.locked) return;
    onSaveField(entry.id, patch);
  };

  // 同一仕訳(voucher_group_id)のグルーピング目印 + 税表示用の補助
  const grouped = !!entry.voucher_group_id;
  const taxLabel = entry.tax_amount
    ? `税:${entry.tax_rate ? ` ${entry.tax_rate}%` : ''} ¥${Number(entry.tax_amount).toLocaleString()}`
    : '';

  // 「不明」「空」科目を片側だけのものとして扱い、その側の金額欄を消す
  const hasDebit = !!entry.debit_account && entry.debit_account !== '不明';
  const hasCredit = !!entry.credit_account && entry.credit_account !== '不明';

  // グループ内連続行の視覚的グルーピング:
  //  - グループ末尾: 太い下ボーダー
  //  - グループ内行: 通常の細い下ボーダー
  //  - 同グループは交互の薄い帯背景（bandIdx の偶奇）
  const groupBandBg = grouped
    ? (bandIdx % 2 === 0 ? 'bg-sky-50/30' : 'bg-white')
    : '';
  const groupBorder = grouped && isLastInGroup
    ? 'border-b-2 border-b-sky-200'
    : 'border-b border-b-slate-50';
  const groupSideBorder = grouped ? 'border-l-4 border-l-sky-200' : '';

  // 多明細仕訳の先頭行に貸借合計バッジ（一致確認用）
  // 「片方しか入っていない」サブ行（仮払消費税など）を見ても群全体で貸借一致していることが分かるようにする
  const voucherBadge = (isFirstInGroup && groupSummary) ? (
    <tr className={`${groupBandBg} ${groupSideBorder} border-b border-b-slate-100`}>
      <td colSpan={12} className="px-3 py-1.5">
        <div className="flex items-center gap-3 text-[10px] text-slate-500 flex-wrap">
          <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 font-semibold tracking-wide">
            多明細仕訳 {groupSummary.lines}行
          </span>
          <span className="font-mono">借方計 ¥{groupSummary.debit.toLocaleString()}</span>
          <span className="text-slate-300">/</span>
          <span className="font-mono">貸方計 ¥{groupSummary.credit.toLocaleString()}</span>
          {groupSummary.debit === groupSummary.credit ? (
            <span className="text-lime-600 font-semibold">✓ 貸借一致</span>
          ) : (
            <span className="text-red-500 font-semibold">
              ⚠ 不一致（差 ¥{Math.abs(groupSummary.debit - groupSummary.credit).toLocaleString()}）
            </span>
          )}
        </div>
      </td>
    </tr>
  ) : null;

  if (entry.locked) {
    return (
      <>
      {voucherBadge}
      <tr className={`${groupBandBg || 'bg-amber-50/20'} ${groupSideBorder} ${groupBorder}`}>
        <td className="px-2 py-2 text-center">
          <IconLock className="w-3 h-3 text-amber-500 mx-auto" />
        </td>
        <td className="px-2 py-2 text-xs font-mono text-slate-500">
          {isFirstInGroup ? formatDateYmd(entry.entry_date) : <span className="text-slate-300">〃</span>}
        </td>
        <td className="px-2 py-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            entry.entry_type === 'accrual' ? 'bg-sky-100 text-sky-600'
            : entry.entry_type === 'payment' ? 'bg-lime-100 text-lime-700'
            : 'bg-slate-100 text-slate-600'
          }`}>
            {entry.entry_type === 'accrual' ? '費用計上' : entry.entry_type === 'payment' ? '支払消込' : '手動'}
          </span>
        </td>
        <td className="px-2 py-2 text-center">
          <div className="flex items-center justify-center gap-1">
            {entry.ocr_upload_id ? (
              <button
                type="button"
                onClick={() => openJournalPdf(entry.id, 'invoice')}
                className="text-sky-500 hover:text-sky-700 transition-colors"
                title="請求書PDFを開く"
                aria-label="請求書PDFを開く"
              >
                <IconFile className="w-4 h-4" />
              </button>
            ) : null}
            {entry.bank_ocr_upload_id ? (
              <button
                type="button"
                onClick={() => openJournalPdf(entry.id, 'bank')}
                className="text-lime-500 hover:text-lime-700 transition-colors"
                title="通帳PDFを開く"
                aria-label="通帳PDFを開く"
              >
                <IconArchive className="w-4 h-4" />
              </button>
            ) : null}
            {!entry.ocr_upload_id && !entry.bank_ocr_upload_id && (
              <span className="text-slate-200 text-[10px]">—</span>
            )}
          </div>
        </td>
        <td className="px-2 py-2 text-xs text-slate-600">
          {hasDebit ? entry.debit_account : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-2 py-2 text-right text-sm font-semibold text-slate-900 tabular-nums">
          {hasDebit && initialDebitAmt != null ? `¥${Number(initialDebitAmt).toLocaleString()}` : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-2 py-2 text-xs text-slate-600">
          {hasCredit ? entry.credit_account : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-2 py-2 text-right text-sm font-semibold text-slate-900 tabular-nums">
          {hasCredit && initialCreditAmt != null ? `¥${Number(initialCreditAmt).toLocaleString()}` : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-2 py-2 text-xs text-slate-600 truncate" title={entry.vendor_name}>{entry.vendor_name}</td>
        <td className="px-2 py-2">
          {entry.tax_category ? (
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${TAX_CATEGORY_COLORS[entry.tax_category] ?? 'bg-slate-100 text-slate-500'}`}>
              {TAX_CATEGORY_LABELS[entry.tax_category] ?? entry.tax_category}
            </span>
          ) : <span className="text-slate-200 text-[10px]">—</span>}
        </td>
        <td className="px-2 py-2 text-xs text-slate-500 truncate">
          {entry.department_id ? (departmentsList.find(d => d.id === entry.department_id)?.name ?? '—') : <span className="text-slate-200 text-[10px]">—</span>}
        </td>
        <td className="px-2 py-2 text-center">
          <ApprovalBadge status={entry.approval_status} />
        </td>
        <td className="px-2 py-2 text-xs text-slate-500 truncate" title={`${entry.description}${taxLabel ? ' / ' + taxLabel : ''}`}>
          {entry.description}
          {taxLabel && <span className="ml-1 text-[9px] text-slate-400">[{taxLabel}]</span>}
        </td>
      </tr>
      </>
    );
  }

  return (
    <>
    {voucherBadge}
    <tr className={`${selected ? 'bg-sky-50/40' : (groupBandBg || 'hover:bg-slate-50/30')} ${groupSideBorder} ${groupBorder}`}>
      <td className="px-2 py-1.5 text-center">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} className="cursor-pointer" />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="date"
          value={dateInputValue}
          onChange={(e) => setDate(e.target.value.replace(/-/g, ''))}
          onBlur={() => {
            const next = date || '不明';
            if (next !== entry.entry_date) saveIfChanged({ entry_date: next });
          }}
          className="w-full text-xs font-mono border border-transparent hover:border-slate-200 focus:border-sky-400 rounded px-1.5 py-1 focus:outline-none bg-transparent"
        />
      </td>
      <td className="px-2 py-1.5">
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
          entry.entry_type === 'accrual' ? 'bg-sky-100 text-sky-600'
          : entry.entry_type === 'payment' ? 'bg-lime-100 text-lime-700'
          : 'bg-slate-100 text-slate-600'
        }`}>
          {entry.entry_type === 'accrual' ? '費用計上' : entry.entry_type === 'payment' ? '支払消込' : '手動'}
        </span>
      </td>
      <td className="px-2 py-1.5 text-center">
        <div className="flex items-center justify-center gap-1">
          {entry.ocr_upload_id ? (
            <span className="inline-flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => openJournalPdf(entry.id, 'invoice')}
                className="text-sky-500 hover:text-sky-700 transition-colors"
                title="請求書PDFを開く"
                aria-label="請求書PDFを開く"
              >
                <IconFile className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!confirm('この仕訳と請求書の紐づけを解除しますか？\n解除後、再照合で紐づけ直せます。')) return;
                  saveIfChanged({ ocr_upload_id: null } as Partial<LedgerEntry>);
                }}
                className="text-slate-300 hover:text-red-400 transition-colors"
                title="請求書の紐づけを解除"
                aria-label="請求書の紐づけを解除"
              >
                <IconX className="w-3 h-3" />
              </button>
            </span>
          ) : null}
          {entry.bank_ocr_upload_id ? (
            <span className="inline-flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => openJournalPdf(entry.id, 'bank')}
                className="text-lime-500 hover:text-lime-700 transition-colors"
                title="通帳PDFを開く"
                aria-label="通帳PDFを開く"
              >
                <IconArchive className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!confirm('この仕訳と通帳の紐づけを解除しますか？')) return;
                  saveIfChanged({ bank_ocr_upload_id: null } as Partial<LedgerEntry>);
                }}
                className="text-slate-300 hover:text-red-400 transition-colors"
                title="通帳の紐づけを解除"
                aria-label="通帳の紐づけを解除"
              >
                <IconX className="w-3 h-3" />
              </button>
            </span>
          ) : null}
          {!entry.ocr_upload_id && !entry.bank_ocr_upload_id && (
            <span className="text-slate-200 text-[10px]">—</span>
          )}
        </div>
      </td>
      <td className="px-2 py-1.5">
        <AccountCombobox
          value={debitAccount}
          onChange={(v) => {
            setDebitAccount(v);
            if (v !== entry.debit_account && accountsList.some((a) => a.name === v)) {
              saveIfChanged({ debit_account: v });
            }
          }}
          onCommit={(v) => {
            if (v !== entry.debit_account) saveIfChanged({ debit_account: v });
          }}
          accounts={accountsList}
          onCreate={addAccountLocal}
          dense
        />
        {(() => {
          const meta = accountsList.find((a) => a.name === debitAccount);
          const debitAmtNum = debitAmount === '' ? null : Number(debitAmount);
          if (
            isFixedAssetAccountName(debitAccount, meta?.sub_category) &&
            isSmallAssetAmount(debitAmtNum)
          ) {
            return (
              <p
                className="mt-0.5 text-[9px] text-amber-600 leading-tight"
                title={SMALL_ASSET_ADVICE_DETAIL}
              >
                {SMALL_ASSET_ADVICE_SHORT}
              </p>
            );
          }
          return null;
        })()}
      </td>
      <td className="px-2 py-1.5">
        {hasDebit ? (
          <input
            type="number"
            value={debitAmount}
            onChange={(e) => setDebitAmount(e.target.value)}
            onBlur={() => {
              const next = debitAmount === '' ? null : Number(debitAmount);
              if (next === initialDebitAmt) return;
              if (isVoucherSplit) {
                // 多明細仕訳では借方だけを更新
                saveIfChanged({ debit_amount: next });
              } else {
                // 単一仕訳では amount と両側を揃える
                saveIfChanged({ amount: next, debit_amount: next, credit_amount: next });
                if (next != null) setCreditAmount(String(next));
              }
            }}
            className="w-full text-sm text-right tabular-nums border border-transparent hover:border-slate-200 focus:border-sky-400 rounded px-1.5 py-1 focus:outline-none bg-transparent"
          />
        ) : (
          <span className="block text-right text-slate-300">—</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        <AccountCombobox
          value={creditAccount}
          onChange={(v) => {
            setCreditAccount(v);
            if (v !== entry.credit_account && accountsList.some((a) => a.name === v)) {
              saveIfChanged({ credit_account: v });
            }
          }}
          onCommit={(v) => {
            if (v !== entry.credit_account) saveIfChanged({ credit_account: v });
          }}
          accounts={accountsList}
          onCreate={addAccountLocal}
          dense
        />
        {(() => {
          const meta = accountsList.find((a) => a.name === creditAccount);
          const creditAmtNum = creditAmount === '' ? null : Number(creditAmount);
          if (
            isFixedAssetAccountName(creditAccount, meta?.sub_category) &&
            isSmallAssetAmount(creditAmtNum)
          ) {
            return (
              <p
                className="mt-0.5 text-[9px] text-amber-600 leading-tight"
                title={SMALL_ASSET_ADVICE_DETAIL}
              >
                {SMALL_ASSET_ADVICE_SHORT}
              </p>
            );
          }
          return null;
        })()}
      </td>
      <td className="px-2 py-1.5">
        {hasCredit ? (
          <input
            type="number"
            value={creditAmount}
            onChange={(e) => setCreditAmount(e.target.value)}
            onBlur={() => {
              const next = creditAmount === '' ? null : Number(creditAmount);
              if (next === initialCreditAmt) return;
              if (isVoucherSplit) {
                saveIfChanged({ credit_amount: next });
              } else {
                saveIfChanged({ amount: next, debit_amount: next, credit_amount: next });
                if (next != null) setDebitAmount(String(next));
              }
            }}
            className="w-full text-sm text-right tabular-nums border border-transparent hover:border-slate-200 focus:border-sky-400 rounded px-1.5 py-1 focus:outline-none bg-transparent"
          />
        ) : (
          <span className="block text-right text-slate-300">—</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        <AccountCombobox
          value={vendorName}
          onChange={(v) => {
            setVendorName(v);
            if (v !== entry.vendor_name && vendorsList.some((a) => a.name === v)) {
              saveIfChanged({ vendor_name: v });
            }
          }}
          onCommit={(v) => {
            if (v !== entry.vendor_name) saveIfChanged({ vendor_name: v });
          }}
          accounts={vendorsList}
          onCreate={addVendorLocal}
          dense
        />
      </td>
      <td className="px-2 py-1.5">
        <select
          value={taxCategory}
          onChange={(e) => {
            const v = e.target.value;
            setTaxCategory(v);
            saveIfChanged({ tax_category: v || null } as Partial<LedgerEntry>);
          }}
          disabled={entry.locked}
          className="w-full text-[10px] border border-transparent hover:border-slate-200 focus:border-sky-400 rounded px-1 py-1 focus:outline-none bg-transparent cursor-pointer"
        >
          <option value="">—</option>
          <option value="taxable_sales">課税売上</option>
          <option value="tax_exempt_sales">非課税売上</option>
          <option value="taxable_purchase">課税仕入</option>
          <option value="non_taxable">免税・不課税</option>
        </select>
      </td>
      <td className="px-2 py-1.5">
        <select
          value={departmentId}
          onChange={(e) => {
            const v = e.target.value;
            setDepartmentId(v);
            saveIfChanged({ department_id: v || null } as Partial<LedgerEntry>);
          }}
          disabled={entry.locked}
          className="w-full text-[10px] border border-transparent hover:border-slate-200 focus:border-sky-400 rounded px-1 py-1 focus:outline-none bg-transparent cursor-pointer"
        >
          <option value="">—</option>
          {departmentsList.map(d => (
            <option key={d.id} value={d.id}>{d.code ? `${d.code} ` : ''}{d.name}</option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5 text-center">
        <ApprovalCell
          status={entry.approval_status}
          onApprove={() => saveIfChanged({ approval_status: 'approved' })}
          onReject={() => saveIfChanged({ approval_status: 'rejected' })}
          onReset={() => saveIfChanged({ approval_status: 'pending' })}
        />
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1 min-w-0">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => {
              if (description !== entry.description) saveIfChanged({ description });
            }}
            title={taxLabel ? `税: ${taxLabel}` : undefined}
            className="min-w-0 flex-1 text-xs border border-transparent hover:border-slate-200 focus:border-sky-400 rounded px-1.5 py-1 focus:outline-none bg-transparent"
          />
          {taxLabel && (
            <span className="text-[9px] text-slate-400 shrink-0" title={taxLabel}>[{taxLabel}]</span>
          )}
          {/* ルール化: 相手先→科目 */}
          <button
            type="button"
            title={`相手先ルール追加: 「${vendorName}」→ ${debitAccount}`}
            disabled={!vendorName.trim() || !debitAccount.trim()}
            onClick={async () => {
              if (!vendorName.trim() || !debitAccount.trim()) return;
              if (!confirm(`相手先ルールを追加:\n「${vendorName}」→ ${debitAccount}`)) return;
              await onAddRule('vendor', vendorName, debitAccount);
            }}
            className="text-[10px] shrink-0 text-sky-600 border border-sky-200 bg-sky-50 hover:bg-sky-100 rounded w-6 h-6 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
          >
            🏷️
          </button>
          {/* ルール化: 摘要パターン */}
          <button
            type="button"
            title={`摘要ルール追加: 「${description}」を含む → ${debitAccount}`}
            disabled={!description.trim() || !debitAccount.trim()}
            onClick={async () => {
              const pat = prompt('摘要キーワード（この文字列を含む取引にルールが適用されます）', description);
              if (!pat || !pat.trim()) return;
              if (!confirm(`摘要ルールを追加:\n「${pat}」を含む → ${debitAccount}`)) return;
              await onAddRule('description', pat, debitAccount);
            }}
            className="text-[10px] shrink-0 text-lime-700 border border-lime-200 bg-lime-50 hover:bg-lime-100 rounded w-6 h-6 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
          >
            📝
          </button>
        </div>
      </td>
    </tr>
    </>
  );
}

// ─── 残高ビュー（勘定科目別 + 未払費用 取引先別） ───────────────────────────

interface FixedAssetRow {
  id: string;
  asset_number: number;
  category: 'tangible' | 'intangible' | 'deferred';
  name: string;
  account_name: string;
  acquisition_date: string | null;
  depreciation_start_date: string | null;
  acquisition_cost: number;
  residual_value: number;
  useful_life_years: number | null;
  method: string;
  last_depreciated_through: string | null;
  status: 'pending' | 'active' | 'disposed';
}

interface AccountingRuleRow {
  id: string;
  effective_from_date: string;
  depreciation_method_tangible: 'indirect' | 'direct';
  depreciation_method_intangible: 'indirect' | 'direct';
  depreciation_method_deferred: 'indirect' | 'direct';
  depreciation_timing: 'monthly' | 'annual';
}

// 勘定科目をグループ順で整列するためのカテゴリ順序
const CATEGORY_ORDER: Record<string, number> = {
  asset: 1, liability: 2, equity: 3, revenue: 4, expense: 5,
};
const CATEGORY_LABEL: Record<string, string> = {
  asset: '資産', liability: '負債', equity: '純資産', revenue: '収益', expense: '費用',
};
const SUB_CATEGORY_ORDER: Record<string, number> = {
  '流動資産': 1, '固定資産': 2, '繰延資産': 3,
  '流動負債': 1, '固定負債': 2,
  '純資産': 1,
  '売上高': 1, '営業外収益': 2, '特別利益': 3,
  '売上原価': 1, '販管費': 2, '営業外費用': 3, '特別損失': 4,
};

interface BalanceApiResponse {
  accounts: string[];
  accountBalances: Record<string, { debit: number; credit: number }>;
  vendorBreakdownByAccount: Record<string, VendorBreakdownRow[]>;
  totalCount: number;
  filteredCount: number;
  closedUntil: string | null;
  depreciationEntries: BalanceDepreciationEntry[];
}

interface BalanceDepreciationEntry {
  id: string;
  source_fixed_asset_id: string;
  entry_date: string | null;
  amount: number | null;
}

function BalanceView({
  clientName,
  clientId,
  onRefresh,
  accountsList,
  onOpenGeneralLedger,
  unmatchedTransactions,
  consumedUnmatchedIdx,
  onConsumeUnmatched,
}: {
  clientName: string | null;
  clientId: string | null;
  onRefresh: () => void;
  accountsList: AccountOption[];
  onOpenGeneralLedger: (account: string, vendor?: string | null, from?: string | null, to?: string | null) => void;
  unmatchedTransactions: TransactionInput[];
  consumedUnmatchedIdx: Set<number>;
  onConsumeUnmatched: (idx: number) => void;
}) {
  // 期間フィルタ: YYYY-MM-DD（空=全期間）
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // サーバ集計データ
  const [balanceData, setBalanceData] = useState<BalanceApiResponse | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  // 会計期間（期首残高を「期間内増減」と組み合わせて期首→期末の流れを表示するため）
  interface FiscalPeriodLite {
    id: string;
    name: string;
    start_date: string;
    end_date: string;
    opening_balances: Record<string, number> | null;
  }
  const [periods, setPeriods] = useState<FiscalPeriodLite[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams();
        if (clientId) params.set('clientId', clientId);
        const res = await fetch(`/api/fiscal-periods?${params.toString()}`);
        if (res.ok) {
          const json = await res.json();
          setPeriods(json.periods ?? []);
        }
      } catch {
        // 期首残高は補助情報なので失敗しても残高画面は機能させる
      }
    })();
  }, [clientId]);
  // 指定期間が会計期と完全一致したら、その期の opening_balances を期首残高として使う
  const matchingPeriod = useMemo(
    () => periods.find((p) => p.start_date === startDate && p.end_date === endDate) ?? null,
    [periods, startDate, endDate]
  );
  const openingBalances: Record<string, number> = matchingPeriod?.opening_balances ?? {};
  const hasOpeningBalances = matchingPeriod !== null;

  const fetchBalance = useCallback(async () => {
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      const params = new URLSearchParams();
      if (clientId) params.set('clientId', clientId);
      if (startDate) params.set('startDate', startDate.replace(/-/g, ''));
      if (endDate) params.set('endDate', endDate.replace(/-/g, ''));
      const res = await fetch(`/api/journal-balance?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '残高取得失敗');
      setBalanceData(json as BalanceApiResponse);
    } catch (e) {
      setBalanceError(e instanceof Error ? e.message : '残高の取得に失敗しました');
    } finally {
      setBalanceLoading(false);
    }
  }, [clientId, startDate, endDate]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  // 残高画面内のミューテーション後に呼ぶ統合リフレッシュ
  // （balance再集計 + 親側の元帳など他ビューも更新）
  const refreshAll = useCallback(() => {
    fetchBalance();
    onRefresh();
  }, [fetchBalance, onRefresh]);

  // TB各行の取引先別ドリルダウン展開状態
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());

  // 固定資産
  const [fixedAssets, setFixedAssets] = useState<FixedAssetRow[]>([]);
  const [rules, setRules] = useState<AccountingRuleRow[]>([]);
  const [depMode, setDepMode] = useState<'append' | 'overwrite'>('append');
  const [depTiming, setDepTiming] = useState<'monthly' | 'annual'>('annual');
  const [depPeriodStart, setDepPeriodStart] = useState<string>('');
  const [depPeriodEnd, setDepPeriodEnd] = useState<string>('');
  const [depMsg, setDepMsg] = useState<string | null>(null);
  const [checkRows, setCheckRows] = useState<Array<{ asset_id: string; asset_number: number; name: string; category: string; required: number; posted: number; diff: number }> | null>(null);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [newRule, setNewRule] = useState({
    effective_from_date: '',
    depreciation_method_tangible: 'indirect' as 'indirect' | 'direct',
    depreciation_method_intangible: 'direct' as 'indirect' | 'direct',
    depreciation_method_deferred: 'direct' as 'indirect' | 'direct',
    depreciation_timing: 'annual' as 'monthly' | 'annual',
  });
  // ルール保存後の再計算ダイアログ
  const [showRecalcDialog, setShowRecalcDialog] = useState(false);
  const [recalcDialogFrom, setRecalcDialogFrom] = useState<string>('');
  const [recalcDialogTo, setRecalcDialogTo] = useState<string>('');
  const [recalcDialogMode, setRecalcDialogMode] = useState<'rewrite' | 'adjust'>('rewrite');
  const [recalcDialogBusy, setRecalcDialogBusy] = useState(false);
  const [recalcDialogResult, setRecalcDialogResult] = useState<string | null>(null);

  const fetchFixedAssets = async () => {
    const params = new URLSearchParams();
    if (clientId) params.set('clientId', clientId);
    const res = await fetch(`/api/fixed-assets?${params}`);
    const json = await res.json();
    if (res.ok) setFixedAssets(json.assets ?? []);
  };
  const fetchRules = async () => {
    const params = new URLSearchParams();
    if (clientId) params.set('clientId', clientId);
    const res = await fetch(`/api/accounting-rules?${params}`);
    const json = await res.json();
    if (res.ok) setRules(json.rules ?? []);
  };
  useEffect(() => {
    fetchFixedAssets();
    fetchRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const generateDepreciation = async () => {
    if (!depPeriodStart || !depPeriodEnd) {
      setDepMsg('期間を指定してください');
      return;
    }
    setDepMsg('生成中...');
    const res = await fetch('/api/depreciation/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        period_start: depPeriodStart,
        period_end: depPeriodEnd,
        mode: depMode,
        timing: depTiming,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setDepMsg(`エラー: ${json.error}`);
      return;
    }
    setDepMsg(`計上 ${json.inserted} 件 / スキップ ${json.skipped} 件`);
    await fetchFixedAssets();
    refreshAll();
  };

  const checkDepreciation = async () => {
    if (!depPeriodStart || !depPeriodEnd) {
      setDepMsg('期間を指定してください');
      return;
    }
    const params = new URLSearchParams({ period_start: depPeriodStart, period_end: depPeriodEnd });
    if (clientId) params.set('clientId', clientId);
    const res = await fetch(`/api/depreciation/check?${params}`);
    const json = await res.json();
    if (!res.ok) { setDepMsg(`エラー: ${json.error}`); return; }
    setCheckRows(json.rows ?? []);
    setDepMsg(`理論値合計 ¥${json.total_required.toLocaleString()} / 計上済合計 ¥${json.total_posted.toLocaleString()} / 差額 ¥${json.total_diff.toLocaleString()}`);
  };

  const saveRule = async () => {
    if (!newRule.effective_from_date) { alert('有効開始日を指定してください'); return; }
    const res = await fetch('/api/accounting-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, ...newRule }),
    });
    const json = await res.json();
    if (!res.ok) { alert(json.error); return; }
    setShowRuleForm(false);
    await fetchRules();
    // ルール保存成功 → 再計算ダイアログを自動表示
    // デフォルト期間: ルールの有効開始日 〜 当期末（3月決算）
    const now = new Date();
    const m = now.getMonth();
    const fyEnd = m >= 3 ? `${now.getFullYear() + 1}-03-31` : `${now.getFullYear()}-03-31`;
    setRecalcDialogFrom(newRule.effective_from_date);
    setRecalcDialogTo(fyEnd);
    setRecalcDialogMode('rewrite');
    setRecalcDialogResult(null);
    setRecalcDialogBusy(false);
    setShowRecalcDialog(true);
  };

  const executeRecalcFromDialog = async () => {
    if (!recalcDialogFrom || !recalcDialogTo) return;
    setRecalcDialogBusy(true);
    setRecalcDialogResult(null);
    const res = await fetch('/api/depreciation/recalc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        from_date: recalcDialogFrom,
        to_date: recalcDialogTo,
        mode: recalcDialogMode,
        timing: depTiming,
      }),
    });
    const json = await res.json();
    setRecalcDialogBusy(false);
    if (!res.ok) {
      setRecalcDialogResult(`エラー: ${json.error}`);
      return;
    }
    setRecalcDialogResult(`完了: 削除 ${json.deleted ?? 0} 件 / 計上 ${json.inserted} 件 / 調整額合計 ¥${(json.adjustment_total ?? 0).toLocaleString()}`);
    refreshAll();
  };

  const deleteRule = async (id: string) => {
    if (!confirm('このルールを削除しますか？')) return;
    await fetch(`/api/accounting-rules?id=${id}`, { method: 'DELETE' });
    await fetchRules();
  };

  const [recalcMode, setRecalcMode] = useState<'rewrite' | 'adjust'>('rewrite');
  const [recalcFrom, setRecalcFrom] = useState<string>('');
  const [recalcTo, setRecalcTo] = useState<string>('');
  const [recalcMsg, setRecalcMsg] = useState<string | null>(null);
  const runRecalc = async () => {
    if (!recalcFrom || !recalcTo) { setRecalcMsg('期間を指定してください'); return; }
    if (!confirm(`${recalcMode === 'rewrite' ? '既存の償却仕訳を削除して再生成' : '差額を一括修正仕訳として計上'}します。よろしいですか?`)) return;
    setRecalcMsg('再計算中...');
    const res = await fetch('/api/depreciation/recalc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        from_date: recalcFrom,
        to_date: recalcTo,
        mode: recalcMode,
        timing: depTiming,
      }),
    });
    const json = await res.json();
    if (!res.ok) { setRecalcMsg(`エラー: ${json.error}`); return; }
    setRecalcMsg(`完了: 削除 ${json.deleted ?? 0} 件 / 計上 ${json.inserted} 件 / 調整額合計 ¥${(json.adjustment_total ?? 0).toLocaleString()}`);
    refreshAll();
  };

  const toYmd = (iso: string) => iso.replace(/-/g, ''); // YYYY-MM-DD → YYYYMMDD

  const setPeriod = (preset: 'all' | 'thisMonth' | 'lastMonth' | 'thisFiscal') => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    if (preset === 'all') {
      setStartDate(''); setEndDate('');
      return;
    }
    if (preset === 'thisMonth') {
      const y = now.getFullYear(), m = now.getMonth();
      const last = new Date(y, m + 1, 0).getDate();
      setStartDate(`${y}-${pad(m + 1)}-01`);
      setEndDate(`${y}-${pad(m + 1)}-${pad(last)}`);
      return;
    }
    if (preset === 'lastMonth') {
      const y = now.getFullYear(), m = now.getMonth() - 1;
      const d = new Date(y, m, 1);
      const yy = d.getFullYear(), mm = d.getMonth();
      const last = new Date(yy, mm + 1, 0).getDate();
      setStartDate(`${yy}-${pad(mm + 1)}-01`);
      setEndDate(`${yy}-${pad(mm + 1)}-${pad(last)}`);
      return;
    }
    if (preset === 'thisFiscal') {
      // 4月始まり
      const y = now.getFullYear(), m = now.getMonth();
      const fyStart = m >= 3 ? y : y - 1;
      setStartDate(`${fyStart}-04-01`);
      setEndDate(`${fyStart + 1}-03-31`);
      return;
    }
  };

  // 初回フェッチ前のローディング（再フェッチ時はデータを残してチラつき防止）
  if (balanceLoading && !balanceData) {
    return (
      <div className="bg-white border border-slate-100 rounded-2xl p-10 text-center">
        <div className="w-8 h-8 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin mx-auto" />
        <p className="text-xs text-slate-400 mt-3">読み込み中...</p>
      </div>
    );
  }
  if (balanceError) {
    return <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-4 text-sm text-red-600">{balanceError}</div>;
  }
  if (!balanceData || balanceData.totalCount === 0) {
    return (
      <div className="bg-white border border-slate-100 rounded-2xl p-10 text-center">
        <p className="text-sm text-slate-400">
          {clientName ? `${clientName} の` : ''}残高データはまだありません
        </p>
      </div>
    );
  }

  const { accounts, accountBalances, vendorBreakdownByAccount, totalCount, filteredCount, depreciationEntries } = balanceData;

  const toggleExpand = (acc: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(acc)) next.delete(acc); else next.add(acc);
      return next;
    });
  };

  const periodLabel =
    startDate && endDate ? `${startDate} 〜 ${endDate}`
    : startDate ? `${startDate} 〜`
    : endDate ? `〜 ${endDate}`
    : '全期間';

  return (
    <div className="space-y-5">
      {/* 期間フィルタ */}
      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-3 justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">開始日</p>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-sky-400"
              />
            </div>
            <span className="text-slate-300 pb-2">〜</span>
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">終了日</p>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-sky-400"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {periods.length > 0 && (
              <select
                value={matchingPeriod?.id ?? ''}
                onChange={(e) => {
                  const p = periods.find((x) => x.id === e.target.value);
                  if (p) {
                    setStartDate(p.start_date);
                    setEndDate(p.end_date);
                  }
                }}
                className="text-[11px] font-semibold px-2 py-1.5 rounded-lg border border-sky-200 text-sky-700 bg-sky-50/40 hover:border-sky-300 focus:outline-none focus:border-sky-400"
                title="会計期を選ぶと期首→期末の残高推移が見られます"
              >
                <option value="">会計期から選択 ▾</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            {([
              { key: 'all', label: '全期間' },
              { key: 'thisMonth', label: '今月' },
              { key: 'lastMonth', label: '先月' },
              { key: 'thisFiscal', label: '今年度' },
            ] as const).map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-600 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-slate-400 mt-3">
          期間: <span className="font-mono text-slate-600">{periodLabel}</span>
          <span className="ml-3">対象仕訳 {filteredCount} / {totalCount} 件</span>
          {balanceLoading && <span className="ml-3 text-sky-500">更新中...</span>}
        </p>
      </div>

      {filteredCount === 0 && (
        <div className="bg-white border border-slate-100 rounded-2xl p-10 text-center">
          <p className="text-sm text-slate-400">指定期間に該当する仕訳はありません</p>
        </div>
      )}

      {/* ─── 固定資産・減価償却（折りたたみ：BS償却関連は分離して見やすく） ─── */}
      <details className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        <summary className="px-5 py-4 cursor-pointer hover:bg-slate-50/40 select-none flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-700 tracking-tight">固定資産・減価償却</p>
            <p className="text-[10px] text-slate-400 mt-0.5">クリックで開く（資産マスタ・償却仕訳生成・会計ルール）</p>
          </div>
          <span className="text-xs text-slate-400">▼</span>
        </summary>
        <div className="border-t border-slate-100 p-1 space-y-5">
          {/* ─── 固定資産 ─── */}
          <FixedAssetSection
            assets={fixedAssets}
            entries={depreciationEntries}
            clientId={clientId}
            onRefresh={() => { fetchFixedAssets(); refreshAll(); }}
            depPeriodStart={depPeriodStart}
            unmatchedTransactions={unmatchedTransactions}
            consumedUnmatchedIdx={consumedUnmatchedIdx}
            onConsumeUnmatched={onConsumeUnmatched}
          />

      {/* 減価償却仕訳 生成パネル */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-sky-50/40">
          <p className="text-sm font-semibold text-sky-700 tracking-tight">減価償却 仕訳生成 / 整合チェック</p>
          <p className="text-[10px] text-sky-500/70 mt-0.5">期間内の活動中の資産を対象に自動計上</p>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">期首</p>
              <input type="date" value={depPeriodStart} onChange={(e) => setDepPeriodStart(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-sky-400" />
            </div>
            <span className="text-slate-300 pb-2">〜</span>
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">期末</p>
              <input type="date" value={depPeriodEnd} onChange={(e) => setDepPeriodEnd(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-sky-400" />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">計上タイミング</p>
              <select value={depTiming} onChange={(e) => setDepTiming(e.target.value as 'monthly' | 'annual')}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-sky-400">
                <option value="annual">年次（期末に1件）</option>
                <option value="monthly">月次（各月末）</option>
              </select>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">既存仕訳</p>
              <select value={depMode} onChange={(e) => setDepMode(e.target.value as 'append' | 'overwrite')}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-sky-400">
                <option value="append">未計上月のみ追加</option>
                <option value="overwrite">期間内を上書き</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={generateDepreciation}
              className="text-xs text-white bg-sky-500 rounded-xl px-4 py-2 font-semibold hover:bg-sky-600">
              減価償却仕訳を生成
            </button>
            <button onClick={checkDepreciation}
              className="text-xs text-lime-700 border border-lime-300 bg-lime-50 rounded-xl px-4 py-2 font-semibold hover:bg-lime-100">
              当期償却額をチェック
            </button>
          </div>
          {depMsg && <p className="text-[11px] text-slate-500 font-mono">{depMsg}</p>}
          {checkRows && checkRows.length > 0 && (
            <div className="overflow-x-auto border border-slate-100 rounded-xl">
              <table className="w-full text-xs">
                <thead className="bg-slate-50/50">
                  <tr>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">資産</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest">理論値</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest">計上済</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest">差額</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {checkRows.map((r) => (
                    <tr key={r.asset_id}>
                      <td className="px-3 py-2 text-slate-700">#{r.asset_number} {r.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">¥{r.required.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">¥{r.posted.toLocaleString()}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${r.diff === 0 ? 'text-slate-400' : 'text-amber-600'}`}>
                        {r.diff >= 0 ? '+' : ''}¥{r.diff.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 会計ルール */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/40 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-700 tracking-tight">減価償却 会計ルール</p>
            <p className="text-[10px] text-slate-400 mt-0.5">有効開始日の昇順 · 日付以降で新しいルールが適用</p>
          </div>
          <button onClick={() => setShowRuleForm(!showRuleForm)}
            className="text-[11px] text-sky-600 border border-sky-200 bg-sky-50 rounded-lg px-3 py-1.5 hover:bg-sky-100">
            {showRuleForm ? '閉じる' : '+ ルール追加'}
          </button>
        </div>
        {showRuleForm && (
          <div className="px-5 py-4 border-b border-slate-100 bg-sky-50/20 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">有効開始日</p>
                <input type="date" value={newRule.effective_from_date}
                  onChange={(e) => setNewRule({ ...newRule, effective_from_date: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-sky-400" />
              </div>
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">計上タイミング</p>
                <select value={newRule.depreciation_timing}
                  onChange={(e) => setNewRule({ ...newRule, depreciation_timing: e.target.value as 'monthly' | 'annual' })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-sky-400">
                  <option value="annual">年次</option>
                  <option value="monthly">月次</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {(['tangible', 'intangible', 'deferred'] as const).map((cat) => {
                const label = cat === 'tangible' ? '有形' : cat === 'intangible' ? '無形' : '繰延';
                const key = cat === 'tangible' ? 'depreciation_method_tangible' : cat === 'intangible' ? 'depreciation_method_intangible' : 'depreciation_method_deferred';
                return (
                  <div key={cat}>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">{label}償却</p>
                    <select value={newRule[key]}
                      onChange={(e) => setNewRule({ ...newRule, [key]: e.target.value as 'indirect' | 'direct' })}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-sky-400">
                      <option value="indirect">間接法</option>
                      <option value="direct">直接法</option>
                    </select>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end">
              <button onClick={saveRule}
                className="text-xs text-white bg-sky-500 rounded-xl px-4 py-2 font-semibold hover:bg-sky-600">
                ルールを保存
              </button>
            </div>
          </div>
        )}
        {/* ルール保存後の再計算ダイアログ（モーダル） */}
        {showRecalcDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 bg-sky-50/40">
                <p className="text-sm font-semibold text-slate-700">ルールを保存しました</p>
                <p className="text-[11px] text-slate-500 mt-0.5">該当期間の償却仕訳を再計算しますか？</p>
              </div>
              <div className="px-5 py-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">再計算開始日</p>
                    <input type="date" value={recalcDialogFrom} onChange={(e) => setRecalcDialogFrom(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-sky-400" />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">終了日</p>
                    <input type="date" value={recalcDialogTo} onChange={(e) => setRecalcDialogTo(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-sky-400" />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">再計算モード</p>
                  <select value={recalcDialogMode} onChange={(e) => setRecalcDialogMode(e.target.value as 'rewrite' | 'adjust')}
                    className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-sky-400">
                    <option value="rewrite">既存を削除して再生成（rewrite）</option>
                    <option value="adjust">差額を修正仕訳で計上（adjust）</option>
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {recalcDialogMode === 'rewrite'
                      ? '期間内の償却仕訳をすべて削除し、新ルールで再生成します'
                      : '既存仕訳はそのまま保持し、差額のみ修正仕訳として計上します'}
                  </p>
                </div>
                {recalcDialogResult && (
                  <div className={`text-[11px] font-mono px-3 py-2 rounded-lg ${recalcDialogResult.startsWith('エラー') ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
                    {recalcDialogResult}
                  </div>
                )}
              </div>
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/40 flex justify-end gap-2">
                <button onClick={() => setShowRecalcDialog(false)}
                  className="text-xs text-slate-500 border border-slate-200 rounded-xl px-4 py-2 hover:bg-slate-100">
                  {recalcDialogResult && !recalcDialogResult.startsWith('エラー') ? '閉じる' : '後で再計算'}
                </button>
                {!(recalcDialogResult && !recalcDialogResult.startsWith('エラー')) && (
                  <button onClick={executeRecalcFromDialog} disabled={recalcDialogBusy || !recalcDialogFrom || !recalcDialogTo}
                    className="text-xs text-white bg-sky-500 rounded-xl px-4 py-2 font-semibold hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed">
                    {recalcDialogBusy ? '再計算中...' : '再計算を実行'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        {/* 過去償却仕訳の再計算パネル */}
        <div className="px-5 py-4 border-b border-slate-100 bg-amber-50/30">
          <p className="text-xs font-semibold text-amber-700 mb-2">ルール変更時の過去償却仕訳 再計算</p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <p className="text-[10px] text-slate-400 mb-1">再計算開始日</p>
              <input type="date" value={recalcFrom} onChange={(e) => setRecalcFrom(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-amber-400" />
            </div>
            <span className="text-slate-300 pb-2">〜</span>
            <div>
              <p className="text-[10px] text-slate-400 mb-1">終了日</p>
              <input type="date" value={recalcTo} onChange={(e) => setRecalcTo(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-amber-400" />
            </div>
            <div>
              <p className="text-[10px] text-slate-400 mb-1">モード</p>
              <select value={recalcMode} onChange={(e) => setRecalcMode(e.target.value as 'rewrite' | 'adjust')}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-amber-400">
                <option value="rewrite">既存を削除して再生成</option>
                <option value="adjust">差額を修正仕訳で計上</option>
              </select>
            </div>
            <button onClick={runRecalc}
              className="text-xs text-white bg-amber-500 rounded-xl px-4 py-2 font-semibold hover:bg-amber-600">
              再計算を実行
            </button>
          </div>
          {recalcMsg && <p className="text-[11px] text-slate-600 font-mono mt-2">{recalcMsg}</p>}
          <p className="text-[10px] text-slate-400 mt-1.5">
            再生成: 既存の償却仕訳を期間削除→最新ルール適用 / 修正仕訳: 既存は保持し差額のみ開始日に1件計上
          </p>
        </div>

        {rules.length === 0 ? (
          <div className="p-5 text-xs text-slate-400 text-center">
            ルール未登録（デフォルト: 有形=間接法 / 無形=直接法 / 繰延=直接法 / 年次）
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-white">
                <tr className="border-b border-slate-50">
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">有効開始日</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">有形</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">無形</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">繰延</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">タイミング</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-mono text-slate-700">{r.effective_from_date}</td>
                    <td className="px-3 py-2 text-slate-600">{r.depreciation_method_tangible === 'indirect' ? '間接法' : '直接法'}</td>
                    <td className="px-3 py-2 text-slate-600">{r.depreciation_method_intangible === 'indirect' ? '間接法' : '直接法'}</td>
                    <td className="px-3 py-2 text-slate-600">{r.depreciation_method_deferred === 'indirect' ? '間接法' : '直接法'}</td>
                    <td className="px-3 py-2 text-slate-600">{r.depreciation_timing === 'monthly' ? '月次' : '年次'}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => deleteRule(r.id)} className="text-[10px] text-red-400 hover:text-red-600">削除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
        </div>
      </details>

      {/* 勘定科目別 集計
          - BS科目: 期首残高 → 期間内増減 → 期末残高
          - PL科目: 期間内発生額（自然符号で正＝自然増加方向）
          - カテゴリ・サブカテゴリ内では「期間内増減の絶対額が大きい順」に整列
            （ユーザーが「動いた科目」をすぐ見つけて取引先別に深掘りできるように） */}
      {(() => {
        // BS=B/S科目, PL=P/L科目 の判定
        const isBs = (cat: string) => cat === 'asset' || cat === 'liability' || cat === 'equity';
        // 「自然符号」での期間内増減: その科目で正の値が「自然増加方向」になるよう符号調整
        //  資産・費用 = 借方残高が自然 → debit - credit
        //  負債・純資産・収益 = 貸方残高が自然 → credit - debit
        const naturalNet = (cat: string, d: number, c: number) =>
          cat === 'liability' || cat === 'equity' || cat === 'revenue' ? c - d : d - c;
        const fmtSigned = (n: number) => (n >= 0 ? '¥' : '−¥') + Math.abs(n).toLocaleString();
        const colorByNet = (n: number) =>
          n > 0 ? 'text-sky-600' : n < 0 ? 'text-lime-600' : 'text-slate-400';

        // accountsList から name → meta を引く
        const metaByName = new Map<string, AccountOption>();
        for (const a of accountsList) metaByName.set(a.name, a);

        type AccRow = {
          name: string; category: string; sub: string; order: number;
          debit: number; credit: number;
          opening: number; netChange: number; ending: number;
        };
        const rows: AccRow[] = accounts.map((acc) => {
          const meta = metaByName.get(acc);
          const b = accountBalances[acc] ?? { debit: 0, credit: 0 };
          const cat = meta?.category ?? '';
          const opening = isBs(cat) ? (openingBalances[acc] ?? 0) : 0;
          const netChange = naturalNet(cat, b.debit, b.credit);
          return {
            name: acc,
            category: cat,
            sub: meta?.sub_category ?? '',
            order: meta?.display_order ?? 0,
            debit: b.debit, credit: b.credit,
            opening,
            netChange,
            ending: opening + netChange,
          };
        });
        rows.sort((a, b) => {
          const ca = CATEGORY_ORDER[a.category] ?? 99;
          const cb = CATEGORY_ORDER[b.category] ?? 99;
          if (ca !== cb) return ca - cb;
          const sa = SUB_CATEGORY_ORDER[a.sub] ?? 99;
          const sb = SUB_CATEGORY_ORDER[b.sub] ?? 99;
          if (sa !== sb) return sa - sb;
          // 期間内増減の絶対額が大きい順（カテゴリ・サブ内）
          const absDiff = Math.abs(b.netChange) - Math.abs(a.netChange);
          if (absDiff !== 0) return absDiff;
          if (a.order !== b.order) return a.order - b.order;
          return a.name.localeCompare(b.name, 'ja');
        });

        // category 単位の小計
        const categoryTotals: Record<string, { opening: number; netChange: number; ending: number }> = {};
        for (const r of rows) {
          const key = r.category || 'unknown';
          if (!categoryTotals[key]) categoryTotals[key] = { opening: 0, netChange: 0, ending: 0 };
          categoryTotals[key].opening += r.opening;
          categoryTotals[key].netChange += r.netChange;
          categoryTotals[key].ending += r.ending;
        }

        return (
          <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 bg-sky-50/40">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-slate-700 tracking-tight">勘定科目別 集計</p>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    💡 <span className="font-semibold text-sky-700">大きく動いた科目から順に並んでいます</span>。気になる科目の行をクリックすると <span className="font-semibold text-sky-700">どの取引先で動いたか</span>（取引先別の増減）が見られます。
                  </p>
                </div>
                <a
                  href={`/api/excel-export?type=trial-balance${clientId ? `&clientId=${clientId}` : ''}${startDate ? `&startDate=${startDate.replace(/-/g, '')}` : ''}${endDate ? `&endDate=${endDate.replace(/-/g, '')}` : ''}`}
                  className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 font-semibold hover:bg-emerald-100 transition-all whitespace-nowrap"
                  download
                >
                  Excel出力
                </a>
              </div>
              {!hasOpeningBalances && periods.length > 0 && (
                <p className="text-[10px] text-amber-600 mt-2">
                  ※ 期首残高を表示するには上の「会計期から選択」で期を選んでください（期首→期末の流れが見えます）
                </p>
              )}
              {!hasOpeningBalances && periods.length === 0 && (
                <p className="text-[10px] text-slate-400 mt-2">
                  ※ 会計期と期首残高を「決算書」タブで登録すると、期首→期末の流れも表示されます
                </p>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="border-b border-slate-50">
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">勘定科目 / 取引先</th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">期首残高</th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">期間内増減</th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">期末残高</th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest w-20">元帳</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const elements: React.ReactNode[] = [];
                    let prevCategory = '__init__';
                    let prevSub = '__init__';
                    for (const r of rows) {
                      const cat = r.category || 'unknown';
                      const catIsBs = isBs(cat);
                      if (cat !== prevCategory) {
                        const t = categoryTotals[cat] ?? { opening: 0, netChange: 0, ending: 0 };
                        elements.push(
                          <tr key={`cat-${cat}`} className="bg-sky-50/60 border-y border-sky-100">
                            <td className="px-4 py-2 text-[11px] font-bold text-sky-700 uppercase tracking-wider">
                              {CATEGORY_LABEL[cat] ?? '未分類'}
                            </td>
                            <td className="px-4 py-2 text-right text-[11px] font-semibold text-sky-700 tabular-nums">
                              {catIsBs ? `¥${t.opening.toLocaleString()}` : <span className="text-sky-300">—</span>}
                            </td>
                            <td className={`px-4 py-2 text-right text-[11px] font-semibold tabular-nums ${colorByNet(t.netChange)}`}>
                              {fmtSigned(t.netChange)}
                            </td>
                            <td className="px-4 py-2 text-right text-[11px] font-semibold text-sky-700 tabular-nums">
                              {catIsBs ? `¥${t.ending.toLocaleString()}` : <span className="text-sky-300">—</span>}
                            </td>
                            <td className="px-4 py-2"></td>
                          </tr>
                        );
                        prevCategory = cat;
                        prevSub = '__init__';
                      }
                      if (r.sub && r.sub !== prevSub) {
                        elements.push(
                          <tr key={`sub-${cat}-${r.sub}`} className="bg-slate-50/40">
                            <td colSpan={5} className="px-6 py-1.5 text-[10px] font-semibold text-slate-500">
                              {r.sub}
                            </td>
                          </tr>
                        );
                        prevSub = r.sub;
                      }
                      const expanded = expandedAccounts.has(r.name);
                      const vendorRowsForAcc = vendorBreakdownByAccount[r.name] ?? [];
                      const hasVendorBreakdown = vendorRowsForAcc.length > 0;
                      elements.push(
                        <tr key={`acc-${r.name}`} className={`${expanded ? 'bg-sky-50/30' : 'hover:bg-slate-50/40'} border-b border-slate-50`}>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => toggleExpand(r.name)}
                              className="text-xs text-slate-700 font-medium hover:text-sky-600 cursor-pointer text-left flex items-center gap-1.5 group"
                              title={hasVendorBreakdown ? `取引先別の増減を${expanded ? '閉じる' : '開く'}` : '取引先別データなし'}
                            >
                              <span className={`text-slate-300 group-hover:text-sky-400 text-[10px] transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
                              <span className={expanded ? 'text-sky-700' : ''}>{r.name}</span>
                              {hasVendorBreakdown && (
                                <span className="text-[9px] text-slate-300 font-normal">({vendorRowsForAcc.length}先)</span>
                              )}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-slate-500 tabular-nums">
                            {catIsBs ? `¥${r.opening.toLocaleString()}` : <span className="text-slate-300">—</span>}
                          </td>
                          <td className={`px-4 py-3 text-right text-xs font-semibold tabular-nums ${colorByNet(r.netChange)}`}
                            title={`借方合計 ¥${r.debit.toLocaleString()} / 貸方合計 ¥${r.credit.toLocaleString()}`}
                          >
                            {fmtSigned(r.netChange)}
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-slate-500 tabular-nums">
                            {catIsBs ? `¥${r.ending.toLocaleString()}` : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onOpenGeneralLedger(r.name, null, startDate || null, endDate || null); }}
                              className="text-[10px] text-sky-600 hover:text-sky-800 hover:underline"
                              title={`${r.name} 全体の総勘定元帳を新しいタブで開く`}
                            >
                              開く →
                            </button>
                          </td>
                        </tr>
                      );
                      if (expanded && hasVendorBreakdown) {
                        elements.push(
                          <tr key={`acc-${r.name}-vendor-header`} className="bg-slate-50/40 border-b border-slate-50">
                            <td colSpan={5} className="px-10 py-1.5 text-[9px] font-semibold text-slate-400 uppercase tracking-widest">
                              取引先別の期間内増減（大きい順）
                            </td>
                          </tr>
                        );
                        for (const vr of vendorRowsForAcc) {
                          // 取引先別も科目の自然符号に揃える（科目とカテゴリが同じ）
                          const vNet = naturalNet(cat, vr.debit, vr.credit);
                          const vendorParam = vr.isUnregistered ? '__unregistered__' : vr.vendor;
                          elements.push(
                            <tr key={`acc-${r.name}-v-${vr.vendor}`} className={vr.isUnregistered ? 'bg-amber-50/30 hover:bg-amber-50/60' : 'hover:bg-sky-50/30'}>
                              <td className={`px-10 py-2 text-[11px] ${vr.isUnregistered ? 'text-amber-700' : 'text-slate-600'}`}>
                                ↳ {vr.vendor}
                                {vr.isUnregistered && <span className="ml-1 text-[9px] text-amber-500">⚠</span>}
                                <span className="ml-2 text-[9px] text-slate-300">{vr.entryCount}件</span>
                              </td>
                              <td className="px-4 py-2 text-right text-[11px] text-slate-300 tabular-nums">—</td>
                              <td className={`px-4 py-2 text-right text-[11px] font-semibold tabular-nums ${colorByNet(vNet)}`}
                                title={`借方合計 ¥${vr.debit.toLocaleString()} / 貸方合計 ¥${vr.credit.toLocaleString()}`}
                              >
                                {fmtSigned(vNet)}
                              </td>
                              <td className="px-4 py-2 text-right text-[11px] text-slate-300 tabular-nums">—</td>
                              <td className="px-4 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onOpenGeneralLedger(r.name, vendorParam, startDate || null, endDate || null); }}
                                  className="text-[10px] text-sky-600 hover:text-sky-800 hover:underline"
                                  title={`${r.name} × ${vr.vendor} の総勘定元帳を新しいタブで開く`}
                                >
                                  開く →
                                </button>
                              </td>
                            </tr>
                          );
                        }
                      }
                    }
                    return elements;
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── 固定資産セクション ─────────────────────────────────────────────────

const FIXED_ASSET_CATEGORY_LABEL: Record<string, string> = {
  tangible: '有形固定資産',
  intangible: '無形固定資産',
  deferred: '繰延資産',
};

function FixedAssetSection({
  assets,
  entries,
  clientId,
  onRefresh,
  depPeriodStart,
  unmatchedTransactions,
  consumedUnmatchedIdx,
  onConsumeUnmatched,
}: {
  assets: FixedAssetRow[];
  entries: BalanceDepreciationEntry[];
  clientId: string | null;
  onRefresh: () => void;
  depPeriodStart: string;
  unmatchedTransactions: TransactionInput[];
  consumedUnmatchedIdx: Set<number>;
  onConsumeUnmatched: (idx: number) => void;
}) {
  void clientId; // 未使用警告回避
  // 処分ダイアログ
  const [disposeTarget, setDisposeTarget] = useState<FixedAssetRow | null>(null);
  const [disposeForm, setDisposeForm] = useState({
    disposal_type: 'retired' as 'retired' | 'sold',
    disposal_date: '',
    disposal_amount: 0,
    cash_account: '普通預金',
    bank_idx: null as number | null,
  });
  const [disposing, setDisposing] = useState(false);

  const openDispose = (a: FixedAssetRow) => {
    setDisposeTarget(a);
    setDisposeForm({
      disposal_type: 'retired',
      disposal_date: new Date().toISOString().slice(0, 10),
      disposal_amount: 0,
      cash_account: '普通預金',
      bank_idx: null,
    });
  };

  const confirmDispose = async () => {
    if (!disposeTarget) return;
    setDisposing(true);
    try {
      const bankIdx = disposeForm.bank_idx;
      const bankTx = bankIdx != null ? unmatchedTransactions[bankIdx] : null;
      const res = await fetch(`/api/fixed-assets/${disposeTarget.id}/dispose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          disposal_type: disposeForm.disposal_type,
          disposal_date: disposeForm.disposal_date,
          disposal_amount: disposeForm.disposal_amount,
          cash_account: disposeForm.cash_account,
          bank_ocr_upload_id: bankTx?.ocrUploadId ?? null,
        }),
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error); return; }
      if (bankIdx != null) onConsumeUnmatched(bankIdx);
      setDisposeTarget(null);
      await onRefresh();
    } finally {
      setDisposing(false);
    }
  };
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    category: 'tangible' as 'tangible' | 'intangible' | 'deferred',
    name: '',
    account_name: '',
    acquisition_cost: 0,
  });

  // 当期償却額を資産ごとに集計
  const depByAsset = new Map<string, number>();
  for (const e of entries) {
    if (!e.source_fixed_asset_id) continue;
    depByAsset.set(e.source_fixed_asset_id, (depByAsset.get(e.source_fixed_asset_id) ?? 0) + Number(e.amount ?? 0));
  }

  // period start での簿価計算のため、開始日前の累計
  const startYmd = depPeriodStart ? depPeriodStart.replace(/-/g, '') : '';
  const depBeforeStart = new Map<string, number>();
  if (startYmd) {
    for (const e of entries) {
      if (!e.source_fixed_asset_id) continue;
      if (!e.entry_date || e.entry_date >= startYmd) continue;
      depBeforeStart.set(e.source_fixed_asset_id, (depBeforeStart.get(e.source_fixed_asset_id) ?? 0) + Number(e.amount ?? 0));
    }
  }

  const grouped: Record<string, FixedAssetRow[]> = { tangible: [], intangible: [], deferred: [] };
  for (const a of assets) grouped[a.category]?.push(a);

  const createNew = async () => {
    const res = await fetch('/api/fixed-assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, ...form }),
    });
    const json = await res.json();
    if (!res.ok) { alert(json.error); return; }
    setCreating(false);
    setForm({ category: 'tangible', name: '', account_name: '', acquisition_cost: 0 });
    await onRefresh();
    if (json.asset?.id) window.open(`/fixed-assets/${json.asset.id}`, '_blank');
  };

  const deleteAsset = async (id: string) => {
    if (!confirm('この資産と紐付く償却仕訳を削除しますか？')) return;
    const res = await fetch(`/api/fixed-assets/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (!res.ok) { alert(json.error); return; }
    await onRefresh();
  };

  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 bg-lime-50/40 flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-lime-700 tracking-tight">固定資産</p>
          <p className="text-[10px] text-lime-600/70 mt-0.5">3区分ごとに取得価額・簿価・当期償却を表示</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/excel-export?type=fixed-assets${clientId ? `&clientId=${clientId}` : ''}`}
            className="text-[11px] text-emerald-700 border border-emerald-300 bg-white rounded-lg px-3 py-1.5 hover:bg-emerald-50 font-semibold"
            download
          >
            台帳Excel
          </a>
          <button onClick={() => setCreating(!creating)}
            className="text-[11px] text-lime-700 border border-lime-300 bg-white rounded-lg px-3 py-1.5 hover:bg-lime-50">
            {creating ? '閉じる' : '+ 新規登録（仕訳に出ないもの）'}
          </button>
        </div>
      </div>
      {creating && (
        <div className="px-5 py-4 border-b border-slate-100 bg-lime-50/20 space-y-3">
          <p className="text-[10px] text-lime-700">
            ※ 建物・備品など仕訳計上時に入出金仕訳から自動登録される資産は、仕訳実行後に詳細画面が自動で開きます。この画面は「固定資産 / 未払金」のように現金預金を経由しない取得時に使います。
          </p>
          <div className="grid grid-cols-4 gap-3">
            <select value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as typeof form.category })}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-lime-400">
              <option value="tangible">有形</option>
              <option value="intangible">無形</option>
              <option value="deferred">繰延</option>
            </select>
            <input type="text" placeholder="資産名" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-lime-400" />
            <input type="text" placeholder="勘定科目" value={form.account_name}
              onChange={(e) => setForm({ ...form, account_name: e.target.value })}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-lime-400" />
            <input type="number" placeholder="取得価額" value={form.acquisition_cost}
              onChange={(e) => setForm({ ...form, acquisition_cost: Number(e.target.value) })}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs tabular-nums focus:outline-none focus:border-lime-400" />
          </div>
          {form.category !== 'deferred' && isSmallAssetAmount(Number(form.acquisition_cost)) && (
            <div
              className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-800 leading-relaxed"
              title={SMALL_ASSET_ADVICE_DETAIL}
            >
              {SMALL_ASSET_ADVICE_SHORT}
              <br />
              <span className="text-[10px] text-amber-700/80">
                ※ 資産計上せず「消耗品費」などで全額費用にできます。固定資産として登録するならこのまま進めてください。
              </span>
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={createNew}
              className="text-xs text-white bg-lime-500 rounded-xl px-4 py-2 font-semibold hover:bg-lime-600">
              作成して詳細入力へ
            </button>
          </div>
        </div>
      )}
      {assets.length === 0 ? (
        <div className="p-5 text-xs text-slate-400 text-center">固定資産は未登録です</div>
      ) : (
        <div className="divide-y divide-slate-50">
          {(['tangible', 'intangible', 'deferred'] as const).map((cat) => {
            const list = grouped[cat];
            if (list.length === 0) return null;
            const subtotalCost = list.reduce((s, a) => s + Number(a.acquisition_cost), 0);
            const subtotalDep = list.reduce((s, a) => s + (depByAsset.get(a.id) ?? 0), 0);
            return (
              <div key={cat}>
                <div className="px-5 py-3 bg-slate-50/40 flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-700">{FIXED_ASSET_CATEGORY_LABEL[cat]}</p>
                  <p className="text-[11px] text-slate-500 tabular-nums">
                    取得価額 計 ¥{subtotalCost.toLocaleString()} · 当期償却 計 ¥{subtotalDep.toLocaleString()}
                  </p>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-50">
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">#</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">名称 / 科目</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">取得日</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">取得価額</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">期首簿価</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">当期償却</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">期末簿価</th>
                      <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-300 uppercase tracking-widest">状態</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {list.map((a) => {
                      const cost = Number(a.acquisition_cost);
                      const before = depBeforeStart.get(a.id) ?? 0;
                      const current = depByAsset.get(a.id) ?? 0;
                      const openingBook = cost - before;
                      const closingBook = openingBook - current;
                      return (
                        <tr key={a.id} className="hover:bg-slate-50/40">
                          <td className="px-3 py-2 text-slate-400 font-mono">#{a.asset_number}</td>
                          <td className="px-3 py-2">
                            <Link href={`/fixed-assets/${a.id}`}
                              className="text-slate-700 font-medium hover:text-sky-600">
                              {a.name}
                            </Link>
                            <span className="ml-2 text-slate-400">{a.account_name}</span>
                          </td>
                          <td className="px-3 py-2 font-mono text-slate-500">{a.acquisition_date ?? '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600">¥{cost.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">¥{openingBook.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-sky-600">¥{current.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-700">¥{closingBook.toLocaleString()}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                              a.status === 'active' ? 'bg-lime-50 text-lime-700' :
                              a.status === 'pending' ? 'bg-amber-50 text-amber-700' :
                              'bg-slate-100 text-slate-500'
                            }`}>
                              {a.status === 'active' ? '有効' : a.status === 'pending' ? '未設定' : '除却'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {a.status !== 'disposed' && (
                              <button onClick={() => openDispose(a)} className="text-[10px] text-amber-600 hover:text-amber-700 mr-2">処分</button>
                            )}
                            <button onClick={() => deleteAsset(a.id)} className="text-[10px] text-red-400 hover:text-red-600">削除</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {/* 処分ダイアログ */}
      {disposeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div>
              <p className="text-base font-semibold text-slate-900">固定資産の処分</p>
              <p className="text-xs text-slate-500 mt-0.5">#{disposeTarget.asset_number} {disposeTarget.name}</p>
            </div>
            <div className="flex gap-2">
              {(['retired', 'sold'] as const).map((t) => (
                <button key={t}
                  onClick={() => setDisposeForm({ ...disposeForm, disposal_type: t })}
                  className={`flex-1 text-xs rounded-xl border px-3 py-2 font-medium ${
                    disposeForm.disposal_type === t
                      ? 'bg-sky-50 border-sky-400 text-sky-700'
                      : 'bg-white border-slate-200 text-slate-500'
                  }`}>
                  {t === 'retired' ? '除却（廃棄）' : '売却'}
                </button>
              ))}
            </div>
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase mb-1">処分日</p>
              <input type="date" value={disposeForm.disposal_date}
                onChange={(e) => setDisposeForm({ ...disposeForm, disposal_date: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-sky-400" />
            </div>
            {disposeForm.disposal_type === 'sold' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase mb-1">売却額</p>
                    <input type="number" value={disposeForm.disposal_amount}
                      onChange={(e) => setDisposeForm({ ...disposeForm, disposal_amount: Number(e.target.value) })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs tabular-nums focus:outline-none focus:border-sky-400" />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase mb-1">入金科目</p>
                    <select value={disposeForm.cash_account}
                      onChange={(e) => setDisposeForm({ ...disposeForm, cash_account: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-sky-400">
                      <option value="普通預金">普通預金</option>
                      <option value="現金">現金</option>
                      <option value="未収金">未収金</option>
                    </select>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase mb-1">紐付ける入出金明細（未照合の入金）</p>
                  <select value={disposeForm.bank_idx ?? ''}
                    onChange={(e) => setDisposeForm({ ...disposeForm, bank_idx: e.target.value === '' ? null : Number(e.target.value) })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-sky-400">
                    <option value="">紐付けない</option>
                    {unmatchedTransactions.map((tx, i) => {
                      if (consumedUnmatchedIdx.has(i)) return null;
                      if (!tx.credit || tx.credit <= 0) return null; // 入金のみ
                      return (
                        <option key={i} value={i}>
                          {tx.transactionDate} · ¥{tx.credit.toLocaleString()} · {tx.description.slice(0, 20)}
                        </option>
                      );
                    })}
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1">
                    選択すると未照合リストから除外され、生成される仕訳に銀行明細が紐付きます
                  </p>
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setDisposeTarget(null)}
                className="text-xs text-slate-500 border border-slate-200 rounded-xl px-4 py-2 hover:bg-slate-50">
                キャンセル
              </button>
              <button type="button" onClick={confirmDispose} disabled={disposing}
                className="text-xs text-white bg-amber-500 rounded-xl px-5 py-2 font-semibold hover:bg-amber-600 disabled:opacity-50">
                {disposing ? '処理中...' : '処分仕訳を生成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 勘定科目コンボボックス（補完つきインライン入力） ────────────────────────

interface AccountOption { id?: string; name: string; reading?: string; category?: string; sub_category?: string | null; display_order?: number | null; client_id?: string | null; auto_registered?: boolean; confirmed?: boolean; parent_account_id?: string | null }

function AccountCombobox({
  value,
  onChange,
  onCommit,
  accounts,
  onCreate,
  placeholder,
  dense,
}: {
  value: string;
  onChange: (next: string) => void;
  onCommit?: (next: string) => void;
  accounts: AccountOption[];
  onCreate?: (name: string, reading?: string, sub_category?: string) => Promise<AccountOption | null> | void;
  placeholder?: string;
  dense?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // 新規作成モード: 名前と読みの2段階入力
  const [creating, setCreating] = useState<{ name: string; reading: string; sub_category: string } | null>(null);
  const readingInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 外側クリック検知（blur ではなく mousedown でドラッグ選択でも閉じない）
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        if (creating) setCreating(null);
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, creating]);

  // 補完候補（前方一致）— name または reading が入力で始まるもの
  // マスタに同名（読み違いの重複等）が混入していてもドロップダウンでは name 単位で1件に集約する
  const q = value.trim().toLowerCase();
  const filtered = q
    ? accounts.filter((a) =>
        a.name.toLowerCase().startsWith(q) ||
        (a.reading || '').toLowerCase().startsWith(q)
      )
    : accounts;
  const dedupMap = new Map<string, AccountOption>();
  for (const a of filtered) {
    if (!dedupMap.has(a.name)) dedupMap.set(a.name, a);
  }
  const candidates = Array.from(dedupMap.values()).slice(0, 12);

  // 完全一致がない場合は「+ 新規追加」を表示
  const exact = accounts.some((a) => a.name === value.trim());
  const showCreate = !!value.trim() && !exact && !!onCreate;

  const startCreate = () => {
    setCreating({ name: value.trim(), reading: '', sub_category: '' });
    setTimeout(() => readingInputRef.current?.focus(), 0);
  };

  const confirmCreate = async () => {
    if (!creating || !onCreate) return;
    if (!creating.name.trim() || !creating.sub_category) return;
    const acc = await Promise.resolve(onCreate(creating.name, creating.reading, creating.sub_category));
    if (acc) {
      onChange(acc.name);
      onCommit?.(acc.name);
    }
    setCreating(null);
    setOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (creating) return;
          if (!open && (e.key === 'Enter' || e.key === 'ArrowDown')) {
            setOpen(true);
            return;
          }
          if (!open) return;
          const total = candidates.length + (showCreate ? 1 : 0);
          if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => (h + 1) % Math.max(total, 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => (h - 1 + total) % Math.max(total, 1)); }
          else if (e.key === 'Enter') {
            // 既存科目に完全一致する場合はそのまま確定
            if (exact) {
              e.preventDefault();
              onCommit?.(value);
              setOpen(false);
              return;
            }
            // ハイライトされている候補を選択
            if (candidates.length > 0 && highlight < candidates.length) {
              e.preventDefault();
              const picked = candidates[highlight].name;
              onChange(picked);
              onCommit?.(picked);
              setOpen(false);
            } else if (showCreate) {
              // 候補なしまたは「+ 新規追加」がハイライトされている場合は即作成モードへ
              e.preventDefault();
              startCreate();
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
          } else if (e.key === 'Tab') {
            // Tab で確定
            if (value.trim() && exact) onCommit?.(value);
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className={`w-full border ${dense ? 'border-transparent hover:border-slate-200' : 'border-slate-200'} rounded${dense ? '' : '-xl'} ${dense ? 'px-1.5 py-1 text-xs' : 'px-3 py-2 text-sm'} focus:outline-none focus:border-sky-400 bg-transparent`}
      />
      {open && !creating && (candidates.length > 0 || showCreate) && (
        <div className="absolute z-30 mt-1 w-[220px] max-w-[260px] bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
          {candidates.map((a, i) => (
            <button
              key={a.name}
              type="button"
              onClick={() => {
                onChange(a.name);
                onCommit?.(a.name);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between ${
                i === highlight ? 'bg-sky-50' : 'hover:bg-slate-50'
              }`}
            >
              <span className="text-slate-700">{a.name}</span>
              {a.reading && <span className="text-[10px] text-slate-400 font-mono ml-2">{a.reading}</span>}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              onClick={startCreate}
              className={`w-full text-left px-3 py-2 text-xs border-t border-slate-100 ${
                highlight === candidates.length ? 'bg-lime-50' : 'hover:bg-lime-50'
              } text-lime-700 font-medium`}
            >
              + 新規追加: {value.trim()}
            </button>
          )}
        </div>
      )}
      {open && creating && (
        <div className="absolute z-30 mt-1 w-[280px] bg-white border border-slate-200 rounded-xl shadow-lg p-3 space-y-2">
          <p className="text-[11px] text-lime-700 font-semibold">新しい科目を追加</p>
          <div className="grid grid-cols-[1fr_1.2fr] gap-2">
            <div>
              <span className="text-[10px] text-slate-400">科目名</span>
              <input
                value={creating.name}
                onChange={(e) => setCreating({ ...creating, name: e.target.value })}
                className="mt-0.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <span className="text-[10px] text-slate-400">読み（ローマ字 例: gyoumuitakuhi）</span>
              <input
                ref={readingInputRef}
                value={creating.reading}
                onChange={(e) => setCreating({ ...creating, reading: e.target.value.toLowerCase() })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); confirmCreate(); }
                  else if (e.key === 'Escape') { e.preventDefault(); setCreating(null); }
                }}
                placeholder="補完用（任意）"
                className="mt-0.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-sky-400"
              />
            </div>
          </div>
          <div>
            <span className="text-[10px] text-slate-400">
              区分 <span className="text-red-500">*必須</span>
            </span>
            <select
              value={creating.sub_category}
              onChange={(e) => setCreating({ ...creating, sub_category: e.target.value })}
              className="mt-0.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-sky-400 bg-white text-slate-600"
            >
              <option value="">区分を選択してください</option>
              {SUB_CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => setCreating(null)}
              className="text-[10px] text-slate-500 border border-slate-200 rounded-md px-2 py-1 hover:bg-slate-50"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={confirmCreate}
              disabled={!creating.name.trim() || !creating.sub_category}
              className="text-[10px] text-white bg-lime-500 rounded-md px-3 py-1 font-semibold hover:bg-lime-600 disabled:opacity-50"
            >
              追加
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── マスタ管理ビュー（勘定科目・取引先の編集） ─────────────────────────────

interface RuleItem { id: string; pattern_type: 'vendor' | 'description'; pattern: string; debit_account: string; created_at?: string }

function MasterView({
  accountsList,
  vendorsList,
  clients,
  onReloadAccounts,
  onReloadVendors,
  onCreateAccount,
  onCreateVendor,
  rulesList,
  onCreateRule,
  onDeleteRule,
}: {
  accountsList: AccountOption[];
  vendorsList: AccountOption[];
  clients: ClientItem[];
  onReloadAccounts: () => void;
  onReloadVendors: () => void;
  onCreateAccount: (name: string, reading?: string, sub_category?: string) => Promise<AccountOption | null>;
  onCreateVendor: (name: string, reading?: string) => Promise<AccountOption | null>;
  rulesList: RuleItem[];
  onCreateRule: (pattern_type: 'vendor' | 'description', pattern: string, debit_account: string) => Promise<unknown>;
  onDeleteRule: (id: string) => Promise<void>;
}) {
  // 会社絞り込み: '' = 全件、'null' = 未割当のみ、uuid = その会社
  const [scopeClientId, setScopeClientId] = useState<string>('');
  // 一括割当先（未割当を一括でこの会社へ移すための選択）
  const [bulkTargetClientId, setBulkTargetClientId] = useState<string>('');

  const accUnassignedCount = useMemo(() =>
    accountsList.filter((a) => !a.client_id).length, [accountsList]);
  const venUnassignedCount = useMemo(() =>
    vendorsList.filter((v) => !v.client_id).length, [vendorsList]);

  const bulkAssignAccounts = async () => {
    if (!bulkTargetClientId) return alert('割当先の会社を選択してください');
    const target = accountsList.filter((a) => !a.client_id && a.id);
    if (target.length === 0) return alert('未割当の勘定科目はありません');
    if (!confirm(`未割当の勘定科目 ${target.length} 件をこの会社へ割り当てます。よろしいですか？`)) return;
    await Promise.all(target.map((a) =>
      fetch(`/api/accounts/${a.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: bulkTargetClientId }),
      }),
    ));
    onReloadAccounts();
  };

  const bulkAssignVendors = async () => {
    if (!bulkTargetClientId) return alert('割当先の会社を選択してください');
    const target = vendorsList.filter((v) => !v.client_id && v.id);
    if (target.length === 0) return alert('未割当の取引先はありません');
    if (!confirm(`未割当の取引先 ${target.length} 件をこの会社へ割り当てます。よろしいですか？`)) return;
    await Promise.all(target.map((v) =>
      fetch(`/api/vendors/${v.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: bulkTargetClientId, previousName: v.name }),
      }),
    ));
    onReloadVendors();
  };

  // ── あいまい重複候補の検出（同一会社スコープ内で Levenshtein ≤2） ──
  const accSimilarPairs: SimilarPair<AccountOption>[] = useMemo(
    () => findSimilarPairs(
      accountsList,
      (a) => a.name,
      { maxDistance: 2, minLen: 3, scopeKey: (a) => a.client_id ?? '', maxResults: 30 },
    ),
    [accountsList],
  );
  const venSimilarPairs: SimilarPair<AccountOption>[] = useMemo(
    () => findSimilarPairs(
      vendorsList,
      (v) => v.name,
      { maxDistance: 2, minLen: 3, scopeKey: (v) => v.client_id ?? '', maxResults: 30 },
    ),
    [vendorsList],
  );

  const mergeAccount = async (keepId: string, mergeId: string) => {
    if (!confirm('この2件をマージします。マージ元の科目は削除され、仕訳の科目名はマージ先に統一されます。よろしいですか？')) return;
    const res = await fetch('/api/accounts/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepId, mergeId }),
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || 'マージに失敗しました');
      return;
    }
    onReloadAccounts();
  };

  const mergeVendor = async (keepId: string, mergeId: string) => {
    if (!confirm('この2件をマージします。マージ元の取引先は削除され、仕訳の取引先名はマージ先に統一されます。よろしいですか？')) return;
    const res = await fetch('/api/vendors/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepId, mergeId }),
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || 'マージに失敗しました');
      return;
    }
    onReloadVendors();
  };
  const [newRule, setNewRule] = useState<{ pattern_type: 'vendor' | 'description'; pattern: string; debit_account: string }>({
    pattern_type: 'vendor', pattern: '', debit_account: '',
  });
  const handleAddRule = async () => {
    if (!newRule.pattern.trim() || !newRule.debit_account.trim()) return;
    await onCreateRule(newRule.pattern_type, newRule.pattern, newRule.debit_account);
    setNewRule({ pattern_type: newRule.pattern_type, pattern: '', debit_account: '' });
  };
  const [newAcc, setNewAcc] = useState({ name: '', reading: '', sub_category: '' });
  const [newVen, setNewVen] = useState({ name: '', reading: '' });
  const [accSearch, setAccSearch] = useState('');
  const [venSearch, setVenSearch] = useState('');
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);
  const [subAccName, setSubAccName] = useState('');

  const sortedAccounts = useMemo(() => {
    const order = new Map(SUB_CATEGORY_OPTIONS.map((o, i) => [o.value, i]));
    return [...accountsList].sort((a, b) => {
      const oa = order.get(a.sub_category ?? '') ?? 999;
      const ob = order.get(b.sub_category ?? '') ?? 999;
      if (oa !== ob) return oa - ob;
      return (a.reading || a.name).localeCompare(b.reading || b.name, 'ja');
    });
  }, [accountsList]);

  const accDupNames = useMemo(() => {
    const count = new Map<string, number>();
    for (const a of accountsList) {
      const k = a.name.trim().toLowerCase();
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    return new Set([...count.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [accountsList]);

  const venDupNames = useMemo(() => {
    const count = new Map<string, number>();
    for (const v of vendorsList) {
      const k = v.name.trim().toLowerCase();
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    return new Set([...count.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [vendorsList]);

  const filteredAccounts = useMemo(() => {
    const q = accSearch.trim().toLowerCase();
    const inScope = (a: AccountOption): boolean => {
      if (scopeClientId === '') return true;
      if (scopeClientId === 'null') return !a.client_id;
      return a.client_id === scopeClientId;
    };
    return sortedAccounts.filter((a) => {
      if (!inScope(a)) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        (a.reading ?? '').toLowerCase().includes(q) ||
        (a.sub_category ?? '').toLowerCase().includes(q)
      );
    });
  }, [sortedAccounts, accSearch, scopeClientId]);

  const filteredVendors = useMemo(() => {
    const q = venSearch.trim().toLowerCase();
    const inScope = (v: AccountOption): boolean => {
      if (scopeClientId === '') return true;
      if (scopeClientId === 'null') return !v.client_id;
      return v.client_id === scopeClientId;
    };
    return vendorsList.filter((v) => {
      if (!inScope(v)) return false;
      if (!q) return true;
      return (
        v.name.toLowerCase().includes(q) ||
        (v.reading ?? '').toLowerCase().includes(q)
      );
    });
  }, [vendorsList, venSearch, scopeClientId]);

  // 補助科目を含む階層リスト（親 → 子の順に並べる）
  const hierarchicalAccounts = useMemo(() => {
    const idMap = new Map(accountsList.map((a) => [a.id, a]));
    const result: { account: AccountOption; isChild: boolean; parentName?: string }[] = [];
    // filtered から親だけを抽出し、その直後に子を追加
    const filteredIds = new Set(filteredAccounts.map((a) => a.id));
    const handled = new Set<string | undefined>();
    for (const a of filteredAccounts) {
      if (a.parent_account_id) continue; // 子は後で処理
      handled.add(a.id);
      result.push({ account: a, isChild: false });
      // この親の子を追加
      for (const child of filteredAccounts) {
        if (child.parent_account_id === a.id) {
          handled.add(child.id);
          result.push({ account: child, isChild: true, parentName: a.name });
        }
      }
    }
    // 親がフィルター外でも子だけ表示されるケースを処理
    for (const a of filteredAccounts) {
      if (handled.has(a.id)) continue;
      if (a.parent_account_id && !filteredIds.has(a.parent_account_id)) {
        const parent = idMap.get(a.parent_account_id);
        result.push({ account: a, isChild: true, parentName: parent?.name });
      }
    }
    return result;
  }, [filteredAccounts, accountsList]);

  const patchAccount = async (id: string, patch: Partial<AccountOption>) => {
    const res = await fetch(`/api/accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || '更新失敗');
      return;
    }
    onReloadAccounts();
  };

  const deleteAccount = async (id: string) => {
    if (!confirm('この勘定科目を削除しますか？')) return;
    const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || '削除失敗');
      return;
    }
    onReloadAccounts();
  };

  const handleAddSubAccount = async (parentId: string) => {
    if (!subAccName.trim()) return;
    const parent = accountsList.find((a) => a.id === parentId);
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: subAccName.trim(),
        parent_account_id: parentId,
        sub_category: parent?.sub_category ?? '',
        category: parent?.category ?? '',
        client_id: parent?.client_id ?? null,
      }),
    });
    if (!res.ok) { const j = await res.json(); alert(j.error || '追加失敗'); return; }
    setSubAccName('');
    setAddingSubFor(null);
    onReloadAccounts();
  };

  const patchVendor = async (id: string, patch: Partial<AccountOption>, previousName: string) => {
    const res = await fetch(`/api/vendors/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, previousName }),
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || '更新失敗');
      return;
    }
    onReloadVendors();
  };

  const deleteVendor = async (id: string) => {
    if (!confirm('この取引先を削除しますか？（既存の仕訳は残ります）')) return;
    const res = await fetch(`/api/vendors/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || '削除失敗');
      return;
    }
    onReloadVendors();
  };

  const handleAddAcc = async () => {
    if (!newAcc.name.trim() || !newAcc.sub_category) return;
    const acc = await onCreateAccount(newAcc.name, newAcc.reading, newAcc.sub_category);
    if (acc) {
      // addAccountLocal は既存同名なら sub_category を更新しないので、確実に PATCH で揃える
      if (acc.id) {
        const cat = SUB_CATEGORY_OPTIONS.find((o) => o.value === newAcc.sub_category)?.category ?? '';
        await fetch(`/api/accounts/${acc.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sub_category: newAcc.sub_category, category: cat }),
        });
        onReloadAccounts();
      }
      setNewAcc({ name: '', reading: '', sub_category: '' });
    }
  };
  const handleAddVen = async () => {
    if (!newVen.name.trim()) return;
    const v = await onCreateVendor(newVen.name, newVen.reading);
    if (v) setNewVen({ name: '', reading: '' });
  };

  return (
    <div className="space-y-5">
    {/* 会社フィルタ + 未割当の一括割当 UI */}
    <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-4 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500 font-semibold">会社で絞り込む:</span>
        <select
          value={scopeClientId}
          onChange={(e) => setScopeClientId(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-sky-400"
        >
          <option value="">全件表示</option>
          <option value="null">未割当のみ</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{clientDisplayLabel(c)}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2 ml-auto">
        <span className="text-xs text-slate-500">
          未割当: 勘定科目 {accUnassignedCount} 件 / 取引先 {venUnassignedCount} 件
        </span>
        <select
          value={bulkTargetClientId}
          onChange={(e) => setBulkTargetClientId(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-sky-400"
        >
          <option value="">割当先を選択</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{clientDisplayLabel(c)}</option>
          ))}
        </select>
        <button
          onClick={bulkAssignAccounts}
          disabled={!bulkTargetClientId || accUnassignedCount === 0}
          className="text-[10px] text-white bg-sky-500 rounded-lg px-2.5 py-1.5 font-semibold hover:bg-sky-600 disabled:opacity-40"
          title="未割当の勘定科目を一括で選択中の会社へ割り当て"
        >
          科目を一括割当
        </button>
        <button
          onClick={bulkAssignVendors}
          disabled={!bulkTargetClientId || venUnassignedCount === 0}
          className="text-[10px] text-white bg-lime-500 rounded-lg px-2.5 py-1.5 font-semibold hover:bg-lime-600 disabled:opacity-40"
          title="未割当の取引先を一括で選択中の会社へ割り当て"
        >
          取引先を一括割当
        </button>
      </div>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* 勘定科目マスタ */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-sky-50/40">
          <p className="text-sm font-semibold text-sky-700 tracking-tight">勘定科目マスタ</p>
          <p className="text-[10px] text-sky-500/70 mt-0.5">
            {accountsList.length} 件
            {accDupNames.size > 0 && (
              <span className="ml-2 text-red-500 font-semibold">· 重複 {accDupNames.size} 件</span>
            )}
          </p>
        </div>
        <div className="p-4 border-b border-slate-50 space-y-2">
          <input
            value={accSearch}
            onChange={(e) => setAccSearch(e.target.value)}
            placeholder="科目名・読み・区分で検索…"
            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400"
          />
          <div className="flex gap-2">
            <input
              value={newAcc.name}
              onChange={(e) => setNewAcc({ ...newAcc, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddAcc(); }}
              placeholder="科目名"
              className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400"
            />
            <input
              value={newAcc.reading}
              onChange={(e) => setNewAcc({ ...newAcc, reading: e.target.value.toLowerCase() })}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddAcc(); }}
              placeholder="読み（ローマ字）"
              className="flex-1 text-xs font-mono border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={newAcc.sub_category}
              onChange={(e) => setNewAcc({ ...newAcc, sub_category: e.target.value })}
              className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400 bg-white text-slate-600"
            >
              <option value="">中区分を選択（必須）</option>
              {SUB_CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={handleAddAcc}
              disabled={!newAcc.name.trim() || !newAcc.sub_category}
              className="text-xs text-white bg-sky-500 rounded-lg px-3 font-semibold hover:bg-sky-600 disabled:opacity-40"
            >
              追加
            </button>
          </div>
        </div>
        <div className="max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-50">
              {hierarchicalAccounts.map(({ account: a, isChild, parentName }) => (
                <>
                  <MasterRow
                    key={a.id}
                    item={a}
                    onSave={(patch) => patchAccount(a.id!, patch)}
                    onDelete={() => deleteAccount(a.id!)}
                    onAddSub={!isChild ? () => { setAddingSubFor(a.id!); setSubAccName(''); } : undefined}
                    showSubCategory
                    duplicate={accDupNames.has(a.name.trim().toLowerCase())}
                    clients={clients}
                    isSubAccount={isChild}
                    parentName={parentName}
                  />
                  {addingSubFor === a.id && (
                    <tr key={`sub-form-${a.id}`} className="bg-violet-50/40">
                      <td colSpan={5} className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-violet-500 shrink-0">└ 補助科目</span>
                          <input
                            autoFocus
                            value={subAccName}
                            onChange={(e) => setSubAccName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleAddSubAccount(a.id!); if (e.key === 'Escape') setAddingSubFor(null); }}
                            placeholder={`${a.name} の補助科目名`}
                            className="flex-1 text-xs border border-violet-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-500"
                          />
                          <button onClick={() => handleAddSubAccount(a.id!)} className="text-[10px] px-3 py-1.5 bg-violet-500 text-white rounded-lg hover:bg-violet-600 font-semibold">追加</button>
                          <button onClick={() => setAddingSubFor(null)} className="text-[10px] px-2 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50">×</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {hierarchicalAccounts.length === 0 && (
                <tr><td className="px-4 py-6 text-center text-xs text-slate-400">
                  {accSearch ? '該当する科目がありません' : '勘定科目がありません'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 取引先マスタ */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-lime-50/40">
          <p className="text-sm font-semibold text-lime-700 tracking-tight">取引先マスタ</p>
          <p className="text-[10px] text-lime-600/70 mt-0.5">
            {vendorsList.length} 件 · 株式会社/㈱/空白は自動で同一視
            {venDupNames.size > 0 && (
              <span className="ml-2 text-red-500 font-semibold">· 重複 {venDupNames.size} 件</span>
            )}
          </p>
        </div>
        <div className="p-4 border-b border-slate-50 space-y-2">
          <input
            value={venSearch}
            onChange={(e) => setVenSearch(e.target.value)}
            placeholder="取引先名・読みで検索…"
            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-lime-400"
          />
          <div className="flex gap-2">
          <input
            value={newVen.name}
            onChange={(e) => setNewVen({ ...newVen, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddVen(); }}
            placeholder="取引先名"
            className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400"
          />
          <input
            value={newVen.reading}
            onChange={(e) => setNewVen({ ...newVen, reading: e.target.value.toLowerCase() })}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddVen(); }}
            placeholder="読み（ローマ字）"
            className="flex-1 text-xs font-mono border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400"
          />
          <button
            onClick={handleAddVen}
            disabled={!newVen.name.trim()}
            className="text-xs text-white bg-lime-500 rounded-lg px-3 font-semibold hover:bg-lime-600 disabled:opacity-40"
          >
            追加
          </button>
          </div>
        </div>
        <div className="max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-50">
              {filteredVendors.map((v) => (
                <MasterRow
                  key={v.id}
                  item={v}
                  onSave={(patch) => patchVendor(v.id!, patch, v.name)}
                  onDelete={() => deleteVendor(v.id!)}
                  duplicate={venDupNames.has(v.name.trim().toLowerCase())}
                  clients={clients}
                />
              ))}
              {filteredVendors.length === 0 && (
                <tr><td className="px-4 py-6 text-center text-xs text-slate-400">
                  {venSearch ? '該当する取引先がありません' : '取引先がありません'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    {/* あいまい重複候補（類似度マッチ） */}
    {(accSimilarPairs.length > 0 || venSimilarPairs.length > 0) && (
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-rose-50/40">
          <p className="text-sm font-semibold text-rose-700 tracking-tight">あいまい重複候補</p>
          <p className="text-[10px] text-rose-500/70 mt-0.5">
            同一会社内で名前が似ているレコードを検出しました。マージするとマージ元は削除され、仕訳の科目名/取引先名が統一されます。
          </p>
        </div>
        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 勘定科目の候補 */}
          <div>
            <p className="text-[11px] font-semibold text-sky-700 mb-2">勘定科目（{accSimilarPairs.length} 件）</p>
            <div className="space-y-1.5">
              {accSimilarPairs.length === 0 && (
                <p className="text-[10px] text-slate-400">候補はありません</p>
              )}
              {accSimilarPairs.map((p, i) => (
                <div key={`acc_${i}`} className="text-[11px] flex items-center gap-2 border border-slate-100 rounded-lg px-2 py-1.5">
                  <span className="text-slate-700 truncate flex-1" title={p.a.name}>{p.a.name}</span>
                  <span className="text-slate-400">↔</span>
                  <span className="text-slate-700 truncate flex-1" title={p.b.name}>{p.b.name}</span>
                  <span className="text-[9px] text-slate-400 shrink-0">距離 {p.distance}</span>
                  <button
                    onClick={() => p.a.id && p.b.id && mergeAccount(p.a.id, p.b.id)}
                    className="text-[10px] text-sky-600 border border-sky-200 rounded px-1.5 py-0.5 hover:bg-sky-50 shrink-0"
                    title={`「${p.a.name}」を残し、「${p.b.name}」を削除`}
                  >
                    左に統合
                  </button>
                  <button
                    onClick={() => p.a.id && p.b.id && mergeAccount(p.b.id, p.a.id)}
                    className="text-[10px] text-sky-600 border border-sky-200 rounded px-1.5 py-0.5 hover:bg-sky-50 shrink-0"
                    title={`「${p.b.name}」を残し、「${p.a.name}」を削除`}
                  >
                    右に統合
                  </button>
                </div>
              ))}
            </div>
          </div>
          {/* 取引先の候補 */}
          <div>
            <p className="text-[11px] font-semibold text-lime-700 mb-2">取引先（{venSimilarPairs.length} 件）</p>
            <div className="space-y-1.5">
              {venSimilarPairs.length === 0 && (
                <p className="text-[10px] text-slate-400">候補はありません</p>
              )}
              {venSimilarPairs.map((p, i) => (
                <div key={`ven_${i}`} className="text-[11px] flex items-center gap-2 border border-slate-100 rounded-lg px-2 py-1.5">
                  <span className="text-slate-700 truncate flex-1" title={p.a.name}>{p.a.name}</span>
                  <span className="text-slate-400">↔</span>
                  <span className="text-slate-700 truncate flex-1" title={p.b.name}>{p.b.name}</span>
                  <span className="text-[9px] text-slate-400 shrink-0">距離 {p.distance}</span>
                  <button
                    onClick={() => p.a.id && p.b.id && mergeVendor(p.a.id, p.b.id)}
                    className="text-[10px] text-lime-700 border border-lime-200 rounded px-1.5 py-0.5 hover:bg-lime-50 shrink-0"
                  >
                    左に統合
                  </button>
                  <button
                    onClick={() => p.a.id && p.b.id && mergeVendor(p.b.id, p.a.id)}
                    className="text-[10px] text-lime-700 border border-lime-200 rounded px-1.5 py-0.5 hover:bg-lime-50 shrink-0"
                  >
                    右に統合
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )}

    {/* 勘定科目ルール（相手先→科目 / 摘要→科目） */}
    <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 bg-amber-50/40 flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-amber-700 tracking-tight">勘定科目ルール</p>
          <p className="text-[10px] text-amber-500/70 mt-0.5">
            {rulesList.length} 件 · 仕訳照合時に自動で借方科目を上書きします
          </p>
        </div>
      </div>
      <div className="p-4 border-b border-slate-50 grid grid-cols-1 md:grid-cols-[120px_1fr_1fr_auto] gap-2 items-center">
        <select
          value={newRule.pattern_type}
          onChange={(e) => setNewRule({ ...newRule, pattern_type: e.target.value as 'vendor' | 'description' })}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-sky-400"
        >
          <option value="vendor">相手先</option>
          <option value="description">摘要</option>
        </select>
        <input
          value={newRule.pattern}
          onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAddRule(); }}
          placeholder={newRule.pattern_type === 'vendor' ? '例: アルソック' : '例: フリコミテスウリョウ'}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400"
        />
        <input
          value={newRule.debit_account}
          onChange={(e) => setNewRule({ ...newRule, debit_account: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAddRule(); }}
          placeholder="借方科目（例: 支払手数料）"
          list="rule-accounts"
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400"
        />
        <datalist id="rule-accounts">
          {accountsList.map((a) => <option key={a.id ?? a.name} value={a.name} />)}
        </datalist>
        <button
          onClick={handleAddRule}
          disabled={!newRule.pattern.trim() || !newRule.debit_account.trim()}
          className="text-xs text-white bg-amber-500 rounded-lg px-3 py-1.5 font-semibold hover:bg-amber-600 disabled:opacity-40"
        >
          追加
        </button>
      </div>
      <div className="max-h-[400px] overflow-y-auto">
        {rulesList.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-slate-400">ルールはまだありません</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest w-[80px]">種別</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">パターン（正規化後）</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">借方科目</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest w-[80px]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rulesList.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/30">
                  <td className="px-3 py-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      r.pattern_type === 'vendor' ? 'bg-sky-100 text-sky-600' : 'bg-lime-100 text-lime-700'
                    }`}>
                      {r.pattern_type === 'vendor' ? '相手先' : '摘要'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs font-mono text-slate-600 truncate">{r.pattern}</td>
                  <td className="px-3 py-2 text-xs text-slate-700">{r.debit_account}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => {
                        if (confirm('このルールを削除しますか？')) onDeleteRule(r.id);
                      }}
                      className="text-[10px] text-red-500 border border-red-200 rounded-md px-2 py-1 hover:bg-red-50"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
    </div>
  );
}

const SUB_CATEGORY_OPTIONS: { value: string; label: string; category: string }[] = [
  { value: '流動資産', label: '流動資産', category: 'asset' },
  { value: '固定資産', label: '固定資産', category: 'asset' },
  { value: '繰延資産', label: '繰延資産', category: 'asset' },
  { value: '流動負債', label: '流動負債', category: 'liability' },
  { value: '固定負債', label: '固定負債', category: 'liability' },
  { value: '純資産', label: '純資産', category: 'equity' },
  { value: '売上高', label: '売上高', category: 'revenue' },
  { value: '売上原価', label: '売上原価', category: 'expense' },
  { value: '販管費', label: '販管費', category: 'expense' },
  { value: '営業外収益', label: '営業外収益', category: 'revenue' },
  { value: '営業外費用', label: '営業外費用', category: 'expense' },
  { value: '特別利益', label: '特別利益', category: 'revenue' },
  { value: '特別損失', label: '特別損失', category: 'expense' },
];

function MasterRow({
  item,
  onSave,
  onDelete,
  onAddSub,
  showSubCategory = false,
  duplicate = false,
  clients = [],
  isSubAccount = false,
  parentName,
}: {
  item: AccountOption;
  onSave: (patch: Partial<AccountOption>) => void;
  onDelete: () => void;
  onAddSub?: () => void;
  showSubCategory?: boolean;
  duplicate?: boolean;
  clients?: ClientItem[];
  isSubAccount?: boolean;
  parentName?: string;
}) {
  const [name, setName] = useState(item.name);
  const [reading, setReading] = useState(item.reading ?? '');
  const [subCategory, setSubCategory] = useState<string>(item.sub_category ?? '');
  useEffect(() => {
    setSubCategory(item.sub_category ?? '');
  }, [item.sub_category]);

  // 未確認: 自動登録された + 未確認の科目を強調
  const isUnconfirmed = item.auto_registered === true && item.confirmed === false;
  // 未割当: 会社が設定されていない（freee 自動登録時に Importer から渡されなかったケースなど）
  const isUnassigned = !item.client_id;

  const handleConfirm = () => {
    onSave({ confirmed: true });
  };

  return (
    <tr className={`hover:bg-slate-50/30 ${duplicate ? 'bg-red-50/40' : ''} ${isUnconfirmed ? 'bg-amber-50/40' : ''} ${isSubAccount ? 'bg-violet-50/20' : ''}`}>
      <td className="px-4 py-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {isSubAccount && <span className="text-[10px] text-violet-400 shrink-0 select-none">└</span>}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { if (name !== item.name) onSave({ name }); }}
            className="flex-1 min-w-[80px] text-xs border border-transparent hover:border-slate-200 focus:border-sky-400 rounded px-1.5 py-1 focus:outline-none bg-transparent"
          />
          {isSubAccount && parentName && (
            <span className="text-[9px] text-violet-500 bg-violet-50 border border-violet-200 rounded px-1 py-0.5 shrink-0">補助: {parentName}</span>
          )}
          {duplicate && (
            <span className="text-[9px] text-red-600 bg-red-100 rounded px-1 py-0.5 font-semibold shrink-0">重複</span>
          )}
          {isUnconfirmed && (
            <span className="text-[9px] text-amber-700 bg-amber-100 rounded px-1 py-0.5 font-semibold shrink-0" title="インポート時に自動登録されました。区分が正しいか確認してください">
              未確認
            </span>
          )}
          {isUnassigned && clients.length > 0 && (
            <span className="text-[9px] text-slate-600 bg-slate-100 rounded px-1 py-0.5 font-semibold shrink-0" title="会社が割り当てられていません">
              未割当
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-2" style={{ width: showSubCategory ? '22%' : '32%' }}>
        <input
          value={reading}
          onChange={(e) => setReading(e.target.value.toLowerCase())}
          onBlur={() => { if (reading !== (item.reading ?? '')) onSave({ reading }); }}
          placeholder="ローマ字"
          className="w-full text-[11px] font-mono border border-transparent hover:border-slate-200 focus:border-sky-400 rounded px-1.5 py-1 focus:outline-none bg-transparent text-slate-500"
        />
      </td>
      {showSubCategory && (
        <td className="px-2 py-2" style={{ width: '125px' }}>
          <select
            value={subCategory}
            onChange={(e) => {
              const sub = e.target.value;
              setSubCategory(sub);
              const cat = SUB_CATEGORY_OPTIONS.find((o) => o.value === sub)?.category ?? item.category;
              onSave({ sub_category: sub, category: cat });
            }}
            className="w-full text-[11px] border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:border-sky-400 bg-white text-slate-600"
          >
            <option value="">（未設定）</option>
            {SUB_CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </td>
      )}
      {clients.length > 0 && (
        <td className="px-2 py-2" style={{ width: '130px' }}>
          <select
            value={item.client_id ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              onSave({ client_id: v || null });
            }}
            className="w-full text-[11px] border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:border-sky-400 bg-white text-slate-600"
            title="この科目を所属させる会社"
          >
            <option value="">（未割当）</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{clientDisplayLabel(c)}</option>
            ))}
          </select>
        </td>
      )}
      <td className="px-2 py-2 text-right" style={{ width: '140px' }}>
        <div className="flex items-center justify-end gap-1">
          {isUnconfirmed && (
            <button
              onClick={handleConfirm}
              className="text-[10px] text-amber-700 border border-amber-300 rounded-md px-2 py-1 hover:bg-amber-50"
              title="区分を確認した（このバッジを消します）"
            >
              確認
            </button>
          )}
          {!isSubAccount && onAddSub && (
            <button
              onClick={onAddSub}
              className="text-[10px] text-violet-600 border border-violet-200 rounded-md px-2 py-1 hover:bg-violet-50"
              title="この科目の補助科目を追加"
            >
              補助+
            </button>
          )}
          <button
            onClick={onDelete}
            className="text-[10px] text-red-500 border border-red-200 rounded-md px-2 py-1 hover:bg-red-50"
          >
            削除
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── 決算書ビュー ───────────────────────────────────────────────────────────

interface FiscalPeriod {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  client_id: string | null;
  opening_balances: Record<string, number> | null;
  corporate_tax: number | null;
  created_at: string;
}

interface FsBreakdown { name: string; amount: number }
interface FsGroup { sub_category: string; total: number; items: FsBreakdown[] }
interface FsEquityRow { name: string; opening: number; change: number; ending: number; isCarryForward: boolean }
interface FsClient { name: string; legal_name: string | null; short_name: string | null; company_code: string | null }
interface FsResult {
  period: { start: string; end: string };
  client: FsClient | null;
  useOpeningBalances: boolean;
  pl: {
    groups: FsGroup[];
    salesTotal: number;
    cogsTotal: number;
    grossProfit: number;
    sgaTotal: number;
    operatingProfit: number;
    nonOpIncome: number;
    nonOpExpense: number;
    ordinaryProfit: number;
    extraIncome: number;
    extraLoss: number;
    netIncomeBeforeTax: number;
    corporateTax: number;
    netIncome: number;
  };
  bs: {
    groups: FsGroup[];
    assetsTotal: number;
    liabilitiesTotal: number;
    equityTotal: number;
    liabilitiesAndEquityTotal: number;
  };
  equity: {
    rows: FsEquityRow[];
    openingTotal: number;
    changeTotal: number;
    endingTotal: number;
  };
  unclassified: FsBreakdown[];
  invalidOpeningBalances: FsBreakdown[];
}

interface CfItem { label: string; amount: number }
interface CfSection { items: CfItem[]; subtotal: number }
interface CfResult {
  period: { start: string; end: string };
  operating: CfSection;
  investing: CfSection;
  financing: CfSection;
  net: number;
}

function formatYen(n: number): string {
  const v = Math.round(n);
  if (v === 0) return '0';
  const sign = v < 0 ? '-' : '';
  return sign + Math.abs(v).toLocaleString();
}

function formatJpDate(iso: string): string {
  // '2024-11-01' → '2024年11月 1日'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[1]}年${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日`;
}

function periodNumber(name: string): string {
  // 「第3期」「第 3 期」などから数字部分を抽出
  const m = name.match(/(\d+)/);
  return m ? m[1] : '';
}

type FsAccountItem = { id: string; name: string; reading: string; category: string; sub_category?: string | null; display_order?: number | null };

const BS_SUB_CATEGORIES = ['流動資産', '固定資産', '繰延資産', '流動負債', '固定負債', '純資産'] as const;
const BS_ASSET_LIST = ['流動資産', '固定資産', '繰延資産'];
const BS_LIAB_LIST = ['流動負債', '固定負債'];

function FinancialStatementView({
  selectedClientId,
  accountsList,
  addAccountLocal,
}: {
  selectedClientId: string | null;
  accountsList: FsAccountItem[];
  addAccountLocal: (name: string, reading?: string, sub_category?: string) => Promise<FsAccountItem | null>;
}) {
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FsResult | null>(null);
  const [cfResult, setCfResult] = useState<CfResult | null>(null);
  const [error, setError] = useState<string | null>(null);


  // 新規期間追加
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPeriod, setNewPeriod] = useState({ name: '', start_date: '', end_date: '' });

  // 期編集（期首残高含む）
  const [editingPeriodId, setEditingPeriodId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; start_date: string; end_date: string; corporate_tax: string; opening: { name: string; amount: string }[] }>({
    name: '', start_date: '', end_date: '', corporate_tax: '0', opening: [],
  });
  const [editSaving, setEditSaving] = useState(false);
  const [calcLoading, setCalcLoading] = useState(false);

  // 新規科目追加モーダル
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({ name: '', sub_category: '純資産' });
  const [addAccountSaving, setAddAccountSaving] = useState(false);

  // B/S 科目だけに絞った勘定科目リスト
  const bsAccounts = accountsList.filter((a) => a.sub_category && (BS_SUB_CATEGORIES as readonly string[]).includes(a.sub_category));

  // 貸借バランス計算（編集中の opening を集計）
  const editBalance = (() => {
    const subOf = new Map(accountsList.map((a) => [a.name, a.sub_category ?? null]));
    let assets = 0;
    let liabPlusEquity = 0;
    let unknown = 0;
    for (const row of editForm.opening) {
      const name = row.name.trim();
      if (!name) continue;
      const num = Number(row.amount);
      if (!Number.isFinite(num)) continue;
      const sub = subOf.get(name) ?? null;
      if (sub && BS_ASSET_LIST.includes(sub)) assets += num;
      else if (sub && (BS_LIAB_LIST.includes(sub) || sub === '純資産')) liabPlusEquity += num;
      else unknown += num;
    }
    return { assets, liabPlusEquity, diff: assets - liabPlusEquity, unknown };
  })();

  const fetchPeriods = useCallback(async () => {
    try {
      const url = selectedClientId
        ? `/api/fiscal-periods?clientId=${encodeURIComponent(selectedClientId)}`
        : '/api/fiscal-periods';
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setPeriods(data.periods ?? []);
    } catch {
      // silent
    }
  }, [selectedClientId]);

  useEffect(() => { fetchPeriods(); }, [fetchPeriods]);

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);

  const handleGenerate = async () => {
    if (!selectedPeriod) { setError('会計期間を選択してください'); return; }
    setLoading(true);
    setError(null);
    setResult(null);
    setCfResult(null);
    try {
      const params = new URLSearchParams({
        start: selectedPeriod.start_date,
        end: selectedPeriod.end_date,
        periodId: selectedPeriod.id,
      });
      if (selectedClientId) params.set('clientId', selectedClientId);
      const [fsRes, cfRes] = await Promise.all([
        fetch(`/api/financial-statement?${params}`),
        fetch(`/api/cash-flow?${params}`),
      ]);
      const data = await fsRes.json();
      if (!fsRes.ok) throw new Error(data.error || '集計失敗');
      setResult(data);
      if (cfRes.ok) setCfResult(await cfRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : '集計に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleAddPeriod = async () => {
    if (!newPeriod.name.trim() || !newPeriod.start_date || !newPeriod.end_date) return;
    const res = await fetch('/api/fiscal-periods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newPeriod, client_id: selectedClientId }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || '追加失敗'); return; }
    setPeriods((prev) => [data.period, ...prev]);
    setSelectedPeriodId(data.period.id);
    setNewPeriod({ name: '', start_date: '', end_date: '' });
    setShowAddForm(false);
  };

  const handleDeletePeriod = async (id: string) => {
    if (!confirm('この会計期間を削除しますか？')) return;
    const res = await fetch(`/api/fiscal-periods/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || '削除失敗');
      return;
    }
    setPeriods((prev) => prev.filter((p) => p.id !== id));
    if (selectedPeriodId === id) setSelectedPeriodId('');
  };

  const handleStartEdit = () => {
    if (!selectedPeriod) return;
    const ob = selectedPeriod.opening_balances ?? {};
    const opening = Object.entries(ob).map(([name, amount]) => ({ name, amount: String(amount) }));
    if (opening.length === 0) opening.push({ name: '', amount: '' });
    setEditForm({
      name: selectedPeriod.name,
      start_date: selectedPeriod.start_date,
      end_date: selectedPeriod.end_date,
      corporate_tax: String(selectedPeriod.corporate_tax ?? 0),
      opening,
    });
    setEditingPeriodId(selectedPeriod.id);
  };

  const handleSaveEdit = async () => {
    if (!editingPeriodId) return;
    setEditSaving(true);
    try {
      const ob: Record<string, number> = {};
      for (const row of editForm.opening) {
        const name = row.name.trim();
        if (!name) continue;
        const num = Number(row.amount);
        if (Number.isFinite(num)) ob[name] = num;
      }
      const res = await fetch(`/api/fiscal-periods/${editingPeriodId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name,
          start_date: editForm.start_date,
          end_date: editForm.end_date,
          corporate_tax: Number(editForm.corporate_tax) || 0,
          opening_balances: ob,
        }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || '更新失敗'); return; }
      setPeriods((prev) => prev.map((p) => (p.id === editingPeriodId ? data.period : p)));
      setEditingPeriodId(null);
    } finally {
      setEditSaving(false);
    }
  };

  const handleCreateAccount = async () => {
    const name = newAccount.name.trim();
    if (!name || addAccountSaving) return;
    setAddAccountSaving(true);
    try {
      const created = await addAccountLocal(name, '', newAccount.sub_category);
      if (created) {
        // 作成後、編集中の最終空行に名前をセット（または新規行追加）
        setEditForm((prev) => {
          const blankIdx = prev.opening.findIndex((r) => !r.name.trim());
          if (blankIdx >= 0) {
            const next = [...prev.opening];
            next[blankIdx] = { name: created.name, amount: prev.opening[blankIdx].amount };
            return { ...prev, opening: next };
          }
          return { ...prev, opening: [...prev.opening, { name: created.name, amount: '' }] };
        });
        setNewAccount({ name: '', sub_category: '純資産' });
        setShowAddAccount(false);
      }
    } finally {
      setAddAccountSaving(false);
    }
  };

  const handleAutoCalc = async () => {
    if (!editingPeriodId) return;
    setCalcLoading(true);
    try {
      const res = await fetch(`/api/fiscal-periods/${editingPeriodId}/calculate-opening`);
      const data = await res.json();
      if (!res.ok) { alert(data.error || '算出失敗'); return; }
      const ob = data.opening_balances as Record<string, number>;
      const opening = Object.entries(ob).map(([name, amount]) => ({ name, amount: String(amount) }));
      if (opening.length === 0) opening.push({ name: '', amount: '' });
      setEditForm((prev) => ({ ...prev, opening }));
    } finally {
      setCalcLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <section className="space-y-5">
      {/* 印刷時のCSS（5ページ構成・税務署式レイアウト） */}
      <style jsx global>{`
        @media print {
          body * { visibility: hidden !important; }
          .fs-print-area, .fs-print-area * { visibility: visible !important; }
          .fs-print-area { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; }
          .fs-no-print { display: none !important; }
          @page { size: A4; margin: 18mm 16mm; }
          .fs-page { page-break-after: always; break-after: page; }
          .fs-page:last-child { page-break-after: auto; break-after: auto; }
        }
        .fs-print-area { font-family: "Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "MS Mincho", serif; color: #000; }
        .fs-page { background: white; margin: 0 auto 24px; width: 210mm; min-height: 297mm; padding: 18mm 16mm; box-sizing: border-box; box-shadow: 0 1px 4px rgba(0,0,0,0.08); position: relative; font-size: 11pt; }
        @media print { .fs-page { box-shadow: none; margin: 0; padding: 0; min-height: auto; width: auto; } }
        .fs-title { text-align: center; letter-spacing: 0.5em; font-size: 13pt; font-weight: normal; padding-bottom: 4px; border-bottom: 1px solid #000; display: inline-block; padding-left: 0.5em; white-space: nowrap; }
        .fs-title-long { letter-spacing: 0.18em !important; font-size: 12pt !important; padding-left: 0.18em !important; }
        .fs-cover-title { text-align: center; letter-spacing: 1.2em; font-size: 22pt; padding-bottom: 8px; border-bottom: 1px solid #000; display: inline-block; padding-left: 1.2em; white-space: nowrap; }
        .fs-table { width: 100%; border-collapse: collapse; font-size: 10pt; }
        .fs-table th, .fs-table td { border: 1px solid #000; padding: 3px 6px; vertical-align: middle; }
        .fs-table th { text-align: center; font-weight: normal; background: #fff; }
        .fs-num { text-align: right; font-variant-numeric: tabular-nums; }
        .fs-bracket { font-weight: normal; }
        .fs-indent { padding-left: 1.2em !important; }
        .fs-noborder-top { border-top: none !important; }
        .fs-noborder-bottom { border-bottom: none !important; }
        .fs-noborder-left { border-left: none !important; }
        .fs-noborder-right { border-right: none !important; }
      `}</style>

      {/* 期間選択 & 操作パネル */}
      <div className="fs-no-print bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-500 tracking-wide">会計期間</span>
          <select
            value={selectedPeriodId}
            onChange={(e) => setSelectedPeriodId(e.target.value)}
            className="text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300 min-w-[260px]"
          >
            <option value="">選択してください</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（{p.start_date} 〜 {p.end_date}）
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="text-xs font-medium text-sky-500 border border-sky-200 rounded-xl px-3 py-2 hover:bg-sky-50 hover:border-sky-300 transition-all duration-200"
          >
            {showAddForm ? 'キャンセル' : '+ 期を追加'}
          </button>
          {selectedPeriodId && (
            <>
              <button
                onClick={handleStartEdit}
                className="text-xs font-medium text-sky-500 border border-sky-200 rounded-xl px-3 py-2 hover:bg-sky-50 hover:border-sky-300 transition-all duration-200"
              >
                期を編集（名前・期間・期首残高）
              </button>
              <button
                onClick={() => handleDeletePeriod(selectedPeriodId)}
                className="text-xs text-red-500 border border-red-200 rounded-xl px-3 py-2 hover:bg-red-50 transition-all duration-200"
              >
                この期を削除
              </button>
            </>
          )}
          <div className="flex-1" />
          {selectedPeriod && (
            <span className="text-[11px] text-slate-500 tabular-nums">
              法人税等: {formatYen(Number(selectedPeriod.corporate_tax ?? 0))} 円
            </span>
          )}
          <button
            onClick={handleGenerate}
            disabled={!selectedPeriodId || loading}
            className="text-sm text-white bg-sky-500 rounded-xl px-5 py-2 font-semibold hover:bg-sky-600 disabled:opacity-40 transition-all duration-200 shadow-sm shadow-sky-200/60"
          >
            {loading ? '集計中...' : '決算書を生成'}
          </button>
          {result && (
            <button
              onClick={handlePrint}
              className="text-sm text-white bg-lime-500 rounded-xl px-5 py-2 font-semibold hover:bg-lime-600 transition-all duration-200 shadow-sm shadow-lime-200/60"
            >
              PDFで出力
            </button>
          )}
        </div>

        {showAddForm && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 pt-2 border-t border-slate-100">
            <input
              value={newPeriod.name}
              onChange={(e) => setNewPeriod({ ...newPeriod, name: e.target.value })}
              placeholder="期の名前（例: 第3期）"
              className="text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400"
            />
            <input
              type="date"
              value={newPeriod.start_date}
              onChange={(e) => setNewPeriod({ ...newPeriod, start_date: e.target.value })}
              className="text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400"
            />
            <input
              type="date"
              value={newPeriod.end_date}
              onChange={(e) => setNewPeriod({ ...newPeriod, end_date: e.target.value })}
              className="text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400"
            />
            <button
              onClick={handleAddPeriod}
              disabled={!newPeriod.name.trim() || !newPeriod.start_date || !newPeriod.end_date}
              className="text-xs text-white bg-sky-500 rounded-lg px-4 py-2 font-semibold hover:bg-sky-600 disabled:opacity-40"
            >
              追加
            </button>
          </div>
        )}

        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
        )}
      </div>

      {/* 期編集パネル（期首残高） */}
      {editingPeriodId && (
        <div className="fs-no-print bg-white border border-sky-200 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-700">期の編集 / 期首残高</h4>
            <button onClick={() => setEditingPeriodId(null)} className="text-xs text-slate-400 hover:text-slate-600">閉じる</button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">期の名前</label>
              <input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="例: 第3期"
                className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">期首日</label>
              <input
                type="date"
                value={editForm.start_date}
                onChange={(e) => setEditForm({ ...editForm, start_date: e.target.value })}
                className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">期末日</label>
              <input
                type="date"
                value={editForm.end_date}
                onChange={(e) => setEditForm({ ...editForm, end_date: e.target.value })}
                className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">法人税等（円）</label>
              <input
                type="number"
                value={editForm.corporate_tax}
                onChange={(e) => setEditForm({ ...editForm, corporate_tax: e.target.value })}
                placeholder="0"
                className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-right tabular-nums focus:outline-none focus:border-sky-400"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs font-semibold text-slate-600">期首残高（B/S 科目のみ）</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAddAccount(true)}
                  className="text-xs text-lime-600 border border-lime-200 rounded-lg px-3 py-1.5 hover:bg-lime-50"
                >+ 新規科目を追加</button>
                <button
                  onClick={handleAutoCalc}
                  disabled={calcLoading}
                  className="text-xs text-sky-600 border border-sky-200 rounded-lg px-3 py-1.5 hover:bg-sky-50 disabled:opacity-40"
                >
                  {calcLoading ? '算出中...' : '期首日より前の仕訳から自動算出'}
                </button>
              </div>
            </div>
            <p className="text-[10px] text-slate-400">資産は正、負債・純資産は正で入力。繰越利益剰余金も含めてください。科目名はマスタから選択してください。</p>

            {/* 新規科目追加インライン */}
            {showAddAccount && (
              <div className="bg-lime-50/40 border border-lime-200 rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-lime-700">新規科目を追加</p>
                <div className="grid grid-cols-12 gap-2">
                  <input
                    value={newAccount.name}
                    onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                    placeholder="科目名（例: 繰越利益剰余金）"
                    className="col-span-6 text-xs border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-lime-400"
                  />
                  <select
                    value={newAccount.sub_category}
                    onChange={(e) => setNewAccount({ ...newAccount, sub_category: e.target.value })}
                    className="col-span-4 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-lime-400"
                  >
                    {BS_SUB_CATEGORIES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleCreateAccount}
                    disabled={!newAccount.name.trim() || addAccountSaving}
                    className="col-span-2 text-xs text-white bg-lime-500 rounded-lg px-2 py-1.5 hover:bg-lime-600 disabled:opacity-40"
                  >{addAccountSaving ? '...' : '追加'}</button>
                </div>
                <button
                  onClick={() => { setShowAddAccount(false); setNewAccount({ name: '', sub_category: '純資産' }); }}
                  className="text-[10px] text-slate-400 hover:text-slate-600"
                >キャンセル</button>
              </div>
            )}

            <div className="space-y-1 max-h-80 overflow-y-auto">
              {editForm.opening.map((row, i) => {
                const acc = accountsList.find((a) => a.name === row.name);
                const sub = acc?.sub_category ?? null;
                const valid = !!sub && (BS_SUB_CATEGORIES as readonly string[]).includes(sub);
                return (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <select
                      value={row.name}
                      onChange={(e) => {
                        const next = [...editForm.opening];
                        next[i] = { ...next[i], name: e.target.value };
                        setEditForm({ ...editForm, opening: next });
                      }}
                      className={`col-span-6 text-xs border rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-sky-400 ${row.name && !valid ? 'border-red-300 text-red-600' : 'border-slate-200'}`}
                    >
                      <option value="">科目を選択</option>
                      {bsAccounts.map((a) => (
                        <option key={a.id} value={a.name}>{a.name}（{a.sub_category}）</option>
                      ))}
                      {/* 既に opening に入っているが現在のリストにない名前は警告として表示 */}
                      {row.name && !bsAccounts.some((a) => a.name === row.name) && (
                        <option value={row.name}>⚠ {row.name}（マスタ未登録）</option>
                      )}
                    </select>
                    <span className={`col-span-2 text-[10px] tracking-wide ${valid ? 'text-slate-400' : 'text-red-500'}`}>
                      {sub ?? (row.name ? '未分類' : '')}
                    </span>
                    <input
                      type="number"
                      value={row.amount}
                      onChange={(e) => {
                        const next = [...editForm.opening];
                        next[i] = { ...next[i], amount: e.target.value };
                        setEditForm({ ...editForm, opening: next });
                      }}
                      placeholder="金額"
                      className="col-span-3 text-xs border border-slate-200 rounded-lg px-3 py-1.5 text-right tabular-nums focus:outline-none focus:border-sky-400"
                    />
                    <button
                      onClick={() => {
                        const next = editForm.opening.filter((_, j) => j !== i);
                        setEditForm({ ...editForm, opening: next.length ? next : [{ name: '', amount: '' }] });
                      }}
                      className="col-span-1 text-xs text-red-400 hover:text-red-600"
                    >×</button>
                  </div>
                );
              })}
              <button
                onClick={() => setEditForm({ ...editForm, opening: [...editForm.opening, { name: '', amount: '' }] })}
                className="text-xs text-sky-500 border border-sky-200 rounded-lg px-3 py-1.5 hover:bg-sky-50"
              >+ 行を追加</button>
            </div>

            {/* 貸借バランスチェック */}
            <div className={`mt-3 rounded-lg p-3 text-xs space-y-1 ${editBalance.diff === 0 && editBalance.unknown === 0 ? 'bg-lime-50 border border-lime-200' : 'bg-amber-50 border border-amber-200'}`}>
              <div className="flex justify-between"><span className="text-slate-600">資産合計</span><span className="font-semibold tabular-nums">{formatYen(editBalance.assets)}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">負債＋純資産合計</span><span className="font-semibold tabular-nums">{formatYen(editBalance.liabPlusEquity)}</span></div>
              <div className={`flex justify-between border-t pt-1 ${editBalance.diff === 0 ? 'text-lime-700 border-lime-200' : 'text-amber-700 border-amber-200'}`}>
                <span className="font-semibold">差額（資産 − 負債純資産）</span>
                <span className="font-bold tabular-nums">{formatYen(editBalance.diff)}</span>
              </div>
              {editBalance.diff !== 0 && (
                <p className="text-[10px] text-amber-700">⚠ 貸借が一致していません。差額分を繰越利益剰余金などで調整してください。</p>
              )}
              {editBalance.unknown !== 0 && (
                <p className="text-[10px] text-red-600">⚠ マスタ未登録の科目（赤表示）が含まれています。決算書に反映されません。新規科目を追加してください。</p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSaveEdit}
              disabled={editSaving}
              className="text-sm text-white bg-sky-500 rounded-xl px-5 py-2 font-semibold hover:bg-sky-600 disabled:opacity-40"
            >{editSaving ? '保存中...' : '保存'}</button>
            <button
              onClick={() => setEditingPeriodId(null)}
              className="text-sm text-slate-500 border border-slate-200 rounded-xl px-5 py-2 hover:bg-slate-50"
            >キャンセル</button>
          </div>
        </div>
      )}

      {/* 印刷時の注意（画面のみ） */}
      {result && (
        <div className="fs-no-print text-[11px] text-slate-500 bg-amber-50 border border-amber-100 rounded-xl px-4 py-2">
          ※ ブラウザの印刷ダイアログで「ヘッダーとフッター」のチェックを外し、「背景のグラフィック」をオフにしてからPDF保存してください。
        </div>
      )}

      {/* 決算書本体（5+1ページ） */}
      {result && (
        <div className="fs-print-area">
          <DecisionReportPaper result={result} period={selectedPeriod ?? null} cfResult={cfResult} />
        </div>
      )}

      {result && result.invalidOpeningBalances && result.invalidOpeningBalances.length > 0 && (
        <div className="fs-no-print bg-red-50 border border-red-200 rounded-2xl p-4">
          <p className="text-xs font-semibold text-red-700 mb-2">
            ⚠ 期首残高に「マスタ未登録 / 中区分未設定」の科目が {result.invalidOpeningBalances.length} 件あり、決算書に反映されていません
          </p>
          <div className="flex flex-wrap gap-2">
            {result.invalidOpeningBalances.map((u) => (
              <span key={u.name} className="text-[11px] bg-white border border-red-200 rounded-md px-2 py-1 text-red-700 tabular-nums">
                {u.name}: {formatYen(u.amount)}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-red-600 mt-2">「期を編集」→「+ 新規科目を追加」で対象科目を作成し、保存し直してください。</p>
        </div>
      )}

      {result && result.unclassified.length > 0 && (
        <div className="fs-no-print bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <p className="text-xs font-semibold text-amber-700 mb-2">
            ⚠ 中区分が未設定の科目が {result.unclassified.length} 件あります（決算書に含まれていません）
          </p>
          <div className="flex flex-wrap gap-2">
            {result.unclassified.map((u) => (
              <span key={u.name} className="text-[11px] bg-white border border-amber-200 rounded-md px-2 py-1 text-amber-700">
                {u.name}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-amber-600 mt-2">「マスタ」タブから中区分を設定してください。</p>
        </div>
      )}

      {!result && !loading && (
        <div className="fs-no-print bg-white border border-slate-100 rounded-2xl p-10 text-center shadow-sm">
          <p className="text-sm text-slate-400">
            会計期間を選択して「決算書を生成」ボタンを押してください
          </p>
          <p className="text-xs text-slate-300 mt-2">
            期が未登録の場合は「+ 期を追加」から登録できます
          </p>
        </div>
      )}
    </section>
  );
}

// ─── 5ページ印刷レイアウト ─────────────────────────────────────────────────

function DecisionReportPaper({ result, period, cfResult }: { result: FsResult; period: FiscalPeriod | null; cfResult: CfResult | null }) {
  // 決算書には「正式名」のみを使用する。未設定なら警告表示にフォールバック。
  const legalName = result.client?.legal_name?.trim() || '（正式名未設定 — クライアント管理から設定してください）';
  const periodNo = period ? periodNumber(period.name) : '';

  return (
    <>
      <CoverPage legalName={legalName} periodNo={periodNo} start={result.period.start} end={result.period.end} />
      <BsPage result={result} legalName={legalName} />
      <PlPage result={result} legalName={legalName} />
      <SgaPage result={result} legalName={legalName} />
      <EquityPage result={result} legalName={legalName} />
      {cfResult && <CashFlowPage cf={cfResult} legalName={legalName} />}
    </>
  );
}

function CoverPage({ legalName, periodNo, start, end }: { legalName: string; periodNo: string; start: string; end: string }) {
  return (
    <div className="fs-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ border: '1px solid #000', flex: 1, display: 'flex', flexDirection: 'column', padding: '40mm 20mm 30mm' }}>
        <div style={{ textAlign: 'center', marginTop: '40mm' }}>
          <span className="fs-cover-title">決算報告書</span>
        </div>
        <div style={{ textAlign: 'center', marginTop: '24mm', fontSize: '12pt' }}>
          （第 {periodNo || '?'} 期）
        </div>
        <div style={{ textAlign: 'center', marginTop: '8mm', fontSize: '11pt', lineHeight: 1.8 }}>
          <div>自&nbsp;&nbsp;{formatJpDate(start)}</div>
          <div>至&nbsp;&nbsp;{formatJpDate(end)}</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: 'center', fontSize: '11pt', marginBottom: '20mm' }}>
          {legalName || '（会社名未設定）'}
        </div>
      </div>
    </div>
  );
}

function PaperHeader({ title, legalName, dateLine, rightNote, longTitle }: { title: string; legalName: string; dateLine: string; rightNote?: string; longTitle?: boolean }) {
  return (
    <div style={{ marginBottom: '6mm' }}>
      <div style={{ textAlign: 'center', marginBottom: '4mm' }}>
        <span className={longTitle ? 'fs-title fs-title-long' : 'fs-title'}>{title}</span>
      </div>
      <div style={{ textAlign: 'center', fontSize: '9.5pt', marginBottom: '4mm' }}>{dateLine}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10pt' }}>
        <span>{legalName}</span>
        <span>{rightNote ?? '（単位：円）'}</span>
      </div>
    </div>
  );
}

function BsPage({ result, legalName }: { result: FsResult; legalName: string }) {
  const assetGroups = result.bs.groups.filter((g) => ['流動資産', '固定資産', '繰延資産'].includes(g.sub_category));
  const liabGroups = result.bs.groups.filter((g) => ['流動負債', '固定負債'].includes(g.sub_category));
  const equityGroups = result.bs.groups.filter((g) => g.sub_category === '純資産');

  // 左右の行数を揃える
  const leftRows: { kind: 'group' | 'item' | 'total'; label: string; amount?: number }[] = [];
  for (const g of assetGroups) {
    leftRows.push({ kind: 'group', label: `【${g.sub_category}】`, amount: g.total });
    for (const it of g.items) leftRows.push({ kind: 'item', label: it.name, amount: it.amount });
  }

  const rightRows: { kind: 'group' | 'item' | 'subtotal'; label: string; amount?: number }[] = [];
  for (const g of liabGroups) {
    rightRows.push({ kind: 'group', label: `【${g.sub_category}】`, amount: g.total });
    for (const it of g.items) rightRows.push({ kind: 'item', label: it.name, amount: it.amount });
  }
  rightRows.push({ kind: 'subtotal', label: '負債の部合計', amount: result.bs.liabilitiesTotal });
  rightRows.push({ kind: 'group', label: '純　資　産　の　部', amount: undefined });
  for (const g of equityGroups) {
    rightRows.push({ kind: 'group', label: `【${g.sub_category}】`, amount: g.total });
    for (const it of g.items) rightRows.push({ kind: 'item', label: it.name, amount: it.amount });
  }
  rightRows.push({ kind: 'subtotal', label: '純資産の部合計', amount: result.bs.equityTotal });

  const maxRows = Math.max(leftRows.length, rightRows.length);
  while (leftRows.length < maxRows) leftRows.push({ kind: 'item', label: '', amount: undefined });
  while (rightRows.length < maxRows) rightRows.push({ kind: 'item', label: '', amount: undefined });

  return (
    <div className="fs-page">
      <PaperHeader title="貸借対照表" legalName={legalName} dateLine={`${formatJpDate(result.period.end)}　現在`} />
      <table className="fs-table">
        <thead>
          <tr>
            <th colSpan={2} style={{ width: '50%' }}>資　産　の　部</th>
            <th colSpan={2} style={{ width: '50%' }}>負　債　の　部</th>
          </tr>
          <tr>
            <th style={{ width: '32%' }}>科　　　目</th>
            <th style={{ width: '18%' }}>金　　額</th>
            <th style={{ width: '32%' }}>科　　　目</th>
            <th style={{ width: '18%' }}>金　　額</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: maxRows }).map((_, i) => {
            const L = leftRows[i];
            const R = rightRows[i];
            return (
              <tr key={i}>
                <td className={L.kind === 'item' ? 'fs-indent' : ''}>{L.label}</td>
                <td className="fs-num">{L.amount != null && L.label ? formatYen(L.amount) : ''}</td>
                <td className={R.kind === 'item' ? 'fs-indent' : ''}>{R.label}</td>
                <td className="fs-num">{R.amount != null && R.label ? formatYen(R.amount) : ''}</td>
              </tr>
            );
          })}
          <tr>
            <td><strong>資　産　の　部　合　計</strong></td>
            <td className="fs-num"><strong>{formatYen(result.bs.assetsTotal)}</strong></td>
            <td><strong>負債及び純資産合計</strong></td>
            <td className="fs-num"><strong>{formatYen(result.bs.liabilitiesAndEquityTotal)}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function PlPage({ result, legalName }: { result: FsResult; legalName: string }) {
  const find = (sub: string) => result.pl.groups.find((g) => g.sub_category === sub);
  const sales = find('売上高');
  const cogs = find('売上原価');
  const sga = find('販管費');
  const nopI = find('営業外収益');
  const nopE = find('営業外費用');
  const exI = find('特別利益');
  const exE = find('特別損失');

  return (
    <div className="fs-page">
      <PaperHeader
        title="損益計算書"
        legalName={legalName}
        dateLine={`自　${formatJpDate(result.period.start)}\u3000\u3000至　${formatJpDate(result.period.end)}`}
      />
      <table className="fs-table">
        <thead>
          <tr>
            <th style={{ width: '60%' }}>科　　　目</th>
            <th colSpan={2}>金　　額</th>
          </tr>
        </thead>
        <tbody>
          <PlPaperSection label="売上高" group={sales} total={result.pl.salesTotal} totalLabel="売上高合計" />
          <PlPaperSection label="売上原価" group={cogs} total={result.pl.cogsTotal} totalLabel="売上原価" />
          <tr><td className="fs-indent">売上総利益金額</td><td className="fs-num"></td><td className="fs-num">{formatYen(result.pl.grossProfit)}</td></tr>
          <PlPaperSection label="販売費及び一般管理費" group={sga} total={result.pl.sgaTotal} totalLabel="販売費及び一般管理費合計" />
          <tr><td className="fs-indent">営業利益金額</td><td className="fs-num"></td><td className="fs-num">{formatYen(result.pl.operatingProfit)}</td></tr>
          <PlPaperSection label="営業外収益" group={nopI} total={result.pl.nonOpIncome} totalLabel="営業外収益合計" />
          <PlPaperSection label="営業外費用" group={nopE} total={result.pl.nonOpExpense} totalLabel="営業外費用合計" />
          <tr><td className="fs-indent">経常利益金額</td><td className="fs-num"></td><td className="fs-num">{formatYen(result.pl.ordinaryProfit)}</td></tr>
          {exI && exI.items.length > 0 && <PlPaperSection label="特別利益" group={exI} total={result.pl.extraIncome} totalLabel="特別利益合計" />}
          {exE && exE.items.length > 0 && <PlPaperSection label="特別損失" group={exE} total={result.pl.extraLoss} totalLabel="特別損失合計" />}
          <tr><td className="fs-indent">税引前当期純利益金額</td><td className="fs-num"></td><td className="fs-num">{formatYen(result.pl.netIncomeBeforeTax)}</td></tr>
          {result.pl.corporateTax !== 0 && (
            <tr><td className="fs-indent">法人税、住民税及び事業税</td><td className="fs-num">{formatYen(result.pl.corporateTax)}</td><td className="fs-num"></td></tr>
          )}
          <tr><td className="fs-indent"><strong>当期純利益金額</strong></td><td className="fs-num"></td><td className="fs-num"><strong>{formatYen(result.pl.netIncome)}</strong></td></tr>
        </tbody>
      </table>
    </div>
  );
}

function PlPaperSection({ label, group, total, totalLabel }: { label: string; group: FsGroup | undefined; total: number; totalLabel: string }) {
  return (
    <>
      <tr><td>【{label}】</td><td className="fs-num"></td><td className="fs-num"></td></tr>
      {group?.items.map((it) => (
        <tr key={it.name}>
          <td className="fs-indent">{it.name}</td>
          <td className="fs-num">{formatYen(it.amount)}</td>
          <td className="fs-num"></td>
        </tr>
      ))}
      <tr>
        <td className="fs-indent">{totalLabel}</td>
        <td className="fs-num"></td>
        <td className="fs-num">{formatYen(total)}</td>
      </tr>
    </>
  );
}

function SgaPage({ result, legalName }: { result: FsResult; legalName: string }) {
  const sga = result.pl.groups.find((g) => g.sub_category === '販管費');
  return (
    <div className="fs-page">
      <PaperHeader
        title="販売費及び一般管理費内訳書"
        longTitle
        legalName={legalName}
        dateLine={`自　${formatJpDate(result.period.start)}\u3000\u3000至　${formatJpDate(result.period.end)}`}
      />
      <table className="fs-table">
        <thead>
          <tr>
            <th style={{ width: '60%' }}>科　　　目</th>
            <th colSpan={2}>金　　額</th>
          </tr>
        </thead>
        <tbody>
          {sga?.items.map((it) => (
            <tr key={it.name}>
              <td className="fs-indent">{it.name}</td>
              <td className="fs-num">{formatYen(it.amount)}</td>
              <td className="fs-num"></td>
            </tr>
          ))}
          <tr>
            <td className="fs-indent"><strong>販売費及び一般管理費合計</strong></td>
            <td className="fs-num"></td>
            <td className="fs-num"><strong>{formatYen(result.pl.sgaTotal)}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function EquityPage({ result, legalName }: { result: FsResult; legalName: string }) {
  return (
    <div className="fs-page">
      <PaperHeader
        title="社員資本等変動計算書"
        longTitle
        legalName={legalName}
        dateLine={`自　${formatJpDate(result.period.start)}\u3000\u3000至　${formatJpDate(result.period.end)}`}
      />
      <table className="fs-table" style={{ borderCollapse: 'collapse' }}>
        <tbody>
          <tr>
            <td colSpan={4}>【社員資本】</td>
          </tr>
          {result.equity.rows.map((row) => (
            <EquityRowBlock key={row.name} row={row} />
          ))}
          <tr>
            <td style={{ width: '24%' }}>株主資本合計</td>
            <td style={{ width: '20%' }}>当期首残高</td>
            <td colSpan={2} className="fs-num">{formatYen(result.equity.openingTotal)}</td>
          </tr>
          <tr>
            <td></td>
            <td>当期変動額</td>
            <td colSpan={2} className="fs-num">{formatYen(result.equity.changeTotal)}</td>
          </tr>
          <tr>
            <td></td>
            <td>当期末残高</td>
            <td colSpan={2} className="fs-num"><strong>{formatYen(result.equity.endingTotal)}</strong></td>
          </tr>
          <tr>
            <td>純資産の部合計</td>
            <td>当期首残高</td>
            <td colSpan={2} className="fs-num">{formatYen(result.equity.openingTotal)}</td>
          </tr>
          <tr>
            <td></td>
            <td>当期変動額</td>
            <td colSpan={2} className="fs-num">{formatYen(result.equity.changeTotal)}</td>
          </tr>
          <tr>
            <td></td>
            <td>当期末残高</td>
            <td colSpan={2} className="fs-num"><strong>{formatYen(result.equity.endingTotal)}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function EquityRowBlock({ row }: { row: FsEquityRow }) {
  return (
    <>
      <tr>
        <td style={{ width: '24%' }} className="fs-indent">{row.name}</td>
        <td style={{ width: '20%' }}>当期首残高</td>
        <td colSpan={2} className="fs-num">{formatYen(row.opening)}</td>
      </tr>
      <tr>
        <td></td>
        <td>当期変動額{row.isCarryForward ? '　当期純利益金額' : ''}</td>
        <td colSpan={2} className="fs-num">{formatYen(row.change)}</td>
      </tr>
      <tr>
        <td></td>
        <td>当期末残高</td>
        <td colSpan={2} className="fs-num"><strong>{formatYen(row.ending)}</strong></td>
      </tr>
    </>
  );
}

function CashFlowPage({ cf, legalName }: { cf: CfResult; legalName: string }) {
  const sections: { title: string; roman: string; section: CfSection }[] = [
    { title: '営業活動によるキャッシュフロー', roman: 'Ⅰ', section: cf.operating },
    { title: '投資活動によるキャッシュフロー', roman: 'Ⅱ', section: cf.investing },
    { title: '財務活動によるキャッシュフロー', roman: 'Ⅲ', section: cf.financing },
  ];
  const subtotalLabels = [
    '営業活動によるキャッシュフロー合計',
    '投資活動によるキャッシュフロー合計',
    '財務活動によるキャッシュフロー合計',
  ];

  return (
    <div className="fs-page">
      <PaperHeader
        title="キャッシュフロー計算書"
        legalName={legalName}
        dateLine={`自　${formatJpDate(cf.period.start)}　　至　${formatJpDate(cf.period.end)}`}
        rightNote="（間接法・単位：円）"
      />
      <table className="fs-table">
        <thead>
          <tr>
            <th style={{ width: '60%' }}>科　　　目</th>
            <th style={{ width: '40%' }}>金　　額</th>
          </tr>
        </thead>
        <tbody>
          {sections.map(({ title, roman, section }, si) => (
            <>
              <tr key={`sec-${si}`}>
                <td colSpan={2}><strong>{roman}　{title}</strong></td>
              </tr>
              {section.items.map((item, ii) => (
                <tr key={`item-${si}-${ii}`}>
                  <td className="fs-indent">{item.label}</td>
                  <td className="fs-num">{formatYen(item.amount)}</td>
                </tr>
              ))}
              {section.items.length === 0 && (
                <tr key={`empty-${si}`}>
                  <td className="fs-indent" style={{ color: '#aaa' }}>（該当なし）</td>
                  <td className="fs-num">0</td>
                </tr>
              )}
              <tr key={`sub-${si}`}>
                <td><strong>{subtotalLabels[si]}</strong></td>
                <td className="fs-num"><strong>{formatYen(section.subtotal)}</strong></td>
              </tr>
            </>
          ))}
          <tr>
            <td><strong>現金及び現金同等物の増減額</strong></td>
            <td className="fs-num"><strong>{formatYen(cf.net)}</strong></td>
          </tr>
        </tbody>
      </table>
      <p style={{ fontSize: '8.5pt', color: '#555', marginTop: '6mm' }}>
        ※ 間接法による参考表示です。現金科目（現金・普通預金等）の期中増減と一致しない場合は、科目の中区分設定をご確認ください。
      </p>
    </div>
  );
}

// ─── 仕訳照合結果テーブル（編集可能・科目コンボボックス・チェックボックス） ─────
function MatchResultTable({
  journalMatchResult,
  setJournalMatchResult,
  accountsList,
  addAccountLocal,
  selectedVoucherIdx,
  setSelectedVoucherIdx,
  registeredVoucherIdx,
  showVoucherPdf,
  showTransactionPdf,
  onCreateVendorRule,
  onlyUnregistered = false,
}: {
  journalMatchResult: { results: MatchResult[]; summary: MatchSummary };
  setJournalMatchResult: React.Dispatch<React.SetStateAction<{ results: MatchResult[]; summary: MatchSummary } | null>>;
  accountsList: AccountOption[];
  addAccountLocal: (name: string, reading?: string, sub_category?: string) => Promise<AccountOption | null>;
  selectedVoucherIdx: Set<number>;
  setSelectedVoucherIdx: React.Dispatch<React.SetStateAction<Set<number>>>;
  registeredVoucherIdx: Set<number>;
  showVoucherPdf: (voucher: VoucherInput) => void;
  showTransactionPdf: (tx: TransactionInput) => void;
  onCreateVendorRule: (vendorName: string, debitAccount: string) => void;
  onlyUnregistered?: boolean;
}) {
  // onlyUnregistered モードでは、まだ登録していない voucher group のみ表示
  const visibleIndices = journalMatchResult.results
    .map((_, i) => i)
    .filter((i) => !onlyUnregistered || !registeredVoucherIdx.has(i));
  const toggleVoucher = (i: number) => {
    if (registeredVoucherIdx.has(i)) return;
    setSelectedVoucherIdx((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };
  const allSelectable = journalMatchResult.results
    .map((_, i) => i)
    .filter((i) => !registeredVoucherIdx.has(i));
  const allSelected = allSelectable.length > 0 && allSelectable.every((i) => selectedVoucherIdx.has(i));
  const toggleAll = () => {
    setSelectedVoucherIdx(() => {
      if (allSelected) return new Set();
      return new Set(allSelectable);
    });
  };

  // 非破壊で journalMatchResult の1フィールドを更新
  const patchAccrual = (resultIdx: number, lineIdx: number, patch: Partial<MatchResult['accrualEntries'][number]>) => {
    setJournalMatchResult((prev) => {
      if (!prev) return prev;
      const results = prev.results.map((r, i) => {
        if (i !== resultIdx) return r;
        const accrualEntries = r.accrualEntries.map((e, j) => (j === lineIdx ? { ...e, ...patch } : e));
        return { ...r, accrualEntries };
      });
      return { ...prev, results };
    });
  };
  const patchPayment = (resultIdx: number, patch: Partial<NonNullable<MatchResult['paymentEntry']>>) => {
    setJournalMatchResult((prev) => {
      if (!prev) return prev;
      const results = prev.results.map((r, i) => {
        if (i !== resultIdx || !r.paymentEntry) return r;
        return { ...r, paymentEntry: { ...r.paymentEntry, ...patch } };
      });
      return { ...prev, results };
    });
  };

  // 計上明細行の追加（最後の行を複製、金額は空）
  const addAccrualLine = (resultIdx: number) => {
    setJournalMatchResult((prev) => {
      if (!prev) return prev;
      const results = prev.results.map((r, i) => {
        if (i !== resultIdx) return r;
        const last = r.accrualEntries[r.accrualEntries.length - 1];
        if (!last) return r;
        const newEntry = {
          ...last,
          amount: null,
          description: '',
          matchStatus: 'needs_review' as const,
        };
        return { ...r, accrualEntries: [...r.accrualEntries, newEntry] };
      });
      return { ...prev, results };
    });
  };

  // 計上明細行の削除（最低1行は残す）
  const deleteAccrualLine = (resultIdx: number, lineIdx: number) => {
    setJournalMatchResult((prev) => {
      if (!prev) return prev;
      const results = prev.results.map((r, i) => {
        if (i !== resultIdx) return r;
        if (r.accrualEntries.length <= 1) return r;
        return { ...r, accrualEntries: r.accrualEntries.filter((_, j) => j !== lineIdx) };
      });
      return { ...prev, results };
    });
  };

  // 支払日の前月末を算出（YYYYMMDD → YYYYMMDD）
  const getPrevMonthEnd = (paymentDate: string): string => {
    if (!/^\d{8}$/.test(paymentDate)) return '';
    const y = parseInt(paymentDate.slice(0, 4));
    const m = parseInt(paymentDate.slice(4, 6));
    // 支払月の1日 - 1日 = 前月末
    const d = new Date(y, m - 1, 0);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  };

  // 日付不明の費用計上を一括で「支払日の前月末」に設定
  const hasUnknownDates = journalMatchResult.results.some((r) =>
    r.accrualEntries.some((ae) => !/^\d{8}$/.test(ae.date)) && r.paymentEntry
  );
  const fillAllPrevMonth = () => {
    setJournalMatchResult((prev) => {
      if (!prev) return prev;
      const results = prev.results.map((r) => {
        if (!r.paymentEntry) return r;
        const prevMonth = getPrevMonthEnd(r.paymentEntry.date);
        if (!prevMonth) return r;
        const accrualEntries = r.accrualEntries.map((ae) =>
          /^\d{8}$/.test(ae.date) ? ae : { ...ae, date: prevMonth }
        );
        return { ...r, accrualEntries };
      });
      return { ...prev, results };
    });
  };

  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
      {hasUnknownDates && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 border-b border-amber-100">
          <span className="text-xs text-amber-700">日付不明の項目があります</span>
          <button
            type="button"
            onClick={fillAllPrevMonth}
            className="text-[11px] font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg px-3 py-1 transition-colors"
          >
            一括：支払日の前月末を設定
          </button>
          <span className="text-[10px] text-amber-500">※ 個別に手入力も可能です</span>
        </div>
      )}
      <div>
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col style={{ width: '36px' }} />
            <col style={{ width: '78px' }} />
            <col style={{ width: '92px' }} />
            <col />
            <col />
            <col style={{ width: '110px' }} />
            <col />
            <col style={{ width: '76px' }} />
            <col style={{ width: '64px' }} />
          </colgroup>
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-1 py-3 text-center">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="cursor-pointer"
                />
              </th>
              <th className="px-2 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">種別</th>
              <th className="px-2 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">日付</th>
              <th className="px-2 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">借方</th>
              <th className="px-2 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">貸方</th>
              <th className="px-2 py-3 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">金額</th>
              <th className="px-2 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">摘要</th>
              <th className="px-2 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">照合</th>
              <th className="px-2 py-3 text-center text-[10px] font-semibold text-slate-300 uppercase tracking-widest">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {visibleIndices.map((i) => {
              const r = journalMatchResult.results[i];
              const isRegistered = registeredVoucherIdx.has(i);
              const isSelected = selectedVoucherIdx.has(i);
              const voucherFirst = r.accrualEntries[0]?.voucher;
              const vendorName = voucherFirst?.vendorName ?? '';
              const firstDebit = r.accrualEntries[0]?.debitAccount ?? '';
              const rowBg = isRegistered ? 'bg-lime-50/40 opacity-70' : isSelected ? 'bg-sky-50/40' : '';
              return (
                <Fragment key={i}>
                  {r.accrualEntries.map((ae, lineIdx) => {
                    const rowSpanTotal = r.accrualEntries.length + (r.paymentEntry ? 1 : 0) + (r.withholdingPaymentEntry ? 1 : 0);
                    const dateIso = /^\d{8}$/.test(ae.date) ? `${ae.date.slice(0,4)}-${ae.date.slice(4,6)}-${ae.date.slice(6,8)}` : '';
                    return (
                    <tr key={`a-${i}-${lineIdx}`} className={`${rowBg} hover:bg-sky-50/20 transition-colors`}>
                      {lineIdx === 0 && (
                        <td
                          rowSpan={rowSpanTotal}
                          className="px-2 py-3 text-center align-top"
                        >
                          <input
                            type="checkbox"
                            disabled={isRegistered}
                            checked={isSelected || isRegistered}
                            onChange={() => toggleVoucher(i)}
                            className="cursor-pointer"
                          />
                          {isRegistered && <div className="text-[9px] text-lime-600 mt-1">登録済</div>}
                        </td>
                      )}
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] bg-sky-100 text-sky-600 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
                            費用計上{r.accrualEntries.length > 1 ? `(${lineIdx + 1}/${r.accrualEntries.length})` : ''}
                          </span>
                          {r.accrualEntries.length > 1 && !isRegistered && (
                            <button
                              type="button"
                              onClick={() => deleteAccrualLine(i, lineIdx)}
                              className="text-red-400 hover:text-red-600 text-xs leading-none"
                              title="この行を削除"
                            >×</button>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1">
                          <input
                            type="date"
                            value={dateIso}
                            disabled={isRegistered}
                            onChange={(e) => {
                              const v = e.target.value.replace(/-/g, '');
                              patchAccrual(i, lineIdx, { date: v || '不明' });
                            }}
                            className="flex-1 min-w-0 text-[11px] font-mono text-slate-600 border border-slate-200 rounded px-1 py-0.5 focus:outline-none focus:border-sky-400 disabled:bg-transparent disabled:border-transparent"
                          />
                          {!dateIso && !isRegistered && r.paymentEntry && (
                            <button
                              type="button"
                              onClick={() => {
                                const pm = getPrevMonthEnd(r.paymentEntry!.date);
                                if (pm) patchAccrual(i, lineIdx, { date: pm });
                              }}
                              className="text-[9px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 py-0.5 hover:bg-amber-100 whitespace-nowrap"
                              title="支払日の前月末を設定"
                            >
                              前月
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <AccountCombobox
                          value={ae.debitAccount}
                          onChange={(v) => patchAccrual(i, lineIdx, { debitAccount: v })}
                          onCommit={(v) => patchAccrual(i, lineIdx, { debitAccount: v })}
                          accounts={accountsList}
                          onCreate={addAccountLocal}
                          dense
                        />
                      </td>
                      <td className="px-2 py-2">
                        <AccountCombobox
                          value={ae.creditAccount}
                          onChange={(v) => patchAccrual(i, lineIdx, { creditAccount: v as typeof ae.creditAccount })}
                          onCommit={(v) => patchAccrual(i, lineIdx, { creditAccount: v as typeof ae.creditAccount })}
                          accounts={accountsList}
                          onCreate={addAccountLocal}
                          dense
                        />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <input
                          type="number"
                          value={ae.amount ?? ''}
                          disabled={isRegistered}
                          onChange={(e) => {
                            const v = e.target.value === '' ? null : Number(e.target.value);
                            patchAccrual(i, lineIdx, { amount: v });
                          }}
                          className="w-full text-right text-sm font-semibold text-slate-900 tabular-nums border border-slate-200 rounded px-1 py-0.5 focus:outline-none focus:border-sky-400 disabled:bg-transparent disabled:border-transparent"
                          placeholder="0"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-start gap-1">
                          <input
                            type="text"
                            value={ae.description}
                            disabled={isRegistered}
                            onChange={(e) => patchAccrual(i, lineIdx, { description: e.target.value })}
                            className="flex-1 min-w-0 text-xs text-slate-600 border border-slate-200 rounded px-1 py-0.5 focus:outline-none focus:border-sky-400 disabled:bg-transparent disabled:border-transparent"
                            placeholder="摘要"
                          />
                          {voucherFirst?.ocrUploadId && (
                            <button
                              type="button"
                              onClick={() => showVoucherPdf(voucherFirst)}
                              className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 hover:bg-sky-100 rounded px-1.5 py-0.5 whitespace-nowrap"
                              title="請求書PDFを開く"
                            >📄 請求書</button>
                          )}
                          {r.paymentEntry?.transaction?.ocrUploadId && lineIdx === 0 && (
                            <button
                              type="button"
                              onClick={() => showTransactionPdf(r.paymentEntry!.transaction)}
                              className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-lime-700 bg-lime-50 border border-lime-200 hover:bg-lime-100 rounded px-1.5 py-0.5 whitespace-nowrap"
                              title="通帳PDF（入出金明細）を開く"
                            >🏦 通帳</button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          ae.matchStatus === 'auto' ? 'bg-lime-100 text-lime-600'
                          : ae.matchStatus === 'needs_review' ? 'bg-amber-100 text-amber-600'
                          : 'bg-red-100 text-red-500'
                        }`}>
                          {ae.matchStatus === 'auto' ? '自動照合' : ae.matchStatus === 'needs_review' ? '要確認' : '未照合'}
                        </span>
                      </td>
                      {lineIdx === 0 && (
                        <td
                          rowSpan={r.accrualEntries.length + (r.paymentEntry ? 1 : 0)}
                          className="px-3 py-2 text-center align-top"
                        >
                          <button
                            type="button"
                            disabled={!vendorName || !firstDebit}
                            onClick={() => onCreateVendorRule(vendorName, r.accrualEntries[0]?.debitAccount ?? '')}
                            className="text-[10px] text-sky-600 border border-sky-200 bg-sky-50 hover:bg-sky-100 rounded-md px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
                            title={`この取引先「${vendorName || '(未指定)'}」→「${firstDebit || '(科目未指定)'}」を次回以降の自動仕訳ルールとしてマスタに登録します`}
                          >
                            🏷️ ルール登録
                          </button>
                        </td>
                      )}
                    </tr>
                    );
                  })}
                  {r.paymentEntry && (
                    <tr className={`${rowBg} bg-slate-50/20 hover:bg-lime-50/20`}>
                      <td className="px-3 py-2">
                        <span className="text-[10px] bg-lime-100 text-lime-700 px-2 py-0.5 rounded-full font-medium">支払消込</span>
                      </td>
                      <td className="px-3 py-2 text-xs font-mono text-slate-500">
                        {`${r.paymentEntry.date.slice(0,4)}/${r.paymentEntry.date.slice(4,6)}/${r.paymentEntry.date.slice(6,8)}`}
                      </td>
                      <td className="px-2 py-2">
                        <AccountCombobox
                          value={r.paymentEntry.debitAccount}
                          onChange={(v) => patchPayment(i, { debitAccount: v as '未払費用' })}
                          onCommit={(v) => patchPayment(i, { debitAccount: v as '未払費用' })}
                          accounts={accountsList}
                          onCreate={addAccountLocal}
                          dense
                        />
                      </td>
                      <td className="px-2 py-2">
                        <AccountCombobox
                          value={r.paymentEntry.creditAccount}
                          onChange={(v) => patchPayment(i, { creditAccount: v as '普通預金' })}
                          onCommit={(v) => patchPayment(i, { creditAccount: v as '普通預金' })}
                          accounts={accountsList}
                          onCreate={addAccountLocal}
                          dense
                        />
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-semibold text-slate-900 tabular-nums">
                        {r.paymentEntry.amount != null ? `¥${r.paymentEntry.amount.toLocaleString()}` : '—'}
                      </td>
                      <td
                        className={`px-2 py-2 text-xs text-slate-500 break-words ${r.paymentEntry.transaction.sourceFileIndex != null ? 'cursor-pointer hover:text-sky-600' : ''}`}
                        onClick={() => r.paymentEntry && showTransactionPdf(r.paymentEntry.transaction)}
                        title={r.paymentEntry.description}
                      >
                        {r.paymentEntry.description}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          r.paymentEntry.matchStatus === 'auto' ? 'bg-lime-100 text-lime-600' : 'bg-amber-100 text-amber-600'
                        }`}>
                          {r.paymentEntry.matchStatus === 'auto' ? `自動 ${Math.round(r.paymentEntry.matchScore * 100)}%` : `要確認 ${Math.round(r.paymentEntry.matchScore * 100)}%`}
                        </span>
                      </td>
                    </tr>
                  )}
                  {r.withholdingPaymentEntry && (
                    <tr className={`${rowBg} bg-amber-50/20 hover:bg-amber-50/40`}>
                      <td className="px-3 py-2">
                        <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">源泉納付</span>
                      </td>
                      <td className="px-3 py-2 text-xs font-mono text-slate-500">
                        {`${r.withholdingPaymentEntry.date.slice(0,4)}/${r.withholdingPaymentEntry.date.slice(4,6)}/${r.withholdingPaymentEntry.date.slice(6,8)}`}
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">{r.withholdingPaymentEntry.debitAccount}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs font-medium text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md">{r.withholdingPaymentEntry.creditAccount}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-semibold text-slate-900 tabular-nums">
                        {r.withholdingPaymentEntry.amount != null ? `¥${r.withholdingPaymentEntry.amount.toLocaleString()}` : '—'}
                      </td>
                      <td
                        className={`px-2 py-2 text-xs text-slate-500 break-words ${r.withholdingPaymentEntry.transaction.sourceFileIndex != null ? 'cursor-pointer hover:text-sky-600' : ''}`}
                        onClick={() => r.withholdingPaymentEntry && showTransactionPdf(r.withholdingPaymentEntry.transaction)}
                        title={r.withholdingPaymentEntry.description}
                      >
                        {r.withholdingPaymentEntry.description}
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-lime-100 text-lime-600">自動</span>
                      </td>
                    </tr>
                  )}
                  {!isRegistered && (
                    <tr key={`add-${i}`} className="bg-slate-50/40">
                      <td colSpan={9} className="px-2 py-1 text-left border-b-2 border-slate-100">
                        <button
                          type="button"
                          onClick={() => addAccrualLine(i)}
                          className="text-[10px] text-sky-600 hover:text-sky-800 border border-dashed border-sky-300 hover:border-sky-500 rounded px-2 py-0.5 ml-10"
                          title="この仕訳グループに計上行を追加"
                        >
                          + 行を追加
                        </button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── 入出金明細ビュー ─────────────────────────────────────────────────────

interface BankTxAccount {
  uploadId: string;
  fileName: string;
  bankName: string;
  accountNumber: string;
  createdAt: string;
  transactions: Array<{
    index: number;
    transactionDate: string;
    description: string;
    debit: number | null;
    credit: number | null;
    matched: boolean;
    matchedJournalDescription?: string;
  }>;
}

function BankTransactionsView({
  clientId,
  clientName,
  accountsList,
  addAccountLocal,
  onRefreshLedger,
}: {
  clientId: string | null;
  clientName: string | null;
  accountsList: AccountOption[];
  addAccountLocal: (name: string, reading?: string, sub_category?: string) => Promise<AccountOption | null>;
  onRefreshLedger: () => void;
}) {
  const [accounts, setAccounts] = useState<BankTxAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unmatched' | 'matched'>('all');
  // 未反映行の科目割り当て
  const [txAccounts, setTxAccounts] = useState<Record<string, string>>({});
  const [txDescriptions, setTxDescriptions] = useState<Record<string, string>>({});
  const [selectedTx, setSelectedTx] = useState<Set<string>>(new Set());
  const [bulkAccount, setBulkAccount] = useState('');
  const [registering, setRegistering] = useState(false);

  const fetchData = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/bank-transactions?clientId=${clientId}`);
      if (!res.ok) throw new Error('取得失敗');
      const data = await res.json();
      setAccounts(data.accounts ?? []);
      if (data.accounts?.length > 0 && !selectedUploadId) {
        setSelectedUploadId(data.accounts[0].uploadId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得失敗');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const currentAccount = accounts.find((a) => a.uploadId === selectedUploadId);
  const filteredTx = currentAccount?.transactions.filter((t) => {
    if (filter === 'unmatched') return !t.matched;
    if (filter === 'matched') return t.matched;
    return true;
  }) ?? [];

  const unmatchedCount = currentAccount?.transactions.filter((t) => !t.matched).length ?? 0;
  const matchedCount = currentAccount?.transactions.filter((t) => t.matched).length ?? 0;

  const handleBulkApply = () => {
    if (!bulkAccount) return;
    const next = { ...txAccounts };
    for (const key of selectedTx) {
      next[key] = bulkAccount;
    }
    setTxAccounts(next);
  };

  const handleRegister = async () => {
    if (!clientId || selectedTx.size === 0) return;
    const entries: Array<{
      uploadId: string;
      transactionDate: string;
      amount: number;
      description: string;
      debitAccount: string;
      creditAccount: string;
    }> = [];

    for (const key of selectedTx) {
      const account = txAccounts[key];
      if (!account) continue;
      const [uploadId, idxStr] = key.split('::');
      const tx = accounts.find((a) => a.uploadId === uploadId)?.transactions[Number(idxStr)];
      if (!tx) continue;

      const isDebit = (tx.debit ?? 0) > 0; // 出金=費用
      entries.push({
        uploadId,
        transactionDate: tx.transactionDate,
        amount: tx.debit ?? tx.credit ?? 0,
        description: txDescriptions[key] || tx.description,
        debitAccount: isDebit ? account : '普通預金',
        creditAccount: isDebit ? '普通預金' : account,
      });
    }

    if (entries.length === 0) {
      alert('科目が設定されていない行があります');
      return;
    }

    setRegistering(true);
    try {
      const res = await fetch('/api/bank-transactions/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, entries }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '登録失敗');
      alert(`${data.inserted} 件の仕訳を登録しました`);
      setSelectedTx(new Set());
      setTxAccounts({});
      setTxDescriptions({});
      fetchData();
      onRefreshLedger();
    } catch (e) {
      alert(e instanceof Error ? e.message : '登録失敗');
    } finally {
      setRegistering(false);
    }
  };

  if (!clientId) {
    return <p className="text-xs text-slate-400 text-center py-8">法人を選択してください</p>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-base font-semibold text-slate-900 tracking-tight">
              入出金明細 {clientName && <span className="text-sky-500">· {clientName}</span>}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">通帳OCRデータの入出金を確認し、証票なしの取引に科目を割り当てて仕訳登録できます</p>
          </div>
          <button
            onClick={fetchData}
            className="text-xs text-sky-500 hover:text-sky-600 font-medium"
          >
            更新
          </button>
        </div>

        {loading ? (
          <p className="text-xs text-slate-400 py-8 text-center">読み込み中...</p>
        ) : error ? (
          <p className="text-xs text-red-500 py-4">{error}</p>
        ) : accounts.length === 0 ? (
          <p className="text-xs text-slate-400 py-8 text-center">通帳OCRデータがありません。「仕訳実行」タブで通帳をアップロードしてください。</p>
        ) : (
          <>
            {/* 口座選択 */}
            <div className="flex flex-wrap gap-2 mb-4">
              {accounts.map((a) => (
                <button
                  key={a.uploadId}
                  onClick={() => { setSelectedUploadId(a.uploadId); setSelectedTx(new Set()); }}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                    selectedUploadId === a.uploadId
                      ? 'border-sky-300 bg-sky-50 text-sky-700 font-semibold'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {a.bankName || '不明'} {a.accountNumber ? `(${a.accountNumber})` : ''} · {a.transactions.length}件
                </button>
              ))}
            </div>

            {currentAccount && (
              <>
                {/* フィルタ + サマリ */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex items-center gap-1 bg-slate-50 rounded-lg p-0.5">
                    {([
                      { key: 'all' as const, label: `全て(${currentAccount.transactions.length})` },
                      { key: 'unmatched' as const, label: `未反映(${unmatchedCount})` },
                      { key: 'matched' as const, label: `反映済(${matchedCount})` },
                    ]).map((f) => (
                      <button
                        key={f.key}
                        onClick={() => setFilter(f.key)}
                        className={`text-[11px] px-2.5 py-1 rounded-md transition-all ${
                          filter === f.key ? 'bg-white shadow-sm text-slate-800 font-semibold' : 'text-slate-400 hover:text-slate-600'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400">{currentAccount.fileName}</p>
                </div>

                {/* 一括科目選択バー */}
                {selectedTx.size > 0 && (
                  <div className="flex items-center gap-2 mb-3 bg-sky-50 border border-sky-200 rounded-xl px-4 py-2.5">
                    <span className="text-xs text-sky-700 font-semibold whitespace-nowrap">{selectedTx.size}件選択中</span>
                    <div className="flex-1 max-w-[200px]">
                      <AccountCombobox
                        value={bulkAccount}
                        onChange={setBulkAccount}
                        accounts={accountsList}
                        onCreate={addAccountLocal}
                        placeholder="一括科目"
                        dense
                      />
                    </div>
                    <button
                      onClick={handleBulkApply}
                      disabled={!bulkAccount}
                      className="text-xs bg-sky-500 text-white font-semibold rounded-lg px-3 py-1.5 hover:bg-sky-600 disabled:opacity-40 transition-all"
                    >
                      一括適用
                    </button>
                    <button
                      onClick={handleRegister}
                      disabled={registering}
                      className="text-xs bg-lime-600 text-white font-semibold rounded-lg px-3 py-1.5 hover:bg-lime-700 disabled:opacity-40 transition-all"
                    >
                      {registering ? '登録中...' : '仕訳登録'}
                    </button>
                  </div>
                )}

                {/* テーブル */}
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider">
                        <th className="px-2 py-2 w-8">
                          <input
                            type="checkbox"
                            checked={filteredTx.filter((t) => !t.matched).length > 0 && filteredTx.filter((t) => !t.matched).every((t) => selectedTx.has(`${selectedUploadId}::${t.index}`))}
                            onChange={(e) => {
                              const next = new Set(selectedTx);
                              for (const t of filteredTx) {
                                if (t.matched) continue;
                                const key = `${selectedUploadId}::${t.index}`;
                                e.target.checked ? next.add(key) : next.delete(key);
                              }
                              setSelectedTx(next);
                            }}
                            className="cursor-pointer"
                          />
                        </th>
                        <th className="px-2 py-2 text-left">状態</th>
                        <th className="px-2 py-2 text-left">日付</th>
                        <th className="px-2 py-2 text-left">摘要</th>
                        <th className="px-2 py-2 text-right">出金</th>
                        <th className="px-2 py-2 text-right">入金</th>
                        <th className="px-2 py-2 text-left min-w-[160px]">勘定科目</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {filteredTx.map((t) => {
                        const key = `${selectedUploadId}::${t.index}`;
                        return (
                          <tr key={key} className={`${t.matched ? 'bg-lime-50/30' : selectedTx.has(key) ? 'bg-sky-50/40' : 'hover:bg-slate-50/30'}`}>
                            <td className="px-2 py-1.5 text-center">
                              {!t.matched ? (
                                <input
                                  type="checkbox"
                                  checked={selectedTx.has(key)}
                                  onChange={() => {
                                    const next = new Set(selectedTx);
                                    next.has(key) ? next.delete(key) : next.add(key);
                                    setSelectedTx(next);
                                  }}
                                  className="cursor-pointer"
                                />
                              ) : (
                                <svg className="w-3.5 h-3.5 text-lime-500 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                              )}
                            </td>
                            <td className="px-2 py-1.5">
                              {t.matched ? (
                                <span className="text-[10px] bg-lime-100 text-lime-700 px-1.5 py-0.5 rounded-full font-medium">反映済</span>
                              ) : (
                                <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">未反映</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 font-mono text-slate-600 whitespace-nowrap">
                              {t.transactionDate ? `${t.transactionDate.slice(0,4)}/${t.transactionDate.slice(4,6)}/${t.transactionDate.slice(6,8)}` : '—'}
                            </td>
                            <td className="px-2 py-1.5 text-slate-700 truncate max-w-[200px]" title={t.description}>
                              {t.description || '—'}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-red-600 font-medium">
                              {t.debit ? `¥${t.debit.toLocaleString()}` : ''}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-blue-600 font-medium">
                              {t.credit ? `¥${t.credit.toLocaleString()}` : ''}
                            </td>
                            <td className="px-2 py-1.5">
                              {t.matched ? (
                                <span className="text-[11px] text-slate-400">{t.matchedJournalDescription ?? '—'}</span>
                              ) : (
                                <AccountCombobox
                                  value={txAccounts[key] ?? ''}
                                  onChange={(v) => setTxAccounts((prev) => ({ ...prev, [key]: v }))}
                                  accounts={accountsList}
                                  onCreate={addAccountLocal}
                                  placeholder="科目を選択"
                                  dense
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {filteredTx.length === 0 && (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">該当する取引がありません</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
