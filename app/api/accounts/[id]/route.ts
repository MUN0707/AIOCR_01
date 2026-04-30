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
  const update: Record<string, unknown> = {};
  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: '科目名は空にできません' }, { status: 400 });
    update.name = name;
  }
  if (typeof body.reading === 'string') update.reading = body.reading.trim().toLowerCase();
  if (typeof body.category === 'string') update.category = body.category;
  if (typeof body.sub_category === 'string') update.sub_category = body.sub_category || null;
  if (typeof body.display_order === 'number') update.display_order = body.display_order;
  if ('client_id' in body) update.client_id = body.client_id ?? null;
  if (typeof body.confirmed === 'boolean') update.confirmed = body.confirmed;
  if (typeof body.auto_registered === 'boolean') update.auto_registered = body.auto_registered;

  const service = createServiceClient();

  // 旧名称取得（journal_entries 連動更新用）
  let previousName: string | null = null;
  if (update.name) {
    const { data: prev } = await service
      .from('accounts')
      .select('name')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();
    previousName = prev?.name ?? null;
  }

  const { data, error } = await service
    .from('accounts')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, name, reading, category, sub_category, display_order, client_id, auto_registered, confirmed')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: '同じ名前の科目が既にあります' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 既存仕訳の借方・貸方科目名も連動更新
  if (previousName && update.name && previousName !== update.name) {
    await service
      .from('journal_entries')
      .update({ debit_account: update.name })
      .eq('user_id', user.id)
      .eq('debit_account', previousName);
    await service
      .from('journal_entries')
      .update({ credit_account: update.name })
      .eq('user_id', user.id)
      .eq('credit_account', previousName);
  }

  return NextResponse.json({ account: data });
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
    .from('accounts')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
