import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 30;

/**
 * 減価償却仕訳の自動生成
 * body:
 *   clientId: string | null
 *   period_start: 'YYYY-MM-DD'  (当期首)
 *   period_end:   'YYYY-MM-DD'  (生成対象の最終日)
 *   mode: 'overwrite' | 'append'  (上書き / 未計上月のみ追加)
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

    // 対象資産取得
    let assetQuery = service
      .from('fixed_assets')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active');
    if (clientId) assetQuery = assetQuery.eq('client_id', clientId);
    else assetQuery = assetQuery.is('client_id', null);

    const { data: assets, error: assetErr } = await assetQuery;
    if (assetErr) return NextResponse.json({ error: assetErr.message }, { status: 500 });

    // 会計ルール取得（期間開始日以前で最新）
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

    const creditAccountFor = (category: string): string => {
      if (category === 'tangible') {
        return rule.depreciation_method_tangible === 'indirect' ? '減価償却累計額' : '';
      }
      if (category === 'intangible') {
        return rule.depreciation_method_intangible === 'indirect' ? '減価償却累計額' : '';
      }
      return rule.depreciation_method_deferred === 'indirect' ? '減価償却累計額' : '';
    };

    const rows: Record<string, unknown>[] = [];
    const overwriteAssetIds: string[] = [];

    for (const asset of assets ?? []) {
      if (!asset.useful_life_years || asset.useful_life_years <= 0) continue;
      if (!asset.depreciation_start_date) continue;
      if (asset.method !== 'straight_line') continue; // 定率法等は未対応

      const depreciable = Number(asset.acquisition_cost) - Number(asset.residual_value);
      if (depreciable <= 0) continue;
      const annualAmt = Math.floor(depreciable / asset.useful_life_years);
      const monthlyAmt = Math.floor(annualAmt / 12);

      const startDate = new Date(asset.depreciation_start_date);
      const periodStartDate = new Date(periodStart);
      const periodEndDate = new Date(periodEnd);

      const creditAccount = creditAccountFor(asset.category) || asset.account_name;
      const debitAccount = '減価償却費';

      if (timing === 'monthly') {
        // 月次: 対象期間内の月末ごとに生成
        const cursor = new Date(Math.max(startDate.getTime(), periodStartDate.getTime()));
        cursor.setDate(1);
        while (cursor <= periodEndDate) {
          const y = cursor.getFullYear();
          const m = cursor.getMonth();
          const lastDay = new Date(y, m + 1, 0);
          if (lastDay > periodEndDate) break;
          if (lastDay < startDate) { cursor.setMonth(cursor.getMonth() + 1); continue; }

          const ymd = `${y}${String(m + 1).padStart(2, '0')}${String(lastDay.getDate()).padStart(2, '0')}`;
          const periodLabel = `${y}-${String(m + 1).padStart(2, '0')}`;

          rows.push({
            user_id: user.id,
            client_id: clientId,
            entry_type: 'depreciation',
            entry_date: ymd,
            debit_account: debitAccount,
            credit_account: creditAccount,
            amount: monthlyAmt,
            description: `${asset.name} 減価償却 ${periodLabel}`,
            tax_type: '対象外',
            vendor_name: '',
            match_status: 'closing',
            source_fixed_asset_id: asset.id,
            depreciation_period: periodLabel,
          });

          cursor.setMonth(cursor.getMonth() + 1);
        }
      } else {
        // 年次: 期末日に1件計上（期間内の月数分）
        const monthsInPeriod = countMonthsInPeriod(startDate, periodStartDate, periodEndDate);
        if (monthsInPeriod <= 0) continue;
        const amt = Math.floor((annualAmt / 12) * monthsInPeriod);
        if (amt <= 0) continue;

        const endY = periodEndDate.getFullYear();
        const endM = periodEndDate.getMonth();
        const endD = periodEndDate.getDate();
        const ymd = `${endY}${String(endM + 1).padStart(2, '0')}${String(endD).padStart(2, '0')}`;
        const periodLabel = `${endY}`;

        rows.push({
          user_id: user.id,
          client_id: clientId,
          entry_type: 'depreciation',
          entry_date: ymd,
          debit_account: debitAccount,
          credit_account: creditAccount,
          amount: amt,
          description: `${asset.name} 減価償却 ${periodLabel}年度`,
          tax_type: '対象外',
          vendor_name: '',
          match_status: 'closing',
          source_fixed_asset_id: asset.id,
          depreciation_period: periodLabel,
        });
      }

      overwriteAssetIds.push(asset.id);
    }

    // 上書きモード: 既存仕訳を削除
    if (mode === 'overwrite' && overwriteAssetIds.length > 0) {
      const startYmd = periodStart.replace(/-/g, '');
      const endYmd = periodEnd.replace(/-/g, '');
      await service
        .from('journal_entries')
        .delete()
        .eq('user_id', user.id)
        .eq('entry_type', 'depreciation')
        .in('source_fixed_asset_id', overwriteAssetIds)
        .gte('entry_date', startYmd)
        .lte('entry_date', endYmd);
    }

    // appendモード: 既存期間を skip
    let rowsToInsert = rows;
    if (mode === 'append' && overwriteAssetIds.length > 0) {
      const startYmd = periodStart.replace(/-/g, '');
      const endYmd = periodEnd.replace(/-/g, '');
      const { data: existing } = await service
        .from('journal_entries')
        .select('source_fixed_asset_id, depreciation_period')
        .eq('user_id', user.id)
        .eq('entry_type', 'depreciation')
        .in('source_fixed_asset_id', overwriteAssetIds)
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

    // last_depreciated_through を更新
    for (const assetId of overwriteAssetIds) {
      const asset = assets!.find((a) => a.id === assetId);
      if (!asset) continue;
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

function countMonthsInPeriod(startDate: Date, periodStart: Date, periodEnd: Date): number {
  const effectiveStart = startDate > periodStart ? startDate : periodStart;
  if (effectiveStart > periodEnd) return 0;
  const sy = effectiveStart.getFullYear(), sm = effectiveStart.getMonth();
  const ey = periodEnd.getFullYear(), em = periodEnd.getMonth();
  return (ey - sy) * 12 + (em - sm) + 1;
}
