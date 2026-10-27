import 'server-only';

export const INVITE_COOKIE = 'gs_invite';
export const INVITE_COOKIE_MAX_AGE_SECONDS = 30 * 60;

const TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

export function isInviteTokenFormat(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export function readInviteCookie(req: Request): string | null {
  const header = req.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() !== INVITE_COOKIE) continue;
    const value = part.slice(idx + 1).trim();
    return isInviteTokenFormat(value) ? value : null;
  }
  return null;
}

function secureFlag(): string {
  return process.env.NODE_ENV === 'production' ? '; Secure' : '';
}

export function inviteCookieHeader(token: string, maxAgeSeconds: number): string {
  const maxAge = Math.max(0, Math.min(INVITE_COOKIE_MAX_AGE_SECONDS, Math.floor(maxAgeSeconds)));
  return `${INVITE_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag()}`;
}

export function clearInviteCookieHeader(): string {
  return `${INVITE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag()}`;
}

/** 状態を変えるリクエストは、同一オリジンからの JSON 呼び出しだけを受け付ける（CSRF 対策） */
export function isSameOriginJsonRequest(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(req.url).origin) return false;
  const contentType = (req.headers.get('content-type') || '').toLowerCase();
  return contentType.includes('application/json');
}
