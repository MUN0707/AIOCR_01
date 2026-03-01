import Link from 'next/link';

interface Props {
  searchParams: Promise<{ method?: string; session_id?: string }>;
}

export default async function SubscribeSuccessPage({ searchParams }: Props) {
  const params = await searchParams;
  const isBankTransfer = params.method === 'bank_transfer';

  return (
    <div className="min-h-screen bg-sky-50 flex flex-col">
      {/* ヘッダー */}
      <header className="bg-white border-b border-sky-100 px-6 py-4 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <span className="text-2xl">📄</span>
          <h1 className="text-xl font-bold text-sky-700">請求書 PDF 分割ツール</h1>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-14">
        <div className="bg-white rounded-3xl shadow-lg border border-sky-100 p-10 max-w-md w-full text-center space-y-6">
          <div className="text-6xl">
            {isBankTransfer ? '🏦' : '🎉'}
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-extrabold text-sky-900">
              {isBankTransfer ? '申請を受け付けました' : 'お申し込みありがとうございます！'}
            </h2>
            <p className="text-sky-600 text-sm leading-relaxed">
              {isBankTransfer
                ? '銀行振込のお申し込みを受け付けました。振込先口座は管理者よりメールにてご連絡します。入金確認後（1〜2営業日）に利用が開始されます。'
                : 'クレジットカードの登録が完了しました。引き続きご利用いただけます。'}
            </p>
          </div>

          {isBankTransfer && (
            <div className="bg-sky-50 rounded-2xl p-4 text-left space-y-2">
              <p className="text-sky-800 font-semibold text-sm">次のステップ</p>
              <ul className="text-sky-600 text-sm space-y-1">
                <li className="flex items-start gap-2">
                  <span className="text-sky-400 mt-0.5">1.</span>
                  管理者からメールで振込先口座をお知らせします
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-sky-400 mt-0.5">2.</span>
                  2ヶ月分をお振込みください
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-sky-400 mt-0.5">3.</span>
                  入金確認後にアカウントが有効化されます
                </li>
              </ul>
            </div>
          )}

          <Link
            href="/"
            className="block bg-sky-500 hover:bg-sky-600 text-white font-bold py-3 rounded-full transition-colors"
          >
            ホームに戻る
          </Link>
        </div>
      </main>
    </div>
  );
}
