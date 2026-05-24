import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

const SELECT_COLS = 'id, asset_number, category, name, account_name, acquisition_date, depreciation_start_date, acquisition_cost, residual_value, useful_life_years, method, last_depreciated_through, status, note, client_id, created_at, updated_at';

async function resolveAssetScope(
  service: ReturnType<typeof createServiceClient>,
  callingUserId: string,
  id: string,
  requireWrite: boolean,
): Promise<{ ownerUserId: string; clientId: string | null } | { error: string; status: number }> {
  const { data: row } = await service
    .from('fixed_assets')
    .select('user_id, client_id')
    .eq('id', id)
    .single();
  if (!row) return { error: '資産が見つかりません', status: 404 };
  if (row.client_id) {
    const scope = await resolveClientScope(service, callingUserId, row.client_id);
    if (!scope) return { error: 'この資産へのアクセス権限がありません', status: 403 };
    if (requireWrite && !canWrite(scope.role)) {
      return { error: 'この資産の書き込み権限がありません', status: 403 };
    }
    return { ownerUserId: scope.ownerUserId, clientId: row.client_id };
  }
  if (row.user_id !== callingUserId) {
    return { error: '資産が見つかりません', status: 404 };
  }
  return { ownerUserId: callingUserId, clientId: null };
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const service = createServiceClient();
  const resolved = await resolveAssetScope(service, user.id, id, false);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  const { data, error } = await service
    .from('fixed_assets')
    .select(SELECT_COLS)
    .eq('user_id', resolved.ownerUserId)
    .eq('id', id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ asset: data });
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const patch: Record<string, unknown> = {};
  const allowed = [
    'category', 'name', 'account_name', 'acquisition_date', 'depreciation_start_date',
    'acquisition_cost', 'residual_value', 'useful_life_years', 'method', 'status', 'note',
  ];
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }
  if ('acquisition_cost' in patch) patch.acquisition_cost = Number(patch.acquisition_cost);
  if ('residual_value' in patch) patch.residual_value = Number(patch.residual_value);
  if ('useful_life_years' in patch && patch.useful_life_years != null) {
    patch.useful_life_years = Number(patch.useful_life_years);
  }
  patch.updated_at = new Date().toISOString();

  const service = createServiceClient();
  const resolved = await resolveAssetScope(service, user.id, id, true);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  const { data, error } = await service
    .from('fixed_assets')
    .update(patch)
    .eq('user_id', resolved.ownerUserId)
    .eq('id', id)
    .select(SELECT_COLS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ asset: data });
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const service = createServiceClient();
  const resolved = await resolveAssetScope(service, user.id, id, true);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  // 紐付く減価償却仕訳も削除
  await service
    .from('journal_entries')
    .delete()
    .eq('user_id', resolved.ownerUserId)
    .eq('source_fixed_asset_id', id);

  const { error } = await service
    .from('fixed_assets')
    .delete()
    .eq('user_id', resolved.ownerUserId)
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
