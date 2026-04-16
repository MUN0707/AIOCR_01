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
  amount: number | null;    // 金額
  tax_type: string;         // 消費税区分
  description: string;      // 摘要
  vendor_name: string;      // 取引先
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
    tax_type: string[];
    description: string[];
    vendor_name: string[];
  };
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
  // 和暦 → 西暦 の簡易変換
  const warekiMatch = raw.match(/^[RrＲ]\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (warekiMatch) {
    const year = 2018 + parseInt(warekiMatch[1], 10); // 令和元年=2019
    return `${year}${warekiMatch[2].padStart(2, '0')}${warekiMatch[3].padStart(2, '0')}`;
  }
  // 西暦 YYYY/MM/DD or YYYY-MM-DD
  const m = raw.match(/(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (m) {
    return `${m[1]}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}`;
  }
  // すでに YYYYMMDD
  if (/^\d{8}$/.test(raw.trim())) return raw.trim();
  return raw;
}

/** 弥生の日付: "2026/04/15" */
function yayoiDateParser(raw: string): string {
  return defaultDateParser(raw);
}

/** freee の日付: "2026-04-15" */
function freeDateParser(raw: string): string {
  return defaultDateParser(raw);
}

/** マネーフォワードの日付: "2026/04/15" */
function mfDateParser(raw: string): string {
  return defaultDateParser(raw);
}

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
    dateParser: yayoiDateParser,
  },
  {
    id: 'freee',
    label: 'freee会計',
    description: 'freee の仕訳帳CSVダウンロード',
    encoding: 'utf-8',
    skipRows: 0,
    columns: {
      entry_date:     ['発生日', '取引日', '日付'],
      debit_account:  ['借方勘定科目', '借方科目'],
      credit_account: ['貸方勘定科目', '貸方科目'],
      amount:         ['借方金額', '金額', '取引金額'],
      tax_type:       ['借方税区分', '税区分', '消費税区分'],
      description:    ['摘要', '備考', '取引内容'],
      vendor_name:    ['取引先', '取引先名', '相手先'],
    },
    dateParser: freeDateParser,
  },
  {
    id: 'moneyforward',
    label: 'マネーフォワード',
    description: 'マネーフォワード クラウド会計の仕訳帳CSVエクスポート',
    encoding: 'utf-8',
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

/** ヘッダ行から列インデックスマッピングを解決 */
function resolveColumnIndex(
  headers: string[],
  candidates: string[]
): number {
  for (const cand of candidates) {
    const idx = headers.findIndex(
      (h) => h.replace(/[\s\u3000"]/g, '') === cand.replace(/[\s\u3000"]/g, '')
    );
    if (idx !== -1) return idx;
  }
  return -1;
}

export interface ParseResult {
  rows: NormalizedJournalRow[];
  skipped: number;
  errors: string[];
  headers: string[];
}

/** CSV テキストをプリセットに基づいてパースし、正規化済み行を返す */
export function parseCsvWithPreset(csvText: string, preset: CsvPreset): ParseResult {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const errors: string[] = [];

  if (lines.length <= preset.skipRows) {
    return { rows: [], skipped: 0, errors: ['データ行がありません'], headers: [] };
  }

  // ヘッダ行
  const headerLine = lines[preset.skipRows];
  const headers = parseCsvLine(headerLine);

  // 列インデックス解決
  const colMap = {
    entry_date: resolveColumnIndex(headers, preset.columns.entry_date),
    debit_account: resolveColumnIndex(headers, preset.columns.debit_account),
    credit_account: resolveColumnIndex(headers, preset.columns.credit_account),
    amount: resolveColumnIndex(headers, preset.columns.amount),
    tax_type: resolveColumnIndex(headers, preset.columns.tax_type),
    description: resolveColumnIndex(headers, preset.columns.description),
    vendor_name: resolveColumnIndex(headers, preset.columns.vendor_name),
  };

  // 必須列チェック
  if (colMap.entry_date === -1) errors.push('日付列が見つかりません');
  if (colMap.debit_account === -1) errors.push('借方科目列が見つかりません');
  if (colMap.credit_account === -1) errors.push('貸方科目列が見つかりません');
  if (colMap.amount === -1) errors.push('金額列が見つかりません');

  if (errors.length > 0) {
    return { rows: [], skipped: 0, errors, headers };
  }

  const dateParser = preset.dateParser ?? defaultDateParser;
  const rows: NormalizedJournalRow[] = [];
  let skipped = 0;

  for (let i = preset.skipRows + 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const dateRaw = cells[colMap.entry_date] ?? '';
    const entryDate = dateParser(dateRaw);
    const debit = cells[colMap.debit_account] ?? '';
    const credit = cells[colMap.credit_account] ?? '';
    const amountRaw = (cells[colMap.amount] ?? '').replace(/[,，\s¥\\]/g, '');
    const amount = amountRaw ? parseInt(amountRaw, 10) : null;

    // 借方・貸方どちらも空なら空行としてスキップ
    if (!debit && !credit) {
      skipped++;
      continue;
    }

    rows.push({
      entry_date: entryDate || '不明',
      debit_account: debit || '不明',
      credit_account: credit || '不明',
      amount: amount !== null && !isNaN(amount) ? amount : null,
      tax_type: colMap.tax_type !== -1 ? (cells[colMap.tax_type] ?? '') : '',
      description: colMap.description !== -1 ? (cells[colMap.description] ?? '') : '',
      vendor_name: colMap.vendor_name !== -1 ? (cells[colMap.vendor_name] ?? '') : '',
    });
  }

  return { rows, skipped, errors, headers };
}
