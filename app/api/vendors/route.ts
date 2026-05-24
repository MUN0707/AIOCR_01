import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { normalizeVendorKey } from '@/lib/vendor-normalize';
import { canWrite, listAccessibleClientIds, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

const SELECT_COLS = 'id, name, normalized_key, reading, client_id, bank_code, branch_code, account_type, account_number, account_name_kana';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const service = createServiceClient();
  const { searchParams } = new URL(request.url);
  const clientIdParam = searchParams.get('clientId');

  let query = service
    .from('vendors')
    .select(SELECT_COLS)
    .order('name', { ascending: true });

  if (clientIdParam) {
    const scope = await resolveClientScope(service, user.id, clientIdParam);
    if (!scope) return NextResponse.json({ error: 'この会社へのアクセス権限がありません' }, { status: 403 });
    query = query.eq('client_id', clientIdParam).eq('user_id', scope.ownerUserId);
  } else {
    const accessible = await listAccessibleClientIds(service, user.id);
    if (accessible.length === 0) return NextResponse.json({ vendors: [] });
    query = query.in('client_id', accessible);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ vendors: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const name: string = (body.name ?? '').trim();
  const reading: string = (body.reading ?? '').trim().toLowerCase();
  const client_id: string | null = body.client_id ?? null;
  if (!name) return NextResponse.json({ error: '取引先名を入力してください' }, { status: 400 });
  if (name.length > 100) return NextResponse.json({ error: '取引先名が長すぎます' }, { status: 400 });
  if (!client_id) return NextResponse.json({ error: '会社を選択してください' }, { status: 400 });

  const key = normalizeVendorKey(name);
  if (!key) return NextResponse.json({ error: '正規化キーが空になります' }, { status: 400 });

  const service = createServiceClient();
  const scope = await resolveClientScope(service, user.id, client_id);
  if (!scope || !canWrite(scope.role)) {
    return NextResponse.json({ error: 'この会社への書き込み権限がありません' }, { status: 403 });
  }

  // 既存に同一キー(同一会社スコープ)があれば返却
  const { data: existing } = await service
    .from('vendors')
    .select(SELECT_COLS)
    .eq('user_id', scope.ownerUserId)
    .eq('normalized_key', key)
    .eq('client_id', client_id)
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json({ vendor: existing[0], existed: true });
  }

  const { data, error } = await service
    .from('vendors')
    .insert({ user_id: scope.ownerUserId, client_id, name, normalized_key: key, reading })
    .select(SELECT_COLS)
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: '同じ取引先が既にあります' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ vendor: data });
}
