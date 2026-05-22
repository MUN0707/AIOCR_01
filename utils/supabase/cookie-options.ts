// Supabase 認証 cookie のオプションを「アクセス中のホスト」から動的に決める。
//
// このアプリは本番で 2 つのドメインに同時公開している:
//   - ocr.taxbestsearch.com         … メイン（会社フィルタを通る顧客向け）
//   - invoice-ocr-tawny.vercel.app  … サブ（会社 Web フィルタ回避用）
//
// taxbestsearch.com 配下のサブドメイン間（ocr. / mail. 等）でセッションを共有
// したいので、その場合だけ cookie に `Domain=.taxbestsearch.com` を付ける。
// 一方 invoice-ocr-tawny.vercel.app では Domain を付けてはいけない。ブラウザは
// 自分のホストに一致しない Domain 属性の cookie を「丸ごと」拒否するため、
// Domain を `.taxbestsearch.com` 固定にすると vercel.app 側で PKCE verifier や
// セッション cookie が一切保存できず、ログイン不能になる（2026-05-22 実害）。
//
// secure はプロトコルではなくホストで判定（localhost のみ非 secure）。
// 本番の 2 ドメインはどちらも https なので secure: true で問題ない。

const SHARED_PARENT_DOMAIN = 'taxbestsearch.com';

function hostnameOf(host: string | null | undefined): string {
  // "ocr.taxbestsearch.com:443" のようなポート付きや大文字を正規化する
  return (host ?? '').split(':')[0].trim().toLowerCase();
}

/**
 * host から cookie の `Domain` 属性を決める。
 * taxbestsearch.com とそのサブドメインのみ `.taxbestsearch.com`、
 * それ以外（vercel.app / localhost / preview）は undefined（host-only cookie）。
 */
export function cookieDomainForHost(host: string | null | undefined): string | undefined {
  const hostname = hostnameOf(host);
  if (hostname === SHARED_PARENT_DOMAIN || hostname.endsWith('.' + SHARED_PARENT_DOMAIN)) {
    return '.' + SHARED_PARENT_DOMAIN;
  }
  return undefined;
}

/**
 * host から Supabase SSR 用の cookieOptions を組み立てる。
 * host が不明なときは本番想定（secure: true / Domain なし）にフォールバックする。
 */
export function authCookieOptions(host: string | null | undefined) {
  const hostname = hostnameOf(host);
  const isLocal =
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.local');
  return {
    domain: cookieDomainForHost(host),
    path: '/' as const,
    sameSite: 'lax' as const,
    secure: !isLocal,
  };
}
