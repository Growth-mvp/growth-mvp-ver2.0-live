/* eslint-disable @typescript-eslint/no-explicit-any -- DB モックの型は意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));

import { GET } from './route';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

const TOKEN = 'c3'.repeat(32);
const COMPANY = '11111111-1111-4111-8111-111111111111';
const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';

function setupAdmin(invite: any) {
  const from = jest.fn((table: string) => {
    if (table === 'company_invites') {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: invite, error: null }) }),
        }),
      };
    }
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { id: COMPANY, name: 'テスト株式会社' }, error: null }) }),
      }),
    };
  });
  (getSupabaseAdmin as jest.Mock).mockReturnValue({ from });
  return { from };
}

const invite = (overrides: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  email: 'invitee@example.com',
  company_id: COMPANY,
  role: 'manager',
  expires_at: FUTURE,
  accepted_at: null,
  created_by: null,
  ...overrides,
});

const get = (cookie: string | null) =>
  GET(
    new Request('http://localhost/api/invites/info', {
      headers: cookie ? { cookie } : {},
    })
  );

describe('GET /api/invites/info（Cookie から読む）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Cookie が無ければ 400 で、DB を見ない', async () => {
    const { from } = setupAdmin(invite());

    const res = await get(null);

    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('有効な Cookie なら招待の概要を返す（トークンは返さない）', async () => {
    setupAdmin(invite());

    const res = await get(`gs_invite=${TOKEN}`);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, email: 'invitee@example.com', companyId: COMPANY, role: 'manager' });
    expect(JSON.stringify(json)).not.toContain(TOKEN);
  });

  it('消化済みの招待は 400 で、Cookie を消す', async () => {
    setupAdmin(invite({ accepted_at: '2026-02-01T00:00:00.000Z' }));

    const res = await get(`gs_invite=${TOKEN}`);

    expect(res.status).toBe(400);
    expect((res.headers as any).getSetCookie?.().join(' ') ?? res.headers.get('set-cookie')).toContain('gs_invite=;');
  });

  it('期限切れの招待は 400 で、Cookie を消す', async () => {
    setupAdmin(invite({ expires_at: PAST }));

    const res = await get(`gs_invite=${TOKEN}`);

    expect(res.status).toBe(400);
    expect((res.headers as any).getSetCookie?.().join(' ') ?? res.headers.get('set-cookie')).toContain('gs_invite=;');
  });

  it('存在しないトークンは 404 で、Cookie を消す', async () => {
    setupAdmin(null);

    const res = await get(`gs_invite=${TOKEN}`);

    expect(res.status).toBe(404);
    expect((res.headers as any).getSetCookie?.().join(' ') ?? res.headers.get('set-cookie')).toContain('gs_invite=;');
  });
});
