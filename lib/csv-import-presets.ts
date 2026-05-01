/**
 * 会計ソフト CSV インポート用列マッピングプリセット
 *
 * 各プリセットは「会計ソフトのCSVヘッダ名 → journal_entries カラム名」の変換を定義する。
 * skipRows: ヘッダ行以前にスキップすべき行数（弥生はメタ行が入る場合がある）
 * encoding: ファイルのデフォルトエンコーディング
 */

/** journal_entries に挿入するときの正規化済み行 */
export interface NormalizedJournalRow {
  entry_date: string;       // YYYYMMDD
  debit_account: string;    // 借方科目
  credit_account: string;   // 貸方科目
  amount: number | null;    // 後方互換: debit_amount または credit_amount
  debit_amount: number | null;
  credit_amount: number | null;
  tax_type: string;         // 消費税区分（文字列）
  tax_amount: number | null;
  tax_rate: string;         // "10","8" など
  is_internal_tax: boolean | null;
  description: string;      // 摘要
  vendor_name: string;      // 取引先
  /** freee の「No」列（同一仕訳内で同値）。これでインポート時に voucher_group_id を発番 */
  voucher_no: string | null;
  voucher_seq: number | null;
  voucher_total_lines: number | null;
  /** raw 全列保持。journal_entries.meta に格納する */
  meta: Record<string, string> | null;
}

export interface CsvPreset {
  id: string;
  label: string;
  description: string;
  encoding: 'utf-8' | 'shift_jis';
  /** ヘッダ行より前にスキップする行数 (0 = 1行目がヘッダ) */
  skipRows: number;
  /** CSV ヘッダ名 → 内部フィールド名 のマッピング */
  columns: {
    entry_date: string[];       // 候補ヘッダ名のリスト（先頭マッチ優先）
    debit_account: string[];
    credit_account: string[];
    amount: string[];           // 借方金額を優先、なければ金額
    credit_amount?: string[];   // 貸方金額が別列の場合の候補。amount が空ならこちらをフォールバック
    tax_type: string[];
    description: string[];
    vendor_name: string[];
  };
  /**
   * ヘッダ行がないCSVの場合、列インデックスを直接指定する。
   * 設定されている場合はヘッダ解決より優先される。
   */
  fixedColumns?: {
    entry_date: number;
    debit_account: number;
    credit_account: number;
    amount: number;
    tax_type: number;
    description: number;
    vendor_name: number;
    credit_amount?: number;     // 貸方金額（別列にある場合）
  };
  /** 未対応フラグ（UIで「その他」から送信を案内する） */
  unsupported?: boolean;
  /** freee 仕訳帳の高度パース（No列グルーピング、税額・税率分離、全列 meta 保存）を有効化 */
  freeeAdvanced?: boolean;
  /**
   * 日付文字列を YYYYMMDD に正規化する関数。
   * 未指定時はデフォルトパーサーを使用。
   */
  dateParser?: (raw: string) => string;
}

// ─── 日付パーサーヘルパー ───────────────────────────────────────────────────

