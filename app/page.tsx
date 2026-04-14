'use client';

import { useState, useRef, useCallback, useEffect, useMemo, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import type { User } from '@supabase/supabase-js';
import type { OcrMode } from '@/lib/ocr/types';
import type { MatchResult, MatchSummary, VoucherInput, TransactionInput } from '@/lib/ocr/journal-matcher';

// ─── 型定義 ────────────────────────────────────────────────────────────────

interface ClientItem {
  id: string;
  name: string;
  client_type: string;
  industry: string | null;
  company_code: string | null;
  legal_name: string | null;
  short_name: string | null;
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
  // 法人請求書フィールド
  date?: string;
  requesterName?: string;
  taxIncludedAmount?: number | null;
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
  description: string;
  tax_type: string;
  vendor_name: string;
  match_status: string;
  created_at: string;
  updated_at: string;
  locked: boolean;
  ocr_upload_id: string | null;
}

async function openJournalPdf(entryId: string): Promise<void> {
  try {
    const res = await fetch(`/api/journal-pdf?entryId=${entryId}`);
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
      <td className="px-5 py-4 hidden lg:table-cell">
        <span className="text-[11px] text-slate-300 font-mono truncate block max-w-[180px]">
          {invoice.fileName}
        </span>
      </td>
      <td className="px-5 py-4 text-center">
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
        <span className="text-[11px] text-slate-300 font-mono truncate block max-w-[180px]">
          {invoice.fileName}
        </span>
      </td>
      <td className="px-5 py-4 text-center">
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
  const [isAdmin, setIsAdmin] = useState(false);
  const [guestLimitReached, setGuestLimitReached] = useState(false);
  const [usageInfo, setUsageInfo] = useState<{ count: number; limit: number } | null>(null);

  // ─── クライアント管理 State ─────────────────────────────────────────────────
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [showClientModal, setShowClientModal] = useState(false);
  const [newClientForm, setNewClientForm] = useState({ company_code: '', name: '', legal_name: '', short_name: '' });
  const [clientSaving, setClientSaving] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [editingClientForm, setEditingClientForm] = useState({ company_code: '', name: '', legal_name: '', short_name: '' });
  const [clientError, setClientError] = useState<string | null>(null);

  // ─── 自動仕訳モード専用 State ─────────────────────────────────────────────
  const [bankFiles, setBankFiles] = useState<File[]>([]);
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([]);
  const [bankOcr, setBankOcr] = useState<{ transactions: TransactionInput[]; bankName: string; accountNumber: string } | null>(null);
  const [invoiceOcr, setInvoiceOcr] = useState<{ vouchers: VoucherInput[]; count: number } | null>(null);
  const [journalMatchResult, setJournalMatchResult] = useState<{ results: MatchResult[]; summary: MatchSummary } | null>(null);
  const [bankProcessing, setBankProcessing] = useState(false);
  const [invoiceProcessing, setInvoiceProcessing] = useState(false);
  const [matchProcessing, setMatchProcessing] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);
  const bankFileInputRef = useRef<HTMLInputElement>(null);
  const invoiceFileInputRef = useRef<HTMLInputElement>(null);
  const [bankDragOver, setBankDragOver] = useState(false);
  const [invoiceDragOver, setInvoiceDragOver] = useState(false);
  const [accountingMethod, setAccountingMethod] = useState<'accrual' | 'cash'>('accrual');
  // 明細合計 ≠ 税込合計 のエラーをユーザーに通知してスクショ提出を依頼するモーダル
  const [lineSumMismatch, setLineSumMismatch] = useState<null | {
    fileName: string;
    taxIncludedAmount: number;
    linesSum: number;
    lines: Array<{ debitAccount: string; amountInclTax: number; description: string }>;
  }>(null);

  // ─── 未照合トランザクションの勘定科目選択 State ───────────────────────────
  const [unmatchedTxAccounts, setUnmatchedTxAccounts] = useState<Record<number, string>>({});
  const [unmatchedTxDescriptions, setUnmatchedTxDescriptions] = useState<Record<number, string>>({});
  const [unmatchedSelected, setUnmatchedSelected] = useState<Set<number>>(new Set());
  const [unmatchedBulkAccount, setUnmatchedBulkAccount] = useState<string>('');
  const [unmatchedBulkDescription, setUnmatchedBulkDescription] = useState<string>('');

  // ─── 勘定科目マスタ State（起動時に1回だけロード） ────────────────────────
  interface AccountItem { id: string; name: string; reading: string; category: string; sub_category?: string | null; display_order?: number | null }
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
  interface VendorItem { id: string; name: string; normalized_key: string; reading: string }
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

  // ─── 仕訳日記帳サブビュー State ────────────────────────────────────────────
  const [journalSubView, setJournalSubView] = useState<'execute' | 'unmatched' | 'ledger' | 'balance' | 'master'>('execute');
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[] | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [ledgerAccountFilter, setLedgerAccountFilter] = useState<string>('');
  const [closedUntil, setClosedUntil] = useState<string | null>(null);

  const fetchLedger = useCallback(async () => {
    setLedgerLoading(true);
    setLedgerError(null);
    try {
      const url = selectedClientId
        ? `/api/journal-ledger?clientId=${encodeURIComponent(selectedClientId)}`
        : '/api/journal-ledger';
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '取得失敗');
      setLedgerEntries(data.entries);
      setClosedUntil(data.closedUntil ?? null);
    } catch (e) {
      setLedgerError(e instanceof Error ? e.message : '日記帳の取得に失敗しました');
    } finally {
      setLedgerLoading(false);
    }
  }, [selectedClientId]);

  useEffect(() => {
    if (mode === 'journal-entry' && (journalSubView === 'ledger' || journalSubView === 'balance')) {
      fetchLedger();
    }
  }, [mode, journalSubView, fetchLedger]);

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
    // 楽観的更新: 直ちに再フェッチせず、ローカル state だけ更新するのが理想だが
    // シンプルに静かに再フェッチ（行単位で再描画されるが入力中の他フィールドには干渉しない）
    fetchLedger();
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
    fetchLedger();
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
    fetchLedger();
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
    fetchLedger();
  };

  // ─── PDFプレビューモーダル State ───────────────────────────────────────────
  const [pdfPreview, setPdfPreview] = useState<{ url: string; name: string } | null>(null);

  const showVoucherPdf = (voucher: VoucherInput) => {
    if (voucher.sourceFileIndex == null) return;
    const file = invoiceFiles[voucher.sourceFileIndex];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPdfPreview({ url, name: voucher.sourceFileName || file.name });
  };

  const showTransactionPdf = (tx: TransactionInput) => {
    if (tx.sourceFileIndex == null) return;
    const file = bankFiles[tx.sourceFileIndex];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPdfPreview({ url, name: tx.sourceFileName || file.name });
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

  const openReportModal = () => {
    setReportComment('');
    setReportScreenshot(null);
    setReportMessage(null);
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

  const addPdfFiles = (
    incoming: FileList | File[] | null,
    setter: React.Dispatch<React.SetStateAction<File[]>>
  ) => {
    const sel = Array.from(incoming || []).filter((f) => f.type === 'application/pdf');
    if (sel.length === 0) return false;
    setter((prev) => {
      const ex = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...sel.filter((f) => !ex.has(f.name + f.size))];
    });
    return true;
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (!data.user) {
        const count = parseInt(localStorage.getItem('guestUseCount') || '0');
        if (count >= GUEST_MAX_USES) setGuestLimitReached(true);
      } else {
        fetch('/api/me')
          .then((r) => r.json())
          .then((d) => setIsAdmin(!!d.isAdmin))
          .catch(() => {});
        fetch('/api/usage')
          .then((r) => r.json())
          .then((d) => { if (d.count != null) setUsageInfo({ count: d.count, limit: d.limit }); })
          .catch(() => {});
        // クライアント一覧を取得
        fetch('/api/clients')
          .then((r) => r.json())
          .then((d) => { if (d.clients) setClients(d.clients); })
          .catch(() => {});
        // 勘定科目・取引先マスタを起動時に1回ロード
        fetchAccounts();
        fetchVendors();
      }
    });
  }, [fetchAccounts, fetchVendors]);

  const isGuest = user === null;

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
      (f) => f.type === 'application/pdf'
    );
    if (dropped.length > 0) {
      setFiles((prev) => {
        const existing = new Set(prev.map((f) => f.name + f.size));
        return [...prev, ...dropped.filter((f) => !existing.has(f.name + f.size))];
      });
      setResult(null);
      setError(null);
    } else {
      setError('PDFファイルのみ対応しています');
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []).filter(
      (f) => f.type === 'application/pdf'
    );
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

    if (isGuest) {
      const count = parseInt(localStorage.getItem('guestUseCount') || '0');
      if (count >= GUEST_MAX_USES) {
        setGuestLimitReached(true);
        return;
      }
    }

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
        for (let i = 0; i < files.length; i++) {
          setProcessingIndex(i + 1);
          const file = files[i];
          const formData = new FormData();
          formData.append('pdf', file);
          formData.append('mode', mode);
          formData.append('sessionId', sessionId);
          if (selectedClientId) formData.append('clientId', selectedClientId);
          const res = await fetch('/api/process-pdf', { method: 'POST', body: formData });
          const data = await res.json();
          if (!res.ok) throw new Error(`${file.name}: ${data.error || 'エラーが発生しました'}`);
          if (i === 0) { bankName = data.bankName; accountNumber = data.accountNumber; }
          allTransactions.push(...(data.transactions || []).map((t: Omit<BankTransactionRow, 'sourceFile'>) => ({ ...t, sourceFile: file.name })));
          totalPages += data.totalPages;
          if (data.usage) {
            bankCostJpy += data.usage.costJpy || 0;
            bankInTok += data.usage.inputTokens || 0;
            bankOutTok += data.usage.outputTokens || 0;
          }
        }
        if (isGuest) {
          const count = parseInt(localStorage.getItem('guestUseCount') || '0');
          localStorage.setItem('guestUseCount', String(count + 1));
          if (count + 1 >= GUEST_MAX_USES) setGuestLimitReached(true);
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
        const file = files[i];

        const formData = new FormData();
        formData.append('pdf', file);
        formData.append('mode', mode);
        formData.append('sessionId', sessionId);
        if (selectedClientId) formData.append('clientId', selectedClientId);

        const res = await fetch('/api/process-pdf', {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(`${file.name}: ${data.error || 'エラーが発生しました'}`);
        }

        const invoicesWithSource = data.invoices.map(
          (inv: Omit<InvoiceResult, 'sourceFile'>) => ({
            ...inv,
            index: allInvoices.length + inv.index,
            sourceFile: file.name,
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

      if (isGuest) {
        const count = parseInt(localStorage.getItem('guestUseCount') || '0');
        localStorage.setItem('guestUseCount', String(count + 1));
        if (count + 1 >= GUEST_MAX_USES) setGuestLimitReached(true);
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
    const blob = base64ToBlob(invoice.pdfBase64, 'application/pdf');
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
      zip.file(invoice.fileName, base64ToBlob(invoice.pdfBase64, 'application/pdf'));
    });
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, '請求書_分割済み.zip');
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
      const allTx: TransactionInput[] = [];
      let bankName = '不明';
      let accountNumber = '不明';
      const bankSessionId = crypto.randomUUID();
      for (let fi = 0; fi < bankFiles.length; fi++) {
        const file = bankFiles[fi];
        const fd = new FormData();
        fd.append('pdf', file);
        fd.append('mode', 'bank-statement');
        fd.append('sessionId', bankSessionId);
        if (selectedClientId) fd.append('clientId', selectedClientId);
        const res = await fetch('/api/process-pdf', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(`${file.name}: ${data.error}`);
        if (bankName === '不明') { bankName = data.bankName; accountNumber = data.accountNumber; }
        const uploadId: string | null = data.uploadId ?? null;
        allTx.push(...(data.transactions || []).map((t: { date: string; description: string; debit: number | null; credit: number | null }) => ({
          transactionDate: t.date,
          description: t.description,
          debit: t.debit,
          credit: t.credit,
          sourceFileIndex: fi,
          sourceFileName: file.name,
          ocrUploadId: uploadId,
        })));
      }
      setBankOcr({ transactions: allTx, bankName, accountNumber });
    } catch (e) {
      setJournalError(e instanceof Error ? e.message : '通帳OCRエラー');
    } finally {
      setBankProcessing(false);
    }
  };

  // ─── 自動仕訳モード: 請求書OCR ───────────────────────────────────────────
  const handleInvoiceProcess = async () => {
    if (invoiceFiles.length === 0) return;
    setInvoiceProcessing(true);
    setJournalError(null);
    try {
      const allVouchers: VoucherInput[] = [];
      const invoiceSessionId = crypto.randomUUID();
      for (let fi = 0; fi < invoiceFiles.length; fi++) {
        const file = invoiceFiles[fi];
        const fd = new FormData();
        fd.append('pdf', file);
        // 自動仕訳モードでは1PDF=1請求書として扱う（自動分割しない）
        fd.append('mode', 'invoice-single');
        fd.append('sessionId', invoiceSessionId);
        if (selectedClientId) fd.append('clientId', selectedClientId);
        const res = await fetch('/api/process-pdf', { method: 'POST', body: fd });
        const data = await res.json();
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
          // OCRが返した明細行を VoucherLine[] として引き継ぐ。
          // lines が無い場合は matcher 側で単一行にフォールバックする。
          const ocrLines: { debitAccount: string; amountInclTax: number; taxType: string; description: string }[] =
            Array.isArray(inv.lines) ? inv.lines : [];
          const hasMultipleLines = ocrLines.length > 1;
          allVouchers.push({
            vendorName: inv.requesterName || '',
            invoiceDate: inv.date || '不明',
            amountInclTax: inv.taxIncludedAmount,
            // 単一行の場合は従来どおりヘッダに代表値を入れる
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
      setInvoiceOcr({ vouchers: allVouchers, count: allVouchers.length });
    } catch (e) {
      setJournalError(e instanceof Error ? e.message : '請求書OCRエラー');
    } finally {
      setInvoiceProcessing(false);
    }
  };

  // ─── 自動仕訳モード: 照合実行 ─────────────────────────────────────────────
  const handleRunMatch = async () => {
    if (!bankOcr || !invoiceOcr) return;
    setMatchProcessing(true);
    setJournalError(null);
    try {
      const res = await fetch('/api/match-journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: bankOcr.transactions, vouchers: invoiceOcr.vouchers, clientId: selectedClientId, accountingMethod }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setJournalMatchResult(data);
    } catch (e) {
      setJournalError(e instanceof Error ? e.message : '照合エラー');
    } finally {
      setMatchProcessing(false);
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
  };

  const handleDownloadJournal = () => {
    if (!journalMatchResult) return;
    const header = ['種別', '日付', '借方科目', '貸方科目', '金額', '摘要', '消費税区分', '照合ステータス', '照合スコア'];
    const rows: string[][] = [];
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
    }
    // 未照合トランザクションも CSV に追加（勘定科目が選択されているもののみ）
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
    downloadCsv([header, ...rows], '自動仕訳.csv');
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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '追加失敗');
      setClients((prev) => [...prev, data.client]);
      setNewClientForm({ company_code: '', name: '', legal_name: '', short_name: '' });
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
            <button
              onClick={() => router.push('/login')}
              className="text-xs font-medium text-sky-500 border border-sky-200 rounded-xl
                px-4 py-2 hover:bg-sky-50 hover:border-sky-300
                transition-all duration-200 tracking-wide"
            >
              Googleでサインイン
            </button>
          ) : (
            <div className="flex items-center gap-2">
              {isAdmin && (
                <button
                  onClick={() => router.push('/history')}
                  className="text-xs font-medium text-sky-600 border border-sky-200 rounded-xl
                    px-4 py-2 hover:bg-sky-50 hover:border-sky-300
                    transition-all duration-200 tracking-wide"
                >
                  履歴
                </button>
              )}
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
        (mode === 'journal-entry' && (journalSubView === 'ledger' || journalSubView === 'master' || journalSubView === 'unmatched')) || mode === 'financial-statement' ? 'max-w-[1280px]' : 'max-w-[900px]'
      }`}>

        {/* ─── モード切替タブ ──────────────────────────────────────────────── */}
        {!result && !loading && (
          <div className="flex justify-center">
            <div className="inline-flex bg-slate-100 rounded-2xl p-1 gap-1 flex-wrap justify-center">
              {(
                [
                  { key: 'invoice', label: '法人請求書' },
                  { key: 'tax-return', label: '確定申告' },
                  { key: 'bank-statement', label: '通帳OCR' },
                  { key: 'journal-entry', label: '自動仕訳' },
                  { key: 'financial-statement', label: '決算書' },
                ] as const
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setMode(key); setFiles([]); setError(null); }}
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

        {/* ─── クライアント選択バー（ログインユーザーのみ） ────────────────── */}
        {!isGuest && user && !result && !loading && (
          <div className="flex justify-center">
            <div className="flex items-center gap-3 bg-white/70 border border-slate-100 rounded-2xl px-5 py-3 shadow-sm">
              <span className="text-xs text-slate-500 tracking-wide whitespace-nowrap">クライアント</span>
              <select
                value={selectedClientId || ''}
                onChange={(e) => setSelectedClientId(e.target.value || null)}
                className="text-sm bg-white border border-slate-200 rounded-xl px-3 py-1.5
                  text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300
                  transition-all duration-200 min-w-[160px]"
              >
                <option value="">未選択（個人）</option>
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
                  申告書・決算書・明細書をまとめてアップロード → 1書類1ファイルに分割
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

        {/* ─── 自動仕訳モード専用UI ────────────────────────────────────────── */}
        {mode === 'journal-entry' && (
          <section className="space-y-5">
            {/* サブビュー切替: 実行 / 日記帳 / 残高 / マスタ */}
            <div className="flex items-center justify-center gap-1 bg-slate-100/60 rounded-xl p-1 max-w-xl mx-auto">
              {([
                { key: 'execute', label: '仕訳実行' },
                { key: 'unmatched', label: '未照合' },
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

            {journalError && journalSubView === 'execute' && (
              <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-3 text-sm text-red-600">
                {journalError}
              </div>
            )}

            {journalSubView === 'unmatched' ? (
              <UnmatchedView
                transactions={journalMatchResult?.summary.unmatchedTransactions ?? []}
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
                addAccountLocal={addAccountLocal}
                onShowPdf={showTransactionPdf}
                onGoExecute={() => setJournalSubView('execute')}
              />
            ) : journalSubView === 'ledger' ? (
              <LedgerView
                entries={ledgerEntries}
                loading={ledgerLoading}
                error={ledgerError}
                accountFilter={ledgerAccountFilter}
                setAccountFilter={setLedgerAccountFilter}
                onRefresh={fetchLedger}
                clientName={clients.find((c) => c.id === selectedClientId)?.name ?? null}
                closedUntil={closedUntil}
                onSaveField={handleSaveField}
                onBulkDelete={handleBulkDelete}
                onClose={handleCloseAt}
                onReopen={handleReopenClosing}
                accountsList={accountsList}
                addAccountLocal={addAccountLocal}
                vendorsList={vendorsList}
                addVendorLocal={addVendorLocal}
              />
            ) : journalSubView === 'balance' ? (
              <BalanceView
                entries={ledgerEntries}
                loading={ledgerLoading}
                error={ledgerError}
                clientName={clients.find((c) => c.id === selectedClientId)?.name ?? null}
              />
            ) : journalSubView === 'master' ? (
              <MasterView
                accountsList={accountsList}
                vendorsList={vendorsList}
                onReloadAccounts={fetchAccounts}
                onReloadVendors={fetchVendors}
                onCreateAccount={addAccountLocal}
                onCreateVendor={addVendorLocal}
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
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
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
                      onClick={handleDownloadJournal}
                      className="inline-flex items-center gap-1.5 text-xs text-white bg-lime-500 rounded-xl px-4 py-2.5 font-semibold hover:bg-lime-600 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 shadow-sm shadow-lime-200/60 tracking-wide"
                    >
                      <IconArchive className="w-3.5 h-3.5" />
                      仕訳CSVをDL
                    </button>
                  </div>
                </div>

                {/* 仕訳テーブル */}
                <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[760px]">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className="px-4 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">種別</th>
                          <th className="px-4 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">Date</th>
                          <th className="px-4 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">借方</th>
                          <th className="px-4 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">貸方</th>
                          <th className="px-4 py-4 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">金額</th>
                          <th className="px-4 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">摘要</th>
                          <th className="px-4 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">照合</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {journalMatchResult.results.map((r, i) => (
                          <Fragment key={i}>
                            {/* 費用計上行（複数明細対応：1請求書から複数行になることがある） */}
                            {r.accrualEntries.map((ae, lineIdx) => (
                              <tr
                                key={`a-${i}-${lineIdx}`}
                                className={`hover:bg-sky-50/30 transition-colors ${ae.voucher.sourceFileIndex != null ? 'cursor-pointer' : ''}`}
                                onClick={() => showVoucherPdf(ae.voucher)}
                                title={ae.voucher.sourceFileIndex != null ? 'クリックで元PDF表示' : ''}
                              >
                                <td className="px-4 py-3">
                                  <span className="text-[10px] bg-sky-100 text-sky-600 px-2 py-0.5 rounded-full font-medium">
                                    費用計上{r.accrualEntries.length > 1 ? `(${lineIdx + 1}/${r.accrualEntries.length})` : ''}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-xs font-mono text-slate-500">
                                  {ae.date === '不明' ? '—' : `${ae.date.slice(0,4)}/${ae.date.slice(4,6)}/${ae.date.slice(6,8)}`}
                                </td>
                                <td className="px-4 py-3">
                                  <span className="text-xs font-medium text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md">{ae.debitAccount}</span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className="text-xs font-medium text-slate-600 bg-slate-50 px-2 py-0.5 rounded-md">{ae.creditAccount}</span>
                                </td>
                                <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900 tabular-nums">
                                  {ae.amount != null ? `¥${ae.amount.toLocaleString()}` : '—'}
                                </td>
                                <td className="px-4 py-3 text-xs text-slate-500 max-w-[160px] truncate">{ae.description || '—'}</td>
                                <td className="px-4 py-3">
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                    ae.matchStatus === 'auto' ? 'bg-lime-100 text-lime-600'
                                    : ae.matchStatus === 'needs_review' ? 'bg-amber-100 text-amber-600'
                                    : 'bg-red-100 text-red-500'
                                  }`}>
                                    {ae.matchStatus === 'auto' ? '自動照合' : ae.matchStatus === 'needs_review' ? '要確認' : '未照合'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                            {/* 支払消込行 */}
                            {r.paymentEntry && (
                              <tr
                                className={`hover:bg-lime-50/30 transition-colors bg-slate-50/30 ${r.paymentEntry.transaction.sourceFileIndex != null ? 'cursor-pointer' : ''}`}
                                onClick={() => r.paymentEntry && showTransactionPdf(r.paymentEntry.transaction)}
                                title={r.paymentEntry.transaction.sourceFileIndex != null ? 'クリックで元PDF表示' : ''}
                              >
                                <td className="px-4 py-3">
                                  <span className="text-[10px] bg-lime-100 text-lime-700 px-2 py-0.5 rounded-full font-medium">支払消込</span>
                                </td>
                                <td className="px-4 py-3 text-xs font-mono text-slate-500">
                                  {`${r.paymentEntry.date.slice(0,4)}/${r.paymentEntry.date.slice(4,6)}/${r.paymentEntry.date.slice(6,8)}`}
                                </td>
                                <td className="px-4 py-3">
                                  <span className="text-xs font-medium text-slate-600 bg-slate-50 px-2 py-0.5 rounded-md">{r.paymentEntry.debitAccount}</span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className="text-xs font-medium text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md">{r.paymentEntry.creditAccount}</span>
                                </td>
                                <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900 tabular-nums">
                                  {r.paymentEntry.amount != null ? `¥${r.paymentEntry.amount.toLocaleString()}` : '—'}
                                </td>
                                <td className="px-4 py-3 text-xs text-slate-500 max-w-[160px] truncate">{r.paymentEntry.description}</td>
                                <td className="px-4 py-3">
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                    r.paymentEntry.matchStatus === 'auto' ? 'bg-lime-100 text-lime-600' : 'bg-amber-100 text-amber-600'
                                  }`}>
                                    {r.paymentEntry.matchStatus === 'auto' ? `自動 ${Math.round(r.paymentEntry.matchScore * 100)}%` : `要確認 ${Math.round(r.paymentEntry.matchScore * 100)}%`}
                                  </span>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-5 py-3 border-t border-slate-50 bg-slate-50/30">
                    <p className="text-[10px] text-slate-300 tracking-widest uppercase">
                      Output: CSV · 費用計上 / 支払消込 · 借方 / 貸方 / 金額 / 摘要 / 照合スコア
                    </p>
                  </div>
                </div>

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
              /* 2パネルアップロード */
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
                    accept="application/pdf"
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
                    <div className="flex items-center gap-2 text-xs text-lime-600 bg-lime-50 rounded-xl px-3 py-2">
                      <IconCheck className="w-4 h-4" />
                      {bankOcr.transactions.length}件の取引を抽出済み
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
                    accept="application/pdf"
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
                    PDFをドラッグ＆ドロップ または クリックで選択
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

            {/* 経理方式トグル */}
            {!journalMatchResult && bankOcr && invoiceOcr && (
              <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
                <p className="text-sm font-semibold text-slate-700 tracking-tight mb-3">経理方式</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                    <span className="text-sm font-semibold text-slate-700">発生主義</span>
                    <p className="text-[11px] text-slate-400 mt-1 leading-relaxed pl-5">
                      請求書日で費用計上 → 支払日で未払費用を取り崩し
                    </p>
                  </label>
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
                    <span className="text-sm font-semibold text-slate-700">現金主義</span>
                    <p className="text-[11px] text-slate-400 mt-1 leading-relaxed pl-5">
                      支払日に費用 / 普通預金 を直接計上（未払費用は使わない）
                    </p>
                  </label>
                </div>
              </div>
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
        {mode === 'financial-statement' && (
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
                  aria-label="PDFファイルをドラッグ＆ドロップ、またはクリックして選択"
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
                    accept=".pdf,application/pdf"
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
                          PDFをドラッグ＆ドロップ
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
                      : `${result.invoices.length} 件の${result.mode === 'tax-return' ? '書類' : '請求書'}を検出`}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5 tracking-wide">
                    {result.processedFiles > 1
                      ? `${result.processedFiles}件のPDF · 計${result.totalPages}ページを処理`
                      : `${result.totalPages}ページ · ${files[0]?.name}`}
                  </p>
                  <p className="text-[11px] text-amber-600 mt-1 tracking-wide font-mono">
                    API実コスト: ¥{result.totalCostJpy.toFixed(2)}
                    <span className="text-slate-400 ml-2">
                      (in {result.totalInputTokens.toLocaleString()} / out {result.totalOutputTokens.toLocaleString()} tok)
                    </span>
                  </p>
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
                            <th className="px-5 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">Date</th>
                            <th className="px-5 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">Requester</th>
                            <th className="px-5 py-4 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">Amount</th>
                          </>
                        )}
                        <th className="px-5 py-4 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest hidden lg:table-cell">File</th>
                        <th className="px-5 py-4 text-center text-[10px] font-semibold text-slate-300 uppercase tracking-widest w-16">DL</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {result.processedFiles > 1
                        ? Object.entries(invoicesByFile).map(([sourceFile, invoices]) => (
                            <Fragment key={sourceFile}>
                              <tr className="bg-slate-50/50">
                                <td colSpan={result.mode === 'tax-return' ? 8 : 7}
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
                            {result.mode === 'tax-return' ? '年度_氏名_書類種別.pdf' : '日付_請求者名_税込金額.pdf'}
                          </code>
                        </>}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ─── 使い方ガイド（請求書/通帳モードの初期表示のみ） ───────────── */}
        {mode !== 'journal-entry' && files.length === 0 && !result && !loading && (
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            {[
              {
                num: '01',
                title: 'PDFをアップロード',
                desc: '複数の請求書がまとまったPDFをドロップ。複数ファイルを同時に指定することも可能です。',
                accent: 'text-sky-400',
                border: 'hover:border-sky-200',
              },
              {
                num: '02',
                title: 'AI OCRで自動解析',
                desc: 'Claude AIが各請求書の境界・日付・請求者名・税込金額を自動で抽出します。',
                accent: 'text-sky-400',
                border: 'hover:border-sky-200',
              },
              {
                num: '03',
                title: '分割PDFをダウンロード',
                desc: '日付_請求者名_金額で命名された1請求書1PDFを個別またはZIPで一括ダウンロード。',
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

      {/* ─── エラー報告モーダル ───────────────────────────────────────── */}
      {showReportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4"
          onClick={() => !reportSending && setShowReportModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            onPaste={handleReportPaste}
          >
            <div className="px-6 pt-6 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <IconAlertCircle className="w-4 h-4 text-amber-500" />
                <h3 className="text-base font-semibold text-slate-900 tracking-tight">エラー報告</h3>
              </div>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                スクショとコメントを管理者に送信します。<br />
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
    </div>
  );
}

// ─── 共通ユーティリティ ────────────────────────────────────────────────────

function formatDateYmd(s: string): string {
  if (!s || s === '不明') return '—';
  if (s.length === 8) return `${s.slice(0,4)}/${s.slice(4,6)}/${s.slice(6,8)}`;
  return s;
}

function computeBalances(entries: LedgerEntry[]) {
  const accountSet = new Set<string>();
  const accountBalances: Record<string, { debit: number; credit: number }> = {};
  for (const e of entries) {
    accountSet.add(e.debit_account);
    accountSet.add(e.credit_account);
    const amt = e.amount ?? 0;
    if (!accountBalances[e.debit_account]) accountBalances[e.debit_account] = { debit: 0, credit: 0 };
    if (!accountBalances[e.credit_account]) accountBalances[e.credit_account] = { debit: 0, credit: 0 };
    accountBalances[e.debit_account].debit += amt;
    accountBalances[e.credit_account].credit += amt;
  }
  const accounts = Array.from(accountSet).sort();

  const payableByVendor: Record<string, { accrued: number; paid: number }> = {};
  for (const e of entries) {
    const amt = e.amount ?? 0;
    if (e.credit_account === '未払費用') {
      const v = e.vendor_name || '(不明)';
      if (!payableByVendor[v]) payableByVendor[v] = { accrued: 0, paid: 0 };
      payableByVendor[v].accrued += amt;
    }
    if (e.debit_account === '未払費用') {
      const v = e.vendor_name || '(不明)';
      if (!payableByVendor[v]) payableByVendor[v] = { accrued: 0, paid: 0 };
      payableByVendor[v].paid += amt;
    }
  }
  const vendorRows = Object.entries(payableByVendor)
    .map(([vendor, v]) => ({ vendor, accrued: v.accrued, paid: v.paid, balance: v.accrued - v.paid }))
    .sort((a, b) => b.balance - a.balance);

  return { accounts, accountBalances, vendorRows };
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
  addAccountLocal: (name: string, reading?: string, sub_category?: string) => Promise<AccountOption | null> | void;
  onShowPdf: (tx: TransactionInput) => void;
  onGoExecute: () => void;
}) {
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

  const assignedCount = transactions.filter((_, i) => accounts[i]).length;

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
  entries,
  loading,
  error,
  accountFilter,
  setAccountFilter,
  onRefresh,
  clientName,
  closedUntil,
  onSaveField,
  onBulkDelete,
  onClose,
  onReopen,
  accountsList,
  addAccountLocal,
  vendorsList,
  addVendorLocal,
}: {
  entries: LedgerEntry[] | null;
  loading: boolean;
  error: string | null;
  accountFilter: string;
  setAccountFilter: (v: string) => void;
  onRefresh: () => void;
  clientName: string | null;
  closedUntil: string | null;
  onSaveField: (id: string, patch: Partial<LedgerEntry>) => Promise<void>;
  onBulkDelete: (ids: string[]) => Promise<void>;
  onClose: (closedUntil: string) => void;
  onReopen: () => void;
  accountsList: AccountOption[];
  addAccountLocal: (name: string, reading?: string, sub_category?: string) => Promise<AccountOption | null>;
  vendorsList: AccountOption[];
  addVendorLocal: (name: string, reading?: string) => Promise<AccountOption | null>;
}) {
  const [closingInput, setClosingInput] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
  if (!entries || entries.length === 0) {
    return (
      <div className="bg-white border border-slate-100 rounded-2xl p-10 text-center">
        <p className="text-sm text-slate-400">
          {clientName ? `${clientName} の` : ''}仕訳データはまだありません
        </p>
        <p className="text-xs text-slate-300 mt-2">「仕訳実行」タブで照合するとここに記録されます</p>
      </div>
    );
  }

  const accountSet = new Set<string>();
  for (const e of entries) {
    accountSet.add(e.debit_account);
    accountSet.add(e.credit_account);
  }
  const accounts = Array.from(accountSet).sort();

  const filtered = accountFilter
    ? entries.filter((e) => e.debit_account === accountFilter || e.credit_account === accountFilter)
    : entries;

  const editableFiltered = filtered.filter((e) => !e.locked);
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
    <div className="space-y-5">
      {/* ヘッダ */}
      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-slate-900 tracking-tight">
            仕訳日記帳 {clientName && <span className="text-sky-500">· {clientName}</span>}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            全 {entries.length} 件 · {filtered.length} 件表示
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
            onClick={onRefresh}
            className="text-xs text-slate-500 border border-slate-200 rounded-xl px-3 py-2 hover:bg-slate-50"
          >
            再読み込み
          </button>
        </div>
      </div>

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
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/40">
          <p className="text-sm font-semibold text-slate-700 tracking-tight">仕訳明細</p>
        </div>
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col style={{ width: '40px' }} />   {/* チェック */}
            <col style={{ width: '128px' }} />  {/* 日付 */}
            <col style={{ width: '76px' }} />   {/* 種別 */}
            <col style={{ width: '44px' }} />   {/* 証憑 */}
            <col style={{ width: '160px' }} />  {/* 借方 */}
            <col style={{ width: '160px' }} />  {/* 貸方 */}
            <col style={{ width: '120px' }} />  {/* 金額 */}
            <col style={{ width: '180px' }} />  {/* 取引先 */}
            <col />                              {/* 摘要 */}
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
              <th className="px-2 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">貸方</th>
              <th className="px-2 py-3 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">金額</th>
              <th className="px-2 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">取引先</th>
              <th className="px-2 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">摘要</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.map((e) => (
              <EditableRow
                key={`${e.id}_${e.updated_at}`}
                entry={e}
                selected={selectedIds.has(e.id)}
                onToggleSelect={() => toggleOne(e.id)}
                onSaveField={onSaveField}
                accountsList={accountsList}
                addAccountLocal={addAccountLocal}
                vendorsList={vendorsList}
                addVendorLocal={addVendorLocal}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── インライン編集行 ──────────────────────────────────────────────────────

function EditableRow({
  entry,
  selected,
  onToggleSelect,
  onSaveField,
  accountsList,
  addAccountLocal,
  vendorsList,
  addVendorLocal,
}: {
  entry: LedgerEntry;
  selected: boolean;
  onToggleSelect: () => void;
  onSaveField: (id: string, patch: Partial<LedgerEntry>) => Promise<void>;
  accountsList: AccountOption[];
  addAccountLocal: (name: string, reading?: string, sub_category?: string) => Promise<AccountOption | null>;
  vendorsList: AccountOption[];
  addVendorLocal: (name: string, reading?: string) => Promise<AccountOption | null>;
}) {
  const [date, setDate] = useState(entry.entry_date === '不明' ? '' : entry.entry_date);
  const [debitAccount, setDebitAccount] = useState(entry.debit_account);
  const [creditAccount, setCreditAccount] = useState(entry.credit_account);
  const [amount, setAmount] = useState(entry.amount != null ? String(entry.amount) : '');
  const [vendorName, setVendorName] = useState(entry.vendor_name);
  const [description, setDescription] = useState(entry.description);

  const dateInputValue = date.length === 8
    ? `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`
    : '';

  const saveIfChanged = (patch: Partial<LedgerEntry>) => {
    if (entry.locked) return;
    onSaveField(entry.id, patch);
  };

  if (entry.locked) {
    return (
      <tr className="bg-amber-50/20">
        <td className="px-2 py-2 text-center">
          <IconLock className="w-3 h-3 text-amber-500 mx-auto" />
        </td>
        <td className="px-2 py-2 text-xs font-mono text-slate-500">{formatDateYmd(entry.entry_date)}</td>
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
          {entry.ocr_upload_id ? (
            <button
              type="button"
              onClick={() => openJournalPdf(entry.id)}
              className="text-sky-500 hover:text-sky-700 transition-colors"
              title="元PDFを開く"
              aria-label="元PDFを開く"
            >
              <IconFile className="w-4 h-4 mx-auto" />
            </button>
          ) : (
            <span className="text-slate-200 text-[10px]">—</span>
          )}
        </td>
        <td className="px-2 py-2 text-xs text-slate-600">{entry.debit_account}</td>
        <td className="px-2 py-2 text-xs text-slate-600">{entry.credit_account}</td>
        <td className="px-2 py-2 text-right text-sm font-semibold text-slate-900 tabular-nums">
          {entry.amount != null ? `¥${Number(entry.amount).toLocaleString()}` : '—'}
        </td>
        <td className="px-2 py-2 text-xs text-slate-600 truncate" title={entry.vendor_name}>{entry.vendor_name}</td>
        <td className="px-2 py-2 text-xs text-slate-500 truncate" title={entry.description}>{entry.description}</td>
      </tr>
    );
  }

  return (
    <tr className={`${selected ? 'bg-sky-50/40' : 'hover:bg-slate-50/30'}`}>
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
        {entry.ocr_upload_id ? (
          <button
            type="button"
            onClick={() => openJournalPdf(entry.id)}
            className="text-sky-500 hover:text-sky-700 transition-colors"
            title="元PDFを開く"
            aria-label="元PDFを開く"
          >
            <IconFile className="w-4 h-4 mx-auto" />
          </button>
        ) : (
          <span className="text-slate-200 text-[10px]">—</span>
        )}
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
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => {
            const next = amount === '' ? null : Number(amount);
            if (next !== entry.amount) saveIfChanged({ amount: next });
          }}
          className="w-full text-sm text-right tabular-nums border border-transparent hover:border-slate-200 focus:border-sky-400 rounded px-1.5 py-1 focus:outline-none bg-transparent"
        />
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
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            if (description !== entry.description) saveIfChanged({ description });
          }}
          className="w-full text-xs border border-transparent hover:border-slate-200 focus:border-sky-400 rounded px-1.5 py-1 focus:outline-none bg-transparent"
        />
      </td>
    </tr>
  );
}

// ─── 残高ビュー（勘定科目別 + 未払費用 取引先別） ───────────────────────────

function BalanceView({
  entries,
  loading,
  error,
  clientName,
}: {
  entries: LedgerEntry[] | null;
  loading: boolean;
  error: string | null;
  clientName: string | null;
}) {
  if (loading) {
    return (
      <div className="bg-white border border-slate-100 rounded-2xl p-10 text-center">
        <div className="w-8 h-8 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin mx-auto" />
        <p className="text-xs text-slate-400 mt-3">読み込み中...</p>
      </div>
    );
  }
  if (error) {
    return <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-4 text-sm text-red-600">{error}</div>;
  }
  if (!entries || entries.length === 0) {
    return (
      <div className="bg-white border border-slate-100 rounded-2xl p-10 text-center">
        <p className="text-sm text-slate-400">
          {clientName ? `${clientName} の` : ''}残高データはまだありません
        </p>
      </div>
    );
  }

  const { accounts, accountBalances, vendorRows } = computeBalances(entries);

  return (
    <div className="space-y-5">
      {/* 未払費用 取引先別残高 */}
      {vendorRows.length > 0 && (
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-sky-50/40">
            <p className="text-sm font-semibold text-sky-700 tracking-tight">
              未払費用 取引先別残高 {clientName && <span className="text-sky-400">· {clientName}</span>}
            </p>
            <p className="text-[10px] text-sky-500/70 mt-0.5">貸方計上 − 借方消込 = 未払残高</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-slate-50">
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">取引先</th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">計上額</th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">支払済</th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">残高</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {vendorRows.map((row) => (
                  <tr key={row.vendor} className="hover:bg-sky-50/30">
                    <td className="px-4 py-3 text-xs text-slate-700 font-medium">{row.vendor}</td>
                    <td className="px-4 py-3 text-right text-xs text-slate-500 tabular-nums">¥{row.accrued.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-xs text-slate-500 tabular-nums">¥{row.paid.toLocaleString()}</td>
                    <td className={`px-4 py-3 text-right text-sm font-semibold tabular-nums ${row.balance > 0 ? 'text-amber-600' : row.balance < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                      ¥{row.balance.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 勘定科目別 集計 */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/40">
          <p className="text-sm font-semibold text-slate-700 tracking-tight">勘定科目別 集計</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b border-slate-50">
                <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">勘定科目</th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">借方合計</th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">貸方合計</th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">差額（借−貸）</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {accounts.map((acc) => {
                const b = accountBalances[acc] ?? { debit: 0, credit: 0 };
                const diff = b.debit - b.credit;
                return (
                  <tr key={acc} className="hover:bg-slate-50/40">
                    <td className="px-4 py-3 text-xs text-slate-700 font-medium">{acc}</td>
                    <td className="px-4 py-3 text-right text-xs text-slate-500 tabular-nums">¥{b.debit.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-xs text-slate-500 tabular-nums">¥{b.credit.toLocaleString()}</td>
                    <td className={`px-4 py-3 text-right text-xs font-semibold tabular-nums ${diff > 0 ? 'text-sky-600' : diff < 0 ? 'text-lime-600' : 'text-slate-400'}`}>
                      ¥{diff.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── 勘定科目コンボボックス（補完つきインライン入力） ────────────────────────

interface AccountOption { id?: string; name: string; reading?: string; category?: string; sub_category?: string | null; display_order?: number | null }

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
  const q = value.trim().toLowerCase();
  const candidates = q
    ? accounts.filter((a) =>
        a.name.toLowerCase().startsWith(q) ||
        (a.reading || '').toLowerCase().startsWith(q)
      ).slice(0, 12)
    : accounts.slice(0, 12);

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

function MasterView({
  accountsList,
  vendorsList,
  onReloadAccounts,
  onReloadVendors,
  onCreateAccount,
  onCreateVendor,
}: {
  accountsList: AccountOption[];
  vendorsList: AccountOption[];
  onReloadAccounts: () => void;
  onReloadVendors: () => void;
  onCreateAccount: (name: string, reading?: string, sub_category?: string) => Promise<AccountOption | null>;
  onCreateVendor: (name: string, reading?: string) => Promise<AccountOption | null>;
}) {
  const [newAcc, setNewAcc] = useState({ name: '', reading: '', sub_category: '' });
  const [newVen, setNewVen] = useState({ name: '', reading: '' });
  const [accSearch, setAccSearch] = useState('');
  const [venSearch, setVenSearch] = useState('');

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
    if (!q) return sortedAccounts;
    return sortedAccounts.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      (a.reading ?? '').toLowerCase().includes(q) ||
      (a.sub_category ?? '').toLowerCase().includes(q)
    );
  }, [sortedAccounts, accSearch]);

  const filteredVendors = useMemo(() => {
    const q = venSearch.trim().toLowerCase();
    if (!q) return vendorsList;
    return vendorsList.filter((v) =>
      v.name.toLowerCase().includes(q) ||
      (v.reading ?? '').toLowerCase().includes(q)
    );
  }, [vendorsList, venSearch]);

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
              {filteredAccounts.map((a) => (
                <MasterRow
                  key={a.id}
                  item={a}
                  onSave={(patch) => patchAccount(a.id!, patch)}
                  onDelete={() => deleteAccount(a.id!)}
                  showSubCategory
                  duplicate={accDupNames.has(a.name.trim().toLowerCase())}
                />
              ))}
              {filteredAccounts.length === 0 && (
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
  showSubCategory = false,
  duplicate = false,
}: {
  item: AccountOption;
  onSave: (patch: Partial<AccountOption>) => void;
  onDelete: () => void;
  showSubCategory?: boolean;
  duplicate?: boolean;
}) {
  const [name, setName] = useState(item.name);
  const [reading, setReading] = useState(item.reading ?? '');
  // sub_category は親 props 由来だと「PATCH→reload」までの間に値が戻ってしまうので
  // 楽観更新するためにローカル state で持つ。props 側が変わったら同期する。
  const [subCategory, setSubCategory] = useState<string>(item.sub_category ?? '');
  useEffect(() => {
    setSubCategory(item.sub_category ?? '');
  }, [item.sub_category]);

  return (
    <tr className={`hover:bg-slate-50/30 ${duplicate ? 'bg-red-50/40' : ''}`}>
      <td className="px-4 py-2">
        <div className="flex items-center gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { if (name !== item.name) onSave({ name }); }}
            className="flex-1 text-xs border border-transparent hover:border-slate-200 focus:border-sky-400 rounded px-1.5 py-1 focus:outline-none bg-transparent"
          />
          {duplicate && (
            <span className="text-[9px] text-red-600 bg-red-100 rounded px-1 py-0.5 font-semibold shrink-0">重複</span>
          )}
        </div>
      </td>
      <td className="px-4 py-2" style={{ width: showSubCategory ? '28%' : '40%' }}>
        <input
          value={reading}
          onChange={(e) => setReading(e.target.value.toLowerCase())}
          onBlur={() => { if (reading !== (item.reading ?? '')) onSave({ reading }); }}
          placeholder="ローマ字"
          className="w-full text-[11px] font-mono border border-transparent hover:border-slate-200 focus:border-sky-400 rounded px-1.5 py-1 focus:outline-none bg-transparent text-slate-500"
        />
      </td>
      {showSubCategory && (
        <td className="px-2 py-2" style={{ width: '130px' }}>
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
      <td className="px-4 py-2 text-right" style={{ width: '80px' }}>
        <button
          onClick={onDelete}
          className="text-[10px] text-red-500 border border-red-200 rounded-md px-2 py-1 hover:bg-red-50"
        >
          削除
        </button>
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
  const [error, setError] = useState<string | null>(null);

  const [corporateTax, setCorporateTax] = useState<string>('0');

  // 新規期間追加
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPeriod, setNewPeriod] = useState({ name: '', start_date: '', end_date: '' });

  // 期編集（期首残高含む）
  const [editingPeriodId, setEditingPeriodId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; start_date: string; end_date: string; opening: { name: string; amount: string }[] }>({
    name: '', start_date: '', end_date: '', opening: [],
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
    try {
      const params = new URLSearchParams({
        start: selectedPeriod.start_date,
        end: selectedPeriod.end_date,
        periodId: selectedPeriod.id,
        corporateTax: String(Number(corporateTax) || 0),
      });
      if (selectedClientId) params.set('clientId', selectedClientId);
      const res = await fetch(`/api/financial-statement?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '集計失敗');
      setResult(data);
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
        .fs-title { text-align: center; letter-spacing: 0.6em; font-size: 14pt; font-weight: normal; padding-bottom: 4px; border-bottom: 1px solid #000; display: inline-block; padding-left: 0.6em; }
        .fs-cover-title { text-align: center; letter-spacing: 1.2em; font-size: 22pt; padding-bottom: 8px; border-bottom: 1px solid #000; display: inline-block; padding-left: 1.2em; }
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
                期首残高を編集
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
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 whitespace-nowrap">法人税等</span>
            <input
              type="number"
              value={corporateTax}
              onChange={(e) => setCorporateTax(e.target.value)}
              placeholder="0"
              className="text-sm w-32 border border-slate-200 rounded-xl px-3 py-2 text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300"
            />
            <span className="text-xs text-slate-400">円</span>
          </div>
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              placeholder="期の名前"
              className="text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400"
            />
            <input
              type="date"
              value={editForm.start_date}
              onChange={(e) => setEditForm({ ...editForm, start_date: e.target.value })}
              className="text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400"
            />
            <input
              type="date"
              value={editForm.end_date}
              onChange={(e) => setEditForm({ ...editForm, end_date: e.target.value })}
              className="text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400"
            />
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

      {/* 決算書本体（5ページ） */}
      {result && (
        <div className="fs-print-area">
          <DecisionReportPaper result={result} period={selectedPeriod ?? null} />
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
          <p className="text-[11px] text-red-600 mt-2">「期首残高を編集」→「+ 新規科目を追加」で対象科目を作成し、保存し直してください。</p>
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

function DecisionReportPaper({ result, period }: { result: FsResult; period: FiscalPeriod | null }) {
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

function PaperHeader({ title, legalName, dateLine, rightNote }: { title: string; legalName: string; dateLine: string; rightNote?: string }) {
  return (
    <div style={{ marginBottom: '6mm' }}>
      <div style={{ textAlign: 'center', marginBottom: '4mm' }}>
        <span className="fs-title">{title}</span>
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
      <PaperHeader title="貸　借　対　照　表" legalName={legalName} dateLine={`${formatJpDate(result.period.end)}　現在`} />
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
        title="損　益　計　算　書"
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
        title="販　売　費　及　び　一　般　管　理　費　内　訳　書"
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
        title="社　員　資　本　等　変　動　計　算　書"
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
