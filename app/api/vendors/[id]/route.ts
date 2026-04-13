import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { normalizeVendorKey } from '@/lib/vendor-normalize';

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
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: '取引先名は空にできません' }, { status: 400 });
    update.name = name;
    update.normalized_key = normalizeVendorKey(name);
  }
  if (typeof body.reading === 'string') {
    update.reading = body.reading.trim().toLowerCase();
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from('vendors')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, name, normalized_key, reading')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // journal_entries の vendor_name も連動更新（同じ正規化キーの行を新名称に統一）
  if (data && update.name) {
    await service
      .from('journal_entries')
      .update({ vendor_name: data.name })
      .eq('user_id', user.id)
      .eq('vendor_name', body.previousName ?? data.name);
  }

  return NextResponse.json({ vendor: data });
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
  const { error } = await service
    .from('vendors')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
