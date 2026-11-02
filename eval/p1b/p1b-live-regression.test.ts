/* P1-B 品質修正の回帰（Q1・Q3・Q6）。環境変数 P1B_LIVE_REG=1 のときだけ実行される。本番の通常経路（ヒューリスティック → LLM 意図判定 → 回答）を再現する。アプリのコードは変更しない。 */
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { NextRequest } from 'next/server';
import { MOCK_COMPANY_ROW } from './mockCompany';

const LIVE = process.env.P1B_LIVE_REG === '1';
const ANSWER_MODEL = 'gpt-5.6-luna';
const INTENT_MODEL = 'gpt-4o-mini';
const MAX_ANSWER_CALLS = 3;
const MAX_INTENT_CALLS = 3;
const MAX_TOTAL_CALLS = 6;
const OUT_DIR = path.join(__dirname, 'results-regression');

const USER = 'eval-user';
const COMPANY_ID = '00000000-0000-4000-8000-00000000eval';
const STRATEGY_ID = '00000000-0000-4000-8000-0000000strat';

const mockGetStrategy = jest.fn();
const mockAuthUser = jest.fn();
const mockRequireMembership = jest.fn();
const mockResolveCompany = jest.fn();
const mockLlmResults: Array<{ result?: unknown; error?: string; ms: number }> = [];

jest.mock('server-only', () => ({}));
jest.mock('@/utils/supabase/strategy', () => ({
  getFullStrategyDataByStrategyId: (...args: unknown[]) => mockGetStrategy(...args),
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
    classifyLLM: async (...args: unknown[]) => {
      const started = Date.now();
      try {
        const result = await actual.classifyLLM(...args);
        mockLlmResults.push({ result, ms: Date.now() - started });
        return result;
      } catch (e: any) {
        mockLlmResults.push({ error: String(e?.message ?? e), ms: Date.now() - started });
        throw e;
      }
    },
  };
});
jest.mock('@/lib/externalFinancialSearch', () => ({
  searchExternalFinancialData: jest.fn(async () => null),
}));
jest.mock('@/utils/insights/stage1Insight', () => ({ buildStage1Insight: () => '' }));
jest.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const proxy: any = new Proxy(
        {},
        {
          get: (_t, prop) =>
            prop === 'then'
              ? (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                  Promise.resolve({ data: [], error: null }).then(resolve, reject)
              : () => proxy,
        }
      );
      return proxy;
    },
    auth: {},
  }),
}));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: (...args: unknown[]) => mockAuthUser(...args),
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
  resolveCompanyIdFromStrategyId: (...args: unknown[]) => mockResolveCompany(...args),
}));

type Question = { id: string; text: string; screenId: string; role: 'admin' | 'manager' | 'member' };

const QUESTIONS: Question[] = [
  { id: 'q1', text: 'わが社はなぜこの戦略を選んだの？', screenId: 'stage2', role: 'admin' },
  { id: 'q3', text: '顧客のどんな課題を解決しようとしている？', screenId: 'stage2', role: 'admin' },
  { id: 'q6', text: 'わが社のROICはどうなの？', screenId: 'stage2', role: 'admin' },
];

const MOCK_STRATEGY = { ...MOCK_COMPANY_ROW, id: STRATEGY_ID, companyId: COMPANY_ID };

type CallRecord = { model: string; status: number; ms: number; requestBody: any; responseBody: any; failed?: string };
const calls: CallRecord[] = [];
let blocked = '';

function readOpenAIKey(): string {
  const envText = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
  const line = envText.split(/\r?\n/).find((l) => l.startsWith('OPENAI_API_KEY='));
  if (!line) throw new Error('OPENAI_API_KEY が .env.local にありません');
  return line.slice('OPENAI_API_KEY='.length).replace(/^['"]|['"]$/g, '');
}

function writeJson(name: string, data: unknown) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2), 'utf8');
}

function countByModel(model: string): number {
  return calls.filter((c) => c.model === model).length;
}

