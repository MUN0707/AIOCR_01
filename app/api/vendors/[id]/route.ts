import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { normalizeVendorKey } from '@/lib/vendor-normalize';
import { canWrite, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

async function ownerOfVendor(service: ReturnType<typeof createServiceClient>, vendorId: string) {
  const { data } = await service
    .from('vendors')
    .select('user_id, client_id')
    .eq('id', vendorId)
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
  const v = await ownerOfVendor(service, id);
  if (!v) return NextResponse.json({ error: '取引先が見つかりません' }, { status: 404 });
  const scope = await resolveClientScope(service, user.id, v.client_id);
  if (!scope || !canWrite(scope.role)) {
    return NextResponse.json({ error: '書き込み権限がありません' }, { status: 403 });
  }

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
  if ('client_id' in body) {
    if (!body.client_id) return NextResponse.json({ error: '会社は必須です' }, { status: 400 });
    if (body.client_id !== v.client_id) {
      const dstScope = await resolveClientScope(service, user.id, body.client_id);
      if (!dstScope || !canWrite(dstScope.role)) {
        return NextResponse.json({ error: '移動先会社の書き込み権限がありません' }, { status: 403 });
      }
    }
    update.client_id = body.client_id;
  }
  if ('bank_code' in body) update.bank_code = body.bank_code ?? null;
  if ('branch_code' in body) update.branch_code = body.branch_code ?? null;
  if ('account_type' in body) update.account_type = body.account_type ?? '1';
  if ('account_number' in body) update.account_number = body.account_number ?? null;
  if ('account_name_kana' in body) update.account_name_kana = body.account_name_kana ?? null;

  const { data, error } = await service
    .from('vendors')
    .update(update)
    .eq('id', id)
    .eq('user_id', scope.ownerUserId)
    .select('id, name, normalized_key, reading, client_id, bank_code, branch_code, account_type, account_number, account_name_kana')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (data && update.name) {
    await service
      .from('journal_entries')
      .update({ vendor_name: data.name })
      .eq('user_id', scope.ownerUserId)
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
  const v = await ownerOfVendor(service, id);
  if (!v) return NextResponse.json({ error: '取引先が見つかりません' }, { status: 404 });
  const scope = await resolveClientScope(service, user.id, v.client_id);
  if (!scope || !canWrite(scope.role)) {
    return NextResponse.json({ error: '削除権限がありません' }, { status: 403 });
  }

  const { error } = await service
    .from('vendors')
    .delete()
    .eq('id', id)
    .eq('user_id', scope.ownerUserId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
