import 'server-only';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'GROWTH SHIFT <no-reply@growthshift.jp>';

/** 既存の Resend 設定（RESEND_API_KEY / INVITE_EMAIL_FROM）で送信する。本文はログに出さない。 */
export async function sendInviteMail(params: { to: string; subject: string; text: string }): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[invite-mail] RESEND_API_KEY is not configured');
    return false;
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.INVITE_EMAIL_FROM || DEFAULT_FROM,
        to: [params.to],
        subject: params.subject,
        text: params.text,
      }),
    });

    if (!res.ok) {
      console.error('[invite-mail] send failed:', { status: res.status });
      return false;
    }
    return true;
  } catch (e: unknown) {
    console.error('[invite-mail] send exception:', e instanceof Error ? e.name : 'unknown');
    return false;
  }
}
