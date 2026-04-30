import { NextRequest, NextResponse } from 'next/server';
import { gunzipSync } from 'zlib';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { CSV_PRESETS, parseCsvWithPreset } from '@/lib/csv-import-presets';

export const maxDuration = 60;

const STORAGE_BUCKET = 'error-screenshots';

/**
 * CSV インポートエンドポイント
 *
 * 大容量CSVを Vercel の 4.5MB body 上限で 413 にしないため、
 * フロント側で gzip 圧縮 → Storage に直接アップロード → ここには storagePath だけ渡す方式。
 *
 * body (JSON):
 *   presetId: string                  — 'yayoi' | 'freee' | 'moneyforward'
 *   storagePath: string               — error-screenshots バケット内のパス（${userId}/...）
 *   compressed: boolean               — gzip 圧縮済みか（クライアントで CompressionStream('gzip') 使用時 true）
 *   clientId: string | null           — 顧問先 ID
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const body = await request.json();
    const { presetId, storagePath, compressed, clientId } = body as {
      presetId: string;
      storagePath: string;
      compressed?: boolean;
      clientId: string | null;
    };

    if (!presetId || !storagePath) {
      return NextResponse.json({ error: 'presetId と storagePath は必須です' }, { status: 400 });
    }

    if (!storagePath.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: 'パスが不正です' }, { status: 400 });
    }

    const preset = CSV_PRESETS.find((p) => p.id === presetId);
    if (!preset) {
      return NextResponse.json({ error: `不明な会計ソフト: ${presetId}` }, { status: 400 });
    }

    const service = createServiceClient();

    // Storage から CSV を取得
    const { data: blob, error: downloadError } = await service.storage
      .from(STORAGE_BUCKET)
      .download(storagePath);
    if (downloadError || !blob) {
      return NextResponse.json({
        error: `CSV取得失敗: ${downloadError?.message ?? '不明'}`,
      }, { status: 500 });
    }

    let buffer = Buffer.from(await blob.arrayBuffer());
    if (compressed) {
      try {
        buffer = gunzipSync(buffer);
      } catch (e) {
        return NextResponse.json({
          error: `gzip解凍失敗: ${e instanceof Error ? e.message : '不明'}`,
        }, { status: 400 });
      }
    }

    // プリセットのエンコーディング指定でデコード
    const decoderLabel = preset.encoding === 'shift_jis' ? 'shift-jis' : 'utf-8';
    let csvText: string;
    try {
      csvText = new TextDecoder(decoderLabel).decode(buffer);
    } catch (e) {
      return NextResponse.json({
        error: `CSVデコード失敗 (${decoderLabel}): ${e instanceof Error ? e.message : '不明'}`,
      }, { status: 400 });
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

    // 取り込み成功後はアップロードCSVを削除（Storage節約）
    await service.storage.from(STORAGE_BUCKET).remove([storagePath]);

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
