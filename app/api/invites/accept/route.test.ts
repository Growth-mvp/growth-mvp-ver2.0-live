/* eslint-disable @typescript-eslint/no-explicit-any -- DB・認証モックの型は意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/rbacGuard', () => ({ getAuthUserIdFromBearer: jest.fn() }));
jest.mock('@/lib/server/auditLog', () => ({
  logAuditEvent: jest.fn(async () => undefined),
  extractAuditMetadata: jest.fn(() => ({ ip: null, userAgent: null })),
}));

import { POST } from './route';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';

const USER = '99999999-9999-4999-8999-999999999999';
const COMPANY = '11111111-1111-4111-8111-111111111111';
const INVITE_ID = '44444444-4444-4444-8444-444444444444';
const INVITEE = 'invitee@example.com';
const TOKEN = 'a'.repeat(64);
const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';

type Invite = {
  id: string;
  company_id: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
};

function invite(overrides: Partial<Invite> = {}): Invite {
  return {
    id: INVITE_ID,
    company_id: COMPANY,
    email: INVITEE,
    role: 'member',
    expires_at: FUTURE,
    accepted_at: null,
    accepted_by: null,
    ...overrides,
  };
}

function setupAdmin(opts: {
  invite: Invite;
  email?: string;
  existing?: { company_id: string; user_id: string; role: string } | null;
  upsertError?: unknown;
}) {
  const state = {
    upserts: [] as Array<{ rows: any[]; options: any }>,
    invitePatches: [] as any[],
  };
  const user = {
    id: USER,
    email: opts.email ?? INVITEE,
    identities: [],
    user_metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
  };

  const admin: any = {
    from: (table: string) => {
      if (table === 'company_invites') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: opts.invite, error: null }) }),
          }),
          update: (payload: any) => ({
            eq: () => ({
              is: () => ({
                select: () => ({
                  maybeSingle: async () => {
                    state.invitePatches.push(payload);
                    return { data: { id: opts.invite.id }, error: null };
                  },
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'company_members') {
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            const builder: any = {
              eq: (col: string, val: unknown) => {
                filters[col] = val;
                return builder;
              },
              maybeSingle: async () => {
                const hit =
                  opts.existing &&
                  opts.existing.company_id === filters.company_id &&
                  opts.existing.user_id === filters.user_id
                    ? opts.existing
                    : null;
                return { data: hit, error: null };
              },
            };
            return builder;
          },
          upsert: async (rows: any[], options: any) => {
            state.upserts.push({ rows, options });
            return { error: opts.upsertError ?? null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    auth: {
      admin: {
        getUserById: jest.fn(async () => ({ data: { user }, error: null })),
      },
    },
  };

  (getSupabaseAdmin as jest.Mock).mockReturnValue(admin);
  return { state };
}

function req(body: unknown) {
  return new Request('http://localhost/api/invites/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  }) as any;
}

describe('POST /api/invites/accept（department_id を消さない）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
  });

  it('新規所属は company_id / user_id / role のみを書き込む（department_id を含めない）', async () => {
    const { state } = setupAdmin({ invite: invite({ role: 'manager' }) });

    const res = await POST(req({ token: TOKEN }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, companyId: COMPANY, role: 'manager' });
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0].rows).toEqual([{ company_id: COMPANY, user_id: USER, role: 'manager' }]);
    expect(state.upserts[0].rows[0]).not.toHaveProperty('department_id');
  });

  it('既存所属者の再受諾では部門を消さず、role も下げない', async () => {
    const { state } = setupAdmin({
      invite: invite({ role: 'member' }),
      existing: { company_id: COMPANY, user_id: USER, role: 'admin' },
    });

    const res = await POST(req({ token: TOKEN }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.role).toBe('admin');
    expect(state.upserts[0].rows[0]).toEqual({ company_id: COMPANY, user_id: USER, role: 'admin' });
    expect(state.upserts[0].rows[0]).not.toHaveProperty('department_id');
  });

  it('招待と別のメールのユーザーは 403 で、所属を作らない（従来の本人確認を維持）', async () => {
    const { state } = setupAdmin({ invite: invite(), email: 'someone-else@example.com' });

    const res = await POST(req({ token: TOKEN }));

    expect(res.status).toBe(403);
    expect(state.upserts).toHaveLength(0);
  });

  it('期限切れの招待は所属を作らない', async () => {
    const { state } = setupAdmin({ invite: invite({ expires_at: PAST }) });

    const res = await POST(req({ token: TOKEN }));

    expect(res.status).toBe(410);
    expect(state.upserts).toHaveLength(0);
  });
});
