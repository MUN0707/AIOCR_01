'use client';
import { useState } from 'react';
import Link from 'next/link';

const faqs = [
  {
    category: '導入・契約',
    items: [
      {
        q: '無料期間中にクレジットカードの登録は必要ですか？',
        a: '不要です。Googleアカウントで登録するだけで3日間すべての機能をご利用いただけます。',
      },
      {
        q: '無料期間終了後、自動で課金されますか？',
        a: '自動課金はありません。有料プランに切り替える場合は「申し込む」から銀行振込の手続きをお願いします。',
      },
      {
        q: '途中でプランを変更できますか？',
        a: 'はい。ライト→ヘビーへのアップグレードはいつでも可能です。差額分を追加でお支払いいただきます。',
      },
      {
        q: 'キャンセルはいつでもできますか？',
        a: 'はい。次の更新期間の振込をしなければ自動的に終了します。違約金等は発生しません。',
      },
    ],
  },
  {
    category: 'セキュリティ・データ',
    items: [
      {
        q: 'アップロードしたPDFはサーバーに保存されますか？',
        a: '保存されません。AIによる処理が完了した時点でデータは削除されます。痕跡も残りません。',
      },
      {
        q: 'AIの学習データとして使われませんか？',
        a: 'Anthropic（Claude提供元）の公式ポリシーにより、APIを通じたデータはAIの学習に使用されません。',
      },
      {
        q: '通信は暗号化されていますか？',
        a: 'はい。すべての通信はTLS 1.2以上で暗号化されます。ネットバンキングと同等以上の水準です。',
      },
    ],
  },
  {
    category: '機能・対応書類',
    items: [
      {
        q: '手書きの請求書も読み取れますか？',
        a: '多くの場合読み取れますが、文字が薄い・崩れている場合は精度が下がることがあります。',
      },
      {
        q: 'e-Taxや会計ソフトと連携できますか？',
        a: '現在、直接連携する機能はありません。分割されたPDFをダウンロードして会計ソフトに手動でアップロードしてご利用ください。',
      },
      {
        q: '法人と個人の請求書が混在したPDFに対応していますか？',
        a: 'はい。混在した場合もAIが各請求書を判別し、それぞれ適切に分割します。',
      },
      {
        q: '確定申告書類の処理はどのプランで使えますか？',
        a: 'ヘビープラン（月¥10,000）でご利用いただけます。ライトプランは請求書モードのみです。',
      },
      {
        q: '1回にアップロードできるPDFのサイズ制限はありますか？',
        a: '1ファイルあたり最大50MBです。ページ数が多い場合は分割してアップロードしてください。',
      },
    ],
  },
  {
    category: 'お支払い',
    items: [
      {
        q: 'お支払い方法は何がありますか？',
        a: '現在は銀行振込のみ対応しています。1ヶ月分の前払い、または後払いをお選びいただけます。適格請求書（インボイス）を発行いたします。',
      },
      {
        q: '領収書は発行してもらえますか？',
        a: 'はい。振込確認後にメールで電子領収書をお送りします。',
      },
    ],
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-2xl border border-sky-100 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left px-6 py-5 flex items-start justify-between gap-4 hover:bg-sky-50/50 transition-colors"
      >
        <span className="font-bold text-sky-900 text-sm leading-relaxed">Q. {q}</span>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#38bdf8"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`flex-shrink-0 mt-0.5 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="px-6 pb-5">
          <p className="text-sky-600 text-sm leading-relaxed border-t border-sky-50 pt-4">{a}</p>
        </div>
      )}
    </div>
  );
}

export default function FaqPage() {
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
            <Link href="/guide" className="hover:text-sky-800 transition-colors">使い方</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-6 py-16 space-y-12">
        {/* ヒーロー */}
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-extrabold text-sky-900">よくある質問</h1>
          <p className="text-sky-600 text-lg max-w-xl mx-auto">
            導入を検討されている税理士事務所の方からよくいただく質問をまとめました。
          </p>
        </div>

        {/* FAQ カテゴリ別 */}
        {faqs.map((category) => (
          <div key={category.category} className="space-y-3">
            <h2 className="text-lg font-bold text-sky-800 px-1">{category.category}</h2>
            {category.items.map((item) => (
              <FaqItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        ))}

        {/* お問い合わせ */}
        <div className="bg-sky-500 rounded-2xl p-8 text-center space-y-4">
          <h2 className="text-xl font-bold text-white">その他のご質問</h2>
          <p className="text-sky-100 text-sm">
            掲載されていないご質問はお気軽にお問い合わせください。
          </p>
          <a
            href="mailto:support@invoice-ocr.jp"
            className="inline-block bg-white hover:bg-sky-50 text-sky-600 font-bold px-8 py-3 rounded-full transition-colors"
          >
            メールで問い合わせる
          </a>
        </div>

        {/* CTA */}
        <div className="text-center space-y-3">
          <Link
            href="/subscribe"
            className="inline-block bg-sky-500 hover:bg-sky-600 text-white font-bold px-10 py-4 rounded-full text-lg shadow-lg transition-all hover:shadow-xl hover:-translate-y-0.5"
          >
            3日間無料で試してみる →
          </Link>
          <p className="text-sky-400 text-sm">カード登録不要・自動課金なし</p>
        </div>
      </main>
    </div>
  );
}
