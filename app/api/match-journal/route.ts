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

    // ─── 取引先の名寄せ（既存マスタの canonical name に統一・新規は自動登録） ───
    let vouchers: VoucherInput[] = rawVouchers;
    let rules: AccountRule[] = [];
    if (user) {
      const { data: existingVendors } = await service
        .from('vendors')
        .select('id, name, normalized_key')
        .eq('user_id', user.id);

      const keyToName = new Map<string, string>();
      for (const v of existingVendors ?? []) {
        keyToName.set(v.normalized_key, v.name);
      }

      const newVendorRows: { user_id: string; client_id: string | null; name: string; normalized_key: string }[] = [];
      vouchers = rawVouchers.map((v) => {
        const raw = v.vendorName?.trim() ?? '';
        if (!raw) return v;
        const key = normalizeVendorKey(raw);
        if (!key) return v;
        const canonical = keyToName.get(key);
        if (canonical) {
          return { ...v, vendorName: canonical };
        }
        // 新規取引先として登録（最初に来た表記を canonical にする）
        keyToName.set(key, raw);
        newVendorRows.push({ user_id: user.id, client_id: clientId, name: raw, normalized_key: key });
        return v;
      });

      // vendors の unique index は COALESCE(client_id::text,'') を含む式インデックスのため
      // PostgREST の onConflict には渡せない。新規分だけ insert し、race condition で
      // 万一 23505 (unique_violation) が出ても致命でないため握り潰す。
      if (newVendorRows.length > 0) {
        const { error: vendorInsertError } = await service.from('vendors').insert(newVendorRows);
        if (vendorInsertError && vendorInsertError.code !== '23505') {
          console.error('vendors insert 失敗:', vendorInsertError);
        }
      }

      // ─── 勘定科目ルールを取得（相手先・摘要パターン） ───
      const { data: ruleRows } = await service
        .from('account_rules')
        .select('id, pattern_type, pattern, debit_account')
        .eq('user_id', user.id);
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
    let logId: string | null = null;
    if (user) {
      try {
        const { data: logRow } = await service
          .from('journal_match_logs')
          .insert({
            user_id: user.id,
            user_email: user.email ?? null,
            client_id: clientId,
            vouchers,
            transactions,
            results,
            summary,
          })
          .select('id')
          .single();
        logId = logRow?.id ?? null;
      } catch (logError) {
        console.error('journal_match_logs 保存失敗:', logError);
      }
    }

    // ─── 仕訳エントリ保存（部分登録モードではスキップ） ───
    if (shouldSave && user) {
      await saveResultsToJournalEntries(service, user, clientId, logId, vouchers, transactions, results, summary);
    }

    return NextResponse.json({ results, summary, suggestedUnmatchedAccounts, logId });
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
  _summary: ReturnType<typeof matchVouchersToTransactions>['summary']
) {
  try {
    const rows: Record<string, unknown>[] = [];
    for (const r of results) {
      const firstAccrual = r.accrualEntries[0];
      const vendor = firstAccrual?.voucher?.vendorName ?? '';
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
          match_status: r.withholdingPaymentEntry.matchStatus,
          ocr_upload_id: null,
          bank_ocr_upload_id: r.withholdingPaymentEntry.transaction.ocrUploadId ?? null,
        });
      }
    }
    if (rows.length > 0) {
      await service.from('journal_entries').insert(rows);
    }
  } catch (saveError) {
    console.error('journal_entries 保存失敗:', saveError);
  }
}
