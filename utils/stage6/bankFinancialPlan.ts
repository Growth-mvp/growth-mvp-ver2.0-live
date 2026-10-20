import type { Department } from '@/types/strategy';
import type { CashFlowPlan, CfBasis, CfValue, CfYear } from './cashflow';
import type { DebtSchedule } from './debt';
import {
  FINANCE_PLAN_CALC_VERSION,
  canRestoreFor,
  hashOf,
  readStoredFinancePlan,
  toSavedFinancePlan,
  type FinancePlanDomain,
} from './financePlanSnapshot';
import { computeStage6FinancePlan } from './financePlanPipeline';
import { stage6SourceInputsFromRow, type Stage6SourceInputs } from './bankFinancialPlanSource';
import type { InvestmentItem } from './investmentDemand';

export type BankFinancialPlanStatus =
  | 'CURRENT'
  | 'STALE'
  | 'NOT_SAVED'
  | 'DIFFERENT_COMPANY'
  | 'INVALID'
  | 'UNAVAILABLE';

export type RegisteredTarget = {
  label: string;
  valueYen: number | null;
  dueYear: number | null;
  approval: 'REGISTERED_NOT_APPROVED';
  note: string;
};

export type GapEntry = {
  targetYen: number | null;
  projectedYen: number | null;
  differenceYen: number | null;
  reason: string | null;
  explanation: { available: false; note: string };
};

export type BankFinancialPlanBlock = {
  schemaVersion: 1;
  status: BankFinancialPlanStatus;
  numbersConfirmed: boolean;
  statusReasons: string[];
  amountUnit: 'JPY';
  companyId: string | null;
  strategyId: string | null;
  reproducibility: {
    calcVersion: string;
    savedCalcVersion: string | null;
    savedAt: string | null;
    savedAssumptionsHash: string | null;
    currentAssumptionsHash: string | null;
    savedSourceHash: string | null;
    currentSourceHash: string | null;
    computedYear: number;
    computedAt: string;
  };
  sections: BankFinancialPlanSections | null;
};

export type BankFinancialPlanSections = {
  financialTargets: {
    baseYear: number | null;
    baseYearRevenueYen: number | null;
    baseYearOperatingIncomeYen: number | null;
    stage2Registered: { revenue: RegisteredTarget | null; operatingIncome: RegisteredTarget | null };
    stage6Scenario: {
      targetYear: number | null;
      revenueYen: number | null;
      operatingIncomeYen: number | null;
      basis: 'USER' | 'ESTIMATE';
      note: string;
    };
    stage4Contributions: {
      revenueYen: number | null;
      operatingIncomeYen: number | null;
      projectCount: number;
      missingValueCount: number;
      note: string;
    };
    gaps: { revenue: GapEntry; operatingIncome: GapEntry };
  };
  revenuePlan: {
    years: {
      year: number;
      kind: 'ACTUAL' | 'FORECAST';
      revenue: CfValue;
      operatingIncome: CfValue;
      operatingMarginRate: CfValue;
    }[];
  };
  investmentPlan: {
    fiscalYearEndMonth: number | null;
    fiscalYearBucketing: 'CONFIRMED' | 'ASSUMED_DECEMBER';
    byFiscalYear: { fiscalYear: number; capexYen: number; opexReferenceYen: number; otherYen: number }[];
    readyYen: number;
    approvedReadyYen: number;
    unapprovedReadyYen: number;
    unresolved: {
      unclassifiedYen: number;
      unclassifiedCount: number;
      unscheduledYen: number;
      candidateYen: number;
      candidateCount: number;
      basisPendingYen: number;
      basisPendingCount: number;
      unitPendingCount: number;
      missingCount: number;
    };
    sources: {
      label: string;
      deptName: string;
      projectTitle: string;
      source: InvestmentItem['source'];
      sourceField: string;
      category: InvestmentItem['category'];
      amountYen: number | null;
      amountStatus: InvestmentItem['amountStatus'];
      totalYen: number | null;
      duplicateStatus: InvestmentItem['duplicateStatus'];
      counted: boolean;
      ready: boolean;
      planStatus: string | null;
    }[];
    note: string;
  };
  cashFlow: {
    baseYear: number | null;
    bsBaseYear: number | null;
    yearMismatch: boolean;
    unitSuspects: string[];
    taxRate: CfValue;
    depreciation: CfValue;
    interest: CfValue;
    years: {
      year: number;
      kind: 'ACTUAL' | 'FORECAST';
      operatingCf: CfValue;
      capex: CfValue;
      investingCf: CfValue;
      fcf: CfValue;
      openingCash: CfValue;
      closingCashBeforeFinancing: CfValue;
      minCash: CfValue;
      shortfall: CfValue;
      financingCf: CfValue;
      closingCashAfterFinancing: CfValue;
      postShortfall: CfValue;
      verdict: string;
      holds: string[];
    }[];
  };
  debtRepayment: {
    entered: boolean;
    existingLoansEntered: boolean;
    newLoansEntered: boolean;
    reconciliation: DebtSchedule['reconciliation'];
    years: {
      year: number;
      openingBalance: CfValue;
      draw: CfValue;
      principal: CfValue;
      interest: CfValue;
      debtService: CfValue;
      closingBalance: CfValue;
      newClosingBalance: CfValue;
      existingClosingBalance: CfValue;
      dividends: CfValue;
      dscr: CfValue;
      verdict: string;
      holds: string[];
    }[];
  };
  basisAndConstraints: {
    amountUnit: 'JPY';
    baseYear: number | null;
    bsBaseYear: number | null;
    forecastWindow: number[];
    assumptions: FinancePlanDomain['assumptions'];
    existingLoanCount: number;
    newLoanCount: number;
    fiscalYearEndSet: boolean;
    fiscalYearEndMonth: number | null;
    sourceIdentifiers: { financePLYears: number[]; financeBSYears: number[]; investmentItemCount: number };
    holds: string[];
  };
};

