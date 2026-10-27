/* eslint-disable @typescript-eslint/no-explicit-any -- 偽の管理クライアントを通して、provision の振る舞いを確認する */
jest.mock('server-only', () => ({}));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabaseServer', () => ({ getServerUser: jest.fn(async () => ({ user: null })) }));

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type Row = Record<string, any>;
type Db = {
  profiles: Row[];
  company_members: Row[];
  strategy_data: Row[];
  companies: Row[];
  rpcResult: { data: any; error: any };
  rpcCalls: Array<Record<string, any>>;
};

const CO_OWN = '11111111-1111-4111-8111-111111111111';
const CO_OTHER = '22222222-2222-4222-8222-222222222222';
const CO_NEW = '33333333-3333-4333-8333-333333333333';
const U_MEMBER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U_STRANGER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOKEN = { member: 'tok-member', stranger: 'tok-stranger' } as const;
const USERS: Record<string, { id: string; email: string }> = {
  [TOKEN.member]: { id: U_MEMBER, email: 'member@example.com' },
  [TOKEN.stranger]: { id: U_STRANGER, email: 'stranger@example.com' },
};

function freshDb(overrides: Partial<Db> = {}): Db {
  return {
    profiles: [{ id: U_MEMBER }, { id: U_STRANGER }],
    company_members: [{ company_id: CO_OWN, user_id: U_MEMBER, role: 'member', created_at: '2026-01-01T00:00:00Z' }],
    strategy_data: [],
    companies: [],
    rpcResult: { data: CO_NEW, error: null },
    rpcCalls: [],
    ...overrides,
  };
}

function createFakeAdmin(db: Db) {
  let seq = 0;
  const tableOf = (name: string): Row[] => {
    if (name === 'profiles' || name === 'company_members' || name === 'strategy_data' || name === 'companies') {
      return db[name];
    }
    throw new Error(`fake admin: unexpected table ${name}`);
  };

  const from = (name: string) => {
    const rows = tableOf(name);
    let op: 'select' | 'insert' = 'select';
    let payload: Row[] = [];
    let single: 'none' | 'maybe' | 'single' = 'none';
    const filters: Array<(r: Row) => boolean> = [];
    const run = () => {
      if (op === 'insert') {
        const inserted = payload.map((p) => {
          const r = { id: `id-${name}-${++seq}`, ...p };
          rows.push(r);
          return r;
        });
        return single !== 'none' ? { data: inserted[0] ?? null, error: null } : { data: inserted, error: null };
      }
      const matched = rows.filter((r) => filters.every((f) => f(r)));
      return single !== 'none' ? { data: matched[0] ?? null, error: null } : { data: matched, error: null };
    };
    const api: any = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return api;
      },
      order: () => api,
      limit: () => api,
      maybeSingle: () => {
        single = 'maybe';
        return api;
      },
      single: () => {
        single = 'single';
        return api;
      },
      insert: (rowsIn: Row[]) => {
        op = 'insert';
        payload = rowsIn;
        return api;
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        try {
          return Promise.resolve(resolve(run()));
        } catch (e) {
          return Promise.resolve(reject(e));
        }
      },
    };
    return api;
  };

  return {
    from,
    auth: {
      getUser: async (token: string) => {
        const u = USERS[token];
        return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'invalid' } };
      },
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      db.rpcCalls.push({ fn, ...args });
      return Promise.resolve(db.rpcResult);
    },
  };
}

function req(opts: { token?: string; cookie?: string; create?: boolean }) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.cookie = `company_id=${opts.cookie}`;
  if (opts.create) headers['x-growth-provision-mode'] = 'create';
  return new NextRequest('http://localhost/api/companies/provision', { method: 'POST', headers });
}

let POST: (req: NextRequest) => Promise<Response>;

function setup(db: Db) {
  const fake = createFakeAdmin(db);
  (createClient as jest.Mock).mockReturnValue(fake);
  return db;
}

describe('POST /api/companies/provision（ENABLE_SIGNUP_ADMIN と既存所属の初期化）', () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://provision-test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    POST = require('./route').POST;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    delete process.env.ENABLE_SIGNUP_ADMIN;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('認証が無ければ 401（既存の挙動）', async () => {
    setup(freshDb());
    const res = await POST(req({}));
    expect(res.status).toBe(401);
  });

  it('フラグ無効でも、既存メンバーは戦略データの初期行を作れる（所属確認の後に seed する）', async () => {
    const db = setup(freshDb());
    const res = await POST(req({ token: TOKEN.member }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, companyId: CO_OWN, note: 'already_in_company' });
    expect(body.strategyId).toEqual(expect.any(String));
    expect(db.strategy_data).toEqual([expect.objectContaining({ company_id: CO_OWN, user_id: U_MEMBER })]);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('既存メンバーが別会社の cookie を送っても、その会社は初期化されず、自分の所属会社だけを返す', async () => {
    const db = setup(freshDb());
    const res = await POST(req({ token: TOKEN.member, cookie: CO_OTHER }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.companyId).toBe(CO_OWN);
    expect(db.strategy_data.some((r) => r.company_id === CO_OTHER)).toBe(false);
    expect(db.strategy_data.some((r) => r.company_id === CO_OWN)).toBe(true);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('フラグ無効で、既存メンバーが create 指定をしても、新規作成は行わず既存の所属を返す', async () => {
    const db = setup(freshDb());
    const res = await POST(req({ token: TOKEN.member, create: true }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.note).toBe('already_in_company');
    expect(db.companies).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('フラグ無効で、未所属ユーザーが create 指定をすると 403 で拒否し、何も作らない', async () => {
    const db = setup(freshDb());
    const before = { sd: db.strategy_data.length, cm: db.company_members.length };
    const res = await POST(req({ token: TOKEN.stranger, create: true }));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'signup_admin_disabled' });
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.companies).toHaveLength(0);
    expect(db.strategy_data).toHaveLength(before.sd);
    expect(db.company_members).toHaveLength(before.cm);
  });

  it('未所属ユーザーが create 指定なしで来ると 403（needs_membership）。seed も行わない', async () => {
    const db = setup(freshDb());
    const res = await POST(req({ token: TOKEN.stranger }));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'needs_membership' });
    expect(db.strategy_data).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('フラグ有効なら、未所属ユーザーの create 指定で会社を作成し、戦略データを初期化する', async () => {
    process.env.ENABLE_SIGNUP_ADMIN = 'true';
    const db = setup(freshDb());
    const res = await POST(req({ token: TOKEN.stranger, create: true }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, companyId: CO_NEW, via: 'rpc' });
    expect(db.rpcCalls).toEqual([expect.objectContaining({ fn: 'provision_company', p_user_id: U_STRANGER })]);
    expect(db.strategy_data).toEqual([expect.objectContaining({ company_id: CO_NEW, user_id: U_STRANGER })]);
  });

  it('フラグ有効でも、create 指定が無い未所属ユーザーは作成されない（needs_membership）', async () => {
    process.env.ENABLE_SIGNUP_ADMIN = 'true';
    const db = setup(freshDb());
    const res = await POST(req({ token: TOKEN.stranger }));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'needs_membership' });
    expect(db.rpcCalls).toHaveLength(0);
  });
});
