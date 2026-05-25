import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/service';
import { applyGuestCookie, getGuestIdentity, identityKeys } from '@/lib/guest-identity';

const GUEST_MAX_USES = 5;

export async function GET(request: NextRequest) {
  const fingerprintId = request.nextUrl.searchParams.get('fingerprintId');
  // fingerprintId は省略可になった（cookie + IP+UA で識別できる）
  const identity = getGuestIdentity(request, fingerprintId);
  const keys = identityKeys(identity);

  const yearMonth = new Date().toISOString().slice(0, 7);
  const service = createServiceClient();

  const { data } = await service
    .from('guest_usage')
    .select('count')
    .in('fingerprint_id', keys)
    .eq('year_month', yearMonth);

  // 3 識別子のうち最大値を採用（一つでも上限到達なら limit 適用）
  const count = (data ?? []).reduce((max, row) => Math.max(max, row.count ?? 0), 0);

  const response = NextResponse.json({ count, limit: GUEST_MAX_USES });
  return applyGuestCookie(response, identity);
}
