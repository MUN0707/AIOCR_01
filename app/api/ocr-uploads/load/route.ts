import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { listAccessibleClientIds } from '@/lib/client-access';

/**
 * POST /api/ocr-uploads/load
 * body: { bankUploadIds: string[], invoiceUploadIds: string[] }
 *
 * 指定した OCR アップロードの ocr_result を返す。
 * 仕訳実行タブで「既存データから再照合」する際に使用。
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json();
  const bankUploadIds: string[] = body.bankUploadIds ?? [];
  const invoiceUploadIds: string[] = body.invoiceUploadIds ?? [];
  const allIds = [...bankUploadIds, ...invoiceUploadIds];

  if (allIds.length === 0) {
    return NextResponse.json({ error: 'uploadIds が空です' }, { status: 400 });
  }

  const service = createServiceClient();

  const { data: uploadsRaw, error } = await service
    .from('ocr_uploads')
    .select('id, user_id, client_id, file_name, mode, ocr_result')
    .in('id', allIds);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 権限フィルタ: 個人 (caller user_id 一致, client_id null) OR アクセス可能 client に属する
  const accessible = new Set(await listAccessibleClientIds(service, user.id));
  const uploads = (uploadsRaw ?? []).filter((u) => {
    if (u.client_id) return accessible.has(u.client_id);
    return u.user_id === user.id;
  });

  const uploadMap = new Map(uploads.map((u) => [u.id, u]));

  // 通帳データを結合
  const bankData: Array<{
    uploadId: string;
    fileName: string;
    bankName: string;
    accountNumber: string;
    transactions: Array<{
      transactionDate: string;
      description: string;
      debit: number | null;
      credit: number | null;
    }>;
  }> = [];

  for (const id of bankUploadIds) {
    const u = uploadMap.get(id);
    if (!u || u.mode !== 'bank-statement') continue;
    const ocr = u.ocr_result as {
      bankName?: string;
      accountNumber?: string;
      transactions?: Array<{
        date?: string;
        transactionDate?: string;
        description?: string;
        debit?: number | null;
        credit?: number | null;
      }>;
    } | null;
    bankData.push({
      uploadId: u.id,
      fileName: u.file_name,
      bankName: ocr?.bankName ?? '',
      accountNumber: ocr?.accountNumber ?? '',
      transactions: (ocr?.transactions ?? []).map((t) => ({
        transactionDate: t.transactionDate ?? t.date ?? '',
        description: t.description ?? '',
        debit: t.debit ?? null,
        credit: t.credit ?? null,
      })),
    });
  }

  // 請求書データを結合
  const invoiceData: Array<{
    uploadId: string;
    fileName: string;
    invoices: Array<{
      requesterName?: string;
      date?: string;
      taxIncludedAmount?: number;
      withholdingTax?: number;
      lines?: Array<{
        description?: string;
        amount?: number;
        taxRate?: number;
      }>;
    }>;
  }> = [];

  for (const id of invoiceUploadIds) {
    const u = uploadMap.get(id);
    if (!u || u.mode !== 'invoice-single') continue;
    const ocr = u.ocr_result as { invoices?: unknown[] } | null;
    invoiceData.push({
      uploadId: u.id,
      fileName: u.file_name,
      invoices: (ocr?.invoices ?? []) as Array<{
        requesterName?: string;
        date?: string;
        taxIncludedAmount?: number;
        withholdingTax?: number;
        lines?: Array<{ description?: string; amount?: number; taxRate?: number }>;
      }>,
    });
  }

  return NextResponse.json({ bankData, invoiceData });
}
