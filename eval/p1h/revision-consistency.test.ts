export {};
/* revision の更新方式と保存の競合（モック・読み取り専用）。実DB・実APIには接続しない。
 * DB は Postgres の規則をモックで再現する:
 *   - bump_strategy_data_revision が BEFORE UPDATE トリガーとして付いている場合、更新のたびに revision = 旧値 + 1（呼び出し側の値は無視）
 *   - trg_strategy_data_updated_at により、更新のたびに updated_at が進む
 * 採用APIは本物の route を通す。STAGE4 の保存は、store/strategyStore.ts の保存・競合・再取得の規則
 * （3689〜3692, 3833〜3884, 4240〜4345 行付近）を写した模型で、実ストアは使わない。 */
jest.mock('server-only', () => ({}));

type Row = Record<string, any>;

const db: { row: Row; triggerOn: boolean; touched: string[]; beforeUpdate: null | (() => void) } = {
  row: {},
  triggerOn: true,
  touched: [],
  beforeUpdate: null,
};

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const S = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const S_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const clock = { n: 0 };
const stamp = () => `2026-11-02T00:00:${String(++clock.n).padStart(2, '0')}Z`;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** UPDATE の模型。フィルタに一致した行だけを更新し、トリガーの有無で revision を決める。 */
function applyUpdate(patch: Row, filters: Array<[string, any]>): Row[] {
  const r = db.row;
  const matches = filters.every(([k, v]) => r[k] === v);
  if (!matches) return [];
  const before = r.revision ?? 0;
  Object.assign(r, patch);
  r.updated_at = stamp();
  if (db.triggerOn) r.revision = before + 1;
  else r.revision = before;
  return [clone(r)];
}

/** 採用APIの読み取りと書き込みの間に、別の利用者の保存が入る状況を再現する。 */
function externalWrite(mutate: (departments: Row[]) => Row[]) {
  const before = db.row.revision ?? 0;
  db.row.departments = mutate(clone(db.row.departments));
  db.row.updated_at = stamp();
  db.row.revision = db.triggerOn ? before + 1 : before;
}

