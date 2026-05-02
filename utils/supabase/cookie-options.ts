// サブドメイン横断（ocr.taxbestsearch.com / mail.taxbestsearch.com）で
// Supabase 認証セッションを共有するための cookie オプション。
// 本番（Vercel production）でのみ親ドメインに発行する。
// preview / localhost ではドメイン未指定にして既存の挙動を保つ。

export const AUTH_COOKIE_DOMAIN: string | undefined =
  process.env.VERCEL_ENV === 'production' ? '.taxbestsearch.com' : undefined;

export const AUTH_COOKIE_OPTIONS = {
  domain: AUTH_COOKIE_DOMAIN,
  path: '/',
  sameSite: 'lax' as const,
  secure: process.env.VERCEL_ENV === 'production',
};
