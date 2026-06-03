'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { JournalSidebarNav } from '@/components/JournalSidebarNav';

interface ClientItem { id: string; name: string; short_name?: string | null; }
interface FiscalPeriod { id: string; name: string; start_date: string; end_date: string; }

interface CategoryStat { count: number; amount: number; }
interface TaxSummaryData {
  period: { from: string; to: string };
  categories: {
    taxable_sales: CategoryStat;
    tax_exempt_sales: CategoryStat;
    taxable_purchase: CategoryStat;
    non_taxable: CategoryStat;
    unclassified: CategoryStat;
  };
  honzoku: { sales_tax: number; purchase_tax: number; payable: number };
  totals: { total_sales: number; taxable_ratio: number | null };
}

function fmt(n: number) {
  return `¥${Math.abs(n).toLocaleString()}`;
}
function pct(r: number | null) {
  if (r === null) return '—';
  return `${(r * 100).toFixed(1)}%`;
}

function TaxSummaryInner() {
  const sp = useSearchParams();
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [clientId, setClientId] = useState(sp.get('clientId') ?? '');
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TaxSummaryData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(j => setClients(j.clients ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (clientId) params.set('clientId', clientId);
    fetch(`/api/fiscal-periods?${params}`).then(r => r.json()).then(j => setPeriods(j.periods ?? [])).catch(() => {});
  }, [clientId]);

  const fetchSummary = async () => {
    if (!from || !to) { alert('期間を指定してください'); return; }
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const params = new URLSearchParams({ from, to });
      if (clientId) params.set('clientId', clientId);
      const res = await fetch(`/api/tax-summary?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '集計失敗');
      setData(json as TaxSummaryData);
    } catch (e) {
      setError(e instanceof Error ? e.message : '集計失敗');
    } finally {
      setLoading(false);
    }
  };

  const applyPeriod = (p: FiscalPeriod) => {
    setFrom(p.start_date);
    setTo(p.end_date);
  };

  const d = data;

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-8 flex gap-5 items-start">
        <JournalSidebarNav clientId={clientId} active="tax-summary" />
        <div className="flex-1 min-w-0">
        {/* ヘッダー */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/" className="text-sky-500 hover:text-sky-700 text-sm">← 日記帳</Link>
          <h1 className="text-xl font-bold text-slate-800">消費税集計レポート</h1>
        </div>

        {/* フィルター */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            {/* 顧問先 */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">顧問先</label>
              <select
                value={clientId}
                onChange={e => setClientId(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400"
              >
                <option value="">（共通）</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.short_name ?? c.name}</option>)}
              </select>
            </div>
            {/* 開始日 */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">開始日</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400" />
            </div>
            {/* 終了日 */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">終了日</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400" />
            </div>
          </div>

          {/* 会計期間クイック選択 */}
          {periods.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {periods.map(p => (
                <button key={p.id} type="button" onClick={() => applyPeriod(p)}
                  className="text-[11px] px-3 py-1 rounded-full border border-sky-200 text-sky-700 hover:bg-sky-50 transition-colors">
                  {p.name}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={fetchSummary}
            disabled={loading}
            className="w-full py-2.5 bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {loading ? '集計中…' : '集計する'}
          </button>
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        </div>

        {/* 結果 */}
        {d && (
          <div className="space-y-4">
            {/* 未分類警告 */}
            {d.categories.unclassified.count > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2">
                <span className="text-amber-500 mt-0.5">⚠</span>
                <div className="text-sm text-amber-800">
                  <span className="font-semibold">{d.categories.unclassified.count}件</span> が未分類です（合計
                  {' '}{fmt(d.categories.unclassified.amount)}）。仕訳一覧で消費税区分を設定してください。
                  <Link href="/" className="ml-1 underline text-amber-700">→ 日記帳へ</Link>
                </div>
              </div>
            )}

            {/* 売上の区分 */}
            <Section title="売上の区分">
              <Row label="課税売上高" badge="課税売上" badgeColor="bg-sky-100 text-sky-700"
                count={d.categories.taxable_sales.count} amount={d.categories.taxable_sales.amount} />
              <Row label="非課税売上高" badge="非課税売上" badgeColor="bg-slate-100 text-slate-600"
                count={d.categories.tax_exempt_sales.count} amount={d.categories.tax_exempt_sales.amount} />
              <TotalRow label="売上合計" amount={d.totals.total_sales} />
              <InfoRow label="課税売上割合" value={pct(d.totals.taxable_ratio)} note="(課税売上 ÷ 売上合計)" />
            </Section>

            {/* 仕入・経費の区分 */}
            <Section title="仕入・経費の区分">
              <Row label="課税仕入高" badge="課税仕入" badgeColor="bg-lime-100 text-lime-700"
                count={d.categories.taxable_purchase.count} amount={d.categories.taxable_purchase.amount} />
              <Row label="免税・不課税" badge="免税・不課税" badgeColor="bg-amber-100 text-amber-700"
                count={d.categories.non_taxable.count} amount={d.categories.non_taxable.amount} />
            </Section>

            {/* 消費税計算（本則課税・内税10%） */}
            <Section title="消費税計算（本則課税・内税10%）">
              <CalcRow label="課税売上に係る消費税額" formula={`${fmt(d.categories.taxable_sales.amount)} × 10/110`} amount={d.honzoku.sales_tax} />
              <CalcRow label="仕入税額控除" formula={`${fmt(d.categories.taxable_purchase.amount)} × 10/110`} amount={d.honzoku.purchase_tax} minus />
              <div className="border-t border-slate-100 mt-2 pt-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-slate-800">差引 納付税額（概算）</span>
                  <span className={`text-lg font-bold tabular-nums ${d.honzoku.payable >= 0 ? 'text-red-600' : 'text-lime-700'}`}>
                    {d.honzoku.payable >= 0 ? '' : '△'}{fmt(d.honzoku.payable)}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  ※ 概算値です。実際の申告では国税庁様式に従い正確に計算してください。
                </p>
              </div>
            </Section>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

export default function TaxSummaryPage() {
  return (
    <Suspense>
      <TaxSummaryInner />
    </Suspense>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
        <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{title}</h2>
      </div>
      <div className="p-4 space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, badge, badgeColor, count, amount }: {
  label: string; badge: string; badgeColor: string; count: number; amount: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${badgeColor}`}>{badge}</span>
        <span className="text-sm text-slate-700">{label}</span>
        <span className="text-[10px] text-slate-400">{count}件</span>
      </div>
      <span className="text-sm font-semibold tabular-nums text-slate-900">{fmt(amount)}</span>
    </div>
  );
}

function TotalRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-center justify-between border-t border-slate-100 pt-2 mt-1">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <span className="text-sm font-bold tabular-nums text-slate-900">{fmt(amount)}</span>
    </div>
  );
}

function InfoRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-500">{label} <span className="text-[10px] text-slate-400">{note}</span></span>
      <span className="text-sm font-semibold tabular-nums text-sky-700">{value}</span>
    </div>
  );
}

function CalcRow({ label, formula, amount, minus }: {
  label: string; formula: string; amount: number; minus?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-slate-700">{minus ? '（控除）' : ''}{label}</p>
        <p className="text-[10px] text-slate-400 font-mono">{formula}</p>
      </div>
      <span className="text-sm font-semibold tabular-nums text-slate-900">
        {minus ? '△' : ''}{fmt(amount)}
      </span>
    </div>
  );
}
