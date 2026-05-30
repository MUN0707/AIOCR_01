// 減価償却計算ユーティリティ
// straight_line / declining_balance (定率法: 取得日で 200%/250% 自動分岐) /
// declining_balance_old (旧定率法 H19.3.31 以前) / units_of_production (生産高比例法)
//
// 定率法の改定償却率・保証率について:
//   国税庁の償却率表（改定償却率・保証率）をハードコードする代わりに、税法上等価な
//   「定率償却額 ≤ 期首簿価 ÷ 残存年数 となった年から均等償却に切り替える」方式を採用。
//   これは『調整前償却額 < 償却保証額 となった年に改定取得価額×改定償却率へ切替』と同じ
//   償却スケジュールを生成する（改定償却率 ≒ 1/残存年数 のため）。最終年は備忘価額1円を残す。

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
  acquisition_date?: string | null; // YYYY-MM-DD（定率法の 200%/250% 判定に使用）
}

// 200%定率法（平成24年4月1日以降取得）の開始日
const DATE_200_FROM = new Date(2012, 3, 1); // 2012-04-01
// 250%定率法（平成19年4月1日〜平成24年3月31日取得）の開始日
const DATE_250_FROM = new Date(2007, 3, 1); // 2007-04-01

// 取得日から定率法の倍率（200% or 250%）を判定する。
// 取得日不明時は現行の 200% をデフォルトとする。
function decliningMultiplier(acquisitionDate?: string | null): number {
  if (!acquisitionDate) return 2.0;
  const d = new Date(acquisitionDate);
  if (isNaN(d.getTime())) return 2.0;
  if (d >= DATE_200_FROM) return 2.0;
  if (d >= DATE_250_FROM) return 2.5;
  // H19.3.31 以前は本来旧定率法だが、method が declining_balance の場合は 250% として扱う
  return 2.5;
}

// 定率法（新）の年次償却額スケジュールを 1..useful_life_years で返す（1オリジン、index 0 は未使用）。
// memoFloor を下回らないよう最終年で調整する。
function decliningSchedule(
  cost: number,
  usefulLife: number,
  multiplier: number,
  memoFloor: number
): number[] {
  const rate = multiplier / usefulLife;
  const amounts: number[] = new Array(usefulLife + 1).fill(0);
  let book = cost;
  let switched = false;
  let switchedAnnual = 0;

  for (let y = 1; y <= usefulLife; y++) {
    const remainingYears = usefulLife - y + 1;
    let amt: number;
    if (!switched) {
      const regular = Math.floor(book * rate);
      // 改定取得価額 × 改定償却率 と等価な均等償却額
      const even = Math.floor(book / remainingYears);
      if (regular <= even) {
        switched = true;
        switchedAnnual = even;
        amt = even;
      } else {
        amt = regular;
      }
    } else {
      amt = switchedAnnual;
    }
    // 備忘価額（または残存価額）を下回らないようキャップ
    if (book - amt < memoFloor) amt = book - memoFloor;
    if (amt < 0) amt = 0;
    amounts[y] = amt;
    book -= amt;
  }
  return amounts;
}

// 旧定率法（H19.3.31 以前取得）の年次償却額スケジュール。
// 残存価額 = 取得価額×10% を原則とし、5%（償却可能限度額）到達後は備忘価額1円まで均等償却。
function decliningOldSchedule(
  cost: number,
  usefulLife: number,
  residualValue: number
): number[] {
  const minResidual = Math.max(residualValue, cost * 0.1);
  const rate = 1 - Math.pow(minResidual / cost, 1 / usefulLife);
  const limit = cost * 0.05; // 償却可能限度額（取得価額の5%）
  const amounts: number[] = new Array(usefulLife + 1).fill(0);
  let book = cost;
  for (let y = 1; y <= usefulLife; y++) {
    let amt = Math.floor(book * rate);
    if (book - amt < limit) amt = Math.max(book - limit, 0);
    amounts[y] = amt;
    book -= amt;
  }
  return amounts;
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
  // 生産高比例法は生産量データが必要なため別経路で計算する（ここでは 0）
  if (method === 'units_of_production') return 0;

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
    // 取得日に応じて 200% / 250% を自動判定。残存は備忘価額1円（残存価額指定時はそれを優先）
    const multiplier = decliningMultiplier(asset.acquisition_date);
    const memoFloor = Math.max(residual_value, 1);
    const schedule = decliningSchedule(acquisition_cost, useful_life_years, multiplier, memoFloor);
    return Math.floor((schedule[yearIdx] ?? 0) / 12);
  }

  if (method === 'declining_balance_old') {
    const schedule = decliningOldSchedule(acquisition_cost, useful_life_years, residual_value);
    return Math.floor((schedule[yearIdx] ?? 0) / 12);
  }

  return 0;
}

// 生産高比例法の当期償却額
//   年額 = (取得価額 - 残存価額) × 当期生産量 / 総見込生産量
// 鉱業権・採掘用固定資産等で使用。総見込生産量が 0 や当期生産量が 0 の場合は 0。
export function unitsOfProductionAmount(
  acquisitionCost: number,
  residualValue: number,
  totalProduction: number,
  periodProduction: number
): number {
  if (totalProduction <= 0 || periodProduction <= 0) return 0;
  const depreciable = acquisitionCost - residualValue;
  if (depreciable <= 0) return 0;
  const amt = Math.floor((depreciable * periodProduction) / totalProduction);
  return Math.max(amt, 0);
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