(LIVE ? describe : describe.skip)('P1-B 品質修正の回帰（Q1・Q3・Q6、本番経路・モック企業）', () => {
  jest.setTimeout(60 * 60 * 1000);

  it('実行前に両モデルの利用可否を確認する（推論ではなくモデル参照のみ）', async () => {
    const client = new OpenAI({ apiKey: readOpenAIKey() });
    const out: any = {
      checkedAt: new Date().toISOString(),
      note: 'models.retrieve によるモデル参照のみ。推論の 6 件とは別に記録',
    };
    for (const model of [ANSWER_MODEL, INTENT_MODEL]) {
      const info: any = await client.models.retrieve(model);
      out[model] = { available: info?.id === model, id: info?.id, owned_by: info?.owned_by };
    }
    writeJson('model-check.json', out);
    expect(out[ANSWER_MODEL].available).toBe(true);
    expect(out[INTENT_MODEL].available).toBe(true);
  });

  it('Q1・Q3・Q6 を本番経路で評価する（推論は最大 6 件、自動再試行なし）', async () => {
    const check = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'model-check.json'), 'utf8'));
    if (!check[ANSWER_MODEL]?.available || !check[INTENT_MODEL]?.available) {
      throw new Error('モデルの利用可否が確認できないため、評価を実行しない');
    }
    const key = readOpenAIKey();
    process.env.OPENAI_API_KEY = key;
    delete process.env.NEXT_PUBLIC_DEBUG_AGENT;

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url ?? String(input);
      if (!url.includes('/chat/completions')) return realFetch(input, init);

      if (blocked) throw new Error(`遮断: ${blocked}`);
      const requestBody = JSON.parse(String(init?.body ?? '{}'));
      const model = String(requestBody.model);
      const reject = (reason: string) => {
        blocked = reason;
        throw new Error(`遮断: ${reason}`);
      };
      if (model !== ANSWER_MODEL && model !== INTENT_MODEL) reject(`許可されていないモデル: ${model}`);
      if (calls.length >= MAX_TOTAL_CALLS) reject('推論の総上限（6件）に達した');
      if (model === ANSWER_MODEL && countByModel(ANSWER_MODEL) >= MAX_ANSWER_CALLS) reject('回答生成の上限（3件）に達した');
      if (model === INTENT_MODEL && countByModel(INTENT_MODEL) >= MAX_INTENT_CALLS) reject('LLM意図判定の上限（3件）に達した');

      const started = Date.now();
      let res: Response;
      try {
        res = await realFetch(input, init);
      } catch (e: any) {
        blocked = `通信エラーのため中止（自動再試行なし）: ${e?.message ?? e}`;
        throw e;
      }
      const text = await res.clone().text();
      let responseBody: any;
      try {
        responseBody = JSON.parse(text);
      } catch {
        responseBody = { raw: text };
      }
      const record: CallRecord = { model, status: res.status, ms: Date.now() - started, requestBody, responseBody };
      if (!res.ok) {
        record.failed = `HTTP ${res.status}`;
        blocked = `HTTP ${res.status} のため中止（自動再試行なし）`;
      }
      calls.push(record);
      return res;
    }) as any;

    try {
      mockGetStrategy.mockResolvedValue({ data: MOCK_STRATEGY, error: null });
      mockAuthUser.mockResolvedValue(USER);
      mockResolveCompany.mockResolvedValue(COMPANY_ID);

      const intentRouter = jest.requireActual('@/lib/intentRouter');
      const detectAutoMode = jest.requireActual('@/lib/autoModeRouter').detectAutoMode;
      const { POST } = require('@/app/api/ask-ceo-agent/route');

      const summary: any[] = [];
      for (const q of QUESTIONS) {
        if (blocked) break;
        mockRequireMembership.mockImplementation(async (_a: unknown, _u: unknown, companyId: string) =>
          companyId === COMPANY_ID ? { userId: USER, companyId: COMPANY_ID, role: q.role, departmentId: null } : null
        );
        const callsBefore = calls.length;
        const llmBefore = mockLlmResults.length;

        const heuristic = intentRouter.classifyHeuristic(q.text);
        const autoMode = detectAutoMode({ lastUserText: q.text });

        const started = Date.now();
        const res = await POST(
          new NextRequest('http://localhost/api/ask-ceo-agent', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer eval' },
            body: JSON.stringify({
              userId: USER,
              strategyId: STRATEGY_ID,
              companyId: COMPANY_ID,
              messages: [{ role: 'user', content: q.text }],
              screen: { screenId: q.screenId },
            }),
          })
        );
        const json: any = await res.json();
        const wallMs = Date.now() - started;

        const made = calls.slice(callsBefore);
        const intentCall = made.find((c) => c.model === INTENT_MODEL);
        const answerCall = made.find((c) => c.model === ANSWER_MODEL);
        const llm = mockLlmResults.slice(llmBefore)[0] ?? null;
        const llmResult: any = llm?.result ?? null;
        const finalIntent = llmResult ? intentRouter.chooseBetter(heuristic, llmResult) : heuristic;
        const systemText: string = answerCall?.requestBody?.messages?.[0]?.content ?? '';

        const record = {
          id: q.id,
          question: q.text,
          screenId: q.screenId,
          role: q.role,
          httpStatus: res.status,
          answer: json?.content ?? null,
          error: json?.error ?? null,
          intent: {
            heuristic: { stage: heuristic.stage, confidence: heuristic.confidence, reasons: heuristic.reasons },
            llmTriggered: heuristic.confidence < 0.7,
            llm: llmResult ? { stage: llmResult.stage, confidence: llmResult.confidence, reasons: llmResult.reasons } : null,
            llmError: llm?.error ?? null,
            autoModeByMessage: autoMode.mode,
            finalStage: finalIntent.stage,
            finalConfidence: finalIntent.confidence,
          },
          guidance: {
            injected: systemText.includes('【操作案内（登録簿に基づく）】'),
            operationCount: json?.operationGuidance?.operationCount ?? 0,
            screenIds: json?.operationGuidance?.screenIds ?? [],
          },
          contextBlocks: {
            rationale: systemText.includes('【戦略の根拠'),
            stage1Metrics: systemText.includes('【STAGE1 企業価値5指標'),
            financeSummary: systemText.includes('【STAGE1 財務サマリ'),
            storySummary: systemText.includes('【戦略ストーリー要約】'),
            unclearNote: systemText.includes('【情報の選択】'),
          },
          usage: {
            intent: intentCall?.responseBody?.usage ?? null,
            answer: answerCall?.responseBody?.usage ?? null,
          },
          timing: {
            intentMs: intentCall?.ms ?? null,
            answerMs: answerCall?.ms ?? null,
            wallMs,
          },
          calls: made.map((c) => ({ model: c.model, status: c.status, ms: c.ms, failed: c.failed ?? null })),
          answerModel: answerCall?.responseBody?.model ?? null,
          answerSystemPrompt: systemText,
          finishedAt: new Date().toISOString(),
        };
        writeJson(`${q.id}.json`, record);
        summary.push({
          id: q.id,
          status: res.status,
          inferenceCalls: made.length,
          models: made.map((c) => c.model),
          heuristic: heuristic.stage,
          llm: llmResult?.stage ?? null,
          final: finalIntent.stage,
          guidance: record.guidance.injected,
          contextBlocks: record.contextBlocks,
        });
        if (res.status !== 200 || made.length < 1 || blocked) {
          writeJson('summary.json', { aborted: true, at: q.id, reason: blocked || `status ${res.status}`, totalCalls: calls.length, summary });
          break;
        }
      }
      writeJson('summary.json', {
        aborted: Boolean(blocked),
        reason: blocked || null,
        totalInferenceCalls: calls.length,
        answerCalls: countByModel(ANSWER_MODEL),
        intentCalls: countByModel(INTENT_MODEL),
        summary,
      });
      expect(calls.length).toBeLessThanOrEqual(MAX_TOTAL_CALLS);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
