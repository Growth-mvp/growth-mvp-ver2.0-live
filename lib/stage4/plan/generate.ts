import { assemblePlan } from './assemble';
import { buildPlanContext, type PlanContext } from './context';
import { estimateFinanceItem, type FinanceEstimate } from './finance';
import { buildExecutionPlanPrompt } from './prompt';
import { buildPlanSource, type RawPlanInput } from './source';
import { PlanDraftSchema, type AssembledPlan, type PlanIssue } from './types';
import { validatePlan } from './validate';
import { canonicalizeRefs } from './refs';
import { normalizeKnownDrift, type Normalization } from './normalize';

export type ExecutionPlanEngineResult = {
  ok: boolean;
  plan: AssembledPlan | null;
  estimates: FinanceEstimate[];
  issues: PlanIssue[];
  executionStartable: boolean;
  context: PlanContext | null;
  /** 検証の前に、既知の余分な項目を取り除いた記録（空なら何も取り除いていない） */
  normalizations: Normalization[];
  /** モデルの元の応答（診断用に保持する） */
  rawOutput: string | null;
};

type EngineCore = Omit<ExecutionPlanEngineResult, 'normalizations' | 'rawOutput'>;

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('JSONが見つからない');
  return JSON.parse(text.slice(start, end + 1));
}

export async function runExecutionPlanEngine(args: {
  raw: RawPlanInput;
  callModel: (prompt: string) => Promise<string>;
}): Promise<ExecutionPlanEngineResult> {
  let rawOutput: string | null = null;
  const normalizations: Normalization[] = [];
  const core = await runEngine(
    {
      raw: args.raw,
      callModel: async (prompt) => {
        rawOutput = await args.callModel(prompt);
        return rawOutput;
      },
    },
    normalizations
  );
  const notes: PlanIssue[] = normalizations.map((n) => ({
    severity: 'info' as const,
    code: 'SHAPE_NORMALIZED',
    path: `${n.path}.${n.key}`,
    message: `検証の前に、余分な項目 ${n.key} を取り除いた（内容は正規化の記録に残す）`,
  }));
  return { ...core, issues: [...core.issues, ...notes], normalizations, rawOutput };
}

async function runEngine(
  args: {
    raw: RawPlanInput;
    callModel: (prompt: string) => Promise<string>;
  },
  normalizations: Normalization[]
): Promise<EngineCore> {
  const { source, scope } = buildPlanSource(args.raw);
  const ctx0 = buildPlanContext(source, scope);
  const prompt = buildExecutionPlanPrompt(ctx0);

  const fail = (issue: PlanIssue): EngineCore => ({
    ok: false,
    plan: null,
    estimates: [],
    issues: [issue],
    executionStartable: false,
    context: ctx0,
  });

  const text = await args.callModel(prompt);
  let json: unknown;
  try {
    json = extractJson(text);
  } catch (e) {
    return fail({ severity: 'error', code: 'JSON_NOT_FOUND', path: '$', message: e instanceof Error ? e.message : 'JSON解析失敗' });
  }
  const normalized = normalizeKnownDrift(json);
  json = normalized.json;
  normalizations.push(...normalized.applied);

  const parsed = PlanDraftSchema.safeParse(json);
  if (!parsed.success) {
    return fail({
      severity: 'error',
      code: 'SCHEMA_INVALID',
      path: parsed.error.issues[0]?.path.join('.') ?? '$',
      message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' / '),
    });
  }
  const known = new Set(ctx0.sources.map((x) => x.ref));
  const canon = canonicalizeRefs(parsed.data, known);
  const draft = canon.value;

  const issues: PlanIssue[] = [];
  if (canon.normalized > 0) {
    issues.push({
      severity: 'info',
      code: 'REF_NORMALIZED',
      path: 'sourceRefs',
      message: `角括弧付きの参照ID ${canon.normalized} 件を、既知の正規IDに直した（例：${canon.samples.join('、')}）`,
    });
  }
  let ctx: PlanContext & { endYm: string; periodBasis: NonNullable<PlanContext['periodBasis']> };
  if (ctx0.endYm !== null && ctx0.periodBasis !== null) {
    if (draft.provisionalPeriod) {
      issues.push({
        severity: 'warning',
        code: 'PERIOD_PROPOSAL_IGNORED',
        path: 'provisionalPeriod',
        message: '入力に期間の根拠があるため、AIの仮期間は使わなかった',
      });
    }
    ctx = { ...ctx0, endYm: ctx0.endYm, periodBasis: ctx0.periodBasis };
  } else {
    if (!draft.provisionalPeriod) {
      return fail({
        severity: 'error',
        code: 'PERIOD_PROPOSAL_MISSING',
        path: 'provisionalPeriod',
        message: '入力に期間の根拠が無いのに、AIが仮期間を提案していない',
      });
    }
    ctx = { ...ctx0, endYm: draft.provisionalPeriod.endYm, periodBasis: 'AI_PROVISIONAL' };
  }

  const plan = assemblePlan(draft, ctx);
  issues.push(...validatePlan(plan, ctx));

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    plan,
    estimates: draft.section4.financeItems.map(estimateFinanceItem),
    issues,
    executionStartable: draft.section5.responsible.name !== null,
    context: ctx,
  };
}
