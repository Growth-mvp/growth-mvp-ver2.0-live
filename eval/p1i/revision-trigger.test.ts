export {};
/* 本番 revision トリガーの導入を想定したモック検証（本番DBには接続しない）。
 * DB の UPDATE は Postgres の規則で模型化する:
 *   - WHERE（revision の条件を含む）は更新前の行で評価する
 *   - BEFORE UPDATE トリガー bump_strategy_data_revision があれば、NEW.revision = OLD.revision + 1（送られた値は無視）
 *   - trg_strategy_data_updated_at により updated_at は更新される
 * 採用APIは本物の route を通し、ストアの保存は本物のストアを通す。DB 境界（保存・読み取り・管理クライアント）だけをモックにする。
 * 並行する2つのトランザクションの同時実行は、このモックでは証明できない（直列化した順序で確かめる）。 */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/auditLog', () => ({ logAuditEvent: async () => true }));

type Row = Record<string, any>;
const A = '11111111-1111-4111-8111-111111111111';
const S = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const db: {
  row: Row;
  triggerOn: boolean;
  clock: number;
  writes: Array<{ table: string; patch: Row; ok: boolean }>;
  beforeUpdate: null | (() => void);
  reads: number;
} = { row: {}, triggerOn: true, clock: 0, writes: [], beforeUpdate: null, reads: 0 };

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const tick = () => `2026-11-02T00:00:${String(++db.clock).padStart(2, '0')}Z`;

/** UPDATE の模型。WHERE は更新前の行で評価し、一致した行だけを更新する。 */
function dbUpdate(patch: Row, filters: Array<[string, any]>): Row[] {
  if (db.beforeUpdate) {
    const hook = db.beforeUpdate;
    db.beforeUpdate = null;
    hook();
  }
  const old = db.row;
  const matched = filters.every(([k, v]) => old[k] === v);
  db.writes.push({ table: 'strategy_data', patch: clone(patch), ok: matched });
  if (!matched) return [];
  const oldRev = typeof old.revision === 'number' ? old.revision : 0;
  const next: Row = { ...old, ...clone(patch), updated_at: tick() };
  next.revision = db.triggerOn ? oldRev + 1 : typeof patch.revision === 'number' ? patch.revision : oldRev;
  db.row = next;
  return [clone(next)];
}

/* ----- 採用API（本物の route）の管理クライアント（DB 境界） ----- */
function makeFakeAdmin() {
  const from = (table: string) => {
    const st: any = { table, op: 'select', filters: [] as Array<[string, any]>, patch: null, limit: undefined };
    const exec = () => {
      if (table === 'company_members') {
        const rows = [
          { user_id: 'u-manager', company_id: A, role: 'manager' },
          { user_id: 'u-member', company_id: A, role: 'member' },
        ].filter((m) => st.filters.every(([k, v]: [string, any]) => (m as Row)[k] === v));
        return { data: rows, error: null };
      }
      if (table !== 'strategy_data') return { data: [], error: null };
      if (st.op === 'update') {
        const rows = dbUpdate(st.patch, st.filters);
        return { data: rows.map((r) => ({ id: r.id })), error: null };
      }
      const rows = [db.row].filter((r) => st.filters.every(([k, v]: [string, any]) => r[k] === v));
      db.reads += 1;
      return { data: rows.map((r) => clone(r)), error: null };
    };
    const api: any = {
      select: () => api,
      update: (patch: Row) => {
        st.op = 'update';
        st.patch = patch;
        return api;
      },
      eq: (k: string, v: any) => {
        st.filters.push([k, v]);
        return api;
      },
      limit: (n: number) => {
        st.limit = n;
        return api;
      },
      maybeSingle: async () => {
        const r = exec();
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      then: (resolve: any, reject: any) => Promise.resolve(exec()).then(resolve, reject),
    };
    return api;
  };
  return {
    from,
    auth: {
      getUser: async (token: string) => ({ data: { user: { id: token } }, error: null }),
      getClaims: async (token: string) => ({ data: { claims: { sub: token, aal: 'aal2' } }, error: null }),
      admin: { mfa: { listFactors: async () => ({ data: { factors: [{ status: 'verified' }] }, error: null }) } },
    },
  };
}

jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => makeFakeAdmin() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST: adopt } = require('@/app/api/cascade/adopt-candidate/route');

const adoptRequest = (user: string, expectedRevision: number, projectId: string) =>
  adopt(
    new Request('http://x/api/cascade/adopt-candidate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${user}` },
      body: JSON.stringify({
        companyId: A,
        strategyId: S,
        expectedRevision,
        departmentName: '営業部',
        project: { id: projectId, title: `案${projectId}`, okrs: [] },
      }),
    }),
  );

/* ----- ストア（本物）の保存の DB 境界 ----- */
const actual = jest.requireActual('@/utils/supabase/strategy') as typeof import('@/utils/supabase/strategy');