const UNIT_FACTOR: Record<string, number> = { 円: 1, 百万円: 1_000_000, 億円: 100_000_000 };
const NO_EXPLANATION = {
  available: false as const,
  note: '差額を説明する入力データはありません（AIによる補正・説明は行いません）',
};

function parseRegisteredTarget(targets: unknown[], keyword: '売上' | '営業利益'): RegisteredTarget | null {
  const matches = targets.filter((t): t is Record<string, unknown> => {
    if (!t || typeof t !== 'object') return false;
    const label = (t as Record<string, unknown>).label;
    return typeof label === 'string' && label.includes(keyword) && !label.includes('率');
  });
  if (matches.length === 0) return null;
  const t = matches[0];
  const label = String(t.label);
  const dueYear = typeof t.dueYear === 'number' && Number.isInteger(t.dueYear) ? t.dueYear : null;
  const unit = String(t.unit ?? '').trim();
  const rawBase = typeof t.base === 'number' ? t.base : typeof t.base === 'string' && t.base.trim() !== '' ? Number(t.base) : NaN;

  if (matches.length > 1) {
    return { label, valueYen: null, dueYear, approval: 'REGISTERED_NOT_APPROVED', note: '同種の目標が複数登録されているため、どれを使うか確認が必要です' };
  }
  if (!Number.isFinite(rawBase)) {
    return { label, valueYen: null, dueYear, approval: 'REGISTERED_NOT_APPROVED', note: '目標値が数値ではないため金額として扱いません' };
  }
  const factor = UNIT_FACTOR[unit];
  if (factor === undefined) {
    return { label, valueYen: null, dueYear, approval: 'REGISTERED_NOT_APPROVED', note: `単位「${unit || '未入力'}」を金額に換算できないため金額として扱いません` };
  }
  return {
    label,
    valueYen: rawBase * factor,
    dueYear,
    approval: 'REGISTERED_NOT_APPROVED',
    note: 'STAGE2に登録された目標です。承認状態は確認されていません',
  };
}

