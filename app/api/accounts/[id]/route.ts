import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

async function ownerOfAccount(service: ReturnType<typeof createServiceClient>, accountId: string) {
  const { data } = await service
    .from('accounts')
    .select('user_id, client_id')
    .eq('id', accountId)
    .single();
  return data;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const service = createServiceClient();
  const acc = await ownerOfAccount(service, id);
  if (!acc) return NextResponse.json({ error: '科目が見つかりません' }, { status: 404 });
  const scope = await resolveClientScope(service, user.id, acc.client_id);
  if (!scope || !canWrite(scope.role)) {
    return NextResponse.json({ error: '書き込み権限がありません' }, { status: 403 });
  }

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
  if ('client_id' in body) {
    if (!body.client_id) return NextResponse.json({ error: '会社は必須です' }, { status: 400 });
    // 別 client への移動は移動先にも書き込み権限が必要
    if (body.client_id !== acc.client_id) {
      const dstScope = await resolveClientScope(service, user.id, body.client_id);
      if (!dstScope || !canWrite(dstScope.role)) {
        return NextResponse.json({ error: '移動先会社の書き込み権限がありません' }, { status: 403 });
      }
    }
    update.client_id = body.client_id;
  }
  if ('parent_account_id' in body) update.parent_account_id = body.parent_account_id ?? null;
  if (typeof body.confirmed === 'boolean') update.confirmed = body.confirmed;
  if (typeof body.auto_registered === 'boolean') update.auto_registered = body.auto_registered;
  // [C1] 現金及び現金同等物フラグの更新
  if (typeof body.is_cash_equivalent === 'boolean') update.is_cash_equivalent = body.is_cash_equivalent;

  // 旧名称取得（journal_entries 連動更新用）
  let previousName: string | null = null;
  if (update.name) {
    const { data: prev } = await service
      .from('accounts')
      .select('name')
      .eq('id', id)
      .eq('user_id', scope.ownerUserId)
      .single();
    previousName = prev?.name ?? null;
  }

  const { data, error } = await service
    .from('accounts')
    .update(update)
    .eq('id', id)
    .eq('user_id', scope.ownerUserId)
    .select('id, name, reading, category, sub_category, display_order, client_id, auto_registered, confirmed, parent_account_id, is_cash_equivalent')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: '同じ名前の科目が既にあります' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (previousName && update.name && previousName !== update.name) {
    await service.rpc('rename_account_in_journal_entries', {
      p_user_id: scope.ownerUserId,
      p_previous_name: previousName,
      p_new_name: update.name as string,
    });
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
  const acc = await ownerOfAccount(service, id);
  if (!acc) return NextResponse.json({ error: '科目が見つかりません' }, { status: 404 });
  const scope = await resolveClientScope(service, user.id, acc.client_id);
  if (!scope || !canWrite(scope.role)) {
    return NextResponse.json({ error: '削除権限がありません' }, { status: 403 });
  }

  const { error } = await service
    .from('accounts')
    .delete()
    .eq('id', id)
    .eq('user_id', scope.ownerUserId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
