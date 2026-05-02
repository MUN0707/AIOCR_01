'use client';

import { useState } from 'react';
import { createClient } from '@/utils/supabase/client';

export default function AccountSection({ currentEmail }: { currentEmail: string }) {
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    if (newEmail.trim().toLowerCase() === currentEmail.toLowerCase()) {
      setError('現在のメールアドレスと同じです');
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    const supabase = createClient();
    const { error: err } = await supabase.auth.updateUser({ email: newEmail.trim() });
    if (err) {
      setError(err.message);
    } else {
      setMessage(
        `確認メールを「${currentEmail}」と「${newEmail.trim()}」の両方に送信しました。両方のリンクをクリックすると変更が確定します。`
      );
      setEditing(false);
      setNewEmail('');
    }
    setLoading(false);
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-3">
        <span className="text-2xl">👤</span>
        <div>
          <p className="font-bold text-slate-900">アカウント情報</p>
          <p className="text-xs text-slate-500">ログインに使うメールアドレスを管理</p>
        </div>
      </div>
      <div className="px-6 py-5 space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">ログイン用メールアドレス</p>
            <p className="font-mono text-sm text-slate-900 break-all">{currentEmail}</p>
          </div>
          {!editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setError(null);
                setMessage(null);
              }}
              className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-lg whitespace-nowrap"
            >
              変更
            </button>
          )}
        </div>

        {editing && (
          <form onSubmit={handleSubmit} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                新しいメールアドレス
              </label>
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="new@example.com"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              />
              <p className="text-xs text-slate-500 mt-1.5">
                変更後、現在と新しい両方のメアドに確認メールが送信されます。両方のリンクをクリックすると変更が確定します。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={loading}
                className="bg-sky-500 hover:bg-sky-600 disabled:bg-slate-300 text-white text-sm font-bold px-4 py-2 rounded-lg"
              >
                {loading ? '送信中...' : '確認メールを送る'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setNewEmail('');
                  setError(null);
                }}
                className="text-sm text-slate-600 hover:text-slate-900 px-3 py-2"
              >
                キャンセル
              </button>
            </div>
          </form>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {message && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800">
            {message}
          </div>
        )}
      </div>
    </section>
  );
}
