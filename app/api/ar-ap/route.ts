import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { resolveClientScope } from '@/lib/client-access';

export const maxDuration = 30;

/**
 * 売掛金（AR）/ 買掛金（AP）残高ビュー
 *
 * かつての ar_ap_records は廃止し、journal_entries を vendor × 科目 でサーバ集計して返す。
 *
 * - type='ar' : 借方が AR 系科目（売掛金 / 未収入金）の累計 - 貸方累計
 * - type='ap' : 貸方が AP 系科目（買掛金 / 未払金 / 未払費用）の累計 - 借方累計
 *
 * vendor_id がある仕訳はそれで集約。NULL 仕訳は vendor_name 文字列で集約（旧データ救済）。
 */

const AR_ACCOUNTS = ['売掛金', '未収入金', '未収金'] as const;
const AP_ACCOUNTS = ['買掛金', '未払金', '未払費用'] as const;

const UNREGISTERED_VENDOR = '(取引先未登録)';

interface JournalEntryRow {
  id: string;
  entry_date: string | null;
  debit_account: string | null;
  credit_account: string | null;
  amount: number | null;
  debit_amount: number | null;
  credit_amount: number | null;
  vendor_id: string | null;
  vendor_name: string | null;
  description: string | null;
  client_id: string | null;
}

type ArApType = 'ar' | 'ap';
type ComputedStatus = 'open' | 'partial' | 'paid';

interface VendorAccountBucket {
  vendorKey: string;          // vendor_id || `name:${vendor_name}` || '__unregistered__'
  vendorId: string | null;
  vendorName: string;
  account: string;
  totalAccrual: number;       // 計上累計（負債科目なら credit_amount, 資産科目なら debit_amount）
  totalPayment: number;       // 消込累計（負債なら debit_amount, 資産なら credit_amount）
  oldestEntryDate: string | null;
  latestEntryDate: string | null;
  entryCount: number;
  description: string | null;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const p = request.nextUrl.searchParams;
  const type: ArApType = p.get('type') === 'ap' ? 'ap' : 'ar';
  const clientId = p.get('clientId') || null;
  const status = p.get('status') || '';

  const service = createServiceClient();

  let ownerUserId = user.id;
  if (clientId) {
    const scope = await resolveClientScope(service, user.id, clientId);
    if (!scope) return NextResponse.json({ error: 'この会社へのアクセス権限がありません' }, { status: 403 });
    ownerUserId = scope.ownerUserId;
  }

  const targetAccounts: string[] = type === 'ar' ? [...AR_ACCOUNTS] : [...AP_ACCOUNTS];
  const targetSet = new Set(targetAccounts);

  // 集計対象: debit_account か credit_account が AR/AP 科目のいずれかに該当する仕訳
  let q = service
    .from('journal_entries')
    .select('id, entry_date, debit_account, credit_account, amount, debit_amount, credit_amount, vendor_id, vendor_name, description, client_id')
    .eq('user_id', ownerUserId)
    .or(
      `debit_account.in.(${targetAccounts.map((a) => `"${a}"`).join(',')}),credit_account.in.(${targetAccounts.map((a) => `"${a}"`).join(',')})`,
    )
    .limit(50000);
  q = clientId ? q.eq('client_id', clientId) : q.is('client_id', null);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const buckets = new Map<string, VendorAccountBucket>();

