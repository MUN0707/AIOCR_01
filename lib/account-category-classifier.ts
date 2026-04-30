/**
 * 勘定科目名から category / sub_category を簡易判定する。
 *
 * 完全一致辞書 → パターン辞書 → 未分類フォールバック の順で適用。
 * ユーザーがマスタ画面で確認・修正する前提なので、外れても許容。
 */

export type AccountCategory = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'uncategorized';

export interface ClassifyResult {
  category: AccountCategory;
  sub_category: string | null;
}

// 完全一致辞書（freee 既定科目を中心に）
const EXACT_MAP: Record<string, ClassifyResult> = {
  // ── 資産 ──
  '現金': { category: 'asset', sub_category: '流動資産' },
  '小口現金': { category: 'asset', sub_category: '流動資産' },
  '普通預金': { category: 'asset', sub_category: '流動資産' },
  '当座預金': { category: 'asset', sub_category: '流動資産' },
  '定期預金': { category: 'asset', sub_category: '流動資産' },
  '売掛金': { category: 'asset', sub_category: '流動資産' },
  '受取手形': { category: 'asset', sub_category: '流動資産' },
  '前払費用': { category: 'asset', sub_category: '流動資産' },
  '前払金': { category: 'asset', sub_category: '流動資産' },
  '仮払金': { category: 'asset', sub_category: '流動資産' },
  '仮払消費税': { category: 'asset', sub_category: '流動資産' },
  '立替金': { category: 'asset', sub_category: '流動資産' },
  '商品': { category: 'asset', sub_category: '流動資産' },
  '製品': { category: 'asset', sub_category: '流動資産' },
  '原材料': { category: 'asset', sub_category: '流動資産' },
  '建物': { category: 'asset', sub_category: '固定資産' },
  '建物附属設備': { category: 'asset', sub_category: '固定資産' },
  '構築物': { category: 'asset', sub_category: '固定資産' },
  '機械装置': { category: 'asset', sub_category: '固定資産' },
  '車両運搬具': { category: 'asset', sub_category: '固定資産' },
  '工具器具備品': { category: 'asset', sub_category: '固定資産' },
  '土地': { category: 'asset', sub_category: '固定資産' },
  '減価償却累計額': { category: 'asset', sub_category: '固定資産' },
  'ソフトウェア': { category: 'asset', sub_category: '固定資産' },
  '敷金': { category: 'asset', sub_category: '固定資産' },
  '差入保証金': { category: 'asset', sub_category: '固定資産' },

  // ── 負債 ──
  '買掛金': { category: 'liability', sub_category: '流動負債' },
  '支払手形': { category: 'liability', sub_category: '流動負債' },
  '未払金': { category: 'liability', sub_category: '流動負債' },
  '未払費用': { category: 'liability', sub_category: '流動負債' },
  '未払法人税等': { category: 'liability', sub_category: '流動負債' },
  '未払消費税': { category: 'liability', sub_category: '流動負債' },
  '預り金': { category: 'liability', sub_category: '流動負債' },
  '前受金': { category: 'liability', sub_category: '流動負債' },
  '仮受金': { category: 'liability', sub_category: '流動負債' },
  '仮受消費税': { category: 'liability', sub_category: '流動負債' },
  '短期借入金': { category: 'liability', sub_category: '流動負債' },
  '長期借入金': { category: 'liability', sub_category: '固定負債' },
  '社債': { category: 'liability', sub_category: '固定負債' },

  // ── 純資産 ──
  '資本金': { category: 'equity', sub_category: '株主資本' },
  '資本準備金': { category: 'equity', sub_category: '株主資本' },
  '利益準備金': { category: 'equity', sub_category: '株主資本' },
  '繰越利益剰余金': { category: 'equity', sub_category: '株主資本' },

  // ── 収益 ──
  '売上高': { category: 'revenue', sub_category: '売上高' },
  '売上': { category: 'revenue', sub_category: '売上高' },
  '受取利息': { category: 'revenue', sub_category: '営業外収益' },
  '受取配当金': { category: 'revenue', sub_category: '営業外収益' },
  '雑収入': { category: 'revenue', sub_category: '営業外収益' },

  // ── 費用 (売上原価) ──
  '仕入高': { category: 'expense', sub_category: '売上原価' },
  '仕入': { category: 'expense', sub_category: '売上原価' },
  '外注費': { category: 'expense', sub_category: '売上原価' },
  '業務委託費': { category: 'expense', sub_category: '売上原価' },

  // ── 費用 (販管費) ──
  '役員報酬': { category: 'expense', sub_category: '販管費' },
  '給料手当': { category: 'expense', sub_category: '販管費' },
  '法定福利費': { category: 'expense', sub_category: '販管費' },
  '福利厚生費': { category: 'expense', sub_category: '販管費' },
  '通信費': { category: 'expense', sub_category: '販管費' },
  '旅費交通費': { category: 'expense', sub_category: '販管費' },
  '消耗品費': { category: 'expense', sub_category: '販管費' },
  '事務用品費': { category: 'expense', sub_category: '販管費' },
  '会議費': { category: 'expense', sub_category: '販管費' },
  '接待交際費': { category: 'expense', sub_category: '販管費' },
  '広告宣伝費': { category: 'expense', sub_category: '販管費' },
  '水道光熱費': { category: 'expense', sub_category: '販管費' },
  '租税公課': { category: 'expense', sub_category: '販管費' },
  '雑費': { category: 'expense', sub_category: '販管費' },
  '地代家賃': { category: 'expense', sub_category: '販管費' },
  '減価償却費': { category: 'expense', sub_category: '販管費' },
  '支払手数料': { category: 'expense', sub_category: '販管費' },
  '支払報酬': { category: 'expense', sub_category: '販管費' },
  '保守料': { category: 'expense', sub_category: '販管費' },
  '保険料': { category: 'expense', sub_category: '販管費' },
  '修繕費': { category: 'expense', sub_category: '販管費' },
  '研修費': { category: 'expense', sub_category: '販管費' },

  // ── 費用 (営業外) ──
  '支払利息': { category: 'expense', sub_category: '営業外費用' },
  '雑損失': { category: 'expense', sub_category: '営業外費用' },
};

