// Resend API のラッパー。primary キーで失敗したら backup キーへ自動フェイルオーバーする。
//
// 環境変数:
//   RESEND_API_KEY         primary（通常使うキー）
//   RESEND_API_KEY_BACKUP  backup（primary が auth エラーで落ちた時に試す）

const RESEND_API_BASE = 'https://api.resend.com';

type AuthLikeFailure = { isAuthIssue: boolean };

function isAuthIssue(status: number, bodyText: string): boolean {
  if (status === 401 || status === 403) return true;
  // Resend は無効キーで 400 + "API key is invalid" を返す
  if (status === 400 && bodyText.toLowerCase().includes('api key is invalid')) return true;
  // 422 もキー権限不足のケース
  if (status === 422 && bodyText.toLowerCase().includes('api key')) return true;
  return false;
}

async function callOnce(
  key: string,
  path: string,
  init: { method: string; body?: string; extraHeaders?: Record<string, string> },
): Promise<{ ok: boolean; status: number; bodyText: string; bodyJson: unknown }> {
  const res = await fetch(`${RESEND_API_BASE}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.extraHeaders || {}),
    },
    body: init.body,
  });
  const bodyText = await res.text();
  let bodyJson: unknown = null;
  try {
    bodyJson = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    /* not json */
  }
  return { ok: res.ok, status: res.status, bodyText, bodyJson };
}

/**
 * Resend API を呼び出す。primary が auth 系エラーで失敗した場合のみ backup を試す。
 * （ネットワークエラーや 5xx はリトライしない＝重複送信を避けるため）
 */
export async function resendCall(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ ok: boolean; status: number; data: unknown; usedBackup: boolean }> {
  const primary = process.env.RESEND_API_KEY;
  const backup = process.env.RESEND_API_KEY_BACKUP;
  const method = init.method || 'POST';
  const body = init.body !== undefined ? JSON.stringify(init.body) : undefined;
  const extraHeaders = init.headers;

  if (!primary && !backup) {
    return { ok: false, status: 0, data: { error: 'no Resend key configured' }, usedBackup: false };
  }

  // primary を試す
  if (primary) {
    const r = await callOnce(primary, path, { method, body, extraHeaders });
    if (r.ok) return { ok: true, status: r.status, data: r.bodyJson, usedBackup: false };
    if (isAuthIssue(r.status, r.bodyText) && backup && backup !== primary) {
      console.error(
        `[resend] PRIMARY KEY FAILED on ${method} ${path} (status=${r.status}): ${r.bodyText.slice(0, 200)} — failing over to BACKUP`,
      );
      const r2 = await callOnce(backup, path, { method, body, extraHeaders });
      if (r2.ok) return { ok: true, status: r2.status, data: r2.bodyJson, usedBackup: true };
      return { ok: false, status: r2.status, data: r2.bodyJson ?? { error: r2.bodyText }, usedBackup: true };
    }
    return { ok: false, status: r.status, data: r.bodyJson ?? { error: r.bodyText }, usedBackup: false };
  }

  // primary 未設定で backup のみ
  const r = await callOnce(backup!, path, { method, body, extraHeaders });
  return { ok: r.ok, status: r.status, data: r.bodyJson ?? { error: r.bodyText }, usedBackup: true };
}

export type ResendEmailPayload = {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string;
  attachments?: Array<{ filename: string; content: string }>;
  headers?: Record<string, string>;
};

/**
 * メール送信のショートカット。result.id が返れば成功。
 */
export async function resendSendEmail(payload: ResendEmailPayload): Promise<{
  ok: boolean;
  id?: string;
  error?: string;
  usedBackup: boolean;
}> {
  const r = await resendCall('/emails', { method: 'POST', body: payload });
  if (r.ok) {
    const id = (r.data as { id?: string } | null)?.id;
    return { ok: true, id, usedBackup: r.usedBackup };
  }
  return {
    ok: false,
    error: typeof r.data === 'string' ? r.data : JSON.stringify(r.data),
    usedBackup: r.usedBackup,
  };
}
