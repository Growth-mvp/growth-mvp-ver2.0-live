import { NextRequest } from 'next/server';

const mockChatCreate = jest.fn();
const mockClassifyLLM = jest.fn();

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
  return { ...actual, classifyLLM: (...args: unknown[]) => mockClassifyLLM(...args) };
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
import { POST } from './route';

type Row = Record<string, any>;

const USER = 'user-1';
const STRATEGY_OF_A = 'strategy-a';
const COMPANY_A = 'company-a';
const TARGET_BLOCK = '【STAGE2 業績目標';

const EMPTY_ADMIN = {
  from() {
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve, reject),
    };
    return builder;
  },
};

const TARGETS = [
  { id: 't1', label: '売上高', unit: '百万円', base: 12000, dueYear: 2030, prioritySimple: 'primary', linkedIssueIds: [], rationale: '' },
  { id: 't2', label: '営業利益', unit: '百万円', base: 50, dueYear: 2030, prioritySimple: 'primary', linkedIssueIds: [], rationale: '' },
  { id: 't3', label: '顧客満足度', unit: '%', base: 85, dueYear: 2030, prioritySimple: 'secondary', linkedIssueIds: [], rationale: '' },
];

function strategyRow(overrides: Row = {}): Row {
  return {
    id: STRATEGY_OF_A,
    companyName: 'モック株式会社',
    departments: [{ id: 'd1', name: '営業部', mission: '新規', projects: [{ id: 'p1', title: '新規顧客開拓', okrsV2: [] }] }],
    answers2: [],
    financePL: [
      { year: 2024, revenue: 900_000_000, operatingIncome: 80_000_000 },
      { year: 2025, revenue: 1_000_000_000, operatingIncome: 100_000_000 },
    ],
    financeBS: [{ year: 2025, cash: 300_000_000 }],
    fiscalYearEnd: '3',
    simulationResults: [],
    companyTargets: TARGETS,
    ...overrides,
  };
}

function req(query: string, auth = 'Bearer t') {
  return new NextRequest('http://localhost/api/ask-ceo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify({
      userId: USER,
      strategyId: STRATEGY_OF_A,
      companyId: COMPANY_A,
      messages: [{ role: 'user', content: query }],
    }),
  });
}

async function ask(query: string, row: Row = strategyRow()): Promise<string> {
  mockClassifyLLM.mockResolvedValue({ stage: 'strategy', confidence: 0.9, reasons: [] });
  (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({ data: row, error: null });
  const res = await POST(req(query));
  expect(res.status).toBe(200);
  return mockChatCreate.mock.calls[0][0].messages[0].content as string;
}

beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key';
});

beforeEach(() => {
  jest.resetAllMocks();
  (getSupabaseAdmin as jest.Mock).mockReturnValue(EMPTY_ADMIN);
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
  (resolveCompanyIdFromStrategyId as jest.Mock).mockResolvedValue(COMPANY_A);
  (requireMembership as jest.Mock).mockResolvedValue({ userId: USER, companyId: COMPANY_A, role: 'admin', departmentId: null });
  mockChatCreate.mockResolvedValue({ choices: [{ message: { content: 'OK' } }] });
});

function companionReq(meta: unknown) {
  return new NextRequest('http://localhost/api/ask-ceo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify({
      userId: USER,
      strategyId: STRATEGY_OF_A,
      companyId: COMPANY_A,
      messages: [{ role: 'user', content: '（自律伴走の助言）テスト' }],
      meta,
    }),
  });
}

async function askWithMeta(meta: unknown): Promise<string> {
  mockClassifyLLM.mockResolvedValue({ stage: 'strategy', confidence: 0.9, reasons: [] });
  (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({ data: strategyRow(), error: null });
  const res = await POST(companionReq(meta));
  expect(res.status).toBe(200);
  return mockChatCreate.mock.calls[0][0].messages[0].content as string;
}

describe('自律伴走の助言：サーバーの規則は、節目の指定があるときだけ適用される', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (getSupabaseAdmin as jest.Mock).mockReturnValue(EMPTY_ADMIN);
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
    (requireMembership as jest.Mock).mockResolvedValue({ companyId: COMPANY_A, role: 'admin' });
    (resolveCompanyIdFromStrategyId as jest.Mock).mockResolvedValue(COMPANY_A);
    mockChatCreate.mockResolvedValue({ choices: [{ message: { content: '助言' } }] });
  });

  it('節目（確定）が指定されたら、根拠・未登録・判断の規則を追加する', async () => {
    const system = await askWithMeta({ mode: 'facilitator', output: 'text', companion: { milestone: 'CONFIRM' } });
    expect(system).toContain('【自律伴走の助言の規則】');
    expect(system).toContain('経営戦略が確定されました');
    expect(system).toContain('判断は利用者に委ね');
  });

  it('節目の指定が無い通常の質問には、規則を追加しない', async () => {
    const system = await askWithMeta({ mode: 'facilitator', output: 'text' });
    expect(system).not.toContain('【自律伴走の助言の規則】');
  });

  it('知らない節目の値は受け付けない（規則を追加しない）', async () => {
    const system = await askWithMeta({ mode: 'facilitator', output: 'text', companion: { milestone: 'OTHER' } });
    expect(system).not.toContain('【自律伴走の助言の規則】');
  });
});
