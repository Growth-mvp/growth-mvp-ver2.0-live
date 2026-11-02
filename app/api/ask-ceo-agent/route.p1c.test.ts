import { NextRequest } from 'next/server';

const mockChatCreate = jest.fn();
const mockClassifyHeuristic = jest.fn();

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
  classifyHeuristic: (...args: unknown[]) => mockClassifyHeuristic(...args),
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
import { MOCK_COMPANY_ROW, MOCK_EMPTY_ROW } from '../../../eval/p1b/mockCompany';

const COMPANY_B = 'company-b';
const BRIDGE = {
  keyThemes: ['保守の標準化を全社の重点にする'],
  departmentIssues: ['保守技術者の育成が部門をまたぐ課題'],
  kpiCriteria: ['見直すべき事業：部品販売の縮小'],
  commonBehaviorChanges: ['点検記録を当日中に共有する'],
  strategicCore: { primaryShift: '属人的な点検から標準化された点検へ転換する' },
  departmentTranslationRules: ['点検部門は標準手順を運用する'],
  generatedAt: '2026-10-01T10:00:00.000Z',
};
const ROW_WITH_BRIDGE = { ...MOCK_COMPANY_ROW, stage3_strategy_bridge: BRIDGE };
import { POST } from './route';

const USER = 'user-1';
const STRATEGY_OF_A = 'strategy-a';
const COMPANY_A = 'company-a';

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

function req(query: string, screenId: string | null = null) {
  return new NextRequest('http://localhost/api/ask-ceo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify({
      userId: USER,
      strategyId: STRATEGY_OF_A,
      companyId: COMPANY_A,
      messages: [{ role: 'user', content: query }],
      ...(screenId ? { screen: { screenId } } : {}),
    }),
  });
}

function systemPromptOf(): string {
  return mockChatCreate.mock.calls[0][0].messages[0].content;
}

async function ask(query: string, opts: { stage: 'strategy' | 'generic'; row?: Record<string, any>; screenId?: string | null }) {
  mockClassifyHeuristic.mockReturnValue({ stage: opts.stage, confidence: 0.9, reasons: [] });
  (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({ data: opts.row ?? MOCK_COMPANY_ROW, error: null });
  const res = await POST(req(query, opts.screenId ?? null));
  expect(res.status).toBe(200);
  return systemPromptOf();
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


describe('STAGE3 戦略展開ブリッジの接続（P1-C 第一段階）', () => {
  it('部門への落とし込みの質問では、橋渡しの許可項目を入れ、AI生成・保存済みと明示する', async () => {
    const p = await ask('全社の戦略は部門にどう落とし込まれている？', { stage: 'strategy', row: ROW_WITH_BRIDGE });
    expect(p).toContain('【STAGE3 戦略展開ブリッジ（AI生成・保存済みの内容）】');
    expect(p).toContain('属人的な点検から標準化された点検へ転換する');
    expect(p).toContain('経営者が承認・採用した記録ではありません');
    expect(p).not.toContain('見直すべき事業');
  });

  it('戦略の理由の質問（P1-B の Q1）では、橋渡しを入れない', async () => {
    const p = await ask('わが社はなぜこの戦略を選んだの？', { stage: 'strategy', row: ROW_WITH_BRIDGE });
    expect(p).toContain('【戦略の根拠');
    expect(p).not.toContain('【STAGE3 戦略展開ブリッジ');
  });

  it('業績の質問（P1-B の Q6）では、橋渡しを入れない', async () => {
    const p = await ask('わが社のROICはどうなの？', { stage: 'generic', row: ROW_WITH_BRIDGE });
    expect(p).toContain('【STAGE1 企業価値5指標');
    expect(p).not.toContain('【STAGE3 戦略展開ブリッジ');
  });

  it('操作の質問には、部門という語があっても橋渡しを入れない', async () => {
    const p = await ask('この画面で部門を登録するには？', { stage: 'generic', row: ROW_WITH_BRIDGE, screenId: 'stage2' });
    expect(p).toContain('【操作案内（登録簿に基づく）】');
    expect(p).not.toContain('【STAGE3 戦略展開ブリッジ');
  });

  it('無関係な質問には、橋渡しを入れない', async () => {
    const p = await ask('今日の天気は？', { stage: 'generic', row: ROW_WITH_BRIDGE });
    expect(p).toContain('【情報の選択】');
    expect(p).not.toContain('【STAGE3 戦略展開ブリッジ');
  });

  it('橋渡しが未登録の企業では、登録なしと示し、内容を作らせない', async () => {
    const p = await ask('全社の戦略は部門にどう落とし込まれている？', { stage: 'strategy', row: MOCK_EMPTY_ROW });
    expect(p).toContain('STAGE3の戦略展開ブリッジは登録されていません');
    expect(p).toContain('推測で補わない');
  });

  it('会社が一致しない要求は遮断され、橋渡し情報を含むプロンプトは送られない', async () => {
    mockClassifyHeuristic.mockReturnValue({ stage: 'strategy', confidence: 0.9, reasons: [] });
    (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({ data: ROW_WITH_BRIDGE, error: null });
    const res = await POST(
      new NextRequest('http://localhost/api/ask-ceo-agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
        body: JSON.stringify({
          userId: USER,
          strategyId: STRATEGY_OF_A,
          companyId: COMPANY_B,
          messages: [{ role: 'user', content: '全社の戦略は部門にどう落とし込まれている？' }],
        }),
      })
    );
    expect(res.status).toBe(403);
    expect(mockChatCreate).not.toHaveBeenCalled();
  });
});
