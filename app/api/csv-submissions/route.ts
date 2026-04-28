import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const storagePath: string = body.storagePath || '';
    const presetId: string = body.presetId || '';
    const errorMessage: string = body.errorMessage || '';
    const comment: string = body.comment || '';
    const siteName: string = body.siteName || 'aiocr';
    const fileName: string = body.fileName || '';
    const fileSize: number = typeof body.fileSize === 'number' ? body.fileSize : 0;
    const compressedSize: number = typeof body.compressedSize === 'number' ? body.compressedSize : 0;
    const compressed: boolean = body.compressed === true;

    if (!storagePath) {
      return NextResponse.json({ error: 'storagePath が必要です' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'ログインしてください' }, { status: 401 });
    }

    if (!storagePath.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: 'パスが不正です' }, { status: 400 });
    }

    const service = createServiceClient();

    const sizeLine = compressed && compressedSize > 0
      ? `サイズ: ${(fileSize / 1024).toFixed(1)}KB → gzip後 ${(compressedSize / 1024).toFixed(1)}KB`
      : `サイズ: ${(fileSize / 1024).toFixed(1)}KB`;

    const reportComment = [
      `【CSVインポートエラー】`,
      `会計ソフト: ${presetId}`,
      `エラー: ${errorMessage}`,
      comment ? `ユーザーコメント: ${comment}` : '',
      `ファイル名: ${fileName}`,
      sizeLine,
      compressed ? `※ gzip圧縮済み（拡張子.gz / 解凍: gunzip <path>）` : '',
    ].filter(Boolean).join('\n');

    const { error: insertError } = await service.from('error_reports').insert({
      user_id: user.id,
      user_email: user.email ?? null,
      mode: null,
      comment: reportComment,
      screenshot_path: storagePath,
      context: { page: '/', action: 'csv-import', presetId, compressed },
      category: 'csv-import',
      site_name: siteName,
    });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('CSV送信エラー:', error);
    const message = error instanceof Error ? error.message : 'CSV送信に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
