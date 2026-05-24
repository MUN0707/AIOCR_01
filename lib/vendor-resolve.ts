/**
 * vendor 解決ヘルパー
 *
 * vendor_name の生文字列を受け取り、vendors マスタを引いて
 * - 既存があれば: { vendorId, canonicalName } を返す
 * - 無ければ: 新規 insert して { vendorId, canonicalName } を返す
 *
 * journal_entries の vendor_id を埋める全 insert サイトから呼ぶ。
 *
 * normalized_key は vendor-normalize.ts と同じロジックで算出する。
 * unique は (user_id, client_id, normalized_key)。client_id は NOT NULL。
 * clientId が null の場合は解決をスキップし vendorId=null を返す。
 */

import { normalizeVendorKey } from '@/lib/vendor-normalize';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface VendorResolveResult {
  vendorId: string | null;
  canonicalName: string;
}

/**
 * 単発解決。複数回呼ぶ場合は resolveVendorsBatch を使うこと（DBクエリ削減）。
 */
export async function resolveVendor(
  service: SupabaseClient,
  userId: string,
  clientId: string | null,
  rawName: string | null | undefined,
): Promise<VendorResolveResult> {
  const trimmed = (rawName ?? '').trim();
  if (!trimmed) return { vendorId: null, canonicalName: '' };
  const key = normalizeVendorKey(trimmed);
  if (!key) return { vendorId: null, canonicalName: trimmed };
  if (!clientId) return { vendorId: null, canonicalName: trimmed };

  const { data: existing } = await service
    .from('vendors')
    .select('id, name')
    .eq('user_id', userId)
    .eq('normalized_key', key)
    .eq('client_id', clientId)
    .limit(1);
  if (existing && existing.length > 0) {
    return { vendorId: existing[0].id, canonicalName: existing[0].name };
  }

  // insert（race condition で 23505 が出ても致命でないので握り潰し→再 select）
  const { data: inserted, error: insertError } = await service
    .from('vendors')
    .insert({ user_id: userId, client_id: clientId, name: trimmed, normalized_key: key })
    .select('id, name')
    .single();

  if (!insertError && inserted) {
    return { vendorId: inserted.id, canonicalName: inserted.name };
  }

  // 競合時は再 select
  const { data: retryRow } = await service
    .from('vendors')
    .select('id, name')
    .eq('user_id', userId)
    .eq('normalized_key', key)
    .eq('client_id', clientId)
    .limit(1);
  if (retryRow && retryRow.length > 0) {
    return { vendorId: retryRow[0].id, canonicalName: retryRow[0].name };
  }
  return { vendorId: null, canonicalName: trimmed };
}

/**
 * バッチ解決。多数の名前を 1 回の SELECT で解決し、無い分だけ insert。
 * 多明細・大量取り込みで vendor 解決のラウンドトリップを抑える。
 *
 * 戻り値は入力 names と同じ順序の配列。空文字は { vendorId: null, canonicalName: '' }。
 */
export async function resolveVendorsBatch(
  service: SupabaseClient,
  userId: string,
  clientId: string | null,
  rawNames: (string | null | undefined)[],
): Promise<VendorResolveResult[]> {
  if (rawNames.length === 0) return [];

  // 正規化キー → 元の代表名（最初に出てきた表記）
  const keyToRepresentative = new Map<string, string>();
  const inputKeys: (string | null)[] = rawNames.map((raw) => {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return null;
    const key = normalizeVendorKey(trimmed);
    if (!key) return null;
    if (!keyToRepresentative.has(key)) keyToRepresentative.set(key, trimmed);
    return key;
  });

  const uniqueKeys = [...keyToRepresentative.keys()];
  if (uniqueKeys.length === 0) {
    return rawNames.map((raw) => ({ vendorId: null, canonicalName: (raw ?? '').trim() }));
  }

  // clientId 無しは vendor 解決不可
  if (!clientId) {
    return rawNames.map((raw) => ({ vendorId: null, canonicalName: (raw ?? '').trim() }));
  }

  // 既存 vendor を一括取得
  const { data: existing } = await service
    .from('vendors')
    .select('id, name, normalized_key')
    .eq('user_id', userId)
    .eq('client_id', clientId)
    .in('normalized_key', uniqueKeys);

  const keyToResolved = new Map<string, { id: string; name: string }>();
  for (const v of existing ?? []) {
    keyToResolved.set(v.normalized_key, { id: v.id, name: v.name });
  }

  // 不足分を insert
  const missingKeys = uniqueKeys.filter((k) => !keyToResolved.has(k));
  if (missingKeys.length > 0) {
    const insertRows = missingKeys.map((k) => ({
      user_id: userId,
      client_id: clientId,
      name: keyToRepresentative.get(k)!,
      normalized_key: k,
    }));
    const { data: insertedRows, error: insertError } = await service
      .from('vendors')
      .insert(insertRows)
      .select('id, name, normalized_key');

    if (!insertError && insertedRows) {
      for (const v of insertedRows) {
        keyToResolved.set(v.normalized_key, { id: v.id, name: v.name });
      }
    } else {
      // 競合時は再 select でカバー
      const { data: retryRows } = await service
        .from('vendors')
        .select('id, name, normalized_key')
        .eq('user_id', userId)
        .eq('client_id', clientId)
        .in('normalized_key', missingKeys);
      for (const v of retryRows ?? []) {
        keyToResolved.set(v.normalized_key, { id: v.id, name: v.name });
      }
    }
  }

  // 入力順にマップして返す
  return rawNames.map((raw, i) => {
    const trimmed = (raw ?? '').trim();
    const key = inputKeys[i];
    if (!key || !trimmed) {
      return { vendorId: null, canonicalName: trimmed };
    }
    const resolved = keyToResolved.get(key);
    if (resolved) return { vendorId: resolved.id, canonicalName: resolved.name };
    return { vendorId: null, canonicalName: trimmed };
  });
}
