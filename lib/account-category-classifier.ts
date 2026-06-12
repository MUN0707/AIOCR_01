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

/**
 * [C1] 標準科目のローマ字読み辞書（補完検索用）。
 * このアプリの reading カラムはローマ字（小文字 ascii）で統一されているため、
 * 推定もローマ字で返す（seed-client-masters.ts と同じ表記）。
 */
const READING_MAP: Record<string, string> = {
  '現金': 'genkin', '小口現金': 'koguchigenkin', '普通預金': 'futsuyokin',
  '当座預金': 'tozayokin', '定期預金': 'teikiyokin', '売掛金': 'urikakekin',
  '受取手形': 'uketoritegata', '前払費用': 'maebaraihiyou', '前払金': 'maebaraikin',
  '仮払金': 'karibaraikin', '仮払消費税': 'karibaraishouhizei', '立替金': 'tatekaekin',
  '商品': 'shouhin', '製品': 'seihin', '原材料': 'genzairyou',
  '建物': 'tatemono', '建物附属設備': 'tatemonofuzokusetsubi', '構築物': 'kouchikubutsu',
  '機械装置': 'kikaisouchi', '車両運搬具': 'sharyouunpangu', '工具器具備品': 'kougukikubihin',
  '土地': 'tochi', '減価償却累計額': 'genkashoukyakuruikeigaku', 'ソフトウェア': 'softwear',
  '敷金': 'shikikin', '差入保証金': 'sashiirehoshoukin',
  '買掛金': 'kaikakekin', '支払手形': 'shiharaitegata', '未払金': 'miharaikin',
  '未払費用': 'miharaihiyou', '未払法人税等': 'miharaihoujinzeitou', '未払消費税': 'miharaishouhizei',
  '預り金': 'azukarikin', '前受金': 'maeukekin', '仮受金': 'kariukekin',
  '仮受消費税': 'kariukeshouhizei', '短期借入金': 'tankikariirekin', '長期借入金': 'choukikariirekin',
  '社債': 'shasai', '資本金': 'shihonkin', '資本準備金': 'shihonjunbikin',
  '利益準備金': 'riekijunbikin', '繰越利益剰余金': 'kurikoshiriekijouyokin',
  '売上高': 'uriagedaka', '売上': 'uriage', '受取利息': 'uketoririsoku',
  '受取配当金': 'uketorihaitoukin', '雑収入': 'zatsushuunyuu',
  '仕入高': 'shiiredaka', '仕入': 'shiire', '外注費': 'gaichuuhi', '業務委託費': 'gyoumuitakuhi',
  '役員報酬': 'yakuinhoushuu', '給料手当': 'kyuuryouteate', '法定福利費': 'houteifukurihi',
  '福利厚生費': 'fukurikouseihi', '通信費': 'tsuushinhi', '旅費交通費': 'ryohikoutsuuhi',
  '消耗品費': 'shoumouhinhi', '事務用品費': 'jimuyouhinhi', '会議費': 'kaigihi',
  '接待交際費': 'settaikousaihi', '広告宣伝費': 'koukokusendenhi', '水道光熱費': 'suidoukounetsuhi',
  '租税公課': 'sozeikouka', '雑費': 'zappi', '地代家賃': 'chidaiyachin',
  '減価償却費': 'genkashoukyakuhi', '支払手数料': 'shiharaitesuuryou', '支払報酬': 'shiharaihoushuu',
  '保守料': 'hoshuryou', '保険料': 'hokenryou', '修繕費': 'shuuzenhi', '研修費': 'kenshuuhi',
  '支払利息': 'shiharairisoku', '雑損失': 'zassonshitsu',
};

/** ローマ字読み（簡易ヘボン式）の代わりに、空でない値を保証するためのフォールバック */
export function fallbackReading(name: string, hint: string | undefined | null): string {
  if (hint && hint.trim()) return hint.trim().toLowerCase();
  return suggestAccountReading(name);
}

/**
 * [C1] 科目名からローマ字読みを推定する。辞書にあればそれを返し、無ければ ''。
 */
export function suggestAccountReading(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  return READING_MAP[trimmed] ?? '';
}

// [C1] 現金及び現金同等物（CF計算書の対象）とみなす科目
const CASH_EQUIVALENT_EXACT = new Set<string>(['現金', '小口現金', '普通預金', '当座預金', '通知預金']);

/**
 * [C1] 現金預金科目（現金及び現金同等物）かどうかを推定する。
 * 現金・小口現金・普通預金・当座預金・通知預金、および「〜現金」で終わる科目を true とする。
 * 定期預金は満期 3ヶ月超が一般的なため既定では false（ユーザーがマスタで調整可能）。
 */
export function isCashEquivalentAccount(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (CASH_EQUIVALENT_EXACT.has(trimmed)) return true;
  if (/現金$/.test(trimmed)) return true;
  if (/(普通預金|当座預金|通知預金)/.test(trimmed)) return true;
  return false;
}

export interface SuggestAccountMeta extends ClassifyResult {
  reading: string;
  is_cash_equivalent: boolean;
}

/**
 * [C1] 新規科目作成時の自動推定をまとめて返す。
 * 区分(category/sub_category)・ローマ字読み・現金預金フラグを一括で提案する。
 */
export function suggestAccountMeta(name: string): SuggestAccountMeta {
  const cls = classifyAccount(name);
  return {
    ...cls,
    reading: suggestAccountReading(name),
    is_cash_equivalent: isCashEquivalentAccount(name),
  };
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
