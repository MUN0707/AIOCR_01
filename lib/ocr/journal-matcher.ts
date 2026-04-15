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

/**
 * 請求書の明細1行。
 * 1枚の請求書から複数仕訳を起票する場合（科目按分・軽減税率混在等）に使用する。
 * `lines` が無い / 1件だけの従来ケースは、`VoucherInput` の `debitAccount` / `amountInclTax` /
 * `taxType` / `description` がそのまま単一行として扱われる。
 */
export interface VoucherLine {
  debitAccount: string;         // 借方勘定科目
  amountInclTax: number;        // 税込金額（行ごとの金額）
  taxType: string;              // 消費税区分
  description: string;          // 摘要（未入力なら voucher.description + 行番号で補完）
}

export interface VoucherInput {
  id?: string;               // Supabase voucher ID（保存済みの場合）
  vendorName: string;        // 相手先名
  invoiceDate: string;       // YYYYMMDD or "不明"
  amountInclTax: number | null;  // 税込合計金額（ヘッダ）
  amountExclTax?: number | null; // 税抜金額
  taxAmount?: number | null;     // 消費税額
  debitAccount: string;      // OCR推測済み借方勘定科目（単一行のフォールバック）
  description: string;       // 摘要
  taxType: string;           // 消費税区分
  lines?: VoucherLine[];     // 複数仕訳時の明細。未定義/空 の場合は単一行とみなす。
  sourceFileIndex?: number;  // 元PDF（フロント側 invoiceFiles のインデックス）
  sourceFileName?: string;   // 元PDFのファイル名
  ocrUploadId?: string | null; // ocr_uploads.id（仕訳から元PDF参照用）
  /**
   * 月末計上モード（monthEnd）で使用する「役務提供期間」の終了日。
   * 例: "2026年2月分" → 20260228 / "2/1~2/28" → 20260228
   * UI で OCR 抽出結果を確認・修正したうえでセットする想定。
   */
  periodEnd?: string | null;
  /**
   * 源泉徴収税額。>0 の場合、計上仕訳は税込全額を計上し、
   * 支払消込はネット（税込 - 源泉）で照合する。
   * 追加で「未払費用 / 預り金」の振替仕訳が1行生まれる。
   */
  withholdingTax?: number | null;
}

