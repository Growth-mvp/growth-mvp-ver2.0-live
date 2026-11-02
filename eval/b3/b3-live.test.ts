/* B3 実 OpenAI API 評価ハーネス（B3_LIVE=1 のときだけ実行）。アプリのコードは変更しない。 */
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { NextRequest } from 'next/server';

const LIVE = process.env.B3_LIVE === '1';
const MODEL = 'gpt-5.6-luna';
const MAX_INFERENCE_CALLS = 8;
const OUT_DIR = path.join(__dirname, 'results');

const USER = 'eval-user';
const COMPANY_ID = '00000000-0000-4000-8000-00000000eval';
const STRATEGY_ID = '00000000-0000-4000-8000-0000000strat';

const mockGetStrategy = jest.fn();
const mockAuthUser = jest.fn();
const mockRequireMembership = jest.fn();
const mockResolveCompany = jest.fn();
const mockClassifyLLM = jest.fn();

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
    classifyLLM: (...args: unknown[]) => mockClassifyLLM(...args),
    chooseBetter: (a: unknown) => a,
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
  { id: 'q1', text: '初めて使うんだけど、何から始めたらいい？', screenId: 'home', role: 'admin' },
  { id: 'q2', text: 'この画面では何をすればいい？', screenId: 'stage1', role: 'admin' },
  { id: 'q3', text: 'SWOT分析って何？ どうすればいいの？', screenId: 'stage2', role: 'admin' },
  { id: 'q4', text: '経営計画書を作りたい。', screenId: 'plan-hub', role: 'manager' },
  { id: 'q5', text: '組織変革ルームは何のためにあるの？', screenId: 'stage1', role: 'member' },
  { id: 'q6', text: 'この戦略で本当に売上が伸びるの？', screenId: 'stage2', role: 'admin' },
  { id: 'q7', text: '社員が全然動いてくれない。どうすればいい？', screenId: 'stage1', role: 'manager' },
  { id: 'q8', text: 'そんなボタンが見当たらないけど？', screenId: 'stage1', role: 'member' },
];

const MOCK_STRATEGY = {
  id: STRATEGY_ID,
  companyId: COMPANY_ID,
  companyName: '評価用モック製造株式会社',
  industry: '金属部品製造',
  revenue: '約20億円',
  employees: '約120名',
  mission: '地域のものづくりを支える',
  vision: '2030年に国内で選ばれるニッチ部品メーカーになる',
  value: '誠実・挑戦・品質',
  strength: '熟練技術者が多い / 取引先との信頼関係がある',
  weakness: '営業力が弱く新規開拓が少ない / 生産が一部の職人に依存している',
  opportunity: '自動車部品の電動化による部品需要の変化',
  threat: '原材料価格の上昇 / 大手の海外生産への移転',
  departments: [],
  answers2: [],
  finalStory: [],
};

type CallRecord = {
  status: number;
  ms: number;
  requestBody: any;
  responseBody: any;
};

const calls: CallRecord[] = [];

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

