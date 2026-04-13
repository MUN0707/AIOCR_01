import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 15;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'IDが空です' }, { status: 400 });
  }
  if (ids.length > 500) {
    return NextResponse.json({ error: '一度に削除できるのは500件までです' }, { status: 400 });
  }

  const service = createServiceClient();

  // 対象エントリを取得し、所有権 + 締めロック確認
  const { data: targets, error: fetchError } = await service
    .from('journal_entries')
    .select('id, client_id, entry_date')
    .in('id', ids)
    .eq('user_id', user.id);

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!targets || targets.length === 0) {
    return NextResponse.json({ error: '削除対象が見つかりません' }, { status: 404 });
  }

  // 締め日マップ取得（client_id ごと）
  const clientIds = Array.from(new Set(targets.map((t) => t.client_id).filter(Boolean) as string[]));
  const { data: closings } = await service
    .from('journal_closings')
    .select('client_id, closed_until')
    .eq('user_id', user.id);

  const closedMap = new Map<string | null, string>();
  for (const c of closings ?? []) {
    closedMap.set(c.client_id ?? null, c.closed_until);
  }

  // ロック対象を除外
  const allowedIds: string[] = [];
  const blockedIds: string[] = [];
  for (const t of targets) {
    const key: string | null = t.client_id ?? null;
    const closedUntil = closedMap.get(key);
    if (closedUntil && t.entry_date !== '不明' && t.entry_date <= closedUntil) {
      blockedIds.push(t.id);
    } else {
      allowedIds.push(t.id);
    }
  }
  void clientIds;

  if (allowedIds.length === 0) {
    return NextResponse.json({ error: 'すべて締め済みのため削除できません' }, { status: 403 });
  }

  const { error: deleteError } = await service
    .from('journal_entries')
    .delete()
    .in('id', allowedIds)
    .eq('user_id', user.id);

  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    deleted: allowedIds.length,
    skipped: blockedIds.length,
  });
}
