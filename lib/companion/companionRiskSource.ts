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

/** 判断できなかった項目を、理由（未登録・未算定・取得失敗・判断材料不足）ごとに示す。事実が無くても判定する */
export function riskCoverageFromStrategy(args: RiskSourceArgs): string[] {
  const out: string[] = [];
  const stored = storedOf(args.csvFinanceData, args.companyId);

  if (stored.kind === 'NONE') {
    out.push('- 資金繰り：未登録（STAGE6の資金計画が保存されていません）');
  } else if (stored.kind !== 'OK') {
    out.push('- 資金繰り：取得失敗（保存済みの資金計画を読めませんでした）');
  } else {
    const outlook = outlookOf(args, stored.domain);
    if (!outlook) {
      out.push('- 資金繰り・経営目標との差：未算定（資金繰り試算の結果が得られませんでした）');
    } else {
      const unknown = outlook.financedPlan.years.filter((y) => y.kind === 'FORECAST' && typeof y.postShortfall.value !== 'number');
      if (unknown.length > 0) {
        out.push(`- 資金繰り（${unknown.map((y) => `${y.year}年度`).join('・')}）：判断材料不足（${unknown[0].postShortfall.note}）`);
      }
      const gap = outlook.unifiedPl.gap;
      const targets = Array.isArray(args.companyTargets) ? args.companyTargets : [];
      if (targets.length === 0) {
        out.push('- 経営目標との差：未登録（STAGE2の業績目標が保存されていません）');
      } else if (!gap || (gap.revenue.valueYen === null && gap.operatingIncome.valueYen === null)) {
        out.push(`- 経営目標との差：判断材料不足（${gap?.revenue.reason ?? gap?.operatingIncome.reason ?? '見通しが足りず、差を出せません'}）`);
      }
    }
  }

  if (parseFiscalYearEndMonth(args.fiscalYearEnd) === null) {
    out.push('- 売上効果の計画と実績：判断材料不足（決算月が未設定のため、年度を決められません）');
  }

  const { krs, actions } = krsAndActionsOf(departmentsOf(args.departments));
  if (krs.length === 0) {
    out.push('- KRの期限：未登録（部門の施策にKRがありません）');
  } else {
    const noDue = krs.filter((k) => !k.due).length;
    if (noDue > 0) out.push(`- KRの期限：判断材料不足（期限が未入力のKRが${noDue}件あり、期限超過は判定していません）`);
  }
  if (actions.length === 0) out.push('- 実施事項の進捗：未登録（進捗が1件も記録されていません）');

  return out;
}
