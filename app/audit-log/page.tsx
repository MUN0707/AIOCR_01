'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { JournalSidebarNav } from '@/components/JournalSidebarNav';

interface ClientItem { id: string; name: string; short_name?: string | null }

interface AuditLog {
  id: string;
  entry_id: string;
  action: 'created' | 'updated' | 'deleted';
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  changed_at: string;
}

const ACTION_LABEL: Record<string, string> = { created: '作成', updated: '変更', deleted: '削除' };
// 監査アクションは「イベント」系の配色（emerald=追加 / amber=変更 / red=削除）。
// ロール色（violet/indigo/slate）とは色系統を分け、凡例の混同を防ぐ。
const ACTION_COLOR: Record<string, string> = {
  created: 'bg-emerald-100 text-emerald-700',
  updated: 'bg-amber-100 text-amber-700',
  deleted: 'bg-red-100 text-red-600',
};

function fmtDate(s: string) {
  return new Date(s).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function DataDiff({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  if (!before && !after) return null;
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return (
    <div className="mt-1 space-y-0.5">
      {[...keys].map(k => {
        const b = before?.[k];
        const a = after?.[k];
        if (b === a) return null;
        return (
          <div key={k} className="flex gap-2 text-[10px] font-mono">
            <span className="text-slate-400 min-w-[100px]">{k}:</span>
            {b != null && <span className="text-red-500 line-through">{String(b)}</span>}
            {b != null && a != null && <span className="text-slate-300">→</span>}
            {a != null && <span className="text-emerald-700">{String(a)}</span>}
          </div>
        );
      })}
    </div>
  );
}

function AuditLogInner() {
  const sp = useSearchParams();
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [clientId, setClientId] = useState(sp.get('clientId') ?? '');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(j => setClients(j.clients ?? [])).catch(() => {});
  }, []);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ limit: String(limit) });
      if (clientId) p.set('clientId', clientId);
      const res = await fetch(`/api/audit-log?${p}`);
      const json = await res.json();
      if (res.ok) setLogs(json.logs ?? []);
    } catch {}
    finally { setLoading(false); }
  }, [clientId, limit]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-lime-50 p-4 md:p-8">
      <div className="max-w-[1140px] mx-auto flex gap-5 items-start">
        <JournalSidebarNav clientId={clientId} active="audit-log" />
        <div className="flex-1 min-w-0 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-bold text-slate-800">変更履歴・監査証跡</h1>
          <Link href="/" className="text-sm text-sky-600 hover:underline">← 日記帳に戻る</Link>
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex flex-wrap items-center gap-4">
          {clients.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500">顧問先</label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-400"
              >
                <option value="">全クライアント</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.short_name ?? c.name}</option>)}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500">表示件数</label>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-400"
            >
              {[50, 100, 200, 500].map(n => <option key={n} value={n}>{n}件</option>)}
            </select>
          </div>
          <button onClick={fetchLogs} disabled={loading} className="ml-auto text-xs font-semibold text-sky-600 bg-sky-50 border border-sky-200 rounded-xl px-4 py-2 hover:bg-sky-100 disabled:opacity-50 transition-all">
            {loading ? '読込中…' : '更新'}
          </button>
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
          {loading ? (
            <p className="px-5 py-8 text-sm text-slate-400 text-center">読み込み中…</p>
          ) : logs.length === 0 ? (
            <p className="px-5 py-8 text-sm text-slate-400 text-center">変更履歴がありません</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {logs.map(log => (
                <div key={log.id} className="px-5 py-3 hover:bg-slate-50/50">
                  <div className="flex items-start gap-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold mt-0.5 shrink-0 ${ACTION_COLOR[log.action] ?? 'bg-slate-100 text-slate-500'}`}>
                      {ACTION_LABEL[log.action] ?? log.action}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-slate-400">{fmtDate(log.changed_at)}</span>
                        <span className="text-[10px] text-slate-300 font-mono">{log.entry_id.slice(0, 8)}…</span>
                      </div>
                      <DataDiff before={log.before_data} after={log.after_data} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

export default function AuditLogPage() {
  return <Suspense><AuditLogInner /></Suspense>;
}
