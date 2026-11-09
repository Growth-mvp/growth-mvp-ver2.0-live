/* 実行計画書の「AI作成」のモック。実際のAIは呼ばず、入力から決まる草案を計画エンジンに渡して検証する。
 * 草案は確定KPIや財務の数値を含めない。生成結果は呼び出し側の画面の中だけに置き、データは書き換えない。 */
import { protectedKpisOf } from './assemble';
import { buildPlanContext, type PlanContext } from './context';
import { addMonths } from './period';
import { runExecutionPlanEngine, type ExecutionPlanEngineResult } from './generate';
import { stableIdOf } from './projectResolver';
import { buildPlanSource, type RawPlanInput, type RawPlanStrategy } from './source';
import type { PlanDraft, PlanIssue } from './types';
import { regulatoryConstraintRefs } from './validate';

export const MOCK_PROVISIONAL_MONTHS = 6;
export const SESSION_ID_PREFIX = 'session:';

export type MockPlanResult =
  | { status: 'READY'; bundle: Record<string, unknown>; issues: PlanIssue[] }
  | { status: 'FAILED'; issues: PlanIssue[] };

type Project = Record<string, unknown> & { id?: unknown; title?: unknown };
type Department = Record<string, unknown> & { id?: unknown; projects?: unknown };

/* 安定IDのない部門・プロジェクトに、この作成の間だけ使う一時IDを付ける。元の戦略データは変えない。 */
export function withSessionIds(strategy: RawPlanStrategy): RawPlanStrategy {
  const departments = (Array.isArray(strategy.departments) ? strategy.departments : []) as Department[];
  return {
    ...strategy,
    departments: departments.map((d, di) => {
      const projects = (Array.isArray(d.projects) ? d.projects : []) as Project[];
      return {
        ...d,
        id: d.id ?? `${SESSION_ID_PREFIX}d${di}`,
        projects: projects.map((p, pi) => ({ ...p, id: stableIdOf(p) ?? `${SESSION_ID_PREFIX}d${di}-p${pi}` })),
      };
    }),
  } as RawPlanStrategy;
}

/* 同じ戦略の中で、同じIDのプロジェクトがあれば特定できないので作らない */
export function hasDuplicateProjectIds(strategy: RawPlanStrategy): boolean {
  const departments = (Array.isArray(strategy.departments) ? strategy.departments : []) as Department[];
  const ids = departments.flatMap((d) =>
    ((Array.isArray(d.projects) ? d.projects : []) as Project[]).map((p) => stableIdOf(p))
  );
  const present = ids.filter((x): x is string => x !== null);
  return new Set(present).size !== present.length;
}

/* 入力から決まる草案。根拠のない内容は PROPOSAL（提案）か HYPOTHESIS（仮説）として出し、確定の印は付けない。 */
export function buildMockDraft(ctx: PlanContext, endYm: string, endFromInput: boolean): PlanDraft {
  const title = ctx.projectTitle;
  const kpis = protectedKpisOf(ctx);
  const first = kpis[0];
  const kpiKeys = first ? [first.key] : [];
  const owner = ctx.ownerCandidates[0] ?? '担当部門';
  const due = (months: number) => {
    const ym = addMonths(ctx.startYm, months);
    return ym <= endYm ? ym : endYm;
  };
  const claim = (text: string, basis: 'PROPOSAL' | 'HYPOTHESIS' = 'PROPOSAL') => ({ text, basis, sourceRefs: [] as string[] });
  const mechanism = (stateChange: string, whyItMatters: string) => ({ obstacleRefs: [1], stateChange, whyItMatters });
  const constraints = regulatoryConstraintRefs(ctx);
  const obstacles = [
    { text: '現状の数字と原因が、まだ分かっていない', basis: 'HYPOTHESIS' as const, verifyBy: '現状値を集計し、原因の仮説を確かめる', sourceRefs: [] as string[] },
    ...(constraints.length > 0
      ? [{ text: '規制・安全の制約への対応が、まだ決まっていない', basis: 'HYPOTHESIS' as const, verifyBy: '制約の内容を確かめ、対応の要否を決める', sourceRefs: constraints }]
      : []),
  ];

  return {
    provisionalPeriod: endFromInput
      ? null
      : { endYm, reason: `入力に期限がないため、${MOCK_PROVISIONAL_MONTHS}か月を仮に置いた` },
    section1: {
      customerProblem: claim(`「${title}」で顧客が困っている点を、現状の数字で確かめる`),
      problemCause: claim(`「${title}」が思うように進まない原因は、まだ確かめられていない`, 'HYPOTHESIS'),
      ourValue: claim(`「${title}」を通じて、自社の強みを顧客の成果につなげる`),
      whyChosen: claim(`「${title}」は、今の強みを活かしやすい取り組みとして選んだ`),
      customerOutcome: claim(first ? `${first.label}が改善し、顧客の成果が見える状態` : '顧客の成果が見える状態'),
      companyResult: claim(`「${title}」の成果が、会社の数字に反映される状態`),
      goalState: claim(first ? `${first.label}を、確定した目標に近づける` : `「${title}」の目標が達成された状態`),
      obstacles,
    },
    section2: {
      actions: [
        {
          order: 1,
          title: '現状の数値と原因を集める',
          ownerRole: owner,
          dueYm: due(1),
          dependsOn: [],
          basis: 'PROPOSAL',
          sourceRefs: [],
          supportsKpiKeys: kpiKeys,
          mechanism: mechanism('原因の仮説を、数字で確かめられる状態', '原因が分かれば、打ち手を絞れる'),
        },
        {
          order: 2,
          title: '原因に効く打ち手を一つ試す',
          ownerRole: owner,
          dueYm: due(3),
          dependsOn: [1],
          basis: 'PROPOSAL',
          sourceRefs: [],
          supportsKpiKeys: [],
          mechanism: mechanism('打ち手の効果が、数字で見える状態', '効果が見えれば、続けるかを判断できる'),
        },
        {
          order: 3,
          title: '結果を測り、続けるかを決める',
          ownerRole: owner,
          dueYm: due(5),
          dependsOn: [2],
          basis: 'PROPOSAL',
          sourceRefs: [],
          supportsKpiKeys: kpiKeys,
          mechanism: mechanism('続けるか、やめるかが数字で決まる状態', '判断の根拠が残り、次の計画に使える'),
        },
      ],
    },
    section3: { kpis: [], stage3Review: [] },
    section4: { financeItems: [] },
    section5: {
      responsible: { name: null, basis: 'UNCONFIRMED', note: '担当者は、利用者が決める' },
      roles: [],
      budget: null,
      risks: [],
      preconditions: [],
    },
    verificationItems: [
      {
        item: '実行の前に、現状の数値（行動1で集める数字）を確認する',
        priority: 'BEFORE_START',
        confirmBy: null,
        sourceRefs: [],
      },
      { item: '原因の仮説が外れた場合の扱いを決める', priority: 'DETAIL', confirmBy: null, sourceRefs: [] },
    ],
  };
}

