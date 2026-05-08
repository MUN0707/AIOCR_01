import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 15;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const action: 'approved' | 'rejected' | 'draft' | 'pending' = body.action ?? 'approved';
  const validStatuses = ['draft', 'pending', 'approved', 'rejected'];
  if (!validStatuses.includes(action)) {
    return NextResponse.json({ error: '無効なステータスです' }, { status: 400 });
  }

  const service = createServiceClient();

  // 所有権確認 + 現在の状態取得（監査ログ用）
  const { data: existing, error: fetchError } = await service
    .from('journal_entries')
    .select('approval_status, client_id, entry_date, debit_account, credit_account, amount')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: '仕訳が見つかりません' }, { status: 404 });
  }

  const { error: updateError } = await service
    .from('journal_entries')
    .update({ approval_status: action, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  // 監査ログ
  await service.from('journal_audit_logs').insert({
    user_id: user.id,
    entry_id: id,
    client_id: existing.client_id,
    action: 'updated',
    before_data: { approval_status: existing.approval_status },
    after_data: { approval_status: action },
  });

  return NextResponse.json({ success: true, approval_status: action });
}
