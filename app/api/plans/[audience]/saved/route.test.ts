import { NextRequest } from 'next/server';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(),
  requireMembership: jest.fn(),
}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));

import { POST } from './route';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { createFakeDb, planRow } from '@/lib/plans/testing/fakeSupabase';

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const STRATEGY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ADMIN_A = '99999999-9999-4999-8999-999999999999';
const USER_MEMBER_A = '88888888-8888-4888-8888-888888888888';
const USER_ADMIN_B = '77777777-7777-4777-8777-777777777777';

function makeRequest(body: unknown, withAuth = true) {
  return new NextRequest('http://localhost/api/plans/bank/saved', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(withAuth ? { authorization: 'Bearer test-token' } : {}),
    },
    body: JSON.stringify(body),
  });
}

const context = (audience = 'bank') => ({ params: Promise.resolve({ audience }) });

let db: ReturnType<typeof createFakeDb>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);

  db = createFakeDb({
    strategy_data: [{ id: STRATEGY_A, company_id: COMPANY_A }],
  });
  db.rows.generated_plans.push(
    planRow({
      company_id: COMPANY_A,
      strategy_id: STRATEGY_A,
      audience: 'bank',
      generated_text: '# 銀行向け本文（会社A）',
      sections: ['# 銀行向け本文（会社A）'],
      generated_at: '2026-10-19T10:00:00.000Z',
    })
  );
  (getSupabaseAdmin as jest.Mock).mockReturnValue(db.client);
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER_ADMIN_A);
  (requireMembership as jest.Mock).mockImplementation(async (_admin: unknown, userId: string, companyId: string) => {
    if (userId === USER_ADMIN_A && companyId === COMPANY_A) return { userId, companyId, role: 'admin', departmentId: null };
    if (userId === USER_MEMBER_A && companyId === COMPANY_A) return { userId, companyId, role: 'member', departmentId: null };
    if (userId === USER_ADMIN_B && companyId === COMPANY_B) return { userId, companyId, role: 'admin', departmentId: null };
    return null;
  });
});

describe('POST /api/plans/[audience]/saved', () => {
  it('returns the saved plan with generated_at to an admin of the company', async () => {
    const res = await POST(
      makeRequest({ companyId: COMPANY_A, strategyId: STRATEGY_A, audience: 'bank' }),
      context()
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('saved');
    expect(json.generatedText).toBe('# 銀行向け本文（会社A）');
    expect(json.generatedAt).toBe('2026-10-19T10:00:00.000Z');
    expect(json.version).toBe(1);
  });

  it('lets a member read the saved plan', async () => {
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER_MEMBER_A);

    const res = await POST(
      makeRequest({ companyId: COMPANY_A, strategyId: STRATEGY_A, audience: 'bank' }),
      context()
    );

    expect(res.status).toBe(200);
    expect((await res.json()).generatedText).toBe('# 銀行向け本文（会社A）');
  });

  it('rejects an unauthenticated request', async () => {
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(null);

    const res = await POST(
      makeRequest({ companyId: COMPANY_A, strategyId: STRATEGY_A, audience: 'bank' }, false),
      context()
    );

    expect(res.status).toBe(401);
  });

  it('rejects a user who is not a member of the requested company', async () => {
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER_ADMIN_B);

    const res = await POST(
      makeRequest({ companyId: COMPANY_A, strategyId: STRATEGY_A, audience: 'bank' }),
      context()
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(JSON.stringify(json)).not.toContain('銀行向け本文');
  });

  it('rejects another company’s strategyId even when the caller belongs to that company', async () => {
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER_ADMIN_B);

    const res = await POST(
      makeRequest({ companyId: COMPANY_B, strategyId: STRATEGY_A, audience: 'bank' }),
      context()
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(JSON.stringify(json)).not.toContain('銀行向け本文');
  });

  it('rejects when the URL audience and the body audience differ', async () => {
    const res = await POST(
      makeRequest({ companyId: COMPANY_A, strategyId: STRATEGY_A, audience: 'shareholder' }),
      context('bank')
    );

    expect(res.status).toBe(400);
  });

  it('does not return another audience’s plan', async () => {
    const res = await POST(
      makeRequest({ companyId: COMPANY_A, strategyId: STRATEGY_A, audience: 'employee' }),
      context('employee')
    );

    expect(res.status).toBe(404);
  });

  it('returns 404 when no plan has been saved yet', async () => {
    db.rows.generated_plans.length = 0;

    const res = await POST(
      makeRequest({ companyId: COMPANY_A, strategyId: STRATEGY_A, audience: 'bank' }),
      context()
    );

    expect(res.status).toBe(404);
  });

  it('rejects an invalid body', async () => {
    const res = await POST(makeRequest({ companyId: 'x' }), context());

    expect(res.status).toBe(400);
  });
});
