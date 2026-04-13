import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const service = createServiceClient();

    // エントリ取得
    let entryQuery = service
      .from('journal_entries')
      .select('*')
      .eq('user_id', user.id)
      .order('entry_date', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(5000);

    if (clientId) {
      entryQuery = entryQuery.eq('client_id', clientId);
    } else {
      entryQuery = entryQuery.is('client_id', null);
    }

    const { data: entries, error: entriesError } = await entryQuery;
    if (entriesError) {
      return NextResponse.json({ error: entriesError.message }, { status: 500 });
    }

    // 締め設定取得
    let closingQuery = service
      .from('journal_closings')
      .select('closed_until')
      .eq('user_id', user.id);
    if (clientId) {
      closingQuery = closingQuery.eq('client_id', clientId);
    } else {
      closingQuery = closingQuery.is('client_id', null);
    }
    const { data: closingRows } = await closingQuery;
    const closedUntil: string | null = closingRows?.[0]?.closed_until ?? null;

    // locked フラグを付与（entry_date <= closed_until なら true）
    const entriesWithLock = (entries ?? []).map((e) => ({
      ...e,
      locked: closedUntil && e.entry_date !== '不明' ? e.entry_date <= closedUntil : false,
    }));

    return NextResponse.json({ entries: entriesWithLock, closedUntil });
  } catch (error) {
    console.error('日記帳取得エラー:', error);
    const message = error instanceof Error ? error.message : '日記帳の取得に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
