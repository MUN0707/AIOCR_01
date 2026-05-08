import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import * as XLSX from 'xlsx';

export const maxDuration = 30;

// ─── 試算表（Trial Balance）────────────────────────────────────────────
async function buildTrialBalance(
  userId: string,
  clientId: string | null,
  startDate: string,
  endDate: string,
): Promise<XLSX.WorkBook> {
  const service = createServiceClient();

  const { data: rpcRows, error } = await service.rpc('compute_journal_balance', {
    p_user_id: userId,
    p_client_id: clientId,
    p_start_date: startDate,
    p_end_date: endDate,
  });
  if (error) throw new Error(error.message);

  // account ごとに借方・貸方を集計
  const balMap: Record<string, { debit: number; credit: number }> = {};
  for (const r of (rpcRows ?? []) as { side: string; account: string; amount: number | string }[]) {
    const acc = r.account;
    const amt = Number(r.amount) || 0;
    if (!balMap[acc]) balMap[acc] = { debit: 0, credit: 0 };
    if (r.side === 'debit') balMap[acc].debit += amt;
    else balMap[acc].credit += amt;
  }

  const { data: acctRows } = await service
    .from('accounts')
    .select('name, category, sub_category, display_order')
    .eq('user_id', userId);

  const metaByName = new Map((acctRows ?? []).map((a) => [a.name, a]));

  const CATEGORY_ORDER: Record<string, number> = { asset: 1, liability: 2, equity: 3, revenue: 4, expense: 5 };
  const CATEGORY_LABEL: Record<string, string> = { asset: '資産', liability: '負債', equity: '純資産', revenue: '収益', expense: '費用' };
  const SUB_ORDER: Record<string, number> = {
    '流動資産': 1, '固定資産': 2, '繰延資産': 3,
    '流動負債': 1, '固定負債': 2,
    '売上原価': 1, '販管費': 2,
  };

  type Row = { name: string; category: string; sub: string; order: number; debit: number; credit: number; balance: number };
  const rows: Row[] = Object.entries(balMap).map(([name, b]) => {
    const meta = metaByName.get(name);
    const cat = meta?.category ?? '';
    const isBs = ['asset', 'liability', 'equity'].includes(cat);
    const isDebitNormal = ['asset', 'expense'].includes(cat);
    const balance = isBs
      ? (isDebitNormal ? b.debit - b.credit : b.credit - b.debit)
      : (isDebitNormal ? b.debit - b.credit : b.credit - b.debit);
    return { name, category: cat, sub: meta?.sub_category ?? '', order: meta?.display_order ?? 0, debit: b.debit, credit: b.credit, balance };
  });
  rows.sort((a, b) => {
    const co = (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99);
    if (co !== 0) return co;
    const so = (SUB_ORDER[a.sub] ?? 99) - (SUB_ORDER[b.sub] ?? 99);
    if (so !== 0) return so;
    if (a.order !== b.order) return a.order - b.order;
    return a.name.localeCompare(b.name, 'ja');
  });

  const wsData: (string | number)[][] = [
    ['試算表'],
    [`期間: ${startDate || '全期間開始'} 〜 ${endDate || '全期間終了'}`],
    [],
    ['カテゴリ', 'サブカテゴリ', '勘定科目', '借方合計', '貸方合計', '残高'],
  ];
  for (const r of rows) {
    wsData.push([CATEGORY_LABEL[r.category] ?? r.category, r.sub, r.name, r.debit, r.credit, r.balance]);
  }
  // 合計行
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  wsData.push([]);
  wsData.push(['', '', '合計', totalDebit, totalCredit, '']);

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '試算表');
  return wb;
}

