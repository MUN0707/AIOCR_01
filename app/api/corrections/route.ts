import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

type CorrectionInput = {
  uploadId: string;
  itemIndex: number;
  fieldName: string;
  originalValue: string | null;
  correctedValue: string | null;
  mode: string;
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = (await request.json()) as { corrections?: CorrectionInput[] };
  const corrections = body.corrections ?? [];
  if (corrections.length === 0) {
    return NextResponse.json({ ok: true, saved: 0 });
  }

  const service = createServiceClient();

  const uploadIds = Array.from(new Set(corrections.map((c) => c.uploadId)));
  const { data: owned } = await service
    .from('ocr_uploads')
    .select('id')
    .in('id', uploadIds)
    .eq('user_id', user.id);
  const ownedIds = new Set((owned ?? []).map((r) => r.id));
  const valid = corrections.filter((c) => ownedIds.has(c.uploadId));
  if (valid.length === 0) {
    return NextResponse.json({ error: 'no owned uploads' }, { status: 403 });
  }

  const rows = valid.map((c) => ({
    user_id: user.id,
    upload_id: c.uploadId,
    item_index: c.itemIndex,
    field_name: c.fieldName,
    original_value: c.originalValue,
    corrected_value: c.correctedValue,
    mode: c.mode,
  }));

  const { error } = await service.from('ocr_corrections').insert(rows);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, saved: rows.length });
}
