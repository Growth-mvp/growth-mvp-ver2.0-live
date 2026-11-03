import type { Department } from '@/types/strategy';
import { computeFinanceEffect } from '@/lib/financeEffect';
import { parseFiscalYearEndMonth } from './investmentDemand';
import type { CfAssumptions } from './cashflow';

/** 経営目標への補間（目標経路）を外した前提。目標を入れていても現状延長（基準年度の横置き）になる */
export function withoutTargetPath(assumptions: CfAssumptions): CfAssumptions {
  return { ...assumptions, targetRevenueYen: null, targetOperatingIncomeYen: null, targetYear: null };
}

export type FinanceEffectTrialTarget = { deptName: string; projectTitle: string };

export type FinanceEffectTrialExclusion = FinanceEffectTrialTarget & { reason: string };

export type FinanceEffectTrialYear = {
  fiscalYear: number;
  revenueYen: number;
  operatingEffectYen: number;
};

export type FinanceEffectTrial = {
  ready: boolean;
  notSetCount: number;
  included: (FinanceEffectTrialTarget & { kind: 'REVENUE_UP' | 'COST_REDUCTION' | 'COST_INCREASE' })[];
  excluded: FinanceEffectTrialExclusion[];
  revenueCostUnknown: FinanceEffectTrialTarget[];
  legacyReferenced: FinanceEffectTrialTarget[];
  years: FinanceEffectTrialYear[];
};

type Flow = FinanceEffectTrialTarget & {
  kind: 'REVENUE_UP' | 'COST_REDUCTION' | 'COST_INCREASE';
  startIdx: number;
  endIdx: number | null;
  perMonthYen: number;
};

const monthIndexOf = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;

export function buildFinanceEffectTrial(args: {
  departments: Department[] | null | undefined;
  fiscalYearEnd: string | undefined;
  fiscalYears: number[];
}): FinanceEffectTrial {
  const endMonth = parseFiscalYearEndMonth(args.fiscalYearEnd);
  const trial: FinanceEffectTrial = {
    ready: endMonth !== null,
    notSetCount: 0,
    included: [],
    excluded: [],
    revenueCostUnknown: [],
    legacyReferenced: [],
    years: [],
  };
  if (endMonth === null) return trial;

  const flows: Flow[] = [];
  for (const dept of args.departments ?? []) {
    for (const project of dept.projects ?? []) {
      const target = { deptName: dept.name || '（部署名なし）', projectTitle: project.title || '（施策名なし）' };
      const effect = project.financeEffect;
      const result = computeFinanceEffect(effect);

      if (result.status === 'NOT_SET') {
        trial.notSetCount += 1;
        continue;
      }
      if (result.status === 'NOT_FINANCIAL') {
        trial.excluded.push({ ...target, reason: '非財務の効果のため、財務試算には含めない' });
        continue;
      }
      if (result.status === 'INCOMPLETE') {
        trial.excluded.push({ ...target, reason: `入力不足のため未算定：${result.missing.join('、')}` });
        continue;
      }
      if (result.status === 'DRAFT' || !effect) {
        trial.excluded.push({ ...target, reason: '利用者が未確認（確認すると試算に入ります）' });
        continue;
      }

      const kind = effect.kind as Flow['kind'];
      const startIdx = monthIndexOf(effect.startYm!);
      const endIdx = effect.endYm ? monthIndexOf(effect.endYm) : null;
      const perMonthYen =
        effect.amountBasis === 'TOTAL'
          ? result.totalYen! / (endIdx === null ? 1 : endIdx - startIdx + 1)
          : result.monthlyYen!;
      const flowEnd = effect.amountBasis === 'TOTAL' && endIdx === null ? startIdx : endIdx;

      flows.push({ ...target, kind, startIdx, endIdx: flowEnd, perMonthYen });
      trial.included.push({ ...target, kind });
      if (kind === 'REVENUE_UP') trial.revenueCostUnknown.push(target);
      if (project.impactRevenueMJPY !== undefined || project.impactOpIncomeMJPY !== undefined) {
        trial.legacyReferenced.push(target);
      }
    }
  }

  trial.years = args.fiscalYears.map((fiscalYear) => {
    const fyStart = (fiscalYear - 1) * 12 + endMonth;
    const fyEnd = fiscalYear * 12 + endMonth - 1;
    let revenueYen = 0;
    let operatingEffectYen = 0;
    for (const flow of flows) {
      const from = Math.max(fyStart, flow.startIdx);
      const to = Math.min(fyEnd, flow.endIdx ?? Number.POSITIVE_INFINITY);
      const months = Math.max(0, to - from + 1);
      if (months === 0) continue;
      const amount = months * flow.perMonthYen;
      if (flow.kind === 'REVENUE_UP') revenueYen += amount;
      else operatingEffectYen += flow.kind === 'COST_INCREASE' ? -amount : amount;
    }
    return { fiscalYear, revenueYen, operatingEffectYen };
  });

  return trial;
}
