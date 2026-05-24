import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { sendClientInvite } from '@/lib/invite-email';

export const maxDuration = 30;

function getOrigin(request: NextRequest): string {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (host) return `${forwardedProto ?? 'https'}://${host}`;
  return new URL(request.url).origin;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const id: string = body.id ?? '';
  if (!id) return NextResponse.json({ error: 'id が必要です' }, { status: 400 });

  const service = createServiceClient();

  const { data: member } = await service
    .from('client_members')
    .select('id, client_id, member_email, role, owner_user_id, accepted_at, clients(name)')
    .eq('id', id)
    .eq('owner_user_id', user.id)
    .single();

  if (!member) return NextResponse.json({ error: 'メンバーが見つかりません' }, { status: 404 });
  if (member.accepted_at) return NextResponse.json({ error: '既に承諾済みのメンバーです' }, { status: 400 });

  const newToken = randomUUID();
  const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error: upErr } = await service
    .from('client_members')
    .update({ invite_token: newToken, invite_expires_at: newExpiresAt })
    .eq('id', id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const clientName = Array.isArray(member.clients)
    ? (member.clients[0] as { name?: string } | undefined)?.name ?? ''
    : (member.clients as { name?: string } | null)?.name ?? '';

  const inviteUrl = `${getOrigin(request)}/invite/${newToken}`;
  const mailRes = await sendClientInvite({
    toEmail: member.member_email,
    inviterEmail: user.email ?? '',
    clientName,
    role: member.role,
    inviteUrl,
  });

  if (!mailRes.ok) {
    return NextResponse.json({ error: `メール送信失敗: ${mailRes.error}` }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
