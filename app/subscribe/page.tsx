'use client';

import { useState, useMemo, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { AIOCR_PLANS, MERUMAGA_PLANS, type AiocrPlanId } from '@/lib/services';

const AIOCR_PLAN_LIST: AiocrPlanId[] = ['lite', 'standard', 'pro', 'enterprise'];

// メルマガは tier1（〜10人・1980円）固定スタート。
// マイページでメーリスにメンバー追加すると自動で tier2/tier3 へ昇格する。
const MERUMAGA_INITIAL_PLAN = MERUMAGA_PLANS.tier1;

function SubscribeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialService = searchParams.get('service'); // 'aiocr' | 'merumaga' | null
  const initialAiocrPlan = (searchParams.get('plan') as AiocrPlanId) || 'standard';

  const [withAiocr, setWithAiocr] = useState(initialService !== 'merumaga');
  const [aiocrPlan, setAiocrPlan] = useState<AiocrPlanId>(
    AIOCR_PLANS[initialAiocrPlan] ? initialAiocrPlan : 'standard'
  );

  const [withMerumaga, setWithMerumaga] = useState(initialService === 'merumaga');

  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ログイン中ユーザーを検出してフォームを簡略化（メール/パスワード入力欄を隠す、会社名等を prefill）
  const [authUser, setAuthUser] = useState<{ id: string; email: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  // 既契約サービス（追加申込時に重複選択をブロックするため）
  const [hasAiocr, setHasAiocr] = useState(false);
  const [hasMerumaga, setHasMerumaga] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (user?.email) {
        setAuthUser({ id: user.id, email: user.email });
        setEmail(user.email);
        // 既存の firms / subscriptions を取得
        const [{ data: firm }, { data: sub }] = await Promise.all([
          supabase
            .from('firms')
            .select('name, contact_name, phone, status')
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('subscriptions')
            .select('status')
            .eq('user_id', user.id)
            .maybeSingle(),
        ]);
        const meta = (user.user_metadata || {}) as { company_name?: string; contact_name?: string };
        const initCompany = firm?.name || meta.company_name || '';
        const initContact = firm?.contact_name || meta.contact_name || '';
        const initPhone = firm?.phone || '';
        if (initCompany) setCompanyName(initCompany);
        if (initContact) setContactName(initContact);
        if (initPhone) setPhone(initPhone);
        // 既契約 = cancelled 以外なら追加申込不可
        const aiocrActive = !!sub && sub.status !== 'cancelled';
        const merumagaActive = !!firm && firm.status !== 'cancelled';
        setHasAiocr(aiocrActive);
        setHasMerumaga(merumagaActive);
        if (aiocrActive) setWithAiocr(false);
        if (merumagaActive) setWithMerumaga(false);
      }
      setAuthChecked(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const totalFee = useMemo(() => {
    let total = 0;
    if (withAiocr) total += AIOCR_PLANS[aiocrPlan].price;
    if (withMerumaga) total += MERUMAGA_INITIAL_PLAN.price;
    return total;
  }, [withAiocr, aiocrPlan, withMerumaga]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!withAiocr && !withMerumaga) {
      setError('いずれか1つ以上のサービスを選択してください');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: authUser ? undefined : email,
          password: authUser ? undefined : password,
          companyName,
          contactName,
          phone,
          withAiocr,
          aiocrPlan: withAiocr ? aiocrPlan : undefined,
          withMerumaga,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '申込みに失敗しました');
      router.push(data.redirect || '/mypage');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #f7fee7 100%)' }}>
      <header className="bg-white/80 backdrop-blur border-b border-sky-100 px-6 py-4 shadow-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-2xl">📄</span>
            <span className="font-bold text-slate-900">サービス申込み</span>
          </Link>
          <Link href="/login" className="text-sm text-sky-600 hover:text-sky-800">
            既にアカウントをお持ちの方 →
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-extrabold text-slate-900">サービス申込み</h1>
          <p className="text-slate-600">必要なサービスを選んで、まとめてお申し込みください。</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700 text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <ServiceCard
            color="sky"
            checked={withAiocr}
            onToggle={() => !hasAiocr && setWithAiocr(!withAiocr)}
            disabled={hasAiocr}
            disabledLabel="契約中"
            title="Invoice OCR（請求書 PDF 分割）"
            subtitle="請求書 PDF を AI が自動解析・分割・命名"
            lpHref="/lp/invoice"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {AIOCR_PLAN_LIST.map((id) => {
                const plan = AIOCR_PLANS[id];
                const selected = aiocrPlan === id;
                return (
                  <label
                    key={id}
                    className={`relative flex flex-col p-4 rounded-xl border-2 cursor-pointer transition ${
                      selected ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white hover:border-sky-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="aiocrPlan"
                      value={id}
                      checked={selected}
                      onChange={() => setAiocrPlan(id)}
                      className="sr-only"
                    />
                    <div className="flex items-baseline justify-between">
                      <p className="font-bold text-slate-900 text-sm">{plan.name}</p>
                      <p className="text-xs text-slate-500">{plan.limit}</p>
                    </div>
                    <p className="text-sky-700 font-extrabold text-lg mt-1">
                      ¥{plan.price.toLocaleString()}
                      <span className="text-xs font-normal text-slate-500">/月</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">{plan.description}</p>
                  </label>
                );
              })}
            </div>
          </ServiceCard>

          <ServiceCard
            color="emerald"
            checked={withMerumaga}
            onToggle={() => !hasMerumaga && setWithMerumaga(!withMerumaga)}
            disabled={hasMerumaga}
            disabledLabel="契約中"
            title="税理士事務所スタッフ育成メルマガ"
            subtitle="週1配信・10分で実務ミスを学べる育成ツール（年52号）"
            lpHref="https://mail.taxbestsearch.com/"
            lpExternal
          >
            <div className="space-y-3">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-baseline justify-between">
                <span className="text-sm text-emerald-800">
                  開始プラン：<span className="font-bold">{MERUMAGA_INITIAL_PLAN.name}</span>
                </span>
                <span className="text-emerald-700 font-extrabold text-lg">
                  ¥{MERUMAGA_INITIAL_PLAN.price.toLocaleString()}<span className="text-xs font-normal">/月</span>
                </span>
              </div>
              <ul className="text-xs text-slate-600 space-y-1 leading-relaxed">
                <li>• 申込時は <strong>{MERUMAGA_INITIAL_PLAN.name}（メーリス10人まで・¥{MERUMAGA_INITIAL_PLAN.price.toLocaleString()}/月）</strong> でスタート</li>
                <li>• 配信用メーリス（メーリングリスト）はこちら側で自動作成します</li>
                <li>• マイページでメーリスにメールアドレスを追加すると、その時点の人数で<strong>翌月から自動でプラン昇格</strong>（11人目→¥2,980 / 21人目→¥3,980）</li>
              </ul>
            </div>
          </ServiceCard>

          {(withAiocr || withMerumaga) && (
            <div className="bg-slate-900 text-white rounded-2xl p-5 flex items-center justify-between">
              <span className="font-medium">月額合計</span>
              <span className="text-2xl font-extrabold">
                ¥{totalFee.toLocaleString()}<span className="text-sm font-normal opacity-70">/月（税込）</span>
              </span>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <h2 className="font-bold text-slate-900">お客様情報</h2>

            {authChecked && authUser && (
              <div className="bg-sky-50 border border-sky-200 rounded-lg px-4 py-3 text-sm text-sky-900 flex items-center justify-between gap-3">
                <span>
                  ログイン中: <span className="font-semibold">{authUser.email}</span> として申込
                </span>
                <Link href="/api/auth/signout" className="text-xs text-sky-700 hover:underline whitespace-nowrap">
                  別アカウントで申込 →
                </Link>
              </div>
            )}

            <Field label="会社名・事務所名 *">
              <input type="text" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="例：山田税理士事務所" className="input-base" />
            </Field>
            <Field label="ご担当者名 *">
              <input type="text" required value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="例：山田 太郎" className="input-base" />
            </Field>
            <Field label="電話番号">
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03-1234-5678" className="input-base" />
            </Field>
            {!authUser && (
              <>
                <Field label="メールアドレス（マイページログイン用）*">
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@office.jp" className="input-base" />
                </Field>
                <Field label="パスワード（8文字以上）*">
                  <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="input-base" />
                  <p className="text-xs text-slate-500 mt-1">マイページにログインしてサービスを管理するためのパスワードです。</p>
                </Field>
              </>
            )}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900 space-y-1">
            <p>• お申込み後、銀行振込先口座をメールでご案内します</p>
            <p>• 適格請求書（インボイス）を発行いたします</p>
            <p>• 入金確認後、各サービスを順次有効化します</p>
          </div>

          <button
            type="submit"
            disabled={loading || (!withAiocr && !withMerumaga)}
            className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-bold py-4 rounded-2xl transition shadow-lg"
          >
            {loading ? '送信中...' : '申込みを確定する'}
          </button>

          {!authUser && (
            <p className="text-center text-sm text-slate-500">
              すでに登録済みの方は{' '}
              <Link href="/login" className="text-sky-600 hover:underline">
                ログイン
              </Link>
            </p>
          )}
        </form>
      </main>

      <style jsx>{`
        .input-base {
          width: 100%;
          padding: 0.6rem 0.9rem;
          border: 1px solid #cbd5e1;
          border-radius: 0.5rem;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .input-base:focus {
          border-color: #38bdf8;
          box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.15);
        }
      `}</style>
    </div>
  );
}

function ServiceCard({
  color,
  checked,
  onToggle,
  title,
  subtitle,
  lpHref,
  lpExternal,
  disabled,
  disabledLabel,
  children,
}: {
  color: 'sky' | 'emerald';
  checked: boolean;
  onToggle: () => void;
  title: string;
  subtitle: string;
  lpHref: string;
  lpExternal?: boolean;
  disabled?: boolean;
  disabledLabel?: string;
  children: React.ReactNode;
}) {
  const accent =
    color === 'sky'
      ? { bar: 'bg-sky-500', tint: 'bg-sky-50/60', border: 'border-sky-200', tag: 'text-sky-700' }
      : { bar: 'bg-emerald-500', tint: 'bg-emerald-50/60', border: 'border-emerald-200', tag: 'text-emerald-700' };
  return (
    <div className={`bg-white rounded-2xl border-2 ${checked ? accent.border : 'border-slate-200'} overflow-hidden transition ${disabled ? 'opacity-60' : ''}`}>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className={`w-full flex items-center gap-3 p-4 text-left transition ${
          disabled ? 'bg-slate-50 cursor-not-allowed' : checked ? accent.tint : 'bg-white hover:bg-slate-50'
        }`}
      >
        <span
          className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition ${
            disabled
              ? 'bg-slate-200 border-slate-300'
              : checked
                ? `${accent.bar} border-transparent`
                : 'border-slate-300 bg-white'
          }`}
        >
          {(checked || disabled) && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={disabled ? '#94a3b8' : 'white'} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-900">{title}</p>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        {disabled && disabledLabel && (
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 whitespace-nowrap`}>
            {disabledLabel}
          </span>
        )}
        <a
          href={lpHref}
          target={lpExternal ? '_blank' : undefined}
          rel={lpExternal ? 'noopener noreferrer' : undefined}
          onClick={(e) => e.stopPropagation()}
          className={`text-xs font-medium ${accent.tag} hover:underline whitespace-nowrap`}
        >
          詳細 →
        </a>
      </button>
      {checked && !disabled && <div className={`p-5 border-t ${accent.border}`}>{children}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

export default function SubscribePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <SubscribeForm />
    </Suspense>
  );
}
