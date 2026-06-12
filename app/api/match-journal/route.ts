import { NextRequest, NextResponse } from 'next/server';
import {
  matchVouchersToTransactions,
  type VoucherInput,
  type TransactionInput,
  type AccountingMethod,
  type DescriptionMode,
  type MatchResult,
  type PaymentEntry,
} from '@/lib/ocr/journal-matcher';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { normalizeVendorKey } from '@/lib/vendor-normalize';
import { resolveVendorsBatch } from '@/lib/vendor-resolve';
import { canWrite, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 30;

interface AccountRule {
  id: string;
  pattern_type: 'vendor' | 'description';
  pattern: string;
  debit_account: string;
}

function normalizeDescPattern(raw: string): string {
  return raw
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .replace(/[　\s]/g, '')
    .toLowerCase();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawVouchers: VoucherInput[] = body.vouchers ?? [];
    const transactions: TransactionInput[] = body.transactions ?? [];
    const clientId: string | null = body.clientId ?? null;
    const accountingMethod: AccountingMethod =
      body.accountingMethod === 'cash' ? 'cash'
      : body.accountingMethod === 'monthEnd' ? 'monthEnd'
      : 'accrual';
    const descriptionMode: DescriptionMode = body.descriptionMode === 'full' ? 'full' : 'vendor';
    // 部分登録対応: false の場合は DB に保存せず結果だけ返す
    const shouldSave: boolean = body.save !== false;

    if (rawVouchers.length === 0 && transactions.length === 0) {
      return NextResponse.json(
        { error: '証票データまたは入出金データが必要です' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const service = createServiceClient();

    // 権限解決: client 指定があれば member 含めて確認、無ければ owner 本人として処理
    let ownerUserId = user?.id ?? '';
    if (user && clientId) {
      const scope = await resolveClientScope(service, user.id, clientId);
      if (!scope || !canWrite(scope.role)) {
        return NextResponse.json({ error: 'この会社への書き込み権限がありません' }, { status: 403 });
      }
      ownerUserId = scope.ownerUserId;
    }

    // ─── 取引先の名寄せ（resolveVendorsBatch で一括解決・canonical name + vendor_id） ───
    let vouchers: VoucherInput[] = rawVouchers;
    let rules: AccountRule[] = [];
    // voucher index → resolved vendor の対応（後で journal_entries.vendor_id に使う）
    const voucherVendorMap = new Map<number, { vendorId: string | null; canonicalName: string }>();

    if (user) {
      const resolved = await resolveVendorsBatch(
        service,
        ownerUserId,
        clientId,
        rawVouchers.map((v) => v.vendorName ?? ''),
      );
      vouchers = rawVouchers.map((v, i) => {
        const r = resolved[i];
        voucherVendorMap.set(i, { vendorId: r.vendorId, canonicalName: r.canonicalName });
        if (!r.canonicalName) return v;
        return { ...v, vendorName: r.canonicalName };
      });

      // ─── 勘定科目ルールを取得（相手先・摘要パターン） ───
      const { data: ruleRows } = await service
        .from('account_rules')
        .select('id, pattern_type, pattern, debit_account')
        .eq('user_id', ownerUserId);
      rules = (ruleRows ?? []) as AccountRule[];
    }

    // ─── 取引先ルールを voucher に適用（OCR推測より優先して上書き） ───
    const vendorRules = rules.filter((r) => r.pattern_type === 'vendor');
    if (vendorRules.length > 0) {
      const ruleMap = new Map(vendorRules.map((r) => [r.pattern, r.debit_account]));
      vouchers = vouchers.map((v) => {
        const key = normalizeVendorKey(v.vendorName ?? '');
        const account = key ? ruleMap.get(key) : null;
        if (!account) return v;
        // lines があれば単一 line の debitAccount を上書き、lines 無しなら voucher.debitAccount
        if (v.lines && v.lines.length > 0) {
          return {
            ...v,
            debitAccount: account,
            lines: v.lines.map((l) => ({ ...l, debitAccount: account })),
          };
        }
        return { ...v, debitAccount: account };
      });
    }

    // ─── 本体照合 ───
    const matcherResult = matchVouchersToTransactions(vouchers, transactions, {
      accountingMethod,
      descriptionMode,
    });
    const results: MatchResult[] = matcherResult.results;
    let summary = matcherResult.summary;

    // ─── #5 同一相手先合算パス：未照合グループの金額合計で再試行 ───
    // （注: matcher 内の usedTxIndices は閉じているので、ここで使用済み tx を復元する）
    const usedTxKeys = new Set<string>();
    for (const r of results) {
      if (r.paymentEntry) usedTxKeys.add(transactionKey(r.paymentEntry.transaction));
    }
    const availableTx: { idx: number; tx: TransactionInput }[] = transactions
      .map((tx, idx) => ({ idx, tx }))
      .filter(({ tx }) => !!tx.debit && !usedTxKeys.has(transactionKey(tx)));

    if (accountingMethod !== 'cash') {
      // unmatched の result を vendor key ごとにグループ化
      const groups = new Map<string, number[]>();
      results.forEach((r, i) => {
        if (r.paymentEntry) return;
        const vname = r.accrualEntries[0]?.voucher.vendorName ?? '';
        const key = normalizeVendorKey(vname);
        if (!key) return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(i);
      });

      for (const [, indices] of groups) {
        if (indices.length < 2) continue;
        // 合計金額（net: 源泉税を引いた値を使う）
        const total = indices.reduce((sum, i) => {
          const v = results[i].accrualEntries[0]?.voucher;
          if (!v || v.amountInclTax == null) return sum;
          const wh = v.withholdingTax && v.withholdingTax > 0 ? v.withholdingTax : 0;
          return sum + (v.amountInclTax - wh);
        }, 0);
        if (total <= 0) continue;

        // 使用可能な tx の中から合計と一致するものを探す（完全一致 or 1% 以内）
        const hit = availableTx.find(({ tx }) => {
          if (!tx.debit) return false;
          if (tx.debit === total) return true;
          return Math.abs(tx.debit - total) / total <= 0.01;
        });
        if (!hit) continue;

        // グループ全体を合算払として紐付け
        for (const i of indices) {
          const voucher = results[i].accrualEntries[0]?.voucher;
          if (!voucher) continue;
          const wh = voucher.withholdingTax && voucher.withholdingTax > 0 ? voucher.withholdingTax : 0;
          const netAmount = (voucher.amountInclTax ?? 0) - wh;
          const payment: PaymentEntry = {
            entryType: 'payment',
            date: hit.tx.transactionDate,
            debitAccount: '未払費用',
            creditAccount: '普通預金',
            amount: netAmount,
            description: `${voucher.vendorName || hit.tx.description} 支払消込(合算)`,
            taxType: '対象外',
            matchScore: 1,
            matchStatus: 'auto',
            transaction: hit.tx,
            voucher,
          };
          (payment as unknown as { creditAccount: string }).creditAccount = hit.tx.bankAccountName || '普通預金';
          results[i] = {
            accrualEntries: results[i].accrualEntries.map((e) => ({ ...e, matchStatus: 'auto' })),
            paymentEntry: payment,
          };
        }

        // 使用済みに
        const idxInAvailable = availableTx.indexOf(hit);
        if (idxInAvailable >= 0) availableTx.splice(idxInAvailable, 1);
        usedTxKeys.add(transactionKey(hit.tx));
      }

      // summary を再計算
      summary = {
        total: results.length,
        autoMatched: results.filter((r) => r.paymentEntry?.matchStatus === 'auto').length,
        needsReview: results.filter((r) => r.paymentEntry?.matchStatus === 'needs_review').length,
        unmatched: results.filter((r) => !r.paymentEntry).length,
        unmatchedTransactions: transactions.filter(
          (tx) => tx.debit && !usedTxKeys.has(transactionKey(tx))
        ),
      };
    }

    // ─── 源泉税の後日納付を自動照合（預り金 / 普通預金） ───
    //  voucher.withholdingTax > 0 の各 result について、
    //  残りの通帳出金で金額が一致するものがあれば 預り金 の支払消込を自動生成する。
    //  税務署への納付は相手先名が異なるので、金額一致＋日付が計上日以降 を条件とする。
    {
      for (const r of results) {
        const voucher = r.accrualEntries[0]?.voucher;
        if (!voucher) continue;
        const wh = voucher.withholdingTax && voucher.withholdingTax > 0 ? voucher.withholdingTax : 0;
        if (wh <= 0) continue;
        if (r.withholdingPaymentEntry) continue;

        const accrualDate = r.accrualEntries[0]?.date;
        const hit = availableTx.find(({ tx }) => {
          if (!tx.debit) return false;
          // 金額一致（完全 or 1% 以内）
          const amountOk = tx.debit === wh || Math.abs(tx.debit - wh) / wh <= 0.01;
          if (!amountOk) return false;
          // 日付が計上日以降であること（前払いはない）
          if (accrualDate && accrualDate !== '不明' && tx.transactionDate && tx.transactionDate !== '不明') {
            if (tx.transactionDate < accrualDate) return false;
          }
          return true;
        });
        if (!hit) continue;

        const payment: PaymentEntry = {
          entryType: 'payment',
          date: hit.tx.transactionDate,
          debitAccount: '未払費用', // 型上の制約。実行時は '預り金' に差し替え
          creditAccount: '普通預金',
          amount: hit.tx.debit,
          description: `${voucher.vendorName || ''} 源泉税納付`.trim(),
          taxType: '対象外',
          matchScore: 1,
          matchStatus: 'auto',
          transaction: hit.tx,
          voucher,
        };
        (payment as unknown as { debitAccount: string }).debitAccount = '預り金';
        (payment as unknown as { creditAccount: string }).creditAccount = hit.tx.bankAccountName || '普通預金';
        r.withholdingPaymentEntry = payment;

        const idxInAvailable = availableTx.indexOf(hit);
        if (idxInAvailable >= 0) availableTx.splice(idxInAvailable, 1);
        usedTxKeys.add(transactionKey(hit.tx));
      }

      // summary の未照合取引を再計算
      summary = {
        ...summary,
        unmatchedTransactions: transactions.filter(
          (tx) => tx.debit && !usedTxKeys.has(transactionKey(tx))
        ),
      };
    }

    // ─── 摘要ルール（description pattern）を未照合取引に適用し、
    //    フロントの UnmatchedView で勘定科目を自動提案する ───
    const descRules = rules.filter((r) => r.pattern_type === 'description');
    const suggestedUnmatchedAccounts: Record<number, string> = {};
    if (descRules.length > 0) {
      summary.unmatchedTransactions.forEach((tx, i) => {
        const norm = normalizeDescPattern(tx.description ?? '');
        for (const rule of descRules) {
          if (rule.pattern && norm.includes(rule.pattern)) {
            suggestedUnmatchedAccounts[i] = rule.debit_account;
            break;
          }
        }
      });
    }

    // ─── 照合ログは常に保存（復元用） ───
    // insert は throw せず { data, error } を返すため、error / data 双方で失敗判定する。
    let logId: string | null = null;
    let logSaveError: string | null = null;
    if (user) {
      try {
        const { data: logRow, error: insertError } = await service
          .from('journal_match_logs')
          .insert({
            user_id: ownerUserId,
            user_email: user.email ?? null,
            client_id: clientId,
            vouchers,
            transactions,
            results,
            summary,
          })
          .select('id')
          .single();
        if (insertError) throw insertError;
        logId = logRow?.id ?? null;
        if (!logId) throw new Error('journal_match_logs insert が id を返しませんでした');
      } catch (logError) {
        console.error('journal_match_logs 保存失敗:', logError);
        logSaveError = logError instanceof Error ? logError.message : String(logError);
        logId = null;
      }
    }

    // ─── ログ保存に失敗した状態で journal_entries を log_id=NULL で保存すると
    //    後から照合結果を辿れなくなるため、保存モード時は fail-fast でエラーを返す ───
    if (shouldSave && user && logSaveError) {
      return NextResponse.json(
        {
          error: `照合ログの保存に失敗したため仕訳を登録しませんでした: ${logSaveError}`,
          logSaveError,
        },
        { status: 500 }
      );
    }

    // ─── 仕訳エントリ保存（部分登録モードではスキップ） ───
    let savedCount = 0;
    let saveError: string | null = null;
    if (shouldSave && user) {
      // canonical vendorName → vendor_id のマップを構築（saveResults 内で参照）
      const vendorIdByName = new Map<string, string>();
      for (const v of voucherVendorMap.values()) {
        if (v.canonicalName && v.vendorId) vendorIdByName.set(v.canonicalName, v.vendorId);
      }
      const saveOutcome = await saveResultsToJournalEntries(service, { id: ownerUserId, email: user.email }, clientId, logId, vouchers, transactions, results, summary, vendorIdByName);
      savedCount = saveOutcome.savedCount;
      saveError = saveOutcome.saveError;
    }

    // ─── journal_entries の保存に失敗した場合は fail-fast で 500 を返す ───
    //    Supabase の insert は throw せず {error} を返すため、従来は console.error のみで
    //    握り潰され、フロントには成功レスポンスが返って「仕訳されたつもり」になっていた。
    //    insert は単一バッチ（statement 単位で原子的）なので失敗時は savedCount=0。
    if (shouldSave && user && saveError) {
      return NextResponse.json(
        {
          error: `仕訳の保存に失敗しました: ${saveError}`,
          saveError,
          savedCount,
          results,
          summary,
          suggestedUnmatchedAccounts,
          logId,
          logSaveError,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ results, summary, suggestedUnmatchedAccounts, logId, logSaveError, savedCount, saveError });
  } catch (error) {
    console.error('照合処理エラー:', error);
    const message = error instanceof Error ? error.message : '照合処理中にエラーが発生しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function transactionKey(tx: TransactionInput): string {
  return `${tx.transactionDate}|${tx.description}|${tx.debit ?? ''}|${tx.credit ?? ''}|${tx.ocrUploadId ?? ''}`;
}

async function saveResultsToJournalEntries(
  service: ReturnType<typeof createServiceClient>,
  user: { id: string; email?: string },
  clientId: string | null,
  logId: string | null,
  _vouchers: VoucherInput[],
  _transactions: TransactionInput[],
  results: MatchResult[],
  _summary: ReturnType<typeof matchVouchersToTransactions>['summary'],
  vendorIdByName: Map<string, string>,
): Promise<{ savedCount: number; saveError: string | null }> {
  try {
    const rows: Record<string, unknown>[] = [];
    for (const r of results) {
      const firstAccrual = r.accrualEntries[0];
      const vendor = firstAccrual?.voucher?.vendorName ?? '';
      const vendorId = vendor ? (vendorIdByName.get(vendor) ?? null) : null;
      const voucherGroupId = crypto.randomUUID();
      const linkedBankUploadId: string | null = r.paymentEntry?.transaction.ocrUploadId ?? null;
      for (const e of r.accrualEntries) {
        rows.push({
          user_id: user.id,
          client_id: clientId,
          log_id: logId,
          voucher_group_id: voucherGroupId,
          entry_type: 'accrual',
          entry_date: e.date,
          debit_account: e.debitAccount,
          credit_account: e.creditAccount,
          amount: e.amount,
          description: e.description,
          tax_type: e.taxType,
          vendor_name: vendor,
          vendor_id: vendorId,
          match_status: e.matchStatus,
          ocr_upload_id: e.voucher.ocrUploadId ?? null,
          bank_ocr_upload_id: linkedBankUploadId,
        });
      }
      if (r.paymentEntry) {
        rows.push({
          user_id: user.id,
          client_id: clientId,
          log_id: logId,
          voucher_group_id: voucherGroupId,
          entry_type: 'payment',
          entry_date: r.paymentEntry.date,
          debit_account: r.paymentEntry.debitAccount,
          credit_account: r.paymentEntry.creditAccount,
          amount: r.paymentEntry.amount,
          description: r.paymentEntry.description,
          tax_type: r.paymentEntry.taxType,
          vendor_name: vendor,
          vendor_id: vendorId,
          match_status: r.paymentEntry.matchStatus,
          ocr_upload_id: r.paymentEntry.voucher.ocrUploadId ?? null,
          bank_ocr_upload_id: linkedBankUploadId,
        });
      }
      if (r.withholdingPaymentEntry) {
        rows.push({
          user_id: user.id,
          client_id: clientId,
          log_id: logId,
          voucher_group_id: voucherGroupId,
          entry_type: 'payment',
          entry_date: r.withholdingPaymentEntry.date,
          debit_account: r.withholdingPaymentEntry.debitAccount,
          credit_account: r.withholdingPaymentEntry.creditAccount,
          amount: r.withholdingPaymentEntry.amount,
          description: r.withholdingPaymentEntry.description,
          tax_type: r.withholdingPaymentEntry.taxType,
          vendor_name: vendor,
          vendor_id: vendorId,
          match_status: r.withholdingPaymentEntry.matchStatus,
          ocr_upload_id: null,
          bank_ocr_upload_id: r.withholdingPaymentEntry.transaction.ocrUploadId ?? null,
        });
      }
      // [C3] 振込手数料の自動振替仕訳（支払手数料 / 預金）
      if (r.feeEntry) {
        rows.push({
          user_id: user.id,
          client_id: clientId,
          log_id: logId,
          voucher_group_id: voucherGroupId,
          entry_type: 'payment',
          entry_date: r.feeEntry.date,
          debit_account: r.feeEntry.debitAccount,
          credit_account: r.feeEntry.creditAccount,
          amount: r.feeEntry.amount,
          description: r.feeEntry.description,
          tax_type: r.feeEntry.taxType,
          vendor_name: vendor,
          vendor_id: vendorId,
          match_status: r.feeEntry.matchStatus,
          ocr_upload_id: null,
          bank_ocr_upload_id: linkedBankUploadId,
        });
      }
    }
    if (rows.length === 0) {
      return { savedCount: 0, saveError: null };
    }
    // Supabase の insert は throw せず {error} を返すため、戻り値を必ず検査する
    const { error: insertError } = await service.from('journal_entries').insert(rows);
    if (insertError) {
      console.error('journal_entries 保存失敗:', insertError);
      return { savedCount: 0, saveError: insertError.message };
    }
    return { savedCount: rows.length, saveError: null };
  } catch (saveError) {
    console.error('journal_entries 保存失敗:', saveError);
    return {
      savedCount: 0,
      saveError: saveError instanceof Error ? saveError.message : String(saveError),
    };
  }
}
