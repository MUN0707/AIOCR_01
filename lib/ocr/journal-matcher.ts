/**
 * 照合エンジン
 * 通帳入出金データ × 証票データ → 仕訳データを生成
 *
 * スコアリング:
 *   金額一致    60%
 *   日付近接    30%
 *   相手先名類似 10%
 *
 * 閾値:
 *   score ≥ 0.7 → 自動照合 (auto)
 *   score ≥ 0.4 → 要確認   (needs_review)
 *   score <  0.4 → 未照合
 */

// ─── 入力型 ────────────────────────────────────────────────────────────────

export interface VoucherInput {
  id?: string;               // Supabase voucher ID（保存済みの場合）
  vendorName: string;        // 相手先名
  invoiceDate: string;       // YYYYMMDD or "不明"
  amountInclTax: number | null;  // 税込金額
  amountExclTax?: number | null; // 税抜金額
  taxAmount?: number | null;     // 消費税額
  debitAccount: string;      // OCR推測済み借方勘定科目
  description: string;       // 摘要
  taxType: string;           // 消費税区分
  sourceFileIndex?: number;  // 元PDF（フロント側 invoiceFiles のインデックス）
  sourceFileName?: string;   // 元PDFのファイル名
}

export interface TransactionInput {
  id?: string;               // Supabase bank_transaction ID（保存済みの場合）
  transactionDate: string;   // YYYYMMDD
  description: string;       // 通帳摘要
  debit: number | null;      // 出金額
  credit: number | null;     // 入金額
  sourceFileIndex?: number;  // 元PDF（フロント側 bankFiles のインデックス）
  sourceFileName?: string;   // 元PDFのファイル名
}

// ─── 出力型 ────────────────────────────────────────────────────────────────

export type MatchStatus = 'auto' | 'needs_review' | 'unmatched';

export interface AccrualEntry {
  entryType: 'accrual';
  date: string;
  debitAccount: string;
  creditAccount: '未払費用';
  amount: number | null;
  description: string;
  taxType: string;
  matchStatus: MatchStatus;
  voucher: VoucherInput;
}

export interface PaymentEntry {
  entryType: 'payment';
  date: string;
  debitAccount: '未払費用';
  creditAccount: '普通預金';
  amount: number | null;
  description: string;
  taxType: '対象外';
  matchScore: number;
  matchStatus: Exclude<MatchStatus, 'unmatched'>;
  transaction: TransactionInput;
  voucher: VoucherInput;
}

export interface MatchResult {
  accrualEntry: AccrualEntry;     // 証票から常に生成（費用計上）
  paymentEntry?: PaymentEntry;    // 照合成功時のみ生成（支払消込）
}

export interface MatchSummary {
  total: number;
  autoMatched: number;
  needsReview: number;
  unmatched: number;
  unmatchedTransactions: TransactionInput[]; // 証票と紐付かなかった入出金
}

// ─── 正規化ユーティリティ ──────────────────────────────────────────────────

/** 相手先名を照合用に正規化 */
export function normalizeVendorName(name: string): string {
  if (!name) return '';
  return name
    // 法人格を除去
    .replace(/株式会社|有限会社|合同会社|一般社団法人|公益社団法人|NPO法人|医療法人|学校法人/g, '')
    .replace(/（株）|\(株\)|（有）|\(有\)|（合）|\(合\)/g, '')
    // 全角英数→半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    // スペース除去・小文字化
    .replace(/[　\s]/g, '')
    .toLowerCase();
}

// ─── スコア計算 ────────────────────────────────────────────────────────────

/** 金額一致スコア（0 or 0.8 or 1.0） */
function amountScore(txDebit: number | null, invoiceAmount: number | null): number {
  if (!txDebit || !invoiceAmount) return 0;
  if (txDebit === invoiceAmount) return 1.0;
  // 1%以内の差異は端数処理とみなす
  if (Math.abs(txDebit - invoiceAmount) / invoiceAmount <= 0.01) return 0.8;
  return 0;
}

/** 日付近接スコア。支払日は請求書日付より後が自然 */
function dateProximityScore(txDate: Date | null, invoiceDate: Date | null): number {
  if (!txDate || !invoiceDate) return 0.3; // 不明は中間値
  const diffDays = (txDate.getTime() - invoiceDate.getTime()) / 86_400_000;
  if (diffDays >= 0 && diffDays <= 7)  return 1.0;
  if (diffDays >= 0 && diffDays <= 30) return 0.8;
  if (diffDays >= 0 && diffDays <= 60) return 0.6;
  if (diffDays >= -7 && diffDays < 0)  return 0.5; // 前払いの可能性
  return 0.1;
}

/** 文字列類似度（0〜1） */
function nameSimilarityScore(txDesc: string, vendorName: string): number {
  const a = normalizeVendorName(txDesc);
  const b = normalizeVendorName(vendorName);
  if (!a || !b) return 0;
  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.7;
  // 共通文字の割合（簡易Jaccard）
  const shorter = a.length <= b.length ? a : b;
  const longer  = a.length <= b.length ? b : a;
  let hits = 0;
  for (const ch of shorter) {
    if (longer.includes(ch)) hits++;
  }
  return hits / longer.length;
}

/** YYYYMMDD → Date（不明の場合 null） */
function parseDate(s: string): Date | null {
  if (!s || s === '不明') return null;
  const clean = s.replace(/[-/]/g, '');
  if (clean.length !== 8) return null;
  const y = parseInt(clean.slice(0, 4), 10);
  const m = parseInt(clean.slice(4, 6), 10) - 1;
  const d = parseInt(clean.slice(6, 8), 10);
  const dt = new Date(y, m, d);
  return isNaN(dt.getTime()) ? null : dt;
}

