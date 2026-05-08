import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

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

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const allowed = ['doc_category', 'receipt_date', 'transaction_amount', 'counterparty', 'edoc_notes'] as const;
  for (const key of allowed) {
    if (key in body) patch[key] = body[key] === '' ? null : body[key];
  }

  const { error } = await service
    .from('ocr_uploads')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
