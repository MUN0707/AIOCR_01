'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface ClientItem { id: string; name: string; short_name?: string | null }

interface Payment {
  id: string;
  payment_date: string;
  amount: number;
  notes: string | null;
  created_at: string;
}

interface ArApRecord {
  id: string;
  type: 'ar' | 'ap';
  counterparty: string;
  invoice_date: string;
  due_date: string | null;
  amount: number;
  paid_amount: number;
  balance: number;
  computedStatus: 'open' | 'partial' | 'paid';
  description: string | null;
  notes: string | null;
  client_id: string | null;
  ar_ap_payments: Payment[];
}

interface Stats { totalAmount: number; totalPaid: number; totalOpen: number; count: number }

const STATUS_LABEL = { open: '未収', partial: '一部収済', paid: '収済' } as const;
const STATUS_LABEL_AP = { open: '未払', partial: '一部払済', paid: '払済' } as const;
const STATUS_COLOR = {
  open: 'bg-amber-100 text-amber-700',
  partial: 'bg-sky-100 text-sky-700',
  paid: 'bg-lime-100 text-lime-700',
};

function fmtDate(s: string | null) {
  if (!s) return '—';
  return s.slice(0, 10);
}

function fmtYen(n: number) {
  return '¥' + Math.round(n).toLocaleString();
}

