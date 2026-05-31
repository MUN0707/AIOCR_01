/**
 * 仕訳日付の正規化
 * YYYY-MM-DD / YYYY/MM/DD / YYYYMMDD などを受け取り、DB 保存形式の YYYYMMDD に揃える。
 * 不正な値（型違い・桁数違い・範囲外）は null を返す。
 */
export function normalizeDate(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/[-/]/g, '');
  if (!/^\d{8}$/.test(digits)) return null;
  const y = Number(digits.slice(0, 4));
  const m = Number(digits.slice(4, 6));
  const d = Number(digits.slice(6, 8));
  if (y < 1900 || y > 2999) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  return digits;
}
