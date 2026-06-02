'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { JournalSidebarNav } from '@/components/JournalSidebarNav';
import { useConfirm } from '@/components/ConfirmDialog';

interface ClientItem { id: string; name: string; short_name?: string | null }

interface Department {
  id: string;
  name: string;
  code: string | null;
  is_active: boolean;
  client_id: string | null;
  created_at: string;
}

interface ReportRow {
  id: string | null;
  name: string;
  code: string | null;
  revenue: number;
  expense: number;
  profit: number;
}

function fmtYen(n: number) {
  return (n < 0 ? '-¥' : '¥') + Math.abs(Math.round(n)).toLocaleString();
}

function DepartmentsInner() {
  const confirm = useConfirm();
  const sp = useSearchParams();
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [clientId, setClientId] = useState(sp.get('clientId') ?? '');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);

  // 新規追加フォーム
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', code: '' });
  const [addSaving, setAddSaving] = useState(false);

  // 編集フォーム
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', code: '', is_active: true });
  const [editSaving, setEditSaving] = useState(false);

  // 部門別損益レポート
  const [reportRows, setReportRows] = useState<ReportRow[] | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportStart, setReportStart] = useState('');
  const [reportEnd, setReportEnd] = useState('');

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(j => setClients(j.clients ?? [])).catch(() => {});
  }, []);

  const fetchDepartments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (clientId) params.set('clientId', clientId);
      const res = await fetch(`/api/departments?${params}`);
      const json = await res.json();
      if (res.ok) setDepartments(json.departments ?? []);
    } catch {}
    finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { fetchDepartments(); }, [fetchDepartments]);

  const handleAdd = async () => {
    if (!addForm.name.trim()) { alert('部門名は必須です'); return; }
    setAddSaving(true);
    try {
      const res = await fetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...addForm, client_id: clientId || null }),
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error || '追加失敗'); return; }
      setAddForm({ name: '', code: '' });
      setShowAdd(false);
      fetchDepartments();
    } catch { alert('追加失敗'); }
    finally { setAddSaving(false); }
  };

  const startEdit = (d: Department) => {
    setEditingId(d.id);
    setEditForm({ name: d.name, code: d.code ?? '', is_active: d.is_active });
  };

  const handleEdit = async (id: string) => {
    setEditSaving(true);
    try {
      const res = await fetch(`/api/departments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error || '更新失敗'); return; }
      setEditingId(null);
      fetchDepartments();
    } catch { alert('更新失敗'); }
    finally { setEditSaving(false); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!(await confirm({ message: `「${name}」を削除しますか？\n紐付いた仕訳の部門は未設定になります。`, tone: 'danger' }))) return;
    const res = await fetch(`/api/departments/${id}`, { method: 'DELETE' });
    if (!res.ok) { const j = await res.json(); alert(j.error || '削除失敗'); return; }
    fetchDepartments();
  };

  const fetchReport = useCallback(async () => {
    setReportLoading(true);
    setReportRows(null);
    try {
      const params = new URLSearchParams();
      if (clientId) params.set('clientId', clientId);
      if (reportStart) params.set('startDate', reportStart.replace(/-/g, ''));
      if (reportEnd) params.set('endDate', reportEnd.replace(/-/g, ''));
      const res = await fetch(`/api/department-report?${params}`);
      const json = await res.json();
      if (res.ok) setReportRows(json.rows ?? []);
    } catch {}
    finally { setReportLoading(false); }
  }, [clientId, reportStart, reportEnd]);

  const clientName = clients.find(c => c.id === clientId)?.name ?? null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-lime-50 p-4 md:p-8">
      <div className="max-w-[1140px] mx-auto flex gap-5 items-start">
        <JournalSidebarNav clientId={clientId} active="departments" />
        <div className="flex-1 min-w-0 space-y-6">

        {/* ヘッダー */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">部門管理</h1>
            {clientName && <p className="text-sm text-slate-500 mt-0.5">{clientName}</p>}
          </div>
          <Link href="/" className="text-sm text-sky-600 hover:underline">← 日記帳に戻る</Link>
        </div>

        {/* 顧問先フィルタ */}
        {clients.length > 0 && (
          <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest mr-3">顧問先</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-400"
            >
              <option value="">（共通）</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.short_name ?? c.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* 部門一覧 */}
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">部門一覧</h2>
            <button
              onClick={() => setShowAdd(v => !v)}
              className="text-xs text-sky-600 bg-sky-50 border border-sky-200 rounded-xl px-4 py-2 font-semibold hover:bg-sky-100 transition-all"
            >
              + 部門追加
            </button>
          </div>

          {/* 追加フォーム */}
          {showAdd && (
            <div className="px-5 py-4 border-b border-slate-100 bg-sky-50/30 flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest block mb-1">部門名 *</label>
                <input
                  value={addForm.name}
                  onChange={(e) => setAddForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="例: 営業部"
                  className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 w-48 focus:outline-none focus:border-sky-400"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest block mb-1">部門コード</label>
                <input
                  value={addForm.code}
                  onChange={(e) => setAddForm(f => ({ ...f, code: e.target.value }))}
                  placeholder="例: 01"
                  className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 w-24 focus:outline-none focus:border-sky-400"
                />
              </div>
              <button
                onClick={handleAdd}
                disabled={addSaving}
                className="text-sm font-semibold text-white bg-sky-500 hover:bg-sky-600 disabled:opacity-50 rounded-xl px-5 py-1.5 transition-all"
              >
                {addSaving ? '追加中…' : '追加'}
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="text-sm text-slate-500 hover:text-slate-700"
              >キャンセル</button>
            </div>
          )}

          {loading ? (
            <p className="px-5 py-8 text-sm text-slate-400 text-center">読み込み中…</p>
          ) : departments.length === 0 ? (
            <p className="px-5 py-8 text-sm text-slate-400 text-center">部門が登録されていません</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">コード</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">部門名</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">状態</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {departments.map(d => (
                  <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    {editingId === d.id ? (
                      <>
                        <td className="px-4 py-2">
                          <input
                            value={editForm.code}
                            onChange={(e) => setEditForm(f => ({ ...f, code: e.target.value }))}
                            className="text-sm border border-slate-200 rounded px-2 py-1 w-20 focus:outline-none focus:border-sky-400"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            value={editForm.name}
                            onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
                            className="text-sm border border-slate-200 rounded px-2 py-1 w-40 focus:outline-none focus:border-sky-400"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editForm.is_active}
                              onChange={(e) => setEditForm(f => ({ ...f, is_active: e.target.checked }))}
                            />
                            <span className="text-xs text-slate-600">有効</span>
                          </label>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleEdit(d.id)}
                              disabled={editSaving}
                              className="text-xs text-white bg-sky-500 hover:bg-sky-600 disabled:opacity-50 rounded-lg px-3 py-1 font-semibold"
                            >
                              {editSaving ? '…' : '保存'}
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="text-xs text-slate-500 hover:text-slate-700"
                            >キャンセル</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{d.code ?? '—'}</td>
                        <td className="px-4 py-2.5 font-medium text-slate-700">
                          {d.name}
                          {!d.is_active && <span className="ml-2 text-[10px] text-slate-400 bg-slate-100 rounded-full px-1.5 py-0.5">無効</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${d.is_active ? 'bg-lime-100 text-lime-700' : 'bg-slate-100 text-slate-500'}`}>
                            {d.is_active ? '有効' : '無効'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex gap-2">
                            <button
                              onClick={() => startEdit(d)}
                              className="text-xs text-sky-600 hover:underline"
                            >編集</button>
                            <button
                              onClick={() => handleDelete(d.id, d.name)}
                              className="text-xs text-red-500 hover:underline"
                            >削除</button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 部門別損益レポート */}
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">部門別損益レポート</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="date"
                value={reportStart}
                onChange={(e) => setReportStart(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400"
              />
              <span className="text-xs text-slate-400">〜</span>
              <input
                type="date"
                value={reportEnd}
                onChange={(e) => setReportEnd(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400"
              />
              <button
                onClick={fetchReport}
                disabled={reportLoading}
                className="text-xs font-semibold text-sky-600 bg-sky-50 border border-sky-200 rounded-xl px-4 py-1.5 hover:bg-sky-100 disabled:opacity-50 transition-all"
              >
                {reportLoading ? '集計中…' : '集計'}
              </button>
            </div>
          </div>

          {reportRows === null ? (
            <p className="px-5 py-8 text-sm text-slate-400 text-center">
              期間を指定して「集計」を押してください
            </p>
          ) : reportRows.length === 0 ? (
            <p className="px-5 py-8 text-sm text-slate-400 text-center">データがありません</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">部門</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest">売上</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest">費用</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest">損益</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.map((row, i) => (
                  <tr key={row.id ?? 'unassigned'} className={`border-b border-slate-50 ${i === reportRows.length - 1 ? 'bg-slate-50/50' : ''}`}>
                    <td className="px-4 py-2.5 font-medium text-slate-700">
                      {row.code && <span className="text-xs font-mono text-slate-400 mr-2">{row.code}</span>}
                      {row.name}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-700">{fmtYen(row.revenue)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-700">{fmtYen(row.expense)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono font-semibold ${row.profit >= 0 ? 'text-lime-700' : 'text-red-600'}`}>
                      {fmtYen(row.profit)}
                    </td>
                  </tr>
                ))}
                {/* 合計行 */}
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td className="px-4 py-2.5 font-semibold text-slate-700">合計</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-700">
                    {fmtYen(reportRows.reduce((s, r) => s + r.revenue, 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-700">
                    {fmtYen(reportRows.reduce((s, r) => s + r.expense, 0))}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-mono font-semibold ${reportRows.reduce((s, r) => s + r.profit, 0) >= 0 ? 'text-lime-700' : 'text-red-600'}`}>
                    {fmtYen(reportRows.reduce((s, r) => s + r.profit, 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        </div>
      </div>
    </div>
  );
}

export default function DepartmentsPage() {
  return (
    <Suspense>
      <DepartmentsInner />
    </Suspense>
  );
}
