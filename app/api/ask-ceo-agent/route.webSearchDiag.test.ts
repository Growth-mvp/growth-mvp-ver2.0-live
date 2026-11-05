import { NextRequest } from 'next/server';

const mockChatCreate = jest.fn();
const mockResponsesCreate = jest.fn();
const mockClassifyLLM = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: class {
    chat = { completions: { create: (...args: unknown[]) => mockChatCreate(...args) } };
    responses = { create: (...args: unknown[]) => mockResponsesCreate(...args) };
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
const STRATEGY_ID = 'strategy-1';
const COMPANY_ID = 'company-1';
const COMPANY = '日本製罐株式会社';
const QUESTION = '金属缶市場の最新動向を教えてください';
const OWN_LINE = '日本製罐の2024年3月期の美術缶売上は前年を上回った。 ｜ 対象期間: 2024年3月期 ｜ 公表日: 2024-05-15 ｜ 種別: 年間統計';
const ALLOWED_URL = 'https://example.com/nippon-ir';
const INVENTED_URL = 'https://made-up.example.net/fabricated';
const ANSWER = `根拠: ${ALLOWED_URL}\n補足: ${INVENTED_URL}`;

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

function strategy(): Row {
  return {
    id: STRATEGY_ID,
    companyName: COMPANY,
    industry: 'manufacturing',
    businessContent: '美術缶を製造・販売',
    businessSegments: [],
    departments: [],
    answers2: [],
    financePL: [],
    financeBS: [],
    fiscalYearEnd: '3',
    simulationResults: [],
    companyTargets: [],
  };
}

function req(query: string) {
  return new NextRequest('http://localhost/api/ask-ceo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify({
      userId: USER,
      strategyId: STRATEGY_ID,
      companyId: COMPANY_ID,
      messages: [{ role: 'user', content: query }],
    }),
  });
}

function searchResponse() {
  return {
    output: [
      { type: 'web_search_call', id: 'ws1', status: 'completed', action: { type: 'search' } },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: OWN_LINE,
            annotations: [
              {
                type: 'url_citation',
                url: ALLOWED_URL,
                title: '出典',
                start_index: 0,
                end_index: OWN_LINE.length,
              },
            ],
          },
        ],
      },
    ],
  };
}

async function ask(query: string) {
  (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({ data: strategy(), error: null });
  mockChatCreate.mockResolvedValue({ choices: [{ message: { content: ANSWER } }] });
  return POST(req(query));
}

let logSpy: jest.SpyInstance;
const writableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = process.env.NODE_ENV;

beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key';
});

beforeEach(() => {
  jest.resetAllMocks();
  delete process.env.CEO_CHAT_WEB_SEARCH_ENABLED;
  (getSupabaseAdmin as jest.Mock).mockReturnValue(EMPTY_ADMIN);
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
  (resolveCompanyIdFromStrategyId as jest.Mock).mockResolvedValue(COMPANY_ID);
  (requireMembership as jest.Mock).mockResolvedValue({ userId: USER, companyId: COMPANY_ID, role: 'admin', departmentId: null });
  mockClassifyLLM.mockResolvedValue({ stage: 'strategy', confidence: 0.9, reasons: [] });
  mockResponsesCreate.mockResolvedValue(searchResponse());
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  writableEnv.NODE_ENV =originalNodeEnv;
});

const diagLogs = () => logSpy.mock.calls.filter((c) => c[2] === 'ceo_web_search_diag');

describe('外部検索の診断ログ（開発環境のみ）', () => {
  beforeEach(() => {
    process.env.CEO_CHAT_WEB_SEARCH_ENABLED = 'true';
  });

  it('開発環境では、件数と状態を1行で出す（企業名・質問・回答・URL は含めない）', async () => {
    writableEnv.NODE_ENV ='development';
    const res = await ask(QUESTION);
    expect(res.status).toBe(200);
    expect(diagLogs()).toHaveLength(1);
    const diag = diagLogs()[0][3];
    expect(diag).toMatchObject({
      status: 'completed',
      sourceCount: 1,
      outputTypes: { web_search_call: 1, message: 1 },
      urlCitations: 1,
      attributedFacts: 1,
      droppedLines: 0,
      periodKnown: 1,
      publishedKnown: 1,
      entities: { self: 1, competitor: 0, market: 0, unclassified: 0 },
      allowedUrls: 1,
      urlsInAnswer: 1,
      urlsRemoved: 1,
    });
    expect(typeof diag.elapsedMs).toBe('number');
    const text = JSON.stringify(diagLogs());
    expect(text).not.toContain(COMPANY);
    expect(text).not.toContain('日本製罐');
    expect(text).not.toContain(QUESTION);
    expect(text).not.toContain('根拠');
    expect(text).not.toContain(ALLOWED_URL);
    expect(text).not.toContain(INVENTED_URL);
  });

  it('本番環境では、診断ログを出さない', async () => {
    writableEnv.NODE_ENV ='production';
    const res = await ask(QUESTION);
    expect(res.status).toBe(200);
    expect(diagLogs()).toHaveLength(0);
  });

  it('検索が失敗した場合も、状態を記録する（回答は従来どおり返す）', async () => {
    writableEnv.NODE_ENV ='development';
    mockResponsesCreate.mockRejectedValue(Object.assign(new Error('rate'), { status: 429 }));
    const res = await ask(QUESTION);
    expect(res.status).toBe(200);
    expect(diagLogs()).toHaveLength(1);
    expect(diagLogs()[0][3]).toMatchObject({ status: 'rate_limited', allowedUrls: 0, urlsRemoved: 2 });
  });

  it('検索を使わない質問では、診断ログを出さない', async () => {
    writableEnv.NODE_ENV ='development';
    const res = await ask('営業部門の実行計画を評価して');
    expect(res.status).toBe(200);
    expect(mockResponsesCreate).not.toHaveBeenCalled();
    expect(diagLogs()).toHaveLength(0);
  });
});
