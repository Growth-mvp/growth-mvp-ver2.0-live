/* eslint-disable @typescript-eslint/no-explicit-any -- DB モックの型は意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/rbacGuard', () => ({ getAuthUserIdFromBearer: jest.fn() }));

import { POST } from './route';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';

const USER = '99999999-9999-4999-8999-999999999999';
const COMPANY = '11111111-1111-4111-8111-111111111111';
const INVITE_ID = '44444444-4444-4444-8444-444444444444';
const INVITE_ID_2 = '55555555-5555-4555-8555-555555555555';
const INVITEE = 'invitee@example.com';
const OTHER = 'attacker@example.com';
const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';

type InviteRow = {
  id: string;
  company_id: string;
  role: string;
  email: string;
  expires_at: string;
  accepted_at: string | null;
};
type MemberRow = { company_id: string; user_id: string; role: string };

type Setup = {
  authEmail: string | null;
  authError?: unknown;
  emailConfirmedAt?: string | null;
  invites: InviteRow[];
  members?: MemberRow[];
  upsertError?: unknown;
};

function invite(overrides: Partial<InviteRow> = {}): InviteRow {
  return {
    id: INVITE_ID,
    company_id: COMPANY,
    role: 'manager',
    email: INVITEE,
    expires_at: FUTURE,
    accepted_at: null,
    ...overrides,
  };
}

function setupAdmin({
  authEmail,
  authError = null,
  emailConfirmedAt = '2026-01-01T00:00:00.000Z',
  invites,
  members = [],
  upsertError = null,
}: Setup) {
  const state = {
    members: [...members],
    upsertRows: [] as any[],
    upsertOptions: [] as any[],
    inviteUpdates: [] as Array<{ filters: Record<string, unknown>; payload: any }>,
  };

  const admin: any = {
    auth: {
      admin: {
        getUserById: jest.fn(async () => ({
          data: {
            user: authEmail === null ? null : { id: USER, email: authEmail, email_confirmed_at: emailConfirmedAt },
          },
          error: authError,
        })),
      },
    },
    from: (table: string) => {
      if (table === 'company_invites') {
        const filters: Record<string, unknown> = {};
        const gtFilters: Record<string, string> = {};
        let acceptedNull = false;
        const builder: any = {
          select: () => builder,
          eq: (col: string, val: unknown) => {
            filters[col] = val;
            return builder;
          },
          is: (col: string, val: unknown) => {
            if (col === 'accepted_at' && val === null) acceptedNull = true;
            return builder;
          },
          gt: (col: string, val: string) => {
            gtFilters[col] = val;
            return builder;
          },
          order: () => builder,
          limit: () => builder,
          maybeSingle: async () => {
            const hit = invites.find(
              (i) =>
                i.email === filters.email &&
                (!acceptedNull || i.accepted_at === null) &&
                (!gtFilters.expires_at || i.expires_at > gtFilters.expires_at)
            );
            return { data: hit ? { id: hit.id, company_id: hit.company_id, role: hit.role } : null, error: null };
          },
          update: (payload: any) => {
            const updateFilters: Record<string, unknown> = {};
            const updateBuilder: any = {
              eq: (col: string, val: unknown) => {
                updateFilters[col] = val;
                return updateBuilder;
              },
              is: async () => {
                state.inviteUpdates.push({ filters: { ...updateFilters }, payload });
                for (const target of invites) {
                  if (
                    target.company_id === updateFilters.company_id &&
                    target.email === updateFilters.email &&
                    target.accepted_at === null
                  ) {
                    target.accepted_at = payload.accepted_at;
                  }
                }
                return { error: null };
              },
            };
            return updateBuilder;
          },
        };
        return builder;
      }
      if (table === 'company_members') {
        return {
          upsert: async (row: any, options: any) => {
            state.upsertRows.push(row);
            state.upsertOptions.push(options);
            if (upsertError) return { error: upsertError };
            const exists = state.members.some(
              (m) => m.company_id === row.company_id && m.user_id === row.user_id
            );
            if (!exists || !options?.ignoreDuplicates) state.members.push(row);
            return { error: null };
          },
          select: () => {
            const filters: Record<string, unknown> = {};
            const builder: any = {
              eq: (col: string, val: unknown) => {
                filters[col] = val;
                return builder;
              },
              maybeSingle: async () => ({
                data:
                  state.members.find(
                    (m) => m.company_id === filters.company_id && m.user_id === filters.user_id
                  ) ?? null,
                error: null,
              }),
            };
            return builder;
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  (getSupabaseAdmin as jest.Mock).mockReturnValue(admin);
  return { state };
}

function req(body?: unknown) {
  return new Request('http://localhost/api/auth/link-invited-user', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as any;
}

describe('POST /api/auth/link-invited-user', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
  });

  describe('本人確認', () => {
    it('認証なしは 401 で、招待も所属も扱わない', async () => {
      (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(null);
      const { state } = setupAdmin({ authEmail: INVITEE, invites: [invite()] });

      const res = await POST(req({ email: INVITEE }));

      expect(res.status).toBe(401);
      expect(state.upsertRows).toHaveLength(0);
      expect(state.inviteUpdates).toHaveLength(0);
    });

    it('ボディに招待先のメールを指定しても、本人メールに招待が無ければ所属は作られない', async () => {
      const { state } = setupAdmin({ authEmail: OTHER, invites: [invite()] });

      const res = await POST(req({ email: INVITEE }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.companyId).toBeUndefined();
      expect(state.upsertRows).toHaveLength(0);
    });

    it('本人メールを取得できない場合は 403 で所属を作らない', async () => {
      const { state } = setupAdmin({
        authEmail: null,
        authError: { message: 'not found' },
        invites: [invite()],
      });

      const res = await POST(req());

      expect(res.status).toBe(403);
      expect(state.upsertRows).toHaveLength(0);
    });

    it('メールアドレスが未確認のユーザーは 403 で所属を作らない', async () => {
      const { state } = setupAdmin({ authEmail: INVITEE, emailConfirmedAt: null, invites: [invite()] });

      const res = await POST(req());

      expect(res.status).toBe(403);
      expect(state.upsertRows).toHaveLength(0);
    });
  });

  describe('招待状態', () => {
    it('期限切れの招待では所属を作らない', async () => {
      const { state } = setupAdmin({ authEmail: INVITEE, invites: [invite({ expires_at: PAST })] });

      const res = await POST(req());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.companyId).toBeUndefined();
      expect(state.upsertRows).toHaveLength(0);
    });

    it('使用済みの招待では所属を作らない', async () => {
      const { state } = setupAdmin({
        authEmail: INVITEE,
        invites: [invite({ accepted_at: '2026-02-01T00:00:00.000Z' })],
      });

      const res = await POST(req());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.companyId).toBeUndefined();
      expect(state.upsertRows).toHaveLength(0);
    });
  });

  describe('書き込み内容', () => {
    it('新規所属は company_id / user_id / role のみを、重複を無視する指定で書き込み、招待を使用済みにする', async () => {
      const { state } = setupAdmin({ authEmail: INVITEE, invites: [invite()] });

      const res = await POST(req());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toMatchObject({ ok: true, companyId: COMPANY, role: 'manager' });
      expect(state.upsertRows).toEqual([{ company_id: COMPANY, user_id: USER, role: 'manager' }]);
      expect(state.upsertOptions[0]).toEqual({ onConflict: 'company_id,user_id', ignoreDuplicates: true });
      expect(state.inviteUpdates).toHaveLength(1);
      expect(state.inviteUpdates[0].filters).toEqual({ company_id: COMPANY, email: INVITEE });
      expect(state.inviteUpdates[0].payload).toHaveProperty('accepted_at');
    });

    it('同じ企業・同じメールの未使用招待はまとめて使用済みにする', async () => {
      const invites = [invite({ id: INVITE_ID }), invite({ id: INVITE_ID_2, role: 'member' })];
      const { state } = setupAdmin({ authEmail: INVITEE, invites });

      await POST(req());

      expect(state.inviteUpdates).toHaveLength(1);
      expect(state.inviteUpdates[0].filters).toEqual({ company_id: COMPANY, email: INVITEE });
      expect(invites.every((i) => i.accepted_at !== null)).toBe(true);
    });

    it('既存の admin が招待 member で再実行されても role を下げない', async () => {
      const { state } = setupAdmin({
        authEmail: INVITEE,
        invites: [invite({ role: 'member' })],
        members: [{ company_id: COMPANY, user_id: USER, role: 'admin' }],
      });

      const res = await POST(req());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.role).toBe('admin');
      expect(state.members).toEqual([{ company_id: COMPANY, user_id: USER, role: 'admin' }]);
    });

    it('既存の member が招待 admin で再実行されても role を上げない（昇格は別経路）', async () => {
      const { state } = setupAdmin({
        authEmail: INVITEE,
        invites: [invite({ role: 'admin' })],
        members: [{ company_id: COMPANY, user_id: USER, role: 'member' }],
      });

      const res = await POST(req());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.role).toBe('member');
      expect(state.members).toEqual([{ company_id: COMPANY, user_id: USER, role: 'member' }]);
    });

    it('二重実行しても所属は1件のまま、2回目は招待が無いため何もしない', async () => {
      const { state } = setupAdmin({ authEmail: INVITEE, invites: [invite()] });

      const first = await POST(req());
      const second = await POST(req());
      const secondJson = await second.json();

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(secondJson.companyId).toBeUndefined();
      expect(state.members).toHaveLength(1);
      expect(state.upsertRows).toHaveLength(1);
    });

    it('所属の書き込みに失敗した場合は 500 で、招待を使用済みにしない', async () => {
      const { state } = setupAdmin({
        authEmail: INVITEE,
        invites: [invite()],
        upsertError: { message: 'boom', code: 'XX000' },
      });

      const res = await POST(req());

      expect(res.status).toBe(500);
      expect(state.inviteUpdates).toHaveLength(0);
    });
  });
});
