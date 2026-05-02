'use client';

import { useState, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  AIOCR_PLANS,
  type AiocrPlanId,
  merumagaFeeFromMemberCount,
  merumagaPlanFromMemberCount,
} from '@/lib/services';

const AIOCR_PLAN_LIST: AiocrPlanId[] = ['lite', 'standard', 'pro', 'enterprise'];

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
  const [memberCount, setMemberCount] = useState(5);

  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const merumagaPlan = merumagaPlanFromMemberCount(memberCount);
  const merumagaFee = merumagaFeeFromMemberCount(memberCount);

  const totalFee = useMemo(() => {
    let total = 0;
    if (withAiocr) total += AIOCR_PLANS[aiocrPlan].price;
    if (withMerumaga) total += merumagaFee;
    return total;
  }, [withAiocr, aiocrPlan, withMerumaga, merumagaFee]);

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
          email,
          password,
          companyName,
          contactName,
          phone,
          withAiocr,
          aiocrPlan: withAiocr ? aiocrPlan : undefined,
          withMerumaga,
          memberCount: withMerumaga ? memberCount : undefined,
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
            onToggle={() => setWithAiocr(!withAiocr)}
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
            onToggle={() => setWithMerumaga(!withMerumaga)}
            title="税理士事務所スタッフ育成メルマガ"
            subtitle="週1配信・10分で実務ミスを学べる育成ツール（年52号）"
            lpHref="https://mail.taxbestsearch.com/"
            lpExternal
          >
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                配信を希望する従業員数
              </label>
              <input
                type="number"
                min={1}
                value={memberCount}
                onChange={(e) => setMemberCount(parseInt(e.target.value) || 1)}
                className="w-full border border-slate-300 rounded-lg px-4 py-2.5"
              />
              <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-baseline justify-between">
                <span className="text-sm text-emerald-800">
                  プラン：<span className="font-bold">{merumagaPlan === 'tier1' ? '〜10人' : merumagaPlan === 'tier2' ? '〜20人' : '20人超'}</span>
                </span>
                <span className="text-emerald-700 font-extrabold text-lg">
                  ¥{merumagaFee.toLocaleString()}<span className="text-xs font-normal">/月</span>
                </span>
              </div>
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

            <Field label="会社名・事務所名 *">
              <input type="text" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="例：山田税理士事務所" className="input-base" />
            </Field>
            <Field label="ご担当者名 *">
              <input type="text" required value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="例：山田 太郎" className="input-base" />
            </Field>
            <Field label="電話番号">
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03-1234-5678" className="input-base" />
            </Field>
            <Field label="メールアドレス（マイページログイン用）*">
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@office.jp" className="input-base" />
            </Field>
            <Field label="パスワード（8文字以上）*">
              <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="input-base" />
              <p className="text-xs text-slate-500 mt-1">マイページにログインしてサービスを管理するためのパスワードです。</p>
            </Field>
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

          <p className="text-center text-sm text-slate-500">
            すでに登録済みの方は{' '}
            <Link href="/login" className="text-sky-600 hover:underline">
              ログイン
            </Link>
          </p>
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
  children,
}: {
  color: 'sky' | 'emerald';
  checked: boolean;
  onToggle: () => void;
  title: string;
  subtitle: string;
  lpHref: string;
  lpExternal?: boolean;
  children: React.ReactNode;
}) {
  const accent =
    color === 'sky'
      ? { bar: 'bg-sky-500', tint: 'bg-sky-50/60', border: 'border-sky-200', tag: 'text-sky-700' }
      : { bar: 'bg-emerald-500', tint: 'bg-emerald-50/60', border: 'border-emerald-200', tag: 'text-emerald-700' };
  return (
    <div className={`bg-white rounded-2xl border-2 ${checked ? accent.border : 'border-slate-200'} overflow-hidden transition`}>
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center gap-3 p-4 text-left transition ${
          checked ? accent.tint : 'bg-white hover:bg-slate-50'
        }`}
      >
        <span
          className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition ${
            checked ? `${accent.bar} border-transparent` : 'border-slate-300 bg-white'
          }`}
        >
          {checked && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-900">{title}</p>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>
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
      {checked && <div className={`p-5 border-t ${accent.border}`}>{children}</div>}
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
