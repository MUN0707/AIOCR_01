import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { normalizeVendorKey } from '@/lib/vendor-normalize';
import { canWrite, listAccessibleClientIds, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

type PatternType = 'vendor' | 'description';

function normalizePattern(type: PatternType, raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (type === 'vendor') return normalizeVendorKey(t);
  // description: 大文字/全角スペース/末端空白を抑制
  return t
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .replace(/[　\s]/g, '')
    .toLowerCase();
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const service = createServiceClient();
  const accessible = await listAccessibleClientIds(service, user.id);
  if (accessible.length === 0) return NextResponse.json({ rules: [] });

  const { data, error } = await service
    .from('account_rules')
    .select('id, pattern_type, pattern, debit_account, created_at, client_id')
    .in('client_id', accessible)
    .order('pattern_type', { ascending: true })
    .order('pattern', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const pattern_type: PatternType = body.pattern_type === 'description' ? 'description' : 'vendor';
  const rawPattern: string = (body.pattern ?? '').trim();
  const debit_account: string = (body.debit_account ?? '').trim();
  const client_id: string | null = body.client_id ?? null;

  if (!rawPattern) return NextResponse.json({ error: 'パターンを入力してください' }, { status: 400 });
  if (!debit_account) return NextResponse.json({ error: '科目を指定してください' }, { status: 400 });
  if (!client_id) return NextResponse.json({ error: '会社を選択してください' }, { status: 400 });

  const normalized = normalizePattern(pattern_type, rawPattern);
  if (!normalized) return NextResponse.json({ error: 'パターンが空になります' }, { status: 400 });

  const service = createServiceClient();
  const scope = await resolveClientScope(service, user.id, client_id);
  if (!scope || !canWrite(scope.role)) {
    return NextResponse.json({ error: 'この会社への書き込み権限がありません' }, { status: 403 });
  }

  const { data: existing } = await service
    .from('account_rules')
    .select('id')
    .eq('user_id', scope.ownerUserId)
    .eq('pattern_type', pattern_type)
    .eq('pattern', normalized)
    .eq('client_id', client_id)
    .limit(1);

  const SELECT_COLS = 'id, pattern_type, pattern, debit_account, created_at';

  if (existing && existing.length > 0) {
    const { data, error } = await service
      .from('account_rules')
      .update({ debit_account })
      .eq('id', existing[0].id)
      .select(SELECT_COLS)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rule: data, updated: true });
  }

  const { data, error } = await service
    .from('account_rules')
    .insert({ user_id: scope.ownerUserId, client_id, pattern_type, pattern: normalized, debit_account })
    .select(SELECT_COLS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id が必要です' }, { status: 400 });

  const service = createServiceClient();
  const { data: rule } = await service
    .from('account_rules')
    .select('user_id, client_id')
    .eq('id', id)
    .single();
  if (!rule) return NextResponse.json({ error: 'ルールが見つかりません' }, { status: 404 });
  const scope = await resolveClientScope(service, user.id, rule.client_id);
  if (!scope || !canWrite(scope.role)) {
    return NextResponse.json({ error: '削除権限がありません' }, { status: 403 });
  }

  const { error } = await service
    .from('account_rules')
    .delete()
    .eq('id', id)
    .eq('user_id', scope.ownerUserId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
