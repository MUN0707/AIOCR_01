import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const service = createServiceClient();

  // 対象 budget の所有判定
  const { data: row } = await service
    .from('budgets')
    .select('user_id, client_id')
    .eq('id', id)
    .single();
  if (!row) return NextResponse.json({ error: '予算が見つかりません' }, { status: 404 });

  let ownerUserId = user.id;
  if (row.client_id) {
    const scope = await resolveClientScope(service, user.id, row.client_id);
    if (!scope || !canWrite(scope.role)) {
      return NextResponse.json({ error: 'この予算の削除権限がありません' }, { status: 403 });
    }
    ownerUserId = scope.ownerUserId;
  } else {
    if (row.user_id !== user.id) {
      return NextResponse.json({ error: '予算が見つかりません' }, { status: 404 });
    }
  }

  const { error } = await service
    .from('budgets')
    .delete()
    .eq('id', id)
    .eq('user_id', ownerUserId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
