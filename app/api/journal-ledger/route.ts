import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import type { MatchResult } from '@/lib/ocr/journal-matcher';

export const maxDuration = 30;

interface LedgerEntry {
  id: string;
  logId: string;
  logCreatedAt: string;
  entryType: 'accrual' | 'payment';
  date: string;
  debitAccount: string;
  creditAccount: string;
  amount: number | null;
  description: string;
  taxType: string;
  vendorName: string;
  matchStatus: string;
}

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
    let query = service
      .from('journal_match_logs')
      .select('id, created_at, client_id, results')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(500);

    if (clientId) {
      query = query.eq('client_id', clientId);
    } else {
      query = query.is('client_id', null);
    }

    const { data: logs, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const entries: LedgerEntry[] = [];
    for (const log of logs ?? []) {
      const results = (log.results ?? []) as MatchResult[];
      results.forEach((r, idx) => {
        const vendor = r.accrualEntry.voucher?.vendorName ?? '';
        entries.push({
          id: `${log.id}-${idx}-a`,
          logId: log.id,
          logCreatedAt: log.created_at,
          entryType: 'accrual',
          date: r.accrualEntry.date,
          debitAccount: r.accrualEntry.debitAccount,
          creditAccount: r.accrualEntry.creditAccount,
          amount: r.accrualEntry.amount,
          description: r.accrualEntry.description,
          taxType: r.accrualEntry.taxType,
          vendorName: vendor,
          matchStatus: r.accrualEntry.matchStatus,
        });
        if (r.paymentEntry) {
          entries.push({
            id: `${log.id}-${idx}-p`,
            logId: log.id,
            logCreatedAt: log.created_at,
            entryType: 'payment',
            date: r.paymentEntry.date,
            debitAccount: r.paymentEntry.debitAccount,
            creditAccount: r.paymentEntry.creditAccount,
            amount: r.paymentEntry.amount,
            description: r.paymentEntry.description,
            taxType: r.paymentEntry.taxType,
            vendorName: vendor,
            matchStatus: r.paymentEntry.matchStatus,
          });
        }
      });
    }

    // 日付昇順に並び替え（不明は末尾）
    entries.sort((a, b) => {
      if (a.date === '不明') return 1;
      if (b.date === '不明') return -1;
      return a.date.localeCompare(b.date);
    });

    return NextResponse.json({ entries });
  } catch (error) {
    console.error('日記帳取得エラー:', error);
    const message = error instanceof Error ? error.message : '日記帳の取得に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
