'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SubscribePage() {
  const router = useRouter();
  const [method, setMethod] = useState<'credit_card' | 'bank_transfer' | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreditCard = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/stripe/create-checkout', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'エラーが発生しました');
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const handleBankTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/subscription/bank-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, contactName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'エラーが発生しました');
      router.push('/subscribe/success?method=bank_transfer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-sky-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-sky-100 px-6 py-4 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <span className="text-2xl">📄</span>
          <h1 className="text-xl font-bold text-sky-700">請求書 PDF 分割ツール</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-14 space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-extrabold text-sky-900">お支払い方法の選択</h2>
          <p className="text-sky-600">ご利用いただくお支払い方法を選択してください</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* 支払い方法選択 */}
        {!method && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              onClick={() => setMethod('credit_card')}
              className="bg-white hover:bg-sky-50 border-2 border-sky-200 hover:border-sky-400 rounded-3xl p-8 text-left transition-all group"
            >
              <div className="w-12 h-12 bg-sky-100 group-hover:bg-sky-200 rounded-full flex items-center justify-center text-2xl mb-4 transition-colors">
                💳
              </div>
              <p className="font-bold text-sky-900 text-lg mb-1">クレジットカード</p>
              <p className="text-sky-500 text-sm">月額自動更新・いつでもキャンセル可</p>
            </button>

            <button
              onClick={() => setMethod('bank_transfer')}
              className="bg-white hover:bg-sky-50 border-2 border-sky-200 hover:border-sky-400 rounded-3xl p-8 text-left transition-all group"
            >
              <div className="w-12 h-12 bg-sky-100 group-hover:bg-sky-200 rounded-full flex items-center justify-center text-2xl mb-4 transition-colors">
                🏦
              </div>
              <p className="font-bold text-sky-900 text-lg mb-1">銀行振込</p>
              <p className="text-sky-500 text-sm">2ヶ月分前払い・入金確認後に利用開始</p>
            </button>
          </div>
        )}

        {/* クレジットカード決済 */}
        {method === 'credit_card' && (
          <div className="bg-white rounded-3xl shadow-md border border-sky-100 p-8 space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-sky-100 rounded-full flex items-center justify-center text-xl">💳</div>
              <div>
                <p className="font-bold text-sky-900">クレジットカードでお支払い</p>
                <p className="text-sky-500 text-sm">Stripeの安全な決済ページに移動します</p>
              </div>
            </div>
            <div className="bg-sky-50 rounded-2xl p-4 text-sky-700 text-sm space-y-1">
              <p>• カード情報はStripeが管理します（当サービスでは保持しません）</p>
              <p>• 月額自動更新です。いつでもキャンセルできます</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setMethod(null)}
                className="flex-1 border border-sky-200 text-sky-600 font-semibold py-3 rounded-full hover:bg-sky-50 transition-colors"
              >
                戻る
              </button>
              <button
                onClick={handleCreditCard}
                disabled={loading}
                className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:bg-sky-300 text-white font-bold py-3 rounded-full transition-colors"
              >
                {loading ? '処理中...' : '決済ページへ進む →'}
              </button>
            </div>
          </div>
        )}

        {/* 銀行振込申請 */}
        {method === 'bank_transfer' && (
          <div className="bg-white rounded-3xl shadow-md border border-sky-100 p-8 space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-sky-100 rounded-full flex items-center justify-center text-xl">🏦</div>
              <div>
                <p className="font-bold text-sky-900">銀行振込でお申し込み</p>
                <p className="text-sky-500 text-sm">申請後、振込先口座をご案内します</p>
              </div>
            </div>

            <form onSubmit={handleBankTransfer} className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-sky-800">
                  会社名・屋号 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="例：株式会社〇〇"
                  required
                  className="w-full border border-sky-200 rounded-2xl px-4 py-3 text-sky-900 placeholder-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-sky-800">
                  ご担当者名 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="例：山田 太郎"
                  required
                  className="w-full border border-sky-200 rounded-2xl px-4 py-3 text-sky-900 placeholder-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
              </div>

              <div className="bg-sky-50 rounded-2xl p-4 text-sky-700 text-sm space-y-1">
                <p>• 申請後、管理者よりメールにて振込先口座をご連絡します</p>
                <p>• 入金確認後（1〜2営業日）に利用開始となります</p>
                <p>• 入金が確認できない場合はアカウントが無効になります</p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setMethod(null)}
                  className="flex-1 border border-sky-200 text-sky-600 font-semibold py-3 rounded-full hover:bg-sky-50 transition-colors"
                >
                  戻る
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:bg-sky-300 text-white font-bold py-3 rounded-full transition-colors"
                >
                  {loading ? '送信中...' : '申請する →'}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
