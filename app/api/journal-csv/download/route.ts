import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { resolveClientScope } from '@/lib/client-access';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
    }

    const storagePath = request.nextUrl.searchParams.get('path');
    if (!storagePath) {
      return NextResponse.json({ error: 'path が必要です' }, { status: 400 });
    }

    const service = createServiceClient();

    // saved_csvs から storage_path で逆引きして owner / client_id を確認
    const { data: row } = await service
      .from('saved_csvs')
      .select('user_id, client_id')
      .eq('storage_path', storagePath)
      .maybeSingle();

    if (!row) {
      // メタが無いストレージ直下の owner プレフィックス由来は user 本人のみ
      if (!storagePath.startsWith(user.id)) {
        return NextResponse.json({ error: '不正なパスです' }, { status: 403 });
      }
    } else if (row.client_id) {
      const scope = await resolveClientScope(service, user.id, row.client_id);
      if (!scope) return NextResponse.json({ error: 'アクセス権限がありません' }, { status: 403 });
    } else if (row.user_id !== user.id) {
      return NextResponse.json({ error: 'アクセス権限がありません' }, { status: 403 });
    }

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
