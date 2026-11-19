import { operatingCashFlowOf, workingCapitalAt, type CashFlowPlan, type CfBasis } from './cashflow';
import type { UnifiedPl } from './unifiedPl';

export type ConditionalCfYear = {
  fiscalYear: number;
  operatingIncomeYen: number | null;
  operatingCf: { conditionalYen: number | null; baselineYen: number | null; deltaYen: number | null };
  investingCfYen: number | null;
  financingCfYen: number | null;
  openingCashYen: number | null;
  closingCashYen: number | null;
  baselineClosingCashYen: number | null;
  unknownReasons: string[];
};

export type ConditionalCf = {
  debtEnabled: boolean;
  taxRate: number | null;
  taxRateBasis: CfBasis;
  years: ConditionalCfYear[];
};

/**
 * 施策反映後の売上・営業利益で、基準CFと同じ計算（cashflow.ts の共通関数）を行った条件付きCF。
 * 運転資金は施策反映後の売上高×比率から再計算し、前年度との差で増減を出す。
 * 投資・借入は基準CFの値をそのまま使う。欠けた前提は0にせず未算定として連鎖させる。
 */
export function buildConditionalCashFlow(args: { baseline: CashFlowPlan; unified: UnifiedPl }): ConditionalCf {
  const { baseline, unified } = args;
  const debtEnabled = baseline.debtEnabled;
  const rate = baseline.taxRate.value;
  const depreciation = baseline.depreciation.value;
  const ratios = {
    ar: baseline.workingCapitalRatios.ar.value,
    inventory: baseline.workingCapitalRatios.inventory.value,
    ap: baseline.workingCapitalRatios.ap.value,
  };
  const actual = baseline.years.find((y) => y.kind === 'ACTUAL');
  const forecast = baseline.years.filter((y) => y.kind === 'FORECAST');

  let previousClosing: number | null = actual?.closingCashBeforeFinancing.value ?? null;
  let previousWc: number | null = actual?.workingCapital.value ?? null;
  const years: ConditionalCfYear[] = unified.years.map((u) => {
    const b = forecast.find((y) => y.year === u.fiscalYear);
    if (!b) {
      previousClosing = null;
      previousWc = null;
      return {
        fiscalYear: u.fiscalYear,
        operatingIncomeYen: u.plan.operatingIncomeYen,
        operatingCf: { conditionalYen: null, baselineYen: null, deltaYen: null },
        investingCfYen: null,
        financingCfYen: null,
        openingCashYen: null,
        closingCashYen: null,
        baselineClosingCashYen: null,
        unknownReasons: ['基準CFに該当年度がないため算定しない'],
      };
    }

    const reasons: string[] = [];
    const op = u.plan.operatingIncomeYen;
    const interest = b.interest.value;
    const pretax = op !== null && interest !== null ? op - interest : null;
    const wc = workingCapitalAt(ratios, u.plan.revenueYen);
    const wcChange = wc !== null && previousWc !== null ? wc - previousWc : null;

    const conditionalOcf = operatingCashFlowOf({
      pretaxYen: pretax,
      taxRate: rate,
      depreciationYen: depreciation,
      workingCapitalChangeYen: wcChange,
    });
    if (op === null) reasons.push('営業利益が未算定のため、営業CF・期末現預金は算定しない（売上増加の原価が不明）');
    if (interest === null) reasons.push('支払利息が未確定（STAGE1の基準年度の支払利息、または借入計画の利息が必要）');
    if (rate === null) reasons.push('税率が未確定（STAGE6の税率、またはSTAGE1の法人税等・税引前利益の実績が必要）');
    if (depreciation === null) reasons.push('減価償却費が未確定（STAGE1の基準年度の減価償却費、またはSTAGE6の減価償却費が必要）');
    if (wc === null) reasons.push('運転資金を推計できません（STAGE1の基準年度BSの売掛金・棚卸資産・買掛金、または運転資金比率が必要）');
    else if (wcChange === null) reasons.push('運転資金増減が未確定（STAGE1の基準年度BSの売掛金・棚卸資産・買掛金が必要）');

    const baselineOcf = b.operatingCf.value;
    const delta = conditionalOcf !== null && baselineOcf !== null ? conditionalOcf - baselineOcf : null;
    const investing = b.investingCf.value;
    const financing = debtEnabled ? b.financingCf.value : null;

    let closingBefore: number | null = null;
    if (previousClosing === null) reasons.push('前年度末の現預金が未確定');
    if (previousClosing !== null && conditionalOcf !== null && investing !== null) {
      closingBefore = previousClosing + conditionalOcf + investing;
    }
    let closing: number | null = null;
    if (debtEnabled) {
      if (closingBefore !== null && financing !== null) closing = closingBefore + financing;
      else reasons.push('財務CF（借入・返済・配当）が未確定');
    } else {
      closing = closingBefore;
    }

    const baselineClosing = debtEnabled ? b.closingCashAfterFinancing.value : b.closingCashBeforeFinancing.value;
    const opening = previousClosing;
    previousClosing = closing;
    previousWc = wc;

    return {
      fiscalYear: u.fiscalYear,
      operatingIncomeYen: op,
      operatingCf: { conditionalYen: conditionalOcf, baselineYen: baselineOcf, deltaYen: delta },
      investingCfYen: investing,
      financingCfYen: financing,
      openingCashYen: opening,
      closingCashYen: closing,
      baselineClosingCashYen: baselineClosing,
      unknownReasons: Array.from(new Set(reasons)),
    };
  });

  return { debtEnabled, taxRate: rate, taxRateBasis: baseline.taxRate.basis, years };
}
