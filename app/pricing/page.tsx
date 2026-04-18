import Link from 'next/link';

export default function PricingPage() {
  const plans = [
    {
      name: 'ライト',
      planId: 'lite',
      price: 1500,
      description: '個人事業主・少量処理向け',
      features: [
        '月30件まで処理',
        'AIによる請求書・通帳自動解析',
        'PDF分割・ファイル命名',
        'ZIPダウンロード対応',
        'メールサポート',
      ],
      cta: '申し込む',
      highlight: false,
    },
    {
      name: 'スタンダード',
      planId: 'standard',
      price: 3980,
      description: '1人税理士・少数顧問先向け',
      badge: '人気',
      features: [
        '月100件まで処理',
        'AIによる請求書・通帳自動解析',
        'PDF分割・ファイル命名',
        'ZIPダウンロード対応',
        '顧問先管理',
        'メールサポート',
      ],
      cta: '申し込む',
      highlight: true,
    },
    {
      name: 'プロ',
      planId: 'pro',
      price: 9800,
      description: '税理士事務所・20社規模向け',
      features: [
        '月500件まで処理',
        'AIによる請求書・通帳自動解析',
        'PDF分割・ファイル命名',
        'ZIPダウンロード対応',
        '顧問先管理',
        '仕訳突合',
        '優先サポート',
      ],
      cta: '申し込む',
      highlight: false,
    },
    {
      name: 'エンタープライズ',
      planId: 'enterprise',
      price: 19800,
      description: '大規模事務所・法人向け',
      features: [
        '月1,000件まで処理',
        'AIによる請求書・通帳自動解析',
        'PDF分割・ファイル命名',
        'ZIPダウンロード対応',
        '顧問先管理',
        '仕訳突合',
        '優先サポート（翌営業日以内）',
      ],
      cta: 'お問い合わせ',
      highlight: false,
    },
  ];

  const comparisonRows = [
    ['月額料金', '¥1,500', '¥3,980', '¥9,800', '¥19,800'],
    ['月次処理件数', '30件', '100件', '500件', '1,000件'],
    ['請求書・通帳OCR', '✓', '✓', '✓', '✓'],
    ['確定申告モード', '✓', '✓', '✓', '✓'],
    ['PDF分割・ZIP一括DL', '✓', '✓', '✓', '✓'],
    ['顧問先管理', '—', '✓', '✓', '✓'],
    ['仕訳突合', '—', '—', '✓', '✓'],
    ['サポート', 'メール', 'メール', '優先', '優先（翌営業日）'],
  ];

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #f7fee7 100%)' }}>
      {/* ヘッダー */}
      <header className="bg-white/80 backdrop-blur border-b border-sky-100 px-6 py-4 shadow-sm">
        <div className="max-w-[1100px] mx-auto flex items-center justify-between">
          <Link href="/login" className="flex items-center gap-2">
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

      <main className="max-w-[1100px] mx-auto px-6 py-16 space-y-16">
        {/* ヒーロー */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 bg-sky-100 text-sky-700 text-sm font-semibold px-4 py-2 rounded-full">
            まずは3日間、無料でお試しいただけます
          </div>
          <h1 className="text-4xl font-extrabold text-sky-900">料金プラン</h1>
          <p className="text-sky-600 text-lg max-w-xl mx-auto">
            事務所の規模に合わせて選べる4プラン。すべて銀行振込に対応。
          </p>
        </div>

        {/* プランカード */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl p-7 space-y-5 relative ${
                plan.highlight
                  ? 'bg-sky-500 shadow-xl text-white'
                  : 'bg-white shadow-md border border-sky-100 text-sky-900'
              }`}
            >
              {plan.badge && (
                <div className="absolute top-4 right-4 bg-white text-sky-600 text-xs font-bold px-3 py-1 rounded-full">
                  {plan.badge}
                </div>
              )}
              <div className="space-y-1">
                <p className={`font-bold text-sm uppercase tracking-wide ${plan.highlight ? 'text-sky-100' : 'text-sky-500'}`}>
                  {plan.name}
                </p>
                <div className="flex items-end gap-1">
                  <p className={`text-3xl font-extrabold ${plan.highlight ? 'text-white' : 'text-sky-900'}`}>
                    ¥{plan.price.toLocaleString()}
                  </p>
                  <p className={`text-sm mb-1 ${plan.highlight ? 'text-sky-200' : 'text-sky-400'}`}>/ 月</p>
                </div>
                <p className={`text-sm ${plan.highlight ? 'text-sky-200' : 'text-sky-500'}`}>
                  {plan.description}
                </p>
              </div>
              <ul className={`space-y-2.5 text-sm ${plan.highlight ? 'text-white' : 'text-sky-800'}`}>
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      plan.highlight ? 'bg-white/20 text-white' : 'bg-sky-100 text-sky-600'
                    }`}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={`/subscribe?plan=${plan.planId}`}
                className={`block text-center font-bold py-3 rounded-full transition-colors text-sm ${
                  plan.highlight
                    ? 'bg-white hover:bg-sky-50 text-sky-600'
                    : 'bg-sky-500 hover:bg-sky-600 text-white'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
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
                  <th className="text-left px-6 py-4 text-sky-700 font-semibold">機能</th>
                  <th className="px-4 py-4 text-sky-700 font-semibold text-center">ライト</th>
                  <th className="px-4 py-4 text-sky-700 font-semibold text-center">スタンダード</th>
                  <th className="px-4 py-4 text-sky-700 font-semibold text-center">プロ</th>
                  <th className="px-4 py-4 text-sky-700 font-semibold text-center">エンタープライズ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-50">
                {comparisonRows.map(([label, ...values]) => (
                  <tr key={label} className="hover:bg-sky-50/50 transition-colors">
                    <td className="px-6 py-4 text-sky-800 font-medium">{label}</td>
                    {values.map((v, i) => (
                      <td key={i} className={`px-4 py-4 text-center text-sky-600 ${i === 1 ? 'font-semibold' : ''}`}>{v}</td>
                    ))}
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
              1ヶ月分の前払い、または後払いに対応。適格請求書（インボイス）を発行いたします。
            </p>
            <p className="text-xs text-sky-400">クレジットカード登録不要・自動課金なし</p>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center space-y-3">
          <Link
            href="/login"
            className="inline-block bg-sky-500 hover:bg-sky-600 text-white font-bold px-10 py-4 rounded-full text-lg shadow-lg transition-all hover:shadow-xl hover:-translate-y-0.5"
          >
            3日間無料で試してみる →
          </Link>
          <p className="text-sky-400 text-sm">Googleログインのみ・カード登録不要</p>
        </div>
      </main>
    </div>
  );
}
