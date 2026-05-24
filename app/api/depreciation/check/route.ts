import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { theoreticalInPeriod, type AssetForCalc, type DepreciationMethod } from '@/lib/depreciation/calculator';
import { resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

/**
 * 当期の減価償却額が理論値と一致するかをチェック
 * ?clientId=...&period_start=YYYY-MM-DD&period_end=YYYY-MM-DD
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const clientId = request.nextUrl.searchParams.get('clientId');
  const periodStart = request.nextUrl.searchParams.get('period_start') ?? '';
  const periodEnd = request.nextUrl.searchParams.get('period_end') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    return NextResponse.json({ error: '期間が不正です' }, { status: 400 });
  }

  const service = createServiceClient();

  let ownerUserId = user.id;
  if (clientId) {
    const scope = await resolveClientScope(service, user.id, clientId);
    if (!scope) return NextResponse.json({ error: 'この会社へのアクセス権限がありません' }, { status: 403 });
    ownerUserId = scope.ownerUserId;
  }

  let assetQuery = service
    .from('fixed_assets')
    .select('*')
    .eq('user_id', ownerUserId)
    .eq('status', 'active');
  if (clientId) assetQuery = assetQuery.eq('client_id', clientId);
  else assetQuery = assetQuery.is('client_id', null);
  const { data: assets } = await assetQuery;

  const startYmd = periodStart.replace(/-/g, '');
  const endYmd = periodEnd.replace(/-/g, '');

  let entryQuery = service
    .from('journal_entries')
    .select('source_fixed_asset_id, amount')
    .eq('user_id', ownerUserId)
    .eq('entry_type', 'depreciation')
    .gte('entry_date', startYmd)
    .lte('entry_date', endYmd);
  if (clientId) entryQuery = entryQuery.eq('client_id', clientId);
  else entryQuery = entryQuery.is('client_id', null);
  const { data: entries } = await entryQuery;

  const postedByAsset = new Map<string, number>();
  for (const e of entries ?? []) {
    if (!e.source_fixed_asset_id) continue;
    postedByAsset.set(
      e.source_fixed_asset_id,
      (postedByAsset.get(e.source_fixed_asset_id) ?? 0) + Number(e.amount ?? 0)
    );
  }

  const rows: Array<{
    asset_id: string;
    asset_number: number;
    name: string;
    category: string;
    required: number;
    posted: number;
    diff: number;
  }> = [];

  let totalRequired = 0;
  let totalPosted = 0;

  for (const a of assets ?? []) {
    if (!a.useful_life_years || !a.depreciation_start_date) continue;
    if (a.method === 'units_of_production') continue;
    const calcAsset: AssetForCalc = {
      acquisition_cost: Number(a.acquisition_cost),
      residual_value: Number(a.residual_value),
      useful_life_years: a.useful_life_years,
      method: a.method as DepreciationMethod,
      depreciation_start_date: a.depreciation_start_date,
    };
    const required = theoreticalInPeriod(calcAsset, new Date(periodStart), new Date(periodEnd));
    if (required <= 0 && (postedByAsset.get(a.id) ?? 0) === 0) continue;

    const posted = postedByAsset.get(a.id) ?? 0;
    totalRequired += required;
    totalPosted += posted;
    rows.push({
      asset_id: a.id,
      asset_number: a.asset_number,
      name: a.name,
      category: a.category,
      required,
      posted,
      diff: posted - required,
    });
  }

  return NextResponse.json({
    rows,
    total_required: totalRequired,
    total_posted: totalPosted,
    total_diff: totalPosted - totalRequired,
  });
}
