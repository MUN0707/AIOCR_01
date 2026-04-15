import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

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

  let assetQuery = service
    .from('fixed_assets')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'active');
  if (clientId) assetQuery = assetQuery.eq('client_id', clientId);
  else assetQuery = assetQuery.is('client_id', null);
  const { data: assets } = await assetQuery;

  const startYmd = periodStart.replace(/-/g, '');
  const endYmd = periodEnd.replace(/-/g, '');

  let entryQuery = service
    .from('journal_entries')
    .select('source_fixed_asset_id, amount')
    .eq('user_id', user.id)
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
    const depreciable = Number(a.acquisition_cost) - Number(a.residual_value);
    if (depreciable <= 0) continue;
    const annual = Math.floor(depreciable / a.useful_life_years);

    const start = new Date(a.depreciation_start_date);
    const ps = new Date(periodStart);
    const pe = new Date(periodEnd);
    const effStart = start > ps ? start : ps;
    if (effStart > pe) continue;
    const months = (pe.getFullYear() - effStart.getFullYear()) * 12 + (pe.getMonth() - effStart.getMonth()) + 1;
    const required = Math.floor((annual / 12) * Math.max(months, 0));

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
