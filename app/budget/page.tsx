'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { JournalSidebarNav } from '@/components/JournalSidebarNav';

interface ClientItem { id: string; name: string; short_name?: string | null }
interface AccountItem { id: string; name: string; category: string; sub_category: string | null }

interface BudgetEntry {
  id: string;
  account_name: string;
  year: number;
  month: number;
  amount: number;
}

interface MonthlyCell { month: number; budget: number; actual: number; diff: number }
interface ReportRow {
  account_name: string;
  category: string;
  monthly: MonthlyCell[];
  totalBudget: number;
  totalActual: number;
  totalDiff: number;
  achievementRate: number | null;
}

const MONTHS = [1,2,3,4,5,6,7,8,9,10,11,12];
const CAT_LABEL: Record<string,string> = { revenue: '収益', expense: '費用', asset: '資産', liability: '負債', equity: '純資産' };
const CAT_COLOR: Record<string,string> = {
  revenue: 'bg-lime-100 text-lime-700',
  expense: 'bg-sky-100 text-sky-700',
  asset: 'bg-violet-100 text-violet-700',
  liability: 'bg-amber-100 text-amber-700',
};

function fmtYen(n: number) {
  if (n === 0) return '—';
  return (n < 0 ? '-¥' : '¥') + Math.abs(Math.round(n)).toLocaleString();
}

