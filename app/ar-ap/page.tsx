'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { JournalSidebarNav } from '@/components/JournalSidebarNav';

interface ClientItem { id: string; name: string; short_name?: string | null }

interface ArApRecord {
  id: string;
  type: 'ar' | 'ap';
  vendor_id: string | null;
  counterparty: string;
  account: string;            // 買掛金 / 未払金 / 未払費用 / 売掛金 / 未収入金
  invoice_date: string;       // 最古計上日
  due_date: string | null;
  amount: number;
  paid_amount: number;
  balance: number;
  computedStatus: 'open' | 'partial' | 'paid';
  description: string | null;
  entry_count: number;
  latest_entry_date: string | null;
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
  const initType = (sp.get('type') as 'ar' | 'ap') ?? 'ap';

  const [type, setType] = useState<'ar' | 'ap'>(initType);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [clientId, setClientId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [records, setRecords] = useState<ArApRecord[]>([]);
  const [stats, setStats] = useState<Stats>({ totalAmount: 0, totalPaid: 0, totalOpen: 0, count: 0 });
  const [loading, setLoading] = useState(false);

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

  // 取引先別ドリルダウンへの遷移（/general-ledger?account=...&vendor=...）
  const goLedger = (rec: ArApRecord) => {
    const params = new URLSearchParams();
    if (clientId) params.set('clientId', clientId);
    params.set('account', rec.account);
    if (rec.counterparty && rec.counterparty !== '(取引先未登録)') params.set('vendor', rec.counterparty);
    else if (rec.counterparty === '(取引先未登録)') params.set('vendor', '__unregistered__');
    window.open(`/general-ledger?${params.toString()}`, '_blank');
  };

  const isAr = type === 'ar';
  const statusLabels = isAr ? STATUS_LABEL : STATUS_LABEL_AP;

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-slate-50">
      <div className="max-w-6xl mx-auto px-4 py-8 flex gap-5 items-start">
        <JournalSidebarNav clientId={clientId} active="ar-ap" />
        <div className="flex-1 min-w-0">
        {/* ヘッダー */}
        <div className="flex items-center gap-3 mb-3">
          <Link href="/" className="text-sky-500 hover:text-sky-700 text-sm">← 日記帳</Link>
          <h1 className="text-xl font-bold text-slate-800">売掛金・買掛金 残高</h1>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">仕訳から自動派生</span>
        </div>
        <p className="text-[11px] text-slate-500 mb-5 leading-relaxed">
          仕訳の借方 / 貸方が <code className="bg-slate-100 px-1.5 py-0.5 rounded">買掛金 / 未払金 / 未払費用 / 売掛金 / 未収入金</code> に該当する行を、取引先 × 科目で集計して残高を表示します。
          残高を増減させたい場合は「+ 新規仕訳」ボタンから仕訳を起票してください（OCR / CSV インポート分も自動で反映されます）。
        </p>

        {/* タブ */}
        <div className="flex gap-1 mb-5 bg-white rounded-2xl border border-slate-100 shadow-sm p-1 w-fit">
          {(['ap', 'ar'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`text-sm px-5 py-2 rounded-xl font-semibold transition-all ${
                type === t ? 'bg-sky-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t === 'ar' ? '売掛金（未収）' : '買掛金・未払金（未払）'}
            </button>
          ))}
        </div>

        {/* 統計カード */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <StatCard label={isAr ? '請求総額' : '計上総額'} value={fmtYen(stats.totalAmount)} color="text-slate-700" />
          <StatCard label={isAr ? '入金済み' : '支払済み'} value={fmtYen(stats.totalPaid)} color="text-lime-700" />
          <StatCard label={isAr ? '未収残高' : '未払残高'} value={fmtYen(stats.totalOpen)} color={stats.totalOpen > 0 ? 'text-amber-600' : 'text-slate-400'} />
        </div>

        {/* フィルター */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 mb-5">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">顧問先</label>
              <select value={clientId} onChange={e => setClientId(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400 min-w-[140px]">
                <option value="">（共通）</option>
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
              {loading ? '集計中…' : '再集計'}
            </button>
            <span className="flex-1" />
            {!isAr && (
              <Link
                href={`/zengin${clientId ? `?clientId=${clientId}` : ''}`}
                className="text-xs px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-semibold transition-colors"
              >
                全銀出力
              </Link>
            )}
            <Link
              href="/"
              className="text-xs px-4 py-1.5 bg-violet-500 hover:bg-violet-600 text-white rounded-xl font-semibold transition-colors"
            >
              + 仕訳を追加
            </Link>
          </div>
        </div>

        {/* 一覧テーブル */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">取引先</th>
                <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest w-24">科目</th>
                <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest w-24">最古計上</th>
                <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest w-24">最新計上</th>
                <th className="px-3 py-3 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest w-28">{isAr ? '請求額' : '計上額'}</th>
                <th className="px-3 py-3 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest w-28">{isAr ? '入金済' : '支払済'}</th>
                <th className="px-3 py-3 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest w-28">残高</th>
                <th className="px-3 py-3 text-center text-[10px] font-semibold text-slate-400 uppercase tracking-widest w-20">状態</th>
                <th className="px-3 py-3 w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {records.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">
                  {loading ? '集計中…' : '該当する仕訳はありません'}
                </td></tr>
              )}
              {records.map((rec) => (
                <tr key={rec.id} className={`hover:bg-slate-50/30 ${rec.computedStatus === 'paid' ? 'opacity-60' : ''}`}>
                  <td className="px-3 py-2.5">
                    <div className="text-xs font-medium text-slate-700">{rec.counterparty}</div>
                    {rec.entry_count > 1 && (
                      <div className="text-[10px] text-slate-400">{rec.entry_count} 件の仕訳</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{rec.account}</td>
                  <td className="px-3 py-2.5 text-xs font-mono text-slate-600">{fmtDate(rec.invoice_date)}</td>
                  <td className="px-3 py-2.5 text-xs font-mono text-slate-600">{fmtDate(rec.latest_entry_date)}</td>
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
                      <button
                        onClick={() => goLedger(rec)}
                        className="text-[10px] px-2 py-0.5 border border-slate-200 rounded hover:bg-slate-50"
                      >元帳</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
