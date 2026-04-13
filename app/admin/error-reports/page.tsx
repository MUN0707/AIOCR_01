'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface ErrorReport {
  id: string;
  user_id: string | null;
  user_email: string | null;
  mode: string | null;
  comment: string;
  screenshot_path: string | null;
  screenshot_url: string | null;
  context: Record<string, unknown> | null;
  status: 'open' | 'in_progress' | 'resolved';
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  open: '未対応',
  in_progress: '対応中',
  resolved: '解決済',
};

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-red-100 text-red-700',
  in_progress: 'bg-amber-100 text-amber-700',
  resolved: 'bg-emerald-100 text-emerald-700',
};

export default function ErrorReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<ErrorReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/admin/error-reports');
      if (res.status === 403) {
        router.replace('/');
        return;
      }
      const data = await res.json();
      if (cancelled) return;
      if (res.ok) {
        setReports(data.reports);
      } else {
        setError(data.error || 'エラーが発生しました');
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router]);

  const handleStatusChange = async (id: string, status: ErrorReport['status']) => {
    const res = await fetch('/api/admin/error-reports', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    if (res.ok) {
      setReports((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    } else {
      const data = await res.json();
      setError(data.error || '更新失敗');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-sky-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sky-50">
      <header className="bg-white border-b border-sky-100 px-6 py-4 shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-sky-700">エラー報告一覧</h1>
            <p className="text-xs text-sky-400">利用者からの不具合報告</p>
          </div>
          <a href="/admin" className="text-sm text-sky-500 hover:text-sky-700 border border-sky-200 rounded-full px-4 py-1.5">
            管理者ダッシュボードへ
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700 text-sm">{error}</div>
        )}

        {reports.length === 0 ? (
          <div className="bg-white rounded-3xl border border-sky-100 p-10 text-center text-sky-300">
            エラー報告はありません
          </div>
        ) : (
          <div className="space-y-4">
            {reports.map((r) => (
              <div key={r.id} className="bg-white rounded-2xl border border-sky-100 shadow-sm p-5">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold px-3 py-1 rounded-full ${STATUS_STYLE[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                      {r.mode && (
                        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full">{r.mode}</span>
                      )}
                      <span className="text-xs text-slate-400">{new Date(r.created_at).toLocaleString('ja-JP')}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{r.user_email || 'ゲスト'}</p>
                  </div>
                  <div className="flex gap-1.5">
                    {(['open', 'in_progress', 'resolved'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => handleStatusChange(r.id, s)}
                        disabled={r.status === s}
                        className={`text-xs px-3 py-1.5 rounded-full font-bold transition-colors ${
                          r.status === s ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                </div>

                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{r.comment}</p>

                {r.screenshot_url && (
                  <div className="mt-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={r.screenshot_url}
                      alt="screenshot"
                      className="max-h-48 rounded-xl border border-slate-200 cursor-pointer hover:opacity-80"
                      onClick={() => setPreview(r.screenshot_url)}
                    />
                  </div>
                )}

                {r.context && (
                  <details className="mt-3">
                    <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">コンテキスト</summary>
                    <pre className="text-[10px] text-slate-500 bg-slate-50 rounded-lg p-3 mt-2 overflow-x-auto">
                      {JSON.stringify(r.context, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {preview && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/80 flex items-center justify-center p-6"
          onClick={() => setPreview(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="preview" className="max-w-full max-h-full rounded-xl" />
        </div>
      )}
    </div>
  );
}
