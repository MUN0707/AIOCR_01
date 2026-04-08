import Link from 'next/link';

export default function GuidePage() {
  const steps = [
    {
      step: '01',
      title: 'ログイン',
      body: 'Googleアカウントまたはメールアドレスでログインします。初回は自動でアカウントが作成されます。',
      note: '3日間は無料でご利用いただけます',
    },
    {
      step: '02',
      title: 'モードを選択',
      body: '「請求書モード」または「確定申告モード」を選択します。処理したい書類の種類に合わせてお選びください。',
      note: 'ヘビープランは両モード対応',
    },
    {
      step: '03',
      title: 'PDFをアップロード',
      body: '複数の請求書がまとまったPDFファイルをドラッグ＆ドロップまたはクリックで選択します。',
      note: '複数の請求書が1つのPDFになっていてもOK',
    },
    {
      step: '04',
      title: 'AIが自動解析',
      body: 'AIが各請求書のページ範囲・日付・請求元・金額を自動で読み取ります。通常30秒〜1分で完了します。',
      note: '手書き・スキャン文書にも対応',
    },
    {
      step: '05',
      title: '結果を確認',
      body: '解析結果の一覧が表示されます。ファイル名・日付・金額を確認し、必要に応じて修正できます。',
      note: '修正箇所はクリックで編集可能',
    },
    {
      step: '06',
      title: 'ダウンロード',
      body: '個別にPDFをダウンロードするか、「まとめてZIP」で一括ダウンロードします。',
      note: 'ファイル名は「日付_請求元_金額」で自動命名',
    },
  ];

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #f7fee7 100%)' }}>
      {/* ヘッダー */}
      <header className="bg-white/80 backdrop-blur border-b border-sky-100 px-6 py-4 shadow-sm">
        <div className="max-w-[900px] mx-auto flex items-center justify-between">
          <Link href="/sales" className="flex items-center gap-2">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            <span className="text-lg font-bold text-sky-700">Invoice OCR</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm text-sky-600 font-medium">
            <Link href="/pricing" className="hover:text-sky-800 transition-colors">料金</Link>
            <Link href="/security" className="hover:text-sky-800 transition-colors">セキュリティ</Link>
            <Link href="/faq" className="hover:text-sky-800 transition-colors">FAQ</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-6 py-16 space-y-16">
        {/* ヒーロー */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 bg-sky-100 text-sky-700 text-sm font-semibold px-4 py-2 rounded-full">
            簡単3分、PCが苦手でも大丈夫
          </div>
          <h1 className="text-4xl font-extrabold text-sky-900">使い方ガイド</h1>
          <p className="text-sky-600 text-lg max-w-xl mx-auto">
            PDFをアップロードするだけ。あとはAIが自動で分割・命名します。
          </p>
        </div>

        {/* ステップ */}
        <div className="space-y-4">
          {steps.map((item, i) => (
            <div key={item.step} className="bg-white rounded-2xl shadow-sm border border-sky-100 p-6 flex gap-6 items-start">
              <div className="flex-shrink-0 w-12 h-12 bg-sky-500 text-white rounded-xl flex items-center justify-center font-extrabold text-lg">
                {item.step}
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-sky-900 text-lg mb-1">{item.title}</h3>
                <p className="text-sky-600 text-sm leading-relaxed mb-2">{item.body}</p>
                <span className="inline-block bg-lime-50 text-lime-700 text-xs font-semibold px-3 py-1 rounded-full border border-lime-200">
                  {item.note}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className="hidden" />
              )}
            </div>
          ))}
        </div>

        {/* ビフォーアフター */}
        <div className="bg-white rounded-2xl shadow-sm border border-sky-100 p-8 space-y-6">
          <h2 className="text-xl font-bold text-sky-900 text-center">導入前後の変化（試算）</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-red-50 rounded-xl p-6 space-y-3 border border-red-100">
              <p className="font-bold text-red-600 text-sm">導入前</p>
              <ul className="space-y-2 text-sm text-red-700">
                {[
                  '1件あたり手作業で3〜5分',
                  '月50件 → 約4時間の手作業',
                  'ファイル名が統一されない',
                  '抜け・ダブりのリスク',
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <span className="text-red-400 font-bold">✗</span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-lime-50 rounded-xl p-6 space-y-3 border border-lime-100">
              <p className="font-bold text-lime-600 text-sm">導入後</p>
              <ul className="space-y-2 text-sm text-lime-700">
                {[
                  '月50件 → 約5分で完了',
                  'ファイル名が自動で統一',
                  '抜け・ダブりはAIが防止',
                  '浮いた時間を付加価値業務へ',
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <span className="text-lime-500 font-bold">✓</span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-center text-sky-400 text-xs">※処理件数・時間は目安です</p>
        </div>

        {/* 対応書類 */}
        <div className="bg-white rounded-2xl shadow-sm border border-sky-100 p-8 space-y-4">
          <h2 className="text-xl font-bold text-sky-900">対応している書類</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            {[
              { emoji: '🧾', label: '電子請求書', note: 'PDF形式' },
              { emoji: '📠', label: 'スキャン請求書', note: 'スキャン画像' },
              { emoji: '✍️', label: '手書き請求書', note: 'AIが読み取り' },
              { emoji: '📋', label: '確定申告書類', note: 'ヘビープランのみ' },
            ].map((item) => (
              <div key={item.label} className="bg-sky-50 rounded-xl p-4 text-center space-y-2">
                <div className="text-3xl">{item.emoji}</div>
                <p className="font-bold text-sky-800">{item.label}</p>
                <p className="text-sky-400 text-xs">{item.note}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center space-y-3">
          <Link
            href="/subscribe"
            className="inline-block bg-sky-500 hover:bg-sky-600 text-white font-bold px-10 py-4 rounded-full text-lg shadow-lg transition-all hover:shadow-xl hover:-translate-y-0.5"
          >
            3日間無料で試してみる →
          </Link>
          <p className="text-sky-400 text-sm">カード登録不要・いつでもキャンセル可</p>
        </div>
      </main>
    </div>
  );
}
