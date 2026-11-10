import type { StrategyData } from '@/types/strategy';
import { resolvePlanScope, type PlanScope } from './scope';
import { PlanSourceSchema, type PlanSource } from './types';
import { kpiBasisOf } from './kpiBasis';

/** summary は、既存画面で strategiesDataGlobal.data.summary（全社戦略の要約）から取る値 */
export type RawPlanStrategy = Partial<StrategyData> & { id: string; company_id: string; summary?: string };

export type RawPlanInput = {
  membershipCompanyId: string;
  requestedStrategyId: string;
  requestedProjectId: string;
  currentYm: string;
  strategy: RawPlanStrategy;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((x): x is string => x !== null) : [];
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ymOf = (v: unknown): string | null => {
  const t = str(v);
  return t && /^\d{4}-\d{2}/.test(t) ? t.slice(0, 7) : null;
};
const hypothesisOf = (h: unknown): string | null => {
  if (typeof h === 'string') return str(h);
  if (h && typeof h === 'object') return str((h as { statement?: unknown }).statement);
  return null;
};
const fiscalMonthOf = (v: unknown): number | null => {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
};
const toMYen = (yen: unknown): number | null => {
  const n = num(yen);
  return n === null ? null : Math.round((n / 1_000_000) * 10) / 10;
};

type RawDept = {
  id?: string | number;
  name: string;
  mission?: string;
  strategicRole?: string;
  keyIssues?: unknown;
  interDeptCollab?: unknown;
  alignmentRiskPoints?: unknown;
  winPatternPrimary?: unknown;
  winPatternSecondary?: unknown;
  focusLevers?: unknown;
  projects: Array<Record<string, unknown> & { id?: string | number; title?: string }>;
};

function kpisOfProject(project: Record<string, unknown>) {
  const list = Array.isArray(project.okrsV2) ? (project.okrsV2 as Array<Record<string, unknown>>) : [];
  return list.map((k, i) => ({
    // 番号のない既存のKPIは、順番から一時的な番号を付ける（STAGE3には書き戻さない）
    id: String(k.id ?? '') || `unnumbered-kpi-${i + 1}`,
    label: str(k.label) ?? '',
    target: num(k.target),
    unit: str(k.unit) ?? '',
    due: ymOf(k.due),
    owner: str(k.owner),
    basis: kpiBasisOf(k),
  }));
}

function financeFrom(strategy: RawPlanStrategy) {
  const rows = (strategy.financePL ?? [])
    .filter((r) => typeof r.year === 'number' && typeof r.revenue === 'number' && r.revenue > 0)
    .sort((a, b) => b.year - a.year)
    .slice(0, 5);
  const latest = rows[0];
  const va = strategy.valueAnalysis;
  const derivedMargin =
    latest && typeof latest.operatingIncome === 'number' && latest.revenue
      ? Math.round((latest.operatingIncome / latest.revenue) * 1000) / 10
      : null;
  return {
    financeYears: rows.map((r) => ({
      year: r.year,
      revenueMYen: toMYen(r.revenue),
      operatingIncomeMYen: toMYen(r.operatingIncome),
    })),
    operatingMarginPct: num(va?.operatingMarginPctLatest) ?? derivedMargin,
    roicPct: num(va?.roic),
    waccPct: num(va?.wacc),
  };
}

/** 呼び出し元の所属・要求された戦略/プロジェクトを照合したうえで、関連モジュールに渡す入力を組み立てる（DBには触れない） */
export function buildPlanSource(raw: RawPlanInput): { source: PlanSource; scope: PlanScope } {
  const strategy = raw.strategy;
  const departments = (strategy.departments ?? []) as unknown as RawDept[];

  const scope = resolvePlanScope({
    membershipCompanyId: raw.membershipCompanyId,
    requestedStrategyId: raw.requestedStrategyId,
    requestedProjectId: raw.requestedProjectId,
    strategy: { id: strategy.id, company_id: strategy.company_id },
    departments,
  });

  const dept = departments.find((d) => String(d.id ?? '') === scope.departmentId) ?? departments[0];
  const project = dept.projects.find((p) => String(p.id ?? '') === scope.projectId)!;
  const mid = strategy.midtermStrategy;

  const answers = (strategy.answers2 ?? []).flatMap((ch) =>
    (ch.steps ?? [])
      .filter((s) => str(s.answer))
      .map((s) => ({ chapterTitle: ch.chapterTitle, question: s.question, answer: s.answer }))
  );

  const bridge = strategy.stage3_strategy_bridge;
  const otherDepartments = departments
    .filter((d) => String(d.id ?? '') !== scope.departmentId)
    .map((d) => ({
      id: String(d.id ?? d.name),
      name: d.name,
      projects: d.projects.map((p) => ({
        title: str(p.title) ?? '',
        kpiLabels: kpisOfProject(p).map((k) => k.label).filter(Boolean),
      })),
    }));

  const input = {
    companyId: scope.companyId,
    strategyId: scope.strategyId,
    projectId: scope.projectId,
    currentYm: raw.currentYm,
    companySummary: str(strategy.summary),
    period: {
      projectDeadlineYm: ymOf((project as { deadline?: unknown }).deadline),
      companyEndYear: str(strategy.periodEndYear),
      fiscalYearEndMonth: fiscalMonthOf(strategy.fiscalYearEnd),
    },
    stage1: financeFrom(strategy),
    stage2: {
      swot: {
        strength: str(strategy.strength) ?? '',
        weakness: str(strategy.weakness) ?? '',
        opportunity: str(strategy.opportunity) ?? '',
        threat: str(strategy.threat) ?? '',
      },
      finalStory: (strategy.finalStory ?? []).map((c) => ({ title: c.title ?? '', body: c.body ?? '' })),
      customerValue: str(mid?.strategicCore?.customerValue),
      priorityThemes: strs(mid?.priorityStrategicThemes),
      decisionCriteria: strs(mid?.companyWideDecisionCriteria),
      deploymentPrinciples: strs(mid?.deploymentPrinciplesForUnits),
      evidence: answers.slice(0, 40),
    },
    stage3: {
      department: {
        id: scope.departmentId,
        name: dept.name,
        mission: str(dept.mission) ?? '',
        strategicRole: str(dept.strategicRole),
        keyIssues: strs(dept.keyIssues),
        interDeptCollab: strs(dept.interDeptCollab),
        alignmentRiskPoints: strs(dept.alignmentRiskPoints),
        winPatterns: [str(dept.winPatternPrimary), str(dept.winPatternSecondary)].filter((x): x is string => !!x),
        focusLevers: strs(dept.focusLevers),
      },
      project: {
        id: scope.projectId,
        title: str(project.title) ?? '',
        hypothesis: hypothesisOf(project.hypothesis),
        rationale: str(project.rationale),
        role: (['REVENUE', 'COST', 'FUTURE'] as const).find((r) => r === project.role) ?? null,
        ownerName: str(project.ownerName),
        kpis: kpisOfProject(project),
      },
      bridge: bridge
        ? {
            keyThemes: strs(bridge.keyThemes),
            departmentIssues: strs(bridge.departmentIssues),
            commonBehaviorChanges: strs(bridge.commonBehaviorChanges),
          }
        : null,
      otherDepartments,
    },
  };

  return { source: PlanSourceSchema.parse(input), scope };
}
