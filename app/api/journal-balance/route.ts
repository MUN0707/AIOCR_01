import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { resolveClientScope } from '@/lib/client-access';

export const maxDuration = 30;

const UNREGISTERED_VENDOR = '(取引先未登録)';

interface RpcRow {
  side: 'debit' | 'credit';
  account: string;
  vendor: string;
  amount: number | string;
  entry_count: number | string;
}

interface VendorBucket {
  debit: number;
  credit: number;
  entryCount: number;
}

interface VendorBreakdownRow {
  vendor: string;
  debit: number;
  credit: number;
  entryCount: number;
  isUnregistered: boolean;
}

interface DepreciationEntry {
  id: string;
  source_fixed_asset_id: string;
  entry_date: string | null;
  amount: number | null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');
    const startDate = (searchParams.get('startDate') ?? '').trim();
    const endDate = (searchParams.get('endDate') ?? '').trim();

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const service = createServiceClient();

    // 権限解決
    let ownerUserId = user.id;
    if (clientId) {
      const scope = await resolveClientScope(service, user.id, clientId);
      if (!scope) return NextResponse.json({ error: 'この会社へのアクセス権限がありません' }, { status: 403 });
      ownerUserId = scope.ownerUserId;
    }

    // 集計 RPC
    const { data: rpcRows, error: rpcError } = await service.rpc('compute_journal_balance', {
      p_user_id: ownerUserId,
      p_client_id: clientId,
      p_start_date: startDate,
      p_end_date: endDate,
    });
    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    // 件数
    const { data: countRows, error: countError } = await service.rpc('compute_journal_counts', {
      p_user_id: ownerUserId,
      p_client_id: clientId,
      p_start_date: startDate,
      p_end_date: endDate,
    });
    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }

    // 締め情報
    let closingQuery = service
      .from('journal_closings')
      .select('closed_until')
      .eq('user_id', ownerUserId);
    if (clientId) {
      closingQuery = closingQuery.eq('client_id', clientId);
    } else {
      closingQuery = closingQuery.is('client_id', null);
    }
    const { data: closingRows } = await closingQuery;
    const closedUntil: string | null = closingRows?.[0]?.closed_until ?? null;

    // 固定資産仕訳（FixedAssetSection 用 — 期間フィルタ非対応で全件、ただし source_fixed_asset_id 付きのみ）
    let depQuery = service
      .from('journal_entries')
      .select('id, source_fixed_asset_id, entry_date, amount')
      .eq('user_id', ownerUserId)
      .not('source_fixed_asset_id', 'is', null);
    if (clientId) {
      depQuery = depQuery.eq('client_id', clientId);
    } else {
      depQuery = depQuery.is('client_id', null);
    }
    const { data: depRows, error: depError } = await depQuery;
    if (depError) {
      return NextResponse.json({ error: depError.message }, { status: 500 });
    }

    // RPC結果から {accountBalances, vendorBreakdownByAccount} を構築
    const accountSet = new Set<string>();
    const accountBalances: Record<string, { debit: number; credit: number }> = {};
    const vendorByAccount: Record<string, Record<string, VendorBucket>> = {};

    for (const r of (rpcRows ?? []) as RpcRow[]) {
      const acc = r.account;
      const vendor = r.vendor;
      const amt = Number(r.amount) || 0;
      const cnt = Number(r.entry_count) || 0;

      accountSet.add(acc);
      if (!accountBalances[acc]) accountBalances[acc] = { debit: 0, credit: 0 };
      if (!vendorByAccount[acc]) vendorByAccount[acc] = {};
      if (!vendorByAccount[acc][vendor]) {
        vendorByAccount[acc][vendor] = { debit: 0, credit: 0, entryCount: 0 };
      }
      const bucket = vendorByAccount[acc][vendor];

      if (r.side === 'debit') {
        accountBalances[acc].debit += amt;
        bucket.debit += amt;
      } else {
        accountBalances[acc].credit += amt;
        bucket.credit += amt;
      }
      bucket.entryCount += cnt;
    }

    const accounts = Array.from(accountSet).sort();
    const vendorBreakdownByAccount: Record<string, VendorBreakdownRow[]> = {};
    for (const acc of accounts) {
      const vendorMap = vendorByAccount[acc] ?? {};
      const rows: VendorBreakdownRow[] = Object.entries(vendorMap).map(([vendor, v]) => ({
        vendor,
        debit: v.debit,
        credit: v.credit,
        entryCount: v.entryCount,
        isUnregistered: vendor === UNREGISTERED_VENDOR,
      }));
      rows.sort((a, b) => {
        if (a.isUnregistered !== b.isUnregistered) return a.isUnregistered ? 1 : -1;
        return Math.abs(b.debit - b.credit) - Math.abs(a.debit - a.credit);
      });
      vendorBreakdownByAccount[acc] = rows;
    }

    const counts = (countRows ?? [])[0] ?? { total_count: 0, filtered_count: 0 };

    return NextResponse.json({
      accounts,
      accountBalances,
      vendorBreakdownByAccount,
      totalCount: Number(counts.total_count) || 0,
      filteredCount: Number(counts.filtered_count) || 0,
      closedUntil,
      depreciationEntries: (depRows ?? []) as DepreciationEntry[],
    });
  } catch (error) {
    console.error('残高集計エラー:', error);
    const message = error instanceof Error ? error.message : '残高の取得に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