/** "2026/04/15", "2026-04-15", "R08/04/15" → "20260415" */
function defaultDateParser(raw: string): string {
  if (!raw) return '';
  const warekiMatch = raw.match(/^[RrＲ]\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (warekiMatch) {
    const year = 2018 + parseInt(warekiMatch[1], 10);
    return `${year}${warekiMatch[2].padStart(2, '0')}${warekiMatch[3].padStart(2, '0')}`;
  }
  const m = raw.match(/(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (m) {
    return `${m[1]}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}`;
  }
  if (/^\d{8}$/.test(raw.trim())) return raw.trim();
  return raw;
}

function yayoiDateParser(raw: string): string { return defaultDateParser(raw); }
function freeDateParser(raw: string): string { return defaultDateParser(raw); }
function mfDateParser(raw: string): string { return defaultDateParser(raw); }

// ─── プリセット定義 ─────────────────────────────────────────────────────────

export const CSV_PRESETS: CsvPreset[] = [
  {
    id: 'yayoi',
    label: '弥生会計',
    description: '弥生会計の仕訳日記帳エクスポート (CSV)',
    encoding: 'shift_jis',
    skipRows: 0,
    columns: {
      entry_date:     ['日付', '取引日付', '伝票日付'],
      debit_account:  ['借方勘定科目', '借方科目'],
      credit_account: ['貸方勘定科目', '貸方科目'],
      amount:         ['借方金額', '金額', '取引金額'],
      tax_type:       ['借方税区分', '税区分', '消費税区分'],
      description:    ['摘要', '適用', '摘要文'],
      vendor_name:    ['取引先', '相手先', '取引先名'],
    },
    fixedColumns: {
      entry_date: 3,
      debit_account: 4,
      credit_account: 10,
      amount: 8,
      tax_type: 7,
      description: 16,
      vendor_name: 5,
      credit_amount: 14,
    },
    dateParser: yayoiDateParser,
  },
  {
    id: 'freee',
    label: 'freee会計',
    description: 'freee の仕訳帳CSVエクスポート',
    encoding: 'shift_jis',
    skipRows: 0,
    freeeAdvanced: true,
    columns: {
      entry_date:     ['取引日', '発生日', '日付'],
      debit_account:  ['借方勘定科目', '借方科目'],
      credit_account: ['貸方勘定科目', '貸方科目'],
      amount:         ['借方金額', '金額', '取引金額'],
      credit_amount:  ['貸方金額'],
      tax_type:       ['借方税区分', '税区分', '消費税区分'],
      description:    ['借方備考', '貸方備考', '摘要', '備考', '取引内容'],
      vendor_name:    ['借方取引先名', '貸方取引先名', '取引先', '取引先名', '相手先'],
    },
    dateParser: freeDateParser,
  },
  {
    id: 'moneyforward',
    label: 'マネーフォワード',
    description: 'マネーフォワード クラウド会計の仕訳帳CSVエクスポート',
    encoding: 'utf-8',
    unsupported: true,
    skipRows: 0,
    columns: {
      entry_date:     ['取引日', '日付', '発生日'],
      debit_account:  ['借方勘定科目', '借方科目'],
      credit_account: ['貸方勘定科目', '貸方科目'],
      amount:         ['借方金額', '金額', '取引金額'],
      tax_type:       ['借方税区分', '税区分', '消費税区分'],
      description:    ['摘要', '適用', '備考'],
      vendor_name:    ['取引先', '取引先名', '相手先'],
    },
    dateParser: mfDateParser,
  },
];

// ─── CSV パーサー ───────────────────────────────────────────────────────────

/** CSV 行をパースする（ダブルクォート対応） */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

/** ヘッダ正規化（空白・全角空白・引用符を除去して比較する） */
function normalizeHeaderName(s: string): string {
  return s.replace(/[\s　"]/g, '');
}

/** ヘッダ行から列インデックスマッピングを解決（最初にマッチしたもの） */
function resolveColumnIndex(headers: string[], candidates: string[]): number {
  for (const cand of candidates) {
    const idx = headers.findIndex((h) => normalizeHeaderName(h) === normalizeHeaderName(cand));
    if (idx !== -1) return idx;
  }
  return -1;
}

/** ヘッダ行から候補ヘッダ全てに対する列インデックスを順序付きで取得（重複除去） */
function resolveColumnIndices(headers: string[], candidates: string[]): number[] {
  const result: number[] = [];
  for (const cand of candidates) {
    const idx = headers.findIndex((h) => normalizeHeaderName(h) === normalizeHeaderName(cand));
    if (idx !== -1 && !result.includes(idx)) result.push(idx);
  }
  return result;
}

/** 列インデックス候補リストから、最初に空でない値を返す */
function pickFirstNonEmpty(cells: string[], indices: number[]): string {
  for (const idx of indices) {
    const v = cells[idx];
    if (v !== undefined && v !== null && v.trim() !== '') return v;
  }
  return '';
}

/** 数値文字列を numeric に変換。空 or 0 のときは null */
function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[,，\s¥\\]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  if (isNaN(n)) return null;
  return n;
}

/** 税率文字列を抽出（"10", "8", "0", "10%" など） */
function parseRate(raw: string): string {
  if (!raw) return '';
  const m = raw.match(/(\d{1,2})/);
  return m ? m[1] : '';
}

/** 内税外税フラグ */
function parseInternalTax(raw: string): boolean | null {
  if (!raw) return null;
  if (raw.includes('内税')) return true;
  if (raw.includes('外税') || raw.includes('対象外')) return false;
  return null;
}

export interface ParseResult {
  rows: NormalizedJournalRow[];
  skipped: number;
  errors: string[];
  headers: string[];
}

/** 空行用の Row を作成（共通フィールドの初期値） */
function emptyRowDefaults(): Partial<NormalizedJournalRow> {
  return {
    debit_amount: null,
    credit_amount: null,
    tax_amount: null,
    tax_rate: '',
    is_internal_tax: null,
    voucher_no: null,
    voucher_seq: null,
    voucher_total_lines: null,
    meta: null,
  };
}

/** CSV テキストをプリセットに基づいてパースし、正規化済み行を返す */
export function parseCsvWithPreset(csvText: string, preset: CsvPreset): ParseResult {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const errors: string[] = [];

  if (lines.length <= preset.skipRows) {
    return { rows: [], skipped: 0, errors: ['データ行がありません'], headers: [] };
  }

  const dateParser = preset.dateParser ?? defaultDateParser;
  const rows: NormalizedJournalRow[] = [];
  let skipped = 0;

  // ── fixedColumns モード（ヘッダなし固定列CSV）──
  if (preset.fixedColumns) {
    const fc = preset.fixedColumns;
    const firstCells = parseCsvLine(lines[preset.skipRows]);
    const firstDateCandidate = firstCells[fc.entry_date] ?? '';
    const looksLikeHeader = !firstDateCandidate.match(/\d{4}[/\-.]?\d{1,2}[/\-.]?\d{1,2}/)
      && !firstDateCandidate.match(/^\d{8}$/);
    const dataStart = preset.skipRows + (looksLikeHeader ? 1 : 0);

    for (let i = dataStart; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      const dateRaw = cells[fc.entry_date] ?? '';
      const entryDate = dateParser(dateRaw);
      const debit = cells[fc.debit_account] ?? '';
      const credit = cells[fc.credit_account] ?? '';
      const debitAmount = parseAmount(cells[fc.amount] ?? '');
      const creditAmount = fc.credit_amount !== undefined
        ? parseAmount(cells[fc.credit_amount] ?? '')
        : null;
      const amount = debitAmount ?? creditAmount;

      if (!debit && !credit) {
        skipped++;
        continue;
      }

      rows.push({
        entry_date: entryDate || '不明',
        debit_account: debit || '',
        credit_account: credit || '',
        amount,
        debit_amount: debitAmount,
        credit_amount: creditAmount,
        tax_type: cells[fc.tax_type] ?? '',
        tax_amount: null,
        tax_rate: '',
        is_internal_tax: null,
        description: cells[fc.description] ?? '',
        vendor_name: cells[fc.vendor_name] ?? '',
        voucher_no: null,
        voucher_seq: null,
        voucher_total_lines: null,
        meta: null,
      });
    }

    return { rows, skipped, errors, headers: [] };
  }

  // ── ヘッダ行ベースモード ──
  const headerLine = lines[preset.skipRows];
  const headers = parseCsvLine(headerLine);

  if (preset.freeeAdvanced) {
    return parseFreeeAdvanced(lines, headers, preset, dateParser);
  }

  // ── 通常のヘッダベースモード（弥生バックアップ・MF）──
  const colMap = {
    entry_date: resolveColumnIndex(headers, preset.columns.entry_date),
    debit_account: resolveColumnIndex(headers, preset.columns.debit_account),
    credit_account: resolveColumnIndex(headers, preset.columns.credit_account),
    amount: resolveColumnIndex(headers, preset.columns.amount),
    credit_amount: preset.columns.credit_amount
      ? resolveColumnIndex(headers, preset.columns.credit_amount)
      : -1,
    tax_type: resolveColumnIndices(headers, preset.columns.tax_type),
    description: resolveColumnIndices(headers, preset.columns.description),
    vendor_name: resolveColumnIndices(headers, preset.columns.vendor_name),
  };

  if (colMap.entry_date === -1) errors.push('日付列が見つかりません');
  if (colMap.debit_account === -1) errors.push('借方科目列が見つかりません');
  if (colMap.credit_account === -1) errors.push('貸方科目列が見つかりません');
  if (colMap.amount === -1) errors.push('金額列が見つかりません');

  if (errors.length > 0) {
    return { rows: [], skipped: 0, errors, headers };
  }

  for (let i = preset.skipRows + 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const dateRaw = cells[colMap.entry_date] ?? '';
    const entryDate = dateParser(dateRaw);
    const debit = cells[colMap.debit_account] ?? '';
    const credit = cells[colMap.credit_account] ?? '';
    const debitAmount = parseAmount(cells[colMap.amount] ?? '');
    const creditAmount = colMap.credit_amount !== -1
      ? parseAmount(cells[colMap.credit_amount] ?? '')
      : null;
    const amount = debitAmount ?? creditAmount;

    if (!debit && !credit) {
      skipped++;
      continue;
    }

    rows.push({
      entry_date: entryDate || '不明',
      debit_account: debit || '',
      credit_account: credit || '',
      amount,
      debit_amount: debitAmount,
      credit_amount: creditAmount,
      tax_type: pickFirstNonEmpty(cells, colMap.tax_type),
      tax_amount: null,
      tax_rate: '',
      is_internal_tax: null,
      description: pickFirstNonEmpty(cells, colMap.description),
      vendor_name: pickFirstNonEmpty(cells, colMap.vendor_name),
      ...emptyRowDefaults(),
    } as NormalizedJournalRow);
  }

  return { rows, skipped, errors, headers };
}

// ─── freee 専用: No列でグルーピング・税額抽出・全列 meta 保存 ─────────────────

const FREEE_FIELDS = {
  no: ['No', 'ＮＯ', 'No.'],
  date: ['取引日', '発生日', '日付'],
  debit_account: ['借方勘定科目'],
  debit_amount: ['借方金額'],
  debit_tax_type: ['借方税区分'],
  debit_tax_amount: ['借方税金額'],
  debit_internal_external: ['借方内税・外税', '借方内税外税'],
  debit_tax_rate: ['借方税率'],
  debit_vendor: ['借方取引先名'],
  debit_memo: ['借方備考'],
  credit_account: ['貸方勘定科目'],
  credit_amount: ['貸方金額'],
  credit_tax_type: ['貸方税区分'],
  credit_tax_amount: ['貸方税金額'],
  credit_internal_external: ['貸方内税・外税', '貸方内税外税'],
  credit_tax_rate: ['貸方税率'],
  credit_vendor: ['貸方取引先名'],
  credit_memo: ['貸方備考'],
  voucher_seq: ['仕訳行番号'],
  voucher_total: ['仕訳行数'],
} as const;

function parseFreeeAdvanced(
  lines: string[],
  headers: string[],
  preset: CsvPreset,
  dateParser: (raw: string) => string,
): ParseResult {
  const errors: string[] = [];
  let skipped = 0;
  const rows: NormalizedJournalRow[] = [];

  const idx = (key: keyof typeof FREEE_FIELDS): number =>
    resolveColumnIndex(headers, [...FREEE_FIELDS[key]]);

  const idxs = {
    no: idx('no'),
    date: idx('date'),
    debit_account: idx('debit_account'),
    debit_amount: idx('debit_amount'),
    debit_tax_type: idx('debit_tax_type'),
    debit_tax_amount: idx('debit_tax_amount'),
    debit_internal: idx('debit_internal_external'),
    debit_tax_rate: idx('debit_tax_rate'),
    debit_vendor: idx('debit_vendor'),
    debit_memo: idx('debit_memo'),
    credit_account: idx('credit_account'),
    credit_amount: idx('credit_amount'),
    credit_tax_type: idx('credit_tax_type'),
    credit_tax_amount: idx('credit_tax_amount'),
    credit_internal: idx('credit_internal_external'),
    credit_tax_rate: idx('credit_tax_rate'),
    credit_vendor: idx('credit_vendor'),
    credit_memo: idx('credit_memo'),
    voucher_seq: idx('voucher_seq'),
    voucher_total: idx('voucher_total'),
  };

  if (idxs.date === -1) errors.push('取引日列が見つかりません');
  if (idxs.debit_account === -1 && idxs.credit_account === -1) {
    errors.push('借方/貸方勘定科目列が見つかりません');
  }
  if (idxs.no === -1) errors.push('No列(仕訳番号)が見つかりません');

  if (errors.length > 0) {
    return { rows: [], skipped: 0, errors, headers };
  }

  const get = (cells: string[], i: number): string =>
    i === -1 ? '' : (cells[i] ?? '');

  for (let i = preset.skipRows + 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const debit = get(cells, idxs.debit_account);
    const credit = get(cells, idxs.credit_account);

    if (!debit && !credit) {
      skipped++;
      continue;
    }

    const debitAmount = parseAmount(get(cells, idxs.debit_amount));
    const creditAmount = parseAmount(get(cells, idxs.credit_amount));
    const debitTaxAmount = parseAmount(get(cells, idxs.debit_tax_amount));
    const creditTaxAmount = parseAmount(get(cells, idxs.credit_tax_amount));
    const taxAmount = (debitTaxAmount && debitTaxAmount !== 0)
      ? debitTaxAmount
      : (creditTaxAmount && creditTaxAmount !== 0 ? creditTaxAmount : null);

    const debitTaxRate = parseRate(get(cells, idxs.debit_tax_rate));
    const creditTaxRate = parseRate(get(cells, idxs.credit_tax_rate));
    const taxRate = debitTaxRate || creditTaxRate;

    const debitInternal = parseInternalTax(get(cells, idxs.debit_internal));
    const creditInternal = parseInternalTax(get(cells, idxs.credit_internal));
    const isInternalTax = debitInternal !== null ? debitInternal : creditInternal;

    const debitTaxType = get(cells, idxs.debit_tax_type);
    const creditTaxType = get(cells, idxs.credit_tax_type);
    const taxType = debitTaxType || creditTaxType;

    const debitVendor = get(cells, idxs.debit_vendor);
    const creditVendor = get(cells, idxs.credit_vendor);
    const vendorName = debitVendor || creditVendor;

    const debitMemo = get(cells, idxs.debit_memo);
    const creditMemo = get(cells, idxs.credit_memo);
    const description = debitMemo || creditMemo;

    const voucherNo = get(cells, idxs.no) || null;
    const voucherSeqRaw = get(cells, idxs.voucher_seq);
    const voucherTotalRaw = get(cells, idxs.voucher_total);
    const voucherSeq = voucherSeqRaw ? parseInt(voucherSeqRaw, 10) : null;
    const voucherTotal = voucherTotalRaw ? parseInt(voucherTotalRaw, 10) : null;

    // raw 全列を meta に格納（空セルはスキップしてサイズを節約）
    const meta: Record<string, string> = {};
    for (let h = 0; h < headers.length; h++) {
      const v = cells[h];
      if (v && v.trim() !== '') {
        meta[headers[h]] = v;
      }
    }

    rows.push({
      entry_date: dateParser(get(cells, idxs.date)) || '不明',
      debit_account: debit || '',
      credit_account: credit || '',
      amount: debitAmount ?? creditAmount,
      debit_amount: debitAmount,
      credit_amount: creditAmount,
      tax_type: taxType,
      tax_amount: taxAmount,
      tax_rate: taxRate,
      is_internal_tax: isInternalTax,
      description,
      vendor_name: vendorName,
      voucher_no: voucherNo,
      voucher_seq: voucherSeq && !isNaN(voucherSeq) ? voucherSeq : null,
      voucher_total_lines: voucherTotal && !isNaN(voucherTotal) ? voucherTotal : null,
      meta: Object.keys(meta).length > 0 ? meta : null,
    });
  }

  return { rows, skipped, errors, headers };
}
