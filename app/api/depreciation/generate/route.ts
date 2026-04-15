import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { enumerateMonthly, type AssetForCalc, type DepreciationMethod } from '@/lib/depreciation/calculator';

export const maxDuration = 30;

/**
 * 減価償却仕訳の自動生成
 * body:
 *   clientId: string | null
 *   period_start: 'YYYY-MM-DD'
 *   period_end:   'YYYY-MM-DD'
 *   mode: 'overwrite' | 'append'
 *   timing: 'monthly' | 'annual'
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const body = await request.json();
    const clientId: string | null = body.clientId ?? null;
    const periodStart: string = body.period_start;
    const periodEnd: string = body.period_end;
    const mode: 'overwrite' | 'append' = body.mode === 'overwrite' ? 'overwrite' : 'append';
    const timing: 'monthly' | 'annual' = body.timing === 'monthly' ? 'monthly' : 'annual';

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

    const { data: assets, error: assetErr } = await assetQuery;
    if (assetErr) return NextResponse.json({ error: assetErr.message }, { status: 500 });

    let ruleQuery = service
      .from('accounting_rules')
      .select('*')
      .eq('user_id', user.id)
      .lte('effective_from_date', periodEnd)
      .order('effective_from_date', { ascending: false })
      .limit(1);
    if (clientId) ruleQuery = ruleQuery.eq('client_id', clientId);
    else ruleQuery = ruleQuery.is('client_id', null);

    const { data: ruleRows } = await ruleQuery;
    const rule = ruleRows?.[0] ?? {
      depreciation_method_tangible: 'indirect',
      depreciation_method_intangible: 'direct',
      depreciation_method_deferred: 'direct',
    };

    const creditAccountFor = (category: string, assetAccountName: string): string => {
      const key = category === 'tangible' ? 'depreciation_method_tangible'
        : category === 'intangible' ? 'depreciation_method_intangible'
        : 'depreciation_method_deferred';
      return rule[key] === 'indirect' ? '減価償却累計額' : assetAccountName;
    };

    const rows: Record<string, unknown>[] = [];
    const targetAssetIds: string[] = [];
    const periodStartDate = new Date(periodStart);
    const periodEndDate = new Date(periodEnd);

    for (const asset of assets ?? []) {
      if (!asset.useful_life_years || asset.useful_life_years <= 0) continue;
      if (!asset.depreciation_start_date) continue;
      if (asset.method === 'units_of_production') continue; // 未対応

      const calcAsset: AssetForCalc = {
        acquisition_cost: Number(asset.acquisition_cost),
        residual_value: Number(asset.residual_value),
        useful_life_years: asset.useful_life_years,
        method: asset.method as DepreciationMethod,
        depreciation_start_date: asset.depreciation_start_date,
      };

      const months = enumerateMonthly(calcAsset, periodStartDate, periodEndDate);
      if (months.length === 0) continue;

      const creditAccount = creditAccountFor(asset.category, asset.account_name);
      const debitAccount = '減価償却費';

      if (timing === 'monthly') {
        for (const m of months) {
          const ymd = `${m.year}${String(m.month).padStart(2, '0')}${String(m.lastDay.getDate()).padStart(2, '0')}`;
          const periodLabel = `${m.year}-${String(m.month).padStart(2, '0')}`;
          rows.push({
            user_id: user.id,
            client_id: clientId,
            entry_type: 'depreciation',
            entry_date: ymd,
            debit_account: debitAccount,
            credit_account: creditAccount,
            amount: m.amount,
            description: `${asset.name} 減価償却 ${periodLabel}`,
            tax_type: '対象外',
            vendor_name: '',
            match_status: 'closing',
            source_fixed_asset_id: asset.id,
            depreciation_period: periodLabel,
          });
        }
      } else {
        // 年次: 期間内の月合計を期末日に1件
        const total = months.reduce((s, r) => s + r.amount, 0);
        if (total <= 0) continue;
        const endY = periodEndDate.getFullYear();
        const endM = periodEndDate.getMonth() + 1;
        const endD = periodEndDate.getDate();
        const ymd = `${endY}${String(endM).padStart(2, '0')}${String(endD).padStart(2, '0')}`;
        const periodLabel = `${endY}`;
        rows.push({
          user_id: user.id,
          client_id: clientId,
          entry_type: 'depreciation',
          entry_date: ymd,
          debit_account: debitAccount,
          credit_account: creditAccount,
          amount: total,
          description: `${asset.name} 減価償却 ${periodLabel}年度`,
          tax_type: '対象外',
          vendor_name: '',
          match_status: 'closing',
          source_fixed_asset_id: asset.id,
          depreciation_period: periodLabel,
        });
      }

      targetAssetIds.push(asset.id);
    }

    const startYmd = periodStart.replace(/-/g, '');
    const endYmd = periodEnd.replace(/-/g, '');

    if (mode === 'overwrite' && targetAssetIds.length > 0) {
      await service
        .from('journal_entries')
        .delete()
        .eq('user_id', user.id)
        .eq('entry_type', 'depreciation')
        .in('source_fixed_asset_id', targetAssetIds)
        .gte('entry_date', startYmd)
        .lte('entry_date', endYmd);
    }

    let rowsToInsert = rows;
    if (mode === 'append' && targetAssetIds.length > 0) {
      const { data: existing } = await service
        .from('journal_entries')
        .select('source_fixed_asset_id, depreciation_period')
        .eq('user_id', user.id)
        .eq('entry_type', 'depreciation')
        .in('source_fixed_asset_id', targetAssetIds)
        .gte('entry_date', startYmd)
        .lte('entry_date', endYmd);

      const existingSet = new Set<string>();
      for (const e of existing ?? []) {
        existingSet.add(`${e.source_fixed_asset_id}:${e.depreciation_period}`);
      }
      rowsToInsert = rows.filter(
        (r) => !existingSet.has(`${r.source_fixed_asset_id}:${r.depreciation_period}`)
      );
    }

    if (rowsToInsert.length > 0) {
      const { error: insErr } = await service.from('journal_entries').insert(rowsToInsert);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    for (const assetId of targetAssetIds) {
      const lastLabel = timing === 'monthly'
        ? (() => {
            const d = new Date(periodEnd);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          })()
        : `${new Date(periodEnd).getFullYear()}`;
      await service
        .from('fixed_assets')
        .update({ last_depreciated_through: lastLabel })
        .eq('id', assetId);
    }

    return NextResponse.json({
      success: true,
      inserted: rowsToInsert.length,
      skipped: rows.length - rowsToInsert.length,
    });
  } catch (error) {
    console.error('depreciation generate エラー:', error);
    const message = error instanceof Error ? error.message : '生成に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
