import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');

  const service = createServiceClient();
  let query = service
    .from('client_members')
    .select('id, client_id, member_email, role, invited_at, note')
    .eq('owner_user_id', user.id)
    .order('client_id')
    .order('role');

  if (clientId) query = query.eq('client_id', clientId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ members: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const member_email: string = (body.member_email ?? '').trim().toLowerCase();
  const role: string = body.role ?? 'entry';
  const client_id: string | null = body.client_id ?? null;
  const note: string = (body.note ?? '').trim();

  if (!member_email || !member_email.includes('@')) {
    return NextResponse.json({ error: 'メールアドレスを正しく入力してください' }, { status: 400 });
  }
  if (!['approver', 'entry', 'viewer'].includes(role)) {
    return NextResponse.json({ error: '無効なロールです' }, { status: 400 });
  }
  if (!client_id) {
    return NextResponse.json({ error: '顧問先を選択してください' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from('client_members')
    .insert({ owner_user_id: user.id, client_id, member_email, role, note: note || null })
    .select('id, client_id, member_email, role, invited_at, note')
    .single();

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'このメンバーは既に登録されています' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ member: data });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id が必要です' }, { status: 400 });

  const service = createServiceClient();
  const { error } = await service
    .from('client_members')
    .delete()
    .eq('id', id)
    .eq('owner_user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
