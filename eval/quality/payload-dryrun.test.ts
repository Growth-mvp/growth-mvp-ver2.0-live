/* 実 API を呼ばない dry-run。条件A・Bの送信内容、公平性、呼び出し回数を記録する。 */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
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
  FICTIONAL_COMPANY_NAME,
  FICTIONAL_OKRS,
  FICTIONAL_PROGRESS_LOGS,
  FICTIONAL_STRATEGY_ID,
  FICTIONAL_STRATEGY_ROW,
  FICTIONAL_USER_ID,
  QUALITY_QUESTIONS,
} from './fictionalCompany';
import {
  buildConditionAPayload,
  approxTokens,
  EVAL_MAX_COMPLETION_TOKENS,
  EVAL_MODEL,
  EVAL_REASONING_EFFORT,
  INTENT_MODEL,
} from './conditions';
import { PRODUCTION_GROWTH_SHIFT_FOUNDATION, PRODUCTION_TABOO } from './productionText';
import { checkFacts } from './rubric';
import { POST } from '../../app/api/ask-ceo-agent/route';

type Row = Record<string, any>;
const DB: Record<string, Row[]> = { okrs: FICTIONAL_OKRS, progress_logs: FICTIONAL_PROGRESS_LOGS };

/** 出力先は実行前に必ず作る（以前は afterAll で作ったため、初回実行が ENOENT で失敗していた） */
const OUT_DIR = path.join(__dirname, 'results-dryrun');
mkdirSync(OUT_DIR, { recursive: true });

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

/** 基本指示（振る舞い規範）の本文。両条件に同じものが含まれることを確かめる。 */
const BEHAVIOR_MARK = '【振る舞い規範】';
function behaviorSection(system: string): string {
  const start = system.indexOf(BEHAVIOR_MARK);
  const end = system.indexOf('【STAGE1 データの扱い】');
  return start >= 0 && end > start ? system.slice(start, end) : '';
}

const intentLlmCalls: string[] = [];
const summary: Array<Record<string, unknown>> = [];

beforeAll(() => {
  process.env.OPENAI_API_KEY = 'dry-run-no-network';
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
  mockChatCreate.mockResolvedValue({ choices: [{ message: { content: '（dry-run：API未呼び出し）' } }] });
  // 意図判定LLMは呼ばれた回数だけ記録し、ヒューリスティックの結果を代用する
  const { classifyHeuristic } = jest.requireActual('@/lib/intentRouter');
  mockClassifyLLM.mockImplementation(async (_openai: unknown, q: string) => {
    intentLlmCalls.push(q);
    return { ...classifyHeuristic(q), reasons: ['dry-run: heuristic stand-in'] };
  });
});

afterAll(() => {
  writeFileSync(path.join(OUT_DIR, 'dryrun-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
});

describe.each(QUALITY_QUESTIONS)('dry-run 評価 $id: $text', (q) => {
  it('条件A・Bは同じモデル・設定・基本指示で、違いは自社データの有無だけ', async () => {
    intentLlmCalls.length = 0;
    mockChatCreate.mockClear();
    (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({ data: FICTIONAL_STRATEGY_ROW, error: null });

    const res = await POST(req(q.text));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    const sent = mockChatCreate.mock.calls[0][0];
    const payloadB = {
      condition: 'B',
      model: sent.model,
      reasoning_effort: sent.reasoning_effort,
      max_completion_tokens: sent.max_completion_tokens,
      messages: sent.messages,
    };
    const payloadA = buildConditionAPayload(q.text);

    // 同じモデル・設定
    expect(payloadB.model).toBe(EVAL_MODEL);
    expect(payloadB.reasoning_effort).toBe(EVAL_REASONING_EFFORT);
    expect(payloadB.max_completion_tokens).toBe(EVAL_MAX_COMPLETION_TOKENS);
    expect(payloadA.model).toBe(payloadB.model);
    expect(payloadA.reasoning_effort).toBe(payloadB.reasoning_effort);
    expect(payloadA.max_completion_tokens).toBe(payloadB.max_completion_tokens);

    // 同じ質問、同じメッセージ構造（履歴なし）
    expect(payloadB.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
    expect(payloadA.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(payloadB.messages[1].content).toBe(q.text);
    expect(payloadA.messages[1].content).toBe(q.text);

    // 同じ基本指示（振る舞い規範・基礎ガイド・禁則）
    const sysA: string = payloadA.messages[0].content;
    const sysB: string = payloadB.messages[0].content;
    expect(behaviorSection(sysA).length).toBeGreaterThan(0);
    expect(behaviorSection(sysA)).toBe(behaviorSection(sysB));
    expect(sysA).toContain(PRODUCTION_GROWTH_SHIFT_FOUNDATION);
    expect(sysB).toContain(PRODUCTION_GROWTH_SHIFT_FOUNDATION);
    expect(sysA).toContain(PRODUCTION_TABOO);
    expect(sysB).toContain(PRODUCTION_TABOO);

    // 条件Aには自社データがない
    expect(sysA).not.toContain('【会社の前提】');
    expect(sysA).not.toContain(FICTIONAL_COMPANY_NAME);
    expect(sysA).not.toContain('【戦略の根拠');
    expect(sysA).not.toContain('# 部門・OKR・実行計画');
    expect(sysA).not.toContain('【戦略ストーリー要約】');

    // 条件Bには必要な事実があり、禁止語は含まない
    const checkB = checkFacts(sysB, q.mustInclude, q.mustNotInclude);
    expect(checkB.missing).toEqual([]);
    expect(checkB.leaked).toEqual([]);

    const charsA = sysA.length + q.text.length;
    const charsB = sysB.length + q.text.length;
    summary.push({
      id: q.id,
      question: q.text,
      resolvedMode: body.resolvedMode,
      conditionA: {
        model: payloadA.model,
        systemChars: sysA.length,
        approxInputTokens: approxTokens(charsA),
      },
      conditionB: {
        model: payloadB.model,
        systemChars: sysB.length,
        approxInputTokens: approxTokens(charsB),
        mustIncludeMissing: checkB.missing,
        mustNotIncludeLeaked: checkB.leaked,
      },
      answerCalls: 2,
      intentLlmCallsIfLive: intentLlmCalls.length,
      intentModel: INTENT_MODEL,
    });
    writeFileSync(
      path.join(OUT_DIR, `payload-q${q.id}.json`),
      JSON.stringify({ question: q.text, conditionA: payloadA, conditionB: payloadB }, null, 2),
      'utf8'
    );
  });
});
