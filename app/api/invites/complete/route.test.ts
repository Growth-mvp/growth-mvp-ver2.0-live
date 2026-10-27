/* eslint-disable @typescript-eslint/no-explicit-any -- DB・認証モックの型は意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/authUtils', () => ({ getAuthenticatedUserIdWithVerification: jest.fn() }));

import { POST } from './route';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthenticatedUserIdWithVerification } from '@/lib/authUtils';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const INVITE_ID = '44444444-4444-4444-8444-444444444444';
const EXISTING_USER = '99999999-9999-4999-8999-999999999999';
const OTHER_USER = '88888888-8888-4888-8888-888888888888';
const NEW_USER = '77777777-7777-4777-8777-777777777777';
const INVITEE = 'invitee@example.com';
const OTHER_EMAIL = 'someone-else@example.com';
const TOKEN = 'a'.repeat(64);
const PASSWORD = 'correct-horse-battery';
const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';

type Invite = {
  id: string;
  email: string;
  company_id: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
};
type User = { id: string; email: string; email_confirmed_at: string | null };

function defaultInvite(overrides: Partial<Invite> = {}): Invite {
  return {
    id: INVITE_ID,
    email: INVITEE,
    company_id: COMPANY,
    role: 'manager',
    expires_at: FUTURE,
    accepted_at: null,
    accepted_by: null,
    ...overrides,
  };
}

type Opts = {
  invite?: Invite | null;
  users?: User[];
  insertError?: unknown;
  createError?: unknown;
  listError?: unknown;
};

function setupAdmin(opts: Opts) {
  const invite = opts.invite === undefined ? defaultInvite() : opts.invite;
  const users = opts.users ?? [];
  const state = {
    invitePatches: [] as any[],
    members: [] as any[],
    created: [] as any[],
    deleted: [] as string[],
  };

  const admin: any = {
    from: (table: string) => {
      if (table === 'company_invites') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: invite, error: null }) }),
          }),
          update: (payload: any) => ({
            eq: () => ({
              is: async () => {
                state.invitePatches.push(payload);
                if (invite && invite.accepted_at === null) {
                  invite.accepted_at = payload.accepted_at;
                  invite.accepted_by = payload.accepted_by ?? null;
                }
                return { error: null };
              },
            }),
          }),
        };
      }
      if (table === 'company_members') {
        const findRow = (companyId: unknown, userId: unknown) =>
          state.members.find((m) => m.company_id === companyId && m.user_id === userId);
        return {
          insert: async (row: any) => {
            state.members.push(row);
            return { error: opts.insertError ?? null };
          },
          upsert: async (row: any, options: any) => {
            if (opts.insertError) return { error: opts.insertError };
            if (!(options?.ignoreDuplicates && findRow(row.company_id, row.user_id))) {
              state.members.push(row);
            }
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
                data: findRow(filters.company_id, filters.user_id) ?? null,
                error: null,
              }),
            };
            return builder;
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    auth: {
      admin: {
        getUserById: jest.fn(async (id: string) => {
          const u = users.find((x) => x.id === id);
          return { data: { user: u ?? null }, error: u ? null : { message: 'not found' } };
        }),
        listUsers: jest.fn(async ({ page }: { page: number }) =>
          opts.listError
            ? { data: null, error: opts.listError }
            : { data: { users: page === 1 ? users : [] }, error: null }
        ),
        createUser: jest.fn(async ({ email }: { email: string }) => {
          state.created.push(email);
          return opts.createError
            ? { data: { user: null }, error: opts.createError }
            : { data: { user: { id: NEW_USER, email } }, error: null };
        }),
        deleteUser: jest.fn(async (id: string) => {
          state.deleted.push(id);
          return { error: null };
        }),
      },
    },
  };

  (getSupabaseAdmin as jest.Mock).mockReturnValue(admin);
  return { state, admin, invite };
}

function req(body: unknown, bearer?: string) {
  return new Request('http://localhost/api/invites/complete', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const signedInAs = (userId: string) => {
  (getAuthenticatedUserIdWithVerification as jest.Mock).mockResolvedValue(userId);
};

const inviteeUser = (overrides: Partial<User> = {}): User => ({
  id: EXISTING_USER,
  email: INVITEE,
  email_confirmed_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('POST /api/invites/complete（Bearer あり：ログイン済み）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAuthenticatedUserIdWithVerification as jest.Mock).mockResolvedValue(null);
  });

  it('招待メールと一致する確認済みユーザーは所属を作り、招待を本人に紐付けて消化する', async () => {
    const { state } = setupAdmin({ users: [inviteeUser()] });
    signedInAs(EXISTING_USER);

    const res = await POST(req({ token: TOKEN }, 'session-token') as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, companyId: COMPANY, role: 'manager' });
    expect(state.members).toEqual([{ company_id: COMPANY, user_id: EXISTING_USER, role: 'manager' }]);
    expect(state.invitePatches[0]).toMatchObject({ accepted_by: EXISTING_USER });
  });

  it('招待と別のメールでログインしている場合は 403 で、招待先のメールを返さない', async () => {
    const { state } = setupAdmin({ users: [inviteeUser({ email: OTHER_EMAIL })] });
    signedInAs(EXISTING_USER);

    const res = await POST(req({ token: TOKEN }, 'session-token') as any);
    const text = await res.text();

    expect(res.status).toBe(403);
    expect(text).toContain('email_mismatch');
    expect(text).not.toContain(INVITEE);
    expect(state.members).toHaveLength(0);
    expect(state.invitePatches).toHaveLength(0);
  });

  it('メールが未確認のユーザーは 403 で所属を作らない', async () => {
    const { state } = setupAdmin({ users: [inviteeUser({ email_confirmed_at: null })] });
    signedInAs(EXISTING_USER);

    const res = await POST(req({ token: TOKEN }, 'session-token') as any);

    expect(res.status).toBe(403);
    expect(state.members).toHaveLength(0);
  });

  it('Bearer が無効なら 401 で、招待も所属も扱わない', async () => {
    const { state } = setupAdmin({ users: [inviteeUser()] });
    (getAuthenticatedUserIdWithVerification as jest.Mock).mockResolvedValue(null);

    const res = await POST(req({ token: TOKEN }, 'bad-token') as any);

    expect(res.status).toBe(401);
    expect(state.members).toHaveLength(0);
    expect(state.invitePatches).toHaveLength(0);
  });

  it('既に所属しているユーザーが招待を再実行しても 500 にならず、既存の role を変えない', async () => {
    const { state } = setupAdmin({ users: [inviteeUser()] });
    state.members.push({ company_id: COMPANY, user_id: EXISTING_USER, role: 'member' });
    signedInAs(EXISTING_USER);

    const res = await POST(req({ token: TOKEN }, 'session-token') as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, companyId: COMPANY, role: 'member' });
    expect(state.members).toEqual([{ company_id: COMPANY, user_id: EXISTING_USER, role: 'member' }]);
    expect(state.invitePatches[0]).toMatchObject({ accepted_by: EXISTING_USER });
  });

  it('同じユーザーが既に消化済みの招待を再実行しても、所属は増やさず 200 を返す', async () => {
    const { state } = setupAdmin({
      users: [inviteeUser()],
      invite: defaultInvite({ accepted_at: '2026-02-01T00:00:00.000Z', accepted_by: EXISTING_USER }),
    });
    signedInAs(EXISTING_USER);

    const res = await POST(req({ token: TOKEN }, 'session-token') as any);

    expect(res.status).toBe(200);
    expect(state.members).toHaveLength(0);
  });

  it('別のユーザーが消化済みの招待は 400 で、所属を作らない', async () => {
    const { state } = setupAdmin({
      users: [inviteeUser()],
      invite: defaultInvite({ accepted_at: '2026-02-01T00:00:00.000Z', accepted_by: OTHER_USER }),
    });
    signedInAs(EXISTING_USER);

    const res = await POST(req({ token: TOKEN }, 'session-token') as any);

    expect(res.status).toBe(400);
    expect(state.members).toHaveLength(0);
  });

  it('期限切れの招待は 400 で、所属を作らない', async () => {
    const { state } = setupAdmin({ users: [inviteeUser()], invite: defaultInvite({ expires_at: PAST }) });
    signedInAs(EXISTING_USER);

    const res = await POST(req({ token: TOKEN }, 'session-token') as any);

    expect(res.status).toBe(400);
    expect(state.members).toHaveLength(0);
  });
});

describe('POST /api/invites/complete（Bearer なし：未ログイン）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAuthenticatedUserIdWithVerification as jest.Mock).mockResolvedValue(null);
  });

  it('既存アカウントがあっても、トークンだけでは所属を作らず、アカウントも変更しない', async () => {
    const { state, admin } = setupAdmin({ users: [inviteeUser()] });

    const res = await POST(req({ token: TOKEN, password: PASSWORD }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, next: 'login' });
    expect(state.members).toHaveLength(0);
    expect(state.invitePatches).toHaveLength(0);
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('アカウントが無ければ作成して所属を作り、招待を消化する', async () => {
    const { state, admin } = setupAdmin({ users: [] });

    const res = await POST(req({ token: TOKEN, password: PASSWORD }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, next: 'login' });
    expect(admin.auth.admin.createUser).toHaveBeenCalledWith({
      email: INVITEE,
      password: PASSWORD,
      email_confirm: true,
    });
    expect(state.members).toEqual([{ company_id: COMPANY, user_id: NEW_USER, role: 'manager' }]);
    expect(state.invitePatches[0]).toMatchObject({ accepted_by: NEW_USER });
  });

  it('既存・新規のどちらでも応答は同一になる（アカウントの有無を漏らさない）', async () => {
    const existing = setupAdmin({ users: [inviteeUser()] });
    const resExisting = await POST(req({ token: TOKEN, password: PASSWORD }) as any);
    const textExisting = await resExisting.text();

    setupAdmin({ users: [] });
    const resNew = await POST(req({ token: TOKEN, password: PASSWORD }) as any);
    const textNew = await resNew.text();

    expect(existing.state.members).toHaveLength(0);
    expect(resExisting.status).toBe(resNew.status);
    expect(textExisting).toBe(textNew);
  });

  it('新規作成後の所属作成に失敗したら、作成したアカウントを削除して 500 を返す', async () => {
    const { state } = setupAdmin({ users: [], insertError: { code: 'XX000', message: 'boom' } });

    const res = await POST(req({ token: TOKEN, password: PASSWORD }) as any);

    expect(res.status).toBe(500);
    expect(state.deleted).toEqual([NEW_USER]);
    expect(state.invitePatches).toHaveLength(0);
  });

  it('アカウントの確認に失敗したら 500 で、アカウントを作成しない', async () => {
    const { admin } = setupAdmin({ users: [], listError: { message: 'upstream down' } });

    const res = await POST(req({ token: TOKEN, password: PASSWORD }) as any);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('account_setup_failed');
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('パスワードが無ければ 400 で、アカウントに触れない', async () => {
    const { admin } = setupAdmin({ users: [] });

    const res = await POST(req({ token: TOKEN }) as any);

    expect(res.status).toBe(400);
    expect(admin.auth.admin.listUsers).not.toHaveBeenCalled();
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('存在しないトークンは 404', async () => {
    setupAdmin({ invite: null });

    const res = await POST(req({ token: TOKEN, password: PASSWORD }) as any);

    expect(res.status).toBe(404);
  });

  it('消化済みの招待は 400 で、アカウントに触れない', async () => {
    const { admin } = setupAdmin({
      users: [],
      invite: defaultInvite({ accepted_at: '2026-02-01T00:00:00.000Z', accepted_by: OTHER_USER }),
    });

    const res = await POST(req({ token: TOKEN, password: PASSWORD }) as any);

    expect(res.status).toBe(400);
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('期限切れの招待は 400 で、アカウントに触れない', async () => {
    const { admin } = setupAdmin({ users: [], invite: defaultInvite({ expires_at: PAST }) });

    const res = await POST(req({ token: TOKEN, password: PASSWORD }) as any);

    expect(res.status).toBe(400);
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('ボディの email が招待と一致しなければ 400 で、アカウントに触れない', async () => {
    const { admin } = setupAdmin({ users: [] });

    const res = await POST(req({ token: TOKEN, password: PASSWORD, email: OTHER_EMAIL }) as any);

    expect(res.status).toBe(400);
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });
});
