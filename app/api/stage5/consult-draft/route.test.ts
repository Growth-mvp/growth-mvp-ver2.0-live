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
const QUESTION = '最近、朝の配達が間に合わなくて焦っています。人手も足りないし、正直、このままでいいのか不安です。';
const ANSWER = '配達順の組み方とルートの長さを確認してください。';
const SENT_0 = '最近、朝の配達が間に合わなくて焦っています。';

function request(body: unknown, token: string | null = 'token') {
  return new Request('http://localhost/api/stage5/consult-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

const validBody = { ...IDS, question: QUESTION, answer: ANSWER };

function modelReturns(content: string) {
  mockCreate.mockResolvedValue({ choices: [{ message: { content } }] });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUserId.mockResolvedValue('u1');
  mockRequireMembership.mockResolvedValue({ companyId: 'c1', role: 'member' });
  mockAssertScope.mockResolvedValue('c1');
  mockLoadScope.mockResolvedValue({ ok: true, projectTitle: '配送の効率化', promptBlock: '【プロジェクト】配送の効率化' });
  modelReturns(JSON.stringify({ ownSentenceIndexes: [0], plannedSentenceIndexes: [], insights: [] }));
});

describe('STAGE5 社内共有の入力案の作成API', () => {
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

  it('本人の困りごとは、相談文の原文のまま入力案に入る', async () => {
    const res = await POST(request(validBody));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { draft: { ownWords: string[] }; text: string };
    expect(json.draft.ownWords).toEqual([SENT_0]);
    expect(json.text).toBe(`【私が困っていること】\n${SENT_0}`);
  });

  it('AIが文を書き換えて返しても、入力案に入るのは番号で選ばれた原文だけ', async () => {
    modelReturns(JSON.stringify({ ownSentenceIndexes: [0], plannedSentenceIndexes: [], insights: [], ownWords: ['配送業務の効率化が必要'] }));
    const res = await POST(request(validBody));
    const json = (await res.json()) as { text: string };
    expect(json.text).toContain(SENT_0);
    expect(json.text).not.toContain('配送業務の効率化');
  });

  it('このプロジェクトに関係する本人の言葉がなければ、入力案を作らず、その理由を返す', async () => {
    modelReturns(JSON.stringify({ ownSentenceIndexes: [], plannedSentenceIndexes: [], insights: [] }));
    const res = await POST(request(validBody));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe('no_relevant_sentences');
  });

  it('相談文から文が取れなければ（句点や記号だけなど）AIを呼ばずに拒否する', async () => {
    const res = await POST(request({ ...validBody, question: '。。' }));
    expect(res.status).toBe(422);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('AIの応答が形式に合わなければ、入力案を作らずに失敗を返す', async () => {
    modelReturns('not json');
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

  it('AIへの指示は、文を書き換えないことと、本人の悩みを一律に除外しないことを含む。相談文は番号付きの材料として渡す', async () => {
    await POST(request(validBody));
    const sent = (mockCreate.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages;
    expect(sent[0].content).toContain('書き換えない');
    expect(sent[0].content).toContain('他の人の個人情報');
    expect(sent[0].content).toContain('不安・焦り・不満・違和感');
    expect(sent[0].content).toContain('本人の本音を省かない');
    expect(sent[0].content).not.toContain('個人的な悩み');
    expect(sent[1].content).toContain(`[0] ${SENT_0}`);
    expect(sent[1].content).toContain(`[1] 人手も足りないし、正直、このままでいいのか不安です。`);
  });
});
