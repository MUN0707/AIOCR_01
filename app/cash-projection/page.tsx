'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface ClientItem { id: string; name: string; short_name?: string | null }

interface BreakdownItem { account: string; amount: number; category: string }
interface MonthData {
  month: number;
  openingBalance: number;
  totalInflow: number;
  totalOutflow: number;
  closingBalance: number;
  inflowBreakdown: BreakdownItem[];
  outflowBreakdown: BreakdownItem[];
}
interface ProjectionData {
  year: number;
  openingBalance: number;
  cashAccounts: string[];
  months: MonthData[];
}

const MONTH_NAMES = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

function fmtYen(n: number, showSign = false) {
  const abs = Math.abs(Math.round(n));
  const sign = showSign && n > 0 ? '+' : '';
  const neg = n < 0 ? '-' : '';
  return neg + sign + '¥' + abs.toLocaleString();
}

function BalanceBadge({ amount }: { amount: number }) {
  const color = amount >= 0 ? 'text-slate-700' : 'text-red-600 font-semibold';
  return <span className={`font-mono ${color}`}>{fmtYen(amount)}</span>;
}

function CashProjectionInner() {
  const sp = useSearchParams();
  const currentYear = new Date().getFullYear();

  const [clients, setClients] = useState<ClientItem[]>([]);
  const [clientId, setClientId] = useState(sp.get('clientId') ?? '');
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState<ProjectionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(j => setClients(j.clients ?? [])).catch(() => {});
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setData(null);
    try {
      const p = new URLSearchParams({ year: String(year) });
      if (clientId) p.set('clientId', clientId);
      const res = await fetch(`/api/cash-projection?${p}`);
      const json = await res.json();
      if (res.ok) setData(json);
    } catch {}
    finally { setLoading(false); }
  }, [clientId, year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const clientName = clients.find(c => c.id === clientId)?.name ?? null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-lime-50 p-4 md:p-8">
      <div className="max-w-[1100px] mx-auto space-y-6">

        {/* ヘッダー */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">資金繰り表</h1>
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
          <button
            onClick={fetchData}
            disabled={loading}
            className="ml-auto text-xs font-semibold text-sky-600 bg-sky-50 border border-sky-200 rounded-xl px-4 py-2 hover:bg-sky-100 disabled:opacity-50 transition-all"
          >
            {loading ? '集計中…' : '再集計'}
          </button>
        </div>

        {/* 現金科目バッジ */}
        {data && data.cashAccounts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">
            <span className="text-xs text-slate-400">対象科目:</span>
            {data.cashAccounts.map(a => (
              <span key={a} className="text-xs bg-white border border-slate-200 rounded-full px-2.5 py-0.5 text-slate-600">{a}</span>
            ))}
          </div>
        )}

        {loading ? (
          <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center shadow-sm">
            <p className="text-sm text-slate-400">集計中…</p>
          </div>
        ) : !data ? null : data.months.every(m => m.totalInflow === 0 && m.totalOutflow === 0) ? (
          <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center shadow-sm">
            <p className="text-sm font-semibold text-slate-700">現金・預金の入出金データがありません</p>
            <p className="text-xs text-slate-400 mt-2">仕訳に「現金」「普通預金」等の科目が含まれていない場合は表示されません</p>
          </div>
        ) : (
          <>
            {/* サマリカード */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: '年初残高', value: data.openingBalance, color: 'text-slate-700' },
                { label: '年間収入計', value: data.months.reduce((s,m) => s+m.totalInflow, 0), color: 'text-lime-700' },
                { label: '年間支出計', value: data.months.reduce((s,m) => s+m.totalOutflow, 0), color: 'text-red-500' },
                { label: '年末残高', value: data.months[11].closingBalance, color: data.months[11].closingBalance >= 0 ? 'text-slate-800' : 'text-red-600' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
                  <p className="text-xs text-slate-400 mb-1">{label}</p>
                  <p className={`text-lg font-bold font-mono ${color}`}>¥{Math.abs(value).toLocaleString()}</p>
                </div>
              ))}
            </div>

            {/* 月次グリッド */}
            <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-700">{year}年 月次資金繰り</h2>
                <p className="text-xs text-slate-400 mt-0.5">行をクリックすると内訳が展開されます</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase sticky left-0 bg-slate-50 min-w-[80px]">項目</th>
                      {MONTH_NAMES.map((mn, i) => (
                        <th key={i} className="px-2 py-2.5 text-right text-[10px] font-semibold text-slate-400 min-w-[90px]">{mn}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* 月初残高 */}
                    <tr className="border-b border-slate-50 bg-slate-50/30">
                      <td className="px-3 py-2 font-semibold text-slate-600 sticky left-0 bg-slate-50/30">月初残高</td>
                      {data.months.map(m => (
                        <td key={m.month} className="px-2 py-2 text-right">
                          <BalanceBadge amount={m.openingBalance} />
                        </td>
                      ))}
                    </tr>

                    {/* 収入 */}
                    <tr
                      className="border-b border-slate-50 hover:bg-lime-50/30 cursor-pointer"
                      onClick={() => setExpandedMonth(prev => prev === -1 ? null : -1)}
                    >
                      <td className="px-3 py-2 font-medium text-lime-700 sticky left-0 bg-white">
                        <span className="flex items-center gap-1">
                          <span className="text-[10px]">{expandedMonth === -1 ? '▾' : '▸'}</span>
                          収入計
                        </span>
                      </td>
                      {data.months.map(m => (
                        <td key={m.month} className="px-2 py-2 text-right font-mono font-semibold text-lime-700">
                          {m.totalInflow > 0 ? '¥' + m.totalInflow.toLocaleString() : <span className="text-slate-200">—</span>}
                        </td>
                      ))}
                    </tr>

                    {/* 収入内訳（展開時） */}
                    {expandedMonth === -1 && (() => {
                      const allInflowAccounts = new Set(data.months.flatMap(m => m.inflowBreakdown.map(b => b.account)));
                      return [...allInflowAccounts].map(acc => (
                        <tr key={`in-${acc}`} className="border-b border-slate-50 bg-lime-50/20">
                          <td className="px-3 py-1.5 pl-7 text-slate-600 sticky left-0 bg-lime-50/20 truncate max-w-[120px]" title={acc}>{acc}</td>
                          {data.months.map(m => {
                            const item = m.inflowBreakdown.find(b => b.account === acc);
                            return (
                              <td key={m.month} className="px-2 py-1.5 text-right font-mono text-lime-600 text-[11px]">
                                {item ? '¥' + item.amount.toLocaleString() : <span className="text-slate-100">—</span>}
                              </td>
                            );
                          })}
                        </tr>
                      ));
                    })()}

                    {/* 支出 */}
                    <tr
                      className="border-b border-slate-50 hover:bg-red-50/20 cursor-pointer"
                      onClick={() => setExpandedMonth(prev => prev === -2 ? null : -2)}
                    >
                      <td className="px-3 py-2 font-medium text-red-600 sticky left-0 bg-white">
                        <span className="flex items-center gap-1">
                          <span className="text-[10px]">{expandedMonth === -2 ? '▾' : '▸'}</span>
                          支出計
                        </span>
                      </td>
                      {data.months.map(m => (
                        <td key={m.month} className="px-2 py-2 text-right font-mono font-semibold text-red-500">
                          {m.totalOutflow > 0 ? '¥' + m.totalOutflow.toLocaleString() : <span className="text-slate-200">—</span>}
                        </td>
                      ))}
                    </tr>

                    {/* 支出内訳（展開時） */}
                    {expandedMonth === -2 && (() => {
                      const allOutflowAccounts = new Set(data.months.flatMap(m => m.outflowBreakdown.map(b => b.account)));
                      return [...allOutflowAccounts].map(acc => (
                        <tr key={`out-${acc}`} className="border-b border-slate-50 bg-red-50/10">
                          <td className="px-3 py-1.5 pl-7 text-slate-600 sticky left-0 bg-red-50/10 truncate max-w-[120px]" title={acc}>{acc}</td>
                          {data.months.map(m => {
                            const item = m.outflowBreakdown.find(b => b.account === acc);
                            return (
                              <td key={m.month} className="px-2 py-1.5 text-right font-mono text-red-400 text-[11px]">
                                {item ? '¥' + item.amount.toLocaleString() : <span className="text-slate-100">—</span>}
                              </td>
                            );
                          })}
                        </tr>
                      ));
                    })()}

                    {/* 月末残高 */}
                    <tr className="border-t-2 border-slate-200 bg-slate-50">
                      <td className="px-3 py-2.5 font-semibold text-slate-700 sticky left-0 bg-slate-50">月末残高</td>
                      {data.months.map(m => (
                        <td key={m.month} className={`px-2 py-2.5 text-right font-semibold font-mono ${m.closingBalance < 0 ? 'text-red-600 bg-red-50/50' : 'text-slate-700'}`}>
                          {fmtYen(m.closingBalance)}
                        </td>
                      ))}
                    </tr>

                    {/* 前月比増減 */}
                    <tr className="border-b border-slate-50">
                      <td className="px-3 py-2 text-slate-400 text-[10px] sticky left-0 bg-white">前月比</td>
                      {data.months.map((m, i) => {
                        const prev = i === 0 ? data.openingBalance : data.months[i-1].closingBalance;
                        const diff = m.closingBalance - prev;
                        return (
                          <td key={m.month} className={`px-2 py-2 text-right font-mono text-[11px] ${diff >= 0 ? 'text-lime-600' : 'text-red-500'}`}>
                            {diff !== 0 ? (diff > 0 ? '+' : '') + fmtYen(diff) : <span className="text-slate-200">±0</span>}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CashProjectionPage() {
  return (
    <Suspense>
      <CashProjectionInner />
    </Suspense>
  );
}
