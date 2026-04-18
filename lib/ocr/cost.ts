// Claude API トークン使用量とコスト計算
// 価格: claude-sonnet-4-6 input $3/MTok, output $15/MTok
// 1 USD = 150円 換算（概算用）

const INPUT_USD_PER_MTOK = 3;
const OUTPUT_USD_PER_MTOK = 15;
const USD_TO_JPY = 150;

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  costJpy: number;
}

export function calcCost(inputTokens: number, outputTokens: number): UsageInfo {
  const costUsd =
    (inputTokens / 1_000_000) * INPUT_USD_PER_MTOK +
    (outputTokens / 1_000_000) * OUTPUT_USD_PER_MTOK;
  return {
    inputTokens,
    outputTokens,
    costJpy: Math.round(costUsd * USD_TO_JPY * 100) / 100,
  };
}
