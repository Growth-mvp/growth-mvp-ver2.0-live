/* 確かめること：認証・所属・戦略の照合が通った後にだけAIを呼ぶこと、STAGE2の確定版だけを入力にすること、
 * 草案は保存済みの版だけを使うこと、部門・計画は安定IDで照合すること、他社の戦略を読まないこと、
 * どちらのAPIも正式データ・作業状態へ書き込まないこと、失敗時に内部情報を返さないこと。 */
const mockCreate = jest.fn();
const writes: string[] = [];
let tables: Record<string, Array<Record<string, unknown>>> = {};
let authUser: string | null = 'user-1';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(async () => authUser),
}));
jest.mock('@/lib/server/auditLog', () => ({ logAuditEvent: jest.fn(async () => true) }));
jest.mock('@/lib/openai', () => ({
  openai: {
    chat: { completions: { create: (...args: unknown[]) => mockCreate(...args) } },
  },
}));

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { POST as analyze } from './analyze/route';
import { POST as regenerate } from './regenerate/route';

const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '33333333-3333-4333-8333-333333333333';
const S1 = '22222222-2222-4222-8222-222222222222';
const S2 = '44444444-4444-4444-8444-444444444444';

const departments = [
  {
    id: 'd-sales',
    name: '営業部',
    mission: '既存顧客の深耕',
    projects: [
      { id: 'p-1', title: '既存顧客の再受注施策', hypothesis: '再受注率を上げる', okrs: [{ keyResults: ['再受注率 40%'] }] },
    ],
  },
  {
    id: 'd-mkt',
    name: 'マーケティング部',
    mission: '見込み客の獲得',
    projects: [{ id: 'p-2', title: '既存顧客向けセミナー', description: '既存顧客に向けた情報提供' }],
  },
];

const confirmedEdits = {
  conclusion: '既存顧客の深耕を優先する',
  assumptions: { external: ['市場は横ばい'], internal: [], implications: [] },
  confirmedAt: '2026-11-01T00:00:00.000Z',
};

const llmAnalysis = {
  candidates: [
    {
      kind: 'duplicate',
      title: '既存顧客への重複施策',
      summary: '営業とマーケが同じ既存顧客を対象にしている。',
      departmentKeys: ['id:d-sales', 'id:d-mkt'],
      planRefs: [
        { departmentKey: 'id:d-sales', projectId: 'id:p-1' },
        { departmentKey: 'id:d-mkt', projectId: 'id:p-2' },
      ],
      dialogueTopics: ['既存顧客の担当をどちらが持つか'],
    },
  ],
};

function baseTables(): typeof tables {
  return {
    company_members: [
      { user_id: 'user-1', company_id: C1, role: 'member' },
      { user_id: 'user-2', company_id: C2, role: 'member' },
    ],
    strategy_data: [
      {
        id: S1,
        company_id: C1,
        revision: 7,
        departments,
        stage2_final_document_edits: { confirmed: confirmedEdits },
        final_story_final: [
          { title: '顧客の課題', body: '既存顧客は再発注の手続きに時間をかけている（確定版の全文）' },
          { title: '自社が選ばれる理由', body: '手続きを半分にできる点が選ばれる理由（確定版の全文）' },
        ],
      },
      {
        id: S2,
        company_id: C2,
        revision: 1,
        departments: [{ id: 'x', name: '他社部門', projects: [{ id: 'x-1', title: '他社の計画' }] }],
        stage2_final_document_edits: { confirmed: confirmedEdits },
      },
    ],
    stage3_strategy_books: [],
  };
}

type Row = Record<string, unknown>;

