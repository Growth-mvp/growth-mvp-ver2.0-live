/* 経営点検の入力を、保存済みデータと既存の計算結果から作る（計算は既存の関数をそのまま使う）。
 * 判断できなかった項目は事実にせず、理由（未登録・未算定・取得失敗・判断材料不足）として返す。 */
import type { Department, KRStructured } from '@/types/strategy';
import { outlookOf, storedOf, type Stage6ArgsForOutlook } from '@/lib/ceoChat/stage6Plan';
import type { PlTarget } from '@/utils/stage6/unifiedPl';
import { buildUnifiedPl, type UnifiedPlMetricGap } from '@/utils/stage6/unifiedPl';
import { planActualItemsForMode, planActualProjectsOf, planActualYearRowsOf } from '@/utils/stage6/planActualComparison';
import { parseFiscalYearEndMonth } from '@/utils/stage6/investmentDemand';
import { progressOf } from '@/lib/stage5/actionProgress';
import {
  TARGET_SOURCE_LABEL,
  detectRiskFacts,
  type ActionInput,
  type CashYearInput,
  type KrInput,
  type PlanGapInput,
  type RiskFact,
  type TargetGapInput,
  type TargetSource,
} from './companionRisk';

export type RiskSourceArgs = Stage6ArgsForOutlook & { departments: unknown; now: Date };

export type RiskInputs = { facts: RiskFact[]; coverage: string[] };

const BLOCKING_HOLD = /未入力|未設定|算出できません|不足|判定できません/;

function departmentsOf(value: unknown): Department[] {
  return Array.isArray(value) ? (value as Department[]) : [];
}

function yearsLabel(years: number[]): string {
  return years.map((y) => `${y}年度`).join('・');
}

