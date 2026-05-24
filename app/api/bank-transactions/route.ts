import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { resolveClientScope } from '@/lib/client-access';

/**
 * GET /api/bank-transactions?clientId=xxx
 * 口座ごとのトランザクション一覧を返す。
 * 各トランザクションに仕訳反映状況（matched）を付与。
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const clientId = url.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  const service = createServiceClient();

  const scope = await resolveClientScope(service, user.id, clientId);
  if (!scope) return NextResponse.json({ error: 'この会社へのアクセス権限がありません' }, { status: 403 });
  const ownerUserId = scope.ownerUserId;

  // 通帳 OCR アップロードを取得
  const { data: uploads, error: upErr } = await service
    .from('ocr_uploads')
    .select('id, file_name, mode, ocr_result, created_at')
    .eq('user_id', ownerUserId)
    .eq('client_id', clientId)
    .eq('mode', 'bank-statement')
    .order('created_at', { ascending: false });

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  if (!uploads || uploads.length === 0) {
    return NextResponse.json({ accounts: [] });
  }

  // 全通帳の upload_id に紐づく仕訳を取得
  const uploadIds = uploads.map((u) => u.id);
  const { data: entries } = await service
    .from('journal_entries')
    .select('id, entry_date, amount, credit_account, debit_account, description, bank_ocr_upload_id')
    .eq('user_id', ownerUserId)
    .in('bank_ocr_upload_id', uploadIds);

  // 仕訳をupload_idごとに整理
  const entriesByUpload = new Map<string, Array<{ entry_date: string; amount: number; description: string; debit_account: string; credit_account: string }>>();
  for (const e of entries ?? []) {
    const key = e.bank_ocr_upload_id as string;
    if (!entriesByUpload.has(key)) entriesByUpload.set(key, []);
    entriesByUpload.get(key)!.push({
      entry_date: e.entry_date,
      amount: Number(e.amount ?? 0),
      description: e.description ?? '',
      debit_account: e.debit_account ?? '',
      credit_account: e.credit_account ?? '',
    });
  }

  // 口座ごとにグループ化
  type Transaction = {
    index: number;
    transactionDate: string;
    description: string;
    debit: number | null;
    credit: number | null;
    matched: boolean;
    matchedJournalDescription?: string;
  };

  type AccountGroup = {
    uploadId: string;
    fileName: string;
    bankName: string;
    accountNumber: string;
    createdAt: string;
    transactions: Transaction[];
  };

  const accounts: AccountGroup[] = [];

  for (const u of uploads) {
    const ocr = u.ocr_result as {
      bankName?: string;
      accountNumber?: string;
      transactions?: Array<{
        date?: string;
        transactionDate?: string;
        description?: string;
        debit?: number | null;
        credit?: number | null;
      }>;
    } | null;

    const journalEntries = entriesByUpload.get(u.id) ?? [];
    // 使用済みマーク（同一仕訳を複数回マッチさせない）
    const usedEntries = new Set<number>();

    const transactions: Transaction[] = (ocr?.transactions ?? []).map((t, idx) => {
      const txDate = t.transactionDate ?? t.date ?? '';
      const txAmount = t.debit ?? t.credit ?? 0;

      // 金額と日付で仕訳とマッチング
      let matched = false;
      let matchedDesc = '';
      for (let i = 0; i < journalEntries.length; i++) {
        if (usedEntries.has(i)) continue;
        const je = journalEntries[i];
        if (Math.abs(je.amount - txAmount) < 1 && je.entry_date === txDate) {
          matched = true;
          matchedDesc = `${je.debit_account} / ${je.credit_account}`;
          usedEntries.add(i);
          break;
        }
      }

      return {
        index: idx,
        transactionDate: txDate,
        description: t.description ?? '',
        debit: t.debit ?? null,
        credit: t.credit ?? null,
        matched,
        matchedJournalDescription: matchedDesc || undefined,
      };
    });

    accounts.push({
      uploadId: u.id,
      fileName: u.file_name,
      bankName: ocr?.bankName ?? '',
      accountNumber: ocr?.accountNumber ?? '',
      createdAt: u.created_at,
      transactions,
    });
  }

  return NextResponse.json({ accounts });
}
