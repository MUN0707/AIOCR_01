// ルート全体の汎用ローディング。route segment 遷移時に Next.js が自動表示する。
// Tailwind 標準の animate-spin / animate-pulse のみ使用（カスタム keyframe 不要・全アプリ移植可）。
export default function Loading() {
  return (
    <div className="fixed inset-0 z-[100] pointer-events-none" aria-busy="true" aria-live="polite">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-100 overflow-hidden">
        <div className="h-full w-1/3 bg-blue-600 animate-pulse" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex items-center gap-3 bg-white/90 backdrop-blur-sm rounded-2xl border border-gray-200 px-5 py-3 shadow-lg">
          <span className="inline-block h-5 w-5 rounded-full border-2 border-blue-600 border-r-transparent animate-spin" />
          <span className="text-sm font-medium text-gray-700">読み込み中…</span>
        </div>
      </div>
    </div>
  );
}
