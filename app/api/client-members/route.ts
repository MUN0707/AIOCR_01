import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { sendClientInvite } from '@/lib/invite-email';

export const maxDuration = 30;

const SELECT_COLS = 'id, client_id, member_email, role, invited_at, accepted_at, invite_expires_at, member_user_id, note';

function getOrigin(request: NextRequest): string {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (host) return `${forwardedProto ?? 'https'}://${host}`;
  return new URL(request.url).origin;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');

  const service = createServiceClient();
  let query = service
    .from('client_members')
    .select(SELECT_COLS)
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

  // owner 本人の所有 client か確認
  const { data: clientRow } = await service
    .from('clients')
    .select('id, name')
    .eq('id', client_id)
    .eq('user_id', user.id)
    .single();
  if (!clientRow) {
    return NextResponse.json({ error: 'この顧問先の招待権限がありません' }, { status: 403 });
  }

  const invite_token = randomUUID();
  const invite_expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await service
    .from('client_members')
    .insert({
      owner_user_id: user.id,
      client_id,
      member_email,
      role,
      note: note || null,
      invite_token,
      invite_expires_at,
    })
    .select(SELECT_COLS)
    .single();

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'このメンバーは既に登録されています' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const inviteUrl = `${getOrigin(request)}/invite/${invite_token}`;
  const mailRes = await sendClientInvite({
    toEmail: member_email,
    inviterEmail: user.email ?? '',
    clientName: clientRow.name,
    role,
    inviteUrl,
  });

  if (!mailRes.ok) {
    return NextResponse.json({
      member: data,
      warning: `メンバーは登録されましたが、招待メールの送信に失敗しました: ${mailRes.error}。再送をお試しください。`,
    });
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
