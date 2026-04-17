import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
    }

    const storagePath = request.nextUrl.searchParams.get('path');
    if (!storagePath || !storagePath.startsWith(user.id)) {
      return NextResponse.json({ error: '不正なパスです' }, { status: 403 });
    }

    const service = createServiceClient();
    const { data, error } = await service.storage
      .from('ocr-uploads')
      .download(storagePath);

    if (error || !data) {
      return NextResponse.json({ error: 'ファイルが見つかりません' }, { status: 404 });
    }

    const fileName = storagePath.split('/').pop() || 'download.csv';
    return new NextResponse(data, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (error) {
    console.error('CSVダウンロードエラー:', error);
    return NextResponse.json({ error: 'ダウンロードに失敗しました' }, { status: 500 });
  }
}
