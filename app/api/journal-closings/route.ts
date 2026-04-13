import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 15;

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET(request: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');

  const service = createServiceClient();
  let q = service.from('journal_closings').select('closed_until').eq('user_id', user.id);
  if (clientId) q = q.eq('client_id', clientId);
  else q = q.is('client_id', null);

  const { data, error } = await q.limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ closedUntil: data?.[0]?.closed_until ?? null });
}

export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const clientId: string | null = body.clientId ?? null;
  const closedUntil: string = body.closedUntil ?? '';

  if (!/^\d{8}$/.test(closedUntil)) {
    return NextResponse.json({ error: '締め日は YYYYMMDD 形式で指定してください' }, { status: 400 });
  }

  const service = createServiceClient();

  // 既存レコードがあれば更新、なければ挿入
  let existing = service.from('journal_closings').select('id').eq('user_id', user.id);
  if (clientId) existing = existing.eq('client_id', clientId);
  else existing = existing.is('client_id', null);
  const { data: existingRow } = await existing.limit(1);

  const now = new Date().toISOString();
  if (existingRow && existingRow.length > 0) {
    const { error } = await service
      .from('journal_closings')
      .update({ closed_until: closedUntil, updated_at: now })
      .eq('id', existingRow[0].id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await service
      .from('journal_closings')
      .insert({ user_id: user.id, client_id: clientId, closed_until: closedUntil });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, closedUntil });
}

export async function DELETE(request: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');

  const service = createServiceClient();
  let q = service.from('journal_closings').delete().eq('user_id', user.id);
  if (clientId) q = q.eq('client_id', clientId);
  else q = q.is('client_id', null);
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
