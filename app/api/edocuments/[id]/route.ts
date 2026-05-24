import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

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

  // 対象アップロードの所有判定
  const { data: row } = await service
    .from('ocr_uploads')
    .select('user_id, client_id')
    .eq('id', id)
    .single();
  if (!row) return NextResponse.json({ error: '電子書類が見つかりません' }, { status: 404 });

  let ownerUserId = user.id;
  if (row.client_id) {
    const scope = await resolveClientScope(service, user.id, row.client_id);
    if (!scope || !canWrite(scope.role)) {
      return NextResponse.json({ error: 'この電子書類の書き込み権限がありません' }, { status: 403 });
    }
    ownerUserId = scope.ownerUserId;
  } else {
    if (row.user_id !== user.id) {
      return NextResponse.json({ error: '電子書類が見つかりません' }, { status: 404 });
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const allowed = ['doc_category', 'receipt_date', 'transaction_amount', 'counterparty', 'edoc_notes'] as const;
  for (const key of allowed) {
    if (key in body) patch[key] = body[key] === '' ? null : body[key];
  }

  const { error } = await service
    .from('ocr_uploads')
    .update(patch)
    .eq('id', id)
    .eq('user_id', ownerUserId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
