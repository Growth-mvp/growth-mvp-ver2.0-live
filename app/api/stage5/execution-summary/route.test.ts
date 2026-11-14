/* eslint-disable @typescript-eslint/no-explicit-any -- DB モックの型は意図的に緩く定義している */
jest.mock('server-only', () => ({}));
const mockHeaderState: { authorization: string | null; tokenValid: boolean } = { authorization: 'Bearer test-token', tokenValid: true };
jest.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (mockHeaderState.authorization) h.set('authorization', mockHeaderState.authorization);
    return h;
  },
}));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

import { NextRequest } from 'next/server';
import { GET } from './route';
import { createClient } from '@supabase/supabase-js';

const USER = '99999999-9999-4999-8999-999999999999';
const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const COMPANY_C = '33333333-3333-4333-8333-333333333333';

type Call = { table: string; filters: Record<string, unknown> };

function makeAdmin(memberships: string[]) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const builder: any = new Proxy(
      {},
      {
        get(_target, prop: string) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) => {
              calls.push({ table, filters: { ...filters } });
              resolve({ data: [], error: null, count: 0 });
            };
          }
          if (prop === 'maybeSingle' || prop === 'single') {
            return async () => {
              calls.push({ table, filters: { ...filters } });
              if (table === 'company_members') {
                const hit = memberships.includes(filters.company_id as string);
                return { data: hit ? { company_id: filters.company_id } : null, error: null };
              }
              return { data: null, error: null };
            };
          }
          return (col?: string, val?: unknown) => {
            if (prop === 'eq' && typeof col === 'string') filters[col] = val;
            return builder;
          };
        },
      },
    );
    return builder;
  };
  return {
    calls,
    auth: {
      getUser: async () =>
        mockHeaderState.tokenValid
          ? { data: { user: { id: USER } }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } },
    },
    from,
  };
}

function request(companyId?: string) {
  const qs = companyId ? `?companyId=${companyId}` : '';
  return new NextRequest(`http://localhost/api/stage5/execution-summary${qs}`);
}

describe('GET /api/stage5/execution-summary', () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  });

  it('単一会社: 所属する会社IDで集計し、所属確認は会社IDとユーザーIDの両方で絞る', async () => {
    const admin = makeAdmin([COMPANY_A]);
    (createClient as jest.Mock).mockReturnValue(admin);
    const res = await GET(request(COMPANY_A));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    const membershipCall = admin.calls.find((c) => c.table === 'company_members');
    expect(membershipCall?.filters).toEqual({ user_id: USER, company_id: COMPANY_A });
  });

  it('複数会社: 指定した会社B のデータだけを集計し、他社の会社IDでは取得しない', async () => {
    const admin = makeAdmin([COMPANY_A, COMPANY_B]);
    (createClient as jest.Mock).mockReturnValue(admin);
    const res = await GET(request(COMPANY_B));
    expect(res.status).toBe(200);
    const scoped = admin.calls.filter((c) => c.table !== 'company_members' && 'company_id' in c.filters);
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((c) => c.filters.company_id === COMPANY_B)).toBe(true);
    expect(admin.calls.some((c) => c.filters.company_id === COMPANY_A)).toBe(false);
  });

  it('複数会社: 所属のない会社IDは403で、集計クエリを実行しない', async () => {
    const admin = makeAdmin([COMPANY_A, COMPANY_B]);
    (createClient as jest.Mock).mockReturnValue(admin);
    const res = await GET(request(COMPANY_C));
    expect(res.status).toBe(403);
    expect(admin.calls.some((c) => c.table === 'okrs')).toBe(false);
  });

  it('会社IDがない、または不正な場合は400', async () => {
    const admin = makeAdmin([COMPANY_A]);
    (createClient as jest.Mock).mockReturnValue(admin);
    expect((await GET(request())).status).toBe(400);
    expect((await GET(request('not-a-uuid'))).status).toBe(400);
  });
});

describe('GET /api/stage5/execution-summary：認証', () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  });
  afterEach(() => {
    mockHeaderState.authorization = 'Bearer test-token';
    mockHeaderState.tokenValid = true;
  });

  it('トークンがない場合は401で、どのテーブルも読まない', async () => {
    mockHeaderState.authorization = null;
    const admin = makeAdmin([COMPANY_A]);
    (createClient as jest.Mock).mockReturnValue(admin);
    const res = await GET(request(COMPANY_A));
    expect(res.status).toBe(401);
    expect(admin.calls).toHaveLength(0);
  });

  it('トークンが無効・期限切れの場合は401で、どのテーブルも読まない', async () => {
    mockHeaderState.tokenValid = false;
    const admin = makeAdmin([COMPANY_A]);
    (createClient as jest.Mock).mockReturnValue(admin);
    const res = await GET(request(COMPANY_A));
    expect(res.status).toBe(401);
    expect(admin.calls).toHaveLength(0);
  });
});
