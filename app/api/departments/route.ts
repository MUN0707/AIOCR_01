import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 15;

const SELECT_COLS = 'id, name, code, is_active, client_id, created_at';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const clientIdParam = searchParams.get('clientId');

  const service = createServiceClient();
  let query = service
    .from('departments')
    .select(SELECT_COLS)
    .eq('user_id', user.id)
    .order('code', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });

  if (clientIdParam === 'null') {
    query = query.is('client_id', null);
  } else if (clientIdParam) {
    query = query.eq('client_id', clientIdParam);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ departments: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const name: string = (body.name ?? '').trim();
  const code: string = (body.code ?? '').trim();
  const client_id: string | null = body.client_id ?? null;

  if (!name) return NextResponse.json({ error: '部門名を入力してください' }, { status: 400 });
  if (name.length > 60) return NextResponse.json({ error: '部門名が長すぎます' }, { status: 400 });

  const service = createServiceClient();
  const { data, error } = await service
    .from('departments')
    .insert({ user_id: user.id, client_id, name, code: code || null, is_active: true })
    .select(SELECT_COLS)
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: '同じ名前の部門が既にあります' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ department: data });
}
