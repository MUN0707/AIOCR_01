import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

// GET /api/clients — ログインユーザーのクライアント一覧
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('clients')
    .select('id, name, client_type, industry, created_at')
    .eq('user_id', user.id)
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
  if (!name) {
    return NextResponse.json({ error: 'クライアント名は必須です' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('clients')
    .insert({ user_id: user.id, name })
    .select('id, name, client_type, industry, created_at')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ client: data }, { status: 201 });
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
