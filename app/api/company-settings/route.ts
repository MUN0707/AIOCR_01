import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 15;

const COLS = 'id, user_id, client_id, company_name_kana, bank_code, branch_code, account_type, account_number, account_name_kana, requestor_code';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const clientId = request.nextUrl.searchParams.get('clientId') || null;
  const service = createServiceClient();

  let q = service.from('company_settings').select(COLS).eq('user_id', user.id);
  if (clientId) q = q.eq('client_id', clientId);
  else q = q.is('client_id', null);

  const { data, error } = await q.maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data ?? null });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const clientId = body.client_id ?? null;
  const service = createServiceClient();

  const patch = {
    company_name_kana: body.company_name_kana ?? null,
    bank_code: body.bank_code ?? null,
    branch_code: body.branch_code ?? null,
    account_type: body.account_type ?? '1',
    account_number: body.account_number ?? null,
    account_name_kana: body.account_name_kana ?? null,
    requestor_code: body.requestor_code ?? null,
    updated_at: new Date().toISOString(),
  };

  // unique index (user_id, client_id) は client_id NULL を distinct 扱いするため
  // upsert(onConflict) では NULL クライアントの重複検知ができない。SELECT → UPDATE/INSERT に分解する。
  let existingQuery = service
    .from('company_settings')
    .select('id')
    .eq('user_id', user.id)
    .limit(1);
  existingQuery = clientId
    ? existingQuery.eq('client_id', clientId)
    : existingQuery.is('client_id', null);

  const { data: existing } = await existingQuery;

  if (existing && existing.length > 0) {
    const { data, error } = await service
      .from('company_settings')
      .update(patch)
      .eq('id', existing[0].id)
      .select(COLS)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ settings: data });
  }

  const { data, error } = await service
    .from('company_settings')
    .insert({ user_id: user.id, client_id: clientId, ...patch })
    .select(COLS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data });
}