function ArApInner() {
  const sp = useSearchParams();
  const initType = (sp.get('type') as 'ar' | 'ap') ?? 'ar';

  const [type, setType] = useState<'ar' | 'ap'>(initType);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [clientId, setClientId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [records, setRecords] = useState<ArApRecord[]>([]);
  const [stats, setStats] = useState<Stats>({ totalAmount: 0, totalPaid: 0, totalOpen: 0, count: 0 });
  const [loading, setLoading] = useState(false);

  // 新規追加フォーム
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({
    counterparty: '', invoice_date: '', due_date: '', amount: '', description: '', notes: '', client_id: '',
  });
  const [addSaving, setAddSaving] = useState(false);

  // 消込フォーム（どのレコードに対して消込中か）
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payForm, setPayForm] = useState({ payment_date: '', amount: '', notes: '' });
  const [paySaving, setPaySaving] = useState(false);

  // 明細展開
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(j => setClients(j.clients ?? [])).catch(() => {});
  }, []);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type });
      if (clientId) params.set('clientId', clientId);
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/ar-ap?${params}`);
      const json = await res.json();
      if (res.ok) {
        setRecords(json.records ?? []);
        setStats(json.stats ?? { totalAmount: 0, totalPaid: 0, totalOpen: 0, count: 0 });
      }
    } catch {}
    finally { setLoading(false); }
  }, [type, clientId, statusFilter]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const handleAdd = async () => {
    if (!addForm.counterparty || !addForm.invoice_date || !addForm.amount) {
      alert('取引先・請求日・金額は必須です');
      return;
    }
    setAddSaving(true);
    try {
      const res = await fetch('/api/ar-ap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...addForm, type, amount: Number(addForm.amount), client_id: addForm.client_id || null }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      setAddForm({ counterparty: '', invoice_date: '', due_date: '', amount: '', description: '', notes: '', client_id: '' });
      setShowAdd(false);
      await fetchRecords();
    } catch (e) {
      alert(e instanceof Error ? e.message : '追加失敗');
    } finally {
      setAddSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('このレコードを削除しますか？')) return;
    await fetch(`/api/ar-ap/${id}`, { method: 'DELETE' });
    setRecords(prev => prev.filter(r => r.id !== id));
  };

  const handleFullPay = async (rec: ArApRecord) => {
    const remaining = rec.balance;
    if (remaining <= 0) return;
    const today = new Date().toISOString().slice(0, 10);
    setPayingId(rec.id);
    setPayForm({ payment_date: today, amount: String(remaining), notes: '' });
  };

  const handlePaySubmit = async () => {
    if (!payingId || !payForm.payment_date || !payForm.amount) return;
    setPaySaving(true);
    try {
      const res = await fetch(`/api/ar-ap/${payingId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payForm, amount: Number(payForm.amount) }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      setPayingId(null);
      await fetchRecords();
    } catch (e) {
      alert(e instanceof Error ? e.message : '消込失敗');
    } finally {
      setPaySaving(false);
    }
  };

  const handleDeletePayment = async (recordId: string, paymentId: string) => {
    if (!confirm('この消込明細を削除しますか？')) return;
    await fetch(`/api/ar-ap/${recordId}/payments`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId }),
    });
    await fetchRecords();
  };

  const isAr = type === 'ar';
  const statusLabels = isAr ? STATUS_LABEL : STATUS_LABEL_AP;

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-slate-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/" className="text-sky-500 hover:text-sky-700 text-sm">← 日記帳</Link>
          <h1 className="text-xl font-bold text-slate-800">売掛金・買掛金 管理</h1>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">消込管理</span>
        </div>

        {/* タブ */}
        <div className="flex gap-1 mb-5 bg-white rounded-2xl border border-slate-100 shadow-sm p-1 w-fit">
          {(['ar', 'ap'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`text-sm px-5 py-2 rounded-xl font-semibold transition-all ${
                type === t ? 'bg-sky-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t === 'ar' ? '売掛金（未収）' : '買掛金（未払）'}
            </button>
          ))}
        </div>

        {/* 統計カード */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <StatCard label={isAr ? '請求総額' : '仕入総額'} value={fmtYen(stats.totalAmount)} color="text-slate-700" />
          <StatCard label={isAr ? '入金済み' : '支払済み'} value={fmtYen(stats.totalPaid)} color="text-lime-700" />
          <StatCard label={isAr ? '未収残高' : '未払残高'} value={fmtYen(stats.totalOpen)} color={stats.totalOpen > 0 ? 'text-amber-600' : 'text-slate-400'} />
        </div>

        {/* フィルター＋新規追加 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 mb-5">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">顧問先</label>
              <select value={clientId} onChange={e => setClientId(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400 min-w-[140px]">
                <option value="">（個人）</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.short_name ?? c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">状態</label>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400">
                <option value="">すべて</option>
                <option value="open">{statusLabels.open}</option>
                <option value="partial">{statusLabels.partial}</option>
                <option value="paid">{statusLabels.paid}</option>
              </select>
            </div>
            <button onClick={fetchRecords} disabled={loading}
              className="text-xs px-4 py-1.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl font-semibold transition-colors disabled:opacity-50">
              {loading ? '検索中…' : '検索'}
            </button>
            <span className="flex-1" />
            <button onClick={() => setShowAdd(!showAdd)}
              className="text-xs px-4 py-1.5 bg-violet-500 hover:bg-violet-600 text-white rounded-xl font-semibold transition-colors">
              {showAdd ? 'キャンセル' : `+ ${isAr ? '売掛金' : '買掛金'}を追加`}
            </button>
          </div>

          {/* 新規追加フォーム */}
          {showAdd && (
            <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[10px] text-slate-400 block mb-1">取引先 *</label>
                <input type="text" value={addForm.counterparty} onChange={e => setAddForm(f => ({ ...f, counterparty: e.target.value }))}
                  placeholder="例: 株式会社〇〇"
                  className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">請求日 *</label>
                <input type="date" value={addForm.invoice_date} onChange={e => setAddForm(f => ({ ...f, invoice_date: e.target.value }))}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">支払期日</label>
                <input type="date" value={addForm.due_date} onChange={e => setAddForm(f => ({ ...f, due_date: e.target.value }))}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">金額 *</label>
                <input type="number" value={addForm.amount} onChange={e => setAddForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0"
                  className="w-full text-xs text-right border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400" />
              </div>
              <div className="col-span-2 sm:col-span-2">
                <label className="text-[10px] text-slate-400 block mb-1">摘要</label>
                <input type="text" value={addForm.description} onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="例: 5月分サービス代"
                  className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">顧問先に紐付け</label>
                <select value={addForm.client_id} onChange={e => setAddForm(f => ({ ...f, client_id: e.target.value }))}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400">
                  <option value="">（紐付けなし）</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.short_name ?? c.name}</option>)}
                </select>
              </div>
              <div className="flex items-end">
                <button onClick={handleAdd} disabled={addSaving}
                  className="w-full text-xs px-4 py-1.5 bg-violet-500 hover:bg-violet-600 text-white rounded-xl font-semibold transition-colors disabled:opacity-50">
                  {addSaving ? '追加中…' : '追加'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 消込入力パネル */}
        {payingId && (
          <div className="bg-sky-50 border border-sky-200 rounded-2xl p-4 mb-5">
            <p className="text-xs font-semibold text-sky-700 mb-3">
              {isAr ? '入金' : '支払'}を記録（消込）
            </p>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">{isAr ? '入金日' : '支払日'} *</label>
                <input type="date" value={payForm.payment_date} onChange={e => setPayForm(f => ({ ...f, payment_date: e.target.value }))}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">金額 *</label>
                <input type="number" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
                  className="text-xs text-right border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400 w-36" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">メモ</label>
                <input type="text" value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="銀行振込など"
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400 w-40" />
              </div>
              <button onClick={handlePaySubmit} disabled={paySaving}
                className="text-xs px-4 py-1.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl font-semibold disabled:opacity-50">
                {paySaving ? '保存中…' : '消込を保存'}
              </button>
              <button onClick={() => setPayingId(null)}
                className="text-xs px-3 py-1.5 border border-slate-200 rounded-xl hover:bg-slate-50">
                キャンセル
              </button>
            </div>
          </div>
        )}

        {/* 一覧テーブル */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">取引先</th>
                <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest w-24">請求日</th>
                <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest w-24">支払期日</th>
                <th className="px-3 py-3 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest w-28">請求額</th>
                <th className="px-3 py-3 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest w-28">入金済み</th>
                <th className="px-3 py-3 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest w-28">残高</th>
                <th className="px-3 py-3 text-center text-[10px] font-semibold text-slate-400 uppercase tracking-widest w-20">状態</th>
                <th className="px-3 py-3 w-32"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {records.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">
                  {loading ? '読み込み中…' : 'レコードがありません'}
                </td></tr>
              )}
              {records.map((rec) => (
                <>
                  <tr key={rec.id} className={`hover:bg-slate-50/30 ${rec.computedStatus === 'paid' ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-2.5">
                      <div className="text-xs font-medium text-slate-700">{rec.counterparty}</div>
                      {rec.description && <div className="text-[10px] text-slate-400 truncate max-w-[180px]">{rec.description}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-slate-600">{fmtDate(rec.invoice_date)}</td>
                    <td className="px-3 py-2.5 text-xs font-mono text-slate-600">
                      {rec.due_date ? (
                        <span className={
                          rec.computedStatus !== 'paid' && rec.due_date < new Date().toISOString().slice(0, 10)
                            ? 'text-red-500 font-semibold' : ''
                        }>{fmtDate(rec.due_date)}</span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-right tabular-nums text-slate-700">{fmtYen(rec.amount)}</td>
                    <td className="px-3 py-2.5 text-xs text-right tabular-nums text-lime-700">{fmtYen(rec.paid_amount)}</td>
                    <td className="px-3 py-2.5 text-xs text-right tabular-nums font-semibold text-slate-800">
                      {rec.balance > 0 ? fmtYen(rec.balance) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${STATUS_COLOR[rec.computedStatus]}`}>
                        {statusLabels[rec.computedStatus]}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1 justify-end">
                        {rec.computedStatus !== 'paid' && (
                          <button
                            onClick={() => handleFullPay(rec)}
                            className="text-[10px] px-2 py-0.5 bg-sky-500 text-white rounded hover:bg-sky-600"
                          >消込</button>
                        )}
                        <button
                          onClick={() => setExpandedId(expandedId === rec.id ? null : rec.id)}
                          className="text-[10px] px-2 py-0.5 border border-slate-200 rounded hover:bg-slate-50"
                        >{expandedId === rec.id ? '閉じる' : '明細'}</button>
                        <button
                          onClick={() => handleDelete(rec.id)}
                          className="text-[10px] px-2 py-0.5 border border-red-200 text-red-500 rounded hover:bg-red-50"
                        >削除</button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === rec.id && (
                    <tr key={`${rec.id}-detail`} className="bg-sky-50/30">
                      <td colSpan={8} className="px-4 py-3">
                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">消込明細</p>
                        {rec.ar_ap_payments.length === 0 ? (
                          <p className="text-xs text-slate-400">消込記録なし</p>
                        ) : (
                          <div className="space-y-1">
                            {rec.ar_ap_payments.map((pay) => (
                              <div key={pay.id} className="flex items-center gap-3 text-xs text-slate-600">
                                <span className="font-mono">{fmtDate(pay.payment_date)}</span>
                                <span className="tabular-nums font-semibold text-lime-700">{fmtYen(pay.amount)}</span>
                                {pay.notes && <span className="text-slate-400">{pay.notes}</span>}
                                <button
                                  onClick={() => handleDeletePayment(rec.id, pay.id)}
                                  className="ml-auto text-[10px] text-red-400 hover:text-red-600"
                                >取消</button>
                              </div>
                            ))}
                          </div>
                        )}
                        <button
                          onClick={() => {
                            setPayingId(rec.id);
                            setPayForm({ payment_date: new Date().toISOString().slice(0, 10), amount: String(rec.balance > 0 ? rec.balance : ''), notes: '' });
                          }}
                          className="mt-2 text-[10px] text-sky-600 border border-sky-200 rounded px-2 py-0.5 hover:bg-sky-50"
                        >+ {isAr ? '入金' : '支払'}を追加</button>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm px-4 py-3">
      <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

export default function ArApPage() {
  return (
    <Suspense>
      <ArApInner />
    </Suspense>
  );
}
