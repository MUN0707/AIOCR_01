import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';

/**
 * DELETE /api/ocr-uploads/:id
 * 仕訳未紐づきの OCR アップロードを削除（DB + Storage）。
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const service = createServiceClient();

  // アップロード情報を取得
  const { data: upload, error: fetchErr } = await service
    .from('ocr_uploads')
    .select('id, user_id, client_id, storage_path')
    .eq('id', id)
    .single();

  if (fetchErr || !upload) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  if (upload.client_id) {
    const scope = await resolveClientScope(service, user.id, upload.client_id);
    if (!scope || !canWrite(scope.role)) {
      return NextResponse.json({ error: 'このアップロードの削除権限がありません' }, { status: 403 });
    }
  } else {
    if (upload.user_id !== user.id) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
  }

  // 仕訳が紐づいていないか確認
  const { count } = await service
    .from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .or(`ocr_upload_id.eq.${id},bank_ocr_upload_id.eq.${id}`);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: '仕訳が紐づいているため削除できません。先に紐づけを解除してください。' },
      { status: 409 },
    );
  }

  // Storage から削除
  if (upload.storage_path) {
    await service.storage.from('ocr-uploads').remove([upload.storage_path]);
  }

  // DB から削除
  const { error: delErr } = await service
    .from('ocr_uploads')
    .delete()
    .eq('id', id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
