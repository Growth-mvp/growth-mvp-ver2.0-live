export {};
/* 部門戦略の変更案の反映API（モック）。認証・MFA・会社と戦略の照合・revision確認は本物の処理を通し、DB だけをメモリ上のモックにする。 */
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
const { POST } = require('@/app/api/cascade/apply-department-proposal/route');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const S = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const salesProject = {
  id: 'proj-sales-1',
  title: '新規顧客開拓',
  planStatus: 'approved',
  approvedAt: '2026-10-01',
  executionHumanInvestments: [{ id: 'h1', person: '山田', months: 2 }],
  skillPlans: [{ id: 's1', skill: 'ヒアリング' }],
  okrs: [{ id: 'okr-db-1', dbOkrId: 'db-1', objective: '既存の目標' }],
};

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
          {
            name: '営業部',
            mission: '顧客を広げる',
            missionDescription: '既存の概要',
            keyIssues: ['既存の課題'],
            intraDeptCollab: ['既存の連携'],
            interDeptCollab: [],
            needsCollab: ['既存の連携'],
            projects: [salesProject],
          },
          { name: '開発部', mission: '価値を作る', projects: [{ id: 'proj-dev-1', title: '開発の既存案' }] },
        ],
      },
    ],
  };
}

const row = () => mockState.tables.strategy_data[0];

const body = (overrides: Record<string, unknown> = {}) => ({
  companyId: A,
  strategyId: S,
  expectedRevision: 5,
  departmentName: '営業部',
  item: 'mission',
  value: { mission: '新しいミッション案' },
  base: { mission: '顧客を広げる' },
  ...overrides,
});

