'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface InvoiceResult {
  index: number;
  pageStart: number;
  pageEnd: number;
  date: string;
  requesterName: string;
  taxIncludedAmount: number | null;
  fileName: string;
  pdfBase64: string;
}

interface ProcessResult {
  invoices: InvoiceResult[];
  totalPages: number;
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

export default function Home() {
  const router = useRouter();
  const supabase = createClient();
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.type === 'application/pdf') {
      setFile(droppedFile);
      setResult(null);
      setError(null);
    } else if (droppedFile) {
      setError('PDFファイルのみ対応しています');
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setResult(null);
      setError(null);
    }
    e.target.value = '';
  };

  const handleProcess = async () => {
    if (!file) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('pdf', file);

      const res = await fetch('/api/process-pdf', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'エラーが発生しました');
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setLoading(false);
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
      const blob = base64ToBlob(invoice.pdfBase64, 'application/pdf');
      zip.file(invoice.fileName, blob);
    });

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, '請求書_分割済み.zip');
  };

  const handleReset = () => {
    setFile(null);
    setResult(null);
    setError(null);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

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
          <button
            onClick={handleSignOut}
            className="text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors"
          >
            サインアウト
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">

        {/* アップロードエリア */}
        {!result && (
          <section>
            <div
              className={`
                relative border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer
                transition-all duration-200
                ${isDragging
                  ? 'border-blue-500 bg-blue-50 scale-[1.01]'
                  : file
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
                className="hidden"
                onChange={handleFileChange}
                disabled={loading}
              />

              {file ? (
                <div className="space-y-2">
                  <div className="text-5xl">✅</div>
                  <p className="text-lg font-semibold text-emerald-700">{file.name}</p>
                  <p className="text-sm text-slate-500">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  {!loading && (
                    <p className="text-xs text-blue-500 mt-1">クリックでファイルを変更</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-6xl">📂</div>
                  <p className="text-lg font-semibold text-slate-700">
                    PDFをここにドラッグ＆ドロップ
                  </p>
                  <p className="text-sm text-slate-400">またはクリックしてファイルを選択</p>
                </div>
              )}
            </div>

            {/* 処理ボタン */}
            <div className="mt-6 flex justify-center">
              <button
                onClick={handleProcess}
                disabled={!file || loading}
                className={`
                  px-10 py-3.5 rounded-xl font-semibold text-base transition-all duration-200
                  ${!file || loading
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-lg active:scale-95'
                  }
                `}
              >
                {loading ? '解析中...' : 'AI OCRで解析・分割する'}
              </button>
            </div>
          </section>
        )}

        {/* ローディング */}
        {loading && (
          <section className="bg-white rounded-2xl p-12 text-center shadow-sm border border-slate-100">
            <div className="flex justify-center mb-6">
              <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            </div>
            <p className="text-lg font-semibold text-slate-800">AIが請求書を解析中...</p>
            <p className="text-sm text-slate-500 mt-2">
              Claude AI がPDFを読み取り、請求書の境界・日付・請求者・金額を抽出しています
            </p>
            <p className="text-xs text-slate-400 mt-1">
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
                    元PDF: {result.totalPages} ページ　|　ファイル: {file?.name}
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

            {/* 結果テーブル */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-10">#</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">ページ</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">日付</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">請求者名</th>
                    <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">税込金額</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">保存ファイル名</th>
                    <th className="px-5 py-3.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">DL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.invoices.map((invoice) => (
                    <tr key={invoice.index} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-4 text-slate-400 font-mono text-xs">
                        {invoice.index}
                      </td>
                      <td className="px-5 py-4 text-slate-600 font-mono text-xs whitespace-nowrap">
                        {invoice.pageStart === invoice.pageEnd
                          ? `${invoice.pageStart}p`
                          : `${invoice.pageStart}〜${invoice.pageEnd}p`}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`font-medium ${invoice.date === '不明' || !invoice.date ? 'text-amber-600' : 'text-slate-800'}`}>
                          {invoice.date || '不明'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`font-medium ${invoice.requesterName === '不明' || !invoice.requesterName ? 'text-amber-600' : 'text-slate-800'}`}>
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
                        <span className="text-xs text-slate-400 font-mono break-all">
                          {invoice.fileName}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <button
                          onClick={() => handleDownloadOne(invoice)}
                          className="px-3 py-1.5 rounded-lg bg-blue-100 text-blue-700 text-xs font-semibold hover:bg-blue-200 transition-colors"
                        >
                          DL
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 命名規則の説明 */}
            <p className="text-xs text-slate-400 text-center">
              ファイル名の形式：<code className="bg-slate-100 px-1.5 py-0.5 rounded">日付_請求者名_税込金額.pdf</code>
            </p>
          </section>
        )}

        {/* 使い方ガイド（初期表示のみ） */}
        {!file && !result && !loading && (
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { icon: '📤', step: '1', title: 'PDFをアップロード', desc: '複数の請求書がまとまったPDFファイルを選択またはドロップ' },
              { icon: '🤖', step: '2', title: 'AI OCRで自動解析', desc: 'Claude AIが各請求書の境界・日付・請求者・税込金額を抽出' },
              { icon: '💾', step: '3', title: '分割PDFをダウンロード', desc: '日付_請求者名_金額で命名された1請求書1PDFを個別またはまとめてDL' },
            ].map((item) => (
              <div key={item.step} className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
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
