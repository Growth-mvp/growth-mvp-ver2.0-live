export {};
/* 未採用候補の追加API（モック）。認証・MFA・会社と戦略の照合・revision確認は本物の処理を通し、DB だけをメモリ上のモックにする。 */
jest.mock('server-only', () => ({}));

const mockAudit = jest.fn(async (..._args: unknown[]) => true);
jest.mock('@/lib/server/auditLog', () => ({
  logAuditEvent: (...args: unknown[]) => mockAudit(...args),
}));

type Row = Record<string, any>;
const mockState: {
  tables: Record<string, Row[]>;
  errors: Record<string, string>;
  updateErrors: Record<string, string>;
  beforeUpdate: null | (() => void);
  updateCalls: Array<{ table: string; patch: Row }>;
} = { tables: {}, errors: {}, updateErrors: {}, beforeUpdate: null, updateCalls: [] };

jest.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => makeFakeAdmin(),
}));

function makeFakeAdmin() {
  const exec = (st: any) => {
    if (st.op === 'update') {
      mockState.updateCalls.push({ table: st.table, patch: st.patch });
      if (mockState.beforeUpdate) {
        const hook = mockState.beforeUpdate;
        mockState.beforeUpdate = null;
        hook();
      }
      if (mockState.updateErrors[st.table]) return { data: null, error: { message: mockState.updateErrors[st.table] } };
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
      getClaims: async (token: string) => ({ data: { claims: { sub: token, aal: 'aal2' } }, error: null }),
      admin: {
        mfa: {
          listFactors: async () => ({ data: { factors: [{ status: 'verified' }] }, error: null }),
        },
      },
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/cascade/adopt-candidate/route');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const S = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const S_OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const existingSales = {
  id: 'proj-sales-1',
  title: '既存の新規顧客開拓',
  planStatus: 'approved',
  approvedAt: '2026-10-01',
  approvedBy: 'u-admin',
  executionHumanInvestments: [{ id: 'h1', person: '山田', months: 2 }],
  skillPlans: [{ id: 's1', skill: 'ヒアリング' }],
  okrs: [{ id: 'okr-db-1', dbOkrId: 'db-1', objective: '既存の目標' }],
};
const existingDev = { id: 'proj-dev-1', title: '開発の既存案', planStatus: 'draft' };

function baseState() {
  mockState.errors = {};
  mockState.updateErrors = {};
  mockState.beforeUpdate = null;
  mockState.updateCalls = [];
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
        answers12: [{ id: 'ch0-q1', answer: '確定した回答' }],
        finance_pl: [{ year: 2025, revenue: 100 }],
        departments: [
          { name: '営業部', mission: '顧客を広げる', projects: [existingSales] },
          { name: '開発部', mission: '価値を作る', projects: [existingDev] },
        ],
      },
    ],
  };
}

const newProject = (overrides: Record<string, unknown> = {}) => ({
  id: 'proj-new-100',
  title: '新しい販路開拓',
  hypothesis: '代理店を通じて広げる',
  okrs: [{ id: 'old-okr', dbOkrId: 'old-db', objective: '販路を3社増やす', keyResults: [{ title: '3社' }] }],
  ...overrides,
});

const body = (overrides: Record<string, unknown> = {}) => ({
  companyId: A,
  strategyId: S,
  expectedRevision: 5,
  departmentName: '営業部',
  project: newProject(),
  ...overrides,
});

const call = (user: string, b: unknown = body()) =>
  POST(
    new Request('http://x/api/cascade/adopt-candidate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${user}` },
      body: JSON.stringify(b),
    }),
  );

const row = () => mockState.tables.strategy_data[0];

beforeEach(baseState);

