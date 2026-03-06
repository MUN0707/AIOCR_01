import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '特定商取引法に基づく表記 | Invoice OCR',
};

const rows: { label: string; value: string }[] = [
  { label: '販売事業者名', value: '請求があった場合には速やかに開示いたします' },
  { label: '運営責任者', value: '請求があった場合には速やかに開示いたします' },
  { label: '所在地', value: '請求があった場合には速やかに開示いたします' },
  { label: '電話番号', value: '請求があった場合には速やかに開示いたします' },
  { label: '営業時間', value: '平日 10:00〜18:00（土日祝を除く）' },
  { label: 'メールアドレス', value: 'support@invoice-ocr.com' },
  { label: '販売価格', value: '各プランページに記載の金額（消費税込）' },
  { label: '追加手数料', value: '銀行振込の場合、振込手数料はお客様負担となります' },
  { label: '利用可能な決済手段', value: '銀行振込' },
  { label: '決済期間', value: '請求書発行後 7 日以内にお振込みください' },
  { label: 'サービス提供時期', value: 'ご入金確認後、即時利用可能' },
  {
    label: 'キャンセル・返金ポリシー',
    value:
      'デジタルサービスの性質上、原則としてキャンセル・返金はお受けしておりません。ただし、サービス障害など弊社都合による場合はこの限りではありません。詳細はメールにてお問い合わせください。',
  },
  {
    label: '動作環境',
    value:
      '最新バージョンの Chrome / Firefox / Safari / Edge（JavaScript 有効）、インターネット接続環境が必要です',
  },
];

export default function TokushoPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-lime-50">
      {/* ヘッダー */}
      <header className="bg-white/80 backdrop-blur border-b border-sky-100 px-6 py-4">
        <div className="max-w-[900px] mx-auto flex items-center gap-4">
          <Link
            href="/"
            className="text-sm text-sky-400 hover:text-sky-600 transition-colors font-medium"
          >
            ← トップへ戻る
          </Link>
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-4 sm:px-6 py-12">
        <h1 className="text-2xl font-semibold text-slate-700 tracking-tight mb-2">
          特定商取引法に基づく表記
        </h1>
        <p className="text-sm text-slate-400 mb-8">
          特定商取引に関する法律第11条および割賦販売法第25条の2に基づく表示
        </p>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {rows.map(({ label, value }, i) => (
                <tr
                  key={label}
                  className={i % 2 === 0 ? 'bg-white' : 'bg-sky-50/40'}
                >
                  <th
                    scope="row"
                    className="text-left align-top px-5 py-4 font-medium text-slate-500 w-44 shrink-0 whitespace-nowrap border-r border-slate-100"
                  >
                    {label}
                  </th>
                  <td className="px-5 py-4 text-slate-700 leading-relaxed">
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-8 text-xs text-slate-400 text-center">
          本表記は予告なく変更される場合があります。最新情報はこのページをご確認ください。
        </p>
      </main>

      <footer className="max-w-[900px] mx-auto px-4 py-8">
        <p className="text-center text-[10px] text-slate-300 tracking-widest uppercase">
          Invoice OCR · Powered by Claude AI · © {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
}
