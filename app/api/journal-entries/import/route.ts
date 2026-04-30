import { NextRequest, NextResponse } from 'next/server';
import { gunzipSync } from 'zlib';
import { randomUUID } from 'crypto';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { CSV_PRESETS, parseCsvWithPreset, type NormalizedJournalRow } from '@/lib/csv-import-presets';
import { classifyAccount } from '@/lib/account-category-classifier';
import { normalizeVendorKey } from '@/lib/vendor-normalize';

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
 *   compressed: boolean               — gzip 圧縮済みか
 *   clientId: string | null           — 顧問先 ID（インポート先の会社）
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

    // ── 同じ voucher_no(=No列) ごとに uuid を発番して voucher_group_id にセット ──
    const voucherUuidMap = new Map<string, string>();
    const getVoucherGroupId = (no: string | null): string | null => {
      if (!no) return null;
      let uuid = voucherUuidMap.get(no);
      if (!uuid) {
        uuid = randomUUID();
        voucherUuidMap.set(no, uuid);
      }
      return uuid;
    };

    // ── 借方・貸方科目を集約して、未登録分を accounts に自動登録 ──
    const newAccountsCount = await ensureAccountsForRows(
      service, user.id, clientId ?? null, result.rows,
    );

    // ── 取引先名を集約して、未登録分を vendors に自動登録 ──
    const newVendorsCount = await ensureVendorsForRows(
      service, user.id, clientId ?? null, result.rows,
    );

    // ── insert 用に整形 ──
    const insertRows = result.rows.map((r) => ({
      user_id: user.id,
      client_id: clientId || null,
      entry_type: 'manual' as const,
      entry_date: r.entry_date,
      debit_account: r.debit_account,
      credit_account: r.credit_account,
      amount: r.amount,
      debit_amount: r.debit_amount,
      credit_amount: r.credit_amount,
      tax_amount: r.tax_amount,
      tax_rate: r.tax_rate || null,
      is_internal_tax: r.is_internal_tax,
      description: r.description,
      tax_type: r.tax_type,
      vendor_name: r.vendor_name,
      voucher_group_id: getVoucherGroupId(r.voucher_no),
      voucher_seq: r.voucher_seq,
      voucher_total_lines: r.voucher_total_lines,
      meta: r.meta,
      match_status: 'imported',
    }));

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

    await service.storage.from(STORAGE_BUCKET).remove([storagePath]);

    return NextResponse.json({
      success: true,
      inserted: totalInserted,
      skipped: result.skipped,
      newAccounts: newAccountsCount,
      newVendors: newVendorsCount,
      presetLabel: preset.label,
    });
  } catch (error) {
    console.error('journal-entries/import エラー:', error);
    const message = error instanceof Error ? error.message : 'インポートに失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── 勘定科目の自動登録 ────────────────────────────────────────────────────

async function ensureAccountsForRows(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  clientId: string | null,
  rows: NormalizedJournalRow[],
): Promise<number> {
  // 借方・貸方の科目名をユニークに集める
  const names = new Set<string>();
  for (const r of rows) {
    if (r.debit_account && r.debit_account !== '不明') names.add(r.debit_account);
    if (r.credit_account && r.credit_account !== '不明') names.add(r.credit_account);
  }
  if (names.size === 0) return 0;

  // 既存 accounts を取得（user_id + client_id スコープ）
  let existingQuery = service
    .from('accounts')
    .select('name')
    .eq('user_id', userId)
    .in('name', Array.from(names));
  existingQuery = clientId
    ? existingQuery.eq('client_id', clientId)
    : existingQuery.is('client_id', null);

  const { data: existing } = await existingQuery;
  const existingSet = new Set((existing ?? []).map((a) => a.name as string));

  // freee CSV のメタから "ショートカット１" を読みとして拾うため、各科目ごとに代表 row を保持
  const sampleRowByName = new Map<string, NormalizedJournalRow>();
  for (const r of rows) {
    if (r.debit_account && !sampleRowByName.has(r.debit_account)) {
      sampleRowByName.set(r.debit_account, r);
    }
    if (r.credit_account && !sampleRowByName.has(r.credit_account)) {
      sampleRowByName.set(r.credit_account, r);
    }
  }

  const toInsert = Array.from(names)
    .filter((n) => !existingSet.has(n))
    .map((name) => {
      const cls = classifyAccount(name);
      const sample = sampleRowByName.get(name);
      const reading = pickReadingFromMeta(name, sample?.meta) ?? '';
      return {
        user_id: userId,
        client_id: clientId,
        name,
        reading,
        category: cls.category,
        sub_category: cls.sub_category,
        auto_registered: true,
        confirmed: cls.category !== 'uncategorized',
      };
    });

  if (toInsert.length === 0) return 0;

  // ユニーク制約は COALESCE 式インデックスのため onConflict (列名) が通らない。
  // existingSet で重複除外済みなので素の insert で OK。
  const { error } = await service.from('accounts').insert(toInsert);

  if (error) {
    console.warn('accounts 自動登録 警告:', error.message);
    return 0;
  }
  return toInsert.length;
}

/** freee CSV の借方/貸方ショートカット１（ローマ字）を reading として採用 */
function pickReadingFromMeta(
  accountName: string,
  meta: Record<string, string> | null | undefined,
): string | null {
  if (!meta) return null;
  // 借方のショートカット１
  if (meta['借方勘定科目'] === accountName) {
    const r = meta['借方勘定科目ショートカット１'];
    if (r && /^[A-Za-z]/.test(r)) return r.toLowerCase();
  }
  if (meta['貸方勘定科目'] === accountName) {
    const r = meta['貸方勘定科目ショートカット１'];
    if (r && /^[A-Za-z]/.test(r)) return r.toLowerCase();
  }
  return null;
}

// ─── 取引先の自動登録 ────────────────────────────────────────────────────

async function ensureVendorsForRows(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  clientId: string | null,
  rows: NormalizedJournalRow[],
): Promise<number> {
  const namesByKey = new Map<string, string>(); // normalized_key -> 元の名前 (代表)
  for (const r of rows) {
    const name = r.vendor_name?.trim();
    if (!name) continue;
    const key = normalizeVendorKey(name);
    if (!key) continue;
    if (!namesByKey.has(key)) namesByKey.set(key, name);
  }
  if (namesByKey.size === 0) return 0;

  let existingQuery = service
    .from('vendors')
    .select('normalized_key')
    .eq('user_id', userId)
    .in('normalized_key', Array.from(namesByKey.keys()));
  existingQuery = clientId
    ? existingQuery.eq('client_id', clientId)
    : existingQuery.is('client_id', null);

  const { data: existing } = await existingQuery;
  const existingKeys = new Set((existing ?? []).map((v) => v.normalized_key as string));

  const toInsert = Array.from(namesByKey.entries())
    .filter(([key]) => !existingKeys.has(key))
    .map(([normalized_key, name]) => ({
      user_id: userId,
      client_id: clientId,
      name,
      normalized_key,
      reading: '',
    }));

  if (toInsert.length === 0) return 0;

  const { error } = await service.from('vendors').insert(toInsert);

  if (error) {
    console.warn('vendors 自動登録 警告:', error.message);
    return 0;
  }
  return toInsert.length;
}
