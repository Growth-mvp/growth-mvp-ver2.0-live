/* 2部門のモックで、草案→分析→対話→再生成→判断→保存→読み直し→確定までを、同じ保存先の上で通す。
 * 確かめること：草案・調整・対話・選択は正式データ（strategy_data.departments）に入らないこと、
 * 再生成・分析の前後で既存の部門ID・計画IDが変わらないこと、確定前に未判断の案を残せないこと。 */
const mockCreate = jest.fn();
let tables: Record<string, Array<Record<string, unknown>>> = {};

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/rbacGuard', () => ({ getAuthUserIdFromBearer: jest.fn(async () => 'user-1') }));
jest.mock('@/lib/server/auditLog', () => ({ logAuditEvent: jest.fn(async () => true) }));
jest.mock('@/lib/openai', () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => mockCreate(...args) } } },
}));

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { POST as analyze } from '@/app/api/stage3/adjustment/analyze/route';
import { POST as regenerate } from '@/app/api/stage3/adjustment/regenerate/route';
import { GET, PUT } from './route';
import { emptyWorkspaceState } from '@/lib/cascade/stage3StrategyBook';

const C1 = '11111111-1111-4111-8111-111111111111';
const S1 = '22222222-2222-4222-8222-222222222222';

const officialDepartments = [
  {
    id: 'd-sales',
    name: '営業部',
    mission: '既存顧客の深耕',
    finalized: true,
    projects: [{ id: 'p-1', title: '既存顧客の再受注施策', kpis: ['再受注率 40%'] }],
  },
  {
    id: 'd-mkt',
    name: 'マーケティング部',
    mission: '見込み客の獲得',
    finalized: true,
    projects: [{ id: 'p-2', title: '既存顧客向けセミナー' }],
  },
];

type Row = Record<string, unknown>;

