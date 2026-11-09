/* Phase 2E：新方式のみの実OpenAI生成（厳格な構造化出力）。
 * 上限：合計3回・費用1ドル。台帳ファイルで、実行をまたいでも上限を超えないようにする。
 * 1件ごとに別々に実行し、異常があれば次へ進まない。自動再試行はしない。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { EVAL_MAX_COMPLETION_TOKENS, EVAL_MODEL, EVAL_REASONING_EFFORT } from '@/eval/quality/conditions';
import { costUsd, EvalBudgetExceeded, EvalCallGuard, SDK_MAX_RETRIES } from '@/eval/quality/costGuard';
import { buildPlanApiSchema } from '@/lib/stage4/plan/apiSchema';
import { buildPlanContext } from '@/lib/stage4/plan/context';
import { buildExecutionPlanPrompt } from '@/lib/stage4/plan/prompt';
import { buildPlanSource, type RawPlanInput } from '@/lib/stage4/plan/source';

export const PHASE2E = { maxCalls: 3, budgetUsd: 1, model: EVAL_MODEL };
export const PHASE2E_DIR = path.join(__dirname, 'results-phase2e');
const LEDGER = path.join(PHASE2E_DIR, 'ledger.json');

export type Ledger = { calls: number; spentUsd: number; entries: Array<Record<string, unknown>> };

export function readLedger(): Ledger {
  if (!existsSync(LEDGER)) return { calls: 0, spentUsd: 0, entries: [] };
  return JSON.parse(readFileSync(LEDGER, 'utf8')) as Ledger;
}

function writeLedger(l: Ledger): void {
  mkdirSync(PHASE2E_DIR, { recursive: true });
  writeFileSync(LEDGER, JSON.stringify(l, null, 2), 'utf8');
}

/** 送信前に、回数・費用（最悪ケース）の上限を確かめる。超えれば送らずに例外 */
export function assertCanSend(ledger: Ledger, estInputTokens: number): void {
  if (ledger.calls + 1 > PHASE2E.maxCalls) throw new EvalBudgetExceeded(`Phase 2E の回数上限（${PHASE2E.maxCalls}）に達している`);
  const worst = costUsd(PHASE2E.model, { prompt_tokens: estInputTokens, completion_tokens: EVAL_MAX_COMPLETION_TOKENS });
  if (ledger.spentUsd + worst > PHASE2E.budgetUsd) {
    throw new EvalBudgetExceeded(`費用上限（$${PHASE2E.budgetUsd}）を超える恐れ（現在 $${ledger.spentUsd.toFixed(6)}、次の最悪ケース $${worst.toFixed(6)}）`);
  }
}

export type Phase2ERecord = {
  caseId: string;
  model: string;
  reasoningEffort: string;
  maxCompletionTokens: number;
  responseFormat: 'json_schema(strict)';
  prompt: string;
  output: string;
  finishReason: string | null;
  usage: { prompt_tokens: number; completion_tokens: number } | null;
  costUsd: number;
  durationMs: number;
};

/** 1件だけ送信する。台帳に記録し、結果を保存する */
export async function runEngineOnce(args: {
  caseId: string;
  raw: RawPlanInput;
  apiKey: string | undefined;
}): Promise<Phase2ERecord> {
  const ledger = readLedger();
  const { source, scope } = buildPlanSource(args.raw);
  const prompt = buildExecutionPlanPrompt(buildPlanContext(source, scope));
  const est = Math.ceil(prompt.length / 1.5);
  assertCanSend(ledger, est);

  const client = new OpenAI({ apiKey: args.apiKey, maxRetries: SDK_MAX_RETRIES, timeout: 240_000 });
  const api = buildPlanApiSchema();
  const t0 = Date.now();
  let res: Awaited<ReturnType<typeof client.chat.completions.create>>;
  try {
    res = await client.chat.completions.create({
      model: PHASE2E.model,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: EVAL_MAX_COMPLETION_TOKENS,
      reasoning_effort: EVAL_REASONING_EFFORT as 'low',
      response_format: { type: 'json_schema', json_schema: { name: api.name, strict: true, schema: api.schema } },
    } as any);
  } catch (e) {
    // 失敗も1回として台帳に記録する（上限の計算に入れるため）
    const after = readLedger();
    after.calls += 1;
    after.entries.push({ caseId: args.caseId, error: e instanceof Error ? e.message : String(e), at: new Date().toISOString() });
    writeLedger(after);
    throw e;
  }
  const durationMs = Date.now() - t0;
  const usage = res.usage ? { prompt_tokens: res.usage.prompt_tokens, completion_tokens: res.usage.completion_tokens } : null;
  const cost = usage ? costUsd(PHASE2E.model, usage) : 0;
  const record: Phase2ERecord = {
    caseId: args.caseId,
    model: PHASE2E.model,
    reasoningEffort: EVAL_REASONING_EFFORT,
    maxCompletionTokens: EVAL_MAX_COMPLETION_TOKENS,
    responseFormat: 'json_schema(strict)',
    prompt,
    output: res.choices[0]?.message?.content ?? '',
    finishReason: res.choices[0]?.finish_reason ?? null,
    usage,
    costUsd: cost,
    durationMs,
  };
  const after = readLedger();
  after.calls += 1;
  after.spentUsd += cost;
  after.entries.push({ caseId: args.caseId, usage, costUsd: cost, durationMs, finishReason: record.finishReason, at: new Date().toISOString() });
  writeLedger(after);
  writeFileSync(path.join(PHASE2E_DIR, `${args.caseId}-ENGINE-2E.json`), JSON.stringify(record, null, 2), 'utf8');
  return record;
}
