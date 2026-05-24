import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';

/**
 * POST /api/bank-transactions/register
 * 証票なしの入出金明細に勘定科目を割り当てて仕訳登録する。
 *
 * body: {
 *   clientId: string,
 *   entries: Array<{
 *     uploadId: string,
 *     transactionDate: string,
 *     amount: number,
 *     description: string,
 *     debitAccount: string,
 *     creditAccount: string,
 *     taxType?: string,
 *   }>
 * }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json();
  const { clientId, entries } = body as {
    clientId: string;
    entries: Array<{
      uploadId: string;
      transactionDate: string;
      amount: number;
      description: string;
      debitAccount: string;
      creditAccount: string;
      taxType?: string;
    }>;
  };

  if (!clientId || !entries || entries.length === 0) {
    return NextResponse.json({ error: 'clientId と entries が必要です' }, { status: 400 });
  }

  const service = createServiceClient();

  const scope = await resolveClientScope(service, user.id, clientId);
  if (!scope || !canWrite(scope.role)) {
    return NextResponse.json({ error: 'この会社への書き込み権限がありません' }, { status: 403 });
  }
  const ownerUserId = scope.ownerUserId;

  const rows = entries.map((e) => ({
    user_id: ownerUserId,
    client_id: clientId,
    entry_type: 'manual' as const,
    entry_date: e.transactionDate,
    debit_account: e.debitAccount,
    credit_account: e.creditAccount,
    amount: e.amount,
    description: e.description,
    tax_type: e.taxType ?? '対象外',
    vendor_name: '',
    match_status: 'manual',
    bank_ocr_upload_id: e.uploadId,
  }));

  const { error, data } = await service
    .from('journal_entries')
    .insert(rows)
    .select('id');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, inserted: data?.length ?? 0 });
}