function stage4Contributions(departments: Department[]) {
  let revenue = 0;
  let operatingIncome = 0;
  let revenueCount = 0;
  let operatingCount = 0;
  let projectCount = 0;
  let missingValueCount = 0;
  for (const dept of departments) {
    for (const p of dept.projects ?? []) {
      projectCount++;
      const r = (p as { impactRevenueMJPY?: unknown }).impactRevenueMJPY;
      const o = (p as { impactOpIncomeMJPY?: unknown }).impactOpIncomeMJPY;
      if (typeof r === 'number' && Number.isFinite(r)) {
        revenue += r * 1_000_000;
        revenueCount++;
      } else {
        missingValueCount++;
      }
      if (typeof o === 'number' && Number.isFinite(o)) {
        operatingIncome += o * 1_000_000;
        operatingCount++;
      }
    }
  }
  return {
    revenueYen: revenueCount > 0 ? revenue : null,
    operatingIncomeYen: operatingCount > 0 ? operatingIncome : null,
    projectCount,
    missingValueCount,
    note: '施策別の期待効果の単純合計です（重複未検証）。既存事業の基礎売上とは別項目で、合算していません',
  };
}

function gapFor(target: RegisteredTarget | null, plan: CashFlowPlan, pick: (y: CfYear) => CfValue): GapEntry {
  const base = { explanation: NO_EXPLANATION };
  if (!target) return { ...base, targetYen: null, projectedYen: null, differenceYen: null, reason: 'STAGE2に正式目標が登録されていません' };
  if (target.dueYear === null) return { ...base, targetYen: target.valueYen, projectedYen: null, differenceYen: null, reason: '目標年度が未登録のため比較できません' };
  if (target.valueYen === null) return { ...base, targetYen: null, projectedYen: null, differenceYen: null, reason: target.note };
  const year = plan.years.find((y) => y.year === target.dueYear && y.kind === 'FORECAST');
  if (!year) return { ...base, targetYen: target.valueYen, projectedYen: null, differenceYen: null, reason: `STAGE6の推計期間に目標年度（${target.dueYear}年）が含まれません` };
  const projected = pick(year).value;
  if (projected === null) return { ...base, targetYen: target.valueYen, projectedYen: null, differenceYen: null, reason: '推計値を算出できないため比較を保留します' };
  return { ...base, targetYen: target.valueYen, projectedYen: projected, differenceYen: projected - target.valueYen, reason: null };
}

function ratioOf(revenue: CfValue, operatingIncome: CfValue): CfValue {
  if (revenue.value === null || operatingIncome.value === null || revenue.value <= 0) {
    return { value: null, basis: 'HELD', note: '売上高または営業利益が未確定のため算出していません' };
  }
  const basis: CfBasis = revenue.basis === 'ACTUAL' && operatingIncome.basis === 'ACTUAL' ? 'ACTUAL' : 'ESTIMATE';
  return { value: operatingIncome.value / revenue.value, basis, note: '営業利益÷売上高（計算値）' };
}

function subtractCf(a: CfValue, b: CfValue, note: string): CfValue {
  if (a.value === null || b.value === null) return { value: null, basis: 'HELD', note: '算出に必要な値が未確定です' };
  return { value: a.value - b.value, basis: 'ESTIMATE', note };
}

const emptyReproducibility = (calcVersion: string, currentYear: number, computedAt: string) => ({
  calcVersion,
  savedCalcVersion: null,
  savedAt: null,
  savedAssumptionsHash: null,
  currentAssumptionsHash: null,
  savedSourceHash: null,
  currentSourceHash: null,
  computedYear: currentYear,
  computedAt,
});

function withoutNumbers(
  status: BankFinancialPlanStatus,
  reasons: string[],
  common: Pick<BankFinancialPlanBlock, 'companyId' | 'strategyId' | 'reproducibility'>,
): BankFinancialPlanBlock {
  return { schemaVersion: 1, status, numbersConfirmed: false, statusReasons: reasons, amountUnit: 'JPY', sections: null, ...common };
}

