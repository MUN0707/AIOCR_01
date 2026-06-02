'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * グローバル確認ダイアログ。
 * window.confirm() の置き換え用。await confirm(...) で boolean を返す。
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm('削除しますか？'))) return;
 *   if (!(await confirm({ message: '本当に削除しますか？', tone: 'danger' }))) return;
 */

export type ConfirmOptions = {
  /** 本文（\n で改行可能） */
  message: string;
  /** ヘッダー見出し（省略時はトーンに応じた既定文言） */
  title?: string;
  /** 実行ボタンの文言（既定: 「実行する」、danger 時「削除する」） */
  confirmLabel?: string;
  /** キャンセルボタンの文言（既定: 「キャンセル」） */
  cancelLabel?: string;
  /** danger は破壊的操作（削除・解除）向けの赤系スタイル */
  tone?: 'default' | 'danger';
};

type ConfirmInput = string | ConfirmOptions;

type ConfirmFn = (input: ConfirmInput) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

function normalize(input: ConfirmInput): ConfirmOptions {
  return typeof input === 'string' ? { message: input } : input;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((input) => {
    setOpts(normalize(input));
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const close = useCallback((value: boolean) => {
    setOpts(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(value);
  }, []);

  const ctx = useMemo(() => confirm, [confirm]);

  const danger = opts?.tone === 'danger';
  const title = opts?.title ?? (danger ? '確認' : '確認');
  const confirmLabel = opts?.confirmLabel ?? (danger ? '削除する' : '実行する');
  const cancelLabel = opts?.cancelLabel ?? 'キャンセル';

  return (
    <ConfirmContext.Provider value={ctx}>
      {children}
      {opts && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
          onClick={() => close(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`px-6 py-4 border-b border-slate-100 ${
                danger ? 'bg-red-50/50' : 'bg-slate-50/60'
              }`}
            >
              <p
                className={`text-sm font-semibold tracking-tight ${
                  danger ? 'text-red-700' : 'text-slate-700'
                }`}
              >
                {title}
              </p>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                {opts.message}
              </p>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/30 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => close(false)}
                className="px-4 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => close(true)}
                className={`px-4 py-2 text-xs font-semibold text-white rounded-lg transition-colors ${
                  danger
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-sky-600 hover:bg-sky-700'
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return ctx;
}
