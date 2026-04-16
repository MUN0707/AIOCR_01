'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';

// ─── SVG Icons (inline, line style) ─────────────────────────────────────────
const IconAlertCircle = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const IconX = ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// ─── 除外パス（LP・ログイン） ────────────────────────────────────────────────
const EXCLUDED_PATHS = ['/login', '/lp'];

/**
 * 全ユーザー向けページに表示するフローティングエラー報告ボタン + モーダル。
 * メインページ (/) は page.tsx 内に独自のエラー報告UIがあるため除外。
 */
export default function ErrorReportFab() {
  const pathname = usePathname();

  // 除外判定: login, LP, メインページ（独自実装あり）
  const hidden =
    pathname === '/' ||
    EXCLUDED_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));

  const [show, setShow] = useState(false);
  const [comment, setComment] = useState('');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // ドラッグ
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef({ dragging: false, offsetX: 0, offsetY: 0 });

  const onDragStart = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragRef.current = { dragging: true, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
    e.preventDefault();
  }, []);

  useEffect(() => {
    if (!show) return;
    const handleMove = (e: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      setPos({ x: e.clientX - dragRef.current.offsetX, y: e.clientY - dragRef.current.offsetY });
    };
    const handleUp = () => { dragRef.current.dragging = false; };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [show]);

  const openModal = () => {
    setComment('');
    setScreenshot(null);
    setMessage(null);
    if (typeof window !== 'undefined') {
      const w = 520;
      setPos({ x: Math.max(20, (window.innerWidth - w) / 2), y: Math.max(20, window.innerHeight * 0.12) });
    }
    setShow(true);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => setScreenshot(typeof reader.result === 'string' ? reader.result : null);
        reader.readAsDataURL(file);
        e.preventDefault();
        return;
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setScreenshot(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const handleSend = async () => {
    if (!comment.trim() || sending) return;
    setSending(true);
    setMessage(null);
    try {
      const res = await fetch('/api/report-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comment,
          screenshot,
          mode: null,
          context: { page: pathname },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '送信失敗');
      setMessage('送信しました。管理者に届きました。');
      setComment('');
      setScreenshot(null);
      setTimeout(() => setShow(false), 1500);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '送信に失敗しました');
    } finally {
      setSending(false);
    }
  };

  if (hidden) return null;

  return (
    <>
      {/* フローティングボタン（右下固定） */}
      <button
        type="button"
        onClick={openModal}
        className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-4 py-2.5 shadow-lg hover:bg-amber-100 transition-all"
        title="エラー・不具合を報告する"
      >
        <IconAlertCircle className="w-4 h-4" />
        エラー報告
      </button>

      {/* モーダル（ドラッグ可能・背景透過） */}
      {show && (
        <div
          className="fixed z-50 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
          style={{ left: `${pos.x}px`, top: `${pos.y}px`, width: '520px', maxHeight: '80vh' }}
          onPaste={handlePaste}
        >
          <div className="bg-white overflow-y-auto" style={{ maxHeight: '80vh' }}>
            <div
              className="px-6 pt-4 pb-3 border-b border-slate-100 cursor-move select-none bg-slate-50/60"
              onMouseDown={onDragStart}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <IconAlertCircle className="w-4 h-4 text-amber-500" />
                  <h3 className="text-base font-semibold text-slate-900 tracking-tight">エラー報告</h3>
                  <span className="text-[10px] text-slate-400 ml-1">(ここをドラッグで移動)</span>
                </div>
                <button
                  onClick={() => !sending && setShow(false)}
                  disabled={sending}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100"
                  aria-label="閉じる"
                >
                  <IconX className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                スクショとコメントを管理者に送信します。
                スクショは <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px]">Win+Shift+S</kbd> で切り取り後、下の枠内に <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px]">Ctrl+V</kbd> で貼付、またはファイル選択。
              </p>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-600 tracking-wide">スクリーンショット</label>
                <div className="mt-2">
                  {screenshot ? (
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={screenshot} alt="screenshot" className="w-full rounded-xl border border-slate-200" />
                      <button
                        onClick={() => setScreenshot(null)}
                        className="absolute top-2 right-2 bg-white/90 border border-slate-200 rounded-full p-1.5 hover:bg-white"
                      >
                        <IconX className="w-3.5 h-3.5 text-slate-500" />
                      </button>
                    </div>
                  ) : (
                    <div className="border-2 border-dashed border-slate-200 rounded-xl px-4 py-6 text-center">
                      <p className="text-xs text-slate-400 mb-2">ここに Ctrl+V で貼付</p>
                      <label className="inline-block text-xs text-sky-600 border border-sky-200 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-sky-50">
                        またはファイルを選択
                        <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                      </label>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 tracking-wide">コメント <span className="text-red-500">*</span></label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={5}
                  placeholder="何がおかしかったか、期待した結果などをご記入ください"
                  className="mt-2 w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 resize-none"
                />
              </div>

              {message && (
                <div className={`text-xs rounded-xl px-3 py-2 ${message.includes('送信しました') ? 'bg-lime-50 text-lime-700 border border-lime-100' : 'bg-red-50 text-red-600 border border-red-100'}`}>
                  {message}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
              <button
                onClick={() => setShow(false)}
                disabled={sending}
                className="text-xs text-slate-500 border border-slate-200 rounded-xl px-4 py-2.5 hover:bg-slate-50 transition-all disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleSend}
                disabled={sending || !comment.trim()}
                className="text-xs text-white bg-sky-500 rounded-xl px-4 py-2.5 font-semibold hover:bg-sky-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? '送信中...' : '管理者に送信'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
