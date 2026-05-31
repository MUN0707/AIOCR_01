import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

/**
 * 固定資産の除却・売却仕訳を生成
 * body:
 *   disposal_type: 'retired' | 'sold'
 *   disposal_date: 'YYYY-MM-DD'
 *   disposal_amount?: number  (売却時: 売却額)
 *   cash_account?: string     (売却時: '普通預金' | '現金' | '未収金' 等)
 *   bank_ocr_upload_id?: string | null  (未照合の銀行明細と紐付ける場合)
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const body = await request.json();
    const disposalType: 'retired' | 'sold' = body.disposal_type === 'sold' ? 'sold' : 'retired';
    const disposalDate: string = body.disposal_date;
    const disposalAmount = disposalType === 'sold' ? Number(body.disposal_amount ?? 0) : 0;
    const cashAccount: string = body.cash_account ?? '普通預金';
    const bankOcrUploadId: string | null = body.bank_ocr_upload_id ?? null;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(disposalDate)) {
      return NextResponse.json({ error: '処分日が不正です' }, { status: 400 });
    }

    const service = createServiceClient();

    // 資産取得（id 単独。所有判定は client_id 経由 or user_id 一致）
    const { data: asset, error: assetErr } = await service
      .from('fixed_assets')
      .select('*')
      .eq('id', id)
      .single();
    if (assetErr || !asset) {
      return NextResponse.json({ error: '資産が見つかりません' }, { status: 404 });
    }

    let ownerUserId = user.id;
    if (asset.client_id) {
      const scope = await resolveClientScope(service, user.id, asset.client_id);
      if (!scope || !canWrite(scope.role)) {
        return NextResponse.json({ error: 'この資産の処分権限がありません' }, { status: 403 });
      }
      ownerUserId = scope.ownerUserId;
    } else {
      if (asset.user_id !== user.id) {
        return NextResponse.json({ error: '資産が見つかりません' }, { status: 404 });
      }
    }

    if (asset.status === 'disposed') {
      return NextResponse.json({ error: 'すでに処分済みです' }, { status: 400 });
    }

    // 既存の減価償却累計額を計算（資産の全ての償却仕訳を合算）
    const { data: depEntries } = await service
      .from('journal_entries')
      .select('amount')
      .eq('user_id', ownerUserId)
      .eq('entry_type', 'depreciation')
      .eq('source_fixed_asset_id', id);

    const accumulated = (depEntries ?? []).reduce((s, e) => s + Number(e.amount ?? 0), 0);
    const bookValue = Math.max(Number(asset.acquisition_cost) - accumulated, 0);

    // 会計ルールから間接法/直接法を判定
    let ruleQuery = service
      .from('accounting_rules')
      .select('*')
      .eq('user_id', ownerUserId)
      .lte('effective_from_date', disposalDate)
      .order('effective_from_date', { ascending: false })
      .limit(1);
    if (asset.client_id) ruleQuery = ruleQuery.eq('client_id', asset.client_id);
    else ruleQuery = ruleQuery.is('client_id', null);
    const { data: ruleRows } = await ruleQuery;
    const rule = ruleRows?.[0];
    const methodKey = asset.category === 'tangible' ? 'depreciation_method_tangible'
      : asset.category === 'intangible' ? 'depreciation_method_intangible'
      : 'depreciation_method_deferred';
    const indirect = rule ? rule[methodKey] === 'indirect' : (asset.category === 'tangible');

    const voucherGroupId = crypto.randomUUID();
    const ymd = disposalDate.replace(/-/g, '');
    const rows: Record<string, unknown>[] = [];

    // 共通: 資産の簿価を落とす
    // 間接法: 借方 減価償却累計額 accumulated / 貸方 建物 acquisitionCost, 差額(簿価) は借方に固定資産除却損/売却損益
    // 直接法: 貸方 建物 bookValue (既に累計額が科目に反映されてる前提)
    if (disposalType === 'retired') {
      // 除却
      if (indirect) {
        if (accumulated > 0) {
          rows.push(baseRow({
            userId: ownerUserId, clientId: asset.client_id, voucherGroupId,
            entry_date: ymd,
            debit_account: '減価償却累計額',
            credit_account: asset.account_name,
            amount: accumulated,
            description: `${asset.name} 除却（累計額消込）`,
            source_fixed_asset_id: id,
          }));
        }
        if (bookValue > 0) {
          rows.push(baseRow({
            userId: ownerUserId, clientId: asset.client_id, voucherGroupId,
            entry_date: ymd,
            debit_account: '固定資産除却損',
            credit_account: asset.account_name,
            amount: bookValue,
            description: `${asset.name} 除却（除却損）`,
            source_fixed_asset_id: id,
          }));
        }
      } else {
        // 直接法: 簿価 = 帳簿上の資産残高 → それを除却損へ
        if (bookValue > 0) {
          rows.push(baseRow({
            userId: ownerUserId, clientId: asset.client_id, voucherGroupId,
            entry_date: ymd,
            debit_account: '固定資産除却損',
            credit_account: asset.account_name,
            amount: bookValue,
            description: `${asset.name} 除却（除却損）`,
            source_fixed_asset_id: id,
          }));
        }
      }
    } else {
      // 売却
      const gainLoss = disposalAmount - bookValue;

      if (indirect) {
        // 累計額を消込
        if (accumulated > 0) {
          rows.push(baseRow({
            userId: ownerUserId, clientId: asset.client_id, voucherGroupId,
            entry_date: ymd,
            debit_account: '減価償却累計額',
            credit_account: asset.account_name,
            amount: accumulated,
            description: `${asset.name} 売却（累計額消込）`,
            source_fixed_asset_id: id,
          }));
        }
        // 現金 / 資産 (簿価) + 差損益
        if (disposalAmount > 0) {
          rows.push(baseRow({
            userId: ownerUserId, clientId: asset.client_id, voucherGroupId,
            entry_date: ymd,
            debit_account: cashAccount,
            credit_account: asset.account_name,
            amount: Math.min(disposalAmount, bookValue),
            description: `${asset.name} 売却（入金）`,
            source_fixed_asset_id: id,
            bank_ocr_upload_id: bankOcrUploadId,
          }));
        }
        if (gainLoss > 0) {
          // 売却益
          rows.push(baseRow({
            userId: ownerUserId, clientId: asset.client_id, voucherGroupId,
            entry_date: ymd,
            debit_account: cashAccount,
            credit_account: '固定資産売却益',
            amount: gainLoss,
            description: `${asset.name} 売却益`,
            source_fixed_asset_id: id,
            bank_ocr_upload_id: bankOcrUploadId,
          }));
        } else if (gainLoss < 0) {
          // 売却損
          rows.push(baseRow({
            userId: ownerUserId, clientId: asset.client_id, voucherGroupId,
            entry_date: ymd,
            debit_account: '固定資産売却損',
            credit_account: asset.account_name,
            amount: -gainLoss,
            description: `${asset.name} 売却損`,
            source_fixed_asset_id: id,
          }));
        }
      } else {
        // 直接法
        if (disposalAmount > 0) {
          rows.push(baseRow({
            userId: ownerUserId, clientId: asset.client_id, voucherGroupId,
            entry_date: ymd,
            debit_account: cashAccount,
            credit_account: asset.account_name,
            amount: Math.min(disposalAmount, bookValue),
            description: `${asset.name} 売却（入金）`,
            source_fixed_asset_id: id,
            bank_ocr_upload_id: bankOcrUploadId,
          }));
        }
        if (gainLoss > 0) {
          rows.push(baseRow({
            userId: ownerUserId, clientId: asset.client_id, voucherGroupId,
            entry_date: ymd,
            debit_account: cashAccount,
            credit_account: '固定資産売却益',
            amount: gainLoss,
            description: `${asset.name} 売却益`,
            source_fixed_asset_id: id,
            bank_ocr_upload_id: bankOcrUploadId,
          }));
        } else if (gainLoss < 0) {
          rows.push(baseRow({
            userId: ownerUserId, clientId: asset.client_id, voucherGroupId,
            entry_date: ymd,
            debit_account: '固定資産売却損',
            credit_account: asset.account_name,
            amount: -gainLoss,
            description: `${asset.name} 売却損`,
            source_fixed_asset_id: id,
          }));
        }
      }
    }

    if (rows.length > 0) {
      const { error } = await service.from('journal_entries').insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await service
      .from('fixed_assets')
      .update({
        status: 'disposed',
        disposal_date: disposalDate,
        disposal_type: disposalType,
        disposal_amount: disposalType === 'sold' ? disposalAmount : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    return NextResponse.json({ success: true, inserted: rows.length });
  } catch (error) {
    console.error('dispose エラー:', error);
    const message = error instanceof Error ? error.message : '処分処理に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * 固定資産の処分を取消
 * 紐付く disposal 仕訳を削除し、status / disposal_date / disposal_type / disposal_amount をクリアして active に戻す
 */
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const service = createServiceClient();

    const { data: asset, error: assetErr } = await service
      .from('fixed_assets')
      .select('*')
      .eq('id', id)
      .single();
    if (assetErr || !asset) {
      return NextResponse.json({ error: '資産が見つかりません' }, { status: 404 });
    }

    let ownerUserId = user.id;
    if (asset.client_id) {
      const scope = await resolveClientScope(service, user.id, asset.client_id);
      if (!scope || !canWrite(scope.role)) {
        return NextResponse.json({ error: 'この資産の処分取消権限がありません' }, { status: 403 });
      }
      ownerUserId = scope.ownerUserId;
    } else {
      if (asset.user_id !== user.id) {
        return NextResponse.json({ error: '資産が見つかりません' }, { status: 404 });
      }
    }

    if (asset.status !== 'disposed') {
      return NextResponse.json({ error: '処分されていない資産です' }, { status: 400 });
    }

    // 紐付く disposal 仕訳を削除
    const { error: delErr } = await service
      .from('journal_entries')
      .delete()
      .eq('user_id', ownerUserId)
      .eq('entry_type', 'disposal')
      .eq('source_fixed_asset_id', id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    // 資産を active に戻し、処分情報をクリア
    const { error: updErr } = await service
      .from('fixed_assets')
      .update({
        status: 'active',
        disposal_date: null,
        disposal_type: null,
        disposal_amount: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('dispose 取消エラー:', error);
    const message = error instanceof Error ? error.message : '処分取消処理に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function baseRow(p: {
  userId: string;
  clientId: string | null;
  voucherGroupId: string;
  entry_date: string;
  debit_account: string;
  credit_account: string;
  amount: number;
  description: string;
  source_fixed_asset_id: string;
  bank_ocr_upload_id?: string | null;
}): Record<string, unknown> {
  return {
    user_id: p.userId,
    client_id: p.clientId,
    voucher_group_id: p.voucherGroupId,
    entry_type: 'disposal',
    entry_date: p.entry_date,
    debit_account: p.debit_account,
    credit_account: p.credit_account,
    amount: p.amount,
    description: p.description,
    tax_type: '対象外',
    vendor_name: '',
    match_status: 'closing',
    source_fixed_asset_id: p.source_fixed_asset_id,
    bank_ocr_upload_id: p.bank_ocr_upload_id ?? null,
  };
}