const SWOT_LABELS: Array<[keyof RawPlanStrategy, string]> = [
  ['strength', '強み'],
  ['weakness', '弱み'],
  ['opportunity', '機会'],
  ['threat', '脅威'],
];

export async function generateMockExecutionPlan(args: {
  strategy: RawPlanStrategy;
  membershipCompanyId: string;
  requestedStrategyId: string;
  requestedProjectId: string;
  currentYm: string;
  companyName: string;
  createdAt: string;
}): Promise<MockPlanResult> {
  if (hasDuplicateProjectIds(args.strategy)) {
    return { status: 'FAILED', issues: [{ severity: 'error', code: 'PROJECT_AMBIGUOUS', path: 'projectId', message: '同じIDのプロジェクトが複数あるため、対象を特定できない' }] };
  }
  const missing = SWOT_LABELS.filter(([k]) => {
    const v = args.strategy[k];
    return typeof v !== 'string' || !v.trim();
  }).map(([, label]) => label);
  if (missing.length > 0) {
    return {
      status: 'FAILED',
      issues: [{ severity: 'error', code: 'STAGE2_SWOT_MISSING', path: 'swot', message: `STAGE2のSWOT（${missing.join('・')}）が未入力のため、計画書を作れません` }],
    };
  }
  const raw = {
    membershipCompanyId: args.membershipCompanyId,
    requestedStrategyId: args.requestedStrategyId,
    requestedProjectId: args.requestedProjectId,
    currentYm: args.currentYm,
    strategy: withSessionIds(args.strategy),
  };

  try {
    const { source, scope } = buildPlanSource(raw);
    const ctx0 = buildPlanContext(source, scope);
    const endFromInput = ctx0.endYm !== null;
    const endYm = ctx0.endYm ?? addMonths(ctx0.startYm, MOCK_PROVISIONAL_MONTHS);
    const rawOutput = JSON.stringify(buildMockDraft(ctx0, endYm, endFromInput));
    const result: ExecutionPlanEngineResult = await runExecutionPlanEngine({ raw, callModel: async () => rawOutput });
    if (!result.ok || !result.plan || !result.context) return { status: 'FAILED', issues: result.issues };
    return {
      status: 'READY',
      issues: result.issues,
      bundle: {
        caseId: `mock:${args.requestedProjectId}`,
        sentAt: args.createdAt,
        usage: null,
        costUsd: null,
        durationMs: 0,
        finishReason: 'MOCK',
        rawOutputSha256: '',
        rawOutput,
        ok: true,
        executionStartable: result.executionStartable,
        plan: result.plan,
        issues: result.issues,
        estimates: result.estimates,
        checks: [],
        context: { ...result.context, departmentName: result.context.scope.departmentName },
        inputSummary: { companyName: args.companyName },
        mock: true,
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : '作成できませんでした';
    return { status: 'FAILED', issues: [{ severity: 'error', code: 'SCOPE_INVALID', path: '$', message }] };
  }
}

/* 検証用のモデル呼び出し：入力から決まる草案を返す（実際のAIは呼ばない） */
export function createMockModel(raw: RawPlanInput): (prompt: string) => Promise<{ text: string; finishReason: string; model: string }> {
  const { source, scope } = buildPlanSource(raw);
  const ctx0 = buildPlanContext(source, scope);
  const endFromInput = ctx0.endYm !== null;
  const endYm = ctx0.endYm ?? addMonths(ctx0.startYm, MOCK_PROVISIONAL_MONTHS);
  const text = JSON.stringify(buildMockDraft(ctx0, endYm, endFromInput));
  return async () => ({ text, finishReason: "MOCK", model: "mock" });
}
