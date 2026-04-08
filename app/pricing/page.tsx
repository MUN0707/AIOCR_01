import Link from 'next/link';

export default function PricingPage() {
  const lightPrice = 5000;
  const heavyPrice = 10000;

  const plans = [
    {
      name: 'ライトプラン',
      price: lightPrice,
      color: 'white',
      badge: null,
      description: '月の処理量が少ない事務所向け',
      features: [
        '月50件まで処理',
        'AIによる請求書自動解析',
        'PDF分割・ファイル命名',
        'ZIPダウンロード対応',
        'メールサポート',
      ],
      cta: '申し込む',
      ctaStyle: 'bg-sky-500 hover:bg-sky-600 text-white',
    },
    {
      name: 'ヘビープラン',
      price: heavyPrice,
      color: 'sky',
      badge: 'おすすめ',
      description: '処理量の多い事務所・多店舗対応',
      features: [
        '月200件まで処理',
        'AIによる請求書自動解析',
        'PDF分割・ファイル命名',
        'ZIPダウンロード対応',
        '法人請求書・確定申告の両モード',
        '優先サポート（翌営業日以内）',
      ],
      cta: '今すぐ申し込む',
      ctaStyle: 'bg-white hover:bg-sky-50 text-sky-600',
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
            <Link href="/security" className="hover:text-sky-800 transition-colors">セキュリティ</Link>
            <Link href="/guide" className="hover:text-sky-800 transition-colors">使い方</Link>
            <Link href="/faq" className="hover:text-sky-800 transition-colors">FAQ</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-6 py-16 space-y-16">
        {/* ヒーロー */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 bg-sky-100 text-sky-700 text-sm font-semibold px-4 py-2 rounded-full">
            まずは3日間、無料でお試しいただけます
          </div>
          <h1 className="text-4xl font-extrabold text-sky-900">料金プラン</h1>
          <p className="text-sky-600 text-lg max-w-xl mx-auto">
            事務所の規模に合わせて選べる2プラン。どちらも銀行振込に対応。
          </p>
        </div>

        {/* プランカード */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* ライトプラン */}
          <div className="bg-white rounded-2xl shadow-md border border-sky-100 p-8 space-y-6">
            <div className="space-y-1">
              <p className="text-sky-500 font-bold text-sm uppercase tracking-wide">{plans[0].name}</p>
              <div className="flex items-end gap-1">
                <p className="text-4xl font-extrabold text-sky-900">¥{plans[0].price.toLocaleString()}</p>
                <p className="text-sky-400 text-sm mb-1">/ 月</p>
              </div>
              <p className="text-sky-500 text-sm">{plans[0].description}</p>
            </div>
            <ul className="space-y-3 text-sky-800 text-sm">
              {plans[0].features.map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center text-xs font-bold flex-shrink-0">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <Link href="/subscribe" className={`block text-center font-bold py-3 rounded-full transition-colors ${plans[0].ctaStyle} border border-sky-200`}>
              {plans[0].cta}
            </Link>
          </div>

          {/* ヘビープラン */}
          <div className="bg-sky-500 rounded-2xl shadow-xl p-8 space-y-6 relative overflow-hidden">
            <div className="absolute top-4 right-4 bg-white text-sky-600 text-xs font-bold px-3 py-1 rounded-full">
              {plans[1].badge}
            </div>
            <div className="space-y-1">
              <p className="text-sky-100 font-bold text-sm uppercase tracking-wide">{plans[1].name}</p>
              <div className="flex items-end gap-1">
                <p className="text-4xl font-extrabold text-white">¥{plans[1].price.toLocaleString()}</p>
                <p className="text-sky-200 text-sm mb-1">/ 月</p>
              </div>
              <p className="text-sky-200 text-sm">{plans[1].description}</p>
            </div>
            <ul className="space-y-3 text-white text-sm">
              {plans[1].features.map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-white/20 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <Link href="/subscribe" className={`block text-center font-bold py-3 rounded-full transition-colors ${plans[1].ctaStyle}`}>
              {plans[1].cta}
            </Link>
          </div>
        </div>

        {/* プラン比較表 */}
        <div className="bg-white rounded-2xl shadow-sm border border-sky-100 overflow-hidden">
          <div className="px-8 py-6 border-b border-sky-50">
            <h2 className="text-xl font-bold text-sky-900">プラン比較</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-sky-50">
                  <th className="text-left px-8 py-4 text-sky-700 font-semibold w-1/2">機能</th>
                  <th className="px-6 py-4 text-sky-700 font-semibold text-center">ライト</th>
                  <th className="px-6 py-4 text-sky-700 font-semibold text-center">ヘビー</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-50">
                {[
                  ['月額料金', '¥5,000', '¥10,000'],
                  ['月次処理件数', '50件', '200件'],
                  ['請求書モード', '✓', '✓'],
                  ['確定申告モード', '—', '✓'],
                  ['PDF分割・ZIP一括DL', '✓', '✓'],
                  ['サポート', 'メール', '優先（翌営業日）'],
                ].map(([label, light, heavy]) => (
                  <tr key={label} className="hover:bg-sky-50/50 transition-colors">
                    <td className="px-8 py-4 text-sky-800 font-medium">{label}</td>
                    <td className="px-6 py-4 text-center text-sky-600">{light}</td>
                    <td className="px-6 py-4 text-center text-sky-600 font-semibold">{heavy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* お支払い */}
        <div className="bg-white rounded-2xl shadow-sm border border-sky-100 p-8 space-y-4">
          <h2 className="text-xl font-bold text-sky-900 text-center">お支払い方法</h2>
          <div className="max-w-sm mx-auto border border-sky-100 rounded-2xl p-6 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-sky-100 rounded-full flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M8 3v5M16 3v5"/></svg>
              </div>
              <p className="font-bold text-sky-900">銀行振込</p>
            </div>
            <p className="text-sky-600 text-sm leading-relaxed">
              2ヶ月分を前払い。入金確認後（1〜2営業日）に利用開始となります。
            </p>
            <p className="text-xs text-sky-400">クレジットカード登録不要・自動課金なし</p>
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