export function buildBankFinancialPlanBlock(args: {
  companyId: string | null;
  strategyId: string | null;
  storedFinancePlan: unknown;
  inputs: Stage6SourceInputs;
  currentYear: number;
  computedAt: string;
}): BankFinancialPlanBlock {
  const { companyId, strategyId, inputs, currentYear, computedAt } = args;
  const common = {
    companyId,
    strategyId,
    reproducibility: emptyReproducibility(FINANCE_PLAN_CALC_VERSION, currentYear, computedAt),
  };

  const stored = readStoredFinancePlan(args.storedFinancePlan, companyId);
  if (stored.kind === 'NONE') {
    return withoutNumbers('NOT_SAVED', ['STAGE6の財務計画が保存されていないため、財務数値は生成しません'], common);
  }
  if (stored.kind === 'DIFFERENT_COMPANY') {
    return withoutNumbers('DIFFERENT_COMPANY', ['保存された財務計画の会社IDが一致しないため使用しません'], common);
  }
  if (stored.kind === 'INVALID') {
    return withoutNumbers('INVALID', [`保存された財務計画を読み込めないため使用しません：${stored.error}`], common);
  }

  const meta = stored.meta;
  const savedRepro = {
    ...common.reproducibility,
    savedCalcVersion: meta.calcVersion,
    savedAt: stored.savedAt,
    savedAssumptionsHash: meta.assumptionsHash,
    savedSourceHash: meta.sourceHash,
  };
  if (!canRestoreFor(meta.companyId, companyId)) {
    return withoutNumbers('DIFFERENT_COMPANY', ['保存された財務計画の会社IDが一致しないため使用しません'], { ...common, reproducibility: savedRepro });
  }
  if (meta.calcVersion !== FINANCE_PLAN_CALC_VERSION) {
    return withoutNumbers(
      'INVALID',
      [`未対応の計算ロジック版（${meta.calcVersion}）で保存されているため、変換せず使用しません`],
      { ...common, reproducibility: savedRepro },
    );
  }

  const currentAssumptionsHash = hashOf(toSavedFinancePlan(stored.domain));
  const repro = { ...savedRepro, currentAssumptionsHash };
  if (currentAssumptionsHash !== meta.assumptionsHash) {
    return withoutNumbers(
      'INVALID',
      ['保存された前提の識別子が一致しないため使用しません（保存データの改変または形式の不一致の可能性）'],
      { ...common, reproducibility: repro },
    );
  }

  const computed = computeStage6FinancePlan({
    financePL: inputs.financePL,
    financeBS: inputs.financeBS,
    departments: inputs.departments,
    fiscalYearEnd: inputs.fiscalYearEnd,
    domain: stored.domain,
    currentYear,
  });
  const currentRepro = { ...repro, currentSourceHash: computed.sourceHash };

  const reasons: string[] = [];
  if (meta.baseYear !== computed.basePlan.baseYear) reasons.push('基準年度（PL）が保存時点と異なります');
  if (meta.bsBaseYear !== computed.basePlan.bsBaseYear) reasons.push('基準年度（BS）が保存時点と異なります');
  if (meta.sourceHash !== computed.sourceHash) reasons.push('STAGE1またはSTAGE4の元データが保存時点から変わっています');
  const status: BankFinancialPlanStatus = reasons.length > 0 ? 'STALE' : 'CURRENT';

  const plan = computed.plan;
  const fiscalYearEndSet = computed.fiscalYearEndSet;
  if (!fiscalYearEndSet) reasons.push('決算期が未設定のため、年度別の投資額と返済可能性の判定は保留です');
  if (plan.yearMismatch) reasons.push('PLとBSの基準年度が一致しないため、資金計画は保留です');
  if (plan.unitSuspects.length > 0) reasons.push('単位不一致の疑いがあるデータがあります');

  const numbersConfirmed =
    status === 'CURRENT' && fiscalYearEndSet && plan.baseYear !== null && !plan.yearMismatch && plan.unitSuspects.length === 0;
  if (status === 'STALE') reasons.unshift('保存時点から元データが変わっています。以下の数値は現在の元データによる参考値です');

  const { schedule, investment, basePlan } = computed;
  const debtYearOf = (y: number) => schedule.years.find((d) => d.year === y);
  const baseActual = basePlan.years.find((y) => y.kind === 'ACTUAL');
  const targets = inputs.companyTargets;
  const stage2Revenue = parseRegisteredTarget(targets, '売上');
  const stage2Operating = parseRegisteredTarget(targets, '営業利益');
  const scenarioTarget = stored.domain.assumptions;
  const contributions = stage4Contributions(inputs.departments);

  const holds = [
    ...plan.globalHolds,
    ...(computed.debtEntered ? plan.debtGlobalHolds : []),
    ...(computed.debtEntered ? schedule.globalHolds : []),
    ...plan.years.flatMap((y) => y.holds),
  ];
  const uniqueHolds = [...new Set(holds)];

  const sections: BankFinancialPlanSections = {
    financialTargets: {
      baseYear: plan.baseYear,
      baseYearRevenueYen: baseActual?.revenue.value ?? null,
      baseYearOperatingIncomeYen: baseActual?.operatingIncome.value ?? null,
      stage2Registered: { revenue: stage2Revenue, operatingIncome: stage2Operating },
      stage6Scenario: {
        targetYear: scenarioTarget.targetYear,
        revenueYen: scenarioTarget.targetRevenueYen,
        operatingIncomeYen: scenarioTarget.targetOperatingIncomeYen,
        basis: 'USER',
        note: plan.scenario.note,
      },
      stage4Contributions: contributions,
      gaps: {
        revenue: gapFor(stage2Revenue, plan, (y) => y.revenue),
        operatingIncome: gapFor(stage2Operating, plan, (y) => y.operatingIncome),
      },
    },
    revenuePlan: {
      years: plan.years.map((y) => ({
        year: y.year,
        kind: y.kind,
        revenue: y.revenue,
        operatingIncome: y.operatingIncome,
        operatingMarginRate: ratioOf(y.revenue, y.operatingIncome),
      })),
    },
    investmentPlan: {
      fiscalYearEndMonth: investment.fiscalYearEndMonth,
      fiscalYearBucketing: fiscalYearEndSet ? 'CONFIRMED' : 'ASSUMED_DECEMBER',
      byFiscalYear: investment.yearlyByCategory.map((b) => ({
        fiscalYear: b.fiscalYear,
        capexYen: b.CAPEX,
        opexReferenceYen: b.OPEX,
        otherYen: b.OTHER,
      })),
      readyYen: investment.readyYen,
      approvedReadyYen: investment.approvedReadyYen,
      unapprovedReadyYen: investment.unapprovedReadyYen,
      unresolved: {
        unclassifiedYen: investment.unclassifiedYen,
        unclassifiedCount: investment.unclassifiedCount,
        unscheduledYen: investment.unscheduledYen,
        candidateYen: investment.candidateYen,
        candidateCount: investment.candidateCount,
        basisPendingYen: investment.basisPendingYen,
        basisPendingCount: investment.basisPendingCount,
        unitPendingCount: investment.unitPendingCount,
        missingCount: investment.missingCount,
      },
      sources: investment.items.map((it) => ({
        label: it.label,
        deptName: it.deptName,
        projectTitle: it.projectTitle,
        source: it.source,
        sourceField: it.sourceField,
        category: it.category,
        amountYen: it.amountYen,
        amountStatus: it.amountStatus,
        totalYen: it.totalYen,
        duplicateStatus: it.duplicateStatus,
        counted: it.counted,
        ready: it.ready,
        planStatus: it.planStatus,
      })),
      note: 'CAPEX以外は営業利益計画に含まれている前提のため、営業CFで二重に控除していません。未確定の投資額は上記の未確定欄に分けて保持し、0円として扱っていません',
    },
    cashFlow: {
      baseYear: plan.baseYear,
      bsBaseYear: plan.bsBaseYear,
      yearMismatch: plan.yearMismatch,
      unitSuspects: plan.unitSuspects,
      taxRate: plan.taxRate,
      depreciation: plan.depreciation,
      interest: plan.interest,
      years: plan.years.map((y) => ({
        year: y.year,
        kind: y.kind,
        operatingCf: y.operatingCf,
        capex: y.capex,
        investingCf: y.investingCf,
        fcf: y.fcf,
        openingCash: y.openingCash,
        closingCashBeforeFinancing: y.closingCashBeforeFinancing,
        minCash: y.minCash,
        shortfall: y.shortfall,
        financingCf: y.financingCf,
        closingCashAfterFinancing: y.closingCashAfterFinancing,
        postShortfall: y.postShortfall,
        verdict: y.verdict,
        holds: y.holds,
      })),
    },
    debtRepayment: {
      entered: computed.debtEntered,
      existingLoansEntered: schedule.existingLoansEntered,
      newLoansEntered: schedule.newLoansEntered,
      reconciliation: schedule.reconciliation,
      years: computed.debtEntered
        ? plan.years
            .filter((y) => y.kind === 'FORECAST')
            .map((y) => {
              const d = debtYearOf(y.year);
              return {
                year: y.year,
                openingBalance: d?.openingBalance ?? { value: null, basis: 'HELD', note: '借入計画に該当年度がありません' },
                draw: d?.draw ?? { value: null, basis: 'HELD', note: '借入計画に該当年度がありません' },
                principal: d?.principal ?? { value: null, basis: 'HELD', note: '借入計画に該当年度がありません' },
                interest: d?.interest ?? { value: null, basis: 'HELD', note: '借入計画に該当年度がありません' },
                debtService: d?.debtService ?? { value: null, basis: 'HELD', note: '借入計画に該当年度がありません' },
                closingBalance: d?.closingBalance ?? { value: null, basis: 'HELD', note: '借入計画に該当年度がありません' },
                newClosingBalance: d?.newClosingBalance ?? { value: null, basis: 'HELD', note: '借入計画に該当年度がありません' },
                existingClosingBalance: d
                  ? subtractCf(d.closingBalance, d.newClosingBalance, '年末の既存借入残高（既存＋新規−新規）')
                  : { value: null, basis: 'HELD', note: '借入計画に該当年度がありません' },
                dividends: d?.dividends ?? { value: null, basis: 'HELD', note: '借入計画に該当年度がありません' },
                dscr: y.dscr,
                verdict: y.verdict,
                holds: [...(d?.holds ?? []), ...y.holds],
              };
            })
        : [],
    },
    basisAndConstraints: {
      amountUnit: 'JPY',
      baseYear: plan.baseYear,
      bsBaseYear: plan.bsBaseYear,
      forecastWindow: computed.forecastYears,
      assumptions: stored.domain.assumptions,
      existingLoanCount: stored.domain.existingLoans.length,
      newLoanCount: stored.domain.newLoans.length,
      fiscalYearEndSet,
      fiscalYearEndMonth: investment.fiscalYearEndMonth,
      sourceIdentifiers: {
        financePLYears: inputs.financePL.map((r) => r.year).sort((a, b) => a - b),
        financeBSYears: inputs.financeBS.map((r) => r.year).sort((a, b) => a - b),
        investmentItemCount: investment.items.length,
      },
      holds: uniqueHolds,
    },
  };

  return {
    schemaVersion: 1,
    status,
    numbersConfirmed,
    statusReasons: reasons,
    amountUnit: 'JPY',
    companyId,
    strategyId,
    reproducibility: currentRepro,
    sections,
  };
}

