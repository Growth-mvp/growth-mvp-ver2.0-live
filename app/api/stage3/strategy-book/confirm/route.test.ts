/* 確かめること：確定は全件検証してから1回だけ正式データを書く、途中で失敗したら正式データも作業状態も変わらない、
 * 作業状態の記録に失敗したら正式データを元に戻す、未判断の案が残っていれば確定しない、権限・revision・版を照合する。 */
let tables: Record<string, Array<Record<string, unknown>>> = {};
let failWorkspaceUpdate = false;
let authUser: string | null = 'user-1';
let role = 'admin';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(async () => authUser),
}));
jest.mock('@/lib/server/auditLog', () => ({ logAuditEvent: jest.fn(async () => true) }));

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { POST } from './route';
import { emptyWorkspaceState, type WorkspaceState } from '@/lib/cascade/stage3StrategyBook';
import { buildDeptProposals } from '@/lib/cascade/stage3Candidates';

const C1 = '11111111-1111-4111-8111-111111111111';
const S1 = '22222222-2222-4222-8222-222222222222';

const originalDepartments = () => [
  {
    id: 'd-sales',
    name: '営業部',
    intraDeptCollab: ['既存の連携'],
    projects: [{ id: 'p-1', title: '既存顧客の再受注施策', kpis: ['再受注率 40%'] }],
  },
  {
    id: 'd-mkt',
    name: 'マーケティング部',
    projects: [{ title: '旧データの計画（ID無し）' }],
  },
];

type Row = Record<string, unknown>;

function fakeAdmin() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let op: 'select' | 'update' = 'select';
      let payload: Row = {};
      const matched = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const exec = async (): Promise<{ data: unknown; error: { code?: string } | null }> => {
        if (op === 'update') {
          if (table === 'stage3_strategy_books' && failWorkspaceUpdate) return { data: null, error: { code: 'XX000' } };
          const rows = matched();
          rows.forEach((r) => {
            Object.assign(r, payload);
            if (table === 'strategy_data') r.revision = Number(r.revision) + 1; // DBのトリガーの代わり
          });
          return { data: rows.map((r) => ({ id: r.id, revision: r.revision, version: r.version })), error: null };
        }
        return { data: matched(), error: null };
      };
      const q = {
        select: () => q,
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

function workspaceWith(state: Partial<WorkspaceState>, version = 2) {
  return {
    strategy_id: S1,
    company_id: C1,
    version,
    state: { ...emptyWorkspaceState(), ...state },
    updated_by: 'user-1',
  };
}

const salesProposal = buildDeptProposals(originalDepartments()[0] as Record<string, unknown>, {
  intraDeptCollab: ['既存の連携'],
  interDeptCollab: ['マーケ部とセミナーの案内先を分ける'],
  needsCollab: ['既存の連携', 'マーケ部とセミナーの案内先を分ける'],
})[0];

const mktProposal = buildDeptProposals(originalDepartments()[1] as Record<string, unknown>, {
  intraDeptCollab: [],
  interDeptCollab: ['営業と役割を分ける'],
  needsCollab: ['営業と役割を分ける'],
})[0];

type Decision = WorkspaceState['selections'][number]['decision'];

function selections(decisions: { sales: Decision; mkt: Decision }): WorkspaceState['selections'] {
  return [
    {
      departmentKey: 'id:d-sales',
      departmentName: '営業部',
      item: salesProposal.item,
      proposed: salesProposal.proposed,
      base: salesProposal.base,
      decision: decisions.sales,
    },
    {
      departmentKey: 'id:d-mkt',
      departmentName: 'マーケティング部',
      item: mktProposal.item,
      proposed: mktProposal.proposed,
      base: mktProposal.base,
      decision: decisions.mkt,
    },
  ];
}

const decidedAll: Partial<WorkspaceState> = {
  status: 'draft',
  analysis: null,
  selections: selections({ sales: 'applied', mkt: 'applied' }),
};

function post(body: unknown) {
  return new Request('http://localhost/api/stage3/strategy-book/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify(body),
  });
}

const body = { companyId: C1, strategyId: S1, expectedRevision: 5, expectedVersion: 2 };