function fakeAdmin() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let op: 'select' | 'insert' | 'update' = 'select';
      let payload: Row = {};
      const matched = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const exec = async (): Promise<{ data: unknown; error: { code?: string } | null }> => {
        if (op === 'insert') {
          const rows = tables[table] ?? [];
          if (rows.some((r) => r.strategy_id === payload.strategy_id)) return { data: null, error: { code: '23505' } };
          rows.push({ ...payload });
          tables[table] = rows;
          return { data: [payload], error: null };
        }
        if (op === 'update') {
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

function post(path: string, body: unknown) {
  return new Request(`http://localhost/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify(body),
  });
}

function put(body: unknown) {
  return new Request('http://localhost/api/stage3/strategy-book', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify(body),
  });
}

const llmReply = (payload: unknown) => ({ choices: [{ message: { content: JSON.stringify(payload) } }] });

beforeEach(() => {
  jest.clearAllMocks();
  tables = {
    company_members: [{ user_id: 'user-1', company_id: C1, role: 'admin' }],
    strategy_data: [
      {
        id: S1,
        company_id: C1,
        revision: 3,
        departments: structuredClone(officialDepartments),
        stage2_final_document_edits: {
          confirmed: { conclusion: '既存顧客の深耕を優先する', confirmedAt: '2026-11-01T00:00:00.000Z' },
        },
      },
    ],
    stage3_strategy_books: [],
  };
  (getSupabaseAdmin as jest.Mock).mockReturnValue(fakeAdmin());
});

it('草案→分析→対話→再生成→判断→保存→読み直し→確定まで通り、正式データとプロジェクトIDは変わらない', async () => {
  const official = structuredClone(officialDepartments);
  const draftDepartments = [
    { id: 'd-sales', name: '営業部', projects: [{ id: 'p-1', title: '既存顧客の再受注施策' }, { id: 'p-3', title: '6問を反映した新しい案' }] },
    { id: 'd-mkt', name: 'マーケティング部', projects: [{ id: 'p-2', title: '既存顧客向けセミナー' }] },
  ];
  const draft = { draftId: 'draft-r1', kind: 'regenerated', version: 1, createdAt: '2026-11-12T00:00:00.000Z', departments: draftDepartments };

  // 1. 6問を反映した再生成案を保存する（正式データには入らない）
  const savedDraft = await PUT(put({ companyId: C1, strategyId: S1, expectedVersion: 0, state: { ...emptyWorkspaceState(), drafts: [draft] } }));
  expect(savedDraft.status).toBe(200);

  // 2. 草案の最新の版を分析する
  mockCreate.mockResolvedValueOnce(
    llmReply({
      candidates: [
        {
          kind: 'duplicate',
          title: '既存顧客への重複施策',
          summary: '営業の新しい案とマーケのセミナーが同じ顧客を狙っている。',
          departmentKeys: ['id:d-sales', 'id:d-mkt'],
          planRefs: [
            { departmentKey: 'id:d-sales', projectId: 'id:p-3' },
            { departmentKey: 'id:d-mkt', projectId: 'id:p-2' },
          ],
          dialogueTopics: ['既存顧客の担当をどちらが持つか'],
        },
      ],
    }),
  );
  const analyzed = await analyze(post('stage3/adjustment/analyze', { companyId: C1, strategyId: S1, draft: { draftId: 'draft-r1', version: 1 } }));
  expect(analyzed.status).toBe(200);
  const analysis = await analyzed.json();
  expect(analysis.candidates[0].planRefs[0]).toMatchObject({ projectId: 'id:p-3', projectTitle: '6問を反映した新しい案' });
  expect(mockCreate.mock.calls[0][0].messages[1].content).toContain('計画ID=id:p-3');

  // 3. 候補と対話テーマを保存する
  const withAnalysis = {
    ...emptyWorkspaceState(),
    drafts: [draft],
    analysis: {
      draftId: 'draft-r1',
      draftVersion: 1,
      createdAt: '2026-11-12T00:00:00.000Z',
      candidates: analysis.candidates,
      rejectedCandidates: analysis.rejectedCandidates,
      rejectedReferences: analysis.rejectedReferences,
    },
  };
  const dialogue = [{ candidateId: 'adj-1', topic: '既存顧客の担当をどちらが持つか', result: '営業が担当し、マーケはリストを渡す' }];
  expect((await PUT(put({ companyId: C1, strategyId: S1, expectedVersion: 1, state: { ...withAnalysis, dialogue } }))).status).toBe(200);

  // 4. 対話結果を反映して再生成し、変更案を保存する（まだ正式データには入れない）
  mockCreate.mockResolvedValueOnce(
    llmReply({
      departments: [
        { departmentKey: 'id:d-sales', generated: { interDeptCollab: ['既存顧客はマーケ部がリストを渡し、営業部が担当する'] } },
      ],
    }),
  );
  const regenerated = await regenerate(
    post('stage3/adjustment/regenerate', {
      companyId: C1,
      strategyId: S1,
      draft: { draftId: 'draft-r1', version: 1 },
      candidates: analysis.candidates,
      dialogue,
    }),
  );
  expect(regenerated.status).toBe(200);
  const regen = await regenerated.json();
  const pending = regen.departments.flatMap((d: { departmentKey: string; departmentName: string; proposals: Array<{ item: string; proposed: unknown; base: unknown }> }) =>
    d.proposals.map((p) => ({ departmentKey: d.departmentKey, departmentName: d.departmentName, item: p.item, proposed: p.proposed, base: p.base, decision: 'pending' })),
  );
  expect(pending).toHaveLength(1);

  const withPending = { ...withAnalysis, dialogue, selections: pending };
  expect((await PUT(put({ companyId: C1, strategyId: S1, expectedVersion: 2, state: withPending }))).status).toBe(200);

  // 5. 未判断の案が残ったままでは確定できない
  const blocked = await PUT(put({ companyId: C1, strategyId: S1, expectedVersion: 3, state: { ...withPending, status: 'confirmed', confirmed: { confirmedAt: '2026-11-12T00:00:00.000Z', appliedCount: 0 } } }));
  expect(blocked.status).toBe(400);
  expect(await blocked.json()).toMatchObject({ error: 'confirmed_with_pending' });

  // 6. 利用者が判断して確定する（反映は既存の反映経路が行うため、ここでは判断の記録だけ残す）
  const decided = withPending.selections.map((s) => ({ ...s, decision: 'discarded' }));
  const confirmed = await PUT(
    put({
      companyId: C1,
      strategyId: S1,
      expectedVersion: 3,
      state: { ...withPending, selections: decided, status: 'confirmed', confirmed: { confirmedAt: '2026-11-12T00:00:00.000Z', appliedCount: 0 } },
    }),
  );
  expect(confirmed.status).toBe(200);

  // 7. 読み直すと、草案・分析・対話・判断・確定の状態がそのまま戻る
  const reloaded = await (await GET(new Request(`http://localhost/api/stage3/strategy-book?companyId=${C1}&strategyId=${S1}`, { headers: { authorization: 'Bearer token' } }))).json();
  expect(reloaded.version).toBe(4);
  expect(reloaded.state.status).toBe('confirmed');
  expect(reloaded.state.drafts[0].draftId).toBe('draft-r1');
  expect(reloaded.state.analysis.candidates[0].id).toBe('adj-1');
  expect(reloaded.state.dialogue[0].result).toBe('営業が担当し、マーケはリストを渡す');
  expect(reloaded.state.selections[0].decision).toBe('discarded');

  // 8. 正式データ（部門・計画・KPI）は、草案・分析・再生成・確定の前後で変わっていない
  const stored = tables.strategy_data[0];
  expect(stored.departments).toEqual(official);
  expect((stored.departments as Array<{ projects: Array<{ id: string }> }>)[0].projects.map((p) => p.id)).toEqual(['p-1']);
  expect(tables.strategy_data).toHaveLength(1);
});
