/**
 * 少額減価償却資産（中小企業者等の特例）の案内ヘルパー。
 *
 * 取得価額が30万円未満なら、固定資産として計上せず
 * 「少額減価償却資産」として全額その期の費用にできる場合がある。
 * 税務知識のないユーザー向けに、固定資産系科目を選んだときに案内を出す。
 */

import { classifyAccount } from './account-category-classifier';

/** 「少額減価償却資産特例」の上限（中小企業者等、年300万円まで） */
export const SMALL_ASSET_THRESHOLD = 300_000;

/**
 * 勘定科目名が「固定資産系（資産・固定資産サブカテゴリ）」かどうかを判定する。
 * マスタ（accountsList）の sub_category を優先し、なければ簡易分類器でフォールバック。
 */
export function isFixedAssetAccountName(
  name: string | null | undefined,
  metaSubCategory?: string | null,
): boolean {
  if (!name) return false;
  if (metaSubCategory === '固定資産') return true;
  // マスタに sub_category が明示されている場合（'固定資産'以外）はそれを尊重
  if (metaSubCategory) return false;
  return classifyAccount(name).sub_category === '固定資産';
}

/** 金額が「少額資産案内を出すべき範囲」（0より大きく30万円未満）かを判定 */
export function isSmallAssetAmount(amount: number | null | undefined): boolean {
  if (amount == null) return false;
  return amount > 0 && amount < SMALL_ASSET_THRESHOLD;
}

/** 仕訳行・固定資産登録フォーム共通で表示する案内文（短縮版） */
export const SMALL_ASSET_ADVICE_SHORT = '💡 30万円未満は少額減価償却資産で全額損金にできる場合があります（中小企業者等の特例・年300万円まで）';

/** ヒントツールチップ用の補足説明 */
export const SMALL_ASSET_ADVICE_DETAIL =
  '取得価額が30万円未満なら、資産計上せず「消耗品費」など費用科目で処理して全額その期の損金にできる選択肢があります（青色申告中小企業者等の特例、年合計300万円まで）。法人税対策として有効ですが、適用要件は税理士にご確認ください。';
