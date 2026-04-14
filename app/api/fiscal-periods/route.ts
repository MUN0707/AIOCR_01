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
    .from('fiscal_periods')
    .select('id, name, start_date, end_date, client_id, created_at')
    .eq('user_id', user.id)
    .order('start_date', { ascending: false });

  if (clientId) query = query.eq('client_id', clientId);
  else query = query.is('client_id', null);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ periods: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const name: string = (body.name ?? '').trim();
  const start_date: string = (body.start_date ?? '').trim();
  const end_date: string = (body.end_date ?? '').trim();
  const client_id: string | null = body.client_id ?? null;

  if (!name) return NextResponse.json({ error: '期の名前を入力してください' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
    return NextResponse.json({ error: '日付形式が不正です' }, { status: 400 });
  }
  if (start_date > end_date) {
    return NextResponse.json({ error: '期首より期末を後の日付にしてください' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from('fiscal_periods')
    .insert({ user_id: user.id, name, start_date, end_date, client_id })
    .select('id, name, start_date, end_date, client_id, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ period: data });
}
