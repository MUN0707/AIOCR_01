import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 15;

const SELECT_COLS = 'id, effective_from_date, depreciation_method_tangible, depreciation_method_intangible, depreciation_method_deferred, depreciation_timing, client_id, created_at';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const clientId = request.nextUrl.searchParams.get('clientId');
  const service = createServiceClient();

  let query = service
    .from('accounting_rules')
    .select(SELECT_COLS)
    .eq('user_id', user.id)
    .order('effective_from_date', { ascending: true });

  if (clientId) query = query.eq('client_id', clientId);
  else query = query.is('client_id', null);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const clientId: string | null = body.client_id ?? null;
  const effectiveFromDate: string = body.effective_from_date ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFromDate)) {
    return NextResponse.json({ error: '有効開始日を指定してください' }, { status: 400 });
  }

  const allowedMethod = (v: unknown, fallback: string) =>
    v === 'indirect' || v === 'direct' ? v : fallback;
  const allowedTiming = (v: unknown): 'monthly' | 'annual' =>
    v === 'monthly' ? 'monthly' : 'annual';

  const service = createServiceClient();
  const { data, error } = await service
    .from('accounting_rules')
    .insert({
      user_id: user.id,
      client_id: clientId,
      effective_from_date: effectiveFromDate,
      depreciation_method_tangible: allowedMethod(body.depreciation_method_tangible, 'indirect'),
      depreciation_method_intangible: allowedMethod(body.depreciation_method_intangible, 'direct'),
      depreciation_method_deferred: allowedMethod(body.depreciation_method_deferred, 'direct'),
      depreciation_timing: allowedTiming(body.depreciation_timing),
    })
    .select(SELECT_COLS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id を指定してください' }, { status: 400 });

  const service = createServiceClient();
  const { error } = await service
    .from('accounting_rules')
    .delete()
    .eq('user_id', user.id)
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
