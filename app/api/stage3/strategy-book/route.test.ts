/* 確かめること：所属・戦略の照合、版の競合（古い版での保存を拒否）、保存前の正式データとの照合、
 * 確定は管理者・管理職だけ、正式データ（strategy_data）と他社のデータに触れないこと。 */
const writes: string[] = [];
let tables: Record<string, Array<Record<string, unknown>>> = {};
let authUser: string | null = 'user-1';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(async () => authUser),
}));
jest.mock('@/lib/server/auditLog', () => ({ logAuditEvent: jest.fn(async () => true) }));

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { GET, PUT } from './route';
import { emptyWorkspaceState } from '@/lib/cascade/stage3StrategyBook';

const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '33333333-3333-4333-8333-333333333333';
const S1 = '22222222-2222-4222-8222-222222222222';
const S2 = '44444444-4444-4444-8444-444444444444';

const departments = [
  { id: 'd-sales', name: '営業部', mission: '既存顧客の深耕', projects: [{ id: 'p-1', title: '既存顧客の再受注施策' }] },
  { id: 'd-mkt', name: 'マーケティング部', mission: '見込み客の獲得', projects: [{ id: 'p-2', title: '既存顧客向けセミナー' }] },
];

type Row = Record<string, unknown>;

function baseTables(role: string): Record<string, Row[]> {
  return {
    company_members: [
      { user_id: 'user-1', company_id: C1, role },
      { user_id: 'user-2', company_id: C2, role: 'admin' },
    ],
    strategy_data: [
      {
        id: S1,
        company_id: C1,
        revision: 7,
        departments,
        stage2_final_document_edits: {
          confirmed: { conclusion: '既存顧客の深耕を優先する', confirmedAt: '2026-11-01T00:00:00.000Z' },
        },
      },
      { id: S2, company_id: C2, revision: 1, departments: [], stage2_final_document_edits: null },
    ],
    stage3_strategy_books: [],
  };
}

function fakeAdmin() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let op: 'select' | 'insert' | 'update' = 'select';
      let payload: Row = {};
      const matched = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const exec = async (): Promise<{ data: unknown; error: { code?: string; message?: string } | null }> => {
        if (op === 'insert') {
          const rows = tables[table] ?? [];
          if (rows.some((r) => r.strategy_id === payload.strategy_id)) return { data: null, error: { code: '23505' } };
          writes.push(`${table}.insert`);
          rows.push({ ...payload });
          tables[table] = rows;
          return { data: [payload], error: null };
        }
        if (op === 'update') {
          writes.push(`${table}.update`);
          const rows = matched();
          rows.forEach((r) => Object.assign(r, payload));
          return { data: rows.map((r) => ({ version: r.version })), error: null };
        }
        return { data: matched(), error: null };
      };
      const q = {
        select: () => q,
        insert(values: Row) {
          op = 'insert';
          payload = values;
          return q;
        },
        update(values: Row) {
          op = 'update';
          payload = values;
          return q;
        },
        eq(c: string, v: unknown) {
          filters.push((r) => r[c] === v);
          return q;
        },
        limit: () => q,
        maybeSingle: () => exec().then((r) => ({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error })),
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return exec().then(resolve, reject);
        },
      };
      return q;
    },
  };
}

const url = (companyId: string, strategyId: string) =>
  `http://localhost/api/stage3/strategy-book?companyId=${companyId}&strategyId=${strategyId}`;

function put(body: unknown) {
  return new Request('http://localhost/api/stage3/strategy-book', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify(body),
  });
}

const get = (companyId: string, strategyId: string) =>
  new Request(url(companyId, strategyId), { headers: { authorization: 'Bearer token' } });

const draftState = (overrides: Record<string, unknown> = {}) => ({
  ...emptyWorkspaceState(),
  drafts: [
    {
      draftId: 'draft-r1',
      kind: 'regenerated',
      version: 1,
      createdAt: '2026-11-12T00:00:00.000Z',
      departments: [{ id: 'd-sales', name: '営業部', projects: [{ id: 'p-1', title: '既存顧客の再受注施策' }] }],
    },
  ],
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  writes.length = 0;
  tables = baseTables('member');
  authUser = 'user-1';
  (getSupabaseAdmin as jest.Mock).mockReturnValue(fakeAdmin());
});

