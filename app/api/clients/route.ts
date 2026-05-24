import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { seedClientMasters } from '@/lib/seed-client-masters';

const SELECT_COLS = 'id, name, client_type, industry, company_code, legal_name, short_name, invoice_registration_number, created_at';

// GET /api/clients — ログインユーザーのクライアント一覧
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('clients')
    .select(SELECT_COLS)
    .eq('user_id', user.id)
    .order('company_code', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ clients: data });
}

// POST /api/clients — クライアント新規作成
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const body = await request.json();
  const name = (body.name || '').trim();
  const company_code = (body.company_code || '').trim() || null;
  const legal_name = (body.legal_name || '').trim() || null;
  const short_name = (body.short_name || '').trim() || null;
  const invoice_registration_number = (body.invoice_registration_number || '').trim() || null;

  if (!name) {
    return NextResponse.json({ error: 'クライアント名は必須です' }, { status: 400 });
  }
  if (company_code && !/^[A-Za-z0-9]{1,8}$/.test(company_code)) {
    return NextResponse.json({ error: '会社番号は英数字8文字以内で入力してください' }, { status: 400 });
  }
  if (invoice_registration_number && !/^T\d{13}$/.test(invoice_registration_number)) {
    return NextResponse.json({ error: '登録番号は T + 13桁の数字で入力してください（例: T1234567890123）' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('clients')
    .insert({ user_id: user.id, name, company_code, legal_name, short_name, invoice_registration_number })
    .select(SELECT_COLS)
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'この会社番号は既に使われています' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await seedClientMasters(createServiceClient(), user.id, data.id);

  return NextResponse.json({ client: data }, { status: 201 });
}

// PATCH /api/clients?id=xxx — クライアント更新
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'クライアントIDは必須です' }, { status: 400 });
  }

  const body = await request.json();
  const patch: Record<string, string | null> = {};
  if (body.name !== undefined) {
    const v = String(body.name).trim();
    if (!v) return NextResponse.json({ error: 'クライアント名は必須です' }, { status: 400 });
    patch.name = v;
  }
  if (body.company_code !== undefined) {
    const v = String(body.company_code).trim();
    if (v && !/^[A-Za-z0-9]{1,8}$/.test(v)) {
      return NextResponse.json({ error: '会社番号は英数字8文字以内で入力してください' }, { status: 400 });
    }
    patch.company_code = v || null;
  }
  if (body.legal_name !== undefined) patch.legal_name = String(body.legal_name).trim() || null;
  if (body.short_name !== undefined) patch.short_name = String(body.short_name).trim() || null;
  if (body.invoice_registration_number !== undefined) {
    const v = String(body.invoice_registration_number).trim();
    if (v && !/^T\d{13}$/.test(v)) {
      return NextResponse.json({ error: '登録番号は T + 13桁の数字で入力してください（例: T1234567890123）' }, { status: 400 });
    }
    patch.invoice_registration_number = v || null;
  }

  const { data, error } = await supabase
    .from('clients')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(SELECT_COLS)
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'この会社番号は既に使われています' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ client: data });
}

// DELETE /api/clients?id=xxx — クライアント削除
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'クライアントIDは必須です' }, { status: 400 });
  }

  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
