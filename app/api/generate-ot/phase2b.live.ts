/*
 * Phase 2B の実 API 検証（単発・予算管理付き）。通常の Jest からは読み込まれない。
 * 実行: P2B_RUN=<名前> P2B_FLAG=on|off P2B_INPUT=<入力JSON> npx jest -c jest.live.config.js app/api/generate-ot/phase2b.live.ts
 * 認証（ユーザーとメンバーシップ）と DB 接続だけをスタブにし、route は本番と同じコードを通す。
 * 回数と概算トークンは P2B_BUDGET_FILE に累積し、上限を超える呼び出しは行わない。
 */
import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: async () => 'p2b-verify-user',
  requireMembership: async () => ({
    userId: 'p2b-verify-user',
    companyId: 'p2b-verify-company',
    role: 'member',
    departmentId: null,
  }),
}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => ({}) }));

const RUN = process.env.P2B_RUN ?? '';
const runLive = RUN ? describe : describe.skip;

function loadOpenAiKeyFromEnvLocal(): void {
  if (process.env.OPENAI_API_KEY) return;
  const file = path.join(process.cwd(), '.env.local');
  const line = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('OPENAI_API_KEY='));
  if (!line) throw new Error('OPENAI_API_KEY が .env.local にありません');
  process.env.OPENAI_API_KEY = line.slice('OPENAI_API_KEY='.length).replace(/^["']|["']$/g, '').trim();
}

type Budget = { calls: number; tokens: number; unmeasured: number; maxCalls: number; file: string };

function loadBudget(file: string, maxCalls: number): Budget {
  const base = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { calls: 0, tokens: 0 };
  return { calls: base.calls, tokens: base.tokens, unmeasured: base.unmeasured ?? 0, maxCalls, file };
}

function saveBudget(b: Budget): void {
  fs.writeFileSync(b.file, JSON.stringify({ calls: b.calls, tokens: b.tokens, unmeasured: b.unmeasured }, null, 2));
}

runLive(`Phase 2B 実 API 検証: ${RUN}`, () => {
  jest.setTimeout(900_000);

  it('入力 JSON を route に通し、結果と呼び出し記録を保存する', async () => {
    const flag = process.env.P2B_FLAG === 'on' ? 'true' : 'false';
    const resultsDir = process.env.P2B_RESULTS_DIR as string;
    const budget = loadBudget(process.env.P2B_BUDGET_FILE as string, Number(process.env.P2B_MAX_CALLS ?? 120));
    if (budget.calls >= budget.maxCalls) throw new Error(`予算上限に到達しています（${budget.calls}/${budget.maxCalls}）`);

    loadOpenAiKeyFromEnvLocal();
    process.env.OT_WEB_SEARCH_ENABLED = 'true';
    process.env.OT_CUSTOMER_NEED_DISCOVERY = flag;

    const body = JSON.parse(fs.readFileSync(process.env.P2B_INPUT as string, 'utf8'));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { openai } = require('@/lib/openai');
    const calls: Array<Record<string, unknown>> = [];
    const record = (phase: string, params: any, res: any) => {
      const usage = res?.usage ?? null;
      const tokens = usage ? Number(usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)) : 0;
      budget.calls += 1;
      if (!usage) budget.unmeasured += 1;
      budget.tokens += tokens;
      saveBudget(budget);
      calls.push({
        phase,
        model: params.model,
        maxOutputTokens: params.max_output_tokens ?? params.max_completion_tokens ?? null,
        usage: usage
          ? { input: usage.input_tokens ?? null, output: usage.output_tokens ?? null, total: tokens }
          : null,
        webSearchCalls: (res?.output ?? []).filter((i: any) => i.type === 'web_search_call').length,
      });
    };
    const maxTokens = Number(process.env.P2B_MAX_TOKENS ?? 170_000);
    const guard = () => {
      if (budget.calls >= budget.maxCalls) throw new Error('harness_budget_exhausted');
      if (budget.tokens >= maxTokens) throw new Error('harness_token_budget_exhausted');
      if (budget.unmeasured > 0) throw new Error('harness_usage_unmeasured');
    };

    const responsesResource = openai.responses;
    const originalResponses = responsesResource.create.bind(responsesResource);
    responsesResource.create = async (params: any, options: any) => {
      guard();
      const phase = params.tools ? 'search' : params.text?.format?.name === 'customer_roles' ? 'roles' : 'analysis';
      const res = await originalResponses(params, options);
      record(phase, params, res);
      return res;
    };
    const chatResource = openai.chat.completions;
    const originalChat = chatResource.create.bind(chatResource);
    chatResource.create = async (params: any, options: any) => {
      guard();
      const res = await originalChat(params, options);
      record('chat_fallback', params, res);
      return res;
    };

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { POST } = require('./route');
    const started = Date.now();
    const res = await POST(
      new NextRequest('http://localhost/api/generate-ot', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer p2b' },
        body: JSON.stringify(body),
      })
    );
    const json = await res.json();
    const out = {
      run: RUN,
      flag,
      status: res.status,
      elapsedMs: Date.now() - started,
      llmCalls: calls,
      budgetAfter: { calls: budget.calls, tokens: budget.tokens },
      response: json,
    };
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(path.join(resultsDir, `${RUN}-${process.env.P2B_FLAG}.json`), JSON.stringify(out, null, 2));
    process.stdout.write(
      `P2B_DONE ${RUN} ${process.env.P2B_FLAG} status=${res.status} calls=${calls.length} elapsedMs=${out.elapsedMs} budget=${budget.calls}/${budget.maxCalls}\n`
    );
    expect(res.status).toBeLessThan(500);
  });
});
