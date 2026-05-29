import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { authCookieOptions } from '@/utils/supabase/cookie-options';

// エンドポイントごとのレート制限（1分間の最大リクエスト数）
const RATE_LIMITS: Record<string, { limit: number; windowSec: number }> = {
  '/api/process-pdf': { limit: 10, windowSec: 60 },
  '/api/match-journal': { limit: 15, windowSec: 60 },
};

async function handleRateLimit(request: NextRequest): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;
  const rateConfig = RATE_LIMITS[pathname];
  if (!rateConfig) return null;

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';
  const key = `${ip}:${pathname}`;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

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
  return null;
}

// 営業ページのトークン保護
const SALES_PROTECTED = ['/security', '/guide', '/faq'];
const SALES_COOKIE = 'sales_access';

function handleSalesToken(request: NextRequest): NextResponse | null {
  const { pathname, searchParams } = request.nextUrl;
  const isProtected = SALES_PROTECTED.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );
  if (!isProtected) return null;

  const token = process.env.SALES_TOKEN;
  if (!token) return null;

  // クッキー認証済み
  if (request.cookies.get(SALES_COOKIE)?.value === token) return null;

  // URLトークン認証
  const queryToken = searchParams.get('t');
  if (queryToken === token) {
    const url = request.nextUrl.clone();
    url.searchParams.delete('t');
    const res = NextResponse.redirect(url);
    res.cookies.set(SALES_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    });
    return res;
  }

  return NextResponse.redirect(new URL('/denied', request.url));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // レート制限（IP単位）を最初にチェック
  const rateLimitResponse = await handleRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  // 営業ページのトークン保護をチェック
  const salesResponse = handleSalesToken(request);
  if (salesResponse) return salesResponse;

  // Stripe webhookはSupabase認証不要（Stripeサーバーからのリクエスト）
  if (pathname.startsWith('/api/stripe/webhook')) {
    return NextResponse.next({ request });
  }

  // セッションクッキーのリフレッシュ用レスポンス（Supabase SSR 必須パターン）
  let supabaseResponse = NextResponse.next({ request });

  // アクセス中のホストから cookie の Domain / secure を決める
  // （taxbestsearch.com 配下のみ Domain 付き、vercel.app は host-only）
  const cookieOptions = authCookieOptions(request.headers.get('host'));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          // cookieOptions をマージしないと middleware の refresh で
          // domain 属性が不一致の cookie が並列に書かれ、後段の getUser() が混乱する
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, { ...options, ...cookieOptions })
          );
        },
      },
    }
  );

  // セッション確認（getUser() を使うことが重要 - getSession() はサーバー側で信頼できない）
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 認証不要の公開ページ
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/subscribe') ||
    pathname.startsWith('/tokusho') ||
    pathname.startsWith('/denied') ||
    pathname.startsWith('/lp') ||
    pathname.startsWith('/pricing') ||
    pathname.startsWith('/api/subscribe') ||
    pathname.startsWith('/api/auth/signout')
  ) {
    return supabaseResponse;
  }

  // 未認証の場合
  if (!user) {
    // ゲスト初回お試し：トップページとPDF処理API・照合API・エラー報告APIは認証不要
    if (pathname === '/' || pathname.startsWith('/api/process-pdf') || pathname.startsWith('/api/match-journal') || pathname.startsWith('/api/report-error')) {
      return supabaseResponse;
    }
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  // 管理者は全アクセス可（サブスク不要）。aiocr_admins テーブルの RLS で自分の行のみ見える
  const { data: adminRow } = await supabase
    .from('aiocr_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const isAdminUser = !!adminRow;
  if (isAdminUser) {
    return supabaseResponse;
  }

  // /admin は管理者のみ
  if (pathname.startsWith('/admin')) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/';
    return NextResponse.redirect(homeUrl);
  }

  // 以下は aiocr サブスクチェック対象外:
  // - /pricing : リダイレクトループ防止
  // - /mypage : 契約状態を見る画面そのもの
  // - /api/invoice : 請求書 DL（メルマガのみ契約のユーザーも自分の請求書を取得する必要がある）
  // - /api/auth : 認証系（ログアウト等）
  if (
    pathname.startsWith('/pricing') ||
    pathname.startsWith('/mypage') ||
    pathname.startsWith('/api/invoice') ||
    pathname.startsWith('/api/auth')
  ) {
    return supabaseResponse;
  }

  // サブスクリプションチェック（メインアプリと /api/ ルート）
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('status, trial_end_at, subscription_end_at')
    .eq('user_id', user.id)
    .single();

  const now = new Date();
  const isAllowed =
    subscription &&
    ((subscription.status === 'trial' &&
      subscription.trial_end_at &&
      new Date(subscription.trial_end_at) > now) ||
      (subscription.status === 'active' &&
        (!subscription.subscription_end_at ||
          new Date(subscription.subscription_end_at) > now)));

  if (!isAllowed) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Subscription required' }, { status: 403 });
    }
    const pricingUrl = request.nextUrl.clone();
    pricingUrl.pathname = '/pricing';
    return NextResponse.redirect(pricingUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
