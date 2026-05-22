import { createBrowserClient } from '@supabase/ssr';
import { authCookieOptions } from './cookie-options';

export function createClient() {
  // ブラウザの実ホストから cookie の Domain / secure を決める。
  // ここを固定値にすると invoice-ocr-tawny.vercel.app でログインできなくなる。
  const host = typeof window !== 'undefined' ? window.location.host : undefined;

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: authCookieOptions(host),
    }
  );
}
