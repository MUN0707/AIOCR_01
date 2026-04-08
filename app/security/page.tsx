import Link from 'next/link';

export default function SecurityPage() {
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
            <Link href="/guide" className="hover:text-sky-800 transition-colors">使い方</Link>
            <Link href="/faq" className="hover:text-sky-800 transition-colors">FAQ</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-6 py-16 space-y-12">
        {/* ヒーロー */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 bg-sky-100 text-sky-700 text-sm font-semibold px-4 py-2 rounded-full">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            情報セキュリティについて
          </div>
          <h1 className="text-4xl font-extrabold text-sky-900">顧客情報は、外に出ません</h1>
          <p className="text-sky-600 text-lg max-w-xl mx-auto">
            AIで自動処理しながら、情報流出リスクをゼロにする設計をご説明します。
          </p>
        </div>

        {/* データフロー図 */}
        <div className="bg-white rounded-2xl shadow-sm border border-sky-100 p-8 space-y-6">
          <h2 className="text-xl font-bold text-sky-900">データの流れ</h2>
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-center">
            {[
              { icon: '💻', label: 'あなたのPC', sub: 'PDFをアップロード' },
              { icon: '🔒', label: 'HTTPS暗号化通信', sub: 'TLS 1.2以上', arrow: true },
              { icon: '🤖', label: 'AI処理', sub: 'Claude API（解析のみ）' },
              { icon: '📥', label: '結果を返す', sub: '分割PDFをダウンロード', arrow: true },
              { icon: '🗑️', label: 'データ削除', sub: '処理後に即時消去' },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3 md:gap-4">
                {item.arrow && (
                  <div className="hidden md:block text-sky-300 text-xl font-bold">→</div>
                )}
                <div className="flex flex-col items-center gap-1 min-w-[80px]">
                  <div className="text-3xl">{item.icon}</div>
                  <p className="font-bold text-sky-800">{item.label}</p>
                  <p className="text-sky-400 text-xs">{item.sub}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-sky-50 rounded-xl p-4 text-center">
            <p className="text-sky-700 font-semibold text-sm">
              ポイント：サーバーにPDFファイルは保存されません。処理が終わればデータの痕跡は残りません。
            </p>
          </div>
        </div>

        {/* 3つの約束 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              icon: (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              ),
              title: 'データは保存しない',
              body: 'アップロードされたPDFはAI処理のみに使用し、サーバー上に保存・蓄積しません。処理完了後は即時削除されます。',
            },
            {
              icon: (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              ),
              title: 'AI学習に使われない',
              body: 'Anthropic（Claude提供元）の公式ポリシーにより、APIを通じたデータはAIの学習・訓練に一切使用されません。',
            },
            {
              icon: (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              ),
              title: '通信はすべて暗号化',
              body: 'すべての通信はTLS 1.2以上で暗号化されます。ネットバンキングと同等以上のセキュリティ水準です。',
            },
          ].map((item) => (
            <div key={item.title} className="bg-white rounded-2xl shadow-sm border border-sky-100 p-6 space-y-4">
              <div className="w-12 h-12 bg-sky-50 rounded-xl flex items-center justify-center">
                {item.icon}
              </div>
              <h3 className="font-bold text-sky-900 text-lg">{item.title}</h3>
              <p className="text-sky-600 text-sm leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>

        {/* 比較表 */}
        <div className="bg-white rounded-2xl shadow-sm border border-sky-100 overflow-hidden">
          <div className="px-8 py-6 border-b border-sky-50">
            <h2 className="text-xl font-bold text-sky-900">他の方法との比較</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-sky-50">
                  <th className="text-left px-8 py-4 text-sky-700 font-semibold">方法</th>
                  <th className="px-6 py-4 text-sky-700 font-semibold text-center">誤送信リスク</th>
                  <th className="px-6 py-4 text-sky-700 font-semibold text-center">通信暗号化</th>
                  <th className="px-6 py-4 text-sky-700 font-semibold text-center">データ保存</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-50">
                {[
                  ['FAX送信', '高い（番号間違い等）', 'なし', 'なし'],
                  ['メール添付', '高い（誤送信・盗聴）', '不確実', 'メールサーバーに残る'],
                  ['本ツール', 'なし', 'TLS 1.2以上', '処理後即時削除'],
                ].map(([method, risk, enc, storage], i) => (
                  <tr key={method} className={i === 2 ? 'bg-sky-50/60 font-semibold' : 'hover:bg-sky-50/30 transition-colors'}>
                    <td className="px-8 py-4 text-sky-800">{method}</td>
                    <td className={`px-6 py-4 text-center text-sm ${i === 2 ? 'text-lime-600' : 'text-red-400'}`}>{risk}</td>
                    <td className={`px-6 py-4 text-center text-sm ${i === 2 ? 'text-lime-600' : 'text-sky-400'}`}>{enc}</td>
                    <td className={`px-6 py-4 text-center text-sm ${i === 2 ? 'text-lime-600' : 'text-sky-400'}`}>{storage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 認証・アクセス管理 */}
        <div className="bg-white rounded-2xl shadow-sm border border-sky-100 p-8 space-y-6">
          <h2 className="text-xl font-bold text-sky-900">アクセス管理</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
            {[
              {
                title: 'ログイン認証',
                body: 'Googleアカウントまたはメールアドレスによる認証が必要です。第三者はアクセスできません。',
              },
              {
                title: '業界標準の認証基盤',
                body: 'Supabase（世界70万社以上が採用）を使用。金融・医療機関も採用する信頼性の高い認証基盤です。',
              },
              {
                title: 'プライバシーポリシー完備',
                body: 'データの取り扱いについて明文化したプライバシーポリシーを公開しています。',
              },
              {
                title: '特定商取引法対応',
                body: '運営者情報を特商法に基づき開示しています。安心してご利用いただける透明な事業体制です。',
              },
            ].map((item) => (
              <div key={item.title} className="flex gap-4">
                <div className="w-8 h-8 bg-lime-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#84cc16" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div>
                  <p className="font-bold text-sky-900 mb-1">{item.title}</p>
                  <p className="text-sky-600 leading-relaxed">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center space-y-3">
          <Link
            href="/sales"
            className="inline-block bg-sky-500 hover:bg-sky-600 text-white font-bold px-10 py-4 rounded-full text-lg shadow-lg transition-all hover:shadow-xl hover:-translate-y-0.5"
          >
            サービス詳細を見る →
          </Link>
          <p className="text-sky-400 text-sm">まずは3日間、無料でお試しいただけます</p>
        </div>
      </main>
    </div>
  );
}
