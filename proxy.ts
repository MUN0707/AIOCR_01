import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Stripe webhookはSupabase認証不要（Stripeサーバーからのリクエスト）
  if (pathname.startsWith('/api/stripe/webhook')) {
    return NextResponse.next({ request });
  }

  // セッションクッキーのリフレッシュ用レスポンス（Supabase SSR 必須パターン）
  let supabaseResponse = NextResponse.next({ request });

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
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // セッション確認（getUser() を使うことが重要 - getSession() はサーバー側で信頼できない）
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 認証不要の公開ページ（/login, /auth/*, /pricing, /subscribe）
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/pricing') ||
    pathname.startsWith('/subscribe')
  ) {
    return supabaseResponse;
  }

  // 未認証の場合
  if (!user) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  // 管理者は全アクセス可（サブスク不要）
  if (user.email === process.env.ADMIN_EMAIL) {
    return supabaseResponse;
  }

  // /admin は管理者メールのみ
  if (pathname.startsWith('/admin')) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/';
    return NextResponse.redirect(homeUrl);
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
