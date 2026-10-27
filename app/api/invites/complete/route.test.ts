/* eslint-disable @typescript-eslint/no-explicit-any -- DB・認証・メールのモックは意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/authUtils', () => ({ getAuthenticatedUserIdWithVerification: jest.fn() }));
jest.mock('@/lib/server/inviteMail', () => ({ sendInviteMail: jest.fn() }));

import { POST } from './route';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthenticatedUserIdWithVerification } from '@/lib/authUtils';
import { sendInviteMail } from '@/lib/server/inviteMail';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const INVITE_ID = '44444444-4444-4444-8444-444444444444';
const EXISTING_USER = '99999999-9999-4999-8999-999999999999';
const OTHER_USER = '88888888-8888-4888-8888-888888888888';
const NEW_USER = '77777777-7777-4777-8777-777777777777';
const INVITEE = 'invitee@example.com';
const TOKEN = 'a1'.repeat(32);
const PASSWORD = 'correct-horse-battery';
const ACTION_LINK = 'https://project.supabase.co/auth/v1/verify?token=SECRET-ACTION-TOKEN&type=signup';
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

const inviteeUser = (overrides: Partial<User> = {}): User => ({
  id: EXISTING_USER,
  email: INVITEE,
  email_confirmed_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

type Opts = {
  invite?: Invite | null;
  users?: User[];
  members?: Array<{ company_id: string; user_id: string; role: string }>;
  generateError?: unknown;
  generatedUser?: Record<string, unknown>;
  mailOk?: boolean;
};

function setupAdmin(opts: Opts) {
  const invite = opts.invite === undefined ? defaultInvite() : opts.invite;
  const users = opts.users ?? [];
  const state = {
    invitePatches: [] as any[],
    members: [...(opts.members ?? [])] as any[],
    generated: [] as any[],
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
          upsert: async (row: any, options: any) => {
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
        listUsers: jest.fn(async ({ page }: { page: number }) => ({
          data: { users: page === 1 ? users : [] },
          error: null,
        })),
        generateLink: jest.fn(async (params: any) => {
          state.generated.push(params);
          if (opts.generateError) return { data: null, error: opts.generateError };
          return {
            data: {
              user: {
                id: NEW_USER,
                email: params.email,
                created_at: new Date().toISOString(),
                email_confirmed_at: null,
                ...opts.generatedUser,
              },
              properties: { action_link: ACTION_LINK },
            },
            error: null,
          };
        }),
        deleteUser: jest.fn(async (id: string) => {
          state.deleted.push(id);
          return { error: null };
        }),
      },
    },
  };

  (getSupabaseAdmin as jest.Mock).mockReturnValue(admin);
  (sendInviteMail as jest.Mock).mockResolvedValue(opts.mailOk ?? true);
  return { state, admin, invite };
}

function req(body: unknown, opts: { cookie?: string | null; bearer?: string; origin?: string | null; contentType?: string } = {}) {
  const cookie = opts.cookie === undefined ? `gs_invite=${TOKEN}` : opts.cookie;
  const origin = opts.origin === undefined ? 'http://localhost' : opts.origin;
  const headers: Record<string, string> = {
    'content-type': opts.contentType ?? 'application/json',
  };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  return new Request('http://localhost/api/invites/complete', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const signedInAs = (userId: string) => {
  (getAuthenticatedUserIdWithVerification as jest.Mock).mockResolvedValue(userId);
};

const setCookies = (res: Response): string[] => {
  const h: any = res.headers;
  return typeof h.getSetCookie === 'function' ? h.getSetCookie() : [res.headers.get('set-cookie') ?? ''].filter(Boolean);
};

describe('POST /api/invites/complete：CSRF とCookie', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAuthenticatedUserIdWithVerification as jest.Mock).mockResolvedValue(null);
  });

  it('別オリジンからの要求は 403 で、DB に触れない', async () => {
    const { admin } = setupAdmin({ users: [] });

    const res = await POST(req({ password: PASSWORD }, { origin: 'https://evil.example' }) as any);

    expect(res.status).toBe(403);
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
  });

  it('Origin が無い、または JSON 以外の要求は 403', async () => {
    setupAdmin({ users: [] });

    expect((await POST(req({ password: PASSWORD }, { origin: null }) as any)).status).toBe(403);
    expect((await POST(req({ password: PASSWORD }, { contentType: 'text/plain' }) as any)).status).toBe(403);
  });

  it('Cookie が無い、または形式が不正なら 404', async () => {
    const { admin } = setupAdmin({ users: [] });

    expect((await POST(req({ password: PASSWORD }, { cookie: null }) as any)).status).toBe(404);
    expect((await POST(req({ password: PASSWORD }, { cookie: 'gs_invite=not-a-token' }) as any)).status).toBe(404);
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
  });
});

describe('POST /api/invites/complete：ログイン済み（Bearer）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAuthenticatedUserIdWithVerification as jest.Mock).mockResolvedValue(null);
  });

  it('招待メールと一致し、メール確認済みなら所属を作り、招待を本人に紐付けて Cookie を消す', async () => {
    const { state } = setupAdmin({ users: [inviteeUser()] });
    signedInAs(EXISTING_USER);

    const res = await POST(req({}, { bearer: 'session-token' }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, companyId: COMPANY, role: 'manager' });
    expect(state.members).toEqual([{ company_id: COMPANY, user_id: EXISTING_USER, role: 'manager' }]);
    expect(state.invitePatches[0]).toMatchObject({ accepted_by: EXISTING_USER });
    expect(setCookies(res).join(' ')).toContain('gs_invite=;');
  });

  it('メールが未確認なら 403 で所属を作らず、Cookie は残す（確認後に再開するため）', async () => {
    const { state } = setupAdmin({ users: [inviteeUser({ email_confirmed_at: null })] });
    signedInAs(EXISTING_USER);

    const res = await POST(req({}, { bearer: 'session-token' }) as any);

    expect(res.status).toBe(403);
    expect(state.members).toHaveLength(0);
    expect(setCookies(res)).toHaveLength(0);
  });

  it('招待と別のメールでログインしている場合は 403 で、所属を作らず、招待先のメールを返さない', async () => {
    const { state } = setupAdmin({ users: [inviteeUser({ email: 'someone-else@example.com' })] });
    signedInAs(EXISTING_USER);

    const res = await POST(req({}, { bearer: 'session-token' }) as any);
    const text = await res.text();

    expect(res.status).toBe(403);
    expect(text).toContain('email_mismatch');
    expect(text).not.toContain(INVITEE);
    expect(state.members).toHaveLength(0);
  });

  it('Bearer が無効なら 401 で、招待も所属も扱わない', async () => {
    const { state } = setupAdmin({ users: [inviteeUser()] });

    const res = await POST(req({}, { bearer: 'bad-token' }) as any);

    expect(res.status).toBe(401);
    expect(state.members).toHaveLength(0);
    expect(state.invitePatches).toHaveLength(0);
  });

  it('既に所属しているユーザーが再実行しても 500 にならず、既存の role を変えない', async () => {
    const { state } = setupAdmin({
      users: [inviteeUser()],
      members: [{ company_id: COMPANY, user_id: EXISTING_USER, role: 'member' }],
    });
    signedInAs(EXISTING_USER);

    const res = await POST(req({}, { bearer: 'session-token' }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, companyId: COMPANY, role: 'member' });
    expect(state.members).toEqual([{ company_id: COMPANY, user_id: EXISTING_USER, role: 'member' }]);
  });

  it('同じユーザーが消化済みの招待を再実行しても、所属は増やさず 200 を返す', async () => {
    const { state } = setupAdmin({
      users: [inviteeUser()],
      invite: defaultInvite({ accepted_at: '2026-02-01T00:00:00.000Z', accepted_by: EXISTING_USER }),
    });
    signedInAs(EXISTING_USER);

    const res = await POST(req({}, { bearer: 'session-token' }) as any);

    expect(res.status).toBe(200);
    expect(state.members).toHaveLength(0);
  });

  it('別のユーザーが消化済みの招待は 400 で、所属を作らず、Cookie を消す', async () => {
    const { state } = setupAdmin({
      users: [inviteeUser()],
      invite: defaultInvite({ accepted_at: '2026-02-01T00:00:00.000Z', accepted_by: OTHER_USER }),
    });
    signedInAs(EXISTING_USER);

    const res = await POST(req({}, { bearer: 'session-token' }) as any);

    expect(res.status).toBe(400);
    expect(state.members).toHaveLength(0);
    expect(setCookies(res).join(' ')).toContain('gs_invite=;');
  });

  it('期限切れの招待は 400 で、所属を作らず、Cookie を消す', async () => {
    const { state } = setupAdmin({ users: [inviteeUser()], invite: defaultInvite({ expires_at: PAST }) });
    signedInAs(EXISTING_USER);

    const res = await POST(req({}, { bearer: 'session-token' }) as any);

    expect(res.status).toBe(400);
    expect(state.members).toHaveLength(0);
    expect(setCookies(res).join(' ')).toContain('gs_invite=;');
  });
});

describe('POST /api/invites/complete：未ログイン（パスワード設定）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAuthenticatedUserIdWithVerification as jest.Mock).mockResolvedValue(null);
  });

  it('新規ユーザーは Supabase の確認リンクを作り、メールで送る。所属はまだ作らない', async () => {
    const { state, admin } = setupAdmin({ users: [] });

    const res = await POST(req({ password: PASSWORD }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, next: 'check_email' });
    expect(admin.auth.admin.createUser).toBeUndefined();
    expect(state.generated).toHaveLength(1);
    expect(state.generated[0]).toMatchObject({ type: 'signup', email: INVITEE, password: PASSWORD });
    expect(state.generated[0].options.redirectTo).toContain('/auth/callback?next=');
    expect(sendInviteMail).toHaveBeenCalledWith(expect.objectContaining({ to: INVITEE }));
    expect((sendInviteMail as jest.Mock).mock.calls[0][0].text).toContain(ACTION_LINK);
    expect(state.members).toHaveLength(0);
    expect(state.invitePatches).toHaveLength(0);
  });

  it('既存ユーザーはアカウントも所属も変えず、ログインを促すメールだけ送る（確認リンクは含めない）', async () => {
    const { state, admin } = setupAdmin({ users: [inviteeUser()] });

    const res = await POST(req({ password: PASSWORD }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, next: 'check_email' });
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(state.members).toHaveLength(0);
    expect(state.invitePatches).toHaveLength(0);
    expect((sendInviteMail as jest.Mock).mock.calls[0][0].text).not.toContain('verify?token=');
    expect((sendInviteMail as jest.Mock).mock.calls[0][0].text).toContain('/login?redirect_to=');
  });

  it('既存・新規で応答は同一になる（アカウントの有無を漏らさない）', async () => {
    setupAdmin({ users: [inviteeUser()] });
    const existing = await POST(req({ password: PASSWORD }) as any);
    const existingBody = await existing.text();

    setupAdmin({ users: [] });
    const created = await POST(req({ password: PASSWORD }) as any);
    const createdBody = await created.text();

    expect(existing.status).toBe(created.status);
    expect(existingBody).toBe(createdBody);
  });

  it('メールを送れなかった新規ユーザーは作成したアカウントを削除し、500 を返す（再試行で作り直せる）', async () => {
    const { state } = setupAdmin({ users: [], mailOk: false });

    const res = await POST(req({ password: PASSWORD }) as any);

    expect(res.status).toBe(500);
    expect(state.deleted).toEqual([NEW_USER]);
    expect(state.members).toHaveLength(0);
  });

  it('送信失敗時に、作成時刻が古い・確認済み・別メールのユーザーは削除しない（既存ユーザーを守る）', async () => {
    const cases: Array<Record<string, unknown>> = [
      { created_at: '2000-01-01T00:00:00.000Z' },
      { email_confirmed_at: '2026-01-01T00:00:00.000Z' },
      { email: 'someone-else@example.com' },
    ];
    for (const generatedUser of cases) {
      jest.clearAllMocks();
      const { state } = setupAdmin({ users: [], mailOk: false, generatedUser });

      const res = await POST(req({ password: PASSWORD }) as any);

      expect(res.status).toBe(500);
      expect(state.deleted).toHaveLength(0);
    }
  });

  it('メールを送れなかった既存ユーザーも同じ 500 になる（存在が分からない）', async () => {
    const { state } = setupAdmin({ users: [inviteeUser()], mailOk: false });

    const res = await POST(req({ password: PASSWORD }) as any);

    expect(res.status).toBe(500);
    expect(state.deleted).toHaveLength(0);
  });

  it('確認リンクの作成に失敗したら 500 で、所属は作らない', async () => {
    const { state } = setupAdmin({ users: [], generateError: { code: 'x' } });

    const res = await POST(req({ password: PASSWORD }) as any);

    expect(res.status).toBe(500);
    expect(sendInviteMail).not.toHaveBeenCalled();
    expect(state.members).toHaveLength(0);
  });

  it('パスワードが無ければ 400 で、アカウントに触れない', async () => {
    const { admin } = setupAdmin({ users: [] });

    const res = await POST(req({}) as any);

    expect(res.status).toBe(400);
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(sendInviteMail).not.toHaveBeenCalled();
  });

  it('消化済みの招待は 400 で、アカウントに触れず、Cookie を消す', async () => {
    const { admin } = setupAdmin({
      users: [],
      invite: defaultInvite({ accepted_at: '2026-02-01T00:00:00.000Z', accepted_by: OTHER_USER }),
    });

    const res = await POST(req({ password: PASSWORD }) as any);

    expect(res.status).toBe(400);
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(setCookies(res).join(' ')).toContain('gs_invite=;');
  });

  it('期限切れの招待は 400 で、アカウントに触れず、Cookie を消す', async () => {
    const { admin } = setupAdmin({ users: [], invite: defaultInvite({ expires_at: PAST }) });

    const res = await POST(req({ password: PASSWORD }) as any);

    expect(res.status).toBe(400);
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(setCookies(res).join(' ')).toContain('gs_invite=;');
  });

  it('トークンもリンクもログに出さない', async () => {
    const logs: string[] = [];
    const spies = ['log', 'warn', 'error'].map((level) =>
      jest.spyOn(console, level as 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      })
    );
    try {
      setupAdmin({ users: [], mailOk: false });
      await POST(req({ password: PASSWORD }) as any);
      const joined = logs.join('\n');
      expect(joined).not.toContain(TOKEN);
      expect(joined).not.toContain('SECRET-ACTION-TOKEN');
      expect(joined).not.toContain(PASSWORD);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});
