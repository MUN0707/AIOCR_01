/**
 * 文字列類似度ユーティリティ。
 *
 * マスタ画面の「あいまい重複候補」検出に使う。
 * 完全一致は normalized_key で先に弾かれているので、ここでは「綴り違い・揺れ」を拾う。
 */

/** Levenshtein 距離 (DP実装) */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const m = a.length;
  const n = b.length;
  // 1行ずつ DP
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // 削除
        curr[j - 1] + 1,    // 挿入
        prev[j - 1] + cost, // 置換
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** 文字列を正規化 (空白・括弧・記号類を除去して小文字化) */
export function normalizeForSimilarity(s: string): string {
  if (!s) return '';
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　・･\-_／/（）()「」『』【】\[\]・]/g, '')
    .toLowerCase()
    .trim();
}

export interface SimilarPair<T> {
  a: T;
  b: T;
  distance: number;
  /** 0〜1 で近いほど 1 (1 - distance/maxLen) */
  similarity: number;
}

/**
 * リスト内のあいまい重複ペアを抽出する。
 *
 * @param items 比較対象のレコード配列
 * @param getName name を返すアクセサ
 * @param options.maxDistance 最大編集距離 (デフォルト: 2)
 * @param options.minLen 比較対象とする最小文字数 (デフォルト: 3、それ以下は誤マッチが多い)
 * @param options.scopeKey 同一スコープでのみ比較する場合のキー取得関数 (例: client_id ごとに比較)
 * @param options.maxResults 返すペアの上限 (UI が重くならないため)
 */
export function findSimilarPairs<T>(
  items: T[],
  getName: (x: T) => string,
  options: {
    maxDistance?: number;
    minLen?: number;
    scopeKey?: (x: T) => string;
    maxResults?: number;
  } = {},
): SimilarPair<T>[] {
  const maxDistance = options.maxDistance ?? 2;
  const minLen = options.minLen ?? 3;
  const maxResults = options.maxResults ?? 50;

  // 正規化名を事前計算
  const normed: { item: T; norm: string; scope: string }[] = items.map((it) => ({
    item: it,
    norm: normalizeForSimilarity(getName(it)),
    scope: options.scopeKey ? options.scopeKey(it) : '',
  }));

  const pairs: SimilarPair<T>[] = [];
  for (let i = 0; i < normed.length; i++) {
    const A = normed[i];
    if (A.norm.length < minLen) continue;
    for (let j = i + 1; j < normed.length; j++) {
      const B = normed[j];
      if (B.norm.length < minLen) continue;
      if (A.scope !== B.scope) continue;
      // 長さが大きく違うペアは早期スキップ (距離が確実に超える)
      if (Math.abs(A.norm.length - B.norm.length) > maxDistance) continue;
      // 同名は完全一致扱いなので除外（既存マスタ側でユニーク制約）
      if (A.norm === B.norm) continue;
      const d = levenshtein(A.norm, B.norm);
      if (d > maxDistance) continue;
      const maxLen = Math.max(A.norm.length, B.norm.length);
      pairs.push({
        a: A.item,
        b: B.item,
        distance: d,
        similarity: maxLen === 0 ? 0 : 1 - d / maxLen,
      });
    }
  }

  // 距離小さい順、同距離なら片方の name 順
  pairs.sort((x, y) => x.distance - y.distance);
  return pairs.slice(0, maxResults);
}
