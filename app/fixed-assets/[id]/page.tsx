'use client';

import { useEffect, useState, use } from 'react';

interface FixedAsset {
  id: string;
  asset_number: number;
  category: 'tangible' | 'intangible' | 'deferred';
  name: string;
  account_name: string;
  acquisition_date: string | null;
  depreciation_start_date: string | null;
  acquisition_cost: number;
  residual_value: number;
  useful_life_years: number | null;
  method: string;
  status: 'pending' | 'active' | 'disposed';
  note: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  tangible: '有形固定資産',
  intangible: '無形固定資産',
  deferred: '繰延資産',
};

export default function FixedAssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [asset, setAsset] = useState<FixedAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/fixed-assets/${id}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? '読み込みに失敗しました');
        setAsset(json.asset);
      } catch (e) {
        setError(e instanceof Error ? e.message : '読み込みに失敗しました');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const save = async () => {
    if (!asset) return;
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/fixed-assets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: asset.category,
          name: asset.name,
          account_name: asset.account_name,
          acquisition_date: asset.acquisition_date,
          depreciation_start_date: asset.depreciation_start_date,
          acquisition_cost: asset.acquisition_cost,
          residual_value: asset.residual_value,
          useful_life_years: asset.useful_life_years,
          method: asset.method,
          status: 'active',
          note: asset.note,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '保存に失敗しました');
      setAsset(json.asset);
      setMsg('保存しました');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const annualAmt = asset && asset.useful_life_years && asset.useful_life_years > 0
    ? Math.floor((asset.acquisition_cost - asset.residual_value) / asset.useful_life_years)
    : 0;
  const monthlyAmt = Math.floor(annualAmt / 12);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin" />
      </main>
    );
  }

  if (!asset) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-red-500">{error ?? '資産が見つかりません'}</p>
      </main>
    );
  }

  const update = <K extends keyof FixedAsset>(key: K, value: FixedAsset[K]) => {
    setAsset({ ...asset, [key]: value });
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-lime-50 py-10 px-4">
      <div className="max-w-[720px] mx-auto">
        <div className="mb-6">
          <p className="text-[11px] font-semibold text-sky-500 uppercase tracking-widest">Fixed Asset</p>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight mt-1">
            固定資産 #{asset.asset_number} の詳細登録
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            耐用年数・取得日を入力し、減価償却の対象として有効化します
          </p>
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm space-y-5">
          {/* 区分 */}
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">区分</label>
            <div className="mt-2 flex gap-2">
              {(['tangible', 'intangible', 'deferred'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => update('category', c)}
                  className={`flex-1 text-xs rounded-xl border px-3 py-2 font-medium transition-colors ${
                    asset.category === c
                      ? 'bg-sky-50 border-sky-400 text-sky-700'
                      : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
          </div>

          {/* 名称 */}
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">資産名称</label>
            <input
              type="text"
              value={asset.name}
              onChange={(e) => update('name', e.target.value)}
              className="mt-2 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-sky-400"
              placeholder="例: 本社コピー機"
            />
          </div>

          {/* 勘定科目 */}
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">勘定科目</label>
            <input
              type="text"
              value={asset.account_name}
              onChange={(e) => update('account_name', e.target.value)}
              className="mt-2 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-sky-400"
              placeholder="例: 工具器具備品"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">取得日</label>
              <input
                type="date"
                value={asset.acquisition_date ?? ''}
                onChange={(e) => update('acquisition_date', e.target.value || null)}
                className="mt-2 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">償却開始日</label>
              <input
                type="date"
                value={asset.depreciation_start_date ?? ''}
                onChange={(e) => update('depreciation_start_date', e.target.value || null)}
                className="mt-2 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-sky-400"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">取得価額</label>
              <input
                type="number"
                value={asset.acquisition_cost}
                onChange={(e) => update('acquisition_cost', Number(e.target.value))}
                className="mt-2 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm tabular-nums focus:outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">残存価額</label>
              <input
                type="number"
                value={asset.residual_value}
                onChange={(e) => update('residual_value', Number(e.target.value))}
                className="mt-2 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm tabular-nums focus:outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">耐用年数</label>
              <input
                type="number"
                value={asset.useful_life_years ?? ''}
                onChange={(e) => update('useful_life_years', e.target.value ? Number(e.target.value) : null)}
                className="mt-2 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm tabular-nums focus:outline-none focus:border-sky-400"
                placeholder="年"
              />
            </div>
          </div>

          {/* 償却方法 */}
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">償却方法</label>
            <div className="mt-2 flex gap-2">
              {[
                { v: 'straight_line', label: '定額法' },
                { v: 'declining_balance', label: '定率法（未対応）' },
              ].map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  disabled={opt.v !== 'straight_line'}
                  onClick={() => update('method', opt.v)}
                  className={`flex-1 text-xs rounded-xl border px-3 py-2 font-medium transition-colors ${
                    asset.method === opt.v
                      ? 'bg-sky-50 border-sky-400 text-sky-700'
                      : 'bg-white border-slate-200 text-slate-500 disabled:opacity-40 disabled:cursor-not-allowed'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 計算プレビュー */}
          <div className="bg-sky-50/50 border border-sky-100 rounded-xl p-4">
            <p className="text-[10px] font-semibold text-sky-500 uppercase tracking-widest mb-2">償却額プレビュー</p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-slate-400">年額</p>
                <p className="text-base font-semibold text-sky-700 tabular-nums">¥{annualAmt.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-slate-400">月額</p>
                <p className="text-base font-semibold text-sky-700 tabular-nums">¥{monthlyAmt.toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* メモ */}
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">メモ</label>
            <textarea
              value={asset.note ?? ''}
              onChange={(e) => update('note', e.target.value)}
              rows={2}
              className="mt-2 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-sky-400"
            />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
          {msg && <p className="text-xs text-lime-600">{msg}</p>}

          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <p className="text-[10px] text-slate-400">
              ステータス: <span className="font-mono text-slate-600">{asset.status}</span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => window.close()}
                className="text-xs text-slate-500 border border-slate-200 rounded-xl px-4 py-2 hover:bg-slate-50"
              >
                閉じる
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="text-xs text-white bg-sky-500 rounded-xl px-5 py-2 font-semibold hover:bg-sky-600 disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存して有効化'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