// ─── 総勘定元帳（General Ledger）─────────────────────────────────────
async function buildGeneralLedger(
  userId: string,
  clientId: string | null,
  startDate: string,
  endDate: string,
  accountFilter: string,
): Promise<XLSX.WorkBook> {
  const service = createServiceClient();

  const { data: rpcRows, error } = await service.rpc('fetch_journal_ledger', {
    p_user_id: userId,
    p_client_id: clientId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_account_filter: accountFilter,
    p_search_debit: '',
    p_search_credit: '',
    p_search_amount: '',
    p_search_date: '',
    p_search_description: '',
    p_limit: 100000,
  });
  if (error) throw new Error(error.message);

  const row = (rpcRows ?? [])[0] ?? { entries: [] };
  type Entry = { id: string; entry_date: string; debit_account: string; credit_account: string; amount: number; description: string; tax_category: string };
  const entries = (Array.isArray(row.entries) ? row.entries : []) as Entry[];

  const TAX_LABEL: Record<string, string> = {
    taxable_sales: '課税売上', non_taxable_sales: '非課税売上',
    taxable_purchase: '課税仕入', exempt: '免税・不課税',
  };

  const wsData: (string | number | null)[][] = [
    ['総勘定元帳'],
    [`期間: ${startDate || '全期間開始'} 〜 ${endDate || '全期間終了'}${accountFilter ? `　科目: ${accountFilter}` : ''}`],
    [],
    ['日付', '借方科目', '貸方科目', '金額', '摘要', '消費税区分'],
  ];
  for (const e of entries) {
    wsData.push([
      e.entry_date ?? '',
      e.debit_account ?? '',
      e.credit_account ?? '',
      Number(e.amount) || 0,
      e.description ?? '',
      e.tax_category ? (TAX_LABEL[e.tax_category] ?? e.tax_category) : '',
    ]);
  }
  const totalAmt = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  wsData.push([]);
  wsData.push(['', '', '合計', totalAmt, '', '']);

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 30 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '総勘定元帳');
  return wb;
}

// ─── 固定資産台帳（Fixed Assets Register）────────────────────────────
async function buildFixedAssets(
  userId: string,
  clientId: string | null,
): Promise<XLSX.WorkBook> {
  const service = createServiceClient();

  let q = service
    .from('fixed_assets')
    .select('asset_number, category, name, account_name, acquisition_date, depreciation_start_date, acquisition_cost, residual_value, useful_life_years, method, last_depreciated_through, status, note')
    .eq('user_id', userId)
    .order('asset_number', { ascending: true });
  if (clientId) q = q.eq('client_id', clientId);
  else q = q.is('client_id', null);
  const { data: assets, error: err2 } = await q;
  if (err2) throw new Error(err2.message);

  const CAT_LABEL: Record<string, string> = { tangible: '有形固定資産', intangible: '無形固定資産', deferred: '繰延資産' };
  const STATUS_LABEL: Record<string, string> = { pending: '準備中', active: '活動中', disposed: '除却済' };
  const METHOD_LABEL: Record<string, string> = { straight_line: '定額法', declining: '定率法', units_of_production: '生産高比例法' };

  const wsData: (string | number | null)[][] = [
    ['固定資産台帳'],
    [],
    ['No.', '区分', '資産名', '勘定科目', '取得日', '償却開始日', '取得価額', '残存価額', '耐用年数', '償却方法', '最終償却年月', '状態', '備考'],
  ];
  for (const a of (assets ?? [])) {
    wsData.push([
      a.asset_number,
      CAT_LABEL[a.category] ?? a.category,
      a.name,
      a.account_name,
      a.acquisition_date ?? '',
      a.depreciation_start_date ?? '',
      Number(a.acquisition_cost) || 0,
      Number(a.residual_value) || 0,
      a.useful_life_years ?? '',
      METHOD_LABEL[a.method] ?? a.method,
      a.last_depreciated_through ?? '',
      STATUS_LABEL[a.status] ?? a.status,
      a.note ?? '',
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [
    { wch: 6 }, { wch: 12 }, { wch: 20 }, { wch: 16 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 8 }, { wch: 20 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '固定資産台帳');
  return wb;
}

// ─── ハンドラ ──────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') ?? '';
  const clientId = searchParams.get('clientId') || null;
  const startDate = searchParams.get('startDate') ?? '';
  const endDate = searchParams.get('endDate') ?? '';
  const account = searchParams.get('account') ?? '';

  let wb: XLSX.WorkBook;
  let filename: string;

  try {
    if (type === 'trial-balance') {
      wb = await buildTrialBalance(user.id, clientId, startDate, endDate);
      const period = startDate && endDate ? `_${startDate}_${endDate}` : '';
      filename = `試算表${period}.xlsx`;
    } else if (type === 'general-ledger') {
      wb = await buildGeneralLedger(user.id, clientId, startDate, endDate, account);
      const acct = account ? `_${account}` : '';
      filename = `総勘定元帳${acct}.xlsx`;
    } else if (type === 'fixed-assets') {
      wb = await buildFixedAssets(user.id, clientId);
      filename = '固定資産台帳.xlsx';
    } else {
      return NextResponse.json({ error: 'type パラメータが不正です (trial-balance | general-ledger | fixed-assets)' }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'エクスポートに失敗しました';
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const encodedFilename = encodeURIComponent(filename);

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodedFilename}`,
    },
  });
}
