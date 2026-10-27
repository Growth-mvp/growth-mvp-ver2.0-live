/* eslint-disable @typescript-eslint/no-explicit-any -- DB・認証・メールのモックは意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/authUtils', () => ({ getAuthenticatedUserIdWithVerification: jest.fn() }));
jest.mock('@/lib/server/inviteMail', () => ({ sendInviteMail: jest.fn() }));
jest.mock('@/lib/server/signupConfirmation', () => ({ resendSignupConfirmation: jest.fn() }));
jest.mock('@/lib/server/inviteMailLimit', () => ({
  isInviteMailAllowed: jest.fn(),
  recordInviteMail: jest.fn(),
}));

import { POST } from './route';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthenticatedUserIdWithVerification } from '@/lib/authUtils';
import { sendInviteMail } from '@/lib/server/inviteMail';
import { resendSignupConfirmation } from '@/lib/server/signupConfirmation';
import { isInviteMailAllowed, recordInviteMail } from '@/lib/server/inviteMailLimit';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const INVITE_ID = '44444444-4444-4444-8444-444444444444';
const EXISTING_USER = '99999999-9999-4999-8999-999999999999';
const OTHER_USER = '88888888-8888-4888-8888-888888888888';
const NEW_USER = '77777777-7777-4777-8777-777777777777';
const INVITEE = 'invitee@example.com';
const TOKEN = 'a1'.repeat(32);
const PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'another-horse-battery';
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
type User = { id: string; email: string; email_confirmed_at: string | null; created_at?: string };

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

const unconfirmedUser = (overrides: Partial<User> = {}): User =>
  inviteeUser({ id: NEW_USER, email_confirmed_at: null, ...overrides });

type Opts = {
  invite?: Invite | null;
  users?: User[];
  members?: Array<{ company_id: string; user_id: string; role: string }>;
  generateError?: { code?: string; status?: number; message?: string } | null;
  raceUser?: User;
  mailOk?: boolean;
};

function setupAdmin(opts: Opts) {
  const invite = opts.invite === undefined ? defaultInvite() : opts.invite;
  const state = {
    invitePatches: [] as any[],
    members: [...(opts.members ?? [])] as any[],
    users: [...(opts.users ?? [])] as User[],
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
          const u = state.users.find((x) => x.id === id);
          return { data: { user: u ?? null }, error: u ? null : { message: 'not found' } };
        }),
        listUsers: jest.fn(async ({ page }: { page: number }) => ({
          data: { users: page === 1 ? state.users : [] },
          error: null,
        })),
        generateLink: jest.fn(async (params: any) => {
          state.generated.push(params);
          if (opts.raceUser) {
            // 同時に別の要求が作ったケース：この要求の作成は「登録済み」で失敗する
            state.users.push(opts.raceUser);
            return { data: null, error: { code: 'user_already_exists', status: 422 } };
          }
          if (opts.generateError) return { data: null, error: opts.generateError };
          const created: User = {
            id: NEW_USER,
            email: params.email,
            email_confirmed_at: null,
            created_at: new Date().toISOString(),
          };
          state.users.push(created);
          return {
            data: { user: created, properties: { action_link: ACTION_LINK } },
            error: null,
          };
        }),
        updateUserById: jest.fn(async () => ({ data: { user: null }, error: null })),
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

beforeEach(() => {
  jest.clearAllMocks();
  (getAuthenticatedUserIdWithVerification as jest.Mock).mockResolvedValue(null);
  (isInviteMailAllowed as jest.Mock).mockResolvedValue(true);
  (recordInviteMail as jest.Mock).mockResolvedValue(undefined);
  (resendSignupConfirmation as jest.Mock).mockResolvedValue('sent');
});

describe('POST /api/invites/complete：CSRF とCookie', () => {
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
  it('新規ユーザーは未確認のアカウントを作り、確認リンクをメールで送る。所属はまだ作らない', async () => {
    const { state, admin } = setupAdmin({ users: [] });

    const res = await POST(req({ password: PASSWORD }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, next: 'check_email' });
    expect(admin.auth.admin.createUser).toBeUndefined();
    expect(state.generated).toHaveLength(1);
    expect(state.generated[0]).toMatchObject({ type: 'signup', email: INVITEE, password: PASSWORD });
    expect(state.generated[0].options.redirectTo).toContain('/auth/callback?next=');
    expect((sendInviteMail as jest.Mock).mock.calls[0][0].text).toContain(ACTION_LINK);
    expect(state.members).toHaveLength(0);
    expect(state.invitePatches).toHaveLength(0);
    expect(recordInviteMail).toHaveBeenCalledWith(INVITE_ID, 'signup');
  });

  it('既存の確認済みユーザーはアカウントも所属も変えず、ログインを促すメールだけ送る（確認リンクは含めない）', async () => {
    const { state, admin } = setupAdmin({ users: [inviteeUser()] });

    const res = await POST(req({ password: PASSWORD }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, next: 'check_email' });
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(resendSignupConfirmation).not.toHaveBeenCalled();
    expect(state.members).toHaveLength(0);
    expect((sendInviteMail as jest.Mock).mock.calls[0][0].text).not.toContain('verify?token=');
    expect((sendInviteMail as jest.Mock).mock.calls[0][0].text).toContain('/login?redirect_to=');
    expect(recordInviteMail).toHaveBeenCalledWith(INVITE_ID, 'notice');
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

  it('送信に失敗した新規ユーザーは、アカウントを削除せず残す（削除・再作成はしない）', async () => {
    const { state } = setupAdmin({ users: [], mailOk: false });

    const res = await POST(req({ password: PASSWORD }) as any);

    expect(res.status).toBe(500);
    expect(state.deleted).toHaveLength(0);
    expect(state.users.map((u) => u.id)).toEqual([NEW_USER]);
    expect(recordInviteMail).not.toHaveBeenCalled();
  });

  it('送信に失敗して残った未確認アカウントは、再試行で確認メールを再送する（作り直さない・パスワードは変えない）', async () => {
    const { state, admin } = setupAdmin({ users: [], mailOk: false });
    await POST(req({ password: PASSWORD }) as any);

    (sendInviteMail as jest.Mock).mockResolvedValue(true);
    (sendInviteMail as jest.Mock).mockClear();
    const retry = await POST(req({ password: NEW_PASSWORD }) as any);

    expect(retry.status).toBe(200);
    expect(admin.auth.admin.generateLink).toHaveBeenCalledTimes(1);
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(resendSignupConfirmation).toHaveBeenCalledWith(INVITEE, expect.stringContaining('/auth/callback?next='));
    expect(sendInviteMail).not.toHaveBeenCalled();
    expect(recordInviteMail).toHaveBeenCalledWith(INVITE_ID, 'resend');
    expect(state.deleted).toHaveLength(0);
  });

  it('未確認の既存アカウントは、削除せず確認メールを再送する（generateLink は呼ばない）', async () => {
    const { state, admin } = setupAdmin({ users: [unconfirmedUser()] });

    const res = await POST(req({ password: PASSWORD }) as any);

    expect(res.status).toBe(200);
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(resendSignupConfirmation).toHaveBeenCalledTimes(1);
    expect(state.deleted).toHaveLength(0);
  });

  it('再送しても既存パスワードは変わらない（入力された再送用パスワードは使わず、管理者APIで更新しない）', async () => {
    const { admin } = setupAdmin({ users: [unconfirmedUser()] });

    await POST(req({ password: NEW_PASSWORD }) as any);

    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(JSON.stringify((resendSignupConfirmation as jest.Mock).mock.calls)).not.toContain(NEW_PASSWORD);
  });

  it('確認済みの既存ユーザーのパスワードは、招待トークンだけでは変わらない', async () => {
    const { admin } = setupAdmin({ users: [inviteeUser()] });

    const res = await POST(req({ password: NEW_PASSWORD }) as any);

    expect(res.status).toBe(200);
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
  });

  it('同時に再送要求が来ても、どちらも削除・パスワード変更をせず、確認メールの再送に進む', async () => {
    const { state, admin } = setupAdmin({ users: [unconfirmedUser()] });

    const [a, b] = await Promise.all([
      POST(req({ password: PASSWORD }) as any),
      POST(req({ password: NEW_PASSWORD }) as any),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(resendSignupConfirmation).toHaveBeenCalledTimes(2);
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(state.deleted).toHaveLength(0);
  });

  it('確認リンクで本人確認が完了した後に、Bearer 付きで受諾すると所属が付与される（未確認の間は付与されない）', async () => {
    const { state } = setupAdmin({ users: [] });

    // 1) 初回：パスワードを入力して確認メールを送る。所属はまだ作らない
    const first = await POST(req({ password: PASSWORD }) as any);
    expect(first.status).toBe(200);
    expect(state.members).toHaveLength(0);

    // 2) 確認前の Bearer 受諾は拒否し、所属は作らない
    signedInAs(NEW_USER);
    const beforeConfirm = await POST(req({}, { bearer: 'session-token' }) as any);
    expect(beforeConfirm.status).toBe(403);
    expect(state.members).toHaveLength(0);

    // 3) 確認リンクを開き、メールが確認された状態になる
    state.users[0].email_confirmed_at = '2026-03-01T00:00:00.000Z';

    // 4) 確認後に Bearer 付きで受諾すると所属が付く
    const afterConfirm = await POST(req({}, { bearer: 'session-token' }) as any);
    expect(afterConfirm.status).toBe(200);
    expect(state.members).toEqual([{ company_id: COMPANY, user_id: NEW_USER, role: 'manager' }]);
    expect(afterConfirm.headers.get('set-cookie') ?? '').toContain('gs_invite=;');
  });

  it('他人の招待トークン（別の人の Cookie）では、既存ユーザーの所属もパスワードも変わらない', async () => {
    const { state, admin } = setupAdmin({ users: [inviteeUser()] });

    const res = await POST(req({ password: NEW_PASSWORD }, { cookie: `gs_invite=${TOKEN}` }) as any);

    expect(res.status).toBe(200);
    expect(state.members).toHaveLength(0);
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('他人のログイン（別メール）で招待を受諾しようとすると 403 で、所属は作らない', async () => {
    const { state } = setupAdmin({ users: [inviteeUser({ id: OTHER_USER, email: 'attacker@example.com' })] });
    signedInAs(OTHER_USER);

    const res = await POST(req({}, { bearer: 'attacker-session' }) as any);

    expect(res.status).toBe(403);
    expect(state.members).toHaveLength(0);
  });

  it('再送が Supabase の上限に達していても、応答は同一（200）で、記録もしない', async () => {
    setupAdmin({ users: [unconfirmedUser()] });
    (resendSignupConfirmation as jest.Mock).mockResolvedValue('rate_limited');

    const res = await POST(req({ password: PASSWORD }) as any);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: 'check_email' });
    expect(recordInviteMail).not.toHaveBeenCalled();
  });

  it('再送に失敗したら 500 を返す', async () => {
    setupAdmin({ users: [unconfirmedUser()] });
    (resendSignupConfirmation as jest.Mock).mockResolvedValue('failed');

    const res = await POST(req({ password: PASSWORD }) as any);

    expect(res.status).toBe(500);
    expect(recordInviteMail).not.toHaveBeenCalled();
  });

  it('同時に別の要求が作成していた場合は、作成済みのアカウントとして再送に進む', async () => {
    const { admin } = setupAdmin({ users: [], raceUser: unconfirmedUser() });

    const res = await POST(req({ password: PASSWORD }) as any);

    expect(res.status).toBe(200);
    expect(admin.auth.admin.generateLink).toHaveBeenCalledTimes(1);
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(resendSignupConfirmation).toHaveBeenCalledTimes(1);
    expect(sendInviteMail).not.toHaveBeenCalled();
  });

  it('送信回数の上限に達している招待は、送信せず同一の応答を返す', async () => {
    const { admin } = setupAdmin({ users: [] });
    (isInviteMailAllowed as jest.Mock).mockResolvedValue(false);

    const res = await POST(req({ password: PASSWORD }) as any);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: 'check_email' });
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(sendInviteMail).not.toHaveBeenCalled();
    expect(resendSignupConfirmation).not.toHaveBeenCalled();
  });

  it('確認リンクの作成に失敗したら 500 で、所属は作らず、メールも送らない', async () => {
    const { state } = setupAdmin({ users: [], generateError: { code: 'x', status: 500 } });

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

  it('トークンもリンクもパスワードもログに出さない', async () => {
    const logs: string[] = [];
    const spies = ['log', 'warn', 'error'].map((level) =>
      jest.spyOn(console, level as 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      })
    );
    try {
      setupAdmin({ users: [], mailOk: false });
      await POST(req({ password: PASSWORD }) as any);
      (resendSignupConfirmation as jest.Mock).mockResolvedValue('failed');
      await POST(req({ password: NEW_PASSWORD }) as any);
      const joined = logs.join('\n');
      expect(joined).not.toContain(TOKEN);
      expect(joined).not.toContain('SECRET-ACTION-TOKEN');
      expect(joined).not.toContain(PASSWORD);
      expect(joined).not.toContain(NEW_PASSWORD);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});
