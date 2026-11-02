export {};
/* 後始末APIの企業・戦略スコープと削除対象の安全性（モック）。認証・MFA・会社の照合・削除クエリは本物を通し、DB だけをメモリ上のモックにする。 */
jest.mock('server-only', () => ({}));

type Row = Record<string, any>;
const mockState: {
  tables: Record<string, Row[]>;
  factorsOk: Record<string, boolean>;
  aal: Record<string, string>;
  errors: Record<string, string>;
} = { tables: {}, factorsOk: {}, aal: {}, errors: {} };

jest.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => makeFakeAdmin(),
}));

function makeFakeAdmin() {
  const exec = (st: any) => {
    if (mockState.errors[st.table]) return { data: null, error: { message: mockState.errors[st.table] }, count: null };
    let rows: Row[] = (mockState.tables[st.table] ?? []).slice();
    for (const f of st.filters) {
      if (f[0] === 'eq') rows = rows.filter((r) => r[f[1]] === f[2]);
      if (f[0] === 'in') rows = rows.filter((r) => f[2].includes(r[f[1]]));
      if (f[0] === 'like') rows = rows.filter((r) => typeof r[f[1]] === 'string' && r[f[1]].startsWith(String(f[2]).replace('%', '')));
    }
    if (st.limit !== undefined) rows = rows.slice(0, st.limit);
    if (st.op === 'update') {
      for (const r of rows) Object.assign(r, st.patch);
      return { data: rows.map((r) => ({ id: r.id })), error: null, count: rows.length };
    }
    return { data: rows.map((r) => ({ ...r })), error: null, count: rows.length };
  };
  const from = (table: string) => {
    const st: any = { table, op: 'select', filters: [], patch: null };
    const api: any = {
      select: () => api,
      update: (patch: any) => {
        st.op = 'update';
        st.patch = patch;
        return api;
      },
      eq: (k: string, v: any) => {
        st.filters.push(['eq', k, v]);
        return api;
      },
      in: (k: string, v: any[]) => {
        st.filters.push(['in', k, v]);
        return api;
      },
      like: (k: string, v: string) => {
        st.filters.push(['like', k, v]);
        return api;
      },
      limit: (n: number) => {
        st.limit = n;
        return api;
      },
      maybeSingle: async () => {
        const r = exec(st);
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      then: (resolve: any, reject: any) => Promise.resolve(exec(st)).then(resolve, reject),
    };
    return api;
  };
  return {
    from,
    auth: {
      getUser: async (token: string) => ({ data: { user: { id: token } }, error: null }),
      getClaims: async (token: string) => ({ data: { claims: { sub: token, aal: mockState.aal[token] ?? 'aal2' } }, error: null }),
      admin: {
        mfa: {
          listFactors: async ({ userId }: { userId: string }) => ({
            data: { factors: mockState.factorsOk[userId] === false ? [] : [{ status: 'verified' }] },
            error: null,
          }),
        },
      },
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('./route');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function call(token: string | null, body: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return POST(new Request('http://localhost/api/cascade/cleanup-deleted-projects', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}

const okBody = (over: Record<string, unknown> = {}) => ({
  companyId: A,
  strategyId: SA,
  expectedRevision: 5,
  deletedProjectIds: ['proj-old-1'],
  ...over,
});

function freshDb() {
  mockState.tables = {
    company_members: [
      { user_id: 'u-admin-a', company_id: A, role: 'admin', created_at: '2026-01-01T00:00:00Z' },
      { user_id: 'u-manager-a', company_id: A, role: 'manager', created_at: '2026-01-01T00:00:00Z' },
      { user_id: 'u-member-a', company_id: A, role: 'member', created_at: '2026-01-01T00:00:00Z' },
      { user_id: 'u-multi', company_id: A, role: 'admin', created_at: '2026-01-01T00:00:00Z' },
      { user_id: 'u-multi', company_id: B, role: 'admin', created_at: '2026-06-01T00:00:00Z' },
      { user_id: 'u-multi2', company_id: B, role: 'admin', created_at: '2026-01-01T00:00:00Z' },
      { user_id: 'u-multi2', company_id: A, role: 'admin', created_at: '2026-06-01T00:00:00Z' },
    ],
    strategy_data: [
      {
        id: SA,
        company_id: A,
        revision: 5,
        departments: [{ name: '営業部', projects: [{ id: 'proj-live', title: '現役' }] }],
      },
      { id: SB, company_id: B, revision: 3, departments: [{ name: '営業部', projects: [{ id: 'proj-b-live', title: 'B現役' }] }] },
    ],
    okrs: [
      { id: 'o-a-old', company_id: A, strategy_id: SA, project_id: 'proj-old-1', is_deleted: false },
      { id: 'o-a-live', company_id: A, strategy_id: SA, project_id: 'proj-live', is_deleted: false },
      { id: 'o-a-other-strategy', company_id: A, strategy_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', project_id: 'proj-old-1', is_deleted: false },
      { id: 'o-b-old', company_id: B, strategy_id: SB, project_id: 'proj-old-1', is_deleted: false },
      { id: 'o-b-same-id', company_id: B, strategy_id: SB, project_id: 'proj-b-old', is_deleted: false },
    ],
    progress_logs: [
      { id: 'l-a-admin', company_id: A, is_deleted: false, user_id: 'u-admin-a', progress_text: '__META__:{"projectId":"proj-old-1"}\n本文' },
      { id: 'l-a-member', company_id: A, is_deleted: false, user_id: 'u-member-a', progress_text: '__META__:{"projectId":"proj-old-1"}\n本文' },
      { id: 'l-a-live', company_id: A, is_deleted: false, user_id: 'u-admin-a', progress_text: '__META__:{"projectId":"proj-live"}\n本文' },
      { id: 'l-a-plain', company_id: A, is_deleted: false, user_id: 'u-admin-a', progress_text: '普通の本文（メタ情報なし）' },
      { id: 'l-b-old', company_id: B, is_deleted: false, user_id: 'u-b', progress_text: '__META__:{"projectId":"proj-old-1"}\n本文' },
    ],
  };
  mockState.factorsOk = {};
  mockState.aal = {};
  mockState.errors = {};
}

const flag = (table: string, id: string) => (mockState.tables[table] ?? []).find((r) => r.id === id)?.is_deleted;

beforeEach(() => freshDb());

describe('1. 単一会社での正常な削除', () => {
  it('作業中の会社・戦略の OKR だけを論理削除する（進捗ログには触れない）', async () => {
    const res = await call('u-admin-a', okBody());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cleaned).toEqual({ okrs: 1 });
    expect(flag('okrs', 'o-a-old')).toBe(true);
    expect(flag('progress_logs', 'l-a-admin')).toBe(false);
    expect(flag('progress_logs', 'l-a-member')).toBe(false);
  });
});

describe('2. 複数会社所属時は作業対象会社だけを処理する', () => {
  it('本文の companyId/strategyId で対象を決め、所属の作成日や役割では選ばない', async () => {
    // u-multi は A（古い）と B（新しい）の管理者。作業対象は B
    const res = await call('u-multi', { companyId: B, strategyId: SB, expectedRevision: 3, deletedProjectIds: ['proj-old-1'] });
    expect(res.status).toBe(200);
    expect(flag('okrs', 'o-b-old')).toBe(true);
    expect(flag('okrs', 'o-a-old')).toBe(false);
    expect(flag('progress_logs', 'l-b-old')).toBe(false);
    expect(flag('progress_logs', 'l-a-admin')).toBe(false);
  });

  it('A の方が新しい利用者が B を指定すると、B だけが処理される', async () => {
    const res = await call('u-multi2', { companyId: B, strategyId: SB, expectedRevision: 3, deletedProjectIds: ['proj-old-1'] });
    expect(res.status).toBe(200);
    expect(flag('okrs', 'o-b-old')).toBe(true);
    expect(flag('okrs', 'o-a-old')).toBe(false);
  });
});

describe('3. 他社・他戦略・権限不足を拒否する', () => {
  it('所属しない会社の ID を指定すると 403（何も削除しない）', async () => {
    const res = await call('u-admin-a', okBody({ companyId: B, strategyId: SB, expectedRevision: 3 }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('forbidden');
    expect(flag('okrs', 'o-b-old')).toBe(false);
  });

  it('戦略が指定の会社に属さない場合は 403（strategy_mismatch）', async () => {
    const res = await call('u-admin-a', okBody({ strategyId: SB }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('strategy_mismatch');
    expect(flag('okrs', 'o-a-old')).toBe(false);
    expect(flag('okrs', 'o-b-old')).toBe(false);
  });

  it('存在しない戦略 ID は 403（存在を明かさない）', async () => {
    const res = await call('u-admin-a', okBody({ strategyId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }));
    expect(res.status).toBe(403);
  });

  it('一般社員は 403（insufficient_role）', async () => {
    const res = await call('u-member-a', okBody());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('insufficient_role');
    expect(flag('okrs', 'o-a-old')).toBe(false);
  });

  it('所属しない利用者は 403', async () => {
    expect((await call('u-stranger', okBody())).status).toBe(403);
  });

  it('認証トークンが無ければ 401', async () => {
    expect((await call(null, okBody())).status).toBe(401);
  });

  it('検証済みの要素が無い管理者は 403（MFA）', async () => {
    mockState.factorsOk['u-admin-a'] = false;
    expect((await call('u-admin-a', okBody())).status).toBe(403);
    expect(flag('okrs', 'o-a-old')).toBe(false);
  });
});

describe('3b. 権限（M2）: 対象会社の admin と manager は可、member は不可', () => {
  it('対象会社の manager は削除できる（200）', async () => {
    const res = await call('u-manager-a', okBody());
    expect(res.status).toBe(200);
    expect(flag('okrs', 'o-a-old')).toBe(true);
  });

  it('manager は、MFA の登録が無くても（新しいMFA要件なし）削除できる', async () => {
    mockState.factorsOk['u-manager-a'] = false;
    const res = await call('u-manager-a', okBody());
    expect(res.status).toBe(200);
    expect(flag('okrs', 'o-a-old')).toBe(true);
  });

  it('member は、対象会社に所属していても 403（insufficient_role）', async () => {
    const res = await call('u-member-a', okBody());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('insufficient_role');
    expect(flag('okrs', 'o-a-old')).toBe(false);
  });

  it('複数会社所属: B の manager として、B だけを処理する（A の admin 権限は使わない）', async () => {
    // u-mgr-multi は A の admin、B の manager。作業対象は B → 権限は B の manager
    mockState.tables.company_members.push({ user_id: 'u-mgr-multi', company_id: A, role: 'admin', created_at: '2026-01-01' });
    mockState.tables.company_members.push({ user_id: 'u-mgr-multi', company_id: B, role: 'manager', created_at: '2026-06-01' });
    const res = await call('u-mgr-multi', { companyId: B, strategyId: SB, expectedRevision: 3, deletedProjectIds: ['proj-old-1'] });
    expect(res.status).toBe(200);
    expect(flag('okrs', 'o-b-old')).toBe(true);
    expect(flag('okrs', 'o-a-old')).toBe(false);
  });

  it('複数会社所属: A の admin の権限で B を指定しても、B での所属が member なら 403', async () => {
    mockState.tables.company_members.push({ user_id: 'u-mixed', company_id: A, role: 'admin', created_at: '2026-01-01' });
    mockState.tables.company_members.push({ user_id: 'u-mixed', company_id: B, role: 'member', created_at: '2026-01-01' });
    const res = await call('u-mixed', { companyId: B, strategyId: SB, expectedRevision: 3, deletedProjectIds: ['proj-old-1'] });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('insufficient_role');
    expect(flag('okrs', 'o-b-old')).toBe(false);
  });

  it('既存のMFAポリシー: 別の会社で admin を持つ manager は、検証済みの要素が無ければ 403（admin と同じ判定）', async () => {
    mockState.tables.company_members.push({ user_id: 'u-mgr-adminelsewhere', company_id: B, role: 'admin', created_at: '2026-01-01' });
    mockState.tables.company_members.push({ user_id: 'u-mgr-adminelsewhere', company_id: A, role: 'manager', created_at: '2026-01-01' });
    mockState.factorsOk['u-mgr-adminelsewhere'] = false;
    const res = await call('u-mgr-adminelsewhere', okBody());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('mfa_enrollment_required');
    expect(flag('okrs', 'o-a-old')).toBe(false);
  });
});

describe('4. 現役プロジェクトを削除しない', () => {
  it('保存済みの departments に現存する ID を含むと、全体を拒否する（409）', async () => {
    const res = await call('u-admin-a', okBody({ deletedProjectIds: ['proj-old-1', 'proj-live'] }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('active_project_included');
    expect(flag('okrs', 'o-a-old')).toBe(false);
    expect(flag('okrs', 'o-a-live')).toBe(false);
  });

  it('保存済みの計画に ID が無いプロジェクトがあると、判定できないため拒否する', async () => {
    (mockState.tables.strategy_data as Row[])[0].departments = [{ name: '営業部', projects: [{ title: 'ID無し' }] }];
    const res = await call('u-admin-a', okBody());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('unverifiable_departments');
    expect(flag('okrs', 'o-a-old')).toBe(false);
  });

  it('departments が配列でなければ拒否する', async () => {
    (mockState.tables.strategy_data as Row[])[0].departments = { broken: true };
    expect((await call('u-admin-a', okBody())).status).toBe(409);
  });
});

describe('5. 入力の検証', () => {
  it.each([
    ['companyId が無い', { strategyId: SA, expectedRevision: 5, deletedProjectIds: ['proj-old-1'] }, 'invalid_company_id'],
    ['strategyId が無い', { companyId: A, expectedRevision: 5, deletedProjectIds: ['proj-old-1'] }, 'invalid_strategy_id'],
    ['expectedRevision が無い', { companyId: A, strategyId: SA, deletedProjectIds: ['proj-old-1'] }, 'invalid_expected_revision'],
    ['空の配列', okBody({ deletedProjectIds: [] }), 'invalid_project_ids'],
    ['配列でない', okBody({ deletedProjectIds: 'proj-old-1' }), 'invalid_project_ids'],
    ['不正な文字（スペースと記号）', okBody({ deletedProjectIds: ['proj old!'] }), 'invalid_project_id'],
    ['数値のID', okBody({ deletedProjectIds: [123] }), 'invalid_project_id'],
    ['重複ID', okBody({ deletedProjectIds: ['proj-old-1', 'proj-old-1'] }), 'duplicate_project_ids'],
  ])('%s は 400', async (_name, body, error) => {
    const res = await call('u-admin-a', body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
    expect(flag('okrs', 'o-a-old')).toBe(false);
  });

  it('201件以上のIDは 400', async () => {
    const many = Array.from({ length: 201 }, (_, i) => `proj-n-${i}`);
    expect((await call('u-admin-a', okBody({ deletedProjectIds: many }))).status).toBe(400);
  });

  it('JSON として読めない本文は 400', async () => {
    expect((await call('u-admin-a', '{broken')).status).toBe(400);
  });
});

describe('6. 保存世代（保存後の別ユーザーの変更）', () => {
  it('保存直後の revision と一致しなければ拒否する（別の保存が入った）', async () => {
    (mockState.tables.strategy_data as Row[])[0].revision = 6;
    const res = await call('u-admin-a', okBody({ expectedRevision: 5 }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('revision_changed');
    expect(flag('okrs', 'o-a-old')).toBe(false);
  });

  it('別ユーザーが計画に ID を戻していた場合も、現存として拒否する', async () => {
    (mockState.tables.strategy_data as Row[])[0].departments = [{ name: '営業部', projects: [{ id: 'proj-live' }, { id: 'proj-old-1' }] }];
    (mockState.tables.strategy_data as Row[])[0].revision = 6;
    expect((await call('u-admin-a', okBody({ expectedRevision: 6 }))).status).toBe(409);
    expect(flag('okrs', 'o-a-old')).toBe(false);
  });
});

describe('7. DB取得失敗時は削除しない', () => {
  it('戦略の取得に失敗したら 503 で何も削除しない', async () => {
    mockState.errors.strategy_data = 'connection refused';
    const res = await call('u-admin-a', okBody());
    expect(res.status).toBe(503);
    expect(flag('okrs', 'o-a-old')).toBe(false);
  });

  it('所属の取得に失敗したら 503 で何も削除しない', async () => {
    mockState.errors.company_members = 'timeout';
    expect((await call('u-admin-a', okBody())).status).toBe(503);
    expect(flag('okrs', 'o-a-old')).toBe(false);
  });

  it('OKR の更新に失敗したら 500（okrs_cleanup_failed）で、何も変更されない', async () => {
    mockState.errors.okrs = 'write failed';
    const res = await call('u-admin-a', okBody());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('okrs_cleanup_failed');
    expect(flag('okrs', 'o-a-old')).toBe(false);
  });
});

describe('8. 進捗ログには一切触れない（M1）', () => {
  it('対象IDのログが存在しても、どのログも論理削除されない', async () => {
    const res = await call('u-admin-a', okBody());
    expect(res.status).toBe(200);
    expect(flag('progress_logs', 'l-a-admin')).toBe(false);
    expect(flag('progress_logs', 'l-a-member')).toBe(false);
    expect(flag('progress_logs', 'l-a-plain')).toBe(false);
    expect(flag('progress_logs', 'l-a-live')).toBe(false);
    expect(flag('progress_logs', 'l-b-old')).toBe(false);
  });

  it('進捗ログの列（is_deleted）が無い環境でも、OKR の後始末は成功する', async () => {
    // 進捗ログを参照しないため、列の有無に影響されない
    (mockState.tables.progress_logs as Row[]).forEach((r) => delete r.is_deleted);
    const res = await call('u-admin-a', okBody());
    expect(res.status).toBe(200);
    expect(flag('okrs', 'o-a-old')).toBe(true);
  });

  it('削除は戦略IDで絞った OKR に限られ、同じ ID でも別の戦略の OKR は消えない', async () => {
    await call('u-admin-a', okBody());
    expect(flag('okrs', 'o-a-other-strategy')).toBe(false);
  });
});

describe('9. 保存に失敗・衝突したときの扱い（API 側の契約）', () => {
  it('保存が完了していなければ、旧 ID は現存のため何も削除されない', async () => {
    // 保存失敗時は DB の計画が旧 ID のまま。現存として拒否される
    (mockState.tables.strategy_data as Row[])[0].departments = [{ name: '営業部', projects: [{ id: 'proj-old-1' }] }];
    expect((await call('u-admin-a', okBody())).status).toBe(409);
    expect(flag('okrs', 'o-a-old')).toBe(false);
  });
});
