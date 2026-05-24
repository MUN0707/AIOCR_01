import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

const COLS = 'id, name, debit_account, credit_account, amount, description, tax_category, recur_type, recur_day, client_id, created_at';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const clientId = request.nextUrl.searchParams.get('clientId');
  const service = createServiceClient();

  let ownerUserId = user.id;
  if (clientId) {
    const scope = await resolveClientScope(service, user.id, clientId);
    if (!scope) return NextResponse.json({ error: 'この会社へのアクセス権限がありません' }, { status: 403 });
    ownerUserId = scope.ownerUserId;
  }

  let q = service
    .from('journal_templates')
    .select(COLS)
    .eq('user_id', ownerUserId)
    .order('created_at', { ascending: true });

  if (clientId) q = q.eq('client_id', clientId);
  else q = q.is('client_id', null);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const { name, debit_account, credit_account, amount, description, tax_category, recur_type, recur_day, client_id } = body;

  if (!name || !debit_account || !credit_account) {
    return NextResponse.json({ error: 'テンプレート名・借方・貸方は必須です' }, { status: 400 });
  }

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
    .from('journal_templates')
    .insert({
      user_id: ownerUserId,
      client_id: client_id || null,
      name,
      debit_account,
      credit_account,
      amount: amount ? Number(amount) : null,
      description: description || null,
      tax_category: tax_category || null,
      recur_type: recur_type || 'manual',
      recur_day: recur_day ? Number(recur_day) : null,
    })
    .select(COLS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data }, { status: 201 });
}
