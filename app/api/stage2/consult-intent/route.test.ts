export {};
/* STAGE2 経営者の思い（入力支援）API。認証・所属・管理者権限・戦略と会社の照合は本物の処理の流れで確認し、DB・AI・監査だけを差し替える。 */
jest.mock('server-only', () => ({}));

const mockGetUserId = jest.fn<Promise<string | null>, unknown[]>();
const mockRequireMembership = jest.fn<Promise<{ companyId: string; role: string } | null>, unknown[]>();
const mockAssertScope = jest.fn<Promise<string>, unknown[]>();
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: (...a: unknown[]) => mockGetUserId(...a),
  requireMembership: (...a: unknown[]) => mockRequireMembership(...a),
  assertCompanyScopeByStrategyId: (...a: unknown[]) => mockAssertScope(...a),
  assertMinRole: async (membership: { role: string }, min: 'admin' | 'manager' | 'member') => {
    const w: Record<string, number> = { member: 1, manager: 2, admin: 3 };
    if ((w[membership.role] ?? 0) < (w[min] ?? 0)) throw new Error('forbidden');
  },
}));

const mockCreate = jest.fn<Promise<unknown>, unknown[]>();
jest.mock('@/lib/openai', () => ({
  openai: { chat: { completions: { create: (...a: unknown[]) => mockCreate(...a) } } },
}));

jest.mock('@/lib/modelConfig', () => ({
  AI_MODELS: { lightweight: 'test-model' },
  MODEL_CONFIGURATIONS: { stage2ConsultIntent: { maxCompletionTokens: 1000 } },
}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => ({}) }));

const mockAudit = jest.fn<Promise<boolean>, unknown[]>(async () => true);
jest.mock('@/lib/server/auditLog', () => ({
  logAuditEvent: (...a: unknown[]) => mockAudit(...a),
}));

import { POST } from './route';

const IDS = { companyId: 'c1', strategyId: 's1' };
const QUESTION = '私はこの会社を、地域の人が頼れる存在にしたいと考えています。来期の売上目標は何にすべきでしょうか。';
const ANSWER = '売上目標は、既存顧客の継続率から考えると立てやすくなります。';
const OWN_0 = '私はこの会社を、地域の人が頼れる存在にしたいと考えています。';

function request(body: unknown, token: string | null = 'token') {
  return new Request('http://localhost/api/stage2/consult-intent', {
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
  mockRequireMembership.mockResolvedValue({ companyId: 'c1', role: 'admin' });
  mockAssertScope.mockResolvedValue('c1');
  modelReturns(JSON.stringify({ ownSentenceIndexes: [0] }));
});

describe('STAGE2 経営者の思い（入力支援）API', () => {
  it('ログインしていなければ拒否し、AIを呼ばない', async () => {
    mockGetUserId.mockResolvedValue(null);
    const res = await POST(request(validBody, null));
    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('管理者でなければ（STAGE2は管理者のみ編集）拒否し、AIを呼ばない', async () => {
    mockRequireMembership.mockResolvedValue({ companyId: 'c1', role: 'manager' });
    const res = await POST(request(validBody));
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('会社の所属がなければ拒否する', async () => {
    mockRequireMembership.mockResolvedValue(null);
    expect((await POST(request(validBody))).status).toBe(403);
  });

  it('戦略が会社に属さなければ拒否する', async () => {
    mockAssertScope.mockRejectedValue(new Error('forbidden'));
    expect((await POST(request(validBody))).status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('入力が不正なら拒否する', async () => {
    expect((await POST(request({ ...validBody, question: '' }))).status).toBe(400);
  });

  it('経営者本人の思いは、相談文の原文のまま返す', async () => {
    const res = await POST(request(validBody));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { text: string }).text).toBe(OWN_0);
  });

  it('AIが文を書き換えて返しても、返すのは番号で選ばれた原文だけ', async () => {
    modelReturns(JSON.stringify({ ownSentenceIndexes: [0], text: '地域に信頼される企業を目指す' }));
    const json = (await (await POST(request(validBody))).json()) as { text: string };
    expect(json.text).toBe(OWN_0);
    expect(json.text).not.toContain('信頼される企業');
  });

  it('思いに当たる文がなければ、作らずに理由を返す', async () => {
    modelReturns(JSON.stringify({ ownSentenceIndexes: [] }));
    const res = await POST(request(validBody));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe('no_relevant_sentences');
  });

  it('AIの応答が形式に合わなければ、失敗を返す', async () => {
    modelReturns('not json');
    expect((await POST(request(validBody))).status).toBe(502);
  });

  it('監査記録には相談文も回答文も入れない', async () => {
    await POST(request(validBody));
    expect(mockAudit).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(mockAudit.mock.calls[0]);
    expect(logged).not.toContain(QUESTION);
    expect(logged).not.toContain(ANSWER);
    expect(logged).toContain('STAGE2_CONSULT_INTENT_CREATED');
  });

  it('AIへの指示は、文を書き換えないことと、戦略の施策や数値を選ばないことを含む', async () => {
    await POST(request(validBody));
    const sent = (mockCreate.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages;
    expect(sent[0].content).toContain('書き換えない');
    expect(sent[0].content).toContain('経営戦略の施策、数値');
    expect(sent[1].content).toContain(`[0] ${OWN_0}`);
  });
});
