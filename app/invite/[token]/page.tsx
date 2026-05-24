'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

const ROLE_LABEL: Record<string, string> = {
  approver: '承認者',
  entry: '入力者',
  viewer: '閲覧者',
};

interface InviteInfo {
  valid: boolean;
  error?: string;
  member_email?: string;
  role?: string;
  client_name?: string;
}

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params?.token ?? '';

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [user, setUser] = useState<{ email?: string } | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [resultOk, setResultOk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/client-members/accept?token=${encodeURIComponent(token)}`);
      const data: InviteInfo = await res.json();
      if (!cancelled) setInfo(data);

      const supabase = createClient();
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!cancelled) setUser(u ? { email: u.email ?? undefined } : null);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const handleAccept = async () => {
    setAccepting(true);
    setResult(null);
    const res = await fetch('/api/client-members/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    setAccepting(false);
    if (res.ok) {
      setResultOk(true);
      setResult('招待を承諾しました。トップ画面に移動します。');
      setTimeout(() => router.push('/'), 1500);
    } else {
      setResultOk(false);
      setResult(data.error || '承諾に失敗しました');
    }
  };

  if (!info) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <p className="text-sm text-slate-400">読み込み中…</p>
      </div>
    );
  }

  if (!info.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md w-full bg-white border border-slate-100 rounded-2xl shadow-sm p-8 text-center">
          <h1 className="text-lg font-bold text-slate-800 mb-2">招待リンクが無効です</h1>
          <p className="text-sm text-slate-500">{info.error || 'リンクが正しくないか、有効期限切れです。'}</p>
          <p className="text-xs text-slate-400 mt-4">招待元に再発行を依頼してください。</p>
        </div>
      </div>
    );
  }

  const emailMismatch = user?.email && info.member_email && user.email.toLowerCase() !== info.member_email.toLowerCase();

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md w-full bg-white border border-slate-100 rounded-2xl shadow-sm p-8">
        <h1 className="text-lg font-bold text-slate-800 mb-1">メンバー招待</h1>
        <p className="text-sm text-slate-600 mb-6 leading-relaxed">
          <strong className="text-sky-700">{info.client_name}</strong> の{' '}
          <strong>{ROLE_LABEL[info.role ?? ''] ?? info.role}</strong> として招待されています。
        </p>

        <dl className="space-y-2 text-xs text-slate-500 mb-6">
          <div className="flex items-center gap-2">
            <dt className="w-20 text-slate-400">招待先メール</dt>
            <dd className="font-mono text-slate-700">{info.member_email}</dd>
          </div>
        </dl>

        {!user && (
          <div className="space-y-2">
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-3">
              承諾するにはログインが必要です。招待先メール ({info.member_email}) のアカウントでログインしてください。
            </p>
            <a
              href={`/login?redirect=${encodeURIComponent(`/invite/${token}`)}`}
              className="block text-center bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold rounded-xl py-3 transition-colors"
            >
              ログイン画面へ
            </a>
          </div>
        )}

        {user && emailMismatch && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-3">
            現在 <strong>{user.email}</strong> でログイン中ですが、招待は <strong>{info.member_email}</strong> 宛です。<br />
            一度ログアウトして、招待先のアカウントで入り直してください。
          </p>
        )}

        {user && !emailMismatch && (
          <>
            <button
              onClick={handleAccept}
              disabled={accepting}
              className="w-full bg-sky-500 hover:bg-sky-600 disabled:bg-sky-300 text-white text-sm font-semibold rounded-xl py-3 transition-colors"
            >
              {accepting ? '承諾中…' : '招待を承諾する'}
            </button>
            {result && (
              <p className={`mt-3 text-xs ${resultOk ? 'text-lime-700' : 'text-red-600'}`}>{result}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
