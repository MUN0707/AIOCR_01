import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';
import { normalizeDate } from '@/lib/normalize-date';

export const maxDuration = 30;

/**
 * 「証憑がない入出金」（未照合取引）を直接 journal_entries に登録するエンドポイント。
 * UnmatchedView のコミットボタンから呼ばれる。
 *
 * 貸方科目（普通預金）の自動補完:
 *   bank_account_name があれば採用、無ければ '普通預金' フォールバック。
 * 入出金の向き（direction）で借方／貸方を決める:
 *   - outflow（出金）: 借方 = ユーザー選択科目 / 貸方 = 預金科目
 *   - inflow （入金）: 借方 = 預金科目         / 貸方 = ユーザー選択科目
 *
 * 二重登録防止（best-effort）:
 *   同一 bank_ocr_upload_id + 日付 + 金額 + 摘要 の manual 仕訳が既にあればスキップする。
 *   （未照合配列のインデックスはセッション間で不安定なため、DB 一意制約ではなく
 *    内容ベースの soft dedup で対処。完全な consume 管理はフロントの consumedUnmatchedIdx
 *    + ドラフト保存が担う。）
 *
 * body:
 *   clientId: string | null
 *   entries: Array<{
 *     transaction_index: number,
 *     entry_date: string,            // YYYYMMDD / YYYY-MM-DD
 *     counter_account: string,       // ユーザーが選んだ相手科目（UI 上は「借方科目」）
 *     direction: 'outflow' | 'inflow',
 *     amount: number,
 *     description?: string,
 *     tax_type?: string,
 *     bank_account_name?: string | null,
 *     bank_ocr_upload_id?: string | null,
 *   }>
 */
interface UnmatchedEntryInput {
  transaction_index?: number;
  entry_date?: unknown;
  counter_account?: unknown;
  direction?: unknown;
  amount?: unknown;
  description?: unknown;
  tax_type?: unknown;
  bank_account_name?: unknown;
  bank_ocr_upload_id?: unknown;
}

function dedupKey(bankUploadId: string | null, date: string, amount: number, description: string): string {
  return `${bankUploadId ?? ''}|${date}|${Math.round(amount)}|${description}`;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const body = await request.json();
    const clientId: string | null =
      typeof body.clientId === 'string' && body.clientId ? body.clientId : null;
    const entries: UnmatchedEntryInput[] = Array.isArray(body.entries) ? body.entries : [];
    if (entries.length === 0) {
      return NextResponse.json({ error: '登録対象がありません' }, { status: 400 });
    }

    const service = createServiceClient();

    // 権限解決
    let ownerUserId = user.id;
    if (clientId) {
      const scope = await resolveClientScope(service, user.id, clientId);
      if (!scope || !canWrite(scope.role)) {
        return NextResponse.json({ error: 'この会社への書き込み権限がありません' }, { status: 403 });
      }
      ownerUserId = scope.ownerUserId;
    }

    // 締め日
    let closedUntil: string | null = null;
    {
      let q = service.from('journal_closings').select('closed_until').eq('user_id', ownerUserId);
      if (clientId) q = q.eq('client_id', clientId);
      else q = q.is('client_id', null);
      const { data: closings } = await q.limit(1);
      closedUntil = closings?.[0]?.closed_until ?? null;
    }

    // 正規化 & バリデーション
    const prepared: { row: Record<string, unknown>; key: string }[] = [];
    const errors: string[] = [];
    for (const e of entries) {
      const label = `行 ${typeof e.transaction_index === 'number' ? e.transaction_index + 1 : '?'}`;
      const date = normalizeDate(e.entry_date);
      if (!date) { errors.push(`${label}: 日付が不正です`); continue; }

      const account = typeof e.counter_account === 'string' ? e.counter_account.trim() : '';
      if (!account) { errors.push(`${label}: 借方科目が未入力です`); continue; }

      const amount = typeof e.amount === 'number' ? e.amount : Number(e.amount);
      if (!Number.isFinite(amount) || amount <= 0) { errors.push(`${label}: 金額が不正です`); continue; }

      if (closedUntil && date <= closedUntil) {
        errors.push(`${label}: ${closedUntil} までは締め済みのため登録できません`);
        continue;
      }

      const bankAccount =
        typeof e.bank_account_name === 'string' && e.bank_account_name.trim()
          ? e.bank_account_name.trim()
          : '普通預金';
      const isOutflow = e.direction !== 'inflow';
      const debitAccount = isOutflow ? account : bankAccount;
      const creditAccount = isOutflow ? bankAccount : account;
      const description = typeof e.description === 'string' ? e.description.trim() : '';
      const taxType =
        typeof e.tax_type === 'string' && e.tax_type
          ? e.tax_type
          : isOutflow ? '課税仕入10%' : '課税売上10%';
      const bankUploadId =
        typeof e.bank_ocr_upload_id === 'string' && e.bank_ocr_upload_id ? e.bank_ocr_upload_id : null;

      prepared.push({
        key: dedupKey(bankUploadId, date, amount, description),
        row: {
          user_id: ownerUserId,
          client_id: clientId,
          voucher_group_id: crypto.randomUUID(),
          entry_type: 'manual',
          entry_date: date,
          debit_account: debitAccount,
          credit_account: creditAccount,
          amount: Math.round(amount),
          description,
          tax_type: taxType,
          vendor_name: '',
          vendor_id: null,
          match_status: 'manual',
          bank_ocr_upload_id: bankUploadId,
        },
      });
    }

    if (prepared.length === 0) {
      return NextResponse.json({ error: errors[0] ?? '登録対象がありません', errors }, { status: 400 });
    }

    // 二重登録防止: 既存の manual 仕訳と内容一致するものをスキップ
    const bankUploadIds = Array.from(
      new Set(prepared.map((p) => p.row.bank_ocr_upload_id).filter((v): v is string => !!v)),
    );
    const existingKeys = new Set<string>();
    if (bankUploadIds.length > 0) {
      let dq = service
        .from('journal_entries')
        .select('bank_ocr_upload_id, entry_date, amount, description')
        .eq('user_id', ownerUserId)
        .eq('entry_type', 'manual')
        .in('bank_ocr_upload_id', bankUploadIds);
      if (clientId) dq = dq.eq('client_id', clientId);
      else dq = dq.is('client_id', null);
      const { data: existing } = await dq;
      for (const r of existing ?? []) {
        existingKeys.add(
          dedupKey(
            (r.bank_ocr_upload_id as string | null) ?? null,
            r.entry_date as string,
            Number(r.amount),
            (r.description as string | null) ?? '',
          ),
        );
      }
    }

    const toInsert = prepared.filter(
      (p) => !(p.row.bank_ocr_upload_id && existingKeys.has(p.key)),
    );
    const skipped = prepared.length - toInsert.length;

    if (toInsert.length === 0) {
      return NextResponse.json({ success: true, inserted: 0, skipped, errors });
    }

    const { error } = await service.from('journal_entries').insert(toInsert.map((p) => p.row));
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, inserted: toInsert.length, skipped, errors });
  } catch (error) {
    console.error('persist-unmatched エラー:', error);
    const message = error instanceof Error ? error.message : '保存に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