// ─── メイン照合関数 ────────────────────────────────────────────────────────

export type AccountingMethod = 'accrual' | 'cash';

/**
 * 証票リスト × 入出金リストを照合して仕訳を生成する。
 * 各証票に対して最もスコアの高い出金トランザクションを1対1で対応付ける。
 *
 * accountingMethod:
 *   - 'accrual': 発生主義（既定） — 請求書日で費用計上 + 支払日で未払消込
 *   - 'cash':    現金主義 — 支払日に費用/普通預金 で1本のみ生成（未払費用を経由しない）
 */
export function matchVouchersToTransactions(
  vouchers: VoucherInput[],
  transactions: TransactionInput[],
  accountingMethod: AccountingMethod = 'accrual'
): { results: MatchResult[]; summary: MatchSummary } {
  const usedTxIndices = new Set<number>();

  const results: MatchResult[] = vouchers.map((voucher) => {
    const invoiceDate = parseDate(voucher.invoiceDate);

    // 出金トランザクションのみスコアリング
    const scored = transactions
      .map((tx, idx) => {
        if (usedTxIndices.has(idx) || !tx.debit) return null;
        const as = amountScore(tx.debit, voucher.amountInclTax);
        if (as === 0) return null; // 金額不一致は即スキップ
        const ds = dateProximityScore(parseDate(tx.transactionDate), invoiceDate);
        const ns = nameSimilarityScore(tx.description, voucher.vendorName);
        return { idx, tx, score: as * 0.6 + ds * 0.3 + ns * 0.1 };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const matchStatus: MatchStatus =
      !best           ? 'unmatched'
      : best.score >= 0.7 ? 'auto'
      : best.score >= 0.4 ? 'needs_review'
      : 'unmatched';

    // ─── 現金主義: 支払日で1本だけ生成（未払費用を経由しない） ───
    if (accountingMethod === 'cash') {
      if (matchStatus === 'unmatched' || !best) {
        // 支払が見つからない場合は仕訳を生成しない（未払を作らない）
        const placeholder: AccrualEntry = {
          entryType:     'accrual',
          date:          voucher.invoiceDate,
          debitAccount:  voucher.debitAccount || '仕入高',
          creditAccount: '未払費用',
          amount:        voucher.amountInclTax,
          description:   [voucher.vendorName, voucher.description].filter(Boolean).join(' ').trim(),
          taxType:       voucher.taxType,
          matchStatus:   'unmatched',
          voucher,
        };
        return { accrualEntry: placeholder };
      }
      usedTxIndices.add(best.idx);
      // accrualEntry を「支払日付・費用/普通預金」として扱う（既存スキーマを流用）
      const cashEntry: AccrualEntry = {
        entryType:     'accrual',
        date:          best.tx.transactionDate,
        debitAccount:  voucher.debitAccount || '仕入高',
        creditAccount: '未払費用', // 表記のみ。実体は普通預金として下で上書きする
        amount:        best.tx.debit ?? voucher.amountInclTax,
        description:   [voucher.vendorName, voucher.description].filter(Boolean).join(' ').trim(),
        taxType:       voucher.taxType,
        matchStatus:   best.score >= 0.7 ? 'auto' : 'needs_review',
        voucher,
      };
      // 型上 creditAccount は '未払費用' リテラルだが、現金主義では普通預金で出力したいので
      // ランタイム上書き（ledger 出力では string として扱われる）
      (cashEntry as unknown as { creditAccount: string }).creditAccount = '普通預金';
      return { accrualEntry: cashEntry };
    }

    // ─── 発生主義（既定） ───
    // 費用計上仕訳（常に生成）
    const accrualEntry: AccrualEntry = {
      entryType:     'accrual',
      date:          voucher.invoiceDate,
      debitAccount:  voucher.debitAccount || '未払費用',
      creditAccount: '未払費用',
      amount:        voucher.amountInclTax,
      description:   [voucher.vendorName, voucher.description].filter(Boolean).join(' ').trim(),
      taxType:       voucher.taxType,
      matchStatus,
      voucher,
    };

    if (matchStatus === 'unmatched') {
      return { accrualEntry };
    }

    // 支払消込仕訳（照合成功時のみ生成）
    usedTxIndices.add(best.idx);
    const paymentEntry: PaymentEntry = {
      entryType:     'payment',
      date:          best.tx.transactionDate,
      debitAccount:  '未払費用',
      creditAccount: '普通預金',
      amount:        best.tx.debit,
      description:   `${voucher.vendorName || best.tx.description} 支払消込`,
      taxType:       '対象外',
      matchScore:    Math.round(best.score * 100) / 100,
      matchStatus:   best.score >= 0.7 ? 'auto' : 'needs_review',
      transaction:   best.tx,
      voucher,
    };

    return { accrualEntry, paymentEntry };
  });

  // 未照合トランザクション（どの証票とも紐付かなかった出金）
  const unmatchedTransactions = transactions.filter(
    (tx, idx) => tx.debit && !usedTxIndices.has(idx)
  );

  const summary: MatchSummary = {
    total:                  results.length,
    autoMatched:            results.filter((r) => r.paymentEntry?.matchStatus === 'auto').length,
    needsReview:            results.filter((r) => r.paymentEntry?.matchStatus === 'needs_review').length,
    unmatched:              results.filter((r) => !r.paymentEntry).length,
    unmatchedTransactions,
  };

  return { results, summary };
}
