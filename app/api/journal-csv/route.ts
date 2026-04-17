import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
    }

    const formData = await request.formData();
    const csvFile = formData.get('csv') as File | null;
    const fileName = (formData.get('fileName') as string) || '仕訳.csv';
    const clientId = (formData.get('clientId') as string) || null;

    if (!csvFile) {
      return NextResponse.json({ error: 'CSVファイルが必要です' }, { status: 400 });
    }

    const service = createServiceClient();
    const storagePath = `${user.id}/journal-csv/${fileName}`;
    const buffer = Buffer.from(await csvFile.arrayBuffer());

    const { error: uploadError } = await service.storage
      .from('ocr-uploads')
      .upload(storagePath, buffer, { contentType: 'text/csv', upsert: true });

    if (uploadError) {
      throw uploadError;
    }

    // メタデータをDBに記録（後から一覧取得するため）
    await service.from('saved_csvs').insert({
      user_id: user.id,
      client_id: clientId,
      file_name: fileName,
      storage_path: storagePath,
      file_size_bytes: buffer.byteLength,
    }).single();

    return NextResponse.json({ success: true, storagePath });
  } catch (error) {
    console.error('CSV保存エラー:', error);
    const message = error instanceof Error ? error.message : 'CSV保存に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
    }

    const clientId = request.nextUrl.searchParams.get('clientId');
    const service = createServiceClient();

    let query = service.from('saved_csvs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (clientId) {
      query = query.eq('client_id', clientId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ csvs: data || [] });
  } catch (error) {
    console.error('CSV一覧取得エラー:', error);
    return NextResponse.json({ error: 'CSV一覧取得に失敗しました' }, { status: 500 });
  }
}
