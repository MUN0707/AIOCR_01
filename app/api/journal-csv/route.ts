import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, listAccessibleClientIds, resolveClientScope } from '@/lib/client-access';

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

    let ownerUserId = user.id;
    if (clientId) {
      const scope = await resolveClientScope(service, user.id, clientId);
      if (!scope || !canWrite(scope.role)) {
        return NextResponse.json({ error: 'この会社への書き込み権限がありません' }, { status: 403 });
      }
      ownerUserId = scope.ownerUserId;
    }

    // ストレージ上のキーは「アップロード操作者ベース」で分けると個人別に集約できるが、
    // owner_user_id 配下に置くと閲覧時 (member) も同じパスで参照できる。後者を採用。
    const storagePath = `${ownerUserId}/journal-csv/${fileName}`;
    const buffer = Buffer.from(await csvFile.arrayBuffer());

    const { error: uploadError } = await service.storage
      .from('ocr-uploads')
      .upload(storagePath, buffer, { contentType: 'text/csv', upsert: true });

    if (uploadError) {
      throw uploadError;
    }

    // メタデータをDBに記録（後から一覧取得するため）
    await service.from('saved_csvs').insert({
      user_id: ownerUserId,
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

    if (clientId) {
      const scope = await resolveClientScope(service, user.id, clientId);
      if (!scope) return NextResponse.json({ error: 'この会社へのアクセス権限がありません' }, { status: 403 });
      const { data, error } = await service.from('saved_csvs')
        .select('*')
        .eq('user_id', scope.ownerUserId)
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return NextResponse.json({ csvs: data || [] });
    }

    // clientId 未指定: 個人 + 全アクセス可能 client を union
    const accessible = await listAccessibleClientIds(service, user.id);
    const [personalRes, clientRes] = await Promise.all([
      service.from('saved_csvs')
        .select('*')
        .eq('user_id', user.id)
        .is('client_id', null)
        .order('created_at', { ascending: false })
        .limit(50),
      accessible.length > 0
        ? service.from('saved_csvs')
            .select('*')
            .in('client_id', accessible)
            .order('created_at', { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
    ]);
    if (personalRes.error) throw personalRes.error;
    if (clientRes.error) throw clientRes.error;
    const merged = [...(personalRes.data ?? []), ...(clientRes.data ?? [])];
    return NextResponse.json({ csvs: merged });
  } catch (error) {
    console.error('CSV一覧取得エラー:', error);
    return NextResponse.json({ error: 'CSV一覧取得に失敗しました' }, { status: 500 });
  }
}
