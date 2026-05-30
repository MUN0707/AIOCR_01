'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface ClientItem { id: string; name: string; short_name?: string | null; }

interface EDoc {
  id: string;
  file_name: string;
  mode: string;
  created_at: string;
  client_id: string | null;
  doc_category: string | null;
  receipt_date: string | null;
  transaction_amount: number | null;
  counterparty: string | null;
  edoc_notes: string | null;
}

const DOC_CATEGORY_LABELS: Record<string, string> = {
  invoice: '請求書',
  receipt: '領収書',
  contract: '契約書',
  other: 'その他',
};

function isComplete(d: EDoc) {
  return !!d.receipt_date && d.transaction_amount != null && !!d.counterparty;
}

function EDocumentsInner() {
  const sp = useSearchParams();
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [clientId, setClientId] = useState(sp.get('clientId') ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [counterpartyQ, setCounterpartyQ] = useState('');
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [docs, setDocs] = useState<EDoc[]>([]);
  const [stats, setStats] = useState({ total: 0, complete: 0, incomplete: 0 });
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<EDoc>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(j => setClients(j.clients ?? [])).catch(() => {});
  }, []);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (clientId) params.set('clientId', clientId);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (counterpartyQ) params.set('counterparty', counterpartyQ);
      if (incompleteOnly) params.set('incompleteOnly', '1');
      const res = await fetch(`/api/edocuments?${params}`);
      const json = await res.json();
      if (res.ok) {
        setDocs(json.documents ?? []);
        setStats(json.stats ?? { total: 0, complete: 0, incomplete: 0 });
      }
    } catch {}
    finally { setLoading(false); }
  }, [clientId, from, to, counterpartyQ, incompleteOnly]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const startEdit = (d: EDoc) => {
    setEditingId(d.id);
    setEditForm({
      doc_category: d.doc_category ?? '',
      receipt_date: d.receipt_date ?? '',
      transaction_amount: d.transaction_amount ?? undefined,
      counterparty: d.counterparty ?? '',
      edoc_notes: d.edoc_notes ?? '',
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/edocuments/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) throw new Error('保存失敗');
      setDocs(prev => prev.map(d => d.id === editingId ? { ...d, ...editForm } as EDoc : d));
      setEditingId(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : '保存失敗');
    } finally {
      setSaving(false);
    }
  };

  const modeLabel = (mode: string) => {
    if (mode === 'bank-statement') return '通帳';
    if (mode === 'invoice-single') return '請求書';
    if (mode === 'tax-return') return '確定申告';
    return mode;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/" className="text-sky-500 hover:text-sky-700 text-sm">← 日記帳</Link>
          <h1 className="text-xl font-bold text-slate-800">電子帳票保存管理</h1>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-medium">電帳法対応</span>
        </div>

        {/* 統計 */}
        {stats.total > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-5">
            <StatCard label="書類総数" value={stats.total} color="text-slate-700" />
            <StatCard label="メタデータ完了" value={stats.complete} color="text-lime-700" />
            <StatCard label="未入力あり" value={stats.incomplete} color={stats.incomplete > 0 ? 'text-amber-600' : 'text-slate-400'} />
          </div>
        )}

        {/* 検索フィルター */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 mb-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">顧問先</label>
              <select value={clientId} onChange={e => setClientId(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400">
                <option value="">（共通）</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.short_name ?? c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">取引日（開始）</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400" />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">取引日（終了）</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400" />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">取引先（部分一致）</label>
              <input type="text" value={counterpartyQ} onChange={e => setCounterpartyQ(e.target.value)}
                placeholder="例: 株式会社〇〇"
                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
              <input type="checkbox" checked={incompleteOnly} onChange={e => setIncompleteOnly(e.target.checked)} />
              未入力のみ表示
            </label>
            <span className="flex-1" />
            <button onClick={fetchDocs} disabled={loading}
              className="text-xs px-4 py-1.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl font-semibold transition-colors disabled:opacity-50">
              {loading ? '検索中…' : '検索'}
            </button>
          </div>
        </div>

        {/* 電帳法の要件説明 */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 text-xs text-amber-800">
          <strong>電子帳簿保存法 スキャン保存の検索要件：</strong>
          取引年月日・取引金額・取引先の3項目を入力してください。未入力の書類は法令上の検索要件を満たしません。
        </div>

        {/* 書類一覧 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">ファイル名</th>
                <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest w-20">種別</th>
                <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest w-28">① 取引年月日</th>
                <th className="px-3 py-3 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest w-28">② 取引金額</th>
                <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">③ 取引先</th>
                <th className="px-3 py-3 text-center text-[10px] font-semibold text-slate-400 uppercase tracking-widest w-16">状態</th>
                <th className="px-3 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {docs.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                  {loading ? '読み込み中…' : '書類がありません'}
                </td></tr>
              )}
              {docs.map(d => (
                editingId === d.id ? (
                  <tr key={d.id} className="bg-sky-50/30">
                    <td className="px-3 py-2 text-xs text-slate-600 truncate max-w-[180px]" title={d.file_name}>
                      {d.file_name}
                    </td>
                    <td className="px-3 py-2">
                      <select value={editForm.doc_category ?? ''}
                        onChange={e => setEditForm(f => ({ ...f, doc_category: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded px-1 py-1 focus:outline-none focus:border-sky-400">
                        <option value="">—</option>
                        <option value="invoice">請求書</option>
                        <option value="receipt">領収書</option>
                        <option value="contract">契約書</option>
                        <option value="other">その他</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input type="date" value={editForm.receipt_date ?? ''}
                        onChange={e => setEditForm(f => ({ ...f, receipt_date: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded px-1 py-1 focus:outline-none focus:border-sky-400" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" value={editForm.transaction_amount ?? ''}
                        onChange={e => setEditForm(f => ({ ...f, transaction_amount: e.target.value ? Number(e.target.value) : undefined }))}
                        className="w-full text-xs text-right border border-slate-200 rounded px-1 py-1 focus:outline-none focus:border-sky-400" />
                    </td>
                    <td className="px-3 py-2" colSpan={2}>
                      <input type="text" value={editForm.counterparty ?? ''}
                        onChange={e => setEditForm(f => ({ ...f, counterparty: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded px-1 py-1 focus:outline-none focus:border-sky-400"
                        placeholder="取引先名" />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex gap-1 justify-end">
                        <button onClick={saveEdit} disabled={saving}
                          className="text-[10px] px-2 py-1 bg-sky-500 text-white rounded hover:bg-sky-600 disabled:opacity-50">保存</button>
                        <button onClick={() => setEditingId(null)}
                          className="text-[10px] px-2 py-1 border border-slate-200 rounded hover:bg-slate-50">×</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={d.id} className="hover:bg-slate-50/30">
                    <td className="px-3 py-2.5 text-xs text-slate-700 truncate max-w-[180px]" title={d.file_name}>
                      <div className="font-medium truncate">{d.file_name}</div>
                      <div className="text-[10px] text-slate-400">{modeLabel(d.mode)} · {d.created_at.slice(0, 10)}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      {d.doc_category ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          {DOC_CATEGORY_LABELS[d.doc_category] ?? d.doc_category}
                        </span>
                      ) : <span className="text-[10px] text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-slate-700">
                      {d.receipt_date ?? <span className="text-amber-400 font-semibold">未入力</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-right tabular-nums text-slate-700">
                      {d.transaction_amount != null
                        ? `¥${Number(d.transaction_amount).toLocaleString()}`
                        : <span className="text-amber-400 font-semibold">未入力</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-700 truncate">
                      {d.counterparty ?? <span className="text-amber-400 font-semibold">未入力</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {isComplete(d)
                        ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-lime-100 text-lime-700 font-semibold">完了</span>
                        : <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">要入力</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button onClick={() => startEdit(d)}
                        className="text-[10px] text-sky-600 border border-sky-200 rounded px-2 py-0.5 hover:bg-sky-50">編集</button>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm px-4 py-3">
      <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

export default function EDocumentsPage() {
  return (
    <Suspense>
      <EDocumentsInner />
    </Suspense>
  );
}