  for (const row of (data ?? []) as JournalEntryRow[]) {
    const vendorKey = row.vendor_id
      ? `id:${row.vendor_id}`
      : row.vendor_name?.trim()
        ? `name:${row.vendor_name.trim()}`
        : '__unregistered__';
    const vendorName = row.vendor_id
      ? (row.vendor_name?.trim() || UNREGISTERED_VENDOR)
      : (row.vendor_name?.trim() || UNREGISTERED_VENDOR);

    // この行が「計上側」か「消込側」かを判定
    // - AP: 貸方が AP 科目 → 計上 / 借方が AP 科目 → 消込
    // - AR: 借方が AR 科目 → 計上 / 貸方が AR 科目 → 消込
    const debitAcc = row.debit_account ?? '';
    const creditAcc = row.credit_account ?? '';

    const debitAmt = Number(row.debit_amount ?? row.amount ?? 0);
    const creditAmt = Number(row.credit_amount ?? row.amount ?? 0);

    // 同一行で両側に AP/AR 科目が出るケースは異常なのでスキップ
    const debitMatches = targetSet.has(debitAcc);
    const creditMatches = targetSet.has(creditAcc);
    if (!debitMatches && !creditMatches) continue;

    // どの AP/AR 科目に紐づく行か（計上側の科目を bucket キーにする）
    let account: string;
    let isAccrual: boolean;
    let amt: number;
    if (type === 'ap') {
      if (creditMatches) {
        account = creditAcc;
        isAccrual = true;
        amt = creditAmt;
      } else {
        account = debitAcc;
        isAccrual = false;
        amt = debitAmt;
      }
    } else {
      if (debitMatches) {
        account = debitAcc;
        isAccrual = true;
        amt = debitAmt;
      } else {
        account = creditAcc;
        isAccrual = false;
        amt = creditAmt;
      }
    }

    const bucketKey = `${vendorKey}|${account}`;
    const b = buckets.get(bucketKey) ?? {
      vendorKey,
      vendorId: row.vendor_id,
      vendorName,
      account,
      totalAccrual: 0,
      totalPayment: 0,
      oldestEntryDate: null,
      latestEntryDate: null,
      entryCount: 0,
      description: null,
    };
    if (isAccrual) b.totalAccrual += amt;
    else b.totalPayment += amt;
    b.entryCount += 1;
    if (row.entry_date && row.entry_date !== '不明') {
      if (!b.oldestEntryDate || row.entry_date < b.oldestEntryDate) b.oldestEntryDate = row.entry_date;
      if (!b.latestEntryDate || row.entry_date > b.latestEntryDate) b.latestEntryDate = row.entry_date;
    }
    if (!b.description && row.description) b.description = row.description;
    buckets.set(bucketKey, b);
  }

  const records = [...buckets.values()].map((b) => {
    const balance = Math.max(0, b.totalAccrual - b.totalPayment);
    let computedStatus: ComputedStatus;
    if (b.totalPayment <= 0.01) computedStatus = 'open';
    else if (balance > 0.01) computedStatus = 'partial';
    else computedStatus = 'paid';
    return {
      id: b.vendorKey + '|' + b.account, // ドリルダウン用の識別子（DB上のレコードIDではない）
      type,
      vendor_id: b.vendorId,
      counterparty: b.vendorName,
      account: b.account,
      invoice_date: b.oldestEntryDate ? formatDate(b.oldestEntryDate) : '',
      due_date: null,
      amount: Math.round(b.totalAccrual),
      paid_amount: Math.round(b.totalPayment),
      balance: Math.round(balance),
      computedStatus,
      description: b.description,
      entry_count: b.entryCount,
      latest_entry_date: b.latestEntryDate ? formatDate(b.latestEntryDate) : null,
    };
  });

  // 並び順: 残高大きい順、同額なら latest_entry_date 降順
  records.sort((a, b) => {
    if (b.balance !== a.balance) return b.balance - a.balance;
    return (b.latest_entry_date ?? '').localeCompare(a.latest_entry_date ?? '');
  });

  const filtered = status ? records.filter((r) => r.computedStatus === status) : records;

  const totalAmount = records.reduce((s, r) => s + r.amount, 0);
  const totalPaid = records.reduce((s, r) => s + r.paid_amount, 0);
  const totalOpen = records.filter((r) => r.computedStatus !== 'paid').reduce((s, r) => s + r.balance, 0);

  return NextResponse.json({
    records: filtered,
    stats: { totalAmount, totalPaid, totalOpen, count: records.length },
  });
}

function formatDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/**
 * POST は廃止。新しいフローでは journal_entries に直接仕訳を追加する
 * （/ + 新規仕訳 ボタンか、OCR経由）。
 */
export async function POST() {
  return NextResponse.json(
    {
      error: '売掛金・買掛金は仕訳から自動派生する方式に変更されました。「+ 新規仕訳」ボタンから売掛金/買掛金/未払金の計上仕訳を追加してください。',
    },
    { status: 410 },
  );
}