beforeEach(() => {
  jest.clearAllMocks();
  failWorkspaceUpdate = false;
  authUser = 'user-1';
  role = 'admin';
  tables = {
    company_members: [{ user_id: 'user-1', company_id: C1, role }],
    strategy_data: [
      {
        id: S1,
        company_id: C1,
        revision: 5,
        departments: originalDepartments(),
        stage2_final_document_edits: { confirmed: { conclusion: '既存顧客の深耕を優先する' } },
      },
    ],
    stage3_strategy_books: [workspaceWith(decidedAll)],
  };
  (getSupabaseAdmin as jest.Mock).mockReturnValue(fakeAdmin());
});

describe('POST /api/stage3/strategy-book/confirm', () => {
  it('採用された全件を1回の更新で反映し、作業状態を確定にする。IDの無い計画にだけIDを付ける', async () => {
    const res = await POST(post(body));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, revision: 6, version: 3, appliedCount: 2, assignedProjectIds: 1 });

    const strategy = tables.strategy_data[0];
    const depts = strategy.departments as Array<Record<string, unknown>>;
    expect(depts[0].interDeptCollab).toEqual(['マーケ部とセミナーの案内先を分ける']);
    expect(depts[0].projects).toEqual(originalDepartments()[0].projects);
    expect(depts[1].interDeptCollab).toEqual(['営業と役割を分ける']);
    expect((depts[1].projects as Array<{ id?: string }>)[0].id).toMatch(/^p-/);

    const workspace = tables.stage3_strategy_books[0];
    expect((workspace.state as WorkspaceState).status).toBe('confirmed');
    expect((workspace.state as WorkspaceState).confirmed?.appliedCount).toBe(2);
  });

  it('1件でも現在値が変わっていれば、正式データも作業状態も変えない', async () => {
    tables.strategy_data[0].departments = [
      originalDepartments()[0],
      { ...originalDepartments()[1], interDeptCollab: ['別の人が先に変えた'] },
    ];
    const before = JSON.stringify(tables);
    const res = await POST(post(body));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'current_value_changed', departmentName: 'マーケティング部' });
    expect(JSON.stringify(tables)).toBe(before);
  });

  it('作業状態の記録に失敗したら、正式データを確定前の内容に戻す', async () => {
    failWorkspaceUpdate = true;
    const res = await POST(post(body));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'confirm_rolled_back' });
    const strategy = tables.strategy_data[0];
    expect(strategy.departments).toEqual(originalDepartments());
    expect(strategy.revision).toBe(7);
    expect((tables.stage3_strategy_books[0].state as WorkspaceState).status).toBe('draft');
  });

  it('未判断の変更案が残っている間は確定しない', async () => {
    tables.stage3_strategy_books[0] = workspaceWith({ ...decidedAll, selections: selections({ sales: 'applied', mkt: 'pending' }) });
    const before = JSON.stringify(tables);
    const res = await POST(post(body));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'confirmed_with_pending' });
    expect(JSON.stringify(tables)).toBe(before);
  });

  it('保留・不採用は確定の対象にせず、他の採用だけを反映する', async () => {
    tables.stage3_strategy_books[0] = workspaceWith({ ...decidedAll, selections: selections({ sales: 'applied', mkt: 'deferred' }) });
    const res = await POST(post(body));
    expect(res.status).toBe(200);
    const depts = tables.strategy_data[0].departments as Array<Record<string, unknown>>;
    expect(depts[0].interDeptCollab).toEqual(['マーケ部とセミナーの案内先を分ける']);
    expect(depts[1].interDeptCollab).toBeUndefined();
    const saved = (tables.stage3_strategy_books[0].state as WorkspaceState).selections;
    expect(saved.map((s) => s.decision)).toEqual(['applied', 'deferred']);
  });

  it('管理者・管理職以外は確定できない', async () => {
    role = 'member';
    tables.company_members[0].role = 'member';
    const res = await POST(post(body));
    expect(res.status).toBe(403);
    expect(tables.strategy_data[0].revision).toBe(5);
  });

  it('revision・版が古ければ、どちらも書かない', async () => {
    expect((await POST(post({ ...body, expectedRevision: 4 }))).status).toBe(409);
    expect((await POST(post({ ...body, expectedVersion: 1 }))).status).toBe(409);
    expect(tables.strategy_data[0].revision).toBe(5);
  });

  it('既に確定済みなら、もう一度は確定しない', async () => {
    tables.stage3_strategy_books[0] = workspaceWith({
      status: 'confirmed',
      confirmed: { confirmedAt: '2026-11-12T00:00:00.000Z', appliedCount: 2 },
      selections: selections({ sales: 'applied', mkt: 'applied' }),
    });
    const res = await POST(post(body));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'already_confirmed' });
  });
});
