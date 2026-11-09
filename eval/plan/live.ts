/* 実OpenAI APIによる比較（承認後のみ実行）。今回は実行しない。
 * 二重の承認（PLAN_LIVE=1 かつ PLAN_APPROVED=yes）が無ければ、どの関数も送信せず例外にする。
 * 自動再試行なし、予算と呼び出し回数は eval/quality の EvalCallGuard で止める。 */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { EVAL_MAX_COMPLETION_TOKENS, EVAL_MODEL, EVAL_REASONING_EFFORT } from '@/eval/quality/conditions';
import { EvalCallGuard, SDK_MAX_RETRIES } from '@/eval/quality/costGuard';
import { buildPlanContext } from '@/lib/stage4/plan/context';
import { buildExecutionPlanPrompt } from '@/lib/stage4/plan/prompt';
import { buildPlanSource } from '@/lib/stage4/plan/source';
import { buildLegacyDraftPrompt, type LegacyNow } from './legacy/legacyPrompt';
import { buildLegacyRequest } from './legacy/legacyRequest';
import type { CaseInput } from './dryRun';

export function assertLiveApproved(env: Record<string, string | undefined>): void {
  if (env.PLAN_LIVE !== '1' || env.PLAN_APPROVED !== 'yes') {
    throw new Error('実API呼び出しは承認されていない（PLAN_LIVE=1 と PLAN_APPROVED=yes が必要）');
  }
}

export type LiveCallResult = {
  caseId: string;
  system: 'LEGACY' | 'ENGINE';
  model: string;
  reasoningEffort: string;
  maxCompletionTokens: number;
  prompt: string;
  output: string;
  finishReason: string | null;
  usage: { prompt_tokens: number; completion_tokens: number } | null;
  costUsd: number;
  durationMs: number;
};

type ChatParams = {
  model: string;
  messages: Array<{ role: 'user'; content: string }>;
  max_completion_tokens: number;
  reasoning_effort: 'low';
};

export const LIVE_MAX_CALLS = 6;
export const LIVE_BUDGET_USD = 1;

/** 比較専用のガード：送信回数6回・予算$1。意図判定の枠は使わない */
export function makeLiveGuard(): EvalCallGuard {
  return new EvalCallGuard({
    budgetUsd: LIVE_BUDGET_USD,
    maxTotalCalls: LIVE_MAX_CALLS,
    maxIntentCalls: 0,
    maxAnswerCalls: LIVE_MAX_CALLS,
  });
}

/** 3件 × 2方式 = 6回。送信前にガードが回数・予算を確かめ、超えれば送信せず例外にする */
export async function runLive(args: {
  cases: CaseInput[];
  now: LegacyNow;
  outDir: string;
  apiKey: string | undefined;
  env: Record<string, string | undefined>;
}): Promise<{ results: LiveCallResult[]; spentUsd: number }> {
  assertLiveApproved(args.env);
  mkdirSync(args.outDir, { recursive: true });

  const client = new OpenAI({ apiKey: args.apiKey, maxRetries: SDK_MAX_RETRIES });
  await client.models.retrieve(EVAL_MODEL);
  const guard = makeLiveGuard();
  const send = guard.wrap(async (params: ChatParams) => {
    const res = await client.chat.completions.create({
      ...params,
      reasoning_effort: EVAL_REASONING_EFFORT as 'low',
    });
    return res;
  });

  const results: LiveCallResult[] = [];
  for (const c of args.cases) {
    const { source, scope } = buildPlanSource(c.raw);
    const ctx = buildPlanContext(source, scope);
    const prompts: Array<[LiveCallResult['system'], string]> = [
      ['LEGACY', buildLegacyDraftPrompt(buildLegacyRequest(c.raw), args.now)],
      ['ENGINE', buildExecutionPlanPrompt(ctx)],
    ];
    for (const [system, prompt] of prompts) {
      guard.setTag(`${c.id}-${system}`);
      const t0 = Date.now();
      const res = await send({
        model: EVAL_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: EVAL_MAX_COMPLETION_TOKENS,
        reasoning_effort: 'low',
      });
      const durationMs = Date.now() - t0;
      const usage = res.usage ? { prompt_tokens: res.usage.prompt_tokens, completion_tokens: res.usage.completion_tokens } : null;
      const record = {
        caseId: c.id,
        system,
        model: EVAL_MODEL,
        reasoningEffort: EVAL_REASONING_EFFORT,
        maxCompletionTokens: EVAL_MAX_COMPLETION_TOKENS,
        prompt,
        output: res.choices[0]?.message?.content ?? '',
        finishReason: res.choices[0]?.finish_reason ?? null,
        usage,
        costUsd: guard.records[guard.records.length - 1]?.costUsd ?? 0,
        durationMs,
      };
      results.push(record);
      writeFileSync(path.join(args.outDir, `${c.id}-${system}.json`), JSON.stringify(record, null, 2), 'utf8');
    }
  }
  return { results, spentUsd: guard.spentUsd };
}
