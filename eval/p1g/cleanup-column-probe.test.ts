export {};
/* 後始末APIの列の前提（モック・読み取り専用）。progress_logs.is_deleted が本番に無い場合の挙動を確認する。 */
jest.mock('server-only', () => ({}));

type Row = Record<string, any>;
const st: { tables: Record<string, Row[]>; missingProgressIsDeleted: boolean } = { tables: {}, missingProgressIsDeleted: false };

jest.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => {
    const run = (q: any) => {
      if (st.missingProgressIsDeleted && q.table === 'progress_logs' && q.filters.some((f: any) => f[1] === 'is_deleted')) {
        return { data: null, error: { message: 'column progress_logs.is_deleted does not exist' }, count: null };
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
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/cascade/cleanup-deleted-projects/route');

const A = '11111111-1111-4111-8111-111111111111';
const S = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

beforeEach(() => {
  st.missingProgressIsDeleted = false;
  st.tables = {
    company_members: [{ user_id: 'u-admin', company_id: A, role: 'admin' }],
    strategy_data: [{ id: S, company_id: A, revision: 5, departments: [] }],
    okrs: [{ id: 'o-old', company_id: A, strategy_id: S, project_id: 'proj-old', is_deleted: false }],
    progress_logs: [],
  };
});

const call = () =>
  POST(new Request('http://x/api/cascade/cleanup-deleted-projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer u-admin' },
    body: JSON.stringify({ companyId: A, strategyId: S, expectedRevision: 5, deletedProjectIds: ['proj-old'] }),
  }));

describe('progress_logs.is_deleted が本番に無い場合（M1 適用後）', () => {
  it('進捗ログを参照しなくなったため、列が無くても OKR の後始末は成功する（修正前は 503 で全体が止まっていた）', async () => {
    st.missingProgressIsDeleted = true;
    const res = await call();
    expect(res.status).toBe(200);
    expect(st.tables.okrs[0].is_deleted).toBe(true);
  });

  it('列がある場合も、進捗ログは変更されない', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(st.tables.okrs[0].is_deleted).toBe(true);
  });
});
