/* 経営点検の入力を、保存済みデータと既存の計算結果から作る（計算は既存の関数をそのまま使う）。 */
import type { Department, KRStructured } from '@/types/strategy';
import { outlookOf, storedOf, type Stage6ArgsForOutlook } from '@/lib/ceoChat/stage6Plan';
import { planActualItemsForMode, planActualProjectsOf, planActualYearRowsOf } from '@/utils/stage6/planActualComparison';
import { parseFiscalYearEndMonth } from '@/utils/stage6/investmentDemand';
import { progressOf } from '@/lib/stage5/actionProgress';
import {
  detectRiskFacts,
  type ActionInput,
  type CashYearInput,
  type KrInput,
  type PlanGapInput,
  type RiskFact,
  type TargetGapInput,
} from './companionRisk';

export type RiskSourceArgs = Stage6ArgsForOutlook & { departments: unknown; now: Date };

function departmentsOf(value: unknown): Department[] {
  return Array.isArray(value) ? (value as Department[]) : [];
}

function cashAndTargets(args: RiskSourceArgs): { cash: CashYearInput[]; targets: TargetGapInput[] } {
  const stored = storedOf(args.csvFinanceData, args.companyId);
  if (stored.kind !== 'OK') return { cash: [], targets: [] };
  const outlook = outlookOf(args, stored.domain);
  if (!outlook) return { cash: [], targets: [] };
  const cash = outlook.financedPlan.years.map((y) => ({
    year: y.year,
    isForecast: y.kind === 'FORECAST',
    shortfallYen: typeof y.postShortfall.value === 'number' ? y.postShortfall.value : null,
  }));
  const gap = outlook.unifiedPl.gap;
  const targets: TargetGapInput[] = gap
    ? [
        { metric: '売上', fiscalYear: gap.revenue.fiscalYear, gapYen: gap.revenue.valueYen },
        { metric: '営業利益', fiscalYear: gap.operatingIncome.fiscalYear, gapYen: gap.operatingIncome.valueYen },
      ]
    : [];
  return { cash, targets };
}

function planGapsOf(args: RiskSourceArgs): PlanGapInput[] {
  const endMonth = parseFiscalYearEndMonth(args.fiscalYearEnd);
  if (endMonth === null) return [];
  const out: PlanGapInput[] = [];
  for (const project of planActualProjectsOf(departmentsOf(args.departments), args.fiscalYearEnd)) {
    const where = `${project.deptName} / ${project.projectTitle}`;
    for (const item of planActualItemsForMode(project.items, 'REVENUE')) {
      for (const row of planActualYearRowsOf(item, 'REVENUE', endMonth)) {
        if (row.planYen === null) continue;
        out.push({
          label: item.label,
          where,
          fiscalYear: row.fiscalYear,
          planYen: row.planYen,
          actualYen: row.actualYen,
          complete: row.status === 'COMPLETE',
        });
      }
    }
  }
  return out;
}

function krsAndActionsOf(departments: Department[]): { krs: KrInput[]; actions: ActionInput[] } {
  const krs: KrInput[] = [];
  const actions: ActionInput[] = [];
  for (const dept of departments) {
    for (const project of (dept.projects ?? []) as Array<Record<string, unknown>>) {
      const where = `${dept.name ?? ''} / ${String(project.title ?? project.name ?? '')}`;
      for (const kr of (Array.isArray(project.okrsV2) ? project.okrsV2 : []) as KRStructured[]) {
        krs.push({
          label: kr.label,
          where,
          kind: kr.kind,
          unit: kr.unit,
          due: typeof kr.due === 'string' ? kr.due : undefined,
          target: typeof kr.target === 'number' ? kr.target : undefined,
          actual: typeof kr.actual?.value === 'number' ? kr.actual.value : undefined,
        });
      }
      for (const rec of Object.values(progressOf(project))) {
        actions.push({ where, inProgress: rec.status === 'IN_PROGRESS', updatedAt: rec.updatedAt });
      }
    }
  }
  return { krs, actions };
}

export function riskFactsFromStrategy(args: RiskSourceArgs): RiskFact[] {
  const departments = departmentsOf(args.departments);
  const { cash, targets } = cashAndTargets(args);
  const { krs, actions } = krsAndActionsOf(departments);
  return detectRiskFacts({ now: args.now, cash, targets, planGaps: planGapsOf(args), krs, actions });
}
