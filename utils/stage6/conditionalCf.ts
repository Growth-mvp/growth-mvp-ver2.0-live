import type { CashFlowPlan, CfBasis } from './cashflow';
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

/** 税引後利益。損失の年度は税を計上しない（cashflow.ts の既存の計算と同じ） */
function netIncomeOf(pretax: number, rate: number): number {
  return pretax > 0 ? pretax * (1 - rate) : pretax;
}

/**
 * 基準CF（直近実績の横ばい・目標補間なし）に、統一PLの営業利益の差だけを反映した条件付きCF。
 * 運転資金・減価償却・投資・財務CFは基準CFの値をそのまま使う（売上は変えないため）。
 * 営業利益が未算定の年度は営業CF以降を未算定にし、翌年度以降の期首も未算定として連鎖させる。
 */
export function buildConditionalCashFlow(args: { baseline: CashFlowPlan; unified: UnifiedPl }): ConditionalCf {
  const { baseline, unified } = args;
  const debtEnabled = baseline.debtEnabled;
  const rate = baseline.taxRate.value;
  const actual = baseline.years.find((y) => y.kind === 'ACTUAL');
  const forecast = baseline.years.filter((y) => y.kind === 'FORECAST');

  let previousClosing: number | null = actual?.closingCashBeforeFinancing.value ?? null;
  const years: ConditionalCfYear[] = unified.years.map((u) => {
    const b = forecast.find((y) => y.year === u.fiscalYear);
    const reasons: string[] = [];
    if (!b) {
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

    const baselineOcf = b.operatingCf.value;
    const interest = b.interest.value;
    const dep = b.depreciation.value;
    const dWc = b.workingCapitalChange.value;
    const op = u.plan.operatingIncomeYen;

    let conditionalOcf: number | null = null;
    if (op === null) {
      reasons.push('営業利益が未算定のため、営業CF・期末現預金は算定しない（売上増加の原価が不明）');
    } else if (u.plan.revenueYen !== b.revenue.value) {
      reasons.push('売上の変動に対応する運転資金は算定しない');
    } else if (interest === null || rate === null || dep === null || dWc === null) {
      if (rate === null) reasons.push('税率が未確定（STAGE6の税率、またはSTAGE1の法人税等・税引前利益の実績が必要）');
      if (interest === null) reasons.push('支払利息が未確定（STAGE1の基準年度の支払利息、または借入計画の利息が必要）');
      if (dep === null) reasons.push('減価償却費が未確定（STAGE1の基準年度の減価償却費、またはSTAGE6の減価償却費が必要）');
      if (dWc === null) reasons.push('運転資金増減が未確定（STAGE1の基準年度BSの売掛金・棚卸資産・買掛金が必要）');
    } else {
      conditionalOcf = netIncomeOf(op - interest, rate) + dep - dWc;
    }

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
