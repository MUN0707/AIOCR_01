import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, listAccessibleClientIds, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const clientId = request.nextUrl.searchParams.get('clientId');
  const service = createServiceClient();

  const SELECT_COLS = 'id, client_id, bank_name, account_number, account_label, deposit_account, updated_at';

  if (clientId) {
    const scope = await resolveClientScope(service, user.id, clientId);
    if (!scope) return NextResponse.json({ error: 'この会社へのアクセス権限がありません' }, { status: 403 });
    const { data, error } = await service
      .from('bank_accounts')
      .select(SELECT_COLS)
      .eq('user_id', scope.ownerUserId)
      .eq('client_id', clientId)
      .order('created_at', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ accounts: data ?? [] });
  }

  // clientId 未指定: 個人スコープ (caller の user_id + client_id null) と
  // アクセス可能な全 client の bank_accounts を union して返す
  const accessible = await listAccessibleClientIds(service, user.id);
  const [personalRes, clientRes] = await Promise.all([
    service
      .from('bank_accounts')
      .select(SELECT_COLS)
      .eq('user_id', user.id)
      .is('client_id', null)
      .order('created_at', { ascending: true }),
    accessible.length > 0
      ? service
          .from('bank_accounts')
          .select(SELECT_COLS)
          .in('client_id', accessible)
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
  ]);
  if (personalRes.error) return NextResponse.json({ error: personalRes.error.message }, { status: 500 });
  if (clientRes.error) return NextResponse.json({ error: clientRes.error.message }, { status: 500 });
  const merged = [...(personalRes.data ?? []), ...(clientRes.data ?? [])];
  return NextResponse.json({ accounts: merged });
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

  // 権限解決: client 指定があれば member 含めて書込権限確認、無ければ owner 本人として処理
  let ownerUserId = user.id;
  if (clientId) {
    const scope = await resolveClientScope(service, user.id, clientId);
    if (!scope || !canWrite(scope.role)) {
      return NextResponse.json({ error: 'この会社への書き込み権限がありません' }, { status: 403 });
    }
    ownerUserId = scope.ownerUserId;
  }

  // 既存レコードを検索（client_id が null の場合も含めて手動マッチ）
  const { data: existing } = await service
    .from('bank_accounts')
    .select('id')
    .eq('user_id', ownerUserId)
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
      user_id: ownerUserId,
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
