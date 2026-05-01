import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 30;

interface LedgerEntryRow {
  id: string;
  entry_date: string | null;
  // 他の列は jsonb で透過的に返す
  [k: string]: unknown;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');
    const startDate = (searchParams.get('startDate') ?? '').trim();
    const endDate = (searchParams.get('endDate') ?? '').trim();
    const accountFilter = (searchParams.get('account') ?? '').trim();
    const searchDebit = (searchParams.get('searchDebit') ?? '').trim();
    const searchCredit = (searchParams.get('searchCredit') ?? '').trim();
    const searchAmount = (searchParams.get('searchAmount') ?? '').trim();
    const searchDate = (searchParams.get('searchDate') ?? '').trim();
    const searchDescription = (searchParams.get('searchDescription') ?? '').trim();
    const limitParam = Number(searchParams.get('limit') ?? '50');
    // 50 〜 100000 にクランプ。100000 はほぼ「全件」CSVエクスポート用
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.floor(limitParam), 1), 100000) : 50;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const service = createServiceClient();

    const { data: rpcRows, error: rpcError } = await service.rpc('fetch_journal_ledger', {
      p_user_id: user.id,
      p_client_id: clientId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_account_filter: accountFilter,
      p_search_debit: searchDebit,
      p_search_credit: searchCredit,
      p_search_amount: searchAmount,
      p_search_date: searchDate,
      p_search_description: searchDescription,
      p_limit: limit,
    });
    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    const row = (rpcRows ?? [])[0] ?? { entries: [], filtered_count: 0, total_count: 0, closed_until: null };
    const entries: LedgerEntryRow[] = Array.isArray(row.entries) ? row.entries as LedgerEntryRow[] : [];
    const closedUntil: string | null = row.closed_until ?? null;
    const filteredCount = Number(row.filtered_count) || 0;
    const totalCount = Number(row.total_count) || 0;

    // locked フラグを付与（既存の API と同じ加工）
    const entriesWithLock = entries.map((e) => ({
      ...e,
      locked: closedUntil && e.entry_date && e.entry_date !== '不明' ? e.entry_date <= closedUntil : false,
    }));

    return NextResponse.json({
      entries: entriesWithLock,
      closedUntil,
      filteredCount,
      totalCount,
    });
  } catch (error) {
    console.error('日記帳取得エラー:', error);
    const message = error instanceof Error ? error.message : '日記帳の取得に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
