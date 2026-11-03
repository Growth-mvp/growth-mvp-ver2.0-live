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
import {
  FICTIONAL_COMPANY_ID,
  FICTIONAL_OKRS,
  FICTIONAL_PROGRESS_LOGS,
  FICTIONAL_STRATEGY_ID,
  FICTIONAL_STRATEGY_ROW,
  FICTIONAL_USER_ID,
  QUALITY_QUESTIONS,
} from '../../../eval/quality/fictionalCompany';
import { POST } from './route';

type Row = Record<string, any>;

const DB: Record<string, Row[]> = {
  okrs: FICTIONAL_OKRS,
  progress_logs: FICTIONAL_PROGRESS_LOGS,
};

/** 条件（eq / gte）を実際に適用する模擬。会社の絞り込みが無ければ他社の行が混ざる。 */
function makeAdmin() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return builder;
        },
        gte: (col: string, val: string) => {
          filters.push((r) => String(r[col] ?? '') >= val);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve({ data: (DB[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null }).then(
            resolve,
            reject
          ),
      };
      return builder;
    },
  };
}

function req(query: string) {
  return new NextRequest('http://localhost/api/ask-ceo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify({
      userId: FICTIONAL_USER_ID,
      strategyId: FICTIONAL_STRATEGY_ID,
      companyId: FICTIONAL_COMPANY_ID,
      messages: [{ role: 'user', content: query }],
    }),
  });
}

async function ask(query: string): Promise<{ mode: string; prompt: string }> {
  mockClassifyLLM.mockResolvedValue({ stage: 'strategy', confidence: 0.9, reasons: [] });
  (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({ data: FICTIONAL_STRATEGY_ROW, error: null });
  const res = await POST(req(query));
  expect(res.status).toBe(200);
  const body = await res.json();
  return { mode: body.resolvedMode, prompt: mockChatCreate.mock.calls[0][0].messages[0].content as string };
}

const MARKERS = {
  rationale: '【戦略の根拠',
  bridge: '【STAGE3 戦略展開ブリッジ',
  progress: '# 実行状況（STAGE5',
  plan: '# 業績・資金の数値（STAGE6、区分ごとに表示）',
};

beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key';
});

beforeEach(() => {
  jest.resetAllMocks();
  (getSupabaseAdmin as jest.Mock).mockReturnValue(makeAdmin());
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(FICTIONAL_USER_ID);
  (resolveCompanyIdFromStrategyId as jest.Mock).mockResolvedValue(FICTIONAL_COMPANY_ID);
  (requireMembership as jest.Mock).mockResolvedValue({
    userId: FICTIONAL_USER_ID,
    companyId: FICTIONAL_COMPANY_ID,
    role: 'admin',
    departmentId: null,
  });
  mockChatCreate.mockResolvedValue({ choices: [{ message: { content: 'OK' } }] });
});

describe.each(QUALITY_QUESTIONS)('評価 $id: $text', (q) => {
  it('経路と注入されるブロックが期待どおり', async () => {
    const { mode, prompt } = await ask(q.text);
    expect(mode).toBe(q.mode);
    expect(prompt.includes(MARKERS.rationale)).toBe(q.blocks.rationale);
    expect(prompt.includes(MARKERS.bridge)).toBe(q.blocks.bridge);
    expect(prompt.includes(MARKERS.progress)).toBe(q.blocks.progress);
    expect(prompt.includes(MARKERS.plan)).toBe(q.blocks.plan);
  });

  it('参照すべき事実が含まれる', async () => {
    const { prompt } = await ask(q.text);
    for (const s of q.mustInclude) expect(prompt).toContain(s);
  });

  it('他社・他人の本文・秘密の値は含まれない', async () => {
    const { prompt } = await ask(q.text);
    for (const s of q.mustNotInclude) expect(prompt).not.toContain(s);
  });
});

describe('確認記録がないことを、遅れと断定しない', () => {
  it('進捗ブロックに「遅れ」「遅延」の断定語を出さない', async () => {
    const { prompt } = await ask('どの実行計画が遅れているか？');
    const block = prompt.slice(prompt.indexOf(MARKERS.progress));
    expect(block).toContain('確認がないプロジェクト');
    expect(block).toContain('遅延と断定しない');
    expect(block).not.toMatch(/遅れている|遅延している|遅延です/);
  });
});

describe('実績・目標・予測の区分（Q2・Q5）', () => {
  it('Q5：現預金の実績と最低現預金を出し、将来の期末現預金は予測未算出とする', async () => {
    const { prompt } = await ask('来年度の利益と資金繰りはどうなるか？');
    expect(prompt).toContain('期末現預金');
    expect(prompt).toContain('最低現預金（登録前提）');
    expect(prompt).toContain('期末現預金の予測：未算出');
    expect(prompt).not.toMatch(/2027年度（予測）/);
  });

  it('Q2：登録目標は目標として出し、予測として出さない', async () => {
    const { prompt } = await ask('今の戦略で3年後に成長できるか？');
    expect(prompt).toContain('目標（経営者が登録）');
    expect(prompt).toContain('予測未算出');
    expect(prompt).not.toMatch(/2027年度（予測）/);
  });

  it('Q6：人材の相談では、STAGE2の関連する登録回答を先頭に出す', async () => {
    const { prompt } = await ask('設備投資と人材採用のどちらを優先すべきか？');
    expect(prompt).toContain('【質問に関連する登録回答（STAGE2');
    expect(prompt).toContain('3〜5年後、中小製造業では保守人材が不足し');
  });

  it('経営判断の原則は、advisor の文面に入る', async () => {
    const { prompt } = await ask('社長が今、最も優先すべきことは何か？');
    expect(prompt).toContain('【経営判断の原則');
  });
});