function AchBadge({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-slate-300 text-xs">—</span>;
  const color = rate >= 100 ? 'text-lime-700 bg-lime-50' : rate >= 80 ? 'text-amber-700 bg-amber-50' : 'text-red-600 bg-red-50';
  return <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${color}`}>{rate}%</span>;
}

function BudgetInner() {
  const sp = useSearchParams();
  const currentYear = new Date().getFullYear();

  const [clients, setClients] = useState<ClientItem[]>([]);
  const [clientId, setClientId] = useState(sp.get('clientId') ?? '');
  const [year, setYear] = useState(currentYear);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [tab, setTab] = useState<'input' | 'report'>('input');

  // 予算入力
  const [budgets, setBudgets] = useState<BudgetEntry[]>([]);
  const [loadingBudgets, setLoadingBudgets] = useState(false);
  const [addForm, setAddForm] = useState({ account_name: '', month: 1, amount: '' });
  const [addSaving, setAddSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  // 年間一括入力
  const [bulkForm, setBulkForm] = useState({ account_name: '', annual_amount: '' });
  const [bulkSaving, setBulkSaving] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

  // 実績比較
  const [reportRows, setReportRows] = useState<ReportRow[] | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null); // null = 年合計

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(j => setClients(j.clients ?? [])).catch(() => {});
    fetch('/api/accounts').then(r => r.json()).then(j => setAccounts(j.accounts ?? [])).catch(() => {});
  }, []);

  const fetchBudgets = useCallback(async () => {
    setLoadingBudgets(true);
    try {
      const p = new URLSearchParams({ year: String(year) });
      if (clientId) p.set('clientId', clientId);
      const res = await fetch(`/api/budgets?${p}`);
      const json = await res.json();
      if (res.ok) setBudgets(json.budgets ?? []);
    } catch {}
    finally { setLoadingBudgets(false); }
  }, [clientId, year]);

  useEffect(() => { fetchBudgets(); }, [fetchBudgets]);

  const handleAdd = async () => {
    if (!addForm.account_name) { alert('科目名は必須です'); return; }
    setAddSaving(true);
    try {
      const res = await fetch('/api/budgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...addForm, year, amount: Number(addForm.amount) || 0, client_id: clientId || null }),
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error || '追加失敗'); return; }
      setAddForm({ account_name: '', month: 1, amount: '' });
      setShowAdd(false);
      fetchBudgets();
    } catch { alert('追加失敗'); }
    finally { setAddSaving(false); }
  };

  const handleBulkAdd = async () => {
    if (!bulkForm.account_name) { alert('科目名は必須です'); return; }
    const annual = Number(bulkForm.annual_amount) || 0;
    const monthly = Math.round(annual / 12);
    setBulkSaving(true);
    try {
      for (const m of MONTHS) {
        const res = await fetch('/api/budgets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_name: bulkForm.account_name, year, month: m, amount: monthly, client_id: clientId || null }),
        });
        if (!res.ok) { const j = await res.json(); alert(j.error || '失敗'); break; }
      }
      setBulkForm({ account_name: '', annual_amount: '' });
      setShowBulk(false);
      fetchBudgets();
    } catch { alert('追加失敗'); }
    finally { setBulkSaving(false); }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/budgets/${id}`, { method: 'DELETE' });
    if (!res.ok) { const j = await res.json(); alert(j.error || '削除失敗'); return; }
    fetchBudgets();
  };

  const fetchReport = useCallback(async () => {
    setReportLoading(true);
    setReportRows(null);
    try {
      const p = new URLSearchParams({ year: String(year) });
      if (clientId) p.set('clientId', clientId);
      const res = await fetch(`/api/budget-report?${p}`);
      const json = await res.json();
      if (res.ok) setReportRows(json.rows ?? []);
    } catch {}
    finally { setReportLoading(false); }
  }, [clientId, year]);

  // 予算入力: 科目別の月ごとグリッド用に集計
  const budgetGrid = (() => {
    const map = new Map<string, Map<number, BudgetEntry>>();
    for (const b of budgets) {
      if (!map.has(b.account_name)) map.set(b.account_name, new Map());
      map.get(b.account_name)!.set(b.month, b);
    }
    return map;
  })();

  const clientName = clients.find(c => c.id === clientId)?.name ?? null;
  const plAccounts = accounts.filter(a => a.category === 'revenue' || a.category === 'expense');

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-lime-50 p-4 md:p-8">
      <div className="max-w-[1340px] mx-auto flex gap-5 items-start">
        <JournalSidebarNav clientId={clientId} active="budget" />
        <div className="flex-1 min-w-0 space-y-6">

        {/* ヘッダー */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">予算管理</h1>
            {clientName && <p className="text-sm text-slate-500 mt-0.5">{clientName}</p>}
          </div>
          <Link href="/" className="text-sm text-sky-600 hover:underline">← 日記帳に戻る</Link>
        </div>

        {/* フィルタバー */}
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex flex-wrap items-center gap-4">
          {clients.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500">顧問先</label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-400"
              >
                <option value="">（共通）</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.short_name ?? c.name}</option>)}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500">年度</label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-400"
            >
              {[currentYear+1, currentYear, currentYear-1, currentYear-2].map(y => (
                <option key={y} value={y}>{y}年</option>
              ))}
            </select>
          </div>
          {/* タブ */}
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => setTab('input')}
              className={`text-xs font-semibold px-4 py-2 rounded-xl border transition-all ${tab === 'input' ? 'bg-sky-500 text-white border-sky-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
            >
              予算入力
            </button>
            <button
              onClick={() => { setTab('report'); fetchReport(); }}
              className={`text-xs font-semibold px-4 py-2 rounded-xl border transition-all ${tab === 'report' ? 'bg-sky-500 text-white border-sky-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
            >
              実績比較
            </button>
          </div>
        </div>

        {/* ──── 予算入力タブ ──── */}
        {tab === 'input' && (
          <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-700">{year}年 予算入力</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowBulk(v => !v); setShowAdd(false); }}
                  className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2 font-semibold hover:bg-indigo-100 transition-all"
                >
                  年間一括入力
                </button>
                <button
                  onClick={() => { setShowAdd(v => !v); setShowBulk(false); }}
                  className="text-xs text-sky-600 bg-sky-50 border border-sky-200 rounded-xl px-4 py-2 font-semibold hover:bg-sky-100 transition-all"
                >
                  + 月別追加
                </button>
              </div>
            </div>

            {/* 年間一括入力フォーム */}
            {showBulk && (
              <div className="px-5 py-4 border-b border-slate-100 bg-indigo-50/30 flex flex-wrap gap-3 items-end">
                <div>
                  <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest block mb-1">科目名 *</label>
                  <select
                    value={bulkForm.account_name}
                    onChange={(e) => setBulkForm(f => ({ ...f, account_name: e.target.value }))}
                    className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 w-48 focus:outline-none focus:border-sky-400"
                  >
                    <option value="">科目を選択</option>
                    {plAccounts.map(a => (
                      <option key={a.id} value={a.name}>[{CAT_LABEL[a.category] ?? a.category}] {a.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest block mb-1">年間予算額</label>
                  <input
                    type="number"
                    value={bulkForm.annual_amount}
                    onChange={(e) => setBulkForm(f => ({ ...f, annual_amount: e.target.value }))}
                    placeholder="例: 1200000"
                    className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 w-36 focus:outline-none focus:border-sky-400 text-right tabular-nums"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {bulkForm.annual_amount ? `→ 月額 ¥${Math.round(Number(bulkForm.annual_amount)/12).toLocaleString()}` : '12等分されます'}
                  </p>
                </div>
                <button
                  onClick={handleBulkAdd}
                  disabled={bulkSaving}
                  className="text-sm font-semibold text-white bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 rounded-xl px-5 py-1.5 transition-all"
                >
                  {bulkSaving ? '入力中…' : '12ヶ月に入力'}
                </button>
                <button onClick={() => setShowBulk(false)} className="text-sm text-slate-500 hover:text-slate-700">キャンセル</button>
              </div>
            )}

            {/* 月別追加フォーム */}
            {showAdd && (
              <div className="px-5 py-4 border-b border-slate-100 bg-sky-50/30 flex flex-wrap gap-3 items-end">
                <div>
                  <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest block mb-1">科目名 *</label>
                  <select
                    value={addForm.account_name}
                    onChange={(e) => setAddForm(f => ({ ...f, account_name: e.target.value }))}
                    className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 w-48 focus:outline-none focus:border-sky-400"
                  >
                    <option value="">科目を選択</option>
                    {plAccounts.map(a => (
                      <option key={a.id} value={a.name}>[{CAT_LABEL[a.category] ?? a.category}] {a.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest block mb-1">月 *</label>
                  <select
                    value={addForm.month}
                    onChange={(e) => setAddForm(f => ({ ...f, month: Number(e.target.value) }))}
                    className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 w-20 focus:outline-none focus:border-sky-400"
                  >
                    {MONTHS.map(m => <option key={m} value={m}>{m}月</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest block mb-1">予算額</label>
                  <input
                    type="number"
                    value={addForm.amount}
                    onChange={(e) => setAddForm(f => ({ ...f, amount: e.target.value }))}
                    placeholder="例: 100000"
                    className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 w-32 focus:outline-none focus:border-sky-400 text-right tabular-nums"
                  />
                </div>
                <button
                  onClick={handleAdd}
                  disabled={addSaving}
                  className="text-sm font-semibold text-white bg-sky-500 hover:bg-sky-600 disabled:opacity-50 rounded-xl px-5 py-1.5 transition-all"
                >
                  {addSaving ? '追加中…' : '追加'}
                </button>
                <button onClick={() => setShowAdd(false)} className="text-sm text-slate-500 hover:text-slate-700">キャンセル</button>
              </div>
            )}

            {loadingBudgets ? (
              <p className="px-5 py-8 text-sm text-slate-400 text-center">読み込み中…</p>
            ) : budgetGrid.size === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-400 text-center">
                予算がありません。「年間一括入力」または「月別追加」から登録してください。
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest sticky left-0 bg-slate-50">科目</th>
                      {MONTHS.map(m => (
                        <th key={m} className="px-2 py-2.5 text-right text-[10px] font-semibold text-slate-400 min-w-[80px]">{m}月</th>
                      ))}
                      <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-slate-400">年計</th>
                      <th className="px-3 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...budgetGrid.entries()].map(([accountName, monthMap]) => {
                      const acc = accounts.find(a => a.name === accountName);
                      const annual = [...monthMap.values()].reduce((s, b) => s + b.amount, 0);
                      return (
                        <tr key={accountName} className="border-b border-slate-50 hover:bg-slate-50/40">
                          <td className="px-3 py-2 font-medium text-slate-700 sticky left-0 bg-white">
                            <div className="flex items-center gap-1.5">
                              {acc && (
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${CAT_COLOR[acc.category] ?? 'bg-slate-100 text-slate-500'}`}>
                                  {CAT_LABEL[acc.category] ?? acc.category}
                                </span>
                              )}
                              {accountName}
                            </div>
                          </td>
                          {MONTHS.map(m => {
                            const entry = monthMap.get(m);
                            return (
                              <td key={m} className="px-2 py-2 text-right font-mono text-slate-600">
                                {entry ? (
                                  <span className="group relative">
                                    <span>¥{entry.amount.toLocaleString()}</span>
                                    <button
                                      onClick={() => handleDelete(entry.id)}
                                      className="ml-1 text-[9px] text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                      title="削除"
                                    >✕</button>
                                  </span>
                                ) : (
                                  <span className="text-slate-200">—</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-right font-mono font-semibold text-slate-700">
                            ¥{annual.toLocaleString()}
                          </td>
                          <td className="px-3 py-2"></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ──── 実績比較タブ ──── */}
        {tab === 'report' && (
          <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-700">{year}年 予算 vs 実績</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">表示:</span>
                <select
                  value={selectedMonth ?? ''}
                  onChange={(e) => setSelectedMonth(e.target.value ? Number(e.target.value) : null)}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400"
                >
                  <option value="">年合計</option>
                  {MONTHS.map(m => <option key={m} value={m}>{m}月</option>)}
                </select>
                <button
                  onClick={fetchReport}
                  disabled={reportLoading}
                  className="text-xs font-semibold text-sky-600 bg-sky-50 border border-sky-200 rounded-xl px-4 py-1.5 hover:bg-sky-100 disabled:opacity-50 transition-all"
                >
                  {reportLoading ? '集計中…' : '再集計'}
                </button>
              </div>
            </div>

            {reportLoading ? (
              <p className="px-5 py-8 text-sm text-slate-400 text-center">集計中…</p>
            ) : reportRows === null ? (
              <p className="px-5 py-8 text-sm text-slate-400 text-center">「実績比較」タブを押すと集計が始まります</p>
            ) : reportRows.length === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-400 text-center">データがありません</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">科目</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-slate-400">予算</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-slate-400">実績</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-slate-400">差額</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-slate-400">達成率</th>
                  </tr>
                </thead>
                <tbody>
                  {reportRows.map((row) => {
                    const m = selectedMonth;
                    const cell = m ? row.monthly.find(x => x.month === m) : null;
                    const budget = m ? (cell?.budget ?? 0) : row.totalBudget;
                    const actual = m ? (cell?.actual ?? 0) : row.totalActual;
                    const diff = actual - budget;
                    const rate = budget !== 0 ? Math.round((actual / budget) * 100) : null;

                    if (budget === 0 && actual === 0) return null;
                    return (
                      <tr key={row.account_name} className="border-b border-slate-50 hover:bg-slate-50/40">
                        <td className="px-4 py-2.5 font-medium text-slate-700">
                          <div className="flex items-center gap-1.5">
                            {row.category && (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${CAT_COLOR[row.category] ?? 'bg-slate-100 text-slate-500'}`}>
                                {CAT_LABEL[row.category] ?? row.category}
                              </span>
                            )}
                            {row.account_name}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-600">{fmtYen(budget)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-700 font-semibold">{fmtYen(actual)}</td>
                        <td className={`px-4 py-2.5 text-right font-mono ${diff >= 0 ? 'text-lime-700' : 'text-red-500'}`}>
                          {diff !== 0 ? (diff > 0 ? '+' : '') + fmtYen(diff) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right"><AchBadge rate={rate} /></td>
                      </tr>
                    );
                  })}
                  {/* 合計行（収益） */}
                  {['revenue', 'expense'].map((cat) => {
                    const catRows = reportRows.filter(r => r.category === cat && (
                      selectedMonth
                        ? ((r.monthly.find(x => x.month === selectedMonth)?.budget ?? 0) !== 0 || (r.monthly.find(x => x.month === selectedMonth)?.actual ?? 0) !== 0)
                        : (r.totalBudget !== 0 || r.totalActual !== 0)
                    ));
                    if (catRows.length === 0) return null;
                    const totalB = catRows.reduce((s, r) => s + (selectedMonth ? (r.monthly.find(x => x.month === selectedMonth)?.budget ?? 0) : r.totalBudget), 0);
                    const totalA = catRows.reduce((s, r) => s + (selectedMonth ? (r.monthly.find(x => x.month === selectedMonth)?.actual ?? 0) : r.totalActual), 0);
                    const totalD = totalA - totalB;
                    const rate = totalB !== 0 ? Math.round((totalA / totalB) * 100) : null;
                    return (
                      <tr key={`total-${cat}`} className="border-t-2 border-slate-200 bg-slate-50">
                        <td className="px-4 py-2.5 font-semibold text-slate-700">{CAT_LABEL[cat]}合計</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-700">{fmtYen(totalB)}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-700">{fmtYen(totalA)}</td>
                        <td className={`px-4 py-2.5 text-right font-mono font-semibold ${totalD >= 0 ? 'text-lime-700' : 'text-red-500'}`}>
                          {totalD !== 0 ? (totalD > 0 ? '+' : '') + fmtYen(totalD) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right"><AchBadge rate={rate} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        </div>
      </div>
    </div>
  );
}

export default function BudgetPage() {
  return (
    <Suspense>
      <BudgetInner />
    </Suspense>
  );
}
