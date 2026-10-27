jest.mock('server-only', () => ({}));

import {
  INVITE_COOKIE,
  clearInviteCookieHeader,
  inviteCookieHeader,
  isInviteTokenFormat,
  isSameOriginJsonRequest,
  readInviteCookie,
} from './inviteCookie';

const TOKEN = 'd4'.repeat(32);

const req = (headers: Record<string, string>, url = 'http://localhost/api/invites/complete') =>
  new Request(url, { method: 'POST', headers });

describe('readInviteCookie', () => {
  it('他の Cookie が混ざっていても招待の Cookie を読む', () => {
    expect(readInviteCookie(req({ cookie: `theme=dark; ${INVITE_COOKIE}=${TOKEN}; x=1` }))).toBe(TOKEN);
  });

  it('無い・形式が不正な場合は null', () => {
    expect(readInviteCookie(req({}))).toBeNull();
    expect(readInviteCookie(req({ cookie: `${INVITE_COOKIE}=abc` }))).toBeNull();
    expect(readInviteCookie(req({ cookie: `${INVITE_COOKIE}=${'z'.repeat(64)}` }))).toBeNull();
  });
});

describe('Cookie の属性', () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    (process.env as any).NODE_ENV = original;
  });

  it('HttpOnly・SameSite=Lax・Path=/ を付け、有効期限は 30 分を超えない', () => {
    const header = inviteCookieHeader(TOKEN, 99999);
    expect(header).toContain(`${INVITE_COOKIE}=${TOKEN}`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=1800');
  });

  it('本番では Secure を付ける', () => {
    (process.env as any).NODE_ENV = 'production';
    expect(inviteCookieHeader(TOKEN, 60)).toContain('; Secure');
    expect(clearInviteCookieHeader()).toContain('; Secure');
  });

  it('消去は Max-Age=0 で値を空にする', () => {
    const header = clearInviteCookieHeader();
    expect(header).toContain(`${INVITE_COOKIE}=;`);
    expect(header).toContain('Max-Age=0');
  });

  it('負の有効期限は 0 にする', () => {
    expect(inviteCookieHeader(TOKEN, -5)).toContain('Max-Age=0');
  });
});

describe('isSameOriginJsonRequest', () => {
  it('同一オリジンの JSON 要求だけ通す', () => {
    expect(isSameOriginJsonRequest(req({ origin: 'http://localhost', 'content-type': 'application/json' }))).toBe(true);
  });

  it('Origin が別・無い・JSON でない場合は通さない', () => {
    expect(isSameOriginJsonRequest(req({ origin: 'https://evil.example', 'content-type': 'application/json' }))).toBe(false);
    expect(isSameOriginJsonRequest(req({ 'content-type': 'application/json' }))).toBe(false);
    expect(isSameOriginJsonRequest(req({ origin: 'http://localhost', 'content-type': 'text/plain' }))).toBe(false);
  });
});

describe('isInviteTokenFormat', () => {
  it('64 桁の16進数だけを受け付ける', () => {
    expect(isInviteTokenFormat(TOKEN)).toBe(true);
    expect(isInviteTokenFormat('short')).toBe(false);
    expect(isInviteTokenFormat(`${TOKEN}0`)).toBe(false);
  });
});