function planActualGapsOf(args: RiskSourceArgs): PlanGapInput[] {
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

function yenText(v: number): string {
  return `${Math.round(v).toLocaleString('ja-JP')}円`;
}

function targetOf(value: number | null, due: number | null): string {
  return `${due !== null ? `${due}年度` : '年度未設定'}・${value !== null ? yenText(value) : '金額未設定'}`;
}

type FinanceJudgement = { cash: CashYearInput[]; targets: TargetGapInput[]; coverage: string[] };

/** 資金繰りと経営目標の差。STAGE2の業績目標とSTAGE6の経営目標を、それぞれ既存の統一PL計算で比べる */
function judgeFinance(args: RiskSourceArgs): FinanceJudgement {
  const coverage: string[] = [];
  const stored = storedOf(args.csvFinanceData, args.companyId);
  const domain = stored.kind === 'OK' ? stored.domain : null;
  const outlook = outlookOf(args, domain);
  if (!outlook) {
    coverage.push('- 資金繰り・経営目標との差：未算定（資金繰り試算の結果が得られませんでした）');
    return { cash: [], targets: [], coverage };
  }

  let cash: CashYearInput[] = [];
  if (stored.kind === 'NONE') {
    coverage.push('- 資金繰り：未登録（STAGE6の資金計画が保存されていません）');
  } else if (stored.kind !== 'OK') {
    coverage.push('- 資金繰り・STAGE6の経営目標：取得失敗（保存済みの資金計画を読めませんでした）');
  } else if (stored.domain.newLoans.length === 0) {
    const years = outlook.financedPlan.years.filter((y) => y.kind === 'FORECAST').map((y) => y.year);
    coverage.push(
      `- 資金繰り（${yearsLabel(years)}）：判断材料不足（新規借入が未入力です。0円とは見なしていません。借入の予定がない場合は、0円の行を入力してください）`,
    );
  } else {
    const forecast = outlook.financedPlan.years.filter((y) => y.kind === 'FORECAST');
    const unknown = forecast.filter((y) => typeof y.postShortfall.value !== 'number');
    if (unknown.length > 0) {
      const reasons = [
        ...new Set(unknown.flatMap((y) => y.holds.filter((h) => BLOCKING_HOLD.test(h)))),
      ];
      coverage.push(
        `- 資金繰り（${yearsLabel(unknown.map((y) => y.year))}）：判断材料不足（${reasons.length > 0 ? reasons.join('、') : unknown[0].postShortfall.note}）`,
      );
    }
    cash = forecast.map((y) => ({
      year: y.year,
      isForecast: true,
      shortfallYen: typeof y.postShortfall.value === 'number' ? y.postShortfall.value : null,
    }));
  }

  const stage2: PlTarget = outlook.target;
  const stage6: PlTarget | null = domain
    ? {
        revenueYen: domain.assumptions.targetRevenueYen,
        revenueDueYear: domain.assumptions.targetYear,
        operatingIncomeYen: domain.assumptions.targetOperatingIncomeYen,
        operatingIncomeDueYear: domain.assumptions.targetYear,
      }
    : null;
  const stage6Gap = stage6
    ? buildUnifiedPl({
        baseline: outlook.unifiedPl.years.map((y) => ({
          fiscalYear: y.fiscalYear,
          revenueYen: y.baseline.revenueYen,
          operatingIncomeYen: y.baseline.operatingIncomeYen,
        })),
        effects: outlook.effectTrial.years,
        target: stage6,
      }).gap
    : null;

  const targets: TargetGapInput[] = [];
  const metrics = [
    {
      metric: '売上' as const,
      s2: { value: stage2.revenueYen, due: stage2.revenueDueYear, gap: outlook.unifiedPl.gap?.revenue ?? null },
      s6: stage6 ? { value: stage6.revenueYen, due: stage6.revenueDueYear, gap: stage6Gap?.revenue ?? null } : null,
    },
    {
      metric: '営業利益' as const,
      s2: { value: stage2.operatingIncomeYen, due: stage2.operatingIncomeDueYear, gap: outlook.unifiedPl.gap?.operatingIncome ?? null },
      s6: stage6
        ? { value: stage6.operatingIncomeYen, due: stage6.operatingIncomeDueYear, gap: stage6Gap?.operatingIncome ?? null }
        : null,
    },
  ];

  const addGap = (metric: '売上' | '営業利益', source: TargetSource, gap: UnifiedPlMetricGap | null) => {
    if (!gap) return;
    if (gap.valueYen !== null) {
      targets.push({ metric, source, fiscalYear: gap.fiscalYear, gapYen: gap.valueYen });
      return;
    }
    coverage.push(
      `- ${metric}との差（${TARGET_SOURCE_LABEL[source]}）：判断材料不足（${gap.reason ?? '差を算出できません'}）`,
    );
  };

  let anyTarget = false;
  for (const m of metrics) {
    const s2Set = m.s2.value !== null;
    const s6Set = m.s6 !== null && m.s6.value !== null;
    if (s2Set || s6Set) anyTarget = true;
    if (s2Set) addGap(m.metric, 'STAGE2', m.s2.gap);
    if (!s6Set || !m.s6) continue;
    const same = s2Set && m.s6.value === m.s2.value && m.s6.due === m.s2.due;
    if (same) continue;
    if (s2Set) {
      coverage.push(
        `- ${m.metric}の経営目標：不整合（STAGE2は${targetOf(m.s2.value, m.s2.due)}、STAGE6は${targetOf(m.s6.value, m.s6.due)}。両方の目標で差を示しています）`,
      );
    }
    addGap(m.metric, 'STAGE6', m.s6.gap);
  }
  if (!anyTarget) {
    coverage.push('- 経営目標との差：未登録（STAGE2の業績目標もSTAGE6の経営目標も保存されていません）');
  }

  return { cash, targets, coverage };
}

/** 点検の入力（事実）と、判断できなかった項目を返す。事実が無くても判断材料の状態を返す */
export function riskInputsOf(args: RiskSourceArgs): RiskInputs {
  const departments = departmentsOf(args.departments);
  const finance = judgeFinance(args);
  const { krs, actions } = krsAndActionsOf(departments);
  const coverage = [...finance.coverage];

  if (parseFiscalYearEndMonth(args.fiscalYearEnd) === null) {
    coverage.push('- 売上効果の計画と実績：判断材料不足（決算月が未設定のため、年度を決められません）');
  }
  if (krs.length === 0) {
    coverage.push('- KRの期限：未登録（部門の施策にKRがありません）');
  } else {
    const noDue = krs.filter((k) => !k.due).length;
    if (noDue > 0) coverage.push(`- KRの期限：判断材料不足（期限が未入力のKRが${noDue}件あり、期限超過は判定していません）`);
  }
  if (actions.length === 0) coverage.push('- 実施事項の進捗：未登録（進捗が1件も記録されていません）');

  const facts = detectRiskFacts({
    now: args.now,
    cash: finance.cash,
    targets: finance.targets,
    planGaps: planActualGapsOf(args),
    krs,
    actions,
  });
  return { facts, coverage };
}
