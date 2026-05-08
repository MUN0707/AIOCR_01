'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface ClientItem { id: string; name: string; short_name?: string | null }

interface CompanySettings {
  company_name_kana: string;
  bank_code: string;
  branch_code: string;
  account_type: string;
  account_number: string;
  account_name_kana: string;
  requestor_code: string;
}

interface Vendor {
  id: string;
  name: string;
  bank_code: string | null;
  branch_code: string | null;
  account_type: string | null;
  account_number: string | null;
  account_name_kana: string | null;
}

interface ArApRecord {
  id: string;
  counterparty: string;
  invoice_date: string;
  due_date: string | null;
  amount: number;
  paid_amount: number;
  balance: number;
  computedStatus: 'open' | 'partial' | 'paid';
}

const EMPTY_SETTINGS: CompanySettings = {
  company_name_kana: '', bank_code: '', branch_code: '',
  account_type: '1', account_number: '', account_name_kana: '', requestor_code: '',
};

const ACCOUNT_TYPE_LABEL: Record<string, string> = { '1': '普通', '2': '当座', '4': '貯蓄' };

function ZenginInner() {
  const sp = useSearchParams();
  const initClientId = sp.get('clientId') ?? '';

  const [clientId, setClientId] = useState(initClientId);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [settings, setSettings] = useState<CompanySettings>(EMPTY_SETTINGS);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [vendorForm, setVendorForm] = useState<Omit<Vendor, 'id' | 'name'>>({
    bank_code: '', branch_code: '', account_type: '1', account_number: '', account_name_kana: '',
  });
  const [vendorSaving, setVendorSaving] = useState(false);

  const [apRecords, setApRecords] = useState<ArApRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [paymentDate, setPaymentDate] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(j => setClients(j.clients ?? [])).catch(() => {});
  }, []);

  const fetchSettings = useCallback(async () => {
    const params = new URLSearchParams();
    if (clientId) params.set('clientId', clientId);
    const res = await fetch(`/api/company-settings?${params}`);
    const json = await res.json();
    if (res.ok && json.settings) {
      setSettings({
        company_name_kana: json.settings.company_name_kana ?? '',
        bank_code: json.settings.bank_code ?? '',
        branch_code: json.settings.branch_code ?? '',
        account_type: json.settings.account_type ?? '1',
        account_number: json.settings.account_number ?? '',
        account_name_kana: json.settings.account_name_kana ?? '',
        requestor_code: json.settings.requestor_code ?? '',
      });
    } else {
      setSettings(EMPTY_SETTINGS);
    }
  }, [clientId]);

  const fetchVendors = useCallback(async () => {
    const params = new URLSearchParams();
    if (clientId) params.set('clientId', clientId);
    const res = await fetch(`/api/vendors?${params}`);
    const json = await res.json();
    setVendors(json.vendors ?? []);
  }, [clientId]);

  const fetchApRecords = useCallback(async () => {
    const params = new URLSearchParams({ type: 'ap' });
    if (clientId) params.set('clientId', clientId);
    params.set('status', 'open,partial');
    const res = await fetch(`/api/ar-ap?${params}`);
    const json = await res.json();
    setApRecords((json.records ?? []).filter((r: ArApRecord) => r.balance > 0));
    setSelectedIds(new Set());
  }, [clientId]);

  useEffect(() => {
    fetchSettings();
    fetchVendors();
    fetchApRecords();
  }, [fetchSettings, fetchVendors, fetchApRecords]);

  const saveSettings = async () => {
    setSettingsSaving(true);
    setSettingsMsg(null);
    try {
      const res = await fetch('/api/company-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, client_id: clientId || null }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      setSettingsMsg('保存しました');
      setTimeout(() => setSettingsMsg(null), 2000);
    } catch (e) {
      setSettingsMsg(e instanceof Error ? e.message : '保存失敗');
    } finally {
      setSettingsSaving(false);
    }
  };

  const openVendorEdit = (v: Vendor) => {
    setEditingVendorId(v.id);
    setVendorForm({
      bank_code: v.bank_code ?? '',
      branch_code: v.branch_code ?? '',
      account_type: v.account_type ?? '1',
      account_number: v.account_number ?? '',
      account_name_kana: v.account_name_kana ?? '',
    });
  };

  const saveVendorBank = async () => {
    if (!editingVendorId) return;
    setVendorSaving(true);
    try {
      const res = await fetch(`/api/vendors/${editingVendorId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vendorForm),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      setEditingVendorId(null);
      await fetchVendors();
    } catch (e) {
      alert(e instanceof Error ? e.message : '保存失敗');
    } finally {
      setVendorSaving(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(apRecords.map(r => r.id)));
  const clearAll = () => setSelectedIds(new Set());

  const generateFile = async () => {
    if (!paymentDate) { alert('振込日を指定してください'); return; }
    if (selectedIds.size === 0) { alert('振込対象を選択してください'); return; }
    setGenerating(true);
    setGenError(null);
    try {
      const params = new URLSearchParams();
      if (clientId) params.set('clientId', clientId);
      params.set('paymentDate', paymentDate);
      params.set('ids', [...selectedIds].join(','));
      const res = await fetch(`/api/zengin-export?${params}`);
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = paymentDate.replace(/-/g, '');
      a.download = `全銀振込_${dateStr}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : '生成失敗');
    } finally {
      setGenerating(false);
    }
  };

  const totalSelected = apRecords
    .filter(r => selectedIds.has(r.id))
    .reduce((s, r) => s + r.balance, 0);

  const vendorsWithBank = vendors.filter(v => v.bank_code && v.account_number);
  const vendorsWithoutBank = vendors.filter(v => !v.bank_code || !v.account_number);

  const sf = (k: keyof CompanySettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setSettings(prev => ({ ...prev, [k]: e.target.value }));
  const vf = (k: keyof typeof vendorForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setVendorForm(prev => ({ ...prev, [k]: e.target.value }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-slate-50 p-6 space-y-6">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* ヘッダー */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800">全銀データ出力</h1>
            <p className="text-xs text-slate-500 mt-0.5">総合振込ファイル（全銀協標準フォーマット・Shift-JIS）を生成します</p>
          </div>
          <Link href="/" className="text-xs text-sky-600 hover:underline">← 日記帳へ</Link>
        </div>

        {/* 顧問先フィルタ */}
        {clients.length > 0 && (
          <div className="bg-white border border-slate-100 rounded-2xl px-5 py-4 shadow-sm">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">顧問先</p>
            <select value={clientId} onChange={e => setClientId(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-sky-400">
              <option value="">（共通設定）</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        {/* ─── 自社銀行情報 ─── */}
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-sky-50/40">
            <p className="text-sm font-semibold text-sky-700 tracking-tight">自社銀行情報（依頼人）</p>
            <p className="text-[10px] text-sky-500/70 mt-0.5">全銀ヘッダレコードに使用されます</p>
          </div>
          <div className="p-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">依頼人名（カナ）</p>
              <input value={settings.company_name_kana} onChange={sf('company_name_kana')} maxLength={40}
                placeholder="カブシキガイシヤ〇〇"
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-sky-400" />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">銀行コード（4桁）</p>
              <input value={settings.bank_code} onChange={sf('bank_code')} maxLength={4}
                placeholder="0001"
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-sky-400" />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">支店コード（3桁）</p>
              <input value={settings.branch_code} onChange={sf('branch_code')} maxLength={3}
                placeholder="001"
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-sky-400" />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">口座種別</p>
              <select value={settings.account_type} onChange={sf('account_type')}
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-sky-400">
                <option value="1">普通</option>
                <option value="2">当座</option>
                <option value="4">貯蓄</option>
              </select>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">口座番号（7桁）</p>
              <input value={settings.account_number} onChange={sf('account_number')} maxLength={7}
                placeholder="1234567"
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-sky-400" />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">依頼人コード（任意）</p>
              <input value={settings.requestor_code} onChange={sf('requestor_code')} maxLength={10}
                placeholder="（銀行発行コード）"
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-sky-400" />
            </div>
          </div>
          <div className="px-5 pb-5 flex items-center gap-3">
            <button onClick={saveSettings} disabled={settingsSaving}
              className="text-xs text-white bg-sky-500 rounded-xl px-4 py-2 font-semibold hover:bg-sky-600 disabled:opacity-50">
              {settingsSaving ? '保存中...' : '保存'}
            </button>
            {settingsMsg && <span className="text-xs text-slate-500">{settingsMsg}</span>}
          </div>
        </div>

        {/* ─── 取引先銀行情報 ─── */}
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-lime-50/40 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-lime-700 tracking-tight">取引先銀行情報</p>
              <p className="text-[10px] text-lime-600/70 mt-0.5">
                登録済 {vendorsWithBank.length} 件 / 未登録 {vendorsWithoutBank.length} 件
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-slate-50">
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">取引先名</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">銀行</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">支店</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">種別</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">口座番号</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">口座名義</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {vendors.map(v => (
                  <tr key={v.id} className="hover:bg-slate-50/30">
                    <td className="px-4 py-2 text-xs font-medium text-slate-700">{v.name}</td>
                    {editingVendorId === v.id ? (
                      <>
                        <td className="px-2 py-1.5">
                          <input value={vendorForm.bank_code ?? ''} onChange={vf('bank_code')} maxLength={4}
                            placeholder="0001" className="w-16 border border-sky-300 rounded px-1.5 py-1 text-xs font-mono focus:outline-none" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input value={vendorForm.branch_code ?? ''} onChange={vf('branch_code')} maxLength={3}
                            placeholder="001" className="w-12 border border-sky-300 rounded px-1.5 py-1 text-xs font-mono focus:outline-none" />
                        </td>
                        <td className="px-2 py-1.5">
                          <select value={vendorForm.account_type ?? '1'} onChange={vf('account_type')}
                            className="border border-sky-300 rounded px-1.5 py-1 text-xs focus:outline-none">
                            <option value="1">普通</option>
                            <option value="2">当座</option>
                            <option value="4">貯蓄</option>
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input value={vendorForm.account_number ?? ''} onChange={vf('account_number')} maxLength={7}
                            placeholder="1234567" className="w-20 border border-sky-300 rounded px-1.5 py-1 text-xs font-mono focus:outline-none" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input value={vendorForm.account_name_kana ?? ''} onChange={vf('account_name_kana')} maxLength={30}
                            placeholder="カブシキガイシヤ〇〇" className="w-36 border border-sky-300 rounded px-1.5 py-1 text-xs focus:outline-none" />
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <button onClick={saveVendorBank} disabled={vendorSaving}
                            className="text-[11px] text-white bg-sky-500 rounded px-2 py-1 hover:bg-sky-600 disabled:opacity-50 mr-1">
                            {vendorSaving ? '…' : '保存'}
                          </button>
                          <button onClick={() => setEditingVendorId(null)}
                            className="text-[11px] text-slate-500 border border-slate-200 rounded px-2 py-1 hover:bg-slate-50">
                            戻す
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2 text-xs font-mono text-slate-500">{v.bank_code ?? <span className="text-amber-500">未登録</span>}</td>
                        <td className="px-4 py-2 text-xs font-mono text-slate-500">{v.branch_code ?? '—'}</td>
                        <td className="px-4 py-2 text-xs text-slate-500">{v.account_type ? ACCOUNT_TYPE_LABEL[v.account_type] : '—'}</td>
                        <td className="px-4 py-2 text-xs font-mono text-slate-500">{v.account_number ?? '—'}</td>
                        <td className="px-4 py-2 text-xs text-slate-500">{v.account_name_kana ?? '—'}</td>
                        <td className="px-4 py-2">
                          <button onClick={() => openVendorEdit(v)}
                            className="text-[11px] text-sky-600 border border-sky-200 rounded px-2 py-1 hover:bg-sky-50">
                            編集
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {vendors.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-xs text-slate-400">取引先がありません</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ─── 全銀ファイル生成 ─── */}
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-violet-50/40">
            <p className="text-sm font-semibold text-violet-700 tracking-tight">全銀ファイル生成</p>
            <p className="text-[10px] text-violet-500/70 mt-0.5">買掛金（未払）から振込対象を選択してファイルを生成します</p>
          </div>
          <div className="p-5 space-y-4">
            {/* 振込日 */}
            <div className="flex items-end gap-4 flex-wrap">
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">振込日</p>
                <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
                  className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-violet-400" />
              </div>
              <div className="flex gap-2 pb-0.5">
                <button onClick={selectAll} className="text-[11px] text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50">全選択</button>
                <button onClick={clearAll} className="text-[11px] text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50">解除</button>
              </div>
            </div>

            {/* AP レコード一覧 */}
            {apRecords.length === 0 ? (
              <p className="text-xs text-slate-400">未払の買掛金がありません</p>
            ) : (
              <div className="border border-slate-100 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-50">
                    <tr>
                      <th className="w-10 px-3 py-2"></th>
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">取引先</th>
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">請求日</th>
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">支払期日</th>
                      <th className="px-4 py-2 text-right text-[10px] font-semibold text-slate-300 uppercase tracking-widest">未払残高</th>
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-300 uppercase tracking-widest">銀行</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {apRecords.map(r => {
                      const vendor = vendors.find(v => v.name === r.counterparty);
                      const hasBankInfo = !!(vendor?.bank_code && vendor?.account_number);
                      return (
                        <tr key={r.id} className={`hover:bg-slate-50/30 ${selectedIds.has(r.id) ? 'bg-violet-50/30' : ''}`}>
                          <td className="px-3 py-2 text-center">
                            <input type="checkbox" checked={selectedIds.has(r.id)}
                              onChange={() => toggleSelect(r.id)}
                              disabled={!hasBankInfo}
                              className="rounded accent-violet-500" />
                          </td>
                          <td className="px-4 py-2 text-xs font-medium text-slate-700">{r.counterparty}</td>
                          <td className="px-4 py-2 text-xs text-slate-500 font-mono">{r.invoice_date?.slice(0, 10)}</td>
                          <td className="px-4 py-2 text-xs text-slate-500 font-mono">{r.due_date?.slice(0, 10) ?? '—'}</td>
                          <td className="px-4 py-2 text-xs text-right font-mono text-slate-700 tabular-nums">
                            ¥{Math.round(r.balance).toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-xs">
                            {hasBankInfo
                              ? <span className="text-lime-600 font-semibold">登録済</span>
                              : <span className="text-amber-500">未登録</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 合計と生成ボタン */}
            {selectedIds.size > 0 && (
              <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-slate-100">
                <div className="text-sm text-slate-700">
                  選択 <span className="font-semibold text-violet-700">{selectedIds.size} 件</span> ／
                  振込合計 <span className="font-semibold text-violet-700 tabular-nums"> ¥{Math.round(totalSelected).toLocaleString()}</span>
                </div>
                <button onClick={generateFile} disabled={generating}
                  className="text-sm text-white bg-violet-500 rounded-xl px-5 py-2.5 font-semibold hover:bg-violet-600 disabled:opacity-50 transition-all">
                  {generating ? '生成中...' : '全銀ファイルをダウンロード'}
                </button>
              </div>
            )}
            {genError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{genError}</p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

export default function ZenginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin" /></div>}>
      <ZenginInner />
    </Suspense>
  );
}