export function bankFinancialPlanForRow(args: {
  row: Record<string, unknown>;
  companyId: string;
  now: Date;
}): BankFinancialPlanBlock {
  const computedAt = args.now.toISOString();
  const strategyId = typeof args.row.id === 'string' ? args.row.id : null;
  try {
    const inputs = stage6SourceInputsFromRow(args.row);
    return buildBankFinancialPlanBlock({
      companyId: args.companyId,
      strategyId,
      storedFinancePlan: inputs.storedFinancePlan,
      inputs,
      currentYear: args.now.getFullYear(),
      computedAt,
    });
  } catch (err) {
    console.error('[bankFinancialPlan] build failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      schemaVersion: 1,
      status: 'UNAVAILABLE',
      numbersConfirmed: false,
      statusReasons: ['財務計画の計算中にエラーが発生したため、財務数値は含めていません'],
      amountUnit: 'JPY',
      companyId: args.companyId,
      strategyId,
      reproducibility: emptyReproducibility(FINANCE_PLAN_CALC_VERSION, args.now.getFullYear(), computedAt),
      sections: null,
    };
  }
}

export function withBankFinancialPlan<T extends object>(
  planData: T,
  audience: string,
  block: BankFinancialPlanBlock | undefined,
): T & { bankFinancialPlan?: BankFinancialPlanBlock } {
  if (audience !== 'bank' || !block) return planData;
  return { ...planData, bankFinancialPlan: block };
}
