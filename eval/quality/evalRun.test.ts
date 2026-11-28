/* 評価ランナーの end-to-end。既定では偽の送信関数で実行する（API は呼ばない）。
 * 実 API は QUALITY_LIVE=1 かつ QUALITY_APPROVED=yes のときだけ動く（既定では skip）。 */
import path from 'path';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { NextRequest } from 'next/server';
import { EvalCallGuard, MAX_TOTAL_CALLS, BUDGET_USD } from './costGuard';
import { runEvaluation } from './runner';
import { QUALITY_QUESTIONS, FICTIONAL_COMPANY_ID, FICTIONAL_OKRS, FICTIONAL_PROGRESS_LOGS, FICTIONAL_STRATEGY_ID, FICTIONAL_STRATEGY_ROW, FICTIONAL_USER_ID } from './fictionalCompany';

jest.mock('openai', () => ({
  __esModule: true,
  default: class {
    chat = {
      completions: {
        create: (params: unknown) => (globalThis as any).__evalCreate(params),
      },
    };
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
import { POST } from '../../app/api/ask-ceo-agent/route';

type Row = Record<string, any>;
const DB: Record<string, Row[]> = { okrs: FICTIONAL_OKRS, progress_logs: FICTIONAL_PROGRESS_LOGS };

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

type Turn = { role: 'user' | 'assistant'; content: string };

function req(query: string | Turn[]) {
  return new NextRequest('http://localhost/api/ask-ceo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify({
      userId: FICTIONAL_USER_ID,
      strategyId: FICTIONAL_STRATEGY_ID,
      companyId: FICTIONAL_COMPANY_ID,
      messages: typeof query === 'string' ? [{ role: 'user', content: query }] : query,
    }),
  });
}

const DIALOGUES: Array<{ id: string; turns: string[] }> = [
  {
    id: 'd1-owner-initiative',
    turns: [
      '社員が主体的に動いてくれません。どうすべきでしょうか？',
      'でも、うちの社員は今の業務で手一杯で、そこまで考える余裕はないと思います。',
    ],
  },
  {
    id: 'd2-cross-department',
    turns: [
      '他部門がなかなか協力してくれません。営業部との関係をどう改善すべきでしょうか？',
      'でも、営業部は自分たちの数字で精一杯なので、製造の事情まで聞く余裕がないと言っています。',
    ],
  },
  {
    id: 'd3-employee-boss',
    turns: [
      '上司に自分の提案を理解してもらえないのですが、どうすべきでしょうか？',
      'でも、上司は忙しくて話を聞く時間もくれないんです。',
    ],
  },
];

async function runDialogues(raw: (params: any) => Promise<any>, outDir: string) {
  const guard = new EvalCallGuard();
  (globalThis as any).__evalCreate = guard.wrap(raw);
  mkdirSync(outDir, { recursive: true });
  for (const d of DIALOGUES) {
    const history: Turn[] = [];
    const turns: unknown[] = [];
    for (let i = 0; i < d.turns.length; i++) {
      const tag = `${d.id}-t${i + 1}`;
      guard.setTag(tag);
      history.push({ role: 'user', content: d.turns[i] });
      const res = await POST(req([...history]));
      const body = await res.json();
      history.push({ role: 'assistant', content: body.content as string });
      turns.push({
        turn: i + 1,
        user: d.turns[i],
        answer: body.content,
        resolvedMode: body.resolvedMode ?? null,
        stageUsed: body.stageUsed ?? null,
        calls: guard.records.filter((r) => r.tag === tag),
        costUsd: guard.records.filter((r) => r.tag === tag).reduce((n, r) => n + r.costUsd, 0),
      });
    }
    writeFileSync(path.join(outDir, `${d.id}.json`), JSON.stringify({ id: d.id, turns }, null, 2), 'utf8');
  }
  return guard;
}

function approxChars(messages: Array<{ content: unknown }>): number {
  return messages.reduce((n, m) => n + String(m.content ?? '').length, 0);
}

/** 送信関数。raw は実 API または偽物を渡す。 */
async function runWith(raw: (params: any) => Promise<any>, outDir: string, questions: typeof QUALITY_QUESTIONS = QUALITY_QUESTIONS) {
  const guard = new EvalCallGuard();
  const bSystemByQuestion: Record<string, string> = {};
  const send = guard.wrap(async (params: any) => {
    const system = String(params.messages[0].content ?? '');
    const user = String(params.messages[params.messages.length - 1].content ?? '');
    if (system.includes('【会社の前提】')) bSystemByQuestion[user] = system;
    return raw(params);
  });
  (globalThis as any).__evalCreate = send;

  const summary = await runEvaluation({
    questions,
    guard,
    outDir,
    groundingBOf: (question) => bSystemByQuestion[question] ?? '',
    callers: {
      callA: async (payload) => {
        // 評価用の注釈（condition）は API へ送らない（送ると 400 で拒否される）
        const { condition: _condition, ...params } = payload;
        const res = await send(params as any);
        return { content: res.choices[0].message.content as string };
      },
      callB: async (question) => {
        const res = await POST(req(question));
        const body = await res.json();
        return {
          content: body.content as string,
          resolvedMode: body.resolvedMode as string | undefined,
          stageUsed: body.stageUsed as string | undefined,
        };
      },
    },
  });
  return { summary, guard };
}

beforeAll(() => {
  if (process.env.QUALITY_LIVE !== '1') process.env.OPENAI_API_KEY = 'fake-key-no-network';
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
  (getFullStrategyDataByStrategyId as jest.Mock).mockResolvedValue({ data: FICTIONAL_STRATEGY_ROW, error: null });
});

describe('評価ランナー（偽の送信関数で end-to-end。API は呼ばない）', () => {
  const OUT = path.join(__dirname, 'results-fake');

  it('7問×2条件＋意図判定を、上限内で実行し、結果を保存する', async () => {
    const fakeRaw = async (params: any) => {
      if ('condition' in params) throw new Error('評価用の注釈 condition を API へ送っています');
      const isIntent = params.response_format?.type === 'json_object';
      const content = isIntent
        ? '{"stage":"strategy","confidence":0.9,"reasons":["fake"]}'
        : `（fake回答）${params.messages[params.messages.length - 1].content.slice(0, 10)}`;
      return {
        choices: [{ message: { content } }],
        usage: {
          prompt_tokens: Math.ceil(approxChars(params.messages) / 1.5),
          completion_tokens: isIntent ? 20 : 200,
        },
      };
    };

    const { summary, guard } = await runWith(fakeRaw, OUT);

    expect(summary.questions).toBe(7);
    expect(guard.callCount).toBeLessThanOrEqual(MAX_TOTAL_CALLS);
    // A が7回、B の回答が7回、B の意図判定が7回（ヒューリスティックの確信度が低い質問）
    expect(guard.records.filter((r) => r.tag.startsWith('A-')).length).toBe(7);
    expect(guard.records.filter((r) => r.tag.startsWith('B-') && r.model === 'gpt-5.6-luna').length).toBe(7);
    expect(guard.records.filter((r) => r.tag.startsWith('B-') && r.model === 'gpt-4o-mini').length).toBe(7);
    expect(guard.spentUsd).toBeLessThan(BUDGET_USD);

    const files = readdirSync(OUT);
    for (const q of QUALITY_QUESTIONS) {
      for (const name of [`q${q.id}-A.json`, `q${q.id}-B.json`, `sheet-q${q.id}.json`]) {
        expect(files).toContain(name);
      }
      const b = JSON.parse(readFileSync(path.join(OUT, `q${q.id}-B.json`), 'utf8'));
      expect(b.answer).toContain('（fake回答）');
      expect(b.calls.length).toBe(2);
      expect(b.route.resolvedMode).toBe('advisor');
      expect(b.sentSystem).toContain('【会社の前提】');
      const sheet = JSON.parse(readFileSync(path.join(OUT, `sheet-q${q.id}.json`), 'utf8'));
      for (const d of sheet.dimensions) expect(d.humanScore.A).toBeNull();
    }
    expect(existsSync(path.join(OUT, 'summary.json'))).toBe(true);
  });

  it('上限を超える送信は、途中で止まり、無制限に続かない', async () => {
    const raw = async () => ({ choices: [{ message: { content: 'x' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const guard = new EvalCallGuard({ budgetUsd: 1, maxTotalCalls: 3, maxIntentCalls: 7, maxAnswerCalls: 14 });
    (globalThis as any).__evalCreate = guard.wrap(raw as any);
    await expect(
      runEvaluation({
        questions: QUALITY_QUESTIONS,
        guard,
        outDir: path.join(__dirname, 'results-fake-capped'),
        groundingBOf: () => '',
        callers: {
          callA: async (payload) => {
            const res = await (globalThis as any).__evalCreate(payload);
            return { content: res.choices[0].message.content };
          },
          callB: async (question) => {
            const res = await POST(req(question));
            return { content: (await res.json()).content };
          },
        },
      })
    ).rejects.toThrow();
    expect(guard.callCount).toBeLessThanOrEqual(3);
  });
});

const LIVE = process.env.QUALITY_LIVE === '1' && process.env.QUALITY_APPROVED === 'yes';

(LIVE ? describe : describe.skip)('実 API（承認後のみ。自動再試行なし・予算$1・上限21回）', () => {
  it('7問×2条件を実行し、回答全文と実際の usage・費用を保存する', async () => {
    const RealOpenAI = jest.requireActual('openai').default;
    const real = new RealOpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
    // 回答の前にモデルの利用可否を確認する。利用できなければ、ここで止まる（推論は行わない）
    // 利用可否は前回の実行で確認済み（上限のための呼び出しを増やさないため、QUALITY_SKIP_MODEL_CHECK=1 で省略できる）
    if (process.env.QUALITY_SKIP_MODEL_CHECK !== '1') {
      for (const model of ['gpt-5.6-luna', 'gpt-4o-mini']) {
        await real.models.retrieve(model);
      }
    }
    const raw = (params: any) => real.chat.completions.create(params);
    const ids = (process.env.QUALITY_QUESTION_IDS ?? '').split(',').filter(Boolean).map(Number);
    const questions = ids.length ? QUALITY_QUESTIONS.filter((q) => ids.includes(q.id)) : QUALITY_QUESTIONS;
    const { summary } = await runWith(raw, path.join(__dirname, 'results-live'), questions);
    expect(summary.spentUsd).toBeLessThan(BUDGET_USD);
  }, 1_800_000);

  it('3つの対話を、異議・制約を伝えた後の返答まで実行し、回答原文と費用を保存する', async () => {
    const RealOpenAI = jest.requireActual('openai').default;
    const real = new RealOpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
    const guard = await runDialogues(
      (params: any) => real.chat.completions.create(params),
      path.join(__dirname, 'results-dialogue')
    );
    expect(guard.spentUsd).toBeLessThan(BUDGET_USD);
  }, 1_800_000);
});
