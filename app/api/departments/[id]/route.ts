import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

async function resolveDeptScope(
  service: ReturnType<typeof createServiceClient>,
  callingUserId: string,
  id: string,
): Promise<{ ownerUserId: string } | { error: string; status: number }> {
  const { data: row } = await service
    .from('departments')
    .select('user_id, client_id')
    .eq('id', id)
    .single();
  if (!row) return { error: '部門が見つかりません', status: 404 };
  if (row.client_id) {
    const scope = await resolveClientScope(service, callingUserId, row.client_id);
    if (!scope || !canWrite(scope.role)) {
      return { error: 'この部門の書き込み権限がありません', status: 403 };
    }
    return { ownerUserId: scope.ownerUserId };
  }
  if (row.user_id !== callingUserId) {
    return { error: '部門が見つかりません', status: 404 };
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
  const service = createServiceClient();

  const allowed = ['name', 'code', 'is_active'] as const;
  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: '更新フィールドがありません' }, { status: 400 });
  }

  const resolved = await resolveDeptScope(service, user.id, id);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  const { error } = await service
    .from('departments')
    .update(update)
    .eq('id', id)
    .eq('user_id', resolved.ownerUserId);

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: '同じ名前の部門が既にあります' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
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
  const resolved = await resolveDeptScope(service, user.id, id);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  // 仕訳に紐付いている場合は null に設定済み（ON DELETE SET NULL）なので直接削除可
  const { error } = await service
    .from('departments')
    .delete()
    .eq('id', id)
    .eq('user_id', resolved.ownerUserId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
