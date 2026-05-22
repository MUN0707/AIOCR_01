// Server Component / Route Handler 用。リクエストの Host ヘッダから
// authCookieOptions を解決する。next/headers に依存するので、ブラウザ
// バンドルに混ぜないよう cookie-options.ts とは別ファイルに分けている。
import { headers } from 'next/headers';
import { authCookieOptions } from './cookie-options';

export async function serverAuthCookieOptions() {
  const host = (await headers()).get('host');
  return authCookieOptions(host);
}