function fakeAdmin() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let op: 'select' | 'insert' | 'update' = 'select';
      let payload: Row = {};
      const matched = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const exec = async (): Promise<{ data: unknown; error: { code?: string; message?: string } | null }> => {
        if (op === 'insert') {
          writes.push(`${table}.insert`);
          const rows = tables[table] ?? [];
          if (rows.some((r) => r.strategy_id === payload.strategy_id)) return { data: null, error: { code: '23505' } };
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

function req(path: string, body: unknown) {
  return new Request(`http://localhost/api/stage3/adjustment/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify(body),
  });
}

function llmReply(payload: unknown) {
  return { choices: [{ message: { content: JSON.stringify(payload) } }] };
}

beforeEach(() => {
  jest.clearAllMocks();
  writes.length = 0;
  tables = baseTables();
  authUser = 'user-1';
  (getSupabaseAdmin as jest.Mock).mockReturnValue(fakeAdmin());
});

describe('POST /api/stage3/adjustment/analyze', () => {
  it('所属がない利用者は拒否し、AIを呼ばない', async () => {
    authUser = 'user-9';
    const res = await analyze(req('analyze', { companyId: C1, strategyId: S1 }));
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('認証できない場合は401', async () => {
    authUser = null;
    const res = await analyze(req('analyze', { companyId: C1, strategyId: S1 }));
    expect(res.status).toBe(401);
  });

  it('別の会社の戦略は読まない', async () => {
    const res = await analyze(req('analyze', { companyId: C1, strategyId: S2 }));
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('STAGE2の確定版が無い戦略は、下書きがあってもAIを呼ばない', async () => {
    tables.strategy_data[0].stage2_final_document_edits = { conclusion: '下書きだけ', draftChangedAt: '2026-11-02T00:00:00.000Z' };
    tables.strategy_data[0].final_story_final = [];
    const res = await analyze(req('analyze', { companyId: C1, strategyId: S1 }));
    expect(res.status).toBe(409);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('STAGE2で確定済みなら、結論が空でも分析できる（確定の記録と本文があれば確定）', async () => {
    tables.strategy_data[0].stage2_final_document_edits = { confirmed: { conclusion: '', assumptions: {} } };
    mockCreate.mockResolvedValueOnce(llmReply(llmAnalysis));
    const res = await analyze(req('analyze', { companyId: C1, strategyId: S1 }));
    expect(res.status).toBe(200);
    const sent = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(sent).toContain('既存顧客は再発注の手続きに時間をかけている（確定版の全文）');
  });

  it('確定の記録はあるが本文がない場合は、未確定とは別のエラーを返す', async () => {
    tables.strategy_data[0].final_story_final = null;
    const res = await analyze(req('analyze', { companyId: C1, strategyId: S1 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'stage2_story_missing' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('部門が2つ未満なら、横断分析をしない', async () => {
    tables.strategy_data[0].departments = [departments[0]];
    const res = await analyze(req('analyze', { companyId: C1, strategyId: S1 }));
    expect(res.status).toBe(422);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('保存済みの正式データを、部門ID・計画IDつきでAIに渡し、照合できた候補だけを返す。書き込みはしない', async () => {
    mockCreate.mockResolvedValueOnce(llmReply(llmAnalysis));
    const res = await analyze(req('analyze', { companyId: C1, strategyId: S1 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revision).toBe(7);
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({
      id: 'adj-1',
      kind: 'duplicate',
      departments: [
        { departmentKey: 'id:d-sales', name: '営業部' },
        { departmentKey: 'id:d-mkt', name: 'マーケティング部' },
      ],
    });

    const sent = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(sent).toContain('既存顧客の深耕を優先する');
    expect(sent).toContain('既存顧客は再発注の手続きに時間をかけている（確定版の全文）');
    expect(sent).toContain('手続きを半分にできる点が選ばれる理由（確定版の全文）');
    expect(sent).toContain('外部環境の前提（判断基準）: 市場は横ばい');
    expect(sent).toContain('部門ID=id:d-sales');
    expect(sent).toContain('計画ID=id:p-2');
    expect(sent).not.toContain('他社の計画');
    expect(writes).toEqual([]);
  });

  it('AIが存在しない計画IDを出したら、その参照を採用せず件数を知らせる', async () => {
    const withFake = {
      candidates: [
        {
          ...llmAnalysis.candidates[0],
          planRefs: [
            { departmentKey: 'id:d-sales', projectId: 'id:p-1' },
            { departmentKey: 'id:d-mkt', projectId: 'id:p-999' },
          ],
        },
      ],
    };
    mockCreate.mockResolvedValueOnce(llmReply(withFake));
    const res = await analyze(req('analyze', { companyId: C1, strategyId: S1 }));
    const body = await res.json();
    expect(body.candidates[0].planRefs).toHaveLength(1);
    expect(body.rejectedReferences).toBe(1);
  });

  it('保存された草案の版が違えば、分析せずに拒否する', async () => {
    tables.stage3_strategy_books.push({
      strategy_id: S1,
      company_id: C1,
      version: 3,
      state: {
        schemaVersion: 1,
        status: 'draft',
        drafts: [
          {
            draftId: 'draft-r1',
            kind: 'regenerated',
            version: 2,
            createdAt: '2026-11-12T00:00:00.000Z',
            departments: [{ id: 'd-sales', name: '営業部', projects: [{ id: 'p-1', title: '既存顧客の再受注施策' }] }],
          },
        ],
        analysis: null,
        dialogue: [],
        selections: [],
        confirmed: null,
      },
    });
    const res = await analyze(req('analyze', { companyId: C1, strategyId: S1, draft: { draftId: 'draft-r1', version: 1 } }));
    expect(res.status).toBe(409);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('AIの出力が読めない場合は内部情報を返さず502', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'not json' } }] });
    const res = await analyze(req('analyze', { companyId: C1, strategyId: S1 }));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toMatch(/SyntaxError|not json/);
  });
});

describe('POST /api/stage3/adjustment/regenerate', () => {
  const candidate = {
    id: 'adj-1',
    kind: 'duplicate',
    title: '既存顧客への重複施策',
    summary: '営業とマーケが同じ既存顧客を対象にしている。',
    departments: [
      { departmentKey: 'id:d-sales', name: '営業部' },
      { departmentKey: 'id:d-mkt', name: 'マーケティング部' },
    ],
    planRefs: [
      { departmentKey: 'id:d-sales', projectId: 'id:p-1', departmentName: '営業部', projectTitle: '既存顧客の再受注施策' },
      { departmentKey: 'id:d-mkt', projectId: 'id:p-2', departmentName: 'マーケティング部', projectTitle: '既存顧客向けセミナー' },
    ],
    dialogueTopics: ['既存顧客の担当をどちらが持つか'],
  };

  it('保存済みにない計画を含む候補は受け付けない', async () => {
    const forged = { ...candidate, planRefs: [{ ...candidate.planRefs[0], projectId: 'id:p-forged' }] };
    const res = await regenerate(
      req('regenerate', { companyId: C1, strategyId: S1, candidates: [forged], dialogue: [] }),
    );
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('対話結果を反映した変更案を部門IDつきで返す。採用は利用者が選ぶため、書き込みはしない', async () => {
    mockCreate.mockResolvedValueOnce(
      llmReply({
        departments: [
          {
            departmentKey: 'id:d-sales',
            generated: { interDeptCollab: ['既存顧客はマーケ部がリストを渡し、営業部が担当する'] },
          },
          { departmentKey: 'id:d-none', generated: { riskNotes: ['存在しない部門'] } },
        ],
      }),
    );
    const res = await regenerate(
      req('regenerate', {
        companyId: C1,
        strategyId: S1,
        candidates: [candidate],
        dialogue: [{ candidateId: 'adj-1', topic: candidate.dialogueTopics[0], result: '営業が担当する' }],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revision).toBe(7);
    expect(body.departments).toHaveLength(1);
    expect(body.departments[0]).toMatchObject({ departmentKey: 'id:d-sales', departmentName: '営業部' });
    expect(body.departments[0].proposals[0].item).toBe('collab');
    expect(body.rejectedDepartments).toBe(1);
    expect(writes).toEqual([]);

    const sent = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(sent).toContain('話し合いの結果：営業が担当する');
  });

  it('対話結果が無い、または話題が候補と合わない場合はAIを呼ばない', async () => {
    const res = await regenerate(
      req('regenerate', {
        companyId: C1,
        strategyId: S1,
        candidates: [candidate],
        dialogue: [{ candidateId: 'adj-1', topic: '別の話題', result: 'x' }],
      }),
    );
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
