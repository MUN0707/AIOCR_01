import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, listAccessibleClientIds, resolveClientScope } from '@/lib/client-access';
import { classifyAccount, suggestAccountReading, isCashEquivalentAccount } from '@/lib/account-category-classifier';

export const maxDuration = 15;

const SELECT_COLS = 'id, name, reading, category, sub_category, display_order, client_id, auto_registered, confirmed, parent_account_id, is_cash_equivalent';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const service = createServiceClient();
  const { searchParams } = new URL(request.url);
  const clientIdParam = searchParams.get('clientId');

  let query = service
    .from('accounts')
    .select(SELECT_COLS)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true });

  if (clientIdParam) {
    const scope = await resolveClientScope(service, user.id, clientIdParam);
    if (!scope) return NextResponse.json({ error: 'この会社へのアクセス権限がありません' }, { status: 403 });
    query = query.eq('client_id', clientIdParam).eq('user_id', scope.ownerUserId);
  } else {
    const accessible = await listAccessibleClientIds(service, user.id);
    if (accessible.length === 0) return NextResponse.json({ accounts: [] });
    query = query.in('client_id', accessible);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ accounts: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const name: string = (body.name ?? '').trim();
  let reading: string = (body.reading ?? '').trim().toLowerCase();
  let category: string = (body.category ?? '').trim();
  let sub_category: string = (body.sub_category ?? '').trim();
  const client_id: string | null = body.client_id ?? null;
  const parent_account_id: string | null = body.parent_account_id ?? null;
  // [C1] is_cash_equivalent は明示指定があればそれを採用、無ければ名称から推定
  const is_cash_equivalent: boolean =
    typeof body.is_cash_equivalent === 'boolean'
      ? body.is_cash_equivalent
      : isCashEquivalentAccount(name);

  if (!name) return NextResponse.json({ error: '科目名を入力してください' }, { status: 400 });
  if (name.length > 60) return NextResponse.json({ error: '科目名が長すぎます' }, { status: 400 });
  if (!client_id) return NextResponse.json({ error: '会社を選択してください' }, { status: 400 });

  const service = createServiceClient();
  const scope = await resolveClientScope(service, user.id, client_id);
  if (!scope || !canWrite(scope.role)) {
    return NextResponse.json({ error: 'この会社への書き込み権限がありません' }, { status: 403 });
  }

  // 補助科目の場合、親から category/sub_category を継承する
  if (parent_account_id && (!category || !sub_category)) {
    const { data: parent } = await service
      .from('accounts')
      .select('category, sub_category, client_id')
      .eq('id', parent_account_id)
      .single();
    if (parent) {
      if (!category) category = parent.category ?? '';
      if (!sub_category) sub_category = parent.sub_category ?? '';
    }
  }

  // [C1] 未指定の区分・読みは名称から自動推定して補完する（UI 提案を経由しない経路の保険）
  if (!category || !sub_category) {
    const cls = classifyAccount(name);
    if (!category && cls.category !== 'uncategorized') category = cls.category;
    if (!sub_category && cls.sub_category) sub_category = cls.sub_category;
  }
  if (!reading) reading = suggestAccountReading(name);

  const { data, error } = await service
    .from('accounts')
    .insert({
      user_id: scope.ownerUserId,
      client_id,
      name,
      reading,
      category,
      sub_category: sub_category || null,
      parent_account_id: parent_account_id || null,
      auto_registered: false,
      confirmed: true,
      is_cash_equivalent,
    })
    .select(SELECT_COLS)
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: '同じ名前の科目が既にあります' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ account: data });
}
