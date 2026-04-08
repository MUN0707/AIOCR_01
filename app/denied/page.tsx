export default function DeniedPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #f7fee7 100%)' }}
    >
      <div className="bg-white rounded-2xl shadow-md border border-sky-100 p-12 text-center space-y-4 max-w-sm">
        <div className="w-16 h-16 bg-sky-50 rounded-full flex items-center justify-center mx-auto">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h1 className="text-xl font-bold text-sky-900">アクセスできません</h1>
        <p className="text-sky-500 text-sm leading-relaxed">
          このページを閲覧するには、<br />専用のURLが必要です。
        </p>
      </div>
    </div>
  );
}
