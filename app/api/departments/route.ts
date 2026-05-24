import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, listAccessibleClientIds, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

const SELECT_COLS = 'id, name, code, is_active, client_id, created_at';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const clientIdParam = searchParams.get('clientId');

  const service = createServiceClient();

  if (clientIdParam === 'null') {
    // 個人スコープ (client_id null) を明示指定
    const { data, error } = await service
      .from('departments')
      .select(SELECT_COLS)
      .eq('user_id', user.id)
      .is('client_id', null)
      .order('code', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ departments: data ?? [] });
  }

  if (clientIdParam) {
    const scope = await resolveClientScope(service, user.id, clientIdParam);
    if (!scope) return NextResponse.json({ error: 'この会社へのアクセス権限がありません' }, { status: 403 });
    const { data, error } = await service
      .from('departments')
      .select(SELECT_COLS)
      .eq('user_id', scope.ownerUserId)
      .eq('client_id', clientIdParam)
      .order('code', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ departments: data ?? [] });
  }

  // clientId 未指定: 個人 (caller の user_id + client_id null) と全アクセス可能 client を union
  const accessible = await listAccessibleClientIds(service, user.id);
  const [personalRes, clientRes] = await Promise.all([
    service
      .from('departments')
      .select(SELECT_COLS)
      .eq('user_id', user.id)
      .is('client_id', null)
      .order('code', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true }),
    accessible.length > 0
      ? service
          .from('departments')
          .select(SELECT_COLS)
          .in('client_id', accessible)
          .order('code', { ascending: true, nullsFirst: false })
          .order('name', { ascending: true })
      : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
  ]);
  if (personalRes.error) return NextResponse.json({ error: personalRes.error.message }, { status: 500 });
  if (clientRes.error) return NextResponse.json({ error: clientRes.error.message }, { status: 500 });
  const merged = [...(personalRes.data ?? []), ...(clientRes.data ?? [])];
  return NextResponse.json({ departments: merged });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const name: string = (body.name ?? '').trim();
  const code: string = (body.code ?? '').trim();
  const client_id: string | null = body.client_id ?? null;

  if (!name) return NextResponse.json({ error: '部門名を入力してください' }, { status: 400 });
  if (name.length > 60) return NextResponse.json({ error: '部門名が長すぎます' }, { status: 400 });

  const service = createServiceClient();

  let ownerUserId = user.id;
  if (client_id) {
    const scope = await resolveClientScope(service, user.id, client_id);
    if (!scope || !canWrite(scope.role)) {
      return NextResponse.json({ error: 'この会社への書き込み権限がありません' }, { status: 403 });
    }
    ownerUserId = scope.ownerUserId;
  }

  const { data, error } = await service
    .from('departments')
    .insert({ user_id: ownerUserId, client_id, name, code: code || null, is_active: true })
    .select(SELECT_COLS)
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: '同じ名前の部門が既にあります' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ department: data });
}
