/**
 * フォービス (047) の freee 仕訳CSV を再インポートする ad-hoc スクリプト。
 *
 * 古いパーサーで投入された 10329 件は事前に DELETE 済みである前提。
 * Storage の `error-screenshots/<userId>/...___2603.csv` (生CSV) を取得し、
 * lib/csv-import-presets.ts と同等のロジックで freee 高度パースを行い、
 * service_role で直接 INSERT する。
 *
 * 実行: SUPABASE_SERVICE_ROLE_KEY=... node scripts/reimport-foovis.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// .env.local 読み込み (簡易)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です');
  process.exit(1);
}

const USER_ID = '7c598ad4-21e0-412c-8698-8b1c8240fe80';
const CLIENT_ID = '6543fccd-836b-4b2b-b6df-95e3145f8cd7';
const STORAGE_BUCKET = 'error-screenshots';
const STORAGE_PATH = '7c598ad4-21e0-412c-8698-8b1c8240fe80/1777359576979-___2603.csv';

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ─── CSV パース ─────────────────────────────────────────────────────────────

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(current.trim()); current = ''; }
      else current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function normalizeHeaderName(s) {
  return s.replace(/[\s　"]/g, '');
}

function resolveColumnIndex(headers, candidates) {
  for (const cand of candidates) {
    const idx = headers.findIndex((h) => normalizeHeaderName(h) === normalizeHeaderName(cand));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseAmount(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/[,，\s¥\\]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseRate(raw) {
  if (!raw) return '';
  const m = raw.match(/(\d{1,2})/);
  return m ? m[1] : '';
}

function parseInternalTax(raw) {
  if (!raw) return null;
  if (raw.includes('内税')) return true;
  if (raw.includes('外税') || raw.includes('対象外')) return false;
  return null;
}

function defaultDateParser(raw) {
  if (!raw) return '';
  const wareki = raw.match(/^[RrＲ]\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (wareki) {
    const year = 2018 + parseInt(wareki[1], 10);
    return `${year}${wareki[2].padStart(2, '0')}${wareki[3].padStart(2, '0')}`;
  }
  const m = raw.match(/(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (m) return `${m[1]}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}`;
  if (/^\d{8}$/.test(raw.trim())) return raw.trim();
  return raw;
}

function parseFreeeAdvanced(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], skipped: 0, errors: ['データ行がありません'], headers: [] };
  const headers = parseCsvLine(lines[0]);

  const idx = (cands) => resolveColumnIndex(headers, cands);
  const I = {
    no: idx(['No', 'ＮＯ', 'No.']),
    date: idx(['取引日', '発生日', '日付']),
    debit_account: idx(['借方勘定科目']),
    debit_amount: idx(['借方金額']),
    debit_tax_type: idx(['借方税区分']),
    debit_tax_amount: idx(['借方税金額']),
    debit_internal: idx(['借方内税・外税', '借方内税外税']),
    debit_tax_rate: idx(['借方税率']),
    debit_vendor: idx(['借方取引先名']),
    debit_memo: idx(['借方備考']),
    credit_account: idx(['貸方勘定科目']),
    credit_amount: idx(['貸方金額']),
    credit_tax_type: idx(['貸方税区分']),
    credit_tax_amount: idx(['貸方税金額']),
    credit_internal: idx(['貸方内税・外税', '貸方内税外税']),
    credit_tax_rate: idx(['貸方税率']),
    credit_vendor: idx(['貸方取引先名']),
    credit_memo: idx(['貸方備考']),
    voucher_seq: idx(['仕訳行番号']),
    voucher_total: idx(['仕訳行数']),
  };

  const errors = [];
  if (I.date === -1) errors.push('取引日列が見つかりません');
  if (I.no === -1) errors.push('No列が見つかりません');
  if (I.debit_account === -1 && I.credit_account === -1) errors.push('借方/貸方勘定科目列が見つかりません');
  if (errors.length > 0) return { rows: [], skipped: 0, errors, headers };

  const get = (cells, i) => i === -1 ? '' : (cells[i] ?? '');

  const rows = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const debit = get(cells, I.debit_account);
    const credit = get(cells, I.credit_account);
    if (!debit && !credit) { skipped++; continue; }

    const debitAmount = parseAmount(get(cells, I.debit_amount));
    const creditAmount = parseAmount(get(cells, I.credit_amount));
    const debitTaxAmt = parseAmount(get(cells, I.debit_tax_amount));
    const creditTaxAmt = parseAmount(get(cells, I.credit_tax_amount));
    const taxAmount = (debitTaxAmt && debitTaxAmt !== 0) ? debitTaxAmt
                     : (creditTaxAmt && creditTaxAmt !== 0) ? creditTaxAmt : null;

    const taxRate = parseRate(get(cells, I.debit_tax_rate)) || parseRate(get(cells, I.credit_tax_rate));
    const dInt = parseInternalTax(get(cells, I.debit_internal));
    const cInt = parseInternalTax(get(cells, I.credit_internal));
    const isInternalTax = dInt !== null ? dInt : cInt;

    const taxType = get(cells, I.debit_tax_type) || get(cells, I.credit_tax_type);
    const vendorName = get(cells, I.debit_vendor) || get(cells, I.credit_vendor);
    const description = get(cells, I.debit_memo) || get(cells, I.credit_memo);

    const voucherNo = get(cells, I.no) || null;
    const seqRaw = get(cells, I.voucher_seq);
    const totalRaw = get(cells, I.voucher_total);
    const voucherSeq = seqRaw ? parseInt(seqRaw, 10) : null;
    const voucherTotal = totalRaw ? parseInt(totalRaw, 10) : null;

    const meta = {};
    for (let h = 0; h < headers.length; h++) {
      const v = cells[h];
      if (v && v.trim() !== '') meta[headers[h]] = v;
    }

    rows.push({
      entry_date: defaultDateParser(get(cells, I.date)) || '不明',
      debit_account: debit || '',
      credit_account: credit || '',
      amount: debitAmount ?? creditAmount,
      debit_amount: debitAmount,
      credit_amount: creditAmount,
      tax_type: taxType,
      tax_amount: taxAmount,
      tax_rate: taxRate || null,
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

// ─── 勘定科目分類 (lib/account-category-classifier.ts と同等) ─────────────────

const EXACT_MAP = {
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
  '資本金': { category: 'equity', sub_category: '株主資本' },
  '資本準備金': { category: 'equity', sub_category: '株主資本' },
  '利益準備金': { category: 'equity', sub_category: '株主資本' },
  '繰越利益剰余金': { category: 'equity', sub_category: '株主資本' },
  '売上高': { category: 'revenue', sub_category: '売上高' },
  '売上': { category: 'revenue', sub_category: '売上高' },
  '受取利息': { category: 'revenue', sub_category: '営業外収益' },
  '受取配当金': { category: 'revenue', sub_category: '営業外収益' },
  '雑収入': { category: 'revenue', sub_category: '営業外収益' },
  '仕入高': { category: 'expense', sub_category: '売上原価' },
  '仕入': { category: 'expense', sub_category: '売上原価' },
  '外注費': { category: 'expense', sub_category: '売上原価' },
  '業務委託費': { category: 'expense', sub_category: '売上原価' },
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
  '支払利息': { category: 'expense', sub_category: '営業外費用' },
  '雑損失': { category: 'expense', sub_category: '営業外費用' },
};

function classifyAccount(name) {
  const t = name.trim();
  if (!t) return { category: 'uncategorized', sub_category: null };
  if (EXACT_MAP[t]) return EXACT_MAP[t];

  if (/^未払/.test(t) || /^前受/.test(t) || /^仮受/.test(t) || /^預り/.test(t)) {
    return { category: 'liability', sub_category: '流動負債' };
  }
  if (/借入金$/.test(t)) {
    return t.startsWith('長期')
      ? { category: 'liability', sub_category: '固定負債' }
      : { category: 'liability', sub_category: '流動負債' };
  }
  if (/^前払/.test(t) || /^仮払/.test(t) || /^立替/.test(t)) {
    return { category: 'asset', sub_category: '流動資産' };
  }
  if (/(預金|現金)$/.test(t)) return { category: 'asset', sub_category: '流動資産' };
  if (/掛金$/.test(t) && !t.startsWith('買')) return { category: 'asset', sub_category: '流動資産' };
  if (/売上/.test(t) || /^受取/.test(t)) return { category: 'revenue', sub_category: '売上高' };
  if (/(費|料|代|損)$/.test(t)) return { category: 'expense', sub_category: '販管費' };
  if (/手数料/.test(t)) return { category: 'expense', sub_category: '販管費' };
  return { category: 'uncategorized', sub_category: null };
}

function normalizeVendorKey(name) {
  if (!name) return '';
  return name
    .replace(/株式会社|有限会社|合同会社|合名会社|合資会社|一般社団法人|公益社団法人|一般財団法人|公益財団法人|NPO法人|医療法人|学校法人|宗教法人|社会福祉法人/g, '')
    .replace(/㈱|㈲|㈳|㈵/g, '')
    .replace(/（株）|\(株\)|（有）|\(有\)|（合）|\(合\)/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .replace(/[　\s・･\-_／/]/g, '')
    .toLowerCase()
    .trim();
}

// ─── メイン ─────────────────────────────────────────────────────────────────

async function main() {
  // 二重挿入防止: 既存 journal_entries が残っていたら停止
  const { count: existingCount } = await service
    .from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', USER_ID)
    .eq('client_id', CLIENT_ID);
  if ((existingCount ?? 0) > 0) {
    console.error(`既に journal_entries が ${existingCount} 件残っています。`);
    console.error('再実行する前に DELETE を済ませてください。');
    process.exit(1);
  }

  console.log('Storage から CSV をダウンロード中...');
  const { data: blob, error: dlErr } = await service.storage
    .from(STORAGE_BUCKET)
    .download(STORAGE_PATH);
  if (dlErr || !blob) {
    console.error('ダウンロード失敗:', dlErr?.message);
    process.exit(1);
  }

  const buffer = Buffer.from(await blob.arrayBuffer());
  console.log(`CSV size: ${buffer.length} bytes`);

  // 4/28 アップロードのCSVは生(非圧縮)、Shift-JIS(cp932)
  const csvText = new TextDecoder('shift-jis').decode(buffer);
  console.log(`デコード完了: ${csvText.length} chars`);

  const result = parseFreeeAdvanced(csvText);
  if (result.errors.length > 0) {
    console.error('パースエラー:', result.errors);
    process.exit(1);
  }
  console.log(`パース完了: ${result.rows.length} 行 (skipped: ${result.skipped})`);

  // 仕訳番号(No)ごとの uuid 発番
  const voucherUuidMap = new Map();
  const getVoucherGroupId = (no) => {
    if (!no) return null;
    let u = voucherUuidMap.get(no);
    if (!u) { u = randomUUID(); voucherUuidMap.set(no, u); }
    return u;
  };

  // 借方・貸方科目を集めて自動登録
  const accountNames = new Set();
  const sampleByName = new Map();
  for (const r of result.rows) {
    if (r.debit_account && r.debit_account !== '不明') {
      accountNames.add(r.debit_account);
      if (!sampleByName.has(r.debit_account)) sampleByName.set(r.debit_account, r);
    }
    if (r.credit_account && r.credit_account !== '不明') {
      accountNames.add(r.credit_account);
      if (!sampleByName.has(r.credit_account)) sampleByName.set(r.credit_account, r);
    }
  }

  const { data: existingAccounts } = await service
    .from('accounts')
    .select('name')
    .eq('user_id', USER_ID)
    .eq('client_id', CLIENT_ID)
    .in('name', Array.from(accountNames));
  const existingAccountSet = new Set((existingAccounts ?? []).map((a) => a.name));

  const pickReadingFromMeta = (name, meta) => {
    if (!meta) return '';
    if (meta['借方勘定科目'] === name) {
      const r = meta['借方勘定科目ショートカット１'];
      if (r && /^[A-Za-z]/.test(r)) return r.toLowerCase();
    }
    if (meta['貸方勘定科目'] === name) {
      const r = meta['貸方勘定科目ショートカット１'];
      if (r && /^[A-Za-z]/.test(r)) return r.toLowerCase();
    }
    return '';
  };

  const accountsToInsert = Array.from(accountNames)
    .filter((n) => !existingAccountSet.has(n))
    .map((name) => {
      const cls = classifyAccount(name);
      const sample = sampleByName.get(name);
      return {
        user_id: USER_ID,
        client_id: CLIENT_ID,
        name,
        reading: pickReadingFromMeta(name, sample?.meta),
        category: cls.category,
        sub_category: cls.sub_category,
        auto_registered: true,
        confirmed: cls.category !== 'uncategorized',
      };
    });

  if (accountsToInsert.length > 0) {
    // 式インデックス (COALESCE) のため onConflict が使えない → existingSet で除外済みなので素の insert
    const { error: accErr } = await service.from('accounts').insert(accountsToInsert);
    if (accErr) console.warn('accounts insert 警告:', accErr.message);
    console.log(`accounts 自動登録: ${accountsToInsert.length} 件`);
  } else {
    console.log('accounts 自動登録: 0 件（全て既存）');
  }

  // 取引先を集めて自動登録
  const namesByKey = new Map();
  for (const r of result.rows) {
    const name = (r.vendor_name ?? '').trim();
    if (!name) continue;
    const key = normalizeVendorKey(name);
    if (!key) continue;
    if (!namesByKey.has(key)) namesByKey.set(key, name);
  }

  const { data: existingVendors } = await service
    .from('vendors')
    .select('normalized_key')
    .eq('user_id', USER_ID)
    .eq('client_id', CLIENT_ID)
    .in('normalized_key', Array.from(namesByKey.keys()));
  const existingKeySet = new Set((existingVendors ?? []).map((v) => v.normalized_key));

  const vendorsToInsert = Array.from(namesByKey.entries())
    .filter(([key]) => !existingKeySet.has(key))
    .map(([normalized_key, name]) => ({
      user_id: USER_ID,
      client_id: CLIENT_ID,
      name,
      normalized_key,
      reading: '',
    }));

  if (vendorsToInsert.length > 0) {
    const { error: venErr } = await service.from('vendors').insert(vendorsToInsert);
    if (venErr) console.warn('vendors insert 警告:', venErr.message);
    console.log(`vendors 自動登録: ${vendorsToInsert.length} 件`);
  } else {
    console.log('vendors 自動登録: 0 件（全て既存）');
  }

  // journal_entries バッチ insert
  const insertRows = result.rows.map((r) => ({
    user_id: USER_ID,
    client_id: CLIENT_ID,
    entry_type: 'manual',
    entry_date: r.entry_date,
    debit_account: r.debit_account,
    credit_account: r.credit_account,
    amount: r.amount,
    debit_amount: r.debit_amount,
    credit_amount: r.credit_amount,
    tax_amount: r.tax_amount,
    tax_rate: r.tax_rate,
    is_internal_tax: r.is_internal_tax,
    description: r.description,
    tax_type: r.tax_type,
    vendor_name: r.vendor_name,
    voucher_group_id: getVoucherGroupId(r.voucher_no),
    voucher_seq: r.voucher_seq,
    voucher_total_lines: r.voucher_total_lines,
    meta: r.meta,
    match_status: 'imported',
  }));

  console.log(`journal_entries に ${insertRows.length} 件挿入開始...`);
  const BATCH = 500;
  let total = 0;
  for (let i = 0; i < insertRows.length; i += BATCH) {
    const batch = insertRows.slice(i, i + BATCH);
    const { error } = await service.from('journal_entries').insert(batch);
    if (error) {
      console.error(`バッチ ${i} で失敗: ${error.message}`);
      process.exit(1);
    }
    total += batch.length;
    process.stdout.write(`\r  insert: ${total}/${insertRows.length}`);
  }
  console.log(`\n完了: ${total} 件挿入、voucher 数: ${voucherUuidMap.size}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
