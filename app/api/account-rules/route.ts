import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { normalizeVendorKey } from '@/lib/vendor-normalize';

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
  const { data, error } = await service
    .from('account_rules')
    .select('id, pattern_type, pattern, debit_account, created_at')
    .eq('user_id', user.id)
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

  const normalized = normalizePattern(pattern_type, rawPattern);
  if (!normalized) return NextResponse.json({ error: 'パターンが空になります' }, { status: 400 });

  const service = createServiceClient();

  // account_rules の unique index は COALESCE(client_id::text, '') を含む式インデックスなので
  // PostgREST の onConflict には渡せない（"there is no unique or exclusion constraint matching the
  // ON CONFLICT specification" エラーになる）。SELECT → INSERT or UPDATE に分解する。
  let existingQuery = service
    .from('account_rules')
    .select('id')
    .eq('user_id', user.id)
    .eq('pattern_type', pattern_type)
    .eq('pattern', normalized)
    .limit(1);
  existingQuery = client_id
    ? existingQuery.eq('client_id', client_id)
    : existingQuery.is('client_id', null);

  const { data: existing } = await existingQuery;

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
    .insert({ user_id: user.id, client_id, pattern_type, pattern: normalized, debit_account })
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
  const { error } = await service
    .from('account_rules')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
