'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { JournalSidebarNav } from '@/components/JournalSidebarNav';
import { useConfirm } from '@/components/ConfirmDialog';

interface ClientItem { id: string; name: string; short_name?: string | null }

interface Member {
  id: string;
  client_id: string;
  member_email: string;
  role: 'approver' | 'entry' | 'viewer';
  invited_at: string;
  note: string | null;
}

const ROLE_LABEL: Record<string, string> = { approver: '承認者', entry: '入力者', viewer: '閲覧者' };
// ロールは「人」系の配色（violet=承認者 / indigo=入力者 / slate=閲覧者）。
// 監査アクション色（emerald/amber/red）とは色系統を分け、凡例の混同を防ぐ。
const ROLE_COLOR: Record<string, string> = {
  approver: 'bg-violet-100 text-violet-700',
  entry: 'bg-indigo-100 text-indigo-700',
  viewer: 'bg-slate-100 text-slate-500',
};

function fmtDate(s: string) {
  return new Date(s).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function UserRolesInner() {
  const confirm = useConfirm();
  const sp = useSearchParams();
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [clientId, setClientId] = useState(sp.get('clientId') ?? '');
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'approver' | 'entry' | 'viewer'>('entry');
  const [newNote, setNewNote] = useState('');

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(j => setClients(j.clients ?? [])).catch(() => {});
  }, []);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (clientId) p.set('clientId', clientId);
      const res = await fetch(`/api/client-members?${p}`);
      const json = await res.json();
      if (res.ok) setMembers(json.members ?? []);
      else setError(json.error ?? '取得失敗');
    } catch {
      setError('取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  const addMember = async () => {
    if (!newEmail || !clientId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/client-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, member_email: newEmail, role: newRole, note: newNote }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? '追加失敗'); return; }
      setNewEmail('');
      setNewNote('');
      fetchMembers();
    } catch {
      setError('追加に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const deleteMember = async (id: string) => {
    if (!(await confirm({ message: 'このメンバーを削除しますか？', tone: 'danger' }))) return;
    try {
      const res = await fetch(`/api/client-members?id=${id}`, { method: 'DELETE' });
      if (res.ok) fetchMembers();
      else { const j = await res.json(); setError(j.error ?? '削除失敗'); }
    } catch {
      setError('削除に失敗しました');
    }
  };

  const clientName = clients.find(c => c.id === clientId)?.name ?? '';

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-lime-50 p-4 md:p-8">
      <div className="max-w-[1140px] mx-auto flex gap-5 items-start">
        <JournalSidebarNav clientId={clientId} active="user-roles" />
        <div className="flex-1 min-w-0 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-bold text-slate-800">ユーザーロール管理</h1>
          <Link href="/" className="text-sm text-sky-600 hover:underline">← 日記帳に戻る</Link>
        </div>

        {/* 顧問先選択 */}
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500">顧問先</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-400"
            >
              <option value="">選択してください</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.short_name ?? c.name}</option>)}
            </select>
          </div>
          {clientId && (
            <p className="text-xs text-slate-400">
              「{clientName}」のアクセス権限を管理します
            </p>
          )}
        </div>

        {/* メンバー追加フォーム */}
        {clientId && (
          <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-slate-700">メンバーを追加</h2>
            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">メールアドレス</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-400 w-64"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">ロール</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as 'approver' | 'entry' | 'viewer')}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-400"
                >
                  <option value="entry">入力者</option>
                  <option value="approver">承認者</option>
                  <option value="viewer">閲覧者</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">メモ（任意）</label>
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="担当者名など"
                  className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-400 w-40"
                />
              </div>
              <button
                onClick={addMember}
                disabled={saving || !newEmail}
                className="text-sm font-semibold text-white bg-sky-500 rounded-xl px-5 py-2 hover:bg-sky-600 disabled:opacity-50 transition-all"
              >
                {saving ? '追加中…' : '追加'}
              </button>
            </div>
          </div>
        )}

        {/* メンバー一覧 */}
        {clientId && (
          <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">登録メンバー</h2>
              <span className="text-xs text-slate-400">{members.length}件</span>
            </div>
            {loading ? (
              <p className="px-5 py-8 text-sm text-slate-400 text-center">読み込み中…</p>
            ) : members.length === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-400 text-center">メンバーが登録されていません</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50/50 border-b border-slate-100">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">メールアドレス</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">ロール</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">メモ</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest">招待日時</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {members.map(m => (
                    <tr key={m.id} className="hover:bg-slate-50/40">
                      <td className="px-4 py-3 text-xs font-mono text-slate-600">{m.member_email}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${ROLE_COLOR[m.role] ?? 'bg-slate-100 text-slate-500'}`}>
                          {ROLE_LABEL[m.role] ?? m.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">{m.note ?? '—'}</td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-400">{fmtDate(m.invited_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => deleteMember(m.id)}
                          className="text-[10px] text-red-400 hover:text-red-600 border border-red-200 hover:border-red-400 rounded-lg px-2.5 py-1 transition-colors"
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ロール説明 */}
        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">ロールの権限について</h2>
          <div className="space-y-2 text-xs text-slate-500">
            <div className="flex items-start gap-3">
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 mt-0.5 ${ROLE_COLOR.approver}`}>承認者</span>
              <p>仕訳の入力・編集・承認・却下が可能。顧問先の全データを閲覧できます。</p>
            </div>
            <div className="flex items-start gap-3">
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 mt-0.5 ${ROLE_COLOR.entry}`}>入力者</span>
              <p>仕訳の入力・編集が可能。承認・却下操作はできません。</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-500 shrink-0 mt-0.5">閲覧者</span>
              <p>データの閲覧のみ可能。入力・編集・承認はできません。</p>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

export default function UserRolesPage() {
  return <Suspense><UserRolesInner /></Suspense>;
}
