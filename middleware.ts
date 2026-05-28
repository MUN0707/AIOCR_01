import { NextRequest, NextResponse } from 'next/server';

// エンドポイントごとのレート制限（1分間の最大リクエスト数）
const RATE_LIMITS: Record<string, { limit: number; windowSec: number }> = {
  '/api/process-pdf': { limit: 10, windowSec: 60 },
  '/api/match-journal': { limit: 15, windowSec: 60 },
};

export const config = {
  matcher: ['/api/process-pdf', '/api/match-journal'],
};

export async function middleware(request: NextRequest) {
  const { pathname } = new URL(request.url);
  const rateConfig = RATE_LIMITS[pathname];
  if (!rateConfig) return NextResponse.next();

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';
  const key = `${ip}:${pathname}`;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) return NextResponse.next();

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/check_and_increment_rate_limit`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_key: key,
        p_limit: rateConfig.limit,
        p_window_seconds: rateConfig.windowSec,
      }),
    });

    const allowed: boolean = await res.json();
    if (!allowed) {
      return NextResponse.json(
        { error: 'リクエスト頻度の上限に達しました。しばらく待ってから再試行してください。' },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateConfig.windowSec),
            'X-RateLimit-Limit': String(rateConfig.limit),
          },
        }
      );
    }
  } catch {
    // Supabase 障害時はフェイルオープン（制限をバイパス）
  }

  return NextResponse.next();
}
