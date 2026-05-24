import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

const SELECT_COLS = 'id, name, start_date, end_date, client_id, opening_balances, corporate_tax, created_at';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const clientId = request.nextUrl.searchParams.get('clientId');
  const service = createServiceClient();

  if (clientId) {
    const scope = await resolveClientScope(service, user.id, clientId);
    if (!scope) return NextResponse.json({ error: 'この会社へのアクセス権限がありません' }, { status: 403 });
    const { data, error } = await service
      .from('fiscal_periods')
      .select(SELECT_COLS)
      .eq('user_id', scope.ownerUserId)
      .eq('client_id', clientId)
      .order('start_date', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ periods: data ?? [] });
  }

  // clientId 未指定: 個人スコープ (caller の user_id + client_id null) のみ
  const { data, error } = await service
    .from('fiscal_periods')
    .select(SELECT_COLS)
    .eq('user_id', user.id)
    .is('client_id', null)
    .order('start_date', { ascending: false });
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

  let ownerUserId = user.id;
  if (client_id) {
    const scope = await resolveClientScope(service, user.id, client_id);
    if (!scope || !canWrite(scope.role)) {
      return NextResponse.json({ error: 'この会社への書き込み権限がありません' }, { status: 403 });
    }
    ownerUserId = scope.ownerUserId;
  }

  const { data, error } = await service
    .from('fiscal_periods')
    .insert({ user_id: ownerUserId, name, start_date, end_date, client_id, opening_balances: {}, corporate_tax: 0 })
    .select(SELECT_COLS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ period: data });
}
