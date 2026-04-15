import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { theoreticalInPeriod, monthlyDepreciation, type AssetForCalc, type DepreciationMethod } from '@/lib/depreciation/calculator';

export const maxDuration = 30;

/**
 * 会計ルール変更時の過去償却仕訳の再計算
 * body:
 *   clientId: string | null
 *   from_date: 'YYYY-MM-DD'  (再計算の起点日、通常はルール有効開始日)
 *   to_date:   'YYYY-MM-DD'  (再計算の終了日、通常は当日)
 *   mode: 'rewrite' | 'adjust'
 *     - rewrite: 該当期間の償却仕訳を削除して新ルールで再生成
 *     - adjust:  既存は残し、差額を from_date に一括修正仕訳として計上
 *   timing: 'monthly' | 'annual'  (rewrite 時の再生成タイミング)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const body = await request.json();
    const clientId: string | null = body.clientId ?? null;
    const fromDate: string = body.from_date;
    const toDate: string = body.to_date;
    const mode: 'rewrite' | 'adjust' = body.mode === 'rewrite' ? 'rewrite' : 'adjust';
    const timing: 'monthly' | 'annual' = body.timing === 'monthly' ? 'monthly' : 'annual';

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
      return NextResponse.json({ error: '期間が不正です' }, { status: 400 });
    }

    const service = createServiceClient();

    // 対象資産
    let assetQuery = service
      .from('fixed_assets')
      .select('*')
      .eq('user_id', user.id);
    if (clientId) assetQuery = assetQuery.eq('client_id', clientId);
    else assetQuery = assetQuery.is('client_id', null);
    const { data: assets } = await assetQuery;

    // 有効な会計ルール (fromDate 時点)
    let ruleQuery = service
      .from('accounting_rules')
      .select('*')
      .eq('user_id', user.id)
      .lte('effective_from_date', toDate)
      .order('effective_from_date', { ascending: false })
      .limit(1);
    if (clientId) ruleQuery = ruleQuery.eq('client_id', clientId);
    else ruleQuery = ruleQuery.is('client_id', null);
    const { data: ruleRows } = await ruleQuery;
    const rule = ruleRows?.[0];

    const creditAccountFor = (category: string, assetAccountName: string): string => {
      if (!rule) return category === 'tangible' ? '減価償却累計額' : assetAccountName;
      const key = category === 'tangible' ? 'depreciation_method_tangible'
        : category === 'intangible' ? 'depreciation_method_intangible'
        : 'depreciation_method_deferred';
      return rule[key] === 'indirect' ? '減価償却累計額' : assetAccountName;
    };

    const startYmd = fromDate.replace(/-/g, '');
    const endYmd = toDate.replace(/-/g, '');
    const periodStart = new Date(fromDate);
    const periodEnd = new Date(toDate);

    let insertedCount = 0;
    let deletedCount = 0;
    let adjustmentTotal = 0;

    if (mode === 'rewrite') {
      // 既存削除 → 新ルールで再生成
      const assetIds = (assets ?? []).map((a) => a.id);
      if (assetIds.length > 0) {
        const { count } = await service
          .from('journal_entries')
          .delete({ count: 'exact' })
          .eq('user_id', user.id)
          .eq('entry_type', 'depreciation')
          .in('source_fixed_asset_id', assetIds)
          .gte('entry_date', startYmd)
          .lte('entry_date', endYmd);
        deletedCount = count ?? 0;
      }

      const rows: Record<string, unknown>[] = [];
      for (const asset of assets ?? []) {
        if (asset.status !== 'active') continue;
        if (!asset.useful_life_years || !asset.depreciation_start_date) continue;
        if (asset.method === 'units_of_production') continue;

        const calcAsset: AssetForCalc = {
          acquisition_cost: Number(asset.acquisition_cost),
          residual_value: Number(asset.residual_value),
          useful_life_years: asset.useful_life_years,
          method: asset.method as DepreciationMethod,
          depreciation_start_date: asset.depreciation_start_date,
        };

        const creditAccount = creditAccountFor(asset.category, asset.account_name);

        if (timing === 'monthly') {
          const cursor = new Date(Math.max(new Date(asset.depreciation_start_date).getTime(), periodStart.getTime()));
          cursor.setDate(1);
          while (cursor <= periodEnd) {
            const y = cursor.getFullYear();
            const m = cursor.getMonth() + 1;
            const lastDay = new Date(y, m, 0);
            if (lastDay > periodEnd) break;
            const amt = monthlyDepreciation(calcAsset, y, m);
            if (amt > 0) {
              const ymd = `${y}${String(m).padStart(2, '0')}${String(lastDay.getDate()).padStart(2, '0')}`;
              const periodLabel = `${y}-${String(m).padStart(2, '0')}`;
              rows.push({
                user_id: user.id, client_id: clientId, entry_type: 'depreciation', entry_date: ymd,
                debit_account: '減価償却費', credit_account: creditAccount, amount: amt,
                description: `${asset.name} 減価償却 ${periodLabel}`, tax_type: '対象外',
                vendor_name: '', match_status: 'closing',
                source_fixed_asset_id: asset.id, depreciation_period: periodLabel,
              });
            }
            cursor.setMonth(cursor.getMonth() + 1);
          }
        } else {
          // 年次: 期間全体を1件に集約 (会計年度境界を跨ぐ場合は別々に出す方が綺麗だが簡略化)
          const total = theoreticalInPeriod(calcAsset, periodStart, periodEnd);
          if (total > 0) {
            const endY = periodEnd.getFullYear();
            const endM = periodEnd.getMonth() + 1;
            const endD = periodEnd.getDate();
            const ymd = `${endY}${String(endM).padStart(2, '0')}${String(endD).padStart(2, '0')}`;
            rows.push({
              user_id: user.id, client_id: clientId, entry_type: 'depreciation', entry_date: ymd,
              debit_account: '減価償却費', credit_account: creditAccount, amount: total,
              description: `${asset.name} 減価償却 ${endY}年度 (再計算)`, tax_type: '対象外',
              vendor_name: '', match_status: 'closing',
              source_fixed_asset_id: asset.id, depreciation_period: `${endY}`,
            });
          }
        }
      }

      if (rows.length > 0) {
        const { error } = await service.from('journal_entries').insert(rows);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        insertedCount = rows.length;
      }
    } else {
      // adjust: 差額を fromDate に一括計上
      const adjustRows: Record<string, unknown>[] = [];
      for (const asset of assets ?? []) {
        if (asset.status === 'disposed') continue;
        if (!asset.useful_life_years || !asset.depreciation_start_date) continue;
        if (asset.method === 'units_of_production') continue;

        const calcAsset: AssetForCalc = {
          acquisition_cost: Number(asset.acquisition_cost),
          residual_value: Number(asset.residual_value),
          useful_life_years: asset.useful_life_years,
          method: asset.method as DepreciationMethod,
          depreciation_start_date: asset.depreciation_start_date,
        };

        // 理論値 (fromDate〜toDate)
        const required = theoreticalInPeriod(calcAsset, periodStart, periodEnd);

        // 実績 (fromDate〜toDate)
        const { data: posted } = await service
          .from('journal_entries')
          .select('amount')
          .eq('user_id', user.id)
          .eq('entry_type', 'depreciation')
          .eq('source_fixed_asset_id', asset.id)
          .gte('entry_date', startYmd)
          .lte('entry_date', endYmd);
        const postedTotal = (posted ?? []).reduce((s, e) => s + Number(e.amount ?? 0), 0);

        const diff = required - postedTotal;
        if (Math.abs(diff) < 1) continue;

        const creditAccount = creditAccountFor(asset.category, asset.account_name);
        adjustmentTotal += diff;

        if (diff > 0) {
          // 不足: 追加計上
          adjustRows.push({
            user_id: user.id, client_id: clientId, entry_type: 'depreciation', entry_date: startYmd,
            debit_account: '減価償却費', credit_account: creditAccount, amount: diff,
            description: `${asset.name} 減価償却 修正計上 (会計ルール変更)`, tax_type: '対象外',
            vendor_name: '', match_status: 'closing',
            source_fixed_asset_id: asset.id, depreciation_period: `adj-${fromDate}`,
          });
        } else {
          // 過剰: 戻し入れ (借方貸方を逆に)
          adjustRows.push({
            user_id: user.id, client_id: clientId, entry_type: 'depreciation', entry_date: startYmd,
            debit_account: creditAccount, credit_account: '減価償却費', amount: -diff,
            description: `${asset.name} 減価償却 修正戻入 (会計ルール変更)`, tax_type: '対象外',
            vendor_name: '', match_status: 'closing',
            source_fixed_asset_id: asset.id, depreciation_period: `adj-${fromDate}`,
          });
        }
      }

      if (adjustRows.length > 0) {
        const { error } = await service.from('journal_entries').insert(adjustRows);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        insertedCount = adjustRows.length;
      }
    }

    return NextResponse.json({
      success: true,
      mode,
      deleted: deletedCount,
      inserted: insertedCount,
      adjustment_total: adjustmentTotal,
    });
  } catch (error) {
    console.error('depreciation recalc エラー:', error);
    const message = error instanceof Error ? error.message : '再計算に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
