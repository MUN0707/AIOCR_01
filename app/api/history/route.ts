import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { listAccessibleClientIds, resolveClientScope } from '@/lib/client-access';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const service = createServiceClient();

  if (id) {
    const { data, error } = await service
      .from('ocr_uploads')
      .select('id, user_id, session_id, file_name, storage_path, mode, ocr_result, file_size_bytes, created_at, client_id')
      .eq('id', id)
      .single();
    if (error || !data) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    // 権限確認: 個人 (caller user_id 一致, client_id null) OR アクセス可能 client
    let ownerUserId = user.id;
    if (data.client_id) {
      const scope = await resolveClientScope(service, user.id, data.client_id);
      if (!scope) return NextResponse.json({ error: 'not found' }, { status: 404 });
      ownerUserId = scope.ownerUserId;
    } else {
      if (data.user_id !== user.id) {
        return NextResponse.json({ error: 'not found' }, { status: 404 });
      }
    }

    const { data: signed } = await service.storage
      .from('ocr-uploads')
      .createSignedUrl(data.storage_path, 60 * 10);

    const { data: corrections } = await service
      .from('ocr_corrections')
      .select('item_index, field_name, original_value, corrected_value, created_at')
      .eq('upload_id', id)
      .eq('user_id', ownerUserId)
      .order('created_at', { ascending: false });

    // このアップロードに紐づく仕訳を取得（請求書側 or 通帳側）
    const { data: journalFromVoucher } = await service
      .from('journal_entries')
      .select('id, entry_type, entry_date, debit_account, credit_account, amount, description, vendor_name, match_status')
      .eq('ocr_upload_id', id)
      .order('entry_date', { ascending: true });

    const { data: journalFromBank } = await service
      .from('journal_entries')
      .select('id, entry_type, entry_date, debit_account, credit_account, amount, description, vendor_name, match_status')
      .eq('bank_ocr_upload_id', id)
      .order('entry_date', { ascending: true });

    // 重複排除して結合
    const allJournals = [...(journalFromVoucher ?? []), ...(journalFromBank ?? [])];
    const seen = new Set<string>();
    const journalEntries = allJournals.filter((j) => {
      if (seen.has(j.id)) return false;
      seen.add(j.id);
      return true;
    });

    return NextResponse.json({
      upload: data,
      pdfUrl: signed?.signedUrl ?? null,
      corrections: corrections ?? [],
      journalEntries,
    });
  }

  // 一覧: 個人 (caller の user_id + client_id null) と全アクセス可能 client を union
  const accessible = await listAccessibleClientIds(service, user.id);

  const [personalRes, clientRes] = await Promise.all([
    service
      .from('ocr_uploads')
      .select('id, file_name, mode, file_size_bytes, created_at, ocr_result')
      .eq('user_id', user.id)
      .is('client_id', null)
      .order('created_at', { ascending: false })
      .limit(200),
    accessible.length > 0
      ? service
          .from('ocr_uploads')
          .select('id, file_name, mode, file_size_bytes, created_at, ocr_result')
          .in('client_id', accessible)
          .order('created_at', { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
  ]);

  if (personalRes.error) return NextResponse.json({ error: personalRes.error.message }, { status: 500 });
  if (clientRes.error) return NextResponse.json({ error: clientRes.error.message }, { status: 500 });

  const merged = [...(personalRes.data ?? []), ...(clientRes.data ?? [])];
  // 作成日時で降順に再整列して最新 200 件
  merged.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  const sliced = merged.slice(0, 200);

  const items = sliced.map((row) => {
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
