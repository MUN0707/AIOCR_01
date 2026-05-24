import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { resolveClientScope } from '@/lib/client-access';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const entryId = url.searchParams.get('entryId');
  // 'invoice'(既定) | 'bank' — 請求書PDF か 通帳PDF かを指定
  const source = url.searchParams.get('source') === 'bank' ? 'bank' : 'invoice';
  if (!entryId) {
    return NextResponse.json({ error: 'entryId required' }, { status: 400 });
  }

  const service = createServiceClient();

  const { data: entry, error: entryError } = await service
    .from('journal_entries')
    .select('id, user_id, client_id, ocr_upload_id, bank_ocr_upload_id')
    .eq('id', entryId)
    .single();

  if (entryError || !entry) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // 権限解決: entry の client_id 経由で member 含めてアクセス確認
  // entry に client_id が無い (個人スコープ) 場合は user_id 一致のみ可
  type EntryRow = typeof entry & { client_id?: string | null };
  const e = entry as EntryRow;
  if (e.client_id) {
    const scope = await resolveClientScope(service, user.id, e.client_id);
    if (!scope) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  } else if (e.user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const targetUploadId = source === 'bank' ? entry.bank_ocr_upload_id : entry.ocr_upload_id;
  if (!targetUploadId) {
    return NextResponse.json({ error: 'no pdf linked' }, { status: 404 });
  }

  const { data: upload } = await service
    .from('ocr_uploads')
    .select('id, file_name, storage_path')
    .eq('id', targetUploadId)
    .single();

  if (!upload) {
    return NextResponse.json({ error: 'upload not found' }, { status: 404 });
  }

  const { data: signed } = await service.storage
    .from('ocr-uploads')
    .createSignedUrl(upload.storage_path, 60 * 10);

  if (!signed?.signedUrl) {
    return NextResponse.json({ error: 'failed to sign url' }, { status: 500 });
  }

  return NextResponse.json({
    pdfUrl: signed.signedUrl,
    fileName: upload.file_name,
  });
}
