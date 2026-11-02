import { NextRequest } from 'next/server';

const mockChatCreate = jest.fn();

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
jest.mock('@/lib/intentRouter', () => ({
  classifyHeuristic: () => ({ stage: 'strategy', confidence: 0.9, reasons: [] }),
  classifyLLM: jest.fn(async () => {
    throw new Error('LLM 分類は無効');
  }),
  chooseBetter: (a: unknown) => a,
}));
jest.mock('@/lib/facilitatorProtocol', () => ({ buildFacilitatorBlock: () => '' }));
jest.mock('@/lib/facilitatorSchema', () => ({
  buildJSONOutputInstruction: () => '',
  safeParseFacilitatorJSON: () => null,
}));
jest.mock('@/utils/insights/stage1Insight', () => ({ buildStage1Insight: () => ({}) }));
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
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import {
  getAuthUserIdFromBearer,
  requireMembership,
  resolveCompanyIdFromStrategyId,
} from '@/lib/server/rbacGuard';
import { POST } from './route';

const USER = 'user-1';
const STRATEGY_OF_A = 'strategy-a';
const COMPANY_A = 'company-a';
const NO_DATA = 'データなし（算出に必要な登録データが不足）';

const FINANCE_PL = [
  { year: 2021, revenue: 1_000_000_000, operatingIncome: 50_000_000 },
  { year: 2022, revenue: 1_100_000_000, operatingIncome: 66_000_000 },
  { year: 2023, revenue: 1_210_000_000, operatingIncome: 84_700_000 },
  { year: 2024, revenue: 1_331_000_000, operatingIncome: 106_480_000 },
];
const FINANCE_BS = [{ year: 2024, netAssets: 500_000_000, interestBearingDebt: 200_000_000 }];

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

function req(body: unknown) {
  return new NextRequest('http://localhost/api/ask-ceo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify(body),
  });
}

function bodyFor(query: string) {
  return {
    userId: USER,
    strategyId: STRATEGY_OF_A,
    companyId: COMPANY_A,
    messages: [{ role: 'user', content: query }],
  };
}

function systemContent(): string {
  return mockChatCreate.mock.calls[0][0].messages[0].content;
}

function valueBlock(content: string): string {
  return content.slice(content.indexOf('【STAGE1 企業価値5指標'));
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

describe('CEO チャットの STAGE1 5指標（認可済みの同一企業データから算出）', () => {
  it('登録済みの財務データから 5 指標を算出し、対象年度と単位を付けて渡す', async () => {
    (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({
      data: {
        id: STRATEGY_OF_A,
        departments: [],
        answers2: [],
        finalStory: [],
        financePL: FINANCE_PL,
        financeBS: FINANCE_BS,
        pbrManual: '1.5',
        stage1Benchmarks: { waccManual: 8 },
      },
      error: null,
    });

    const res = await POST(req(bodyFor('今期の業績をどう見ればいい？')));
    expect(res.status).toBe(200);

    const block = valueBlock(systemContent());
    expect(block).toContain('対象年度: 2021年〜2024年');
    expect(block).toContain('① 売上成長率（CAGR・年率）: 10.0%（2021→2024年）');
    expect(block).toContain('② 営業利益率（最新年）: 8.0%');
    expect(block).toContain('③ ROIC（NOPAT÷投下資本）: 10.6%');
    expect(block).toContain('④ WACC（登録値）: 8.0%');
    expect(block).toContain('⑤ PBR（手入力値）: 1.50倍');
  });

  it('同じ企業（strategyId と companyId）で取得し、他社のデータは参照しない', async () => {
    (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({
      data: { id: STRATEGY_OF_A, departments: [], answers2: [], finalStory: [] },
      error: null,
    });

    await POST(req(bodyFor('業績は？')));

    expect(getFullStrategyDataByStrategyId).toHaveBeenCalledWith(STRATEGY_OF_A, COMPANY_A, expect.anything());
  });

  it('財務データがない企業では、5 指標をすべて「データなし」にし、数値を作らない', async () => {
    (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({
      data: { id: STRATEGY_OF_A, departments: [], answers2: [], finalStory: [] },
      error: null,
    });

    await POST(req(bodyFor('業績は？')));

    const block = valueBlock(systemContent());
    expect(block.split(NO_DATA).length - 1).toBe(5);
    expect(block).not.toMatch(/\d+(\.\d+)?%/);
  });
});
