export {};
/* STAGE4 の除外・中止 API（モック）。認証・MFA・会社と戦略の照合・版（revision）・権限・計画の読み直しは本物の処理を通し、DB だけをメモリ上のモックにする。 */
jest.mock('server-only', () => ({}));

const mockAudit = jest.fn(async (..._args: unknown[]) => true);
jest.mock('@/lib/server/auditLog', () => ({
  logAuditEvent: (...args: unknown[]) => mockAudit(...args),
}));

type Row = Record<string, any>;
const mockState: {
  tables: Record<string, Row[]>;
  errors: Record<string, string>;
  updateCalls: Array<{ table: string; patch: Row }>;
  aal: string;
} = { tables: {}, errors: {}, updateCalls: [], aal: 'aal2' };

jest.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => makeFakeAdmin(),
}));

function makeFakeAdmin() {
  const exec = (st: any) => {
    if (st.op === 'update') {
      mockState.updateCalls.push({ table: st.table, patch: st.patch });
    }
    if (mockState.errors[st.table]) return { data: null, error: { message: mockState.errors[st.table] } };
    let rows: Row[] = (mockState.tables[st.table] ?? []).slice();
    for (const f of st.filters) {
      if (f[0] === 'eq') rows = rows.filter((r) => r[f[1]] === f[2]);
      if (f[0] === 'in') rows = rows.filter((r) => f[2].includes(r[f[1]]));
    }
    if (st.limit !== undefined) rows = rows.slice(0, st.limit);
    if (st.op === 'update') {
      for (const r of rows) Object.assign(r, st.patch);
      return { data: rows.map((r) => ({ id: r.id })), error: null };
    }
    return { data: rows.map((r) => ({ ...r })), error: null };
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
      getClaims: async (token: string) => ({ data: { claims: { sub: token, aal: mockState.aal } }, error: null }),
      admin: {
        mfa: {
          listFactors: async () => ({ data: { factors: [{ status: 'verified' }] }, error: null }),
        },
      },
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/stage4/project-lifecycle/route');

const A = '11111111-1111-4111-8111-111111111111';
const S = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const S_OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const TARGET = { id: 'proj-target', title: '既存顧客の保守契約更新', planStatus: 'draft', executionHumanInvestments: [{ id: 'h1', amount: 100 }] };
const OTHER = { id: 'proj-other', title: '別の施策', planStatus: 'draft' };

function baseState() {
  mockState.errors = {};
  mockState.updateCalls = [];
  mockState.aal = 'aal2';
  mockAudit.mockClear();
  mockState.tables = {
    company_members: [
      { user_id: 'u-admin', company_id: A, role: 'admin' },
      { user_id: 'u-manager', company_id: A, role: 'manager' },
      { user_id: 'u-member', company_id: A, role: 'member' },
    ],
    strategy_data: [
      {
        id: S,
        company_id: A,
        revision: 5,
        departments: [
          { name: '営業部', mission: '顧客を広げる', projects: [{ ...TARGET }, { ...OTHER }] },
          { name: '開発部', mission: '価値を作る', projects: [] },
        ],
      },
    ],
    stage4_plan_documents: [],
  };
}

const body = (overrides: Record<string, unknown> = {}) => ({
  companyId: A,
  strategyId: S,
  projectId: TARGET.id,
  action: 'EXCLUDE',
  expectedRevision: 5,
  ...overrides,
});

const call = (user: string, b: unknown = body()) =>
  POST(
    new Request('http://x/api/stage4/project-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${user}` },
      body: JSON.stringify(b),
    }),
  );

const strategy = () => mockState.tables.strategy_data[0];
const targetOf = () => (strategy().departments[0].projects as Row[]).find((p) => p.id === TARGET.id)!;

beforeEach(baseState);

describe('権限（管理者・管理職だけ）', () => {
  it('一般社員は、計画から外せない（書き込まない）', async () => {
    const res = await call('u-member');
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('insufficient_role');
    expect(mockState.updateCalls).toHaveLength(0);
    expect(targetOf().lifecycle).toBeUndefined();
  });

  it('管理職は、計画から外せる（その施策だけに状態が付く）', async () => {
    const res = await call('u-manager');
    expect(res.status).toBe(200);
    expect(targetOf().lifecycle).toMatchObject({ status: 'EXCLUDED', changedBy: 'u-manager' });
    expect((strategy().departments[0].projects as Row[])[1]).toEqual(OTHER);
  });

  it('管理者は、中止できる（実行開始済みの計画）', async () => {
    mockState.tables.stage4_plan_documents = [{ company_id: A, strategy_id: S, project_id: TARGET.id, adopted: true, started: true }];
    const res = await call('u-admin', body({ action: 'STOP' }));
    expect(res.status).toBe(200);
    expect(targetOf().lifecycle).toMatchObject({ status: 'STOPPED', changedBy: 'u-admin' });
  });

  it('管理者は、MFAを済ませていなければ（aal1）操作できない', async () => {
    mockState.aal = 'aal1';
    const res = await call('u-admin');
    expect(res.status).toBe(403);
    expect(mockState.updateCalls).toHaveLength(0);
  });
});

describe('書き込み時の最新の計画状態', () => {
  it('採用済み・実行中の計画は、計画から外せない（中止を使う）', async () => {
    mockState.tables.stage4_plan_documents = [{ company_id: A, strategy_id: S, project_id: TARGET.id, adopted: true, started: false }];
    const res = await call('u-manager');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('executing');
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('計画を承認済みの施策は、計画から外せない', async () => {
    strategy().departments[0].projects[0].planStatus = 'approved';
    const res = await call('u-manager');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('approved');
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('実行を開始していない計画は中止できない', async () => {
    const res = await call('u-manager', body({ action: 'STOP' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('not_started');
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('計画の状態を読めなければ、書き込まない（安全側に止める）', async () => {
    mockState.errors.stage4_plan_documents = 'connection lost';
    const res = await call('u-manager');
    expect(res.status).toBe(503);
    expect(mockState.updateCalls).toHaveLength(0);
  });
});

describe('会社・戦略・案件・版の照合', () => {
  it('版（revision）が古ければ、書き込まない（他の人の変更を上書きしない）', async () => {
    const res = await call('u-manager', body({ expectedRevision: 4 }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('revision_changed');
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('戦略が別の会社のものなら、書き込まない', async () => {
    mockState.tables.strategy_data.push({ id: S_OTHER, company_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', revision: 1, departments: [] });
    const res = await call('u-manager', body({ strategyId: S_OTHER }));
    expect(res.status).toBe(403);
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('同じ会社の別の戦略のプロジェクトIDでも、対象の戦略にない施策は書かない', async () => {
    const res = await call('u-manager', body({ projectId: 'proj-missing' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('project_missing');
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('成功時は監査記録を残し、保存後の版と部門を返す', async () => {
    const res = await call('u-manager');
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, revision: 5 });
    expect(json.departments[0].projects[0].lifecycle).toMatchObject({ status: 'EXCLUDED' });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'stage4_project_lifecycle', actorUserId: 'u-manager', companyId: A }));
  });
});
