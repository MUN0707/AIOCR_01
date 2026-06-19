// データテーブル系の重いルート用スケルトン。汎用スピナーへのフォールバックを置き換え、
// レイアウトのガタつき（CLS）を抑える。各 loading.tsx から rows を指定して再利用する。
export function TableSkeleton({ rows = 8, title = true }: { rows?: number; title?: boolean }) {
  return (
    <div className="max-w-6xl mx-auto p-5 sm:p-6" aria-busy="true" aria-live="polite">
      {title && <div className="h-7 w-56 bg-gray-200 rounded animate-pulse mb-5" />}

      {/* ツールバー風 */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="h-9 w-40 bg-gray-100 rounded-lg animate-pulse" />
        <div className="h-9 w-28 bg-gray-100 rounded-lg animate-pulse" />
        <div className="h-9 w-24 bg-gray-100 rounded-lg animate-pulse ml-auto" />
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {/* ヘッダ行 */}
        <div className="grid grid-cols-12 gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-3 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
        {/* データ行 */}
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="grid grid-cols-12 gap-3 px-4 py-3.5 border-b border-gray-50">
            {Array.from({ length: 12 }).map((_, c) => (
              <div
                key={c}
                className="h-3.5 bg-gray-100 rounded animate-pulse"
                style={{ opacity: 1 - r * 0.06 }}
              />
            ))}
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-gray-400 mt-6">データを読み込んでいます…</p>
    </div>
  );
}

export default TableSkeleton;
