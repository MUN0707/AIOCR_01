'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import type { User } from '@supabase/supabase-js';

const ONBOARDING_DONE_KEY = 'aiocr_onboarding_done';

const PRESET_OPENING_ACCOUNTS = [
  '現金',
  '普通預金',
  '当座預金',
  '売掛金',
  '買掛金',
  '未払金',
  '未払費用',
  '資本金',
  '繰越利益剰余金',
] as const;

interface ClientItem {
  id: string;
  name: string;
  company_code: string | null;
  legal_name: string | null;
  short_name: string | null;
  invoice_registration_number: string | null;
}

interface AccountItem {
  id: string;
  name: string;
  category: string;
  sub_category: string | null;
  client_id: string | null;
}

interface DepartmentItem {
  id: string;
  name: string;
  code: string | null;
  client_id: string | null;
}

const STEPS = [
  { num: 1, title: '顧問先', desc: '関与先の会社情報を1社登録します' },
  { num: 2, title: '会計期間', desc: '対象となる事業年度を1期登録します' },
  { num: 3, title: '期首残高', desc: '主要な貸借科目の期首残高を入力します' },
  { num: 4, title: '勘定科目', desc: 'よく使う科目を確認・追加します' },
  { num: 5, title: '部門/補助', desc: '必要なら部門・補助科目を追加します' },
] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [step, setStep] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  // Step1 — 顧問先
  const [clientName, setClientName] = useState('');
  const [clientLegalName, setClientLegalName] = useState('');
  const [clientCode, setClientCode] = useState('');
  const [invoiceRegNo, setInvoiceRegNo] = useState('');
  const [createdClient, setCreatedClient] = useState<ClientItem | null>(null);

  // Step2 — 会計期間
  const today = new Date();
  const defaultStart = `${today.getFullYear()}-04-01`;
  const defaultEnd = `${today.getFullYear() + 1}-03-31`;
  const [periodName, setPeriodName] = useState(`${today.getFullYear()}年度`);
  const [periodStart, setPeriodStart] = useState(defaultStart);
  const [periodEnd, setPeriodEnd] = useState(defaultEnd);
  const [createdPeriodId, setCreatedPeriodId] = useState<string | null>(null);

  // Step3 — 期首残高
  const [openingBalances, setOpeningBalances] = useState<Record<string, string>>(
    Object.fromEntries(PRESET_OPENING_ACCOUNTS.map((n) => [n, '']))
  );

  // Step4 — 勘定科目（既存一覧 + 追加）
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountCategory, setNewAccountCategory] = useState<'expense' | 'revenue' | 'asset' | 'liability' | 'equity'>('expense');

  // Step5 — 部門/補助
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);
  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptCode, setNewDeptCode] = useState('');
  const [newSubAccountParentId, setNewSubAccountParentId] = useState('');
  const [newSubAccountName, setNewSubAccountName] = useState('');

  // 認証チェック & 既存データから初期状態を判定
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(async ({ data }) => {
      if (cancelled) return;
      setUser(data.user);
      if (!data.user) {
        router.replace('/login');
        return;
      }
      setAuthChecked(true);

      // 既に顧問先がある場合は createdClient にセットして step を進める
      try {
        const cRes = await fetch('/api/clients');
        const cJson = await cRes.json();
        if (Array.isArray(cJson.clients) && cJson.clients.length > 0) {
          setCreatedClient(cJson.clients[0]);
        }
      } catch {
        // ignore
      }
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, router]);

  // Step4 表示時に accounts をフェッチ
  useEffect(() => {
    if (step !== 4 || !createdClient) return;
    fetch(`/api/accounts?clientId=${createdClient.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.accounts)) setAccounts(d.accounts);
      })
      .catch(() => {});
  }, [step, createdClient]);

  // Step5 表示時に departments をフェッチ
  useEffect(() => {
    if (step !== 5 || !createdClient) return;
    fetch(`/api/departments?clientId=${createdClient.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.departments)) setDepartments(d.departments);
      })
      .catch(() => {});
    // 補助科目の親候補は会社割当なし or 該当会社の科目
    fetch(`/api/accounts?clientId=${createdClient.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.accounts)) setAccounts(d.accounts);
      })
      .catch(() => {});
  }, [step, createdClient]);

  const markDoneAndGoHome = () => {
    try {
      localStorage.setItem(ONBOARDING_DONE_KEY, '1');
    } catch {
      // ignore
    }
    router.push('/');
  };

  // ─── Step1: 顧問先作成 ─────────────────────────────────────
  const submitStep1 = async () => {
    setError(null);
    const name = clientName.trim();
    if (!name) {
      setError('会社名を入力してください');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          legal_name: clientLegalName.trim() || null,
          company_code: clientCode.trim() || null,
          invoice_registration_number: invoiceRegNo.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || '顧問先の作成に失敗しました');
        return;
      }
      setCreatedClient(json.client);
      setStep(2);
    } finally {
      setBusy(false);
    }
  };

  // ─── Step2: 会計期間作成 ─────────────────────────────────
  const submitStep2 = async () => {
    setError(null);
    if (!createdClient) {
      setError('顧問先が未作成です');
      return;
    }
    const name = periodName.trim();
    if (!name) {
      setError('期の名前を入力してください');
      return;
    }
    if (periodStart > periodEnd) {
      setError('期首より期末を後の日付にしてください');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/fiscal-periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          start_date: periodStart,
          end_date: periodEnd,
          client_id: createdClient.id,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || '会計期間の作成に失敗しました');
        return;
      }
      setCreatedPeriodId(json.period.id);
      setStep(3);
    } finally {
      setBusy(false);
    }
  };

  // ─── Step3: 期首残高保存 ─────────────────────────────────
  const submitStep3 = async () => {
    setError(null);
    if (!createdPeriodId) {
      setStep(4);
      return;
    }
    const cleaned: Record<string, number> = {};
    for (const [name, raw] of Object.entries(openingBalances)) {
      const v = String(raw).replace(/,/g, '').trim();
      if (!v) continue;
      const num = Number(v);
      if (Number.isFinite(num) && num !== 0) cleaned[name] = num;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/fiscal-periods/${createdPeriodId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opening_balances: cleaned }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error || '期首残高の保存に失敗しました');
        return;
      }
      setStep(4);
    } finally {
      setBusy(false);
    }
  };

  // ─── Step4: 勘定科目追加 ─────────────────────────────────
  const addAccount = async () => {
    setError(null);
    const name = newAccountName.trim();
    if (!name || !createdClient) {
      setError('科目名を入力してください');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          category: newAccountCategory,
          client_id: createdClient.id,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || '科目の追加に失敗しました');
        return;
      }
      setAccounts((prev) => [...prev, json.account]);
      setNewAccountName('');
    } finally {
      setBusy(false);
    }
  };

  // ─── Step5: 部門追加 ─────────────────────────────────────
  const addDepartment = async () => {
    setError(null);
    const name = newDeptName.trim();
    if (!name || !createdClient) {
      setError('部門名を入力してください');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          code: newDeptCode.trim() || null,
          client_id: createdClient.id,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || '部門の追加に失敗しました');
        return;
      }
      setDepartments((prev) => [...prev, json.department]);
      setNewDeptName('');
      setNewDeptCode('');
    } finally {
      setBusy(false);
    }
  };

  // ─── Step5: 補助科目追加 ─────────────────────────────────
  const addSubAccount = async () => {
    setError(null);
    const name = newSubAccountName.trim();
    if (!name || !newSubAccountParentId || !createdClient) {
      setError('親科目と補助科目名を入力してください');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          parent_account_id: newSubAccountParentId,
          client_id: createdClient.id,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || '補助科目の追加に失敗しました');
        return;
      }
      setAccounts((prev) => [...prev, json.account]);
      setNewSubAccountName('');
      setNewSubAccountParentId('');
    } finally {
      setBusy(false);
    }
  };

  // ─── ステップスキップ ─────────────────────────────────────
  const skipStep = () => {
    setError(null);
    if (step === 1) {
      // Step1 はスキップ不可（既存顧問先がなければ後のステップが意味をなさない）
      setError('顧問先の登録は必須です');
      return;
    }
    if (step >= STEPS.length) {
      setCompleted(true);
      return;
    }
    setStep(step + 1);
  };

  const goNextOrFinish = () => {
    if (step >= STEPS.length) {
      setCompleted(true);
    } else {
      setStep(step + 1);
    }
  };

  // ─── レイアウト ─────────────────────────────────────────
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sky-600">
        読み込み中…
      </div>
    );
  }

  if (completed) {
    return (
      <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #f7fee7 100%)' }}>
        <header className="bg-white/80 backdrop-blur border-b border-sky-100 px-6 py-4 shadow-sm">
          <div className="max-w-[900px] mx-auto flex items-center gap-2">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span className="text-lg font-bold text-sky-700">Invoice OCR</span>
          </div>
        </header>
        <main className="max-w-[900px] mx-auto px-6 py-16 text-center space-y-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-lime-100 rounded-full">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#65a30d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h1 className="text-3xl font-extrabold text-sky-900">初期セットアップ完了</h1>
          <p className="text-sky-600">
            {createdClient ? <>「{createdClient.name}」</> : null}の基本情報を登録しました。<br />
            さっそく請求書 PDF をアップロードして OCR を始めてみましょう。
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
            <button
              onClick={markDoneAndGoHome}
              className="px-8 py-3 bg-sky-500 hover:bg-sky-600 text-white font-bold rounded-xl shadow-sm transition-colors"
            >
              OCR を始める
            </button>
            <Link
              href="/guide"
              className="px-8 py-3 bg-white border border-sky-200 text-sky-700 hover:bg-sky-50 font-bold rounded-xl transition-colors"
              onClick={() => {
                try { localStorage.setItem(ONBOARDING_DONE_KEY, '1'); } catch {}
              }}
            >
              使い方ガイドを見る
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const progressPct = Math.round(((step - 1) / STEPS.length) * 100);

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #f7fee7 100%)' }}>
      <header className="bg-white/80 backdrop-blur border-b border-sky-100 px-6 py-4 shadow-sm">
        <div className="max-w-[900px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span className="text-lg font-bold text-sky-700">Invoice OCR</span>
          </div>
          <button
            onClick={markDoneAndGoHome}
            className="text-sm text-sky-500 hover:text-sky-700 transition-colors"
          >
            あとで設定する →
          </button>
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-6 py-10 space-y-8">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 bg-sky-100 text-sky-700 text-xs font-semibold px-3 py-1.5 rounded-full">
            初回セットアップ
          </div>
          <h1 className="text-3xl font-extrabold text-sky-900">5ステップで始めましょう</h1>
          <p className="text-sky-600 text-sm">最初の関与先・会計期間・科目を登録します（あとで変更できます）</p>
        </div>

        {/* プログレスバー */}
        <div className="bg-white rounded-2xl shadow-sm border border-sky-100 p-4">
          <div className="flex items-center justify-between mb-3">
            {STEPS.map((s) => (
              <div key={s.num} className="flex-1 flex flex-col items-center text-center">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-colors ${
                    step > s.num
                      ? 'bg-lime-500 text-white'
                      : step === s.num
                      ? 'bg-sky-500 text-white'
                      : 'bg-sky-100 text-sky-400'
                  }`}
                >
                  {step > s.num ? '✓' : s.num}
                </div>
                <div className={`text-xs mt-2 font-semibold ${step === s.num ? 'text-sky-900' : 'text-sky-500'}`}>
                  {s.title}
                </div>
              </div>
            ))}
          </div>
          <div className="h-1 bg-sky-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-sky-400 to-lime-400 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* ステップ本体 */}
        <div className="bg-white rounded-2xl shadow-sm border border-sky-100 p-8 space-y-6">
          <div>
            <div className="text-xs font-semibold text-sky-500 mb-1">STEP {step} / {STEPS.length}</div>
            <h2 className="text-2xl font-extrabold text-sky-900">{STEPS[step - 1].title}</h2>
            <p className="text-sm text-sky-600 mt-1">{STEPS[step - 1].desc}</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {/* ─── Step 1: 顧問先 ─── */}
          {step === 1 && (
            <div className="space-y-4">
              {createdClient ? (
                <div className="bg-lime-50 border border-lime-200 rounded-lg p-4 text-sm text-lime-800">
                  既に「{createdClient.name}」が登録されています。次へ進んでください。
                </div>
              ) : null}
              <div>
                <label className="block text-sm font-semibold text-sky-900 mb-1">会社名 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  disabled={!!createdClient}
                  placeholder="例：株式会社サンプル"
                  className="w-full border border-sky-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:bg-sky-50 disabled:text-sky-400"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-sky-900 mb-1">正式名称（任意）</label>
                  <input
                    type="text"
                    value={clientLegalName}
                    onChange={(e) => setClientLegalName(e.target.value)}
                    disabled={!!createdClient}
                    placeholder="例：株式会社サンプル"
                    className="w-full border border-sky-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:bg-sky-50 disabled:text-sky-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-sky-900 mb-1">会社番号（任意・英数字8文字以内）</label>
                  <input
                    type="text"
                    value={clientCode}
                    onChange={(e) => setClientCode(e.target.value)}
                    disabled={!!createdClient}
                    placeholder="例：A001"
                    maxLength={8}
                    className="w-full border border-sky-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:bg-sky-50 disabled:text-sky-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-sky-900 mb-1">インボイス登録番号（任意・T + 13桁）</label>
                <input
                  type="text"
                  value={invoiceRegNo}
                  onChange={(e) => setInvoiceRegNo(e.target.value)}
                  disabled={!!createdClient}
                  placeholder="例：T1234567890123"
                  maxLength={14}
                  className="w-full border border-sky-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:bg-sky-50 disabled:text-sky-400"
                />
              </div>
            </div>
          )}

          {/* ─── Step 2: 会計期間 ─── */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-sky-900 mb-1">期の名前 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={periodName}
                  onChange={(e) => setPeriodName(e.target.value)}
                  placeholder="例：第10期"
                  className="w-full border border-sky-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-sky-900 mb-1">期首</label>
                  <input
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    className="w-full border border-sky-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-sky-900 mb-1">期末</label>
                  <input
                    type="date"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    className="w-full border border-sky-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                </div>
              </div>
              <div className="text-xs text-sky-500">
                ヒント：3月決算なら 4/1 〜 翌3/31、12月決算なら 1/1 〜 12/31 です
              </div>
            </div>
          )}

          {/* ─── Step 3: 期首残高 ─── */}
          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm text-sky-700 bg-sky-50 rounded-lg px-4 py-3 border border-sky-100">
                よく使う科目のみ表示しています。入力した科目だけ保存されます（0 または空欄はスキップ）。
              </p>
              <div className="space-y-2">
                {PRESET_OPENING_ACCOUNTS.map((name) => (
                  <div key={name} className="flex items-center gap-3">
                    <label className="w-40 text-sm font-semibold text-sky-900">{name}</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={openingBalances[name]}
                      onChange={(e) => setOpeningBalances({ ...openingBalances, [name]: e.target.value })}
                      placeholder="0"
                      className="flex-1 border border-sky-200 rounded-lg px-4 py-2 text-right focus:outline-none focus:ring-2 focus:ring-sky-400"
                    />
                    <span className="text-sm text-sky-500 w-8">円</span>
                  </div>
                ))}
              </div>
              <div className="text-xs text-sky-500">
                足りない科目は後から <code className="bg-sky-50 px-1 rounded">設定 → 会計期間</code> で追記できます
              </div>
            </div>
          )}

          {/* ─── Step 4: 勘定科目 ─── */}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-sm text-sky-700 bg-sky-50 rounded-lg px-4 py-3 border border-sky-100">
                よく使う科目はあらかじめ登録済みです。足りない科目があればここで追加できます。
              </p>
              <div className="max-h-60 overflow-y-auto border border-sky-100 rounded-lg p-3 bg-sky-50/30">
                {accounts.length === 0 ? (
                  <p className="text-sm text-sky-400 text-center py-4">読み込み中…</p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                    {accounts
                      .filter((a) => !a.client_id || a.client_id === createdClient?.id)
                      .map((a) => (
                        <div key={a.id} className="bg-white rounded px-3 py-1.5 text-sky-700 border border-sky-100">
                          {a.name}
                        </div>
                      ))}
                  </div>
                )}
              </div>
              <div className="border-t border-sky-100 pt-4">
                <div className="text-sm font-semibold text-sky-900 mb-2">科目を追加</div>
                <div className="flex flex-col md:flex-row gap-2">
                  <input
                    type="text"
                    value={newAccountName}
                    onChange={(e) => setNewAccountName(e.target.value)}
                    placeholder="例：クラウドサービス利用料"
                    className="flex-1 border border-sky-200 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                  <select
                    value={newAccountCategory}
                    onChange={(e) => setNewAccountCategory(e.target.value as typeof newAccountCategory)}
                    className="border border-sky-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  >
                    <option value="expense">費用</option>
                    <option value="revenue">収益</option>
                    <option value="asset">資産</option>
                    <option value="liability">負債</option>
                    <option value="equity">純資産</option>
                  </select>
                  <button
                    onClick={addAccount}
                    disabled={busy || !newAccountName.trim()}
                    className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white font-semibold rounded-lg disabled:bg-sky-200 transition-colors"
                  >
                    追加
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ─── Step 5: 部門/補助 ─── */}
          {step === 5 && (
            <div className="space-y-6">
              <p className="text-sm text-sky-700 bg-sky-50 rounded-lg px-4 py-3 border border-sky-100">
                部門・補助科目は必須ではありません。必要な場合だけ追加してください（後からも追加できます）。
              </p>

              {/* 部門 */}
              <div className="space-y-3">
                <div className="text-sm font-semibold text-sky-900">部門</div>
                {departments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {departments.map((d) => (
                      <div key={d.id} className="bg-white border border-sky-100 rounded-full px-3 py-1 text-sm text-sky-700">
                        {d.code ? `${d.code} · ` : ''}{d.name}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-col md:flex-row gap-2">
                  <input
                    type="text"
                    value={newDeptCode}
                    onChange={(e) => setNewDeptCode(e.target.value)}
                    placeholder="コード（任意）"
                    className="md:w-32 border border-sky-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                  <input
                    type="text"
                    value={newDeptName}
                    onChange={(e) => setNewDeptName(e.target.value)}
                    placeholder="例：営業部"
                    className="flex-1 border border-sky-200 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                  <button
                    onClick={addDepartment}
                    disabled={busy || !newDeptName.trim()}
                    className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white font-semibold rounded-lg disabled:bg-sky-200 transition-colors"
                  >
                    部門を追加
                  </button>
                </div>
              </div>

              {/* 補助科目 */}
              <div className="space-y-3 border-t border-sky-100 pt-5">
                <div className="text-sm font-semibold text-sky-900">補助科目</div>
                <p className="text-xs text-sky-500">親科目を選び、その下に補助科目を作成します（例：普通預金 → みずほ銀行）</p>
                <div className="flex flex-col md:flex-row gap-2">
                  <select
                    value={newSubAccountParentId}
                    onChange={(e) => setNewSubAccountParentId(e.target.value)}
                    className="md:w-56 border border-sky-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  >
                    <option value="">親科目を選択</option>
                    {accounts
                      .filter((a) => !a.client_id || a.client_id === createdClient?.id)
                      .map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                  </select>
                  <input
                    type="text"
                    value={newSubAccountName}
                    onChange={(e) => setNewSubAccountName(e.target.value)}
                    placeholder="補助科目名（例：みずほ銀行）"
                    className="flex-1 border border-sky-200 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                  <button
                    onClick={addSubAccount}
                    disabled={busy || !newSubAccountName.trim() || !newSubAccountParentId}
                    className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white font-semibold rounded-lg disabled:bg-sky-200 transition-colors"
                  >
                    補助を追加
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* フッターアクション */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => step > 1 && setStep(step - 1)}
            disabled={step <= 1 || busy}
            className="text-sm text-sky-600 hover:text-sky-800 disabled:text-sky-300 transition-colors"
          >
            ← 戻る
          </button>
          <div className="flex gap-3">
            {step > 1 && step < STEPS.length && (
              <button
                onClick={skipStep}
                disabled={busy}
                className="px-5 py-2.5 bg-white border border-sky-200 text-sky-600 hover:bg-sky-50 font-semibold rounded-lg transition-colors"
              >
                スキップ
              </button>
            )}
            {step === 1 && (
              <button
                onClick={createdClient ? () => setStep(2) : submitStep1}
                disabled={busy}
                className="px-6 py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-bold rounded-lg disabled:bg-sky-300 transition-colors"
              >
                {busy ? '保存中…' : createdClient ? '次へ →' : '登録して次へ →'}
              </button>
            )}
            {step === 2 && (
              <button
                onClick={submitStep2}
                disabled={busy}
                className="px-6 py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-bold rounded-lg disabled:bg-sky-300 transition-colors"
              >
                {busy ? '保存中…' : '登録して次へ →'}
              </button>
            )}
            {step === 3 && (
              <button
                onClick={submitStep3}
                disabled={busy}
                className="px-6 py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-bold rounded-lg disabled:bg-sky-300 transition-colors"
              >
                {busy ? '保存中…' : '保存して次へ →'}
              </button>
            )}
            {step === 4 && (
              <button
                onClick={goNextOrFinish}
                disabled={busy}
                className="px-6 py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-bold rounded-lg disabled:bg-sky-300 transition-colors"
              >
                次へ →
              </button>
            )}
            {step === 5 && (
              <button
                onClick={goNextOrFinish}
                disabled={busy}
                className="px-6 py-2.5 bg-lime-500 hover:bg-lime-600 text-white font-bold rounded-lg disabled:bg-lime-300 transition-colors"
              >
                セットアップ完了 →
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
