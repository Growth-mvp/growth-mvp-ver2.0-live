/* 成果見込みの前提から計算結果を作る。前提の保存と金額の反映は別の操作にする（金額は利用者の明示操作だけで書く）。 */
import { IMPACT_FIELD_BY_ROLE, type ImpactRoleKey } from './impactAdoption';

export type ImpactAssumptions = Record<string, number | undefined>;

export const toFiniteNumber = (value: any): number | undefined => {
  if (value === '' || value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const roundImpact = (value: number): number => Math.round(value * 10) / 10;

export function getImpactResultFromAssumptions(role: ImpactRoleKey | undefined, assumptions: ImpactAssumptions | undefined) {
  const a = assumptions ?? {};

  if (role === 'REVENUE') {
    const targetCustomers = toFiniteNumber(a.targetCustomers) ?? 0;
    const conversionRatePct = toFiniteNumber(a.conversionRatePct) ?? 0;
    const averageDealMJPY = toFiniteNumber(a.averageDealMJPY) ?? 0;
    const revenueMJPY = roundImpact(targetCustomers * (conversionRatePct / 100) * averageDealMJPY);
    return {
      resultKey: 'impactRevenueMJPY' as const,
      resultLabel: '売上への見込み効果',
      resultValue: revenueMJPY,
      formula: `${targetCustomers}社 × ${conversionRatePct}% × ${averageDealMJPY}百万円 = ${revenueMJPY}百万円`,
    };
  }

  if (role === 'COST') {
    const currentCostMJPY = toFiniteNumber(a.currentCostMJPY) ?? 0;
    const reductionRatePct = toFiniteNumber(a.reductionRatePct) ?? 0;
    const opIncomeMJPY = roundImpact(currentCostMJPY * (reductionRatePct / 100));
    return {
      resultKey: 'impactOpIncomeMJPY' as const,
      resultLabel: '利益への見込み効果',
      resultValue: opIncomeMJPY,
      formula: `${currentCostMJPY}百万円 × ${reductionRatePct}% = ${opIncomeMJPY}百万円`,
    };
  }

  if (role === 'FUTURE') {
    const peopleCount = toFiniteNumber(a.peopleCount) ?? 0;
    const durationMonths = toFiniteNumber(a.durationMonths) ?? 0;
    const monthlyCostPerPersonMJPY = toFiniteNumber(a.monthlyCostPerPersonMJPY) ?? 0;
    const externalCostMJPY = toFiniteNumber(a.externalCostMJPY) ?? 0;
    const investmentMJPY = roundImpact(peopleCount * durationMonths * monthlyCostPerPersonMJPY + externalCostMJPY);
    return {
      resultKey: 'impactInvestmentMJPY' as const,
      resultLabel: '必要な投資',
      resultValue: investmentMJPY,
      formula: `${peopleCount}人 × ${durationMonths}か月 × ${monthlyCostPerPersonMJPY}百万円 + ${externalCostMJPY}百万円 = ${investmentMJPY}百万円`,
    };
  }

  return null;
}

export function getImpactPreset(role: ImpactRoleKey | undefined, size: 'small' | 'standard' | 'large'): ImpactAssumptions {
  if (role === 'REVENUE') {
    if (size === 'small') return { targetCustomers: 10, conversionRatePct: 10, averageDealMJPY: 10 };
    if (size === 'large') return { targetCustomers: 50, conversionRatePct: 30, averageDealMJPY: 30 };
    return { targetCustomers: 30, conversionRatePct: 20, averageDealMJPY: 20 };
  }

  if (role === 'COST') {
    if (size === 'small') return { currentCostMJPY: 50, reductionRatePct: 10 };
    if (size === 'large') return { currentCostMJPY: 200, reductionRatePct: 20 };
    return { currentCostMJPY: 120, reductionRatePct: 10 };
  }

  if (role === 'FUTURE') {
    if (size === 'small') return { peopleCount: 2, durationMonths: 3, monthlyCostPerPersonMJPY: 1, externalCostMJPY: 4 };
    if (size === 'large') return { peopleCount: 5, durationMonths: 6, monthlyCostPerPersonMJPY: 1.2, externalCostMJPY: 14 };
    return { peopleCount: 3, durationMonths: 6, monthlyCostPerPersonMJPY: 1, externalCostMJPY: 12 };
  }

  return {};
}

/** 前提の保存だけを作る。効果額の欄は変えない */
export function buildAssumptionPatch(current: ImpactAssumptions | undefined, assumptionPatch: ImpactAssumptions) {
  return { impactAssumptions: { ...(current ?? {}), ...assumptionPatch } };
}

/** 利用者が「反映」したときだけ使う。前提から計算した値を、役割に対応する効果額の欄へ入れる */
export function buildReflectPatch(
  role: ImpactRoleKey | undefined,
  assumptions: ImpactAssumptions | undefined,
): Record<string, number> | null {
  const calc = getImpactResultFromAssumptions(role, assumptions);
  if (!calc || !role) return null;
  return { [IMPACT_FIELD_BY_ROLE[role]]: calc.resultValue };
}
