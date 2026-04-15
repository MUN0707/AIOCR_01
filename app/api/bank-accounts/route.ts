import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const clientId = request.nextUrl.searchParams.get('clientId');
  const service = createServiceClient();
  let query = service
    .from('bank_accounts')
    .select('id, client_id, bank_name, account_number, account_label, deposit_account, updated_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });
  if (clientId) query = query.eq('client_id', clientId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ accounts: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const bankName: string = (body.bankName ?? '').trim();
  const accountNumber: string = (body.accountNumber ?? '').trim();
  const depositAccount: string = (body.depositAccount ?? '普通預金').trim() || '普通預金';
  const accountLabel: string | null = body.accountLabel?.trim?.() || null;
  const clientId: string | null = body.clientId ?? null;

  if (!bankName || !accountNumber) {
    return NextResponse.json({ error: '銀行名と口座番号が必要です' }, { status: 400 });
  }

  const service = createServiceClient();

  // 既存レコードを検索（client_id が null の場合も含めて手動マッチ）
  const { data: existing } = await service
    .from('bank_accounts')
    .select('id')
    .eq('user_id', user.id)
    .eq('bank_name', bankName)
    .eq('account_number', accountNumber)
    .is('client_id', clientId === null ? null : undefined)
    .maybeSingle();

  if (existing) {
    const { data: updated, error: updateError } = await service
      .from('bank_accounts')
      .update({
        deposit_account: depositAccount,
        account_label: accountLabel,
        client_id: clientId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    return NextResponse.json({ account: updated });
  }

  const { data: inserted, error: insertError } = await service
    .from('bank_accounts')
    .insert({
      user_id: user.id,
      client_id: clientId,
      bank_name: bankName,
      account_number: accountNumber,
      account_label: accountLabel,
      deposit_account: depositAccount,
    })
    .select()
    .single();
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  return NextResponse.json({ account: inserted });
}
