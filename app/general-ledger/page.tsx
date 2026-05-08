'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface LedgerEntry {
  id: string;
  entry_date: string;
  debit_account: string;
  credit_account: string;
  amount: number | null;
  // 多明細仕訳では片側だけ別の値を持つことがあるので per-side を優先する
  debit_amount?: number | null;
  credit_amount?: number | null;
  vendor_name: string;
  description: string;
  voucher_group_id?: string | null;
  entry_type?: string | null;
  ocr_upload_id?: string | null;
  bank_ocr_upload_id?: string | null;
}

interface ClientItem {
  id: string;
  name: string;
  short_name?: string | null;
  legal_name?: string | null;
}

function formatYmd(s: string | null | undefined): string {
  if (!s || s === '不明') return '—';
  if (s.length === 8) return `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)}`;
  return s;
}

function GeneralLedgerInner() {
  const sp = useSearchParams();
  const initialClientId = sp.get('clientId') || '';
  const initialAccount = sp.get('account') || '';
  const initialFrom = sp.get('from') || '';
  const initialTo = sp.get('to') || '';
  const initialVendor = sp.get('vendor') || '';

  const [clientId, setClientId] = useState<string>(initialClientId);
  const [account, setAccount] = useState<string>(initialAccount);
  const [from, setFrom] = useState<string>(initialFrom);
  const [to, setTo] = useState<string>(initialTo);

  const [clients, setClients] = useState<ClientItem[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 取引先絞り込み（フリー入力＝部分一致 + URL由来＝完全一致 or 未登録）
  const [vendorFilter, setVendorFilter] = useState<string>('');
  // '__unregistered__' は vendor_name が空のもの。空文字 '' は完全一致フィルタ無効。
  const [vendorExact, setVendorExact] = useState<string>(initialVendor);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/clients');
        const json = await res.json();
        if (res.ok) setClients(json.clients ?? []);
      } catch {}
    })();
  }, []);

  // 科目一覧は journal-balance から取得（全エントリを引かずに済む）
  const [accountOptions, setAccountOptions] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams();
        if (clientId) params.set('clientId', clientId);
        const res = await fetch(`/api/journal-balance?${params}`);
        const json = await res.json();
        if (res.ok) {
          setAccountOptions((json.accounts ?? []).slice().sort((a: string, b: string) => a.localeCompare(b, 'ja')));
        }
      } catch {}
    })();
  }, [clientId]);

  // 科目が選択されたときだけ全件取得（account + 日付フィルタを API に渡す）
  useEffect(() => {
    if (!account) { setEntries([]); return; }
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (clientId) params.set('clientId', clientId);
        params.set('account', account);
        params.set('limit', '100000');
        if (from) params.set('startDate', from.replace(/-/g, ''));
        if (to) params.set('endDate', to.replace(/-/g, ''));
        const res = await fetch(`/api/journal-ledger?${params}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || '読み込みに失敗しました');
        setEntries(json.entries ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : '読み込みに失敗しました');
      } finally {
        setLoading(false);
      }
    })();
  }, [clientId, account, from, to]);

  const fromYmd = from ? from.replace(/-/g, '') : '';
  const toYmd = to ? to.replace(/-/g, '') : '';

  const ledgerLines = useMemo(() => {
    if (!account) return [] as Array<{
      entry: LedgerEntry; side: 'debit' | 'credit'; counter: string; debit: number; credit: number; balance: number;
    }>;
    const filtered = entries
      .filter((e) => {
        if (e.debit_account !== account && e.credit_account !== account) return false;
        const d = e.entry_date;
        if (!d || d === '不明' || d.length !== 8) return !fromYmd && !toYmd;
        if (fromYmd && d < fromYmd) return false;
        if (toYmd && d > toYmd) return false;
        if (vendorFilter && !(e.vendor_name || '').toLowerCase().includes(vendorFilter.toLowerCase())) return false;
        if (vendorExact) {
          const vn = (e.vendor_name || '').trim();
          if (vendorExact === '__unregistered__') {
            if (vn) return false;
          } else if (vn !== vendorExact) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        if (a.entry_date !== b.entry_date) return a.entry_date.localeCompare(b.entry_date);
        return a.id.localeCompare(b.id);
      });

    let bal = 0;
    return filtered.map((e) => {
      const amt = e.amount ?? 0;
      const side: 'debit' | 'credit' = e.debit_account === account ? 'debit' : 'credit';
      const counter = side === 'debit' ? e.credit_account : e.debit_account;
      // 多明細仕訳では debit_amount / credit_amount が異なる
      // GLでは「この科目の側に立った金額」を出さなければならないので per-side を採用する
      const debit = side === 'debit' ? Number(e.debit_amount ?? amt) : 0;
      const credit = side === 'credit' ? Number(e.credit_amount ?? amt) : 0;
      bal += debit - credit;
      return { entry: e, side, counter, debit, credit, balance: bal };
    });
  }, [entries, account, fromYmd, toYmd, vendorFilter, vendorExact]);

  const totalDebit = ledgerLines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = ledgerLines.reduce((s, l) => s + l.credit, 0);
  const finalBalance = ledgerLines.length > 0 ? ledgerLines[ledgerLines.length - 1].balance : 0;

  const clientName = clients.find((c) => c.id === clientId)?.name ?? '個人/未設定';

  return (
    <div className="min-h-screen bg-slate-50/40 px-6 py-8">
      <div className="max-w-[1280px] mx-auto space-y-5">
        {/* ヘッダ */}
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-lg font-semibold text-slate-900 tracking-tight">総勘定元帳</h1>
              <p className="text-xs text-slate-400 mt-0.5">
                {account ? `${account} の取引明細` : '勘定科目を選択してください'} · {clientName}
                {vendorExact && (
                  <span className="ml-2 inline-flex items-center gap-1 text-[11px] bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full">
                    取引先: {vendorExact === '__unregistered__' ? '(未登録)' : vendorExact}
                    <button
                      type="button"
                      onClick={() => setVendorExact('')}
                      className="text-sky-400 hover:text-sky-700 ml-0.5"
                      title="取引先フィルタを解除"
                    >×</button>
                  </span>
                )}
              </p>
            </div>
            <Link
              href="/"
              className="text-xs text-slate-500 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50"
            >
              ← トップへ
            </Link>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">クライアント</p>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-sky-400 min-w-[200px]"
              >
                <option value="">個人/未設定</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">勘定科目</p>
              <input
                list="account-options"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="例：保守料"
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-sky-400 min-w-[200px]"
              />
              <datalist id="account-options">
                {accountOptions.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">開始日</p>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-sky-400"
              />
            </div>
            <span className="text-slate-300 pb-2">〜</span>
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">終了日</p>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">取引先</p>
              <input
                value={vendorFilter}
                onChange={(e) => setVendorFilter(e.target.value)}
                placeholder="取引先名で絞り込み"
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-sky-400 min-w-[160px]"
              />
            </div>
          </div>
        </div>

        {/* 集計サマリ */}
        {account && ledgerLines.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-4">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">借方合計</p>
              <p className="text-lg font-semibold text-sky-600 tabular-nums mt-1">¥{totalDebit.toLocaleString()}</p>
            </div>
            <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-4">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">貸方合計</p>
              <p className="text-lg font-semibold text-lime-600 tabular-nums mt-1">¥{totalCredit.toLocaleString()}</p>
            </div>
            <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-4">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">期末残高（借−貸）</p>
              <p className={`text-lg font-bold tabular-nums mt-1 ${finalBalance >= 0 ? 'text-sky-700' : 'text-amber-600'}`}>
                ¥{finalBalance.toLocaleString()}
              </p>
            </div>
          </div>
        )}

        {/* 明細テーブル */}
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-10 text-center">
              <div className="w-8 h-8 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin mx-auto" />
              <p className="text-xs text-slate-400 mt-3">読み込み中...</p>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-100 px-5 py-4 text-sm text-red-600">{error}</div>
          ) : !account ? (
            <div className="p-10 text-center text-sm text-slate-400">
              上のフォームから勘定科目を選択してください
            </div>
          ) : ledgerLines.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">
              指定条件に該当する仕訳はありません
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="bg-slate-50/60">
                  <tr className="border-b border-slate-100">
                    <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">日付</th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">相手科目</th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">取引先</th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">摘要</th>
                    <th className="px-3 py-3 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest">借方</th>
                    <th className="px-3 py-3 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest">貸方</th>
                    <th className="px-3 py-3 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest">残高</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {ledgerLines.map((l, i) => (
                    <tr key={`${l.entry.id}-${i}`} className="hover:bg-slate-50/40">
                      <td className="px-3 py-2 text-xs font-mono text-slate-600 whitespace-nowrap">{formatYmd(l.entry.entry_date)}</td>
                      <td className="px-3 py-2 text-xs text-slate-700">
                        {l.counter && l.counter !== '不明' ? l.counter : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{l.entry.vendor_name || <span className="text-slate-300">—</span>}</td>
                      <td className="px-3 py-2 text-xs text-slate-500 truncate max-w-[300px]" title={l.entry.description}>
                        {l.entry.description || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-sky-600">
                        {l.debit > 0 ? `¥${l.debit.toLocaleString()}` : <span className="text-slate-200">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-lime-600">
                        {l.credit > 0 ? `¥${l.credit.toLocaleString()}` : <span className="text-slate-200">—</span>}
                      </td>
                      <td className={`px-3 py-2 text-right text-xs font-semibold tabular-nums ${l.balance >= 0 ? 'text-slate-700' : 'text-amber-600'}`}>
                        ¥{l.balance.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50/80 border-t-2 border-slate-200">
                    <td colSpan={4} className="px-3 py-2 text-xs font-bold text-slate-700 text-right">合計</td>
                    <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-sky-700">¥{totalDebit.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-lime-700">¥{totalCredit.toLocaleString()}</td>
                    <td className={`px-3 py-2 text-right text-xs font-bold tabular-nums ${finalBalance >= 0 ? 'text-slate-900' : 'text-amber-700'}`}>
                      ¥{finalBalance.toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function GeneralLedgerPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-sm text-slate-400">読み込み中...</div>}>
      <GeneralLedgerInner />
    </Suspense>
  );
}