describe('権限と所属', () => {
  it('manager は追加できる', async () => {
    const res = await call('u-manager');
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('admin は追加できる', async () => {
    expect((await call('u-admin')).status).toBe(200);
  });

  it('member は STAGE3 を追加できない（403・書き込みなし）', async () => {
    const res = await call('u-member');
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('insufficient_role');
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('会社に所属しない利用者は 403（書き込みなし）', async () => {
    const res = await call('u-outsider');
    expect(res.status).toBe(403);
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('戦略が別の会社のものなら、存在を明かさず 403', async () => {
    mockState.tables.strategy_data[0].company_id = B;
    const res = await call('u-admin');
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('strategy_mismatch');
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('認証がなければ 401', async () => {
    const res = await POST(
      new Request('http://x/api/cascade/adopt-candidate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body()),
      }),
    );
    expect(res.status).toBe(401);
    expect(mockState.updateCalls).toHaveLength(0);
  });
});

describe('入力の検証', () => {
  it.each([
    [{ companyId: 'not-uuid' }, 'invalid_company_id'],
    [{ strategyId: 'x' }, 'invalid_strategy_id'],
    [{ expectedRevision: -1 }, 'invalid_expected_revision'],
    [{ expectedRevision: 1.5 }, 'invalid_expected_revision'],
    [{ departmentName: '' }, 'invalid_department_name'],
    [{ project: null }, 'invalid_project'],
    [{ project: newProject({ id: 'bad id!' }) }, 'invalid_project_id'],
    [{ project: newProject({ title: '   ' }) }, 'invalid_project_title'],
    [{ project: newProject({ hypothesis: 'x'.repeat(5001) }) }, 'invalid_project_field'],
    [{ project: newProject({ okrs: Array.from({ length: 31 }, () => ({ objective: 'o' })) }) }, 'invalid_project_okrs'],
    [{ project: newProject({ hypothesis: 'x'.repeat(4000), reason: 'y'.repeat(4000), description: 'z'.repeat(4000), okrs: Array.from({ length: 30 }, () => ({ objective: 'o'.repeat(4000) })) }) }, 'project_too_large'],
  ])('不正な入力 %j は 400 で拒否し、書き込まない', async (overrides, error) => {
    const res = await call('u-admin', body(overrides));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
    expect(mockState.updateCalls).toHaveLength(0);
  });
});

describe('保存世代（revision）と競合', () => {
  it('候補を表示したときの revision と違えば 409（書き込みなし）', async () => {
    const res = await call('u-admin', body({ expectedRevision: 4 }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('revision_changed');
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('確認の後・書き込みの前に別の変更が入ったら、上書きせず 409', async () => {
    mockState.beforeUpdate = () => {
      row().revision = 6;
      row().departments[0].projects.push({ id: 'proj-other-user', title: '他の人が追加した案' });
    };
    const res = await call('u-admin');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('revision_changed');
    const titles = row().departments[0].projects.map((p: Row) => p.title);
    expect(titles).toContain('他の人が追加した案');
    expect(titles).not.toContain('新しい販路開拓');
  });

  it('書き込みに失敗したら 500。既存のデータは変わらない', async () => {
    mockState.updateErrors.strategy_data = 'write failed';
    const before = JSON.stringify(row().departments);
    const res = await call('u-admin');
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('save_failed');
    expect(JSON.stringify(row().departments)).toBe(before);
  });

  it('戦略の読み取りに失敗したら 503 で、書き込まない', async () => {
    mockState.errors.strategy_data = 'read failed';
    const res = await call('u-admin');
    expect(res.status).toBe(503);
    expect(mockState.updateCalls).toHaveLength(0);
  });
});

describe('既存データの保護', () => {
  it('追加は対象の部門の projects 末尾に1件だけ足す（他の部門・既存のプロジェクトは変わらない）', async () => {
    const beforeSales = JSON.parse(JSON.stringify(existingSales));
    const beforeDev = JSON.parse(JSON.stringify(existingDev));
    const res = await call('u-admin');
    expect(res.status).toBe(200);

    const depts = row().departments;
    expect(depts[0].projects).toHaveLength(2);
    expect(depts[0].projects[0]).toEqual(beforeSales);
    expect(depts[1]).toEqual({ name: '開発部', mission: '価値を作る', projects: [beforeDev] });
  });

  it('既存の承認状態・人的投資・スキル計画・OKR・進捗の紐づけは変わらない', async () => {
    await call('u-admin');
    const kept = row().departments[0].projects[0];
    expect(kept.planStatus).toBe('approved');
    expect(kept.approvedAt).toBe('2026-10-01');
    expect(kept.executionHumanInvestments).toEqual([{ id: 'h1', person: '山田', months: 2 }]);
    expect(kept.skillPlans).toEqual([{ id: 's1', skill: 'ヒアリング' }]);
    expect(kept.okrs).toEqual([{ id: 'okr-db-1', dbOkrId: 'db-1', objective: '既存の目標' }]);
  });

  it('書き込みは departments 列だけ（STAGE1〜2・STAGE6 の列は触らない）', async () => {
    await call('u-admin');
    expect(mockState.updateCalls).toHaveLength(1);
    expect(Object.keys(mockState.updateCalls[0].patch)).toEqual(['departments']);
    expect(row().answers12).toEqual([{ id: 'ch0-q1', answer: '確定した回答' }]);
    expect(row().finance_pl).toEqual([{ year: 2025, revenue: 100 }]);
  });

  it('追加する案の OKR は旧ID（id・dbOkrId）を持ち込まない', async () => {
    await call('u-admin');
    const added = row().departments[0].projects[1];
    expect(added.id).toBe('proj-new-100');
    expect(added.okrs).toEqual([{ objective: '販路を3社増やす', keyResults: [{ title: '3社' }] }]);
  });
});

describe('二重追加と重複', () => {
  it('同じ候補を2回送っても、2回目は追加しない（409 duplicate_project_id）', async () => {
    expect((await call('u-admin')).status).toBe(200);
    const again = await call('u-admin');
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe('duplicate_project_id');
    expect(row().departments[0].projects.filter((p: Row) => p.id === 'proj-new-100')).toHaveLength(1);
  });

  it('別の部門にある既存のIDと同じなら追加しない', async () => {
    const res = await call('u-admin', body({ project: newProject({ id: 'proj-dev-1' }) }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('duplicate_project_id');
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('同じ名称の既存プロジェクトがあっても、自動では統合せず別のIDとして追加する', async () => {
    const res = await call('u-admin', body({ project: newProject({ title: '既存の新規顧客開拓' }) }));
    expect(res.status).toBe(200);
    expect(row().departments[0].projects.map((p: Row) => p.id)).toEqual(['proj-sales-1', 'proj-new-100']);
  });
});

describe('部門の照合', () => {
  it('部門名が一致しなければ 409（別の部門へ入れない）', async () => {
    const res = await call('u-admin', body({ departmentName: '存在しない部' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('department_changed');
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('保存済みの部門の projects が配列でなければ、判定できないため 409', async () => {
    row().departments[0].projects = 'broken';
    const res = await call('u-admin');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('unverifiable_departments');
    expect(mockState.updateCalls).toHaveLength(0);
  });
});

describe('許可リストと監査', () => {
  beforeEach(() => mockAudit.mockClear());

  it.each(['planStatus', 'approvedAt', 'approvedBy', 'executionHumanInvestments', 'skillPlans', 'humanInvestments', 'skillRequirements', 'okrsV2'])(
    '本文の %s（承認・実績・STAGE4 の情報）は 400 で拒否し、書き込まない',
    async (key) => {
      const res = await call('u-admin', body({ project: newProject({ [key]: 'x' }) }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('forbidden_project_field');
      expect(mockState.updateCalls).toHaveLength(0);
      expect(mockAudit).not.toHaveBeenCalled();
    },
  );

  it('許可されていない項目は 400 で拒否する', async () => {
    const res = await call('u-admin', body({ project: newProject({ anything: 1 }) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unknown_project_field');
  });

  it('許可された項目（説明・仮説など）は通り、OKR の旧 ID は入らない', async () => {
    const res = await call('u-admin', body({ project: newProject({ hypothesis: '仮説', kpis: ['売上'] }) }));
    expect(res.status).toBe(200);
    const saved = row().departments[0].projects[1];
    expect(saved.hypothesis).toBe('仮説');
    expect(saved.kpis).toEqual(['売上']);
    expect(saved.okrs[0]).not.toHaveProperty('id');
    expect(saved.okrs[0]).not.toHaveProperty('dbOkrId');
  });

  it('成功した採用は、会社・戦略・更新者・部門・プロジェクト・操作を監査に記録する', async () => {
    expect((await call('u-manager')).status).toBe(200);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        companyId: A,
        actorUserId: 'u-manager',
        action: 'stage3_project_adopted',
        targetType: 'strategy',
        targetId: S,
        after: { departmentName: '営業部', projectId: 'proj-new-100', title: '新しい販路開拓' },
      }),
    );
  });

  it('失敗した採用（競合）は監査に記録しない', async () => {
    expect((await call('u-admin', body({ expectedRevision: 4 }))).status).toBe(409);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
