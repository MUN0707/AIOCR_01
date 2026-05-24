import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

const SELECT_COLS = 'id, effective_from_date, depreciation_method_tangible, depreciation_method_intangible, depreciation_method_deferred, depreciation_timing, client_id, created_at';

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
      .from('accounting_rules')
      .select(SELECT_COLS)
      .eq('user_id', scope.ownerUserId)
      .eq('client_id', clientId)
      .order('effective_from_date', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rules: data ?? [] });
  }

  const { data, error } = await service
    .from('accounting_rules')
    .select(SELECT_COLS)
    .eq('user_id', user.id)
    .is('client_id', null)
    .order('effective_from_date', { ascending: true });
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

  let ownerUserId = user.id;
  if (clientId) {
    const scope = await resolveClientScope(service, user.id, clientId);
    if (!scope || !canWrite(scope.role)) {
      return NextResponse.json({ error: 'この会社への書き込み権限がありません' }, { status: 403 });
    }
    ownerUserId = scope.ownerUserId;
  }

  const { data, error } = await service
    .from('accounting_rules')
    .insert({
      user_id: ownerUserId,
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

  // 対象 rule の所有判定
  const { data: rule } = await service
    .from('accounting_rules')
    .select('user_id, client_id')
    .eq('id', id)
    .single();
  if (!rule) return NextResponse.json({ error: 'ルールが見つかりません' }, { status: 404 });

  let ownerUserId = user.id;
  if (rule.client_id) {
    const scope = await resolveClientScope(service, user.id, rule.client_id);
    if (!scope || !canWrite(scope.role)) {
      return NextResponse.json({ error: 'このルールの削除権限がありません' }, { status: 403 });
    }
    ownerUserId = scope.ownerUserId;
  } else {
    if (rule.user_id !== user.id) {
      return NextResponse.json({ error: 'ルールが見つかりません' }, { status: 404 });
    }
  }

  const { error } = await service
    .from('accounting_rules')
    .delete()
    .eq('user_id', ownerUserId)
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