describe('GET /api/stage3/strategy-book', () => {
  it('保存が無ければ版0の空の作業状態を返す', async () => {
    const res = await GET(get(C1, S1));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(0);
    expect(body.state.drafts).toEqual([]);
    expect(body.revision).toBe(7);
  });

  it('所属がない利用者、別の会社の戦略は読めない', async () => {
    authUser = 'user-9';
    expect((await GET(get(C1, S1))).status).toBe(403);
    authUser = 'user-1';
    expect((await GET(get(C1, S2))).status).toBe(403);
  });
});

describe('PUT /api/stage3/strategy-book', () => {
  it('初回は版1で保存し、正式データ（strategy_data）には書き込まない', async () => {
    const res = await PUT(put({ companyId: C1, strategyId: S1, expectedVersion: 0, state: draftState() }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: 1 });
    expect(writes).toEqual(['stage3_strategy_books.insert']);
    expect(tables.strategy_data[0].departments).toEqual(departments);
  });

  it('読んだ版と違う版で保存しようとすると、書かずに競合を返す', async () => {
    await PUT(put({ companyId: C1, strategyId: S1, expectedVersion: 0, state: draftState() }));
    writes.length = 0;
    const res = await PUT(put({ companyId: C1, strategyId: S1, expectedVersion: 0, state: draftState() }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'version_conflict' });
    expect(writes).toEqual([]);
  });

  it('保存済みにない部門を指す草案は、保存を拒否する（草案で部門を増やせない）', async () => {
    const forged = draftState({
      drafts: [
        {
          draftId: 'draft-r1',
          kind: 'regenerated',
          version: 1,
          createdAt: '2026-11-12T00:00:00.000Z',
          departments: [{ id: 'd-new', name: '新設部門', projects: [] }],
        },
      ],
    });
    const res = await PUT(put({ companyId: C1, strategyId: S1, expectedVersion: 0, state: forged }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'draft_department_unknown' });
    expect(writes).toEqual([]);
  });

  it('形式が壊れた状態は保存しない', async () => {
    const res = await PUT(put({ companyId: C1, strategyId: S1, expectedVersion: 0, state: { schemaVersion: 2 } }));
    expect(res.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it('一般社員は確定として保存できない。管理職は確定の記録を保存できる', async () => {
    const confirmed = {
      ...emptyWorkspaceState(),
      status: 'confirmed',
      confirmed: { confirmedAt: '2026-11-12T00:00:00.000Z', appliedCount: 0 },
    };
    const denied = await PUT(put({ companyId: C1, strategyId: S1, expectedVersion: 0, state: confirmed }));
    expect(denied.status).toBe(403);
    expect(writes).toEqual([]);

    tables.company_members[0].role = 'manager';
    const allowed = await PUT(put({ companyId: C1, strategyId: S1, expectedVersion: 0, state: confirmed }));
    expect(allowed.status).toBe(200);
  });

  it('所属がない利用者は保存できず、他社の戦略にも書けない', async () => {
    authUser = 'user-9';
    expect((await PUT(put({ companyId: C1, strategyId: S1, expectedVersion: 0, state: draftState() }))).status).toBe(403);
    authUser = 'user-1';
    expect((await PUT(put({ companyId: C1, strategyId: S2, expectedVersion: 0, state: draftState() }))).status).toBe(403);
    expect(writes).toEqual([]);
  });

  it('保存後も、読み直すと同じ内容と版が返る（リロード後の復元）', async () => {
    await PUT(put({ companyId: C1, strategyId: S1, expectedVersion: 0, state: draftState() }));
    const body = await (await GET(get(C1, S1))).json();
    expect(body.version).toBe(1);
    expect(body.state.drafts[0].draftId).toBe('draft-r1');
  });
});
