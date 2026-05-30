import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

// 月別生産量（生産高比例法）の取得・登録・削除
// 資産のスコープ解決は親ルートと同じロジック。

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
    .from('asset_monthly_production')
    .select('id, year, month, quantity')
    .eq('user_id', resolved.ownerUserId)
    .eq('asset_id', id)
    .order('year', { ascending: true })
    .order('month', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const year = Number(body.year);
  const month = Number(body.month);
  const quantity = Number(body.quantity);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: '年月が不正です' }, { status: 400 });
  }
  if (!Number.isFinite(quantity) || quantity < 0) {
    return NextResponse.json({ error: '生産量が不正です' }, { status: 400 });
  }

  const service = createServiceClient();
  const resolved = await resolveAssetScope(service, user.id, id, true);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  // (asset_id, year, month) の一意制約に対し upsert
  const { data, error } = await service
    .from('asset_monthly_production')
    .upsert(
      {
        user_id: resolved.ownerUserId,
        client_id: resolved.clientId,
        asset_id: id,
        year,
        month,
        quantity,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'asset_id,year,month' },
    )
    .select('id, year, month, quantity')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: data });
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const rowId = request.nextUrl.searchParams.get('row_id');
  if (!rowId) return NextResponse.json({ error: 'row_id が必要です' }, { status: 400 });

  const service = createServiceClient();
  const resolved = await resolveAssetScope(service, user.id, id, true);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  const { error } = await service
    .from('asset_monthly_production')
    .delete()
    .eq('user_id', resolved.ownerUserId)
    .eq('asset_id', id)
    .eq('id', rowId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
