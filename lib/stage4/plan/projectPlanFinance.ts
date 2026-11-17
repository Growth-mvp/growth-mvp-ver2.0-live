import { computeFinanceEffect, type FinanceEffectResult } from '@/lib/financeEffect';
import { isInvestmentRecord } from '@/lib/stage4/planView/investmentRows';
import type { ExecutionHumanInvestment, FinanceEffect } from '@/types/strategy';
import { buildFinanceEffectTrial, type FinanceEffectProjectStatus } from '@/utils/stage6/financeEffectPlan';
import { hasConfirmedAddCost, opexDecisionsOf, type OpexDecisionStatus } from '@/utils/stage6/opexDeduction';

type Departments = Parameters<typeof buildFinanceEffectTrial>[0]['departments'];

export type ProjectPlanEffect = {
  effect: FinanceEffect;
  result: FinanceEffectResult;
  stage6: { status: FinanceEffectProjectStatus; reason: string | null };
};

export type ProjectPlanInvestment = {
  record: ExecutionHumanInvestment;
  opex: { status: OpexDecisionStatus; reason: string | null } | null;
};

export type ProjectPlanFinance = {
  effects: ProjectPlanEffect[];
  investments: ProjectPlanInvestment[];
};

function positionOf(departments: Departments, projectId: string): { deptIndex: number; projectIndex: number } | null {
  let found: { deptIndex: number; projectIndex: number } | null = null;
  let count = 0;
  (departments ?? []).forEach((dept, deptIndex) => {
    (dept.projects ?? []).forEach((project, projectIndex) => {
      if (String(project?.id ?? '') !== projectId) return;
      count += 1;
      found = { deptIndex, projectIndex };
    });
  });
  return count === 1 ? found : null;
}

/* 1件の施策の、保存済みの財務効果と投資・追加費用。STAGE6の反映状態は、STAGE6と同じ試算の判定を使う。
 * 会計年度末が未設定、または施策を特定できない（同じIDが複数）ときは null（出力しない）。 */
export function projectPlanFinanceOf(args: { departments: unknown; fiscalYearEnd: string | undefined; projectId: string }): ProjectPlanFinance | null {
  const departments = args.departments as Departments;
  if (!Array.isArray(departments) || !args.projectId) return null;
  const pos = positionOf(departments, args.projectId);
  if (!pos) return null;
  const trial = buildFinanceEffectTrial({ departments, fiscalYearEnd: args.fiscalYearEnd, fiscalYears: [] });
  if (!trial.ready) return null;

  const project = departments[pos.deptIndex].projects[pos.projectIndex];
  const effects = [project.financeEffect, ...(Array.isArray(project.financeEffects) ? project.financeEffects : [])].filter(
    (e): e is FinanceEffect => !!e && typeof e === 'object',
  );
  const projectHasCostIncrease = hasConfirmedAddCost(effects);
  const isThisProject = (r: { deptIndex: number; projectIndex: number; source?: string }) =>
    r.deptIndex === pos.deptIndex && r.projectIndex === pos.projectIndex && r.source === undefined;

  const effectRows: ProjectPlanEffect[] = effects.map((effect, effectIndex) => {
    const row = trial.projects.find((r) => isThisProject(r) && r.effectIndex === effectIndex);
    return {
      effect,
      result: computeFinanceEffect(effect, { projectHasCostIncrease }),
      stage6: { status: row?.status ?? 'NOT_SET', reason: row?.reason ?? null },
    };
  });

  const opexByRecord = new Map(
    opexDecisionsOf(departments, args.fiscalYearEnd)
      .filter((d) => d.deptIndex === pos.deptIndex && d.projectIndex === pos.projectIndex && d.recordId)
      .map((d) => [String(d.recordId), { status: d.status, reason: d.reason }] as const),
  );
  const investments: ProjectPlanInvestment[] = (Array.isArray(project.executionHumanInvestments) ? project.executionHumanInvestments : [])
    .filter(isInvestmentRecord)
    .map((record) => ({
      record,
      opex: record.spend?.category === 'OPEX' ? opexByRecord.get(String(record.id)) ?? null : null,
    }));

  return { effects: effectRows, investments };
}
