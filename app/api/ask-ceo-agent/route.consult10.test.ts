import { NextRequest } from 'next/server';

const mockChatCreate = jest.fn();
const mockClassifyLLM = jest.fn();
const mockClassifyHeuristicOverride = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: class {
    chat = { completions: { create: (...args: unknown[]) => mockChatCreate(...args) } };
    constructor(_opts: unknown) {}
  },
}));
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
jest.mock('@/lib/supabase/agentLogs', () => ({
  insertAgentLog: jest.fn(async () => undefined),
}));
jest.mock('@/lib/intentRouter', () => {
  const actual = jest.requireActual('@/lib/intentRouter');
  return {
    ...actual,
    classifyHeuristic: (...args: unknown[]) =>
      mockClassifyHeuristicOverride(...args) ?? actual.classifyHeuristic(...args),
    classifyLLM: (...args: unknown[]) => mockClassifyLLM(...args),
  };
});
jest.mock('@/lib/facilitatorProtocol', () => ({ buildFacilitatorBlock: () => '' }));
jest.mock('@/lib/facilitatorSchema', () => ({
  buildJSONOutputInstruction: () => '',
  safeParseFacilitatorJSON: () => null,
}));
jest.mock('@/utils/insights/stage1Insight', () => ({ buildStage1Insight: () => ({}) }));
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
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import {
  getAuthUserIdFromBearer,
  requireMembership,
  resolveCompanyIdFromStrategyId,
} from '@/lib/server/rbacGuard';
import { MOCK_COMPANY_ROW } from '../../../eval/p1b/mockCompany';
import { POST } from './route';

const USER = 'user-1';
const STRATEGY_OF_A = 'strategy-a';
const COMPANY_A = 'company-a';

const OKR_MARKER = '# 部門・OKR・実行計画';
const STORY_MARKER = '【戦略ストーリー要約】';
const RATIONALE_MARKER = '【戦略の根拠';
const BRIDGE_MARKER = '【STAGE3 戦略展開ブリッジ】';
const GENERAL_MARKER = 'あなたは博識なアシスタント';

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

function req(query: string) {
  return new NextRequest('http://localhost/api/ask-ceo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify({
      userId: USER,
      strategyId: STRATEGY_OF_A,
      companyId: COMPANY_A,
      messages: [{ role: 'user', content: query }],
    }),
  });
}

async function ask(query: string, intentStage: 'strategy' | 'generic') {
  mockClassifyHeuristicOverride.mockReturnValue(
    intentStage === 'generic' ? { stage: 'generic', confidence: 0.4, reasons: ['no-keywords'] } : undefined
  );
  mockClassifyLLM.mockResolvedValue({ stage: intentStage, confidence: 0.9, reasons: [] });
  (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({ data: MOCK_COMPANY_ROW, error: null });
  const res = await POST(req(query));
  expect(res.status).toBe(200);
  const body = await res.json();
  const systemPrompt: string = mockChatCreate.mock.calls[0][0].messages[0].content;
  return { mode: body.resolvedMode as string, systemPrompt };
}

beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key';
});

beforeEach(() => {
  jest.resetAllMocks();
  (getSupabaseAdmin as jest.Mock).mockReturnValue(adminFake);
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
  (resolveCompanyIdFromStrategyId as jest.Mock).mockResolvedValue(COMPANY_A);
  (requireMembership as jest.Mock).mockResolvedValue({ userId: USER, companyId: COMPANY_A, role: 'admin', departmentId: null });
  mockChatCreate.mockResolvedValue({ choices: [{ message: { content: 'OK' } }] });
});

const CONSULT_CASES: Array<{ q: string; rationale: boolean; alignment: boolean }> = [
  { q: 'なぜ当社の利益は伸びないのか？', rationale: true, alignment: false },
  { q: '今の経営戦略で3年後に成長できるか？', rationale: true, alignment: false },
  { q: '新規事業に参入すべきか？', rationale: true, alignment: false },
  { q: '営業部門の活動は全社戦略と整合しているか？', rationale: true, alignment: true },
  { q: '営業部と製造部の対立をどう解消すべきか？', rationale: true, alignment: true },
  { q: '人材採用と設備投資のどちらを優先すべきか？', rationale: true, alignment: false },
  { q: '資金繰りが厳しくなったらどうすべきか？', rationale: false, alignment: false },
  { q: 'この事業から撤退すべきか？', rationale: true, alignment: false },
  { q: '来月から何を変えれば業績が改善するか？', rationale: false, alignment: false },
  { q: '社長が今、最も優先すべきことは何か？', rationale: true, alignment: false },
];

const EXTRA_CONSULT_CASES: Array<{ q: string; rationale: boolean; alignment: boolean }> = [
  { q: 'わが社の業績が伸びない原因は？', rationale: true, alignment: false },
  { q: 'STAGE3の部門の役割は全社戦略と整合しているか？', rationale: true, alignment: true },
  { q: '社長が一番重視していることは何？', rationale: true, alignment: false },
];

describe.each(['strategy', 'generic'] as const)('意図判定が %s と返すとき', (intentStage) => {
  it.each([...CONSULT_CASES, ...EXTRA_CONSULT_CASES])(
    '経営相談は advisor で、企業データが届く: $q',
    async ({ q, rationale, alignment }) => {
      const { mode, systemPrompt } = await ask(q, intentStage);
      expect(mode).toBe('advisor');
      expect(systemPrompt).toContain(OKR_MARKER);
      expect(systemPrompt).toContain(STORY_MARKER);
      expect(systemPrompt.includes(RATIONALE_MARKER)).toBe(rationale);
      expect(systemPrompt.includes(BRIDGE_MARKER)).toBe(alignment);
      expect(systemPrompt).not.toContain(GENERAL_MARKER);
    }
  );
});

describe('操作案内・製品説明は help で、企業データを入れない', () => {
  it.each([
    'この画面では何をすればいい？',
    'そんなボタンが見当たらないけど？',
    'STAGE3の部門戦略を部門に反映するにはどうすればいい？',
    'GROWTH SHIFTとは何ですか？',
  ])('%s', async (q) => {
    const { mode, systemPrompt } = await ask(q, 'strategy');
    expect(mode).toBe('help');
    expect(systemPrompt).not.toContain(OKR_MARKER);
    expect(systemPrompt).not.toContain(STORY_MARKER);
  });
});

describe('一般的な経営知識は advisor だが、企業データは省く', () => {
  it('ROICとは何ですか？', async () => {
    const { mode, systemPrompt } = await ask('ROICとは何ですか？', 'generic');
    expect(mode).toBe('advisor');
    expect(systemPrompt).toContain(GENERAL_MARKER);
    expect(systemPrompt).not.toContain(OKR_MARKER);
  });
});
