import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { CSV_PRESETS, parseCsvWithPreset, parseCsvLine } from '@/lib/csv-import-presets';

export const maxDuration = 30;

/**
 * CSV インポートエンドポイント
 *
 * body (JSON):
 *   presetId: string          — 会計ソフト ID ('yayoi' | 'freee' | 'moneyforward')
 *   csvText: string           — CSV テキスト（フロント側でエンコード変換済み）
 *   clientId: string | null   — 顧問先 ID
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const body = await request.json();
    const { presetId, csvText, clientId } = body as {
      presetId: string;
      csvText: string;
      clientId: string | null;
    };

    if (!presetId || !csvText) {
      return NextResponse.json({ error: 'presetId と csvText は必須です' }, { status: 400 });
    }

    const preset = CSV_PRESETS.find((p) => p.id === presetId);
    if (!preset) {
      return NextResponse.json({ error: `不明な会計ソフト: ${presetId}` }, { status: 400 });
    }

    const result = parseCsvWithPreset(csvText, preset);

    if (result.errors.length > 0) {
      return NextResponse.json({
        error: `CSV解析エラー: ${result.errors.join(', ')}`,
        headers: result.headers,
      }, { status: 400 });
    }

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'インポート可能な仕訳データがありません' }, { status: 400 });
    }

    // journal_entries に一括挿入
    const service = createServiceClient();
    const insertRows = result.rows.map((r) => ({
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
      skipped: result.skipped,
      presetLabel: preset.label,
    });
  } catch (error) {
    console.error('journal-entries/import エラー:', error);
    const message = error instanceof Error ? error.message : 'インポートに失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
