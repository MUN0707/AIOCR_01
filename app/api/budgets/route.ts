import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');
  const year = searchParams.get('year');

  const service = createServiceClient();

  let ownerUserId = user.id;
  if (clientId) {
    const scope = await resolveClientScope(service, user.id, clientId);
    if (!scope) return NextResponse.json({ error: 'この会社へのアクセス権限がありません' }, { status: 403 });
    ownerUserId = scope.ownerUserId;
  }

  let query = service
    .from('budgets')
    .select('id, account_name, year, month, amount')
    .eq('user_id', ownerUserId)
    .order('account_name')
    .order('month');

  if (clientId) query = query.eq('client_id', clientId);
  else query = query.is('client_id', null);
  if (year) query = query.eq('year', Number(year));

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ budgets: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const account_name: string = (body.account_name ?? '').trim();
  const year = Number(body.year);
  const month = Number(body.month);
  const amount = Number(body.amount ?? 0);
  const client_id: string | null = body.client_id ?? null;

  if (!account_name) return NextResponse.json({ error: '科目名を入力してください' }, { status: 400 });
  if (!year || year < 2000 || year > 2100) return NextResponse.json({ error: '年が不正です' }, { status: 400 });
  if (!month || month < 1 || month > 12) return NextResponse.json({ error: '月が不正です' }, { status: 400 });

  const service = createServiceClient();

  let ownerUserId = user.id;
  if (client_id) {
    const scope = await resolveClientScope(service, user.id, client_id);
    if (!scope || !canWrite(scope.role)) {
      return NextResponse.json({ error: 'この会社への書き込み権限がありません' }, { status: 403 });
    }
    ownerUserId = scope.ownerUserId;
  }

  // INSERT 試行 → 重複 (23505) なら既存行を UPDATE
  const roundedAmount = Math.round(amount);
  const { data: inserted, error: insertError } = await service
    .from('budgets')
    .insert({ user_id: ownerUserId, client_id, account_name, year, month, amount: roundedAmount })
    .select('id, account_name, year, month, amount')
    .single();

  if (!insertError) return NextResponse.json({ budget: inserted });

  if (insertError.code !== '23505') {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // 既存行を取得して UPDATE
  let existQuery = service
    .from('budgets')
    .select('id')
    .eq('user_id', ownerUserId)
    .eq('account_name', account_name)
    .eq('year', year)
    .eq('month', month);
  if (client_id) existQuery = existQuery.eq('client_id', client_id);
  else existQuery = existQuery.is('client_id', null);

  const { data: existing } = await existQuery.single();
  if (!existing) return NextResponse.json({ error: '既存行の取得に失敗しました' }, { status: 500 });

  const { data: updated, error: updateError } = await service
    .from('budgets')
    .update({ amount: roundedAmount })
    .eq('id', existing.id)
    .select('id, account_name, year, month, amount')
    .single();

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json({ budget: updated });
}
