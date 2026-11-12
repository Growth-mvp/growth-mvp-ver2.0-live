/* 確かめること：確定は全件検証してから、DB関数（stage3_confirm_strategy_book）を1回呼ぶ。
 * 途中で失敗したら正式データも作業状態も変わらない（関数の中の書き込みは取り消される）。
 * 採用された新規プロジェクトだけを、新しいIDで追加する。既存の計画・IDは変えない。
 * 未判断の案が残っていれば確定しない。権限・revision・版・会社を照合する。
 * この試験は関数の動きを模擬する。関数本体の確認は eval/db の PGlite 検証で行う。 */
let tables: Record<string, Array<Record<string, unknown>>> = {};
let failAfterWrite = false;
let authUser: string | null = 'user-1';
let role = 'admin';
const rpcCalls: string[] = [];

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
type RpcResult = { data: unknown; error: { message: string } | null };

const fail = (message: string): RpcResult => ({ data: null, error: { message } });

/* 関数 stage3_confirm_strategy_book の振る舞いを模擬する（権限・revision・版の確認、更新、途中失敗での巻き戻し） */
async function rpcImpl(name: string, a: Row): Promise<RpcResult> {
  rpcCalls.push(name);
  if (name !== 'stage3_confirm_strategy_book') return fail('unknown function');
  const member = tables.company_members.find((m) => m.user_id === a.p_actor_user_id && m.company_id === a.p_company_id);
  if (!member || !['admin', 'manager'].includes(String(member.role))) return fail('insufficient_role');
  if ((a.p_state as Row).status !== 'confirmed') return fail('invalid_state');
  const strategy = tables.strategy_data.find((s) => s.id === a.p_strategy_id && s.company_id === a.p_company_id);
  if (!strategy) return fail('strategy_mismatch');
  if (strategy.revision !== a.p_expected_revision) return fail('revision_changed');
  const book = tables.stage3_strategy_books.find((b) => b.strategy_id === a.p_strategy_id && b.company_id === a.p_company_id);
  if (!book || book.version !== a.p_expected_version) return fail('version_conflict');

  const before = structuredClone({ departments: strategy.departments, revision: strategy.revision, state: book.state, version: book.version });
  strategy.departments = a.p_departments;
  strategy.revision = Number(strategy.revision) + 1;
  if (failAfterWrite) {
    // 途中で失敗：関数の中で行った書き込みを取り消す
    strategy.departments = before.departments;
    strategy.revision = before.revision;
    return fail('simulated failure');
  }
  book.state = a.p_state;
  book.version = Number(book.version) + 1;
  return { data: [{ revision: strategy.revision, version: book.version }], error: null };
}

