import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/service';

const GUEST_MAX_USES = 5;

export async function GET(request: NextRequest) {
  const fingerprintId = request.nextUrl.searchParams.get('fingerprintId');
  if (!fingerprintId) {
    return NextResponse.json({ error: 'fingerprintId is required' }, { status: 400 });
  }

  const yearMonth = new Date().toISOString().slice(0, 7);
  const service = createServiceClient();

  const { data } = await service
    .from('guest_usage')
    .select('count')
    .eq('fingerprint_id', fingerprintId)
    .eq('year_month', yearMonth)
    .maybeSingle();

  const count = data?.count ?? 0;
  return NextResponse.json({ count, limit: GUEST_MAX_USES });
}
