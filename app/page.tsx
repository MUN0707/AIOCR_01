'use client';

import { useState, useRef, useCallback, useEffect, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import type { User } from '@supabase/supabase-js';

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

const GUEST_MAX_USES = 1;

function InvoiceRow({
  invoice,
  onDownload,
}: {
  invoice: InvoiceResult;
  onDownload: () => void;
}) {
  return (
    <tr className="hover:bg-slate-50 transition-colors">
      <td className="px-5 py-4 text-slate-400 font-mono text-xs">{invoice.index}</td>
      <td className="px-5 py-4 text-slate-600 font-mono text-xs whitespace-nowrap">
        {invoice.pageStart === invoice.pageEnd
          ? `${invoice.pageStart}p`
          : `${invoice.pageStart}〜${invoice.pageEnd}p`}
      </td>
      <td className="px-5 py-4">
        <span
          className={`font-medium ${
            !invoice.date || invoice.date === '不明' ? 'text-amber-600' : 'text-slate-800'
          }`}
        >
          {invoice.date || '不明'}
        </span>
      </td>
      <td className="px-5 py-4">
        <span
          className={`font-medium ${
            !invoice.requesterName || invoice.requesterName === '不明'
              ? 'text-amber-600'
              : 'text-slate-800'
          }`}
        >
          {invoice.requesterName || '不明'}
        </span>
      </td>
      <td className="px-5 py-4 text-right">
        {invoice.taxIncludedAmount != null ? (
          <span className="font-semibold text-slate-800">
            ¥{invoice.taxIncludedAmount.toLocaleString()}
          </span>
        ) : (
          <span className="text-amber-600 font-medium">不明</span>
        )}
      </td>
      <td className="px-5 py-4">
        <span className="text-xs text-slate-400 font-mono break-all">{invoice.fileName}</span>
      </td>
      <td className="px-5 py-4 text-center">
        <button
          onClick={onDownload}
          className="px-3 py-1.5 rounded-lg bg-blue-100 text-blue-700 text-xs font-semibold hover:bg-blue-200 transition-colors"
        >
          DL
        </button>
      </td>
    </tr>
  );
}

export default function Home() {
  const router = useRouter();
  const supabase = createClient();

  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [processingIndex, setProcessingIndex] = useState(0);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // undefined = 初期ロード中, null = ゲスト, User = ログイン済み
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

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* ヘッダー */}
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📄</span>
            <div>
              <h1 className="text-xl font-bold text-slate-900">請求書 PDF 分割ツール</h1>
              <p className="text-sm text-slate-500">AI OCRで複数請求書PDFを自動解析・分割・命名</p>
            </div>
          </div>
          {user === undefined ? null : isGuest ? (
            <button
              onClick={() => router.push('/login')}
              className="text-sm text-blue-600 hover:text-blue-800 border border-blue-300 rounded-lg px-3 py-1.5 hover:bg-blue-50 transition-colors font-medium"
            >
              Googleでサインイン
            </button>
          ) : (
            <button
              onClick={handleSignOut}
              className="text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors"
            >
              サインアウト
            </button>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        {/* アップロードエリア */}
        {!result && (
          <section>
            {guestLimitReached ? (
              /* ゲスト上限到達 */
              <div className="border-2 border-dashed border-slate-300 rounded-2xl p-16 text-center bg-white">
                <div className="text-5xl mb-4">🔒</div>
                <p className="text-lg font-semibold text-slate-800">
                  無料お試しを使用済みです
                </p>
                <p className="text-sm text-slate-500 mt-2">
                  続けてご利用いただくにはGoogleアカウントでサインインしてください
                </p>
                <button
                  onClick={() => router.push('/login')}
                  className="mt-6 px-8 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
                >
                  Googleでサインイン
                </button>
              </div>
            ) : (
              <>
                {/* ドロップゾーン */}
                <div
                  className={`
                    relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer
                    transition-all duration-200
                    ${
                      isDragging
                        ? 'border-blue-500 bg-blue-50 scale-[1.01]'
                        : files.length > 0
                        ? 'border-emerald-400 bg-emerald-50'
                        : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50/50'
                    }
                  `}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => !loading && fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    multiple
                    className="hidden"
                    onChange={handleFileChange}
                    disabled={loading}
                  />

                  {files.length > 0 ? (
                    <div>
                      <div className="text-3xl mb-3">✅</div>
                      <p className="text-base font-semibold text-emerald-700 mb-4">
                        {files.length}件のPDFを選択中
                      </p>
                      <ul className="text-left max-w-lg mx-auto space-y-2">
                        {files.map((f, i) => (
                          <li
                            key={i}
                            className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 text-sm border border-emerald-200"
                          >
                            <span className="text-base">📄</span>
                            <span className="flex-1 truncate text-slate-700">{f.name}</span>
                            <span className="text-slate-400 text-xs shrink-0">
                              {(f.size / 1024 / 1024).toFixed(1)} MB
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveFile(i);
                              }}
                              className="text-slate-400 hover:text-red-500 transition-colors shrink-0 ml-1 text-base leading-none"
                              title="削除"
                            >
                              ✕
                            </button>
                          </li>
                        ))}
                      </ul>
                      {!loading && (
                        <p className="text-xs text-blue-500 mt-4">
                          クリックまたはドロップでPDFをさらに追加
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-6xl">📂</div>
                      <p className="text-lg font-semibold text-slate-700">
                        PDFをここにドラッグ＆ドロップ
                      </p>
                      <p className="text-sm text-slate-400">
                        またはクリックしてファイルを選択（複数選択可）
                      </p>
                      {isGuest && (
                        <p className="text-xs text-amber-700 bg-amber-50 inline-block px-3 py-1.5 rounded-full border border-amber-200 mt-1">
                          ゲストは1回まで無料でお試しいただけます
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* 処理ボタン */}
                <div className="mt-6 flex justify-center">
                  <button
                    onClick={handleProcess}
                    disabled={files.length === 0 || loading}
                    className={`
                      px-10 py-3.5 rounded-xl font-semibold text-base transition-all duration-200
                      ${
                        files.length === 0 || loading
                          ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                          : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-lg active:scale-95'
                      }
                    `}
                  >
                    {loading
                      ? '解析中...'
                      : files.length > 1
                      ? `${files.length}件のPDFを解析・分割する`
                      : 'AI OCRで解析・分割する'}
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {/* ローディング */}
        {loading && (
          <section className="bg-white rounded-2xl p-12 text-center shadow-sm border border-slate-100">
            <div className="flex justify-center mb-6">
              <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            </div>
            <p className="text-lg font-semibold text-slate-800">AIが請求書を解析中...</p>
            {files.length > 1 && processingIndex > 0 && (
              <p className="text-sm font-medium text-blue-600 mt-2">
                ファイル {processingIndex} / {files.length} を処理中
              </p>
            )}
            {processingIndex > 0 && files[processingIndex - 1] && (
              <p className="text-sm text-slate-500 mt-1 truncate max-w-sm mx-auto">
                {files[processingIndex - 1].name}
              </p>
            )}
            <p className="text-xs text-slate-400 mt-2">
              ページ数によっては1〜2分かかる場合があります
            </p>
          </section>
        )}

        {/* エラー */}
        {error && (
          <section className="bg-red-50 border border-red-200 rounded-2xl p-6">
            <div className="flex items-start gap-3">
              <span className="text-red-500 text-xl mt-0.5">⚠️</span>
              <div>
                <p className="font-semibold text-red-800">エラーが発生しました</p>
                <p className="text-sm text-red-700 mt-1 whitespace-pre-wrap">{error}</p>
              </div>
            </div>
            <button
              onClick={handleReset}
              className="mt-4 text-sm text-red-600 underline hover:no-underline"
            >
              最初からやり直す
            </button>
          </section>
        )}

        {/* 結果 */}
        {result && (
          <section className="space-y-5">
            {/* サマリーバー */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
              <div className="flex items-center gap-4">
                <span className="text-3xl">✅</span>
                <div>
                  <p className="font-bold text-slate-900 text-lg">
                    {result.invoices.length} 件の請求書を検出
                  </p>
                  <p className="text-sm text-slate-500">
                    {result.processedFiles > 1
                      ? `${result.processedFiles}件のPDF・計${result.totalPages}ページを処理`
                      : `元PDF: ${result.totalPages} ページ　|　ファイル: ${files[0]?.name}`}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleReset}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm hover:bg-slate-50 transition-colors"
                >
                  別ファイルを処理
                </button>
                <button
                  onClick={handleDownloadAll}
                  className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors"
                >
                  すべてZIPでDL
                </button>
              </div>
            </div>

            {/* ゲスト向けサインイン案内 */}
            {isGuest && (
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-blue-900">
                    🎉 無料お試し完了！サインインで継続利用できます
                  </p>
                  <p className="text-sm text-blue-700 mt-0.5">
                    Googleアカウントでサインインすると、サブスクリプション期間中は無制限にご利用いただけます
                  </p>
                </div>
                <button
                  onClick={() => router.push('/login')}
                  className="text-sm bg-blue-600 text-white rounded-lg px-5 py-2 hover:bg-blue-700 font-semibold transition-colors shrink-0"
                >
                  Googleでサインイン
                </button>
              </div>
            )}

            {/* 結果テーブル */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-10">
                      #
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      ページ
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      日付
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      請求者名
                    </th>
                    <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      税込金額
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      保存ファイル名
                    </th>
                    <th className="px-5 py-3.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      DL
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.processedFiles > 1
                    ? Object.entries(invoicesByFile).map(([sourceFile, invoices]) => (
                        <Fragment key={sourceFile}>
                          <tr className="bg-slate-50/80">
                            <td
                              colSpan={7}
                              className="px-5 py-2 text-xs font-semibold text-slate-500"
                            >
                              📄 {sourceFile}
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

            <p className="text-xs text-slate-400 text-center">
              ファイル名の形式：
              <code className="bg-slate-100 px-1.5 py-0.5 rounded">
                日付_請求者名_税込金額.pdf
              </code>
            </p>
          </section>
        )}

        {/* 使い方ガイド（初期表示のみ） */}
        {files.length === 0 && !result && !loading && (
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                icon: '📤',
                step: '1',
                title: 'PDFをアップロード',
                desc: '複数の請求書がまとまったPDFを選択（複数ファイル同時指定可）またはドロップ',
              },
              {
                icon: '🤖',
                step: '2',
                title: 'AI OCRで自動解析',
                desc: 'Claude AIが各請求書の境界・日付・請求者・税込金額を抽出',
              },
              {
                icon: '💾',
                step: '3',
                title: '分割PDFをダウンロード',
                desc: '日付_請求者名_金額で命名された1請求書1PDFを個別またはまとめてDL',
              },
            ].map((item) => (
              <div
                key={item.step}
                className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm"
              >
                <div className="text-3xl mb-3">{item.icon}</div>
                <div className="text-xs font-semibold text-blue-500 mb-1">STEP {item.step}</div>
                <p className="font-semibold text-slate-800 mb-2">{item.title}</p>
                <p className="text-sm text-slate-500 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