function makeFakeAdmin() {
  const from = (table: string) => {
    db.touched.push(table);
    const st: any = { table, op: 'select', filters: [], patch: null, limit: undefined };
    const exec = () => {
      if (table === 'company_members') {
        const rows = (db as any).members.filter((m: Row) =>
          st.filters.every(([k, v]: [string, any]) => m[k] === v),
        );
        return { data: rows.map((r: Row) => ({ ...r })), error: null };
      }
      if (table !== 'strategy_data') return { data: [], error: null };
      if (st.op === 'update') {
        if (db.beforeUpdate) {
          const hook = db.beforeUpdate;
          db.beforeUpdate = null;
          hook();
        }
        const rows = applyUpdate(st.patch, st.filters);
        return { data: rows.map((r) => ({ id: r.id })), error: null };
      }
      const rows = [db.row].filter((r) => st.filters.every(([k, v]: [string, any]) => r[k] === v));
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
const { POST } = require('@/app/api/cascade/adopt-candidate/route');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { mergeDepartmentsForConflict } = require('@/lib/strategy/departmentsMerge');

const existingSales = {
  id: 'proj-sales-1',
  title: '既存の新規顧客開拓',
  planStatus: 'approved',
  executionHumanInvestments: [{ id: 'h1', person: '山田', months: 2 }],
};
const ADDED = { id: 'proj-added-1', title: '新しい販路開拓', okrs: [] };

function setup(triggerOn: boolean) {
  db.triggerOn = triggerOn;
  db.touched = [];
  db.beforeUpdate = null;
  (db as any).members = [
    { user_id: 'u-manager', company_id: A, role: 'manager' },
    { user_id: 'u-admin-b', company_id: B, role: 'admin' },
  ];
  db.row = {
    id: S,
    company_id: A,
    revision: 5,
    updated_by: 'u-stage4',
    updated_at: 'initial',
    departments: [{ name: '営業部', mission: '顧客を広げる', projects: [clone(existingSales)] }],
  };
}

const adopt = (user: string, body: Row) =>
  POST(
    new Request('http://x/api/cascade/adopt-candidate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${user}` },
      body: JSON.stringify(body),
    }),
  );

const adoptBody = (overrides: Row = {}): Row => ({
  companyId: A,
  strategyId: S,
  expectedRevision: 5,
  departmentName: '営業部',
  project: clone(ADDED),
  ...overrides,
});

const hasAdded = () => (db.row.departments[0].projects as Row[]).some((p) => p.id === ADDED.id);

/**
 * ストアの保存（3 回まで）。競合時は、基準（読み込み時の版）・ローカル・サーバーを3方向で合わせ、
 * 古い departments は再送しない（lib/strategy/departmentsMerge.ts。store/strategyStore.ts の reconcileDepartmentsAfterConflict と同じ）。
 * 合わせられない（同じ項目を両方が変えた）場合は保存しない。
 */
function storeSave(
  local: { revision: number; departments: Row[]; dirty: boolean; base: Row[] },
  withExpectedRevision: boolean,
): { ok: boolean; attempts: number } {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const state = { revision: local.revision, departments: clone(local.departments) };
    const filters: Array<[string, any]> = [
      ['id', S],
      ['company_id', A],
    ];
    if (withExpectedRevision) filters.push(['revision', state.revision]);
    const rows = applyUpdate({ departments: state.departments }, filters);
    if (rows.length > 0) {
      local.revision = rows[0].revision;
      local.dirty = false;
      local.base = clone(db.row.departments);
      return { ok: true, attempts: attempt };
    }
    const server = clone(db.row);
    const merged = mergeDepartmentsForConflict({ base: local.base, local: local.departments, server: server.departments });
    if (!merged.ok) return { ok: false, attempts: attempt };
    local.departments = merged.departments;
    local.revision = server.revision;
  }
  return { ok: false, attempts: 3 };
}

/** STAGE4 の利用者が古い画面で編集している状態（revision 5 を読み込んだまま）。 */
function staleStage4User(dirty: boolean) {
  const departments = clone(db.row.departments);
  departments[0].projects[0].executionHumanInvestments.push({ id: 'h2', person: '佐藤', months: 1 });
  return { revision: 5, departments, dirty, base: clone(db.row.departments) };
}

describe('A. revision の更新の仕組み', () => {
  it('トリガー有り: 成功した更新で revision が必ず +1 になり、呼び出し側の値は無視される', () => {
    setup(true);
    const rows = applyUpdate({ departments: [], revision: 99 }, [['id', S]]);
    expect(rows[0].revision).toBe(6);
  });

  it('トリガー無し: 成功した更新でも revision は変わらない（同じ revision で何度でも通る）', () => {
    setup(false);
    expect(applyUpdate({ departments: [] }, [['id', S]])[0].revision).toBe(5);
    expect(applyUpdate({ departments: [] }, [['id', S]])[0].revision).toBe(5);
  });

  it('どちらでも、条件に一致しない更新は 0 行で、revision も内容も変わらない', () => {
    for (const on of [true, false]) {
      setup(on);
      expect(applyUpdate({ departments: [] }, [['id', S], ['revision', 4]])).toEqual([]);
      expect(db.row.revision).toBe(5);
    }
  });

  it('updated_at は、トリガーの有無にかかわらず採用の成功で更新される（trg_strategy_data_updated_at）', async () => {
    setup(false);
    expect((await adopt('u-manager', adoptBody())).status).toBe(200);
    expect(db.row.updated_at).not.toBe('initial');
  });
});

describe('B. 採用APIの比較と、読み取り後の別の保存', () => {
  it('expectedRevision が違えば 409 で書き込まない（トリガーの有無によらない）', async () => {
    for (const on of [true, false]) {
      setup(on);
      expect((await adopt('u-manager', adoptBody({ expectedRevision: 4 }))).status).toBe(409);
      expect(hasAdded()).toBe(false);
    }
  });

  it('読み取りと書き込みの間に別の保存が入った場合: トリガー有りは 409 で守られる', async () => {
    setup(true);
    db.beforeUpdate = () =>
      externalWrite((d) => {
        d[0].projects.push({ id: 'proj-other-1', title: '別の利用者の案' });
        return d;
      });
    const res = await adopt('u-manager', adoptBody());
    expect(res.status).toBe(409);
    const titles = db.row.departments[0].projects.map((p: Row) => p.title);
    expect(titles).toContain('別の利用者の案');
    expect(hasAdded()).toBe(false);
  });

  it('同じ状況でトリガー無しの場合: 採用APIは検知できず、別の利用者の案を上書きする（問題）', async () => {
    setup(false);
    db.beforeUpdate = () =>
      externalWrite((d) => {
        d[0].projects.push({ id: 'proj-other-1', title: '別の利用者の案' });
        return d;
      });
    const res = await adopt('u-manager', adoptBody());
    expect(res.status).toBe(200);
    const titles = db.row.departments[0].projects.map((p: Row) => p.title);
    expect(titles).not.toContain('別の利用者の案');
    expect(hasAdded()).toBe(true);
  });
});

describe('C. 採用の後に、古い画面の STAGE4 が保存した場合（ストアの規則の模型）', () => {
  // [トリガー有り, expectedRevision あり, 未保存の変更あり] → 採用した案が残るか（修正後のストアの規則）
  it.each([
    [true, true, true, true],
    [true, true, false, true],
    [true, false, true, false],
    [true, false, false, false],
    [false, true, true, false],
    [false, true, false, false],
    [false, false, true, false],
    [false, false, false, false],
  ])(
    'トリガー=%s / expectedRevision=%s / ローカルに未保存の変更=%s → 採用した案が残る: %s',
    async (trigger, withRev, dirty, kept) => {
      setup(trigger);
      const local = staleStage4User(dirty);
      expect((await adopt('u-manager', adoptBody())).status).toBe(200);
      expect(hasAdded()).toBe(true);
      storeSave(local, withRev);
      expect(hasAdded()).toBe(kept);
    },
  );

  it('最も一般的な組み合わせ（トリガー有り・通常の保存・未保存の変更あり）では、採用した案は残り、STAGE4 の編集も保存される', async () => {
    setup(true);
    const local = staleStage4User(true);
    await adopt('u-manager', adoptBody());
    const result = storeSave(local, true);
    expect(result).toEqual({ ok: true, attempts: 2 });
    expect(hasAdded()).toBe(true);
    expect(db.row.revision).toBe(7);
  });

  it('同じ組み合わせで、古い画面の STAGE4 の編集は保存される（別の利用者の変更は保存されない）', async () => {
    setup(true);
    const local = staleStage4User(true);
    await adopt('u-manager', adoptBody());
    storeSave(local, true);
    expect(db.row.departments[0].projects[0].executionHumanInvestments.map((h: Row) => h.id)).toEqual(['h1', 'h2']);
  });
});

describe('D. 認可と監査情報', () => {
  it('別会社の戦略は、本文の companyId を変えても更新できない', async () => {
    setup(true);
    db.row.company_id = B;
    expect((await adopt('u-manager', adoptBody())).status).toBe(403);
    setup(true);
    expect((await adopt('u-admin-b', adoptBody({ companyId: B }))).status).toBe(403);
    expect(db.row.departments[0].projects).toHaveLength(1);
  });

  it('本文の departments は使われない（DB の値を読み直して書く）', async () => {
    setup(true);
    const res = await adopt('u-manager', { ...adoptBody(), departments: [{ name: '営業部', projects: [] }] });
    expect(res.status).toBe(200);
    expect(db.row.departments[0].projects.map((p: Row) => p.id)).toEqual(['proj-sales-1', ADDED.id]);
  });

  it('採用の成功は監査テーブル（audit_logs）に記録を試みる（既存の logAuditEvent を使う）', async () => {
    setup(true);
    await adopt('u-manager', adoptBody());
    expect(db.touched).toContain('audit_logs');
  });

  it('updated_by は採用では更新されない（直前に保存した人のまま）', async () => {
    setup(true);
    await adopt('u-manager', adoptBody());
    expect(db.row.updated_by).toBe('u-stage4');
  });

  it('本文の承認状態・人的投資は拒否され、保存されない（許可リストで止める）', async () => {
    setup(true);
    const project = { ...clone(ADDED), planStatus: 'approved', approvedBy: 'u-manager', executionHumanInvestments: [{ id: 'x', months: 9 }] };
    const res = await adopt('u-manager', adoptBody({ project }));
    expect(res.status).toBe(400);
    expect(hasAdded()).toBe(false);
  });
});
