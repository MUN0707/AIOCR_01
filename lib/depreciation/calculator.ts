// 減価償却計算ユーティリティ
// straight_line / declining_balance (新200%定率) / declining_balance_old (旧定率法)
// 生産高比例法 (units_of_production) は未対応 → project_todo_depreciation_units.md 参照

export type DepreciationMethod =
  | 'straight_line'
  | 'declining_balance'
  | 'declining_balance_old'
  | 'units_of_production';

export interface AssetForCalc {
  acquisition_cost: number;
  residual_value: number;
  useful_life_years: number;
  method: DepreciationMethod;
  depreciation_start_date: string; // YYYY-MM-DD
}

// 月次の償却額を返す（その月に計上すべき金額）
// depStart 以降の各月末時点での期首簿価ベースで計算
// 年度は depStart 開始から 12 ヶ月単位で区切る
export function monthlyDepreciation(
  asset: AssetForCalc,
  targetYear: number,
  targetMonth: number // 1-12
): number {
  const { acquisition_cost, residual_value, useful_life_years, method } = asset;
  if (!useful_life_years || useful_life_years <= 0) return 0;
  if (acquisition_cost <= residual_value) return 0;

  const depStart = new Date(asset.depreciation_start_date);
  const target = new Date(targetYear, targetMonth - 1, 1);
  if (target < new Date(depStart.getFullYear(), depStart.getMonth(), 1)) return 0;

  // 償却開始月から target 月までの通算月数（1オリジン）
  const monthsFromStart =
    (targetYear - depStart.getFullYear()) * 12 + (targetMonth - (depStart.getMonth() + 1)) + 1;
  if (monthsFromStart <= 0) return 0;
  if (monthsFromStart > useful_life_years * 12) return 0;

  // 何年目か (1オリジン)
  const yearIdx = Math.ceil(monthsFromStart / 12);

  if (method === 'straight_line') {
    const annual = Math.floor((acquisition_cost - residual_value) / useful_life_years);
    return Math.floor(annual / 12);
  }

  if (method === 'declining_balance') {
    // 新定率法 (200%): 償却率 = 2 / 耐用年数
    const rate = 2 / useful_life_years;
    let book = acquisition_cost;
    for (let y = 1; y < yearIdx; y++) {
      const yearly = Math.floor(book * rate);
      book -= yearly;
      if (book <= residual_value) return 0;
    }
    const yearly = Math.floor(book * rate);
    if (book - yearly < residual_value) {
      const capped = Math.max(book - residual_value, 0);
      return Math.floor(capped / 12);
    }
    return Math.floor(yearly / 12);
  }

  if (method === 'declining_balance_old') {
    // 旧定率法: 残存価額 = 取得価額 × 10% が原則
    // 償却率 = 1 - (残存価額/取得価額)^(1/耐用年数)
    const minResidual = Math.max(residual_value, acquisition_cost * 0.1);
    const rate = 1 - Math.pow(minResidual / acquisition_cost, 1 / useful_life_years);
    let book = acquisition_cost;
    for (let y = 1; y < yearIdx; y++) {
      const yearly = Math.floor(book * rate);
      book -= yearly;
      if (book <= minResidual) return 0;
    }
    const yearly = Math.floor(book * rate);
    if (book - yearly < minResidual) {
      const capped = Math.max(book - minResidual, 0);
      return Math.floor(capped / 12);
    }
    return Math.floor(yearly / 12);
  }

  return 0;
}

// 期間 [periodStart, periodEnd] 内で asset に発生する償却を月ごとに列挙
export function enumerateMonthly(
  asset: AssetForCalc,
  periodStart: Date,
  periodEnd: Date
): Array<{ year: number; month: number; lastDay: Date; amount: number }> {
  const result: Array<{ year: number; month: number; lastDay: Date; amount: number }> = [];
  const depStart = new Date(asset.depreciation_start_date);
  const cursor = new Date(Math.max(depStart.getTime(), periodStart.getTime()));
  cursor.setDate(1);
  while (cursor <= periodEnd) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth() + 1;
    const lastDay = new Date(y, m, 0);
    if (lastDay > periodEnd) break;
    const amt = monthlyDepreciation(asset, y, m);
    if (amt > 0) result.push({ year: y, month: m, lastDay, amount: amt });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return result;
}

// 期間 [periodStart, periodEnd] 内の理論償却額合計
export function theoreticalInPeriod(
  asset: AssetForCalc,
  periodStart: Date,
  periodEnd: Date
): number {
  const months = enumerateMonthly(asset, periodStart, periodEnd);
  return months.reduce((s, r) => s + r.amount, 0);
}
