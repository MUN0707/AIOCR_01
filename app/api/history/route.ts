import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const service = createServiceClient();

  if (id) {
    const { data, error } = await service
      .from('ocr_uploads')
      .select('id, user_id, session_id, file_name, storage_path, mode, ocr_result, file_size_bytes, created_at, client_id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();
    if (error || !data) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    const { data: signed } = await service.storage
      .from('ocr-uploads')
      .createSignedUrl(data.storage_path, 60 * 10);

    const { data: corrections } = await service
      .from('ocr_corrections')
      .select('item_index, field_name, original_value, corrected_value, created_at')
      .eq('upload_id', id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    return NextResponse.json({
      upload: data,
      pdfUrl: signed?.signedUrl ?? null,
      corrections: corrections ?? [],
    });
  }

  const { data, error } = await service
    .from('ocr_uploads')
    .select('id, file_name, mode, file_size_bytes, created_at, ocr_result')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (data ?? []).map((row) => {
    const result = row.ocr_result as { invoices?: unknown[]; transactions?: unknown[] } | null;
    const itemCount = result?.invoices?.length ?? result?.transactions?.length ?? 0;
    return {
      id: row.id,
      file_name: row.file_name,
      mode: row.mode,
      file_size_bytes: row.file_size_bytes,
      created_at: row.created_at,
      item_count: itemCount,
    };
  });

  return NextResponse.json({ items });
}