function fakeAdmin() {
  return {
    rpc: (name: string, args: Row) => rpcImpl(name, args),
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const matched = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const q = {
        select: () => q,
        eq(c: string, v: unknown) {
          filters.push((r) => r[c] === v);
          return q;
        },
        limit: () => q,
        maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve({ data: matched(), error: null }).then(resolve, reject);
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

const newProjectCandidate = {
  departmentKey: 'id:d-sales',
  candidateId: 'np-0000abcd',
  project: {
    id: 'cand-temp-1',
    title: '6問を反映した新しい案',
    reason: '既存顧客の失注理由を減らす',
    approvedAt: '2026-11-01T00:00:00.000Z', // 承認の記録は採用時に引き継がない
    ownerName: '持ち込まない',
    okrs: [{ id: 'old-okr-id', objective: '新しい目標', keyResults: ['新しい指標'] }],
  },
};

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
  rpcCalls.length = 0;
  failAfterWrite = false;
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
  it('採用された変更案を、関数を1回呼んで反映する。旧データのIDは付けない（既存の計画は変えない）', async () => {
    const res = await POST(post(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, revision: 6, version: 3, appliedCount: 2, adoptedProjectIds: [] });
    expect(rpcCalls).toEqual(['stage3_confirm_strategy_book']);

    const depts = tables.strategy_data[0].departments as Array<Record<string, unknown>>;
    expect(depts[0].interDeptCollab).toEqual(['マーケ部とセミナーの案内先を分ける']);
    expect(depts[0].projects).toEqual(originalDepartments()[0].projects);
    expect(depts[1].interDeptCollab).toEqual(['営業と役割を分ける']);
    expect(depts[1].projects).toEqual([{ title: '旧データの計画（ID無し）' }]);
    expect((tables.stage3_strategy_books[0].state as WorkspaceState).status).toBe('confirmed');
  });

  it('採用された新規プロジェクトだけを、新しいIDで追加する。承認・担当など持ち込んではいけない項目は除く', async () => {
    tables.stage3_strategy_books[0] = workspaceWith({
      ...decidedAll,
      drafts: [
        {
          draftId: 'draft-r1',
          kind: 'regenerated',
          version: 1,
          createdAt: '2026-11-12T00:00:00.000Z',
          departments: [{ id: 'd-sales', name: '営業部', projects: [{ id: 'p-1', title: '既存顧客の再受注施策' }] }],
          newProjects: [newProjectCandidate],
        },
      ],
      projectSelections: [
        { departmentKey: 'id:d-sales', departmentName: '営業部', candidateId: 'np-0000abcd', title: '6問を反映した新しい案', decision: 'applied' },
      ],
    });
    const res = await POST(post(body));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.adoptedProjectIds).toHaveLength(1);

    const sales = (tables.strategy_data[0].departments as Array<{ projects: Array<Record<string, unknown>> }>)[0];
    expect(sales.projects).toHaveLength(2);
    expect(sales.projects[0]).toEqual(originalDepartments()[0].projects[0]);
    const added = sales.projects[1];
    expect(added.id).toBe(json.adoptedProjectIds[0]);
    expect(added.id).not.toBe('cand-temp-1');
    expect(added.title).toBe('6問を反映した新しい案');
    expect(added).not.toHaveProperty('approvedAt');
    expect(added).not.toHaveProperty('ownerName');
    expect((added.okrs as Array<Record<string, unknown>>)[0]).not.toHaveProperty('id');
  });

  it('採用されなかった新規プロジェクトは、正式データに書かない', async () => {
    tables.stage3_strategy_books[0] = workspaceWith({
      ...decidedAll,
      drafts: [
        {
          draftId: 'draft-r1',
          kind: 'regenerated',
          version: 1,
          createdAt: '2026-11-12T00:00:00.000Z',
          departments: [{ id: 'd-sales', name: '営業部', projects: [] }],
          newProjects: [newProjectCandidate],
        },
      ],
      projectSelections: [
        { departmentKey: 'id:d-sales', departmentName: '営業部', candidateId: 'np-0000abcd', title: '6問を反映した新しい案', decision: 'discarded' },
      ],
    });
    const res = await POST(post(body));
    expect(res.status).toBe(200);
    const sales = (tables.strategy_data[0].departments as Array<{ projects: unknown[] }>)[0];
    expect(sales.projects).toEqual(originalDepartments()[0].projects);
  });

  it('1件でも現在値が変わっていれば、関数を呼ばず、正式データも作業状態も変えない', async () => {
    tables.strategy_data[0].departments = [
      originalDepartments()[0],
      { ...originalDepartments()[1], interDeptCollab: ['別の人が先に変えた'] },
    ];
    const before = JSON.stringify(tables);
    const res = await POST(post(body));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'current_value_changed', departmentName: 'マーケティング部' });
    expect(rpcCalls).toEqual([]);
    expect(JSON.stringify(tables)).toBe(before);
  });

  it('途中で失敗したら、正式データも作業状態も確定前のまま（トランザクションの巻き戻し）', async () => {
    failAfterWrite = true;
    const res = await POST(post(body));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'confirm_failed' });
    const strategy = tables.strategy_data[0];
    expect(strategy.departments).toEqual(originalDepartments());
    expect(strategy.revision).toBe(5);
    expect((tables.stage3_strategy_books[0].state as WorkspaceState).status).toBe('draft');
    expect(tables.stage3_strategy_books[0].version).toBe(2);
  });

  it('未判断の変更案や新規プロジェクトが残っている間は確定しない', async () => {
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
    expect(rpcCalls).toEqual([]);
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
