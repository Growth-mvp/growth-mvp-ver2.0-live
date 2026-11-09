/* 実API呼び出しをしない事前見積もり。入力・プロンプトの大きさ・想定トークン・費用の上限を報告する。 */
import { approxTokens, EVAL_MAX_COMPLETION_TOKENS, EVAL_MODEL } from '@/eval/quality/conditions';
import { BUDGET_USD, costUsd, MAX_ANSWER_CALLS } from '@/eval/quality/costGuard';
import { buildPlanContext } from '@/lib/stage4/plan/context';
import { buildExecutionPlanPrompt } from '@/lib/stage4/plan/prompt';
import { buildPlanSource, type RawPlanInput } from '@/lib/stage4/plan/source';
import { buildLegacyDraftPrompt, type LegacyNow } from './legacy/legacyPrompt';
import { buildLegacyRequest } from './legacy/legacyRequest';

/** 出力トークンの想定値。実測ではないため、初回実行の usage で置き換える */
export const ASSUMED_OUTPUT_TOKENS = { LEGACY: 1200, ENGINE: 2000 } as const;

export type CaseInput = { id: string; name: string; raw: RawPlanInput };

export type PlannedCall = {
  caseId: string;
  system: 'LEGACY' | 'ENGINE';
  model: string;
  promptChars: number;
  estInputTokens: number;
  estOutputTokens: number;
  maxOutputTokens: number;
  estCostUsd: number;
  worstCaseUsd: number;
  outputFile: string;
};

export type CaseSummary = {
  caseId: string;
  name: string;
  periodBasis: string | null;
  periodEndYm: string | null;
  stage1Years: number;
  storyChapters: number;
  priorityThemes: number;
  stage3Kpis: number;
  otherDepartments: number;
  engineSources: number;
};

export type DryRunReport = {
  model: string;
  reasoningEffort: string;
  budgetUsd: number;
  maxCallsForAnswers: number;
  plannedCalls: number;
  estTotalUsd: number;
  worstCaseTotalUsd: number;
  cases: CaseSummary[];
  calls: PlannedCall[];
  pricingNote: string;
};

const PRICE_NOTE =
  'eval/quality/costGuard.ts の単価表（gpt-5.6-luna：入力 $0.2 / 出力 $1.2 per 1M tokens）を使用。' +
  '本番ルートが使う gpt-6-luna は単価表に無いため、比較は両方式とも gpt-5.6-luna で行う前提。';

export function buildDryRun(args: { cases: CaseInput[]; now: LegacyNow; outDir: string }): DryRunReport {
  const model = EVAL_MODEL;
  const calls: PlannedCall[] = [];
  const cases: CaseSummary[] = [];

  for (const c of args.cases) {
    const { source, scope } = buildPlanSource(c.raw);
    const ctx = buildPlanContext(source, scope);
    const engineSystem = buildExecutionPlanPrompt(ctx);
    const legacyPrompt = buildLegacyDraftPrompt(buildLegacyRequest(c.raw), args.now);

    cases.push({
      caseId: c.id,
      name: c.name,
      periodBasis: ctx.periodBasis,
      periodEndYm: ctx.endYm,
      stage1Years: source.stage1.financeYears.length,
      storyChapters: source.stage2.finalStory.length,
      priorityThemes: source.stage2.priorityThemes.length,
      stage3Kpis: source.stage3.project.kpis.length,
      otherDepartments: source.stage3.otherDepartments.length,
      engineSources: ctx.sources.length,
    });

    for (const [system, prompt, outTokens] of [
      ['LEGACY', legacyPrompt, ASSUMED_OUTPUT_TOKENS.LEGACY],
      ['ENGINE', engineSystem, ASSUMED_OUTPUT_TOKENS.ENGINE],
    ] as const) {
      const estInputTokens = approxTokens(prompt.length);
      const maxOutputTokens = EVAL_MAX_COMPLETION_TOKENS;
      calls.push({
        caseId: c.id,
        system,
        model,
        promptChars: prompt.length,
        estInputTokens,
        estOutputTokens: outTokens,
        maxOutputTokens,
        estCostUsd: costUsd(model, { prompt_tokens: estInputTokens, completion_tokens: outTokens }),
        worstCaseUsd: costUsd(model, { prompt_tokens: estInputTokens, completion_tokens: maxOutputTokens }),
        outputFile: `${args.outDir}/${c.id}-${system}.json`,
      });
    }
  }

  const sum = (f: (x: PlannedCall) => number) => calls.reduce((n, x) => n + f(x), 0);
  return {
    model,
    reasoningEffort: 'low',
    budgetUsd: BUDGET_USD,
    maxCallsForAnswers: MAX_ANSWER_CALLS,
    plannedCalls: calls.length,
    estTotalUsd: sum((x) => x.estCostUsd),
    worstCaseTotalUsd: sum((x) => x.worstCaseUsd),
    cases,
    calls,
    pricingNote: PRICE_NOTE,
  };
}