(LIVE ? describe : describe.skip)('B3 実 API 回答品質評価', () => {
  jest.setTimeout(60 * 60 * 1000);

  it('使用モデルの利用可否を確認する（推論は行わない・モデルの参照のみ）', async () => {
    const key = readOpenAIKey();
    const client = new OpenAI({ apiKey: key });
    const info: any = await client.models.retrieve(MODEL);
    writeJson('model-check.json', {
      requestedModel: MODEL,
      available: true,
      id: info?.id,
      owned_by: info?.owned_by,
      created: info?.created,
      checkedAt: new Date().toISOString(),
      note: 'models.retrieve によるモデル参照のみ。推論（chat/completions）は呼んでいない',
    });
    expect(info?.id).toBe(MODEL);
  });

  it('8 件の質問に、既存の ask ルートを通して回答させ、全文と利用量を保存する', async () => {
    const key = readOpenAIKey();
    process.env.OPENAI_API_KEY = key;
    delete process.env.NEXT_PUBLIC_DEBUG_AGENT;

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url ?? String(input);
      const isChat = url.includes('/chat/completions');
      if (!isChat) return realFetch(input, init);
      if (calls.length >= MAX_INFERENCE_CALLS) {
        throw new Error('推論呼び出しの上限（8件）に達したため中止');
      }
      const started = Date.now();
      const res = await realFetch(input, init);
      const text = await res.clone().text();
      let responseBody: any = null;
      try {
        responseBody = JSON.parse(text);
      } catch {
        responseBody = { raw: text };
      }
      calls.push({
        status: res.status,
        ms: Date.now() - started,
        requestBody: JSON.parse(String(init?.body ?? '{}')),
        responseBody,
      });
      return res;
    }) as any;

    try {
      mockGetStrategy.mockResolvedValue({ data: MOCK_STRATEGY, error: null });
      mockAuthUser.mockResolvedValue(USER);
      mockResolveCompany.mockResolvedValue(COMPANY_ID);
      mockClassifyLLM.mockImplementation(async () => {
        throw new Error('評価では LLM による意図判定を無効化（推論呼び出しの上限を守るため）');
      });

      const { POST } = require('@/app/api/ask-ceo-agent/route');

      const summary: any[] = [];
      for (const q of QUESTIONS) {
        mockRequireMembership.mockImplementation(async (_a: unknown, _u: unknown, companyId: string) =>
          companyId === COMPANY_ID ? { userId: USER, companyId: COMPANY_ID, role: q.role, departmentId: null } : null
        );
        const before = calls.length;
        const started = Date.now();
        const body = {
          userId: USER,
          strategyId: STRATEGY_ID,
          companyId: COMPANY_ID,
          messages: [{ role: 'user', content: q.text }],
          screen: { screenId: q.screenId },
        };
        const res = await POST(
          new NextRequest('http://localhost/api/ask-ceo-agent', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer eval' },
            body: JSON.stringify(body),
          })
        );
        const json: any = await res.json();
        const wallMs = Date.now() - started;
        const made = calls.slice(before);
        const call = made[0];
        const systemText: string = call?.requestBody?.messages?.[0]?.content ?? '';
        const record = {
          id: q.id,
          question: q.text,
          screenId: q.screenId,
          role: q.role,
          httpStatus: res.status,
          answer: json?.content ?? null,
          error: json?.error ?? null,
          model: call?.responseBody?.model ?? null,
          usage: call?.responseBody?.usage ?? null,
          inferenceMs: call?.ms ?? null,
          wallMs,
          inferenceCalls: made.length,
          systemPrompt: {
            chars: systemText.length,
            head: systemText.slice(0, 60),
            hasScreenLine: systemText.includes('【現在の画面】'),
            hasOperationGuidance: systemText.includes('【操作案内（登録簿に基づく）】'),
            guidanceOperationCount: json?.operationGuidance?.operationCount ?? 0,
          },
          requestMessages: call?.requestBody?.messages ?? null,
          finishedAt: new Date().toISOString(),
        };
        writeJson(`${q.id}.json`, record);
        summary.push({
          id: q.id,
          status: record.httpStatus,
          model: record.model,
          usage: record.usage,
          inferenceMs: record.inferenceMs,
          guidance: record.systemPrompt.hasOperationGuidance,
          inferenceCalls: record.inferenceCalls,
        });
        if (res.status !== 200 || made.length !== 1) {
          writeJson('summary.json', { aborted: true, at: q.id, summary });
          throw new Error(`質問 ${q.id} で中止: status=${res.status} calls=${made.length}`);
        }
      }
      writeJson('summary.json', { aborted: false, totalInferenceCalls: calls.length, summary });
      expect(calls.length).toBeLessThanOrEqual(MAX_INFERENCE_CALLS);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
