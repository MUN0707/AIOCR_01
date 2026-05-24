import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 15;

/**
 * GET /api/client-members/accept?token=xxx
 *   トークンの妥当性を返す（未ログインでも呼べる、UI 表示用）
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = (searchParams.get('token') ?? '').trim();
  if (!token) return NextResponse.json({ valid: false, error: 'token が必要です' }, { status: 400 });

  const service = createServiceClient();
  const { data } = await service
    .from('client_members')
    .select('id, member_email, role, invite_expires_at, accepted_at, clients(name)')
    .eq('invite_token', token)
    .single();

  if (!data) return NextResponse.json({ valid: false, error: 'トークンが無効です' });
  if (data.accepted_at) return NextResponse.json({ valid: false, error: '既に承諾済みです' });
  if (data.invite_expires_at && new Date(data.invite_expires_at) < new Date()) {
    return NextResponse.json({ valid: false, error: '招待リンクの有効期限が切れています' });
  }

  const clientName = Array.isArray(data.clients)
    ? (data.clients[0] as { name?: string } | undefined)?.name ?? ''
    : (data.clients as { name?: string } | null)?.name ?? '';

  return NextResponse.json({
    valid: true,
    member_email: data.member_email,
    role: data.role,
    client_name: clientName,
  });
}

/**
 * POST /api/client-members/accept { token }
 *   要ログイン。承諾実行: member_user_id = auth.uid(), accepted_at = now()
 *   ログイン中のメールと招待先メールが一致しない場合は拒否。
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '承諾にはログインが必要です' }, { status: 401 });

  const body = await request.json();
  const token: string = (body.token ?? '').trim();
  if (!token) return NextResponse.json({ error: 'token が必要です' }, { status: 400 });

  const service = createServiceClient();
  const { data: member } = await service
    .from('client_members')
    .select('id, member_email, invite_expires_at, accepted_at')
    .eq('invite_token', token)
    .single();

  if (!member) return NextResponse.json({ error: 'トークンが無効です' }, { status: 400 });
  if (member.accepted_at) return NextResponse.json({ error: '既に承諾済みです' }, { status: 400 });
  if (member.invite_expires_at && new Date(member.invite_expires_at) < new Date()) {
    return NextResponse.json({ error: '招待リンクの有効期限が切れています' }, { status: 400 });
  }

  if ((user.email ?? '').toLowerCase() !== member.member_email.toLowerCase()) {
    return NextResponse.json({
      error: `招待先メール (${member.member_email}) と一致するアカウントでログインしてください`,
    }, { status: 403 });
  }

  const { error: upErr } = await service
    .from('client_members')
    .update({
      member_user_id: user.id,
      accepted_at: new Date().toISOString(),
      invite_token: null,
      invite_expires_at: null,
    })
    .eq('id', member.id);

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
