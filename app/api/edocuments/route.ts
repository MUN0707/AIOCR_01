import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 15;

const SELECT_COLS = [
  'id', 'file_name', 'mode', 'created_at', 'client_id',
  'doc_category', 'receipt_date', 'transaction_amount', 'counterparty', 'edoc_notes',
].join(', ');

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const clientId = params.get('clientId') || null;
  const from = params.get('from') || null;
  const to = params.get('to') || null;
  const counterpartyQ = params.get('counterparty') || null;
  const amountMin = params.get('amountMin') ? Number(params.get('amountMin')) : null;
  const amountMax = params.get('amountMax') ? Number(params.get('amountMax')) : null;
  const incompleteOnly = params.get('incompleteOnly') === '1';

  const service = createServiceClient();

  let q = service
    .from('ocr_uploads')
    .select(SELECT_COLS)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(500);

  if (clientId) q = q.eq('client_id', clientId);
  else q = q.is('client_id', null);

  if (from) q = q.gte('receipt_date', from);
  if (to) q = q.lte('receipt_date', to);
  if (counterpartyQ) q = q.ilike('counterparty', `%${counterpartyQ}%`);
  if (amountMin !== null) q = q.gte('transaction_amount', amountMin);
  if (amountMax !== null) q = q.lte('transaction_amount', amountMax);
  if (incompleteOnly) {
    q = q.or('receipt_date.is.null,transaction_amount.is.null,counterparty.is.null');
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 入力完了数・未完了数の統計
  const total = data?.length ?? 0;
  const complete = (data ?? []).filter(
    (d) => d.receipt_date && d.transaction_amount != null && d.counterparty
  ).length;

  return NextResponse.json({ documents: data ?? [], stats: { total, complete, incomplete: total - complete } });
}
