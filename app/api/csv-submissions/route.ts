import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const csvFile = formData.get('csv') as File | null;
    const presetId = (formData.get('presetId') as string) || '';
    const errorMessage = (formData.get('errorMessage') as string) || '';
    const comment = (formData.get('comment') as string) || '';
    const siteName = (formData.get('siteName') as string) || 'aiocr';

    if (!csvFile) {
      return NextResponse.json({ error: 'CSVファイルが必要です' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const service = createServiceClient();

    // CSVをStorageに保存
    const buffer = Buffer.from(await csvFile.arrayBuffer());
    if (buffer.byteLength > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'CSVは10MB以下にしてください' }, { status: 400 });
    }

    const prefix = user?.id ?? 'guest';
    const safeName = csvFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const csvPath = `${prefix}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await service.storage
      .from('error-screenshots')
      .upload(csvPath, buffer, { contentType: 'text/csv', upsert: false });

    if (uploadError) {
      return NextResponse.json({ error: `CSV保存失敗: ${uploadError.message}` }, { status: 500 });
    }

    // error_reportsに記録（category: csv-import）
    const reportComment = [
      `【CSVインポートエラー】`,
      `会計ソフト: ${presetId}`,
      `エラー: ${errorMessage}`,
      comment ? `ユーザーコメント: ${comment}` : '',
      `ファイル名: ${csvFile.name}`,
      `サイズ: ${(buffer.byteLength / 1024).toFixed(1)}KB`,
    ].filter(Boolean).join('\n');

    const { error: insertError } = await service.from('error_reports').insert({
      user_id: user?.id ?? null,
      user_email: user?.email ?? null,
      mode: null,
      comment: reportComment,
      screenshot_path: csvPath,
      context: { page: '/', action: 'csv-import', presetId },
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