const call = (user: string, b: unknown = body()) =>
  POST(
    new Request('http://x/api/cascade/apply-department-proposal', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${user}` },
      body: JSON.stringify(b),
    }),
  );

beforeEach(baseState);

describe('権限と所属', () => {
  it('manager は反映できる', async () => {
    const res = await call('u-manager');
    expect(res.status).toBe(200);
    expect((await res.json()).item).toBe('mission');
    expect(row().departments[0].mission).toBe('新しいミッション案');
  });

  it('admin は反映できる', async () => {
    expect((await call('u-admin')).status).toBe(200);
  });

  it('member は反映できない（403・書き込みなし）', async () => {
    const res = await call('u-member');
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('insufficient_role');
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('会社に所属しない利用者は 403（書き込みなし）', async () => {
    expect((await call('u-outsider')).status).toBe(403);
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('戦略が別の会社のものなら 403（書き込みなし）', async () => {
    row().company_id = B;
    const res = await call('u-admin');
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('strategy_mismatch');
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('認証がなければ 401', async () => {
    const res = await POST(
      new Request('http://x/api/cascade/apply-department-proposal', {
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
    [{ companyId: 'x' }, 'invalid_company_id'],
    [{ strategyId: 'x' }, 'invalid_strategy_id'],
    [{ expectedRevision: -1 }, 'invalid_expected_revision'],
    [{ departmentName: '' }, 'invalid_department_name'],
    [{ item: 'stage4Plans' }, 'invalid_item'],
    [{ item: 'mission', value: { mission: 'x', extra: 'y' } }, 'invalid_value'],
    [{ item: 'mission', value: { missionDescription: 'x' } }, 'invalid_value'],
    [{ base: { missionDescription: 'x' } }, 'invalid_base'],
    [{ value: { mission: 'x'.repeat(5001) } }, 'unsafe_value'],
    [{ value: { mission: { a: { b: { c: { d: { e: 'y' } } } } } } }, 'unsafe_value'],
    [{ value: { mission: '' } }, 'empty_value'],
    [
      {
        item: 'reviewSummary',
        value: { reviewSummary: { correctedItems: Array.from({ length: 50 }, () => 'x'.repeat(4000)) } },
        base: { reviewSummary: null },
      },
      'value_too_large',
    ],
  ])('不正な入力 %j は 400 で拒否し、書き込まない', async (overrides, error) => {
    const res = await call('u-admin', body(overrides));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
    expect(mockState.updateCalls).toHaveLength(0);
  });
});

describe('既存値との比較（案を作ったあとの変更を上書きしない）', () => {
  it('案を作ったあとに既存の値が変わっていたら 409（書き込みなし）', async () => {
    row().departments[0].mission = '別の人が書き換えたミッション';
    const res = await call('u-admin');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('current_value_changed');
    expect(mockState.updateCalls).toHaveLength(0);
    expect(row().departments[0].mission).toBe('別の人が書き換えたミッション');
  });

  it('同じ案を2回送ると、2回目は既存値が変わっているため拒否される（二重反映しない）', async () => {
    expect((await call('u-admin')).status).toBe(200);
    const again = await call('u-admin');
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe('current_value_changed');
    expect(mockState.updateCalls).toHaveLength(1);
  });
});

describe('保存世代（revision）と同時保存', () => {
  it('候補を表示したときの revision と違えば 409（書き込みなし）', async () => {
    const res = await call('u-admin', body({ expectedRevision: 4 }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('revision_changed');
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('確認の後・書き込みの前に別の保存が入ったら、上書きせず 409', async () => {
    mockState.beforeUpdate = () => {
      row().revision = 6;
      row().departments[0].mission = '別の利用者が保存したミッション';
    };
    const res = await call('u-admin');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('revision_changed');
    expect(row().departments[0].mission).toBe('別の利用者が保存したミッション');
  });

  it('書き込みに失敗したら 500。既存のデータは変わらない', async () => {
    mockState.updateErrors.strategy_data = 'write failed';
    const before = JSON.stringify(row().departments);
    const res = await call('u-admin');
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('save_failed');
    expect(JSON.stringify(row().departments)).toBe(before);
  });
});

describe('反映の範囲', () => {
  it('ミッションだけを変更し、その他の部門情報・プロジェクトは変えない', async () => {
    const before = JSON.parse(JSON.stringify(row().departments));
    expect((await call('u-admin')).status).toBe(200);
    const after = row().departments;
    expect(after[0].mission).toBe('新しいミッション案');
    expect(after[0].missionDescription).toBe(before[0].missionDescription);
    expect(after[0].projects).toEqual(before[0].projects);
    expect(after[1]).toEqual(before[1]);
  });

  it('既存のプロジェクト・承認・人的投資・スキル計画・OKRは変わらない', async () => {
    const before = JSON.parse(JSON.stringify(salesProject));
    await call('u-admin');
    expect(row().departments[0].projects[0]).toEqual(before);
  });

  it('連携案は、部門内・部門横断・従来の連携候補を同時に更新する', async () => {
    const res = await call(
      'u-admin',
      body({
        item: 'collab',
        value: { intraDeptCollab: ['新しい部門内連携'], interDeptCollab: ['新しい横断連携'], needsCollab: ['新しい部門内連携', '新しい横断連携'] },
        base: { intraDeptCollab: ['既存の連携'], interDeptCollab: [], needsCollab: ['既存の連携'] },
      }),
    );
    expect(res.status).toBe(200);
    expect(row().departments[0].intraDeptCollab).toEqual(['新しい部門内連携']);
    expect(row().departments[0].interDeptCollab).toEqual(['新しい横断連携']);
    expect(row().departments[0].needsCollab).toEqual(['新しい部門内連携', '新しい横断連携']);
  });

  it('再考ポイント（入れ子のオブジェクト）も、形を保って反映できる', async () => {
    const value = { reviewSummary: { correctedItems: ['修正A'], reconsiderationPoints: ['再考B'], crossDeptInsights: [{ title: '横断C', severity: 'review' }] } };
    const res = await call('u-admin', body({ item: 'reviewSummary', value, base: { reviewSummary: null } }));
    expect(res.status).toBe(200);
    expect(row().departments[0].reviewSummary).toEqual(value.reviewSummary);
  });

  it('STAGE1〜2・STAGE6 の列は変更しない（書き込みは strategy_data の departments だけ）', async () => {
    await call('u-admin');
    expect(mockState.updateCalls).toHaveLength(1);
    expect(mockState.updateCalls[0].table).toBe('strategy_data');
    expect(Object.keys(mockState.updateCalls[0].patch)).toEqual(['departments']);
    expect(row().answers12).toEqual([{ id: 'ch0-q1', answer: '確定した回答' }]);
    expect(row().finance_pl).toEqual([{ year: 2025, revenue: 100 }]);
  });

  it('部門が見つからなければ 409（別の部門へは書かない）', async () => {
    const res = await call('u-admin', body({ departmentName: '存在しない部' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('department_changed');
    expect(mockState.updateCalls).toHaveLength(0);
  });
});

describe('監査', () => {
  beforeEach(() => mockAudit.mockClear());

  it('成功した反映は、会社・戦略・更新者・部門・項目・操作を監査に記録する', async () => {
    expect((await call('u-admin')).status).toBe(200);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        companyId: A,
        actorUserId: 'u-admin',
        action: 'stage3_department_proposal_applied',
        targetType: 'strategy',
        targetId: S,
        after: { departmentName: '営業部', item: 'mission' },
      }),
    );
  });

  it('既存値が変わっていて拒否された反映は、監査に記録しない', async () => {
    row().departments[0].mission = '別の人が書き換えた';
    expect((await call('u-admin')).status).toBe(409);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
