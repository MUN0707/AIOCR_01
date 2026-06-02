'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { JournalSidebarNav } from '@/components/JournalSidebarNav';
import { useConfirm } from '@/components/ConfirmDialog';

interface ClientItem { id: string; name: string; short_name?: string | null }

interface JournalTemplate {
  id: string;
  name: string;
  debit_account: string;
  credit_account: string;
  amount: number | null;
  description: string | null;
  tax_category: string | null;
  recur_type: 'manual' | 'monthly' | 'yearly';
  recur_day: number | null;
  client_id: string | null;
  created_at: string;
}

const TAX_LABELS: Record<string, string> = {
  taxable_sales: '課税売上',
  tax_exempt_sales: '非課税売上',
  taxable_purchase: '課税仕入',
  non_taxable: '免税・不課税',
};

const RECUR_LABELS = { manual: '手動', monthly: '毎月', yearly: '毎年' };

function TemplatesInner() {
  const confirm = useConfirm();
  const sp = useSearchParams();
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [clientId, setClientId] = useState(sp.get('clientId') ?? '');
  const [templates, setTemplates] = useState<JournalTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  // 新規フォーム
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({
    name: '', debit_account: '', credit_account: '', amount: '',
    description: '', tax_category: '', recur_type: 'manual', recur_day: '',
  });
  const [addSaving, setAddSaving] = useState(false);

  // 起票パネル
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyForm, setApplyForm] = useState({ entry_date: '', amount: '', description: '' });
  const [applyResult, setApplyResult] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(j => setClients(j.clients ?? [])).catch(() => {});
  }, []);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (clientId) params.set('clientId', clientId);
      const res = await fetch(`/api/journal-templates?${params}`);
      const json = await res.json();
      if (res.ok) setTemplates(json.templates ?? []);
    } catch {}
    finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const handleAdd = async () => {
    if (!addForm.name || !addForm.debit_account || !addForm.credit_account) {
      alert('テンプレート名・借方・貸方は必須です'); return;
    }
    setAddSaving(true);
    try {
      const res = await fetch('/api/journal-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...addForm,
          amount: addForm.amount ? Number(addForm.amount) : null,
          recur_day: addForm.recur_day ? Number(addForm.recur_day) : null,
          client_id: clientId || null,
        }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      setAddForm({ name: '', debit_account: '', credit_account: '', amount: '', description: '', tax_category: '', recur_type: 'manual', recur_day: '' });
      setShowAdd(false);
      await fetchTemplates();
    } catch (e) {
      alert(e instanceof Error ? e.message : '追加失敗');
    } finally {
      setAddSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm({ message: 'このテンプレートを削除しますか？', tone: 'danger' }))) return;
    await fetch(`/api/journal-templates/${id}`, { method: 'DELETE' });
    setTemplates(prev => prev.filter(t => t.id !== id));
  };

  const openApply = (tmpl: JournalTemplate) => {
    setApplyingId(tmpl.id);
    setApplyResult(null);
    setApplyForm({
      entry_date: new Date().toISOString().slice(0, 10),
      amount: tmpl.amount ? String(tmpl.amount) : '',
      description: tmpl.description ?? '',
    });
  };

  const handleApply = async () => {
    if (!applyingId) return;
    setApplying(true);
    setApplyResult(null);
    try {
      const res = await fetch(`/api/journal-templates/${applyingId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_date: applyForm.entry_date,
          amount: applyForm.amount ? Number(applyForm.amount) : undefined,
          description: applyForm.description || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setApplyResult('起票しました ✓');
      setApplyingId(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : '起票失敗');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-8 flex gap-5 items-start">
        <JournalSidebarNav clientId={clientId} active="templates" />
        <div className="flex-1 min-w-0">
        {/* ヘッダー */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/" className="text-sky-500 hover:text-sky-700 text-sm">← 日記帳</Link>
          <h1 className="text-xl font-bold text-slate-800">仕訳テンプレート</h1>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-lime-100 text-lime-700 font-medium">定型仕訳</span>
        </div>

        {/* フィルター＋追加ボタン */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 mb-5">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">顧問先</label>
              <select value={clientId} onChange={e => setClientId(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400 min-w-[160px]">
                <option value="">（共通）</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.short_name ?? c.name}</option>)}
              </select>
            </div>
            <span className="flex-1" />
            <button onClick={() => setShowAdd(!showAdd)}
              className="text-xs px-4 py-1.5 bg-lime-500 hover:bg-lime-600 text-white rounded-xl font-semibold transition-colors">
              {showAdd ? 'キャンセル' : '+ テンプレートを追加'}
            </button>
          </div>

          {/* 追加フォーム */}
          {showAdd && (
            <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="text-[10px] text-slate-400 block mb-1">テンプレート名 *</label>
                  <input type="text" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="例: 家賃支払"
                    className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">借方科目 *</label>
                  <input type="text" value={addForm.debit_account} onChange={e => setAddForm(f => ({ ...f, debit_account: e.target.value }))}
                    placeholder="例: 地代家賃"
                    className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">貸方科目 *</label>
                  <input type="text" value={addForm.credit_account} onChange={e => setAddForm(f => ({ ...f, credit_account: e.target.value }))}
                    placeholder="例: 普通預金"
                    className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">金額（空欄＝起票時入力）</label>
                  <input type="number" value={addForm.amount} onChange={e => setAddForm(f => ({ ...f, amount: e.target.value }))}
                    placeholder="0"
                    className="w-full text-xs text-right border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">摘要</label>
                  <input type="text" value={addForm.description} onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="例: ○月分賃料"
                    className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">消費税区分</label>
                  <select value={addForm.tax_category} onChange={e => setAddForm(f => ({ ...f, tax_category: e.target.value }))}
                    className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400">
                    <option value="">—</option>
                    <option value="taxable_sales">課税売上</option>
                    <option value="tax_exempt_sales">非課税売上</option>
                    <option value="taxable_purchase">課税仕入</option>
                    <option value="non_taxable">免税・不課税</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">繰り返し</label>
                  <select value={addForm.recur_type} onChange={e => setAddForm(f => ({ ...f, recur_type: e.target.value }))}
                    className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400">
                    <option value="manual">手動</option>
                    <option value="monthly">毎月</option>
                    <option value="yearly">毎年</option>
                  </select>
                </div>
                {addForm.recur_type !== 'manual' && (
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">
                      {addForm.recur_type === 'monthly' ? '毎月何日' : '何日（年1回）'}
                    </label>
                    <input type="number" min="1" max="31" value={addForm.recur_day} onChange={e => setAddForm(f => ({ ...f, recur_day: e.target.value }))}
                      placeholder="例: 25"
                      className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400" />
                  </div>
                )}
              </div>
              <div className="flex justify-end">
                <button onClick={handleAdd} disabled={addSaving}
                  className="text-xs px-5 py-1.5 bg-lime-500 hover:bg-lime-600 text-white rounded-xl font-semibold transition-colors disabled:opacity-50">
                  {addSaving ? '追加中…' : '追加'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 起票パネル */}
        {applyingId && (
          <div className="bg-lime-50 border border-lime-200 rounded-2xl p-4 mb-5">
            <p className="text-xs font-semibold text-lime-700 mb-3">仕訳を起票</p>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">日付 *</label>
                <input type="date" value={applyForm.entry_date} onChange={e => setApplyForm(f => ({ ...f, entry_date: e.target.value }))}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-lime-400" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">金額（空欄＝テンプレート値）</label>
                <input type="number" value={applyForm.amount} onChange={e => setApplyForm(f => ({ ...f, amount: e.target.value }))}
                  className="text-xs text-right border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-lime-400 w-32" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">摘要（空欄＝テンプレート値）</label>
                <input type="text" value={applyForm.description} onChange={e => setApplyForm(f => ({ ...f, description: e.target.value }))}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-lime-400 w-44" />
              </div>
              <button onClick={handleApply} disabled={applying}
                className="text-xs px-4 py-1.5 bg-lime-500 hover:bg-lime-600 text-white rounded-xl font-semibold disabled:opacity-50">
                {applying ? '起票中…' : '起票する'}
              </button>
              <button onClick={() => setApplyingId(null)}
                className="text-xs px-3 py-1.5 border border-slate-200 rounded-xl hover:bg-slate-50">
                キャンセル
              </button>
            </div>
          </div>
        )}

        {applyResult && (
          <div className="bg-lime-50 border border-lime-200 rounded-xl px-4 py-2 mb-4 text-xs text-lime-700 font-semibold">{applyResult}</div>
        )}

        {/* テンプレート一覧 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          {templates.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-slate-400">
              {loading ? '読み込み中…' : 'テンプレートがありません。「+ テンプレートを追加」から登録してください。'}
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {templates.map(tmpl => (
                <div key={tmpl.id} className="px-5 py-4 flex items-start gap-4 hover:bg-slate-50/30">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-semibold text-slate-800">{tmpl.name}</span>
                      {tmpl.recur_type !== 'manual' && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 font-semibold">
                          {RECUR_LABELS[tmpl.recur_type]}{tmpl.recur_day ? `・${tmpl.recur_day}日` : ''}
                        </span>
                      )}
                      {tmpl.tax_category && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          {TAX_LABELS[tmpl.tax_category] ?? tmpl.tax_category}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                      <span className="font-mono">{tmpl.debit_account}</span>
                      <span className="text-slate-300">/</span>
                      <span className="font-mono">{tmpl.credit_account}</span>
                      {tmpl.amount != null && (
                        <span className="text-slate-700 font-semibold tabular-nums">¥{Number(tmpl.amount).toLocaleString()}</span>
                      )}
                      {tmpl.description && <span className="text-slate-400">— {tmpl.description}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => openApply(tmpl)}
                      className="text-xs px-3 py-1.5 bg-lime-500 hover:bg-lime-600 text-white rounded-xl font-semibold transition-colors"
                    >起票</button>
                    <button
                      onClick={() => handleDelete(tmpl.id)}
                      className="text-xs px-2 py-1.5 border border-red-200 text-red-500 rounded-xl hover:bg-red-50"
                    >削除</button>
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

export default function TemplatesPage() {
  return (
    <Suspense>
      <TemplatesInner />
    </Suspense>
  );
}
