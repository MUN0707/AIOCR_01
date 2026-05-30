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
  total_production: number | null;
  production_unit: string | null;
  status: 'pending' | 'active' | 'disposed';
  note: string | null;
}

interface ProductionRow {
  id: string;
  year: number;
  month: number;
  quantity: number;
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

  // 生産高比例法: 月別生産量
  const [production, setProduction] = useState<ProductionRow[]>([]);
  const [prodYear, setProdYear] = useState('');
  const [prodMonth, setProdMonth] = useState('');
  const [prodQty, setProdQty] = useState('');
  const [prodSaving, setProdSaving] = useState(false);

  const loadProduction = async () => {
    try {
      const res = await fetch(`/api/fixed-assets/${id}/production`);
      const json = await res.json();
      if (res.ok) setProduction(json.rows ?? []);
    } catch {
      /* noop */
    }
  };

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
    loadProduction();
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
          total_production: asset.total_production,
          production_unit: asset.production_unit,
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

  const addProduction = async () => {
    const year = Number(prodYear);
    const month = Number(prodMonth);
    const quantity = Number(prodQty);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      setError('年と月（1〜12）を正しく入力してください');
      return;
    }
    if (!Number.isFinite(quantity) || quantity < 0) {
      setError('生産量を正しく入力してください');
      return;
    }
    setProdSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/fixed-assets/${id}/production`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, quantity }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '生産量の登録に失敗しました');
      await loadProduction();
      setProdQty('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '生産量の登録に失敗しました');
    } finally {
      setProdSaving(false);
    }
  };

  const deleteProduction = async (rowId: string) => {
    try {
      const res = await fetch(`/api/fixed-assets/${id}/production?row_id=${rowId}`, { method: 'DELETE' });
      if (res.ok) await loadProduction();
    } catch {
      /* noop */
    }
  };

  const annualAmt = asset && asset.useful_life_years && asset.useful_life_years > 0
    ? Math.floor((asset.acquisition_cost - asset.residual_value) / asset.useful_life_years)
    : 0;
  const monthlyAmt = Math.floor(annualAmt / 12);

  // 生産高比例法プレビュー: 償却単価と登録済み生産量に対する償却累計
  const isUnits = asset?.method === 'units_of_production';
  const unitRate = asset && asset.total_production && asset.total_production > 0
    ? (asset.acquisition_cost - asset.residual_value) / asset.total_production
    : 0;
  const producedQty = production.reduce((s, r) => s + Number(r.quantity), 0);
  const unitsAccumulated = Math.floor(unitRate * producedQty);

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
            <div className="mt-2 grid grid-cols-2 gap-2">
              {[
                { v: 'straight_line', label: '定額法' },
                { v: 'declining_balance', label: '定率法 (200%/250%)' },
                { v: 'declining_balance_old', label: '旧定率法 (H19年改正前)' },
                { v: 'units_of_production', label: '生産高比例法' },
              ].map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => update('method', opt.v)}
                  className={`text-xs rounded-xl border px-3 py-2 font-medium transition-colors ${
                    asset.method === opt.v
                      ? 'bg-sky-50 border-sky-400 text-sky-700'
                      : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">
              定率法: 取得日で自動判定（H24.4.1以降=200% / H19.4.1〜H24.3.31=250%）。改定償却率を加味し備忘価額1円まで償却 / 旧定率法: 平成19年3月31日以前取得 / 生産高比例法: 総見込生産量と月別生産量から計算
            </p>
          </div>

          {/* 生産高比例法: 総見込生産量と月別生産量 */}
          {isUnits && (
            <div className="border border-amber-200 bg-amber-50/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-widest">生産高比例法の設定</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">総見込生産量</label>
                  <input
                    type="number"
                    value={asset.total_production ?? ''}
                    onChange={(e) => update('total_production', e.target.value ? Number(e.target.value) : null)}
                    className="mt-2 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm tabular-nums focus:outline-none focus:border-amber-400"
                    placeholder="例: 100000"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">単位</label>
                  <input
                    type="text"
                    value={asset.production_unit ?? ''}
                    onChange={(e) => update('production_unit', e.target.value || null)}
                    className="mt-2 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-400"
                    placeholder="例: トン / 個 / 時間"
                  />
                </div>
              </div>

              {/* 月別生産量の入力 */}
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">月別生産量</label>
                <div className="mt-2 flex gap-2 items-end">
                  <input
                    type="number"
                    value={prodYear}
                    onChange={(e) => setProdYear(e.target.value)}
                    className="w-24 border border-slate-200 rounded-xl px-2 py-2 text-sm tabular-nums focus:outline-none focus:border-amber-400"
                    placeholder="年"
                  />
                  <input
                    type="number"
                    value={prodMonth}
                    onChange={(e) => setProdMonth(e.target.value)}
                    className="w-16 border border-slate-200 rounded-xl px-2 py-2 text-sm tabular-nums focus:outline-none focus:border-amber-400"
                    placeholder="月"
                  />
                  <input
                    type="number"
                    value={prodQty}
                    onChange={(e) => setProdQty(e.target.value)}
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm tabular-nums focus:outline-none focus:border-amber-400"
                    placeholder="生産量"
                  />
                  <button
                    type="button"
                    onClick={addProduction}
                    disabled={prodSaving}
                    className="text-xs text-white bg-amber-500 rounded-xl px-4 py-2 font-semibold hover:bg-amber-600 disabled:opacity-50 whitespace-nowrap"
                  >
                    {prodSaving ? '...' : '追加'}
                  </button>
                </div>
                {production.length > 0 && (
                  <div className="mt-3 border border-slate-100 rounded-xl divide-y divide-slate-100">
                    {production.map((r) => (
                      <div key={r.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                        <span className="text-slate-600 tabular-nums">
                          {r.year}年{r.month}月
                        </span>
                        <span className="text-slate-800 tabular-nums">
                          {Number(r.quantity).toLocaleString()} {asset.production_unit ?? ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => deleteProduction(r.id)}
                          className="text-slate-400 hover:text-red-500"
                        >
                          削除
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 計算プレビュー */}
          <div className="bg-sky-50/50 border border-sky-100 rounded-xl p-4">
            <p className="text-[10px] font-semibold text-sky-500 uppercase tracking-widest mb-2">償却額プレビュー</p>
            {isUnits ? (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-slate-400">償却単価</p>
                  <p className="text-base font-semibold text-sky-700 tabular-nums">
                    ¥{unitRate.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    <span className="text-[10px] text-slate-400"> / {asset.production_unit ?? '単位'}</span>
                  </p>
                </div>
                <div>
                  <p className="text-slate-400">登録済み生産量に対する償却累計</p>
                  <p className="text-base font-semibold text-sky-700 tabular-nums">¥{unitsAccumulated.toLocaleString()}</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-slate-400">年額{asset.method !== 'straight_line' ? '（初年度・概算）' : ''}</p>
                  <p className="text-base font-semibold text-sky-700 tabular-nums">¥{annualAmt.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-slate-400">月額</p>
                  <p className="text-base font-semibold text-sky-700 tabular-nums">¥{monthlyAmt.toLocaleString()}</p>
                </div>
              </div>
            )}
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