jest.mock('@/utils/persist/saveWithAudit', () => ({
  saveWithAudit: (payload: any, _u: unknown, companyId: string, revision: number | undefined) => {
    if (companyId !== A) return Promise.resolve({ data: null, error: { message: 'forbidden' } });
    const mapped = actual.buildDbRowFromState(JSON.parse(JSON.stringify(payload)) as any);
    const filters: Array<[string, any]> = [
      ['id', S],
      ['company_id', A],
    ];
    if (typeof revision === 'number') filters.push(['revision', revision]);
    const rows = dbUpdate(mapped as Row, filters);
    if (rows.length === 0) {
      return Promise.resolve({
        data: null,
        error: { message: 'revision conflict', code: 'REVISION_CONFLICT', currentRevision: db.row.revision },
      });
    }
    return Promise.resolve({ data: actual.buildStateFromDbRow(clone(rows[0])) as any, error: null });
  },
}));

jest.mock('@/utils/supabase/strategy', () => {
  const real = jest.requireActual('@/utils/supabase/strategy');
  return {
    ...real,
    getFullStrategyDataByCompany: jest.fn(async () => {
      throw new Error('unexpected call');
    }),
    getFullStrategyDataByStrategyId: async (strategyId: string, companyId: string) => {
      db.reads += 1;
      if (strategyId !== S || companyId !== A) return { data: null, error: new Error('not found') };
      return { data: real.buildStateFromDbRow(clone(db.row)), error: null };
    },
  };
});

jest.mock('@/store/userStore', () => ({
  useUserStore: { getState: () => mockUser, subscribe: () => () => {} },
}));
const mockUser = { user: { id: 'u-stage4' }, companyId: A, membershipVerified: true };

