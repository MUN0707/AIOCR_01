import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// 締め日より前のエントリは編集不可
async function assertNotLocked(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  clientId: string | null,
  entryDate: string
): Promise<string | null> {
  let q = service.from('journal_closings').select('closed_until').eq('user_id', userId);
  if (clientId) q = q.eq('client_id', clientId);
  else q = q.is('client_id', null);
  const { data } = await q.limit(1);
  const closedUntil = data?.[0]?.closed_until;
  if (closedUntil && entryDate !== '不明' && entryDate <= closedUntil) {
    return `${closedUntil} までは締め済みのため修正できません`;
  }
  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const service = createServiceClient();

  // 対象エントリ取得（id で取得し、client_id 経由で権限判定）
  const { data: existing, error: fetchError } = await service
    .from('journal_entries')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: '該当の仕訳が見つかりません' }, { status: 404 });
  }

  // 権限解決: client 指定があれば member 含めてアクセス確認、無ければ owner 本人として処理
  let ownerUserId = user.id;
  if (existing.client_id) {
    const scope = await resolveClientScope(service, user.id, existing.client_id);
    if (!scope || !canWrite(scope.role)) {
      return NextResponse.json({ error: 'この仕訳の書き込み権限がありません' }, { status: 403 });
    }
    ownerUserId = scope.ownerUserId;
  } else {
    if (existing.user_id !== user.id) {
      return NextResponse.json({ error: '該当の仕訳が見つかりません' }, { status: 404 });
    }
  }

  // 既存エントリの日付で締めチェック
  const existingLockError = await assertNotLocked(service, ownerUserId, existing.client_id, existing.entry_date);
  if (existingLockError) {
    return NextResponse.json({ error: existingLockError }, { status: 403 });
  }
  // 新しい日付で再度チェック（締め期間に移動しようとする場合も禁止）
  if (body.entry_date) {
    const newLockError = await assertNotLocked(service, ownerUserId, existing.client_id, body.entry_date);
    if (newLockError) {
      return NextResponse.json({ error: newLockError }, { status: 403 });
    }
  }

  const allowed = [
    'entry_date', 'debit_account', 'credit_account', 'amount',
    'debit_amount', 'credit_amount',
    'description', 'tax_type', 'tax_category', 'vendor_name',
    'ocr_upload_id', 'bank_ocr_upload_id', 'department_id', 'approval_status',
  ] as const;
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }

  const { error: updateError } = await service
    .from('journal_entries')
    .update(update)
    .eq('id', id)
    .eq('user_id', ownerUserId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // 監査ログは journal_entries の AFTER UPDATE トリガで自動記録される
  // (migration: journal_entries_audit_trigger)
  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const service = createServiceClient();

  const { data: existing, error: fetchError } = await service
    .from('journal_entries')
    .select('user_id, client_id, entry_date, debit_account, credit_account, amount, description')
    .eq('id', id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: '該当の仕訳が見つかりません' }, { status: 404 });
  }

  let ownerUserId = user.id;
  if (existing.client_id) {
    const scope = await resolveClientScope(service, user.id, existing.client_id);
    if (!scope || !canWrite(scope.role)) {
      return NextResponse.json({ error: 'この仕訳の削除権限がありません' }, { status: 403 });
    }
    ownerUserId = scope.ownerUserId;
  } else {
    if (existing.user_id !== user.id) {
      return NextResponse.json({ error: '該当の仕訳が見つかりません' }, { status: 404 });
    }
  }

  const lockError = await assertNotLocked(service, ownerUserId, existing.client_id, existing.entry_date);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }

  const { error: deleteError } = await service
    .from('journal_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', ownerUserId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  // 監査ログは journal_entries の AFTER DELETE トリガで自動記録される
  return NextResponse.json({ success: true });
}
