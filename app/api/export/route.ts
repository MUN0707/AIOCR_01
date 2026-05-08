import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 30;

type ExportFormat = 'freee' | 'yayoi' | 'mf';

function escapeCsv(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function row(...cols: unknown[]): string {
  return cols.map(escapeCsv).join(',');
}

function buildFreee(entries: Record<string, unknown>[]): string {
  const header = row('取引日', '借方勘定科目', '借方補助科目', '借方税区分', '借方金額(税込)', '貸方勘定科目', '貸方補助科目', '貸方税区分', '貸方金額(税込)', '摘要', '管理番号', 'タグ', 'メモ');
  const TAX_MAP: Record<string, string> = {
    taxable_sales: '課税売上10%', tax_exempt_sales: '非課税売上', taxable_purchase: '課税仕入10%', non_taxable: '対象外',
  };
  const lines = entries.map(e => {
    const date = String(e.entry_date ?? '').replace(/(\d{4})(\d{2})(\d{2})/, '$1/$2/$3');
    const amount = e.debit_amount ?? e.amount ?? 0;
    const taxLabel = TAX_MAP[String(e.tax_category ?? '')] ?? '';
    return row(
      date,
      e.debit_account ?? '', '', taxLabel, amount,
      e.credit_account ?? '', '', taxLabel, e.credit_amount ?? e.amount ?? 0,
      e.description ?? '', '', '', ''
    );
  });
  return '﻿' + [header, ...lines].join('\r\n');
}

function buildYayoi(entries: Record<string, unknown>[]): string {
  const header = row('伝票No.', '決算', '取引日付', '借方科目', '借方補助科目', '借方部門', '借方消費税コード', '借方消費税額計算', '借方金額', '貸方科目', '貸方補助科目', '貸方部門', '貸方消費税コード', '貸方消費税額計算', '貸方金額', '摘要');
  const TAX_CODE: Record<string, string> = {
    taxable_sales: '10', tax_exempt_sales: '0', taxable_purchase: '10', non_taxable: '0',
  };
  const lines = entries.map((e, i) => {
    const date = String(e.entry_date ?? '').replace(/(\d{4})(\d{2})(\d{2})/, '$1/$2/$3');
    const taxCode = TAX_CODE[String(e.tax_category ?? '')] ?? '0';
    const taxIncluded = taxCode !== '0' ? '1' : '0';
    return row(
      i + 1, '',
      date,
      e.debit_account ?? '', '', '', taxCode, taxIncluded, e.debit_amount ?? e.amount ?? 0,
      e.credit_account ?? '', '', '', taxCode, taxIncluded, e.credit_amount ?? e.amount ?? 0,
      e.description ?? ''
    );
  });
  return '﻿' + [header, ...lines].join('\r\n');
}

function buildMF(entries: Record<string, unknown>[]): string {
  const header = row('取引日', '借方勘定科目', '借方補助科目', '借方税区分', '借方金額（税抜）', '借方消費税額', '貸方勘定科目', '貸方補助科目', '貸方税区分', '貸方金額（税抜）', '貸方消費税額', '摘要', 'メモ', 'タグ', '管理番号');
  const TAX_MAP: Record<string, string> = {
    taxable_sales: '課税売上（10%）', tax_exempt_sales: '非課税', taxable_purchase: '課税仕入（10%）', non_taxable: '対象外',
  };
  const lines = entries.map(e => {
    const date = String(e.entry_date ?? '').replace(/(\d{4})(\d{2})(\d{2})/, '$1/$2/$3');
    const amount = Number(e.debit_amount ?? e.amount ?? 0);
    const creditAmount = Number(e.credit_amount ?? e.amount ?? 0);
    const taxLabel = TAX_MAP[String(e.tax_category ?? '')] ?? '';
    const taxAmt = e.tax_amount ?? 0;
    return row(
      date,
      e.debit_account ?? '', '', taxLabel, amount, taxAmt,
      e.credit_account ?? '', '', taxLabel, creditAmount, taxAmt,
      e.description ?? '', '', '', ''
    );
  });
  return '﻿' + [header, ...lines].join('\r\n');
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const fmt = (searchParams.get('format') ?? 'freee') as ExportFormat;
  const clientId = searchParams.get('clientId');
  const startDate = searchParams.get('startDate'); // YYYYMMDD
  const endDate = searchParams.get('endDate');

  if (!['freee', 'yayoi', 'mf'].includes(fmt)) {
    return NextResponse.json({ error: '対応フォーマット: freee / yayoi / mf' }, { status: 400 });
  }

  const service = createServiceClient();
  let query = service
    .from('journal_entries')
    .select('entry_date, debit_account, credit_account, debit_amount, credit_amount, amount, tax_amount, tax_category, description')
    .eq('user_id', user.id)
    .order('entry_date')
    .order('created_at');

  if (clientId) query = query.eq('client_id', clientId);
  if (startDate) query = query.gte('entry_date', startDate);
  if (endDate) query = query.lte('entry_date', endDate);

  const { data: entries, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const csvContent =
    fmt === 'freee' ? buildFreee((entries ?? []) as Record<string, unknown>[]) :
    fmt === 'yayoi' ? buildYayoi((entries ?? []) as Record<string, unknown>[]) :
    buildMF((entries ?? []) as Record<string, unknown>[]);

  const FORMAT_NAMES: Record<ExportFormat, string> = { freee: 'freee仕訳帳', yayoi: '弥生会計', mf: 'MFクラウド会計' };
  const filename = `${FORMAT_NAMES[fmt]}_${startDate ?? 'all'}_${endDate ?? 'all'}.csv`;

  return new NextResponse(csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
