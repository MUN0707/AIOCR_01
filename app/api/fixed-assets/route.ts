import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 15;

const SELECT_COLS = 'id, asset_number, category, name, account_name, acquisition_date, depreciation_start_date, acquisition_cost, residual_value, useful_life_years, method, last_depreciated_through, status, note, client_id, created_at, updated_at';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const clientId = request.nextUrl.searchParams.get('clientId');
  const service = createServiceClient();

  let query = service
    .from('fixed_assets')
    .select(SELECT_COLS)
    .eq('user_id', user.id)
    .order('asset_number', { ascending: true });

  if (clientId) query = query.eq('client_id', clientId);
  else query = query.is('client_id', null);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assets: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const service = createServiceClient();

  const clientId: string | null = body.client_id ?? null;

  // 次の連番を算出
  let nextNumQuery = service
    .from('fixed_assets')
    .select('asset_number')
    .eq('user_id', user.id)
    .order('asset_number', { ascending: false })
    .limit(1);
  if (clientId) nextNumQuery = nextNumQuery.eq('client_id', clientId);
  else nextNumQuery = nextNumQuery.is('client_id', null);
  const { data: maxRows } = await nextNumQuery;
  const nextNum = (maxRows && maxRows[0]?.asset_number ? maxRows[0].asset_number : 0) + 1;

  const category: string = body.category ?? 'tangible';
  if (!['tangible', 'intangible', 'deferred'].includes(category)) {
    return NextResponse.json({ error: '区分が不正です' }, { status: 400 });
  }

  const insertRow = {
    user_id: user.id,
    client_id: clientId,
    asset_number: nextNum,
    category,
    name: (body.name ?? '').trim() || `固定資産${nextNum}`,
    account_name: (body.account_name ?? '').trim(),
    acquisition_date: body.acquisition_date ?? null,
    depreciation_start_date: body.depreciation_start_date ?? null,
    acquisition_cost: Number(body.acquisition_cost ?? 0),
    residual_value: Number(body.residual_value ?? 0),
    useful_life_years: body.useful_life_years != null ? Number(body.useful_life_years) : null,
    method: body.method ?? 'straight_line',
    status: body.status ?? 'pending',
    note: body.note ?? null,
  };

  const { data, error } = await service
    .from('fixed_assets')
    .insert(insertRow)
    .select(SELECT_COLS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ asset: data });
}
