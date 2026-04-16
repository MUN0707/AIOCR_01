import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

/**
 * GET /api/ocr-uploads?clientId=xxx
 * 指定法人に紐づく OCR アップロード一覧を返す（通帳・請求書のみ）。
 * 各アップロードに紐づく仕訳件数（登録済み）も返す。
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const clientId = url.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  const service = createServiceClient();

  // OCR アップロードを取得（通帳 + 請求書単票のみ）
  const { data: uploads, error: upErr } = await service
    .from('ocr_uploads')
    .select('id, file_name, mode, ocr_result, created_at')
    .eq('user_id', user.id)
    .eq('client_id', clientId)
    .in('mode', ['bank-statement', 'invoice-single'])
    .order('created_at', { ascending: false })
    .limit(100);

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // 各アップロードに紐づく仕訳件数を取得
  const uploadIds = (uploads ?? []).map((u) => u.id);
  let entryCounts: Record<string, number> = {};

  if (uploadIds.length > 0) {
    const { data: entries } = await service
      .from('journal_entries')
      .select('id, ocr_upload_id, bank_ocr_upload_id')
      .eq('user_id', user.id)
      .or(
        uploadIds.map((id) => `ocr_upload_id.eq.${id}`).join(',') +
        ',' +
        uploadIds.map((id) => `bank_ocr_upload_id.eq.${id}`).join(',')
      );

    for (const e of entries ?? []) {
      if (e.ocr_upload_id && uploadIds.includes(e.ocr_upload_id)) {
        entryCounts[e.ocr_upload_id] = (entryCounts[e.ocr_upload_id] ?? 0) + 1;
      }
      if (e.bank_ocr_upload_id && uploadIds.includes(e.bank_ocr_upload_id)) {
        entryCounts[e.bank_ocr_upload_id] = (entryCounts[e.bank_ocr_upload_id] ?? 0) + 1;
      }
    }
  }

  const result = (uploads ?? []).map((u) => {
    const ocr = u.ocr_result as { invoices?: unknown[]; transactions?: unknown[] } | null;
    const itemCount = ocr?.invoices?.length ?? ocr?.transactions?.length ?? 0;
    return {
      id: u.id,
      fileName: u.file_name,
      mode: u.mode,
      itemCount,
      journalEntryCount: entryCounts[u.id] ?? 0,
      createdAt: u.created_at,
    };
  });

  return NextResponse.json({ uploads: result });
}
