'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SubscribePage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <header className="bg-white border-b border-sky-100 px-6 py-4 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <span className="text-2xl">📄</span>
          <h1 className="text-xl font-bold text-sky-700">請求書 PDF 分割ツール</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-14 space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-extrabold text-sky-900">銀行振込でお申し込み</h2>
          <p className="text-sky-600">必要事項をご入力ください</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700 text-sm">
            {error}
          </div>
        )}

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

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-sky-500 hover:bg-sky-600 disabled:bg-sky-300 text-white font-bold py-3 rounded-full transition-colors"
            >
              {loading ? '送信中...' : '申請する →'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
