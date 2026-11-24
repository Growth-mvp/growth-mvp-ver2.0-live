export {};
/* STAGE5 入力案の作成API。認証・所属・戦略と会社の照合・案件の整合は本物の処理を使い、DB・AI・監査だけを差し替える。 */
jest.mock('server-only', () => ({}));

const mockGetUserId = jest.fn<Promise<string | null>, unknown[]>();
const mockRequireMembership = jest.fn<Promise<{ companyId: string; role: string } | null>, unknown[]>();
const mockAssertScope = jest.fn<Promise<string>, unknown[]>();
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: (...a: unknown[]) => mockGetUserId(...a),
  requireMembership: (...a: unknown[]) => mockRequireMembership(...a),
  assertCompanyScopeByStrategyId: (...a: unknown[]) => mockAssertScope(...a),
}));

const mockLoadScope = jest.fn<Promise<unknown>, unknown[]>();
jest.mock('@/lib/ceoChat/executionScope', () => ({
  ...jest.requireActual('@/lib/ceoChat/executionScope'),
  loadExecutionScope: (...a: unknown[]) => mockLoadScope(...a),
}));

const mockCreate = jest.fn<Promise<unknown>, unknown[]>();
jest.mock('@/lib/openai', () => ({
  openai: { chat: { completions: { create: (...a: unknown[]) => mockCreate(...a) } } },
}));

jest.mock('@/lib/modelConfig', () => ({
  AI_MODELS: { lightweight: 'test-model' },
  MODEL_CONFIGURATIONS: { stage5ConsultDraft: { maxCompletionTokens: 1000 } },
}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => ({}) }));

const mockAudit = jest.fn<Promise<boolean>, unknown[]>(async () => true);
jest.mock('@/lib/server/auditLog', () => ({
  logAuditEvent: (...a: unknown[]) => mockAudit(...a),
}));

import { POST } from './route';

const IDS = { companyId: 'c1', strategyId: 's1', departmentId: 'd1', projectId: 'p1' };
const QUESTION = '配達の遅れが続いています。何から見直せばよいですか。';
const ANSWER = '配達順の組み方とルートの長さを確認してください。';

function request(body: unknown, token: string | null = 'token') {
  return new Request('http://localhost/api/stage5/consult-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

const validBody = { ...IDS, question: QUESTION, answer: ANSWER };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUserId.mockResolvedValue('u1');
  mockRequireMembership.mockResolvedValue({ companyId: 'c1', role: 'member' });
  mockAssertScope.mockResolvedValue('c1');
  mockLoadScope.mockResolvedValue({ ok: true, projectTitle: '配送の効率化', promptBlock: '【プロジェクト】配送の効率化' });
  mockCreate.mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            issues: ['配達の遅れが続いている'],
            examined: ['配達順とルートの長さを確認する'],
            nextActions: ['配達順を週次で確認する'],
          }),
        },
      },
    ],
  });
});

describe('STAGE5 入力案の作成API', () => {
  it('ログインしていなければ拒否し、AIを呼ばない', async () => {
    mockGetUserId.mockResolvedValue(null);
    const res = await POST(request(validBody, null));
    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('入力が不正なら拒否する', async () => {
    const res = await POST(request({ ...validBody, question: '' }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('会社の所属がなければ拒否する', async () => {
    mockRequireMembership.mockResolvedValue(null);
    const res = await POST(request(validBody));
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('戦略が会社に属さなければ拒否する', async () => {
    mockAssertScope.mockRejectedValue(new Error('forbidden'));
    const res = await POST(request(validBody));
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('案件が戦略に含まれなければ拒否する', async () => {
    mockLoadScope.mockResolvedValue({ ok: false, status: 403, error: 'project is not part of this strategy' });
    const res = await POST(request(validBody));
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('相談から入力案（課題・検討したこと・次の行動）を作り、文章として返す', async () => {
    const res = await POST(request(validBody));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { draft: { issues: string[] }; text: string };
    expect(json.draft.issues).toEqual(['配達の遅れが続いている']);
    expect(json.text).toContain('【次の行動（未実施）】');
  });

  it('AIの応答が形式に合わなければ、入力案を作らずに失敗を返す', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'not json' } }] });
    const res = await POST(request(validBody));
    expect(res.status).toBe(502);
  });

  it('監査記録には相談文も回答文も入れない', async () => {
    await POST(request(validBody));
    expect(mockAudit).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(mockAudit.mock.calls[0]);
    expect(logged).not.toContain(QUESTION);
    expect(logged).not.toContain(ANSWER);
    expect(logged).toContain('STAGE5_CONSULT_DRAFT_CREATED');
  });

  it('AIへの指示は、未実施の行動や個人の悩みを書かないことを含み、相談文は材料として渡す', async () => {
    await POST(request(validBody));
    const sent = (mockCreate.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages;
    expect(sent[0].content).toContain('「実施した」「対応した」とは書かない');
    expect(sent[0].content).toContain('個人的な悩み');
    expect(sent[1].content).toContain(QUESTION);
  });
});
