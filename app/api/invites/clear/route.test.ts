jest.mock('server-only', () => ({}));

import { POST } from './route';

const req = (headers: Record<string, string>) =>
  new Request('http://localhost/api/invites/clear', { method: 'POST', headers, body: '{}' });

const setCookies = (res: Response): string => {
  const h: any = res.headers;
  return typeof h.getSetCookie === 'function' ? h.getSetCookie().join(' | ') : res.headers.get('set-cookie') ?? '';
};

describe('POST /api/invites/clear', () => {
  it('同一オリジンの JSON 要求なら招待 Cookie を消す', async () => {
    const res = await POST(req({ origin: 'http://localhost', 'content-type': 'application/json' }) as any);

    expect(res.status).toBe(200);
    expect(setCookies(res)).toContain('gs_invite=;');
    expect(setCookies(res)).toContain('Max-Age=0');
  });

  it('別オリジン・Origin なし・JSON 以外は 403 で、Cookie を消さない', async () => {
    const cross = await POST(req({ origin: 'https://evil.example', 'content-type': 'application/json' }) as any);
    const none = await POST(req({ 'content-type': 'application/json' }) as any);
    const text = await POST(req({ origin: 'http://localhost', 'content-type': 'text/plain' }) as any);

    for (const res of [cross, none, text]) {
      expect(res.status).toBe(403);
      expect(setCookies(res)).toBe('');
    }
  });
});
