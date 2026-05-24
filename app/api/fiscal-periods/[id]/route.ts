import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

const SELECT_COLS = 'id, name, start_date, end_date, client_id, opening_balances, corporate_tax, created_at';

async function resolveOwnerOrDeny(
  service: ReturnType<typeof createServiceClient>,
  callingUserId: string,
  id: string,
): Promise<{ ownerUserId: string } | { error: string; status: number }> {
  const { data: row } = await service
    .from('fiscal_periods')
    .select('user_id, client_id')
    .eq('id', id)
    .single();
  if (!row) return { error: '会計期間が見つかりません', status: 404 };
  if (row.client_id) {
    const scope = await resolveClientScope(service, callingUserId, row.client_id);
    if (!scope || !canWrite(scope.role)) {
      return { error: 'この会計期間の書き込み権限がありません', status: 403 };
    }
    return { ownerUserId: scope.ownerUserId };
  }
  if (row.user_id !== callingUserId) {
    return { error: '会計期間が見つかりません', status: 404 };
  }
  return { ownerUserId: callingUserId };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const patch: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const v = String(body.name).trim();
    if (!v) return NextResponse.json({ error: '期の名前は必須です' }, { status: 400 });
    patch.name = v;
  }
  if (body.start_date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.start_date)) {
      return NextResponse.json({ error: '日付形式が不正です' }, { status: 400 });
    }
    patch.start_date = body.start_date;
  }
  if (body.end_date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.end_date)) {
      return NextResponse.json({ error: '日付形式が不正です' }, { status: 400 });
    }
    patch.end_date = body.end_date;
  }
  if (body.corporate_tax !== undefined) {
    const num = Number(body.corporate_tax);
    if (!Number.isFinite(num)) {
      return NextResponse.json({ error: '法人税等は数値で指定してください' }, { status: 400 });
    }
    patch.corporate_tax = num;
  }
  if (body.opening_balances !== undefined) {
    if (typeof body.opening_balances !== 'object' || body.opening_balances === null) {
      return NextResponse.json({ error: 'opening_balances はオブジェクトで指定してください' }, { status: 400 });
    }
    // 数値以外の値は除外
    const cleaned: Record<string, number> = {};
    for (const [k, v] of Object.entries(body.opening_balances)) {
      const num = Number(v);
      if (Number.isFinite(num)) cleaned[k] = num;
    }
    patch.opening_balances = cleaned;
  }

  const service = createServiceClient();
  const resolved = await resolveOwnerOrDeny(service, user.id, id);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  const { data, error } = await service
    .from('fiscal_periods')
    .update(patch)
    .eq('id', id)
    .eq('user_id', resolved.ownerUserId)
    .select(SELECT_COLS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ period: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const service = createServiceClient();
  const resolved = await resolveOwnerOrDeny(service, user.id, id);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  const { error } = await service
    .from('fiscal_periods')
    .delete()
    .eq('id', id)
    .eq('user_id', resolved.ownerUserId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
