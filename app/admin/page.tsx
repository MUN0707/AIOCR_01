'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Subscription {
  id: string;
  email: string;
  status: 'trial' | 'active' | 'inactive' | 'pending';
  payment_method: 'credit_card' | 'bank_transfer' | null;
  trial_start_at: string | null;
  trial_end_at: string | null;
  subscription_start_at: string | null;
  subscription_end_at: string | null;
  notes: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  trial: 'お試し中',
  active: '有効',
  inactive: '無効',
  pending: '入金待ち',
};

const STATUS_STYLE: Record<string, string> = {
  trial: 'bg-sky-100 text-sky-700',
  active: 'bg-emerald-100 text-emerald-700',
  inactive: 'bg-slate-100 text-slate-500',
  pending: 'bg-amber-100 text-amber-700',
};

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

export default function AdminPage() {
  const router = useRouter();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscriptions = useCallback(async () => {
    const res = await fetch('/api/admin/subscriptions');
    if (res.status === 403) {
      router.replace('/');
      return;
    }
    const data = await res.json();
    if (res.ok) {
      setSubscriptions(data.subscriptions);
    } else {
      setError(data.error || 'エラーが発生しました');
    }
    setLoading(false);
  }, [router]);

  useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  const handleAction = async (id: string, action: 'activate' | 'deactivate' | 'extend') => {
    setActionLoading(id + action);
    setError(null);
    const res = await fetch('/api/admin/subscriptions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    });
    const data = await res.json();
    if (res.ok) {
      await fetchSubscriptions();
    } else {
      setError(data.error || 'エラーが発生しました');
    }
    setActionLoading(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-sky-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin" />
      </div>
    );
  }

  const counts = {
    trial: subscriptions.filter((s) => s.status === 'trial').length,
    active: subscriptions.filter((s) => s.status === 'active').length,
    pending: subscriptions.filter((s) => s.status === 'pending').length,
    inactive: subscriptions.filter((s) => s.status === 'inactive').length,
  };

  return (
    <div className="min-h-screen bg-sky-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-sky-100 px-6 py-4 shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📄</span>
            <div>
              <h1 className="text-xl font-bold text-sky-700">請求書 PDF 分割ツール</h1>
              <p className="text-xs text-sky-400">管理者ダッシュボード</p>
            </div>
          </div>
          <a
            href="/"
            className="text-sm text-sky-500 hover:text-sky-700 border border-sky-200 rounded-full px-4 py-1.5 transition-colors"
          >
            アプリへ戻る
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        <h2 className="text-2xl font-extrabold text-sky-900">ユーザー管理</h2>

        {/* サマリー */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'お試し中', count: counts.trial, style: 'bg-sky-100 text-sky-700' },
            { label: '有効', count: counts.active, style: 'bg-emerald-100 text-emerald-700' },
            { label: '入金待ち', count: counts.pending, style: 'bg-amber-100 text-amber-700' },
            { label: '無効', count: counts.inactive, style: 'bg-slate-100 text-slate-500' },
          ].map((item) => (
            <div key={item.label} className="bg-white rounded-2xl shadow-sm border border-sky-100 p-5 text-center">
              <p className="text-3xl font-extrabold text-sky-900">{item.count}</p>
              <span className={`inline-block mt-1 text-xs font-bold px-3 py-1 rounded-full ${item.style}`}>
                {item.label}
              </span>
            </div>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* テーブル */}
        <div className="bg-white rounded-3xl shadow-sm border border-sky-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-sky-50 border-b border-sky-100">
                  <th className="px-5 py-4 text-left text-xs font-bold text-sky-500 uppercase tracking-wide">メール</th>
                  <th className="px-5 py-4 text-left text-xs font-bold text-sky-500 uppercase tracking-wide">ステータス</th>
                  <th className="px-5 py-4 text-left text-xs font-bold text-sky-500 uppercase tracking-wide">支払い</th>
                  <th className="px-5 py-4 text-left text-xs font-bold text-sky-500 uppercase tracking-wide">Trial期限</th>
                  <th className="px-5 py-4 text-left text-xs font-bold text-sky-500 uppercase tracking-wide">サブスク期限</th>
                  <th className="px-5 py-4 text-left text-xs font-bold text-sky-500 uppercase tracking-wide">備考</th>
                  <th className="px-5 py-4 text-center text-xs font-bold text-sky-500 uppercase tracking-wide">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-50">
                {subscriptions.map((sub) => (
                  <tr key={sub.id} className="hover:bg-sky-50/50 transition-colors">
                    <td className="px-5 py-4 text-sky-900 font-medium text-xs">{sub.email}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-block text-xs font-bold px-3 py-1 rounded-full ${STATUS_STYLE[sub.status]}`}>
                        {STATUS_LABEL[sub.status]}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sky-600 text-xs">
                      {sub.payment_method === 'credit_card' ? '💳 クレカ'
                        : sub.payment_method === 'bank_transfer' ? '🏦 振込'
                        : '—'}
                    </td>
                    <td className="px-5 py-4 text-sky-600 text-xs font-mono">
                      {formatDate(sub.trial_end_at)}
                    </td>
                    <td className="px-5 py-4 text-sky-600 text-xs font-mono">
                      {formatDate(sub.subscription_end_at)}
                    </td>
                    <td className="px-5 py-4 text-sky-500 text-xs max-w-[160px] truncate" title={sub.notes ?? ''}>
                      {sub.notes || '—'}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex gap-1.5 justify-center flex-wrap">
                        <button
                          onClick={() => handleAction(sub.id, 'activate')}
                          disabled={!!actionLoading}
                          className="text-xs bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-bold px-3 py-1.5 rounded-full transition-colors disabled:opacity-50"
                        >
                          {actionLoading === sub.id + 'activate' ? '...' : '有効化'}
                        </button>
                        <button
                          onClick={() => handleAction(sub.id, 'extend')}
                          disabled={!!actionLoading}
                          className="text-xs bg-sky-100 hover:bg-sky-200 text-sky-700 font-bold px-3 py-1.5 rounded-full transition-colors disabled:opacity-50"
                        >
                          {actionLoading === sub.id + 'extend' ? '...' : '+2ヶ月'}
                        </button>
                        <button
                          onClick={() => handleAction(sub.id, 'deactivate')}
                          disabled={!!actionLoading}
                          className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold px-3 py-1.5 rounded-full transition-colors disabled:opacity-50"
                        >
                          {actionLoading === sub.id + 'deactivate' ? '...' : '無効化'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {subscriptions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-sky-300">
                      ユーザーがいません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