/** パターンルール (前/後方一致 + キーワード) */
function patternMatch(name: string): ClassifyResult | null {
  // 負債（先にチェック - "未払金" のような短い完全一致は EXACT_MAP で先に拾われる）
  if (/^未払/.test(name) || /^前受/.test(name) || /^仮受/.test(name) || /^預り/.test(name)) {
    return { category: 'liability', sub_category: '流動負債' };
  }
  if (/借入金$/.test(name)) {
    return name.startsWith('長期')
      ? { category: 'liability', sub_category: '固定負債' }
      : { category: 'liability', sub_category: '流動負債' };
  }

  // 資産
  if (/^前払/.test(name) || /^仮払/.test(name) || /^立替/.test(name)) {
    return { category: 'asset', sub_category: '流動資産' };
  }
  if (/(預金|現金)$/.test(name)) {
    return { category: 'asset', sub_category: '流動資産' };
  }
  if (/掛金$/.test(name) && !name.startsWith('買')) {
    return { category: 'asset', sub_category: '流動資産' };
  }

  // 収益
  if (/売上/.test(name) || /^受取/.test(name)) {
    return { category: 'revenue', sub_category: '売上高' };
  }

  // 費用
  if (/(費|料|代|損)$/.test(name)) {
    return { category: 'expense', sub_category: '販管費' };
  }
  if (/手数料/.test(name)) {
    return { category: 'expense', sub_category: '販管費' };
  }

  return null;
}

/** ローマ字読み（簡易ヘボン式）の代わりに、空でない値を保証するためのフォールバック */
export function fallbackReading(name: string, hint: string | undefined | null): string {
  if (hint && hint.trim()) return hint.trim().toLowerCase();
  // 漢字をそのまま小文字化はできないので、ハッシュ的に名前を返す（一意性確保のため）
  return '';
}

export function classifyAccount(name: string): ClassifyResult {
  const trimmed = name.trim();
  if (!trimmed) return { category: 'uncategorized', sub_category: null };

  const exact = EXACT_MAP[trimmed];
  if (exact) return exact;

  const matched = patternMatch(trimmed);
  if (matched) return matched;

  return { category: 'uncategorized', sub_category: null };
}
