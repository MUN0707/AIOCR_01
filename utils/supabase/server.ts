import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverAuthCookieOptions } from './cookie-options.server';

export async function createClient() {
  const cookieStore = await cookies();
  // リクエストの Host から cookie の Domain / secure を決める
  const cookieOptions = await serverAuthCookieOptions();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, { ...options, ...cookieOptions })
            );
          } catch {
            // Server Component からの呼び出しの場合は無視（middleware がセッションを更新する）
          }
        },
      },
    }
  );
}
