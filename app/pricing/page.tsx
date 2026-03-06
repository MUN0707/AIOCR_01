import Link from 'next/link';

export default function PricingPage() {
  const monthlyPrice = parseInt(process.env.MONTHLY_PRICE ?? '3000', 10);
  const twoMonthPrice = monthlyPrice * 2;

  return (
    <div className="min-h-screen bg-sky-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-sky-100 px-6 py-4 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <span className="text-2xl">📄</span>
          <h1 className="text-xl font-bold text-sky-700">請求書 PDF 分割ツール</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-14 space-y-12">
        {/* ヒーロー */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 bg-sky-100 text-sky-700 text-sm font-semibold px-4 py-2 rounded-full">
            🎉 まずは3日間無料でお試しいただけます
          </div>
          <h2 className="text-4xl font-extrabold text-sky-900">シンプルな料金プラン</h2>
          <p className="text-sky-600 text-lg max-w-xl mx-auto">
            複数の請求書PDFをAI OCRで自動分割。煩わしい手作業をなくします。
          </p>
        </div>

        {/* プランカード */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* お試しプラン */}
          <div className="bg-white rounded-3xl shadow-md border border-sky-100 p-8 space-y-5">
            <div className="space-y-1">
              <p className="text-sky-500 font-bold text-sm uppercase tracking-wide">お試しプラン</p>
              <p className="text-4xl font-extrabold text-sky-900">無料</p>
              <p className="text-sky-500 text-sm">登録後 3日間</p>
            </div>
            <ul className="space-y-3 text-sky-800 text-sm">
              {[
                '全機能が使い放題',
                'AIによる請求書自動解析',
                'PDF分割・ファイル命名',
                'ZIPダウンロード対応',
                'クレジットカード登録不要',
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center text-xs font-bold flex-shrink-0">✓</span>
                  {item}
                </li>
              ))}
            </ul>
            <Link
              href="/subscribe"
              className="block text-center bg-sky-500 hover:bg-sky-600 text-white font-bold py-3 rounded-full transition-colors"
            >
              無料で始める
            </Link>
          </div>

          {/* 有料プラン */}
          <div className="bg-sky-500 rounded-3xl shadow-xl p-8 space-y-5 relative overflow-hidden">
            <div className="absolute top-4 right-4 bg-white text-sky-600 text-xs font-bold px-3 py-1 rounded-full">
              おすすめ
            </div>
            <div className="space-y-1">
              <p className="text-sky-100 font-bold text-sm uppercase tracking-wide">スタンダードプラン</p>
              <div className="flex items-end gap-1">
                <p className="text-4xl font-extrabold text-white">
                  ¥{monthlyPrice.toLocaleString()}
                </p>
                <p className="text-sky-200 text-sm mb-1">/ 月</p>
              </div>
              <p className="text-sky-200 text-sm">銀行振込は2ヶ月分（¥{twoMonthPrice.toLocaleString()}）前払い</p>
            </div>
            <ul className="space-y-3 text-white text-sm">
              {[
                '全機能が使い放題',
                'AIによる請求書自動解析',
                'PDF分割・ファイル命名',
                'ZIPダウンロード対応',
                '銀行振込',
                '優先サポート',
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-white/20 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">✓</span>
                  {item}
                </li>
              ))}
            </ul>
            <Link
              href="/subscribe"
              className="block text-center bg-white hover:bg-sky-50 text-sky-600 font-bold py-3 rounded-full transition-colors"
            >
              今すぐ申し込む
            </Link>
          </div>
        </div>

        {/* 支払い方法 */}
        <div className="bg-white rounded-3xl shadow-sm border border-sky-100 p-8 space-y-6">
          <h3 className="text-xl font-bold text-sky-900 text-center">お支払い方法</h3>
          <div className="max-w-sm mx-auto">
            <div className="border border-sky-100 rounded-2xl p-6 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-sky-100 rounded-full flex items-center justify-center text-xl">🏦</div>
                <p className="font-bold text-sky-900">銀行振込</p>
              </div>
              <p className="text-sky-600 text-sm leading-relaxed">
                2ヶ月分（¥{twoMonthPrice.toLocaleString()}）を前払い。入金確認後に利用開始となります。
              </p>
              <p className="text-xs text-sky-400">
                ※ 入金確認には1〜2営業日かかる場合があります
              </p>
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div className="space-y-4">
          <h3 className="text-xl font-bold text-sky-900 text-center">よくある質問</h3>
          <div className="space-y-3">
            {[
              {
                q: 'お試し期間中にクレカ登録は必要ですか？',
                a: '不要です。Googleアカウントで登録するだけで3日間すべての機能をお使いいただけます。',
              },
              {
                q: 'お試し期間後はどうなりますか？',
                a: 'お試し期間終了後は、支払い方法を登録しない限り自動で課金されません。有料プランに切り替える場合は「申し込む」からお手続きください。',
              },
              {
                q: '銀行振込の場合、期限が切れたらどうなりますか？',
                a: '利用期限が切れると自動的にアクセスが制限されます。継続される場合は再度振込手続きをお願いいたします。',
              },
            ].map((item) => (
              <div key={item.q} className="bg-white rounded-2xl border border-sky-100 p-6">
                <p className="font-bold text-sky-900 mb-2">Q. {item.q}</p>
                <p className="text-sky-600 text-sm">{item.a}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center space-y-4">
          <Link
            href="/subscribe"
            className="inline-block bg-sky-500 hover:bg-sky-600 text-white font-bold px-10 py-4 rounded-full text-lg shadow-lg transition-all hover:shadow-xl hover:-translate-y-0.5"
          >
            今すぐ申し込む →
          </Link>
          <p className="text-sky-400 text-sm">まずは3日間無料でお試しいただけます</p>
        </div>
      </main>
    </div>
  );
}
