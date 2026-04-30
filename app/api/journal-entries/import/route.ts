import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import type { NormalizedJournalRow } from '@/lib/csv-import-presets';

export const maxDuration = 60;

/**
 * CSV インポートエンドポイント
 *
 * フロント側でパース済みの行配列を受け取り、journal_entries に挿入する。
 * 大容量CSVは Vercel の 4.5MB body 上限で 413 になるため、フロント側で
 * チャンク分割（最大2000件）して複数リクエストに分けて送る前提。
 *
 * body (JSON):
 *   rows: NormalizedJournalRow[]    — フロント側でパース済みの正規化行
 *   clientId: string | null         — 顧問先 ID
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const body = await request.json();
    const { rows, clientId } = body as {
      rows: NormalizedJournalRow[];
      clientId: string | null;
    };

    if (!Array.isArray(rows)) {
      return NextResponse.json({ error: 'rows は配列で指定してください' }, { status: 400 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ success: true, inserted: 0 });
    }

    if (rows.length > 2000) {
      return NextResponse.json({
        error: '1リクエストあたり最大2000件です。フロント側でチャンク分割してください',
      }, { status: 400 });
    }

    const service = createServiceClient();
    const insertRows = rows.map((r) => ({
      user_id: user.id,
      client_id: clientId || null,
      entry_type: 'manual' as const,
      entry_date: r.entry_date,
      debit_account: r.debit_account,
      credit_account: r.credit_account,
      amount: r.amount,
      description: r.description,
      tax_type: r.tax_type,
      vendor_name: r.vendor_name,
      match_status: 'imported',
    }));

    // Supabase の一括挿入上限に配慮し、500件ずつ分割
    const BATCH_SIZE = 500;
    let totalInserted = 0;
    for (let i = 0; i < insertRows.length; i += BATCH_SIZE) {
      const batch = insertRows.slice(i, i + BATCH_SIZE);
      const { error } = await service.from('journal_entries').insert(batch);
      if (error) {
        return NextResponse.json({
          error: `DB挿入エラー (${totalInserted}件挿入済み): ${error.message}`,
        }, { status: 500 });
      }
      totalInserted += batch.length;
    }

    return NextResponse.json({
      success: true,
      inserted: totalInserted,
    });
  } catch (error) {
    console.error('journal-entries/import エラー:', error);
    const message = error instanceof Error ? error.message : 'インポートに失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