jest.mock('@/utils/supabase/client', () => ({
  ...jest.requireActual('@/utils/supabase/client'),
  safeGetSession: async () => ({ error: null, data: { session: { user: { id: 'u-stage4' } } } }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useStrategyStore } = require('@/store/strategyStore');
const get = () => useStrategyStore.getState() as any;

const INITIAL = {
  financeSummary: [{ year: 2025, revenue: 1000 }],
  answers12: [{ id: 'ch0-q1', question: 'Q1', answer: '元の回答' }],
  departments: [
    {
      name: '営業部',
      mission: '顧客を広げる',
      projects: [{ id: 'proj-1', title: '既存', planStatus: 'approved', executionHumanInvestments: [{ id: 'h1', months: 2 }], okrs: [] }],
    },
  ],
};

async function loadedStore(triggerOn: boolean) {
  db.triggerOn = triggerOn;
  db.writes = [];
  db.reads = 0;
  db.beforeUpdate = null;
  db.row = { ...actual.buildDbRowFromState(clone(INITIAL) as any), id: S, company_id: A, revision: 5, updated_at: tick() };
  useStrategyStore.setState({
    companyId: A,
    pendingCompanyId: undefined,
    strategyId: S,
    hydrated: true,
    restoreReady: true,
    loaded: true,
    isRestoring: false,
    boot: { isHydrating: false, isHydrated: true, isSaving: false, isRestoring: false },
    ...clone(INITIAL),
    revision: 5,
    dirty: false,
  } as any);
  const init = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
  expect(init.ok).toBe(true);
  db.writes = [];
  db.reads = 0;
}

const hasProject = (id: string) => (db.row.departments[0].projects as Row[]).some((p) => p.id === id);
const humanIds = () => ((db.row.departments[0].projects[0].executionHumanInvestments ?? []) as Row[]).map((h) => h.id);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('1. DB の更新の規則（トリガーの模型）', () => {
  beforeEach(() => {
    db.row = { id: S, company_id: A, revision: 5, departments: [], updated_at: 'init' };
  });

  it('トリガー有り: 成功した UPDATE で revision は必ず 1 増える', () => {
    db.triggerOn = true;
    expect(dbUpdate({ departments: [] }, [['id', S]])[0].revision).toBe(6);
  });

  it('トリガー有り: 送られた revision の値は無視され、二重に加算されない（+1 のみ）', () => {
    db.triggerOn = true;
    expect(dbUpdate({ departments: [], revision: 99 }, [['id', S]])[0].revision).toBe(6);
  });

  it('トリガー有り: updated_at も更新される', () => {
    db.triggerOn = true;
    const before = db.row.updated_at;
    dbUpdate({ departments: [] }, [['id', S]]);
    expect(db.row.updated_at).not.toBe(before);
  });

  it('トリガー無し: revision は変わらない（従来の本番の状態）', () => {
    db.triggerOn = false;
    expect(dbUpdate({ departments: [] }, [['id', S]])[0].revision).toBe(5);
  });

  it('revision を条件にした UPDATE は、一致すれば成功し、一致しなければ 0 行で行を変えない', () => {
    db.triggerOn = true;
    expect(dbUpdate({ departments: [{ name: 'x' }] }, [['id', S], ['revision', 4]])).toEqual([]);
    expect(db.row.revision).toBe(5);
    expect(db.row.departments).toEqual([]);
    expect(dbUpdate({ departments: [{ name: 'x' }] }, [['id', S], ['revision', 5]])).toHaveLength(1);
    expect(db.row.revision).toBe(6);
  });

  it('同じ revision を使った2つの更新は、直列化した順序では片方だけが成功する（並行の動作は未検証）', () => {
    db.triggerOn = true;
    const first = dbUpdate({ departments: [{ name: 'A' }] }, [['id', S], ['revision', 5]]);
    const second = dbUpdate({ departments: [{ name: 'B' }] }, [['id', S], ['revision', 5]]);
    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    expect(db.row.departments[0].name).toBe('A');
  });
});

describe('2. STAGE3 採用APIの競合制御（トリガー有り）', () => {
  it('UPDATE で revision が 1 増え、採用の成功後の revision が DB に残る', async () => {
    await loadedStore(true);
    expect((await adoptRequest('u-manager', 6, 'proj-new-1')).status).toBe(200);
    expect(db.row.revision).toBe(7);
    expect(hasProject('proj-new-1')).toBe(true);
  });

  it('古い revision（6）で採用すると、DB が 7 のときは 409 で書き込まない', async () => {
    await loadedStore(true);
    await adoptRequest('u-manager', 6, 'proj-new-1');
    const stale = await adoptRequest('u-manager', 6, 'proj-new-2');
    expect(stale.status).toBe(409);
    expect(hasProject('proj-new-2')).toBe(false);
    expect(hasProject('proj-new-1')).toBe(true);
  });

  it('同じ revision で2人が採用すると、片方だけが成功し、既存の候補は失われない', async () => {
    await loadedStore(true);
    const [x, y] = await Promise.all([adoptRequest('u-manager', 6, 'proj-x'), adoptRequest('u-manager', 6, 'proj-y')]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(hasProject('proj-x') !== hasProject('proj-y')).toBe(true);
    expect(humanIds()).toEqual(['h1']);
  });
});

describe('3. STAGE3 の採用の後、古い STAGE4 の保存は競合を検知する（トリガー有り）', () => {
  it('採用（revision 6→7）の後、古い画面（revision 6）の保存は競合を検知し、採用した案と STAGE4 の編集の両方を残して保存する', async () => {
    await loadedStore(true);
    expect((await adoptRequest('u-manager', 6, 'proj-added')).status).toBe(200);

    const depts = clone(get().departments);
    depts[0].projects[0].executionHumanInvestments.push({ id: 'h2', months: 1 });
    useStrategyStore.setState({ departments: depts, dirty: true } as any);

    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect(res.ok).toBe(true);
    expect(db.writes.some((w) => !w.ok)).toBe(true);
    expect(hasProject('proj-added')).toBe(true);
    expect(humanIds()).toEqual(['h1', 'h2']);
    expect(db.row.revision).toBe(8);
    expect(get().revision).toBe(db.row.revision);
  });
});

describe('4. トリガー導入後も、通常の保存（STAGE1〜4）が正常に動く', () => {
  it('連続した3回の保存は、いずれも競合なしで成功し、revision は 1 ずつ増え、画面の revision と DB が一致する', async () => {
    await loadedStore(true);
    const cases: Array<Record<string, unknown>> = [
      { financeSummary: [{ year: 2025, revenue: 2000 }] }, // STAGE1
      { answers12: [{ id: 'ch0-q1', question: 'Q1', answer: '新しい回答' }] }, // STAGE2
      {
        departments: [
          {
            name: '営業部',
            mission: '顧客を広げる',
            projects: [{ id: 'proj-1', title: '既存', planStatus: 'approved', executionHumanInvestments: [{ id: 'h1', months: 3 }], okrs: [] }],
          },
        ],
      }, // STAGE4
    ];
    const revisions: number[] = [];
    for (const patch of cases) {
      useStrategyStore.setState({ ...patch, dirty: true } as any);
      const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
      expect(res.ok).toBe(true);
      revisions.push(db.row.revision);
      expect(get().revision).toBe(db.row.revision);
    }
    expect(revisions).toEqual([7, 8, 9]);
    expect(db.writes.every((w) => w.ok)).toBe(true);
    expect(db.reads).toBe(0);
  });

  it('保存は revision を payload に含めず、DB 側だけが加算する（アプリの二重加算なし）', async () => {
    await loadedStore(true);
    useStrategyStore.setState({ financeSummary: [{ year: 2025, revenue: 3000 }], dirty: true } as any);
    await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    const payloadWrites = db.writes.filter((w) => w.table === 'strategy_data');
    expect(payloadWrites.every((w) => !('revision' in w.patch))).toBe(true);
    expect(db.row.revision).toBe(7);
  });
});

describe('5. トリガー無しの場合（比較）', () => {
  it('トリガー無し: 読み込み後の最初の保存で異常を検出し、以後の保存を止める（採用した案は上書きされない）', async () => {
    await loadedStore(false);
    expect(db.row.revision).toBe(5);
    expect((await adoptRequest('u-manager', 5, 'proj-added')).status).toBe(200);
    expect(db.row.revision).toBe(5);

    const depts = clone(get().departments);
    depts[0].projects[0].executionHumanInvestments.push({ id: 'h2', months: 1 });
    useStrategyStore.setState({ departments: depts, dirty: true } as any);
    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect((res as any).reason).toBe('revision_anomaly');
    expect(hasProject('proj-added')).toBe(true);
  });
});
