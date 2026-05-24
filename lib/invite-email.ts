import { Resend } from 'resend';

let _resend: Resend | null = null;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const ROLE_LABEL: Record<string, string> = {
  approver: '承認者',
  entry: '入力者',
  viewer: '閲覧者',
};

export async function sendClientInvite(params: {
  toEmail: string;
  inviterEmail: string;
  clientName: string;
  role: string;
  inviteUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const roleLabel = ROLE_LABEL[params.role] ?? params.role;
    await getResend().emails.send({
      from: process.env.RESEND_SALES_FROM!,
      to: params.toEmail,
      subject: `[請求書スキャン] ${params.clientName} のメンバーに招待されました`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #0c4a6e; margin: 0 0 16px;">メンバー招待</h2>
          <p style="font-size: 14px; color: #334155; line-height: 1.7;">
            <strong>${escapeHtml(params.inviterEmail)}</strong> さんから、<br>
            <strong>${escapeHtml(params.clientName)}</strong> の <strong>${roleLabel}</strong> として招待されました。
          </p>
          <p style="margin: 24px 0;">
            <a href="${params.inviteUrl}"
               style="display:inline-block;background:#0284c7;color:#fff;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">
              招待を承諾する
            </a>
          </p>
          <p style="font-size: 12px; color: #64748b; line-height: 1.6;">
            このリンクは 7 日間有効です。<br>
            承諾には請求書スキャンのアカウントが必要です。アカウント無しの場合は承諾画面からそのまま作成できます。
          </p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="font-size: 11px; color: #94a3b8;">
            このメールに心当たりが無い場合は無視してください。<br>
            リンクが期限切れの場合は招待元に再発行を依頼してください。
          </p>
        </div>
      `,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'メール送信失敗' };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
