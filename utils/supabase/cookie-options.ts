// サブドメイン横断（ocr.taxbestsearch.com / mail.taxbestsearch.com）で
// Supabase 認証セッションを共有するための cookie オプション。
// 本番（Vercel production）でのみ親ドメインに発行する。
// preview / localhost ではドメイン未指定にして既存の挙動を保つ。
//
// 重要: `process.env.VERCEL_ENV` は server runtime のみで設定され、Next.js の
// client bundle には展開されない（NEXT_PUBLIC_ プレフィックスが必須）。
// browser 側で常に `secure: false` / `domain: undefined` になっていたため、
// `Domain` 属性付き cookie を `Secure` 無しで書く形になり、ブラウザによっては
// `SameSite=Lax` + `Domain` 属性付き cookie の保存が拒否されていた。
// `NEXT_PUBLIC_VERCEL_ENV` を Vercel env に明示的に追加して両方の runtime で
// 同じ値を読めるようにしている。

const VERCEL_ENV = process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV;
const IS_PRODUCTION = VERCEL_ENV === 'production';

export const AUTH_COOKIE_DOMAIN: string | undefined =
  IS_PRODUCTION ? '.taxbestsearch.com' : undefined;

export const AUTH_COOKIE_OPTIONS = {
  domain: AUTH_COOKIE_DOMAIN,
  path: '/',
  sameSite: 'lax' as const,
  secure: IS_PRODUCTION,
};
