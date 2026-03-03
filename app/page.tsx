'use client';

import { useState, useRef, useCallback, useEffect, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import type { User } from '@supabase/supabase-js';

// ─── 型定義（既存ロジックと同じ） ────────────────────────────────────────────

interface InvoiceResult {
  index: number;
  pageStart: number;
  pageEnd: number;
  date: string;
  requesterName: string;
  taxIncludedAmount: number | null;
  fileName: string;
  pdfBase64: string;
  sourceFile: string;
}

interface ProcessResult {
  invoices: InvoiceResult[];
  totalPages: number;
  processedFiles: number;
}

// ─── ユーティリティ（既存ロジックと同じ） ──────────────────────────────────

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

// ─── 請求書テーブル行 ─────────────────────────────────────────────────────────

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
      {/* # */}
      <td className="px-5 py-4 text-slate-300 font-mono text-xs tabular-nums">
        {String(invoice.index).padStart(2, '0')}
      </td>

      {/* ページ */}
      <td className="px-5 py-4">
        <span className="text-[11px] font-mono text-slate-400 bg-slate-100 px-2 py-1 rounded-md tracking-wide">
          {invoice.pageStart === invoice.pageEnd
            ? `p${invoice.pageStart}`
            : `p${invoice.pageStart}–${invoice.pageEnd}`}
        </span>
      </td>

      {/* 日付 */}
      <td className="px-5 py-4">
        <span
          className={`text-sm font-medium tracking-wide ${
            isUnknownDate ? 'text-amber-400' : 'text-slate-700'
          }`}
        >
          {isUnknownDate ? '—' : invoice.date}
        </span>
      </td>

      {/* 請求者名 */}
      <td className="px-5 py-4 max-w-[200px]">
        <span
          className={`text-sm block truncate ${
            isUnknownName ? 'text-amber-400' : 'text-slate-800 font-medium'
          }`}
        >
          {isUnknownName ? '—' : invoice.requesterName}
        </span>
      </td>

      {/* 税込金額 */}
      <td className="px-5 py-4 text-right">
        {invoice.taxIncludedAmount != null ? (
          <span className="text-base font-semibold text-slate-900 tabular-nums tracking-tight">
            ¥{invoice.taxIncludedAmount.toLocaleString()}
          </span>
        ) : (
          <span className="text-amber-400 text-sm">—</span>
        )}
      </td>

      {/* ファイル名（lg以上で表示） */}
      <td className="px-5 py-4 hidden lg:table-cell">
        <span className="text-[11px] text-slate-300 font-mono truncate block max-w-[180px]">
          {invoice.fileName}
        </span>
      </td>

      {/* DLボタン */}
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

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function Home() {
  const router = useRouter();
  const supabase = createClient();

  // ─── State（既存ロジックと同じ） ───────────────────────────────────────────
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [processingIndex, setProcessingIndex] = useState(0);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // undefined = 初期ロード中 / null = ゲスト / User = ログイン済み
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [guestLimitReached, setGuestLimitReached] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (!data.user) {
        const count = parseInt(localStorage.getItem('guestUseCount') || '0');
        if (count >= GUEST_MAX_USES) setGuestLimitReached(true);
      }
    });
  }, []);

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
    if (files.length === 0) return;

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
      const allInvoices: InvoiceResult[] = [];
      let totalPages = 0;

      for (let i = 0; i < files.length; i++) {
        setProcessingIndex(i + 1);
        const file = files[i];

        const formData = new FormData();
        formData.append('pdf', file);

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
      }

      if (isGuest) {
        const count = parseInt(localStorage.getItem('guestUseCount') || '0');
        localStorage.setItem('guestUseCount', String(count + 1));
        if (count + 1 >= GUEST_MAX_USES) setGuestLimitReached(true);
      }

      setResult({ invoices: allInvoices, totalPages, processedFiles: files.length });
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

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  // ファイルごとに請求書をグループ化
  const invoicesByFile: Record<string, InvoiceResult[]> = result
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
          <div className="flex items-center gap-3">
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
            <div>
              <p className="text-sm font-semibold text-slate-900 leading-tight tracking-tight">
                Invoice OCR
              </p>
              <p className="text-[10px] text-slate-400 leading-tight tracking-widest uppercase">
                AI-Powered PDF Splitter
              </p>
            </div>
          </div>

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
            <button
              onClick={handleSignOut}
              className="text-xs text-slate-400 border border-slate-200 rounded-xl
                px-4 py-2 hover:bg-slate-50 hover:text-slate-600
                transition-all duration-200 tracking-wide"
            >
              サインアウト
            </button>
          )}
        </div>
      </header>

      {/* ─── メインコンテンツ ──────────────────────────────────────────────── */}
      <main className="max-w-[900px] mx-auto px-4 sm:px-6 py-10 sm:py-14 relative space-y-6">

        {/* キャッチコピー（初期表示のみ） */}
        {files.length === 0 && !result && !loading && (
          <div className="text-center pb-4">
            <h2 className="text-2xl sm:text-[2rem] font-light text-slate-800 tracking-tight leading-snug">
              複数の請求書PDFを
              <span className="text-sky-400 font-semibold"> AI </span>
              で自動整理
            </h2>
            <p className="text-sm text-slate-400 mt-2 tracking-wider">
              アップロードするだけで、1件1ファイルに分割・命名まで完了
            </p>
          </div>
        )}

        {/* ─── アップロードセクション ─────────────────────────────────────── */}
        {!result && (
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
                        {files.length > 1
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
              AIが請求書を解析しています
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
        {result && (
          <section className="space-y-4">

            {/* サマリーバー */}
            <div
              className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm
                flex flex-wrap items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3">
                {/* 成功アイコン */}
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
                    {result.invoices.length} 件の請求書を検出
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5 tracking-wide">
                    {result.processedFiles > 1
                      ? `${result.processedFiles}件のPDF · 計${result.totalPages}ページを処理`
                      : `${result.totalPages}ページ · ${files[0]?.name}`}
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
                  ZIPで一括DL
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
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="px-5 py-4 text-left text-[10px] font-semibold
                        text-slate-300 uppercase tracking-widest w-10">
                        #
                      </th>
                      <th className="px-5 py-4 text-left text-[10px] font-semibold
                        text-slate-300 uppercase tracking-widest">
                        Page
                      </th>
                      <th className="px-5 py-4 text-left text-[10px] font-semibold
                        text-slate-300 uppercase tracking-widest">
                        Date
                      </th>
                      <th className="px-5 py-4 text-left text-[10px] font-semibold
                        text-slate-300 uppercase tracking-widest">
                        Requester
                      </th>
                      <th className="px-5 py-4 text-right text-[10px] font-semibold
                        text-slate-300 uppercase tracking-widest">
                        Amount
                      </th>
                      <th className="px-5 py-4 text-left text-[10px] font-semibold
                        text-slate-300 uppercase tracking-widest hidden lg:table-cell">
                        File
                      </th>
                      <th className="px-5 py-4 text-center text-[10px] font-semibold
                        text-slate-300 uppercase tracking-widest w-16">
                        DL
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {result.processedFiles > 1
                      ? Object.entries(invoicesByFile).map(([sourceFile, invoices]) => (
                          <Fragment key={sourceFile}>
                            {/* ソースファイル区切り行 */}
                            <tr className="bg-slate-50/50">
                              <td
                                colSpan={7}
                                className="px-5 py-2.5 text-xs text-slate-400 font-medium tracking-wide"
                              >
                                <span className="inline-flex items-center gap-1.5">
                                  <IconFile className="w-3.5 h-3.5" />
                                  {sourceFile}
                                </span>
                              </td>
                            </tr>
                            {invoices.map((invoice) => (
                              <InvoiceRow
                                key={invoice.index}
                                invoice={invoice}
                                onDownload={() => handleDownloadOne(invoice)}
                              />
                            ))}
                          </Fragment>
                        ))
                      : result.invoices.map((invoice) => (
                          <InvoiceRow
                            key={invoice.index}
                            invoice={invoice}
                            onDownload={() => handleDownloadOne(invoice)}
                          />
                        ))}
                  </tbody>
                </table>
              </div>

              {/* テーブルフッター：ファイル名形式の説明 */}
              <div className="px-5 py-3 border-t border-slate-50 bg-slate-50/30">
                <p className="text-[10px] text-slate-300 tracking-widest uppercase">
                  File format :{' '}
                  <code className="bg-white border border-slate-100 px-1.5 py-0.5 rounded-md
                    font-mono text-slate-400 normal-case tracking-normal">
                    日付_請求者名_税込金額.pdf
                  </code>
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ─── 使い方ガイド（初期表示のみ） ────────────────────────────────── */}
        {files.length === 0 && !result && !loading && (
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
      <footer className="relative max-w-[900px] mx-auto px-4 sm:px-6 py-8">
        <p className="text-center text-[10px] text-slate-300 tracking-widest uppercase">
          Invoice OCR · Powered by Claude AI · © {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
}
