import Link from 'next/link';

export default function SalesPage() {
  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #f7fee7 100%)' }}>
      {/* ヘッダー */}
      <header className="bg-white/80 backdrop-blur border-b border-sky-100 px-6 py-4 shadow-sm sticky top-0 z-10">
        <div className="max-w-[900px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            <span className="text-lg font-bold text-sky-700">Invoice OCR</span>
          </div>
          <nav className="flex items-center gap-6 text-sm text-sky-600 font-medium">
            <Link href="/security" className="hover:text-sky-800 transition-colors">セキュリティ</Link>
            <Link href="/guide" className="hover:text-sky-800 transition-colors">使い方</Link>
            <Link href="/pricing" className="hover:text-sky-800 transition-colors">料金</Link>
            <Link href="/faq" className="hover:text-sky-800 transition-colors">FAQ</Link>
            <Link href="/subscribe" className="bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-full font-bold transition-colors text-xs">
              無料で試す
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-6 py-16 space-y-20">

        {/* ヒーロー */}
        <section className="text-center space-y-6">
          <div className="inline-flex items-center gap-2 bg-lime-100 text-lime-700 text-sm font-semibold px-4 py-2 rounded-full border border-lime-200">
            税理士事務所向け AI OCRツール
          </div>
          <h1 className="text-5xl font-extrabold text-sky-900 leading-tight">
            請求書の仕分け、<br />
            <span className="text-sky-500">AIに任せてみませんか？</span>
          </h1>
          <p className="text-sky-600 text-xl max-w-2xl mx-auto leading-relaxed">
            複数の請求書が混在したPDFを1クリックで自動分割・命名。<br />
            月50〜200件の処理が、わずか数分で完了します。
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link
              href="/subscribe"
              className="bg-sky-500 hover:bg-sky-600 text-white font-bold px-10 py-4 rounded-full text-lg shadow-lg transition-all hover:shadow-xl hover:-translate-y-0.5"
            >
              3日間無料で試してみる →
            </Link>
            <Link
              href="/guide"
              className="text-sky-600 hover:text-sky-800 font-semibold text-sm underline underline-offset-4 transition-colors"
            >
              使い方を見る
            </Link>
          </div>
          <p className="text-sky-400 text-sm">カード登録不要・自動課金なし</p>
        </section>

        {/* 課題提起 */}
        <section className="bg-white rounded-2xl shadow-sm border border-sky-100 p-8 space-y-6">
          <h2 className="text-2xl font-extrabold text-sky-900 text-center">こんなお悩みありませんか？</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              '毎月の請求書仕分けに何時間もかかっている',
              'スタッフによってファイル名がバラバラ',
              '大量PDFから1枚ずつ確認するのが面倒',
              'AI導入が怖い（情報漏えいが心配）',
            ].map((item) => (
              <div key={item} className="flex items-start gap-3 bg-sky-50 rounded-xl p-4">
                <span className="text-sky-400 font-bold text-xl flex-shrink-0">…</span>
                <p className="text-sky-700 text-sm font-medium leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 特長 */}
        <section className="space-y-6">
          <h2 className="text-2xl font-extrabold text-sky-900 text-center">Invoice OCR が解決します</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
                title: '月50〜200件が数分で完了',
                body: '手作業で1件3〜5分かかっていた処理を、まとめて自動化。浮いた時間を付加価値業務へ。',
              },
              {
                icon: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
                title: 'データは処理後即時削除',
                body: 'サーバーにPDFを保存しません。AI学習にも使われません。情報流出リスクはゼロです。',
              },
              {
                icon: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>,
                title: 'ファイル名を自動で統一',
                body: '「日付_請求元_金額」で自動命名。スタッフのスキルに依存しないファイル管理を実現。',
              },
            ].map((item) => (
              <div key={item.title} className="bg-white rounded-2xl shadow-sm border border-sky-100 p-6 space-y-4">
                <div className="w-12 h-12 bg-sky-50 rounded-xl flex items-center justify-center">
                  {item.icon}
                </div>
                <h3 className="font-bold text-sky-900">{item.title}</h3>
                <p className="text-sky-600 text-sm leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 営業資料PDF */}
        <section className="space-y-4">
          <h2 className="text-2xl font-extrabold text-sky-900 text-center">サービス説明資料</h2>
          <p className="text-center text-sky-500 text-sm">セキュリティ・機能・料金の詳細をまとめた資料です</p>
          <div className="bg-white rounded-2xl shadow-sm border border-sky-100 overflow-hidden">
            <iframe
              src="/sales-deck.pdf"
              className="w-full"
              style={{ height: '600px', border: 'none' }}
              title="Invoice OCR サービス説明資料"
            />
          </div>
          <div className="text-center">
            <a
              href="/sales-deck.pdf"
              download
              className="inline-flex items-center gap-2 text-sky-500 hover:text-sky-700 font-semibold text-sm transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              PDFをダウンロード
            </a>
          </div>
        </section>

        {/* ナビゲーションカード */}
        <section className="space-y-4">
          <h2 className="text-2xl font-extrabold text-sky-900 text-center">詳しく知りたい方へ</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              {
                href: '/security',
                title: 'セキュリティについて',
                body: 'データの流れ・暗号化・AI学習非使用の根拠を詳しく説明します。',
                emoji: '🔒',
              },
              {
                href: '/guide',
                title: '使い方ガイド',
                body: 'ログインから分割・ダウンロードまで、6ステップで解説します。',
                emoji: '📖',
              },
              {
                href: '/pricing',
                title: '料金プラン',
                body: 'ライト（¥5,000/月）・ヘビー（¥10,000/月）の2プランを比較できます。',
                emoji: '💴',
              },
              {
                href: '/faq',
                title: 'よくある質問',
                body: '導入前によくいただく質問を15項目まとめました。',
                emoji: '❓',
              },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="bg-white hover:bg-sky-50 rounded-2xl shadow-sm border border-sky-100 p-6 flex gap-4 items-start transition-colors group"
              >
                <span className="text-3xl">{item.emoji}</span>
                <div>
                  <p className="font-bold text-sky-900 group-hover:text-sky-600 transition-colors mb-1">{item.title} →</p>
                  <p className="text-sky-500 text-sm leading-relaxed">{item.body}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* 最終CTA */}
        <section className="bg-sky-500 rounded-2xl p-12 text-center space-y-6">
          <h2 className="text-3xl font-extrabold text-white">まずは3日間、無料でお試しください</h2>
          <p className="text-sky-100 text-lg">クレジットカード不要・自動課金なし</p>
          <Link
            href="/subscribe"
            className="inline-block bg-white hover:bg-sky-50 text-sky-600 font-bold px-12 py-4 rounded-full text-lg shadow-lg transition-all hover:shadow-xl hover:-translate-y-0.5"
          >
            無料で始める →
          </Link>
          <p className="text-sky-200 text-sm">ご不明点は <a href="mailto:support@invoice-ocr.jp" className="underline underline-offset-2">メール</a> でお気軽にどうぞ</p>
        </section>
      </main>

      {/* フッター */}
      <footer className="border-t border-sky-100 bg-white/60 backdrop-blur py-8 mt-8">
        <div className="max-w-[900px] mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-sky-400">
          <p>© 2026 Invoice OCR</p>
          <div className="flex gap-6">
            <Link href="/tokusho" className="hover:text-sky-600 transition-colors">特定商取引法</Link>
            <Link href="/security" className="hover:text-sky-600 transition-colors">セキュリティ</Link>
            <Link href="/pricing" className="hover:text-sky-600 transition-colors">料金</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
