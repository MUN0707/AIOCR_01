import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import {
  AIOCR_PLANS,
  type AiocrPlanId,
  MERUMAGA_PLANS,
  type MerumagaPlanId,
  MERUMAGA_DASHBOARD_URL,
} from '@/lib/services';

const STATUS_LABEL: Record<string, { label: string; bg: string; fg: string }> = {
  pending: { label: 'ご入金確認中', bg: 'bg-amber-100', fg: 'text-amber-800' },
  active: { label: '利用中', bg: 'bg-emerald-100', fg: 'text-emerald-800' },
  trial: { label: 'トライアル中', bg: 'bg-sky-100', fg: 'text-sky-800' },
  cancelled: { label: '解約済み', bg: 'bg-slate-100', fg: 'text-slate-700' },
};

function statusBadge(status?: string | null) {
  const s = STATUS_LABEL[status ?? ''] ?? { label: status ?? '不明', bg: 'bg-slate-100', fg: 'text-slate-700' };
  return <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${s.bg} ${s.fg}`}>{s.label}</span>;
}

export default async function MyPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/mypage');

  const [{ data: subscription }, { data: firm }, { data: invoices }] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('plan, status, trial_end_at, payment_method, notes, updated_at')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('firms')
      .select('name, contact_name, member_count, plan, monthly_fee, status, payment_method, updated_at')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('invoices')
      .select('id, invoice_no, service, amount_incl_tax, status, issued_at, due_at')
      .eq('user_id', user.id)
      .order('issued_at', { ascending: false }),
  ]);

  const aiocrActive = !!subscription;
  const merumagaActive = !!firm;
  const aiocrPlanInfo = aiocrActive ? AIOCR_PLANS[(subscription!.plan as AiocrPlanId) ?? 'lite'] : null;
  const merumagaPlanInfo = merumagaActive
    ? MERUMAGA_PLANS[(firm!.plan as MerumagaPlanId) ?? 'tier1']
    : null;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-2xl">📄</span>
            <span className="font-bold text-slate-900">マイページ</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500 hidden sm:inline">{user.email}</span>
            <form action="/api/auth/signout" method="POST">
              <button className="text-slate-600 hover:text-slate-900 font-medium" type="submit">
                ログアウト
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">ご契約中のサービス</h1>
          <p className="text-sm text-slate-600">追加申込みは下部の「サービスを追加する」からお申込みください。</p>
        </div>

        {/* Invoice OCR */}
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="bg-sky-500 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3 text-white">
              <span className="text-2xl">📄</span>
              <div>
                <p className="font-bold">Invoice OCR（請求書 PDF 分割）</p>
                <p className="text-xs text-sky-100">請求書 PDF の自動解析・分割・命名</p>
              </div>
            </div>
            {aiocrActive ? statusBadge(subscription?.status) : <span className="text-xs text-sky-100">未契約</span>}
          </div>
          <div className="px-6 py-5">
            {aiocrActive && aiocrPlanInfo ? (
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 mb-4">
                <div>
                  <p className="text-xs text-slate-500">プラン</p>
                  <p className="font-bold text-slate-900">{aiocrPlanInfo.name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">月額</p>
                  <p className="font-bold text-slate-900">¥{aiocrPlanInfo.price.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">処理上限</p>
                  <p className="font-bold text-slate-900">{aiocrPlanInfo.limit}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">支払方法</p>
                  <p className="font-bold text-slate-900">{subscription?.payment_method === 'bank_transfer' ? '銀行振込' : (subscription?.payment_method ?? '-')}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500 mb-4">このサービスはまだご契約がありません。</p>
            )}
            <div className="flex flex-wrap gap-3">
              {aiocrActive ? (
                <Link
                  href="/"
                  className="bg-sky-500 hover:bg-sky-600 text-white font-bold px-5 py-2.5 rounded-lg text-sm transition"
                >
                  Invoice OCR を開く →
                </Link>
              ) : (
                <Link
                  href="/subscribe?service=aiocr"
                  className="bg-sky-500 hover:bg-sky-600 text-white font-bold px-5 py-2.5 rounded-lg text-sm transition"
                >
                  申し込む →
                </Link>
              )}
              <a
                href="/lp/invoice"
                className="text-sky-600 hover:text-sky-800 font-medium px-5 py-2.5 rounded-lg text-sm border border-sky-200 hover:border-sky-300"
              >
                サービス詳細
              </a>
            </div>
          </div>
        </section>

        {/* メルマガ */}
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="bg-emerald-500 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3 text-white">
              <span className="text-2xl">📬</span>
              <div>
                <p className="font-bold">税理士事務所スタッフ育成メルマガ</p>
                <p className="text-xs text-emerald-50">週1配信・10分構成・年52号</p>
              </div>
            </div>
            {merumagaActive ? statusBadge(firm?.status) : <span className="text-xs text-emerald-50">未契約</span>}
          </div>
          <div className="px-6 py-5">
            {merumagaActive && merumagaPlanInfo ? (
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 mb-4">
                <div>
                  <p className="text-xs text-slate-500">事務所名</p>
                  <p className="font-bold text-slate-900">{firm?.name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">配信人数</p>
                  <p className="font-bold text-slate-900">{firm?.member_count}人</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">プラン</p>
                  <p className="font-bold text-slate-900">{merumagaPlanInfo.name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">月額</p>
                  <p className="font-bold text-slate-900">¥{Number(firm?.monthly_fee ?? merumagaPlanInfo.price).toLocaleString()}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500 mb-4">このサービスはまだご契約がありません。</p>
            )}
            <div className="flex flex-wrap gap-3">
              {merumagaActive ? (
                <a
                  href={MERUMAGA_DASHBOARD_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-5 py-2.5 rounded-lg text-sm transition"
                >
                  メルマガ管理画面を開く →
                </a>
              ) : (
                <Link
                  href="/subscribe?service=merumaga"
                  className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-5 py-2.5 rounded-lg text-sm transition"
                >
                  申し込む →
                </Link>
              )}
              <a
                href="https://mail.taxbestsearch.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-600 hover:text-emerald-800 font-medium px-5 py-2.5 rounded-lg text-sm border border-emerald-200 hover:border-emerald-300"
              >
                サービス詳細
              </a>
            </div>
          </div>
        </section>

        {/* 請求書一覧 */}
        {invoices && invoices.length > 0 && (
          <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-3">
              <span className="text-2xl">🧾</span>
              <div>
                <p className="font-bold text-slate-900">請求書</p>
                <p className="text-xs text-slate-500">発行済みの請求書をダウンロードできます</p>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {invoices.map((inv) => {
                const issued = new Date(inv.issued_at);
                const due = new Date(inv.due_at);
                const fmt = (d: Date) =>
                  `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
                const serviceLabel = inv.service === 'aiocr' ? 'Invoice OCR' : '育成メルマガ';
                const statusLabel =
                  inv.status === 'paid' ? '入金済' : inv.status === 'cancelled' ? 'キャンセル' : '未入金';
                const statusClass =
                  inv.status === 'paid'
                    ? 'bg-emerald-100 text-emerald-800'
                    : inv.status === 'cancelled'
                      ? 'bg-slate-100 text-slate-600'
                      : 'bg-amber-100 text-amber-800';
                return (
                  <div key={inv.id} className="px-6 py-4 flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-xs text-slate-500">{inv.invoice_no}</p>
                      <p className="font-medium text-slate-900 text-sm">
                        {serviceLabel}（初月分）
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        発行 {fmt(issued)} / 支払期日 {fmt(due)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-slate-900">¥{inv.amount_incl_tax.toLocaleString()}</p>
                      <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${statusClass}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <a
                      href={`/api/invoice/${inv.id}/download`}
                      className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-lg whitespace-nowrap"
                    >
                      PDF
                    </a>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 追加申込み導線 */}
        {(!aiocrActive || !merumagaActive) && (
          <section className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
            <h2 className="font-bold text-slate-900 mb-2">サービスを追加する</h2>
            <p className="text-sm text-slate-600 mb-4">
              {aiocrActive && !merumagaActive && '育成メルマガを追加申込みできます'}
              {!aiocrActive && merumagaActive && 'Invoice OCR を追加申込みできます'}
              {!aiocrActive && !merumagaActive && '両サービスとも未契約です。お申込みフォームへ進んでください。'}
            </p>
            <Link
              href="/subscribe"
              className="inline-block bg-slate-900 hover:bg-slate-800 text-white font-bold px-8 py-3 rounded-full text-sm transition"
            >
              申込みフォームへ
            </Link>
          </section>
        )}
      </main>
    </div>
  );
}