export interface TransactionInput {
  id?: string;               // Supabase bank_transaction ID（保存済みの場合）
  transactionDate: string;   // YYYYMMDD
  description: string;       // 通帳摘要
  debit: number | null;      // 出金額
  credit: number | null;     // 入金額
  sourceFileIndex?: number;  // 元PDF（フロント側 bankFiles のインデックス）
  sourceFileName?: string;   // 元PDFのファイル名
  ocrUploadId?: string | null; // ocr_uploads.id（仕訳から元PDF参照用）
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
  /**
   * 費用計上の仕訳。1請求書に明細が複数ある場合は複数要素。
   * 単一行のケースでも配列（length=1）で返す。
   * UI・DB保存はこれを展開して1行ずつ出力する。
   */
  accrualEntries: AccrualEntry[];
  paymentEntry?: PaymentEntry;    // 照合成功時のみ生成（支払消込）。支払は請求書ヘッダ合計で1本。
  /**
   * 源泉税の後日納付を通帳に照合できた場合に生成される支払消込仕訳。
   * 預り金 / 普通預金 で、date は実際の納付日。
   */
  withholdingPaymentEntry?: PaymentEntry;
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

export type AccountingMethod = 'accrual' | 'cash' | 'monthEnd';

/**
 * 摘要モード:
 *   - 'vendor': 会社名のみ
 *   - 'full':   会社名 + 明細行の内容（複数行は「最初の行 ほか」で省略）
 */
export type DescriptionMode = 'vendor' | 'full';

/**
 * 証票リスト × 入出金リストを照合して仕訳を生成する。
 * 各証票に対して最もスコアの高い出金トランザクションを1対1で対応付ける。
 *
 * accountingMethod:
 *   - 'accrual': 発生主義（既定） — 請求書日で費用計上 + 支払日で未払消込
 *   - 'cash':    現金主義 — 支払日に費用/普通預金 で1本のみ生成（未払費用を経由しない）
 */
/**
 * 請求書から「明細行リスト」を取り出す。
 * `voucher.lines` があればそれを使い、なければ voucher のヘッダから単一行を合成する。
 * マッチャー内部ロジックを単一化するための共通ヘルパー。
 */
function getEffectiveLines(voucher: VoucherInput): VoucherLine[] {
  if (voucher.lines && voucher.lines.length > 0) {
    return voucher.lines;
  }
  return [
    {
      debitAccount: voucher.debitAccount || '仕入高',
      amountInclTax: voucher.amountInclTax ?? 0,
      taxType: voucher.taxType || '課税仕入10%',
      description: voucher.description || voucher.vendorName || '',
    },
  ];
}

/**
 * 摘要の組み立て。
 * - mode='vendor'  : 会社名のみ
 * - mode='full'    : 会社名 + 明細内容（複数行は「最初の行 ほか」）
 *
 * isFirstLine: そのラインが effectiveLines の先頭かどうか（「ほか」省略判定に使う）
 * totalLines:  明細行数
 */
function buildDescription(
  voucher: VoucherInput,
  line: VoucherLine,
  totalLines: number,
  isFirstLine: boolean,
  mode: DescriptionMode
): string {
  const vendor = voucher.vendorName?.trim() ?? '';
  if (mode === 'vendor') return vendor || line.description || voucher.description || '';

  // mode === 'full'
  const lineDesc = (line.description || voucher.description || '').trim();
  // 複数行ある場合は、先頭行だけ詳細内容 + 「ほか」でまとめ、残りの行はシンプルに
  if (totalLines > 1) {
    if (isFirstLine) {
      const head = lineDesc || vendor;
      return [vendor, head ? `${head} ほか` : ''].filter(Boolean).join(' ').trim();
    }
    return [vendor, lineDesc].filter(Boolean).join(' ').trim();
  }
  // 単一行は 会社名 + 内容
  return [vendor, lineDesc].filter(Boolean).join(' ').trim();
}

/**
 * 請求書から「役務提供期間の末日」を推測して YYYYMMDD で返す。
 * 見つからない場合は null。
 *
 * 対応パターン（例）:
 *   "2026年2月分", "2月分", "R6年2月分"   → その月の末日
 *   "2/1~2/28", "2/1〜2/28", "2/1-2/28"  → 末日（"2/28"）
 *   "2026/2/1 ~ 2026/2/28"              → 末日
 *   "2026-02"                           → 2026年2月末日
 *
 * 年が明示されていない場合は voucher.invoiceDate の年（なければ null）を補う。
 * 抽出対象テキスト: voucher.description と lines[].description をすべて連結した文字列。
 */
export function extractPeriodEndFromVoucher(voucher: VoucherInput): string | null {
  const texts = [voucher.description ?? ''];
  for (const l of voucher.lines ?? []) texts.push(l.description ?? '');
  const joined = texts.join(' ');
  if (!joined.trim()) return null;

  const invoiceYear = (() => {
    const d = parseDate(voucher.invoiceDate);
    return d ? d.getFullYear() : null;
  })();

  // 1. "YYYY/M/D ~ YYYY/M/D" や "M/D~M/D"
  const rangeRe = /(\d{4})?[\/\-.](\d{1,2})[\/\-.](\d{1,2})\s*[~〜\-–−]\s*(\d{4})?[\/\-.]?(\d{1,2})[\/\-.](\d{1,2})/;
  const rm = joined.match(rangeRe);
  if (rm) {
    const y = parseInt(rm[4] ?? rm[1] ?? String(invoiceYear ?? ''), 10);
    const m = parseInt(rm[5], 10);
    const d = parseInt(rm[6], 10);
    if (y && m && d) {
      return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
    }
  }

  // 2. "M/D~M/D" (年なし)
  const rangeNoYearRe = /(\d{1,2})\/(\d{1,2})\s*[~〜\-–−]\s*(\d{1,2})\/(\d{1,2})/;
  const rnm = joined.match(rangeNoYearRe);
  if (rnm && invoiceYear) {
    const m = parseInt(rnm[3], 10);
    const d = parseInt(rnm[4], 10);
    if (m && d) {
      return `${invoiceYear}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
    }
  }

  // 3. "YYYY年M月分" / "M月分"
  const monthRe = /(?:(\d{4})年)?(\d{1,2})月分/;
  const mm = joined.match(monthRe);
  if (mm) {
    const y = parseInt(mm[1] ?? String(invoiceYear ?? ''), 10);
    const m = parseInt(mm[2], 10);
    if (y && m) {
      const last = new Date(y, m, 0).getDate();
      return `${y}${String(m).padStart(2, '0')}${String(last).padStart(2, '0')}`;
    }
  }

  // 4. "YYYY-MM" / "YYYY/MM"
  const ymRe = /(\d{4})[\/\-](\d{1,2})(?![\/\-\d])/;
  const ym = joined.match(ymRe);
  if (ym) {
    const y = parseInt(ym[1], 10);
    const m = parseInt(ym[2], 10);
    if (y && m) {
      const last = new Date(y, m, 0).getDate();
      return `${y}${String(m).padStart(2, '0')}${String(last).padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * YYYYMMDD 文字列の月末日を返す。不明/不正な場合は元の文字列を返す。
 */
function toMonthEnd(ymd: string): string {
  if (!ymd || ymd === '不明') return ymd;
  const clean = ymd.replace(/[-/]/g, '');
  if (clean.length !== 8) return ymd;
  const y = parseInt(clean.slice(0, 4), 10);
  const m = parseInt(clean.slice(4, 6), 10);
  if (!y || !m) return ymd;
  const last = new Date(y, m, 0).getDate(); // m は 1〜12。Date(y, m, 0) で前月末 = 当月末日
  return `${y}${String(m).padStart(2, '0')}${String(last).padStart(2, '0')}`;
}

export interface MatchOptions {
  accountingMethod?: AccountingMethod;
  descriptionMode?: DescriptionMode;
}

export function matchVouchersToTransactions(
  vouchers: VoucherInput[],
  transactions: TransactionInput[],
  accountingMethodOrOptions: AccountingMethod | MatchOptions = 'accrual'
): { results: MatchResult[]; summary: MatchSummary } {
  // 後方互換: 第3引数が文字列の場合は accountingMethod 扱い
  const opts: MatchOptions = typeof accountingMethodOrOptions === 'string'
    ? { accountingMethod: accountingMethodOrOptions }
    : accountingMethodOrOptions;
  const accountingMethod: AccountingMethod = opts.accountingMethod ?? 'accrual';
  const descriptionMode: DescriptionMode = opts.descriptionMode ?? 'vendor';

  const usedTxIndices = new Set<number>();

  const results: MatchResult[] = vouchers.map((voucher) => {
    const invoiceDate = parseDate(voucher.invoiceDate);
    const effectiveLines = getEffectiveLines(voucher);
    const totalLines = effectiveLines.length;

    // 費用計上の日付は計上方式で決まる
    // - accrual / monthEnd: 請求書側の日付（monthEnd は periodEnd → 無ければ請求書日を月末化）
    // - cash:               支払日（照合成功時のみ）
    const accrualBaseDate = accountingMethod === 'monthEnd'
      ? (voucher.periodEnd && voucher.periodEnd !== '不明'
          ? voucher.periodEnd
          : toMonthEnd(voucher.invoiceDate))
      : voucher.invoiceDate;

    // 源泉徴収税を引いたネット金額で照合する
    const wh = voucher.withholdingTax && voucher.withholdingTax > 0 ? voucher.withholdingTax : 0;
    const gross = voucher.amountInclTax;
    const netForMatch = gross != null ? gross - wh : null;

    // 出金トランザクションのみスコアリング（照合は請求書ヘッダ合計で行う）
    const scored = transactions
      .map((tx, idx) => {
        if (usedTxIndices.has(idx) || !tx.debit) return null;
        const as = amountScore(tx.debit, netForMatch);
        if (as === 0) return null;
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

    // ─── 現金主義: 支払日で1本/行ずつ生成（未払費用を経由しない） ───
    if (accountingMethod === 'cash') {
      if (matchStatus === 'unmatched' || !best) {
        // 支払が見つからない場合は未払の placeholder を明細ごとに出す
        const placeholders: AccrualEntry[] = effectiveLines.map((line, idx) => ({
          entryType:     'accrual',
          date:          voucher.invoiceDate,
          debitAccount:  line.debitAccount || '仕入高',
          creditAccount: '未払費用',
          amount:        line.amountInclTax,
          description:   buildDescription(voucher, line, totalLines, idx === 0, descriptionMode),
          taxType:       line.taxType || voucher.taxType,
          matchStatus:   'unmatched',
          voucher,
        }));
        return { accrualEntries: placeholders };
      }
      usedTxIndices.add(best.idx);
      const cashEntries: AccrualEntry[] = effectiveLines.map((line, idx) => {
        const entry: AccrualEntry = {
          entryType:     'accrual',
          date:          best.tx.transactionDate,
          debitAccount:  line.debitAccount || '仕入高',
          creditAccount: '未払費用', // ランタイムで '普通預金' に上書き
          amount:        line.amountInclTax,
          description:   buildDescription(voucher, line, totalLines, idx === 0, descriptionMode),
          taxType:       line.taxType || voucher.taxType,
          matchStatus:   best.score >= 0.7 ? 'auto' : 'needs_review',
          voucher,
        };
        (entry as unknown as { creditAccount: string }).creditAccount = '普通預金';
        return entry;
      });
      return { accrualEntries: cashEntries };
    }

    // ─── 発生主義 / 月末計上（accrual / monthEnd） ───
    // 費用計上仕訳を明細ごとに生成
    const accrualEntries: AccrualEntry[] = effectiveLines.map((line, idx) => ({
      entryType:     'accrual',
      date:          accrualBaseDate,
      debitAccount:  line.debitAccount || '未払費用',
      creditAccount: '未払費用',
      amount:        line.amountInclTax,
      description:   buildDescription(voucher, line, totalLines, idx === 0, descriptionMode),
      taxType:       line.taxType || voucher.taxType,
      matchStatus,
      voucher,
    }));

    // 源泉税がある場合は「未払費用 / 預り金」の振替仕訳を追加
    // （貸方は 預り金 固定。UI 側で creditAccount を表示する）
    if (wh > 0) {
      accrualEntries.push({
        entryType:     'accrual',
        date:          accrualBaseDate,
        debitAccount:  '未払費用',
        // 型上 '未払費用' 固定だが実行時は '預り金' に差し替える
        creditAccount: '未払費用',
        amount:        wh,
        description:   `${voucher.vendorName || ''} 源泉税`.trim(),
        taxType:       '対象外',
        matchStatus,
        voucher,
      });
      (accrualEntries[accrualEntries.length - 1] as unknown as { creditAccount: string }).creditAccount = '預り金';
    }

    if (matchStatus === 'unmatched') {
      return { accrualEntries };
    }

    // 支払消込仕訳は請求書1枚につき1本（ヘッダ合計）
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

    return { accrualEntries, paymentEntry };
  });

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
