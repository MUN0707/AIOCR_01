'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useConfirm } from '@/components/ConfirmDialog';

type HistoryItem = {
  id: string;
  file_name: string;
  mode: string;
  file_size_bytes: number | null;
  created_at: string;
  item_count: number;
};

type ClientItem = {
  id: string;
  name: string;
};

type InvoiceItem = {
  index?: number;
  pageStart?: number;
  pageEnd?: number;
  date?: string | null;
  requesterName?: string | null;
  taxIncludedAmount?: number | null;
  fileName?: string;
};

type JournalEntryItem = {
  id: string;
  entry_type: string;
  entry_date: string;
  debit_account: string;
  credit_account: string;
  amount: number;
  description: string | null;
  vendor_name: string | null;
  match_status: string;
};

type UploadDetail = {
  upload: {
    id: string;
    file_name: string;
    mode: string;
    created_at: string;
    client_id: string | null;
    ocr_result: {
      invoices?: InvoiceItem[];
      transactions?: unknown[];
    } | null;
  };
  pdfUrl: string | null;
  corrections: Array<{
    item_index: number;
    field_name: string;
    original_value: string | null;
    corrected_value: string | null;
    created_at: string;
  }>;
  journalEntries: JournalEntryItem[];
};

const MODE_LABEL: Record<string, string> = {
  invoice: '請求書分割',
  'invoice-single': '請求書（単票）',
  'tax-return': '確定申告書',
  'bank-statement': '通帳',
};

const EDITABLE_FIELDS: Array<{ key: keyof InvoiceItem; label: string; type: 'text' | 'number' | 'date' }> = [
  { key: 'date', label: '日付(YYYYMMDD)', type: 'text' },
  { key: 'requesterName', label: '請求元', type: 'text' },
  { key: 'taxIncludedAmount', label: '税込金額', type: 'number' },
];

