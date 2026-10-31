import { NextRequest } from 'next/server';

jest.mock('@/lib/openai', () => ({
  openai: {
    chat: { completions: { create: (...args: unknown[]) => mockChatCreate(...args) } },
  },
}));
const mockChatCreate = jest.fn();

jest.mock('@/utils/supabase/strategy', () => ({
  getFullStrategyDataByStrategyId: jest.fn(),
}));
jest.mock('@/utils/supabase/normalize', () => ({
  normalizeStrategyData: (x: unknown) => x,
}));
jest.mock('@/lib/inputGuardLogger', () => ({
  checkSuspiciousKeywords: () => ({}),
  logInputGuard: jest.fn(),
}));
jest.mock('@/lib/agentPrompt', () => ({
  __esModule: true,
  default: jest.fn(() => 'AGENT_PROMPT'),
  buildExternalFinancialBlock: jest.fn(() => ''),
}));
jest.mock('@/lib/supabase/agentLogs', () => ({
  insertAgentLog: jest.fn(async () => undefined),
}));
jest.mock('@/lib/intentRouter', () => ({
  classifyHeuristic: () => ({ stage: 'strategy', confidence: 0.9, reasons: [] }),
  classifyLLM: jest.fn(),
  chooseBetter: (a: unknown) => a,
}));
jest.mock('@/lib/facilitatorProtocol', () => ({ buildFacilitatorBlock: () => '' }));
jest.mock('@/lib/facilitatorSchema', () => ({
  buildJSONOutputInstruction: () => '',
  safeParseFacilitatorJSON: () => null,
}));
jest.mock('@/utils/insights/stage1Insight', () => ({ buildStage1Insight: () => '' }));
jest.mock('@/lib/autoModeRouter', () => ({ detectAutoMode: () => ({ mode: 'advisor', reasons: [] }) }));
jest.mock('@/lib/helpPrompt', () => ({ buildHelpSystemPrompt: () => '' }));
jest.mock('@/lib/growthKnowledge', () => ({ pickRelevantKnowledge: () => [] }));
jest.mock('@/lib/externalFinancialSearch', () => ({ searchExternalFinancialData: jest.fn() }));
jest.mock('@/lib/rag/indexer', () => ({
  getGrowthRagIndex: () => ({ docs: [], chunks: [], loadedAt: 0 }),
}));
jest.mock('@/lib/rag/retriever', () => ({ retrieveGrowthKnowledge: () => ({ hits: [] }) }));
jest.mock('@/lib/rag/prompt', () => ({
  buildRagContextBlock: () => '',
  buildRagDebugFooter: () => '',
}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(),
  requireMembership: jest.fn(),
  resolveCompanyIdFromStrategyId: jest.fn(),
}));

import { getFullStrategyDataByStrategyId } from '@/utils/supabase/strategy';
import { insertAgentLog } from '@/lib/supabase/agentLogs';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import {
  getAuthUserIdFromBearer,
  requireMembership,
  resolveCompanyIdFromStrategyId,
} from '@/lib/server/rbacGuard';
import { POST } from './route';

const USER = 'user-1';
const STRATEGY = 'strategy-1';
const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';
const ANSWER_TEXT = 'ANSWER-CONFIDENTIAL-8831';

function chain(result: unknown): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === 'then'
          ? (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(result).then(resolve, reject)
          : () => proxy,
    }
  );
  return proxy;
}

const adminFake = { from: () => chain({ data: [], error: null }) };

function req(body: unknown, auth = true) {
  return new NextRequest('http://localhost/api/ask-ceo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer t' } : {}) },
    body: JSON.stringify(body),
  });
}

const validBody = {
  userId: USER,
  strategyId: STRATEGY,
  messages: [{ role: 'user', content: '事業の課題を教えてください' }],
};

beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key';
});

beforeEach(() => {
  jest.resetAllMocks();
  (getSupabaseAdmin as jest.Mock).mockReturnValue(adminFake);
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
  (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({
    data: { id: STRATEGY, departments: [], answers2: [], finalStory: [] },
    error: null,
  });
  mockChatCreate.mockResolvedValue({ choices: [{ message: { content: ANSWER_TEXT } }] });
});

describe('POST /api/ask-ceo-agent 会社スコープ', () => {
  it('認証が無ければ 401', async () => {
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(null);
    const res = await POST(req(validBody, false));
    expect(res.status).toBe(401);
  });

  it('本人以外の userId は 403', async () => {
    const res = await POST(req({ ...validBody, userId: 'someone-else' }));
    expect(res.status).toBe(403);
    expect(getFullStrategyDataByStrategyId).not.toHaveBeenCalled();
  });

  it('他社の strategy は 500 ではなく 403 を返し、データを読まない', async () => {
    (resolveCompanyIdFromStrategyId as jest.Mock).mockResolvedValue(COMPANY_B);
    (requireMembership as jest.Mock).mockResolvedValue(null);

    const res = await POST(req(validBody));

    expect(res.status).toBe(403);
    expect(requireMembership).toHaveBeenCalledWith(adminFake, USER, COMPANY_B);
    expect(getFullStrategyDataByStrategyId).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it('存在しない strategy も 403（他社と区別できない応答にする）', async () => {
    (resolveCompanyIdFromStrategyId as jest.Mock).mockResolvedValue(null);

    const res = await POST(req(validBody));

    expect(res.status).toBe(403);
    expect(requireMembership).not.toHaveBeenCalled();
    expect(getFullStrategyDataByStrategyId).not.toHaveBeenCalled();
  });

  it('複数会社に所属し、strategy の会社に所属していれば許可される（所属会社の取り違えをしない）', async () => {
    (resolveCompanyIdFromStrategyId as jest.Mock).mockResolvedValue(COMPANY_B);
    (requireMembership as jest.Mock).mockImplementation(async (_admin, _user, companyId) =>
      companyId === COMPANY_B ? { userId: USER, companyId: COMPANY_B, role: 'member', departmentId: null } : null
    );

    const res = await POST(req(validBody));

    expect(res.status).toBe(200);
    expect(getFullStrategyDataByStrategyId).toHaveBeenCalledWith(STRATEGY, COMPANY_B, adminFake);
  });
});

describe('POST /api/ask-ceo-agent 監査ログ', () => {
  beforeEach(() => {
    (resolveCompanyIdFromStrategyId as jest.Mock).mockResolvedValue(COMPANY_A);
    (requireMembership as jest.Mock).mockResolvedValue({
      userId: USER,
      companyId: COMPANY_A,
      role: 'member',
      departmentId: null,
    });
  });

  it('回答本文は agent_logs に保存せず、識別子と文字数のみ保存する', async () => {
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);

    expect(insertAgentLog).toHaveBeenCalledTimes(1);
    const logged = (insertAgentLog as jest.Mock).mock.calls[0][0];
    expect(logged).toMatchObject({ userId: USER, strategyId: STRATEGY, role: 'assistant' });
    expect(logged.content).not.toContain(ANSWER_TEXT);
    expect(logged.content).toMatch(/^requestId=\S+ chars=\d+$/);
  });

  it('ログ保存に失敗しても回答は返す', async () => {
    (insertAgentLog as jest.Mock).mockRejectedValueOnce(new Error('ログ保存に失敗しました'));
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe(ANSWER_TEXT);
  });
});
