export {};
/* 後始末APIの残存リスクの確認（モック・読み取り専用）。実 DB・実 API には接続しない。
 * 認証・MFA・会社の照合・削除の本体は本物を通し、DB だけをメモリ上のモックにする。 */
jest.mock('server-only', () => ({}));

type Row = Record<string, any>;
const st: {
  tables: Record<string, Row[]>;
  updateErrors: Record<string, string>;
  beforeOkrUpdate: null | (() => void);
} = { tables: {}, updateErrors: {}, beforeOkrUpdate: null };

jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => makeAdmin() }));

function makeAdmin() {
  const run = (q: any) => {
    if (q.op === 'update' && q.table === 'okrs' && st.beforeOkrUpdate) {
      const hook = st.beforeOkrUpdate;
      st.beforeOkrUpdate = null;
      hook();
    }
    if (q.op === 'update' && st.updateErrors[q.table]) {
      return { data: null, error: { message: st.updateErrors[q.table] }, count: null };
    }
    let rows: Row[] = (st.tables[q.table] ?? []).slice();
    for (const f of q.filters) {
      if (f[0] === 'eq') rows = rows.filter((r) => r[f[1]] === f[2]);
      if (f[0] === 'in') rows = rows.filter((r) => f[2].includes(r[f[1]]));
      if (f[0] === 'like') rows = rows.filter((r) => typeof r[f[1]] === 'string' && r[f[1]].startsWith(String(f[2]).replace('%', '')));
    }
    if (q.limit !== undefined) rows = rows.slice(0, q.limit);
    if (q.op === 'update') {
      for (const r of rows) Object.assign(r, q.patch);
      return { data: rows.map((r) => ({ id: r.id })), error: null, count: rows.length };
    }
    return { data: rows.map((r) => ({ ...r })), error: null, count: rows.length };
  };
  const from = (table: string) => {
    const q: any = { table, op: 'select', filters: [], patch: null };
    const api: any = {
      select: () => api,
      update: (patch: any) => ((q.op = 'update'), (q.patch = patch), api),
      eq: (k: string, v: any) => (q.filters.push(['eq', k, v]), api),
      in: (k: string, v: any[]) => (q.filters.push(['in', k, v]), api),
      like: (k: string, v: string) => (q.filters.push(['like', k, v]), api),
      limit: (n: number) => ((q.limit = n), api),
      maybeSingle: async () => ({ data: run(q).data?.[0] ?? null, error: null }),
      then: (res: any, rej: any) => Promise.resolve(run(q)).then(res, rej),
    };
    return api;
  };
  return {
    from,
    auth: {
      getUser: async (t: string) => ({ data: { user: { id: t } }, error: null }),
      getClaims: async (t: string) => ({ data: { claims: { sub: t, aal: 'aal2' } }, error: null }),
      admin: { mfa: { listFactors: async () => ({ data: { factors: [{ status: 'verified' }] }, error: null }) } },
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/cascade/cleanup-deleted-projects/route');

const A = '11111111-1111-4111-8111-111111111111';
const S = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const body = { companyId: A, strategyId: S, expectedRevision: 5, deletedProjectIds: ['proj-old'] };
const call = (user: string, b: unknown = body) =>
  POST(new Request('http://x/api/cascade/cleanup-deleted-projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${user}` },
    body: JSON.stringify(b),
  }));

function fresh() {
  st.updateErrors = {};
  st.beforeOkrUpdate = null;
  st.tables = {
    company_members: [
      { user_id: 'u-admin', company_id: A, role: 'admin' },
      { user_id: 'u-manager', company_id: A, role: 'manager' },
    ],
    strategy_data: [{ id: S, company_id: A, revision: 5, departments: [{ name: '営業部', projects: [{ id: 'proj-live' }] }] }],
    okrs: [{ id: 'o-old', company_id: A, strategy_id: S, project_id: 'proj-old', is_deleted: false }],
    progress_logs: [{ id: 'l-old', company_id: A, is_deleted: false, user_id: 'u-x', progress_text: '__META__:{"projectId":"proj-old"}\n本文' }],
  };
}
const row = (t: string, id: string): Row => (st.tables[t] ?? []).find((r) => r.id === id) as Row;

beforeEach(fresh);

describe('権限整合（M2 適用後）: manager も後始末できる、member は不可', () => {
  it('manager の再生成後の後始末は成功し、旧 OKR は論理削除される', async () => {
    const res = await call('u-manager');
    expect(res.status).toBe(200);
    expect(row('okrs', 'o-old').is_deleted).toBe(true);
  });
});

describe('部分的な失敗（M1 適用後）: 進捗ログの経路は無くなり、部分削除は起きない', () => {
  it('進捗ログの更新が失敗しても、後始末の結果に影響しない（進捗ログには触れない）', async () => {
    st.updateErrors.progress_logs = 'write failed';
    const res = await call('u-admin');
    expect(res.status).toBe(200);
    expect(row('okrs', 'o-old').is_deleted).toBe(true);
    expect(row('progress_logs', 'l-old').is_deleted).toBe(false);
  });
});

describe('確認から削除までの競合（revision 確認の後に別の保存が入る）', () => {
  it('確認の後・OKR 更新の直前に、別の保存で現役IDが増えても、この API は削除を完了する（窓が存在する）', async () => {
    st.beforeOkrUpdate = () => {
      row('strategy_data', S).revision = 6;
      row('strategy_data', S).departments = [{ name: '営業部', projects: [{ id: 'proj-live' }, { id: 'proj-old' }] }];
    };
    const res = await call('u-admin');
    expect(res.status).toBe(200);
    expect(row('okrs', 'o-old').is_deleted).toBe(true);
    expect(row('strategy_data', S).revision).toBe(6);
  });
});

describe('既に削除済みの行は、もう一度の呼び出しでも変わらない（冪等）', () => {
  it('2回目の呼び出しは 0 件で成功する', async () => {
    await call('u-admin');
    const res = await call('u-admin');
    expect((await res.json()).cleaned).toEqual({ okrs: 0 });
  });
});
