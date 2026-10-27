/* eslint-disable @typescript-eslint/no-explicit-any -- DB モックの型は意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));

import { GET } from './route';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

const TOKEN = 'b2'.repeat(32);
const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';

function setupAdmin(invite: { expires_at: string; accepted_at: string | null } | null) {
  const from = jest.fn(() => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: invite, error: null }) }),
    }),
  }));
  (getSupabaseAdmin as jest.Mock).mockReturnValue({ from });
  return { from };
}

const handoff = (token: string | null) =>
  GET(new Request(`http://localhost/api/invites/handoff${token === null ? '' : `?token=${token}`}`));

const setCookies = (res: Response): string => {
  const h: any = res.headers;
  return typeof h.getSetCookie === 'function' ? h.getSetCookie().join(' | ') : res.headers.get('set-cookie') ?? '';
};

describe('GET /api/invites/handoff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('有効な招待は、HttpOnly・SameSite=Lax・Path=/ の Cookie に移し、URL からトークンを消して受諾画面へ戻す', async () => {
    setupAdmin({ expires_at: FUTURE, accepted_at: null });

    const res = await handoff(TOKEN);
    const cookie = setCookies(res);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('http://localhost/invite/accept');
    expect(res.headers.get('location')).not.toContain(TOKEN);
    expect(cookie).toContain(`gs_invite=${TOKEN}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(30 * 60);
  });

  it('期限切れの招待は Cookie を消し、エラー付きで戻す（トークンは URL に出さない）', async () => {
    setupAdmin({ expires_at: PAST, accepted_at: null });

    const res = await handoff(TOKEN);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('http://localhost/invite/accept?error=invite_expired');
    expect(setCookies(res)).toContain('gs_invite=;');
    expect(setCookies(res)).not.toContain(TOKEN);
  });

  it('消化済みの招待は Cookie を消し、無効としてエラー付きで戻す', async () => {
    setupAdmin({ expires_at: FUTURE, accepted_at: '2026-02-01T00:00:00.000Z' });

    const res = await handoff(TOKEN);

    expect(res.headers.get('location')).toBe('http://localhost/invite/accept?error=invalid_invite');
    expect(setCookies(res)).toContain('gs_invite=;');
  });

  it('存在しないトークンは Cookie を消して無効として扱う', async () => {
    setupAdmin(null);

    const res = await handoff(TOKEN);

    expect(res.headers.get('location')).toBe('http://localhost/invite/accept?error=invalid_invite');
    expect(setCookies(res)).toContain('gs_invite=;');
  });

  it('形式が不正なトークンは DB を見ずに無効として扱う', async () => {
    const { from } = setupAdmin({ expires_at: FUTURE, accepted_at: null });

    const res = await handoff('not-hex');

    expect(res.headers.get('location')).toBe('http://localhost/invite/accept?error=invalid_invite');
    expect(from).not.toHaveBeenCalled();
  });

  it('トークンが無い要求も無効として扱う', async () => {
    setupAdmin({ expires_at: FUTURE, accepted_at: null });

    const res = await handoff(null);

    expect(res.headers.get('location')).toBe('http://localhost/invite/accept?error=invalid_invite');
  });

  it('トークンをログに出さない', async () => {
    const logs: string[] = [];
    const spies = ['log', 'warn', 'error'].map((level) =>
      jest.spyOn(console, level as 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      })
    );
    try {
      setupAdmin({ expires_at: FUTURE, accepted_at: null });
      await handoff(TOKEN);
      expect(logs.join('\n')).not.toContain(TOKEN);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});