function formatBytes(n: number | null): string {
  if (!n) return '-';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function formatDate(s: string): string {
  const d = new Date(s);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function HistoryPage() {
  const confirm = useConfirm();
  const router = useRouter();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<UploadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [edited, setEdited] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [modeFilter, setModeFilter] = useState<string>('all');

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      // 履歴は所有者本人なら管理者でなくても閲覧可能（誤アップロード修正のため）
      try {
        const meRes = await fetch('/api/me');
        if (meRes.ok) {
          const me = await meRes.json();
          setIsAdmin(!!me.isAdmin);
        }
      } catch {
        // silent
      }
      const res = await fetch('/api/history');
      if (!res.ok) {
        setItems([]);
        return;
      }
      const data = await res.json();
      setItems(data.items ?? []);

      // 法人（クライアント）一覧
      try {
        const cRes = await fetch('/api/clients');
        if (cRes.ok) {
          const cData = await cRes.json();
          setClients(cData.clients ?? []);
        }
      } catch {
        // silent
      }
    })();
  }, [router]);

  const loadDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setEdited({});
    setSaveMessage(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/history?id=${id}`);
      if (res.ok) {
        const data = (await res.json()) as UploadDetail;
        setDetail(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleFieldEdit = (itemIdx: number, field: string, value: string) => {
    setEdited((prev) => ({
      ...prev,
      [itemIdx]: { ...(prev[itemIdx] ?? {}), [field]: value },
    }));
  };

  const handleDeleteJournalEntries = async () => {
    if (!detail) return;
    const ok = await confirm({
      message: `このアップロードから作成された仕訳をすべて削除します。\n（アップロード履歴自体は残ります）\n\nよろしいですか？`,
      tone: 'danger',
    });
    if (!ok) return;
    setActionBusy(true);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/history/${detail.upload.id}?target=journal_entries`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '削除失敗');
      setActionMessage(`仕訳 ${data.deleted} 件を削除しました${data.skipped ? `（締め済み ${data.skipped} 件はスキップ）` : ''}`);
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : '削除失敗');
    } finally {
      setActionBusy(false);
    }
  };

  const handleReassignClient = async (newClientId: string | null) => {
    if (!detail) return;

    const oldName = clients.find((c) => c.id === detail.upload.client_id)?.name ?? '（未設定）';
    const newName = newClientId ? (clients.find((c) => c.id === newClientId)?.name ?? '不明') : '（未設定）';

    // 3択: 移動 / 削除 / キャンセル
    const choice = window.prompt(
      `法人を「${oldName}」→「${newName}」に変更します。\n\nこの OCR から作成された仕訳をどうしますか？\n（締め済みの仕訳はスキップされます）\n\n1 = 新しい法人に移動する\n2 = 仕訳を削除する（再照合で作り直す場合）\n\n番号を入力してください:`,
      '1'
    );
    if (!choice || !['1', '2'].includes(choice.trim())) return;
    const deleteEntries = choice.trim() === '2';

    if (deleteEntries && !(await confirm({ message: '本当に仕訳を削除しますか？この操作は取り消せません。', tone: 'danger' }))) return;

    setActionBusy(true);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/history/${detail.upload.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: newClientId, deleteEntries }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '変更失敗');
      if (deleteEntries) {
        setActionMessage(`法人を変更し、仕訳 ${data.deleted} 件を削除しました${data.skipped ? `（締め済み ${data.skipped} 件はスキップ）` : ''}`);
      } else {
        setActionMessage(`法人を変更しました（仕訳 ${data.updated} 件を移動${data.skipped ? `／締め済み ${data.skipped} 件はスキップ` : ''}）`);
      }
      await loadDetail(detail.upload.id);
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : '変更失敗');
    } finally {
      setActionBusy(false);
    }
  };

  const handleSaveCorrections = async () => {
    if (!detail) return;
    const corrections: Array<{
      uploadId: string;
      itemIndex: number;
      fieldName: string;
      originalValue: string | null;
      correctedValue: string | null;
      mode: string;
    }> = [];

    const invoices = detail.upload.ocr_result?.invoices ?? [];
    Object.entries(edited).forEach(([idxStr, fields]) => {
      const idx = Number(idxStr);
      const original = invoices[idx] as InvoiceItem | undefined;
      Object.entries(fields).forEach(([fieldName, newValue]) => {
        const origVal = original?.[fieldName as keyof InvoiceItem];
        const origStr = origVal == null ? null : String(origVal);
        if (origStr === newValue) return;
        corrections.push({
          uploadId: detail.upload.id,
          itemIndex: idx,
          fieldName,
          originalValue: origStr,
          correctedValue: newValue === '' ? null : newValue,
          mode: detail.upload.mode,
        });
      });
    });

    if (corrections.length === 0) {
      setSaveMessage('変更がありません');
      return;
    }

    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch('/api/corrections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ corrections }),
      });
      const data = await res.json();
      if (res.ok) {
        setSaveMessage(`${data.saved}件の修正を保存しました`);
        setEdited({});
        await loadDetail(detail.upload.id);
      } else {
        setSaveMessage(`保存失敗: ${data.error}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const MODE_CATEGORIES: Array<{ key: string; label: string; modes: string[] }> = [
    { key: 'all', label: 'すべて', modes: [] },
    { key: 'invoice', label: '請求書', modes: ['invoice', 'invoice-single'] },
    { key: 'bank', label: '入出金明細', modes: ['bank-statement'] },
    { key: 'tax', label: '確定申告書', modes: ['tax-return'] },
  ];

  const filteredItems = items
    ? modeFilter === 'all'
      ? items
      : items.filter((it) => {
          const cat = MODE_CATEGORIES.find((c) => c.key === modeFilter);
          return cat ? cat.modes.includes(it.mode) : true;
        })
    : [];

  if (items === null) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center text-slate-400 text-sm">
        読み込み中...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white relative">
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute -top-64 left-1/2 -translate-x-1/2 w-[900px] h-[700px]
          rounded-full bg-sky-100 opacity-40 blur-3xl" />
      </div>

      <header className="relative bg-white/70 backdrop-blur-md border-b border-slate-100/80 sticky top-0 z-20">
        <div className="max-w-[1280px] mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 bg-sky-400 rounded-xl flex items-center justify-center shadow-sm shadow-sky-200">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 leading-tight">Invoice OCR</p>
              <p className="text-[10px] text-slate-400 leading-tight tracking-widest uppercase">History</p>
            </div>
          </Link>
          <Link href="/" className="text-xs text-slate-500 hover:text-slate-900 transition-colors">
            ← ホームへ戻る
          </Link>
        </div>
      </header>

      <main className="relative max-w-[1280px] mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">処理履歴</h1>
        <p className="text-sm text-slate-500 mb-8">
          過去にアップロードしたPDFと認識結果を確認し、誤認識を修正して精度改善に役立てられます（直近200件）。
        </p>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-400">
            まだ処理履歴がありません
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
            {/* 一覧 */}
            <div className="lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto lg:pr-2">
              {/* カテゴリタブ */}
              <div className="flex gap-1.5 mb-3 flex-wrap">
                {MODE_CATEGORIES.map((cat) => {
                  const count = cat.key === 'all'
                    ? items.length
                    : items.filter((it) => cat.modes.includes(it.mode)).length;
                  if (cat.key !== 'all' && count === 0) return null;
                  return (
                    <button
                      key={cat.key}
                      onClick={() => setModeFilter(cat.key)}
                      className={`text-[11px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
                        modeFilter === cat.key
                          ? 'bg-sky-500 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {cat.label} ({count})
                    </button>
                  );
                })}
              </div>
              <div className="space-y-2">
              {filteredItems.map((it) => (
                <button
                  key={it.id}
                  onClick={() => loadDetail(it.id)}
                  className={`w-full text-left rounded-2xl border p-4 transition-all ${
                    selectedId === it.id
                      ? 'border-sky-400 bg-sky-50/60 shadow-sm'
                      : 'border-slate-200 bg-white hover:border-sky-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900 truncate">{it.file_name}</p>
                    <span className="text-[10px] text-sky-600 bg-sky-100 rounded-full px-2 py-0.5 shrink-0">
                      {MODE_LABEL[it.mode] ?? it.mode}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-400">
                    <span>{formatDate(it.created_at)}</span>
                    <span>{formatBytes(it.file_size_bytes)}</span>
                    {it.item_count > 0 && <span>{it.item_count}件</span>}
                  </div>
                </button>
              ))}
              </div>
            </div>

            {/* 詳細 */}
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              {!selectedId ? (
                <div className="p-12 text-center text-sm text-slate-400">
                  左の一覧から項目を選択してください
                </div>
              ) : loading ? (
                <div className="p-12 text-center text-sm text-slate-400">読み込み中...</div>
              ) : detail ? (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-0">
                  {/* PDF プレビュー */}
                  <div className="border-r border-slate-100 min-h-[500px] bg-slate-50 relative">
                    {detail.pdfUrl ? (
                      <>
                        <iframe
                          src={detail.pdfUrl}
                          className="w-full h-full min-h-[500px]"
                          title="PDF preview"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const res = await fetch(detail.pdfUrl!);
                              const blob = await res.blob();
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = detail.upload.file_name || 'document.pdf';
                              document.body.appendChild(a);
                              a.click();
                              a.remove();
                              URL.revokeObjectURL(url);
                            } catch {
                              window.open(detail.pdfUrl!, '_blank');
                            }
                          }}
                          className="absolute top-3 right-3 inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-sky-500/90 hover:bg-sky-600 rounded-xl px-3 py-2 shadow-lg backdrop-blur transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" /></svg>
                          PDFをダウンロード
                        </button>
                      </>
                    ) : (
                      <div className="p-8 text-sm text-slate-400 text-center">PDFが取得できません</div>
                    )}
                  </div>

                  {/* OCR結果 + 編集 */}
                  <div className="p-5 overflow-x-auto">
                    <div className="flex items-center justify-between mb-4 gap-2">
                      <h2 className="text-sm font-semibold text-slate-900 truncate pr-3">
                        {detail.upload.file_name}
                      </h2>
                      {isAdmin && (
                        <button
                          onClick={handleSaveCorrections}
                          disabled={saving || Object.keys(edited).length === 0}
                          className="text-xs font-semibold bg-sky-500 text-white rounded-xl px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-sky-600 transition-colors shrink-0"
                        >
                          {saving ? '保存中...' : '修正を保存'}
                        </button>
                      )}
                    </div>

                    {/* 操作パネル: 別法人へ紐付け / 仕訳一括削除 */}
                    <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-semibold text-slate-500 tracking-wide">紐付け法人</span>
                        <select
                          value={detail.upload.client_id ?? ''}
                          disabled={actionBusy}
                          onChange={(e) => handleReassignClient(e.target.value || null)}
                          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-sky-400"
                        >
                          <option value="">（未設定）</option>
                          {clients.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        <div className="ml-auto">
                          <button
                            type="button"
                            onClick={handleDeleteJournalEntries}
                            disabled={actionBusy}
                            className="text-[11px] font-semibold text-red-600 border border-red-200 bg-white rounded-lg px-3 py-1.5 hover:bg-red-50 disabled:opacity-40 transition-colors"
                          >
                            このOCRから作られた仕訳を一括削除
                          </button>
                        </div>
                      </div>
                      {actionMessage && (
                        <p className="text-[11px] text-slate-600">{actionMessage}</p>
                      )}
                    </div>

                    {saveMessage && (
                      <p className="text-xs text-sky-600 mb-3">{saveMessage}</p>
                    )}

                    {(detail.upload.mode === 'invoice' || detail.upload.mode === 'invoice-single' || detail.upload.mode === 'tax-return') && (
                      <div className="space-y-3">
                        {(detail.upload.ocr_result?.invoices ?? []).map((inv: InvoiceItem, idx: number) => (
                          <div key={idx} className="rounded-xl border border-slate-200 p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-[10px] text-slate-400">#{idx + 1}</span>
                              {inv.pageStart != null && (
                                <span className="text-[10px] text-slate-400">
                                  p{inv.pageStart}{inv.pageEnd !== inv.pageStart ? `-${inv.pageEnd}` : ''}
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-1 gap-2">
                              {EDITABLE_FIELDS.map((f) => {
                                const orig = inv[f.key];
                                const origStr = orig == null ? '' : String(orig);
                                const currentVal = edited[idx]?.[f.key as string] ?? origStr;
                                const isDirty = edited[idx]?.[f.key as string] !== undefined && edited[idx]?.[f.key as string] !== origStr;
                                return (
                                  <label key={f.key as string} className="block">
                                    <span className="text-[10px] text-slate-500">{f.label}</span>
                                    <input
                                      type="text"
                                      value={currentVal}
                                      onChange={(e) => handleFieldEdit(idx, f.key as string, e.target.value)}
                                      className={`w-full mt-0.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                                        isDirty
                                          ? 'border-lime-400 bg-lime-50'
                                          : 'border-slate-200 bg-white'
                                      } focus:outline-none focus:border-sky-400`}
                                    />
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {detail.upload.mode === 'bank-statement' && (
                      <pre className="text-[11px] bg-slate-50 p-3 rounded-xl overflow-x-auto text-slate-600">
                        {JSON.stringify(detail.upload.ocr_result, null, 2)}
                      </pre>
                    )}

                    {/* 紐づく仕訳一覧 */}
                    {detail.journalEntries && detail.journalEntries.length > 0 && (
                      <div className="mt-6 pt-4 border-t border-slate-100">
                        <p className="text-[11px] font-semibold text-slate-500 mb-3">
                          紐づく仕訳 ({detail.journalEntries.length}件)
                        </p>
                        <div className="space-y-2">
                          {detail.journalEntries.map((je) => (
                            <div key={je.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                <span className="text-[10px] font-bold text-slate-400">
                                  {je.entry_date?.replace(/(\d{4})(\d{2})(\d{2})/, '$1/$2/$3') ?? '-'}
                                </span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  je.entry_type === 'accrual'
                                    ? 'bg-violet-100 text-violet-700'
                                    : 'bg-emerald-100 text-emerald-700'
                                }`}>
                                  {je.entry_type === 'accrual' ? '費用計上' : '支払'}
                                </span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  je.match_status === 'auto'
                                    ? 'bg-sky-100 text-sky-700'
                                    : je.match_status === 'needs_review'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {je.match_status === 'auto' ? '自動照合' : je.match_status === 'needs_review' ? '要確認' : '未照合'}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 text-[11px] text-slate-700">
                                <span className="font-semibold">{je.debit_account}</span>
                                <span className="text-slate-400">/</span>
                                <span className="font-semibold">{je.credit_account}</span>
                                <span className="ml-auto font-bold text-slate-900">
                                  ¥{je.amount?.toLocaleString() ?? '-'}
                                </span>
                              </div>
                              {(je.vendor_name || je.description) && (
                                <p className="text-[10px] text-slate-400 mt-1 truncate">
                                  {je.vendor_name}{je.vendor_name && je.description ? ' / ' : ''}{je.description}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {detail.corrections.length > 0 && (
                      <div className="mt-6 pt-4 border-t border-slate-100">
                        <p className="text-[11px] font-semibold text-slate-500 mb-2">過去の修正履歴</p>
                        <div className="space-y-1">
                          {detail.corrections.map((c, i) => (
                            <div key={i} className="text-[11px] text-slate-500 flex gap-2">
                              <span className="text-slate-400">#{c.item_index + 1}</span>
                              <span>{c.field_name}:</span>
                              <span className="line-through text-slate-400">{c.original_value ?? '(空)'}</span>
                              <span>→</span>
                              <span className="text-slate-900">{c.corrected_value ?? '(空)'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-12 text-center text-sm text-slate-400">取得に失敗しました</div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
