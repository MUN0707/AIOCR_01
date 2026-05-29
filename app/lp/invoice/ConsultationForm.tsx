'use client';

import { useState } from 'react';

export default function ConsultationForm() {
  const [name, setName] = useState('');
  const [office, setOffice] = useState('');
  const [email, setEmail] = useState('');
  const [preferredTimes, setPreferredTimes] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/consultation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, office, email, preferredTimes, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '送信に失敗しました');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信に失敗しました');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-sky-100 p-8 text-center space-y-3">
        <div className="text-4xl">✅</div>
        <h3 className="text-xl font-bold text-sky-900">お申し込みを受け付けました</h3>
        <p className="text-sky-600 text-sm leading-relaxed">
          担当者より、Google Meet のURLと確定日時を追ってメールでご連絡いたします。<br />
          確認メールをお送りしましたのでご確認ください。
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-2xl shadow-sm border border-sky-100 p-6 sm:p-8 space-y-4 text-left"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium text-sky-900">お名前 <span className="text-rose-500">*</span></span>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-sky-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
            placeholder="山田 太郎"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-sky-900">事務所名</span>
          <input
            type="text"
            value={office}
            onChange={(e) => setOffice(e.target.value)}
            className="mt-1 w-full rounded-lg border border-sky-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
            placeholder="〇〇税理士事務所"
          />
        </label>
      </div>
      <label className="block">
        <span className="text-sm font-medium text-sky-900">メールアドレス <span className="text-rose-500">*</span></span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-sky-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
          placeholder="you@example.com"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-sky-900">ご希望の日時（第1〜第3希望）</span>
        <textarea
          value={preferredTimes}
          onChange={(e) => setPreferredTimes(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-sky-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
          placeholder="例）&#10;・6/3（火）14:00〜&#10;・6/4（水）10:00〜&#10;・6/5（木）16:00〜"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-sky-900">ご相談内容（任意）</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-sky-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
          placeholder="現在の請求書処理の状況、お困りごとなど"
        />
      </label>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold px-6 py-3 rounded-full text-base shadow transition-colors"
      >
        {loading ? '送信中…' : '無料オンライン相談を申し込む'}
      </button>
      <p className="text-center text-sky-400 text-xs">
        Google Meet・30分・無料 / 入力内容は相談調整のみに使用します
      </p>
    </form>
  );
}
