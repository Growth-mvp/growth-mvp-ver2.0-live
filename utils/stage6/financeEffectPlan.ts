import type { Department, FinanceEffect, FinanceEffectKind } from '@/types/strategy';
import { computeFinanceEffect, revenueSgaRuleOf, type FinanceEffectResult } from '@/lib/financeEffect';
import { fiscalYearOf, parseFiscalYearEndMonth } from './investmentDemand';
import type { CfAssumptions } from './cashflow';

/** 経営目標への補間（目標経路）を外した前提。目標を入れていても現状延長（基準年度の横置き）になる */
export function withoutTargetPath(assumptions: CfAssumptions): CfAssumptions {
  return { ...assumptions, targetRevenueYen: null, targetOperatingIncomeYen: null, targetYear: null };
}

/** 営業利益計画に含まれないOPEXを、年度別の追加費用として足す（財務効果の追加費用とは別の明細。同じ費用は IN_PLAN で入力する） */
export function withNotInPlanOpex(
  years: FinanceEffectTrialYear[],
  opex: { fiscalYear: number; amountYen: number }[],
): FinanceEffectTrialYear[] {
  if (opex.length === 0) return years;
  const byFiscalYear = new Map(opex.map((o) => [o.fiscalYear, o.amountYen]));
  return years.map((y) => {
    const add = byFiscalYear.get(y.fiscalYear) ?? 0;
    if (add === 0) return y;
    const costIncreaseYen = y.costIncreaseYen + add;
    return { ...y, costIncreaseYen, operatingEffectYen: y.costReductionYen - costIncreaseYen };
  });
}

export type FinanceEffectTrialTarget = { deptName: string; projectTitle: string };

export type FinanceEffectTrialExclusion = FinanceEffectTrialTarget & { reason: string };

export type FinanceEffectTrialYear = {
  fiscalYear: number;
  /** 売上増加（円。正） */
  revenueYen: number;
  /** 費用削減（円。営業費用を減らす正の値） */
  costReductionYen: number;
  /** 追加費用（円。営業費用を増やす正の値） */
  costIncreaseYen: number;
  /** 営業利益への効果（費用削減 − 追加費用。売上増加は含まない） */
  operatingEffectYen: number;
  /** 売上増加に伴う営業利益の増分（円）。その年度に入る売上増加の施策に営業利益の入力がなければ null（未算定） */
  revenueOperatingIncomeYen: number | null;
  /** 売上増加の粗利益（円。参考値で、営業利益には含めない）。原価率が未入力の施策があれば null */
  grossProfitYen: number | null;
};

/** 試算への反映状態。REFLECTED 以外は年度別金額を持たない（0と区別する） */
export type FinanceEffectProjectStatus = 'REFLECTED' | 'DRAFT' | 'INCOMPLETE' | 'NOT_FINANCIAL' | 'NOT_SET';

/** 施策ごとの年度別金額。null は未算定（0ではない） */
export type FinanceEffectProjectYear = {
  fiscalYear: number;
  revenueYen: number | null;
  costReductionYen: number | null;
  costIncreaseYen: number | null;
  revenueOperatingIncomeYen: number | null;
  /** 売上増加の粗利益（参考値。営業利益には含めない）。原価率が未入力なら null */
  grossProfitYen: number | null;
  /** 営業利益への効果（売上増加の営業利益の増分 + 費用削減 − 追加費用）。算定できない年度は null */
  operatingIncomeYen: number | null;
};

export type FinanceEffectProjectRow = {
  deptIndex: number;
  projectIndex: number;
  /** 施策が持つ効果のうち何番目か（0が financeEffect、1以降が financeEffects） */
  effectIndex: number;
  deptName: string;
  projectTitle: string;
  status: FinanceEffectProjectStatus;
  kind: FinanceEffectKind | null;
  /** 対象年度（効果が始まる会計年度・最後の会計年度。終了未設定は null） */
  startFiscalYear: number | null;
  endFiscalYear: number | null;
  /** 反映されない理由（REFLECTED 以外） */
  reason: string | null;
  /** REFLECTED のうち、営業利益を算定できない年度を含む */
  operatingUnknown: boolean;
  /** REFLECTED のときだけ、試算の年度に対応する金額を持つ */
  years: FinanceEffectProjectYear[];
  /** DRAFT（未確認）の効果の参考金額。正式な試算（years・trial.years）には含めない */
  scenarioYears?: FinanceEffectProjectYear[] | null;
  /** DRAFT の参考金額に含めない理由（正式に反映済みの同じ種類の効果と重なる等） */
  scenarioNote?: string | null;
};

export type FinanceEffectTrial = {
  ready: boolean;
  notSetCount: number;
  included: (FinanceEffectTrialTarget & { kind: 'REVENUE_UP' | 'COST_REDUCTION' | 'COST_INCREASE' })[];
  excluded: FinanceEffectTrialExclusion[];
  revenueCostUnknown: FinanceEffectTrialTarget[];
  legacyReferenced: FinanceEffectTrialTarget[];
  years: FinanceEffectTrialYear[];
  /** 参考シミュレーション（未確認の効果の合計）。正式な years には加算しない */
  scenario: { years: FinanceEffectTrialYear[] };
  /** 全施策の一覧（反映状態つき）。years はこの REFLECTED 行の合計と一致する */
  projects: FinanceEffectProjectRow[];
};

type Flow = {
  kind: 'REVENUE_UP' | 'COST_REDUCTION' | 'COST_INCREASE';
  startIdx: number;
  endIdx: number | null;
  perMonthYen: number;
  /** 売上増加の施策のみ：営業利益の増分（月あたり）。算定できなければ null */
  opPerMonthYen: number | null;
  /** 売上増加の施策のみ：粗利益（月あたり、参考）。原価率が未入力なら null */
  grossPerMonthYen: number | null;
};

const monthIndexOf = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;

/* 売上増加の営業利益（月あたり）。直接入力の増分があればそれ、無ければ粗利益から追加販売管理費等を引く。どちらも無ければ null */
function revenueOperatingPerMonthOf(
  effect: FinanceEffect,
  startIdx: number,
  endIdx: number | null,
  revenuePerMonth: number,
  projectHasCostIncrease: boolean,
): number | null {
  const monthly = (value: number) =>
    effect.amountBasis === 'TOTAL' ? value / (endIdx === null ? 1 : endIdx - startIdx + 1) : effect.amountBasis === 'MONTHLY' ? value : value / 12;
  const value = effect.operatingIncomeEffectYen;
  if (typeof value === 'number' && Number.isFinite(value)) return monthly(value);
  const rate = effect.costRatePct;
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return null;
  const gross = revenuePerMonth * (1 - rate / 100);
  const rule = revenueSgaRuleOf(effect, projectHasCostIncrease);
  if (rule === 'NONE') return gross;
  const sga = effect.sgaCostYen;
  if (rule === 'DEDUCT' && typeof sga === 'number' && Number.isFinite(sga)) return gross - monthly(sga);
  return null;
}

function revenueGrossPerMonthOf(effect: FinanceEffect, revenuePerMonth: number): number | null {
  const rate = effect.costRatePct;
  return typeof rate === 'number' && Number.isFinite(rate) ? revenuePerMonth * (1 - rate / 100) : null;
}

function flowOf(effect: FinanceEffect, result: FinanceEffectResult, projectHasCostIncrease: boolean): Flow {
  const kind = effect.kind as Flow['kind'];
  const startIdx = monthIndexOf(effect.startYm!);
  const endIdx = effect.endYm ? monthIndexOf(effect.endYm) : null;
  const perMonthYen =
    effect.amountBasis === 'TOTAL'
      ? result.totalYen! / (endIdx === null ? 1 : endIdx - startIdx + 1)
      : result.monthlyYen!;
  const flowEnd = effect.amountBasis === 'TOTAL' && endIdx === null ? startIdx : endIdx;
  const opPerMonthYen = kind === 'REVENUE_UP' ? revenueOperatingPerMonthOf(effect, startIdx, endIdx, perMonthYen, projectHasCostIncrease) : 0;
  const grossPerMonthYen = kind === 'REVENUE_UP' ? revenueGrossPerMonthOf(effect, perMonthYen) : null;
  return { kind, startIdx, endIdx: flowEnd, perMonthYen, opPerMonthYen, grossPerMonthYen };
}

const REASON: Record<Exclude<FinanceEffectProjectStatus, 'REFLECTED' | 'NOT_SET'>, string> = {
  DRAFT: '保存済みですが、計算条件（入力不足・重複の確認）がそろうまで未反映',
  INCOMPLETE: '入力不足のため未算定',
  NOT_FINANCIAL: '非財務の効果のため、財務試算には含めない',
};

const SCENARIO_DUPLICATE_REFLECTED = '同じ種類の効果が試算に反映済みのため、参考シミュレーションには含めていません（二重計上を防ぐため）';
const SCENARIO_DUPLICATE_DRAFT = '同じ種類の未確認の効果が施策に既にあるため、参考シミュレーションには含めていません（二重計上を防ぐため）';

const sumYear = (fiscalYear: number, items: FinanceEffectProjectYear[]): FinanceEffectTrialYear => {
  let revenueYen = 0;
  let costReductionYen = 0;
  let costIncreaseYen = 0;
  let revenueOperatingIncomeYen: number | null = 0;
  let grossProfitYen: number | null = 0;
  for (const y of items) {
    revenueYen += y.revenueYen ?? 0;
    costReductionYen += y.costReductionYen ?? 0;
    costIncreaseYen += y.costIncreaseYen ?? 0;
    if (y.revenueOperatingIncomeYen === null) revenueOperatingIncomeYen = null;
    else if (revenueOperatingIncomeYen !== null) revenueOperatingIncomeYen += y.revenueOperatingIncomeYen;
    if (y.grossProfitYen === null) grossProfitYen = null;
    else if (grossProfitYen !== null) grossProfitYen += y.grossProfitYen;
  }
  return {
    fiscalYear,
    revenueYen,
    costReductionYen,
    costIncreaseYen,
    operatingEffectYen: costReductionYen - costIncreaseYen,
    revenueOperatingIncomeYen,
    grossProfitYen,
  };
};

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
    scenario: { years: [] },
    projects: [],
  };
  if (endMonth === null) return trial;

  /** 施策ごとの月次フロー（反映された施策だけ） */
  const flowsOf = new Map<string, Flow[]>();
  /** 未確認（DRAFT）の効果の月次フロー。参考シミュレーションにだけ使う */
  const draftFlowsOf = new Map<string, Flow>();
  const rows: FinanceEffectProjectRow[] = [];
  (args.departments ?? []).forEach((dept, deptIndex) => {
    (dept.projects ?? []).forEach((project, projectIndex) => {
      const target = { deptName: dept.name || '（部署名なし）', projectTitle: project.title || '（施策名なし）' };
      const base = { deptIndex, projectIndex, deptName: target.deptName, projectTitle: target.projectTitle, operatingUnknown: false };
      const effects: FinanceEffect[] = [project.financeEffect, ...(Array.isArray(project.financeEffects) ? project.financeEffects : [])].filter(
        (e): e is FinanceEffect => !!e && typeof e === 'object',
      );

      if (effects.length === 0) {
        trial.notSetCount += 1;
        rows.push({ ...base, effectIndex: 0, status: 'NOT_SET', kind: null, startFiscalYear: null, endFiscalYear: null, reason: '財務効果は未登録', years: [] });
        return;
      }

      const projectHasCostIncrease = effects.some((e) => e.kind === 'COST_INCREASE' && computeFinanceEffect(e).status === 'CONFIRMED');
      effects.forEach((effect, effectIndex) => {
        const effectBase = { ...base, effectIndex };
        const key = `${deptIndex}:${projectIndex}:${effectIndex}`;
        const result = computeFinanceEffect(effect, { projectHasCostIncrease });
        const kind = (effect.kind ?? null) as FinanceEffectKind | null;
        const startFy = effect.startYm ? fiscalYearOf(effect.startYm, endMonth) : null;
        const endFy = effect.endYm ? fiscalYearOf(effect.endYm, endMonth) : null;
        const notReflected = (status: Exclude<FinanceEffectProjectStatus, 'REFLECTED' | 'NOT_SET'>, reason: string) => {
          rows.push({ ...effectBase, status, kind, startFiscalYear: startFy, endFiscalYear: endFy, reason, years: [] });
          trial.excluded.push({ ...target, reason });
        };
        if (result.status === 'NOT_FINANCIAL') return notReflected('NOT_FINANCIAL', REASON.NOT_FINANCIAL);
        if (result.status === 'INCOMPLETE') {
          return notReflected('INCOMPLETE', `${REASON.INCOMPLETE}：${result.missing.join('、')}`);
        }
        if (result.status === 'DRAFT') {
          draftFlowsOf.set(key, flowOf(effect, result, projectHasCostIncrease));
          return notReflected('DRAFT', REASON.DRAFT);
        }

        const flow = flowOf(effect, result, projectHasCostIncrease);
        flowsOf.set(key, [flow]);
        rows.push({ ...effectBase, status: 'REFLECTED', kind, startFiscalYear: startFy, endFiscalYear: endFy, reason: null, years: [] });
        trial.included.push({ ...target, kind: flow.kind });
        if (flow.kind === 'REVENUE_UP') trial.revenueCostUnknown.push(target);
        if (project.impactRevenueMJPY !== undefined || project.impactOpIncomeMJPY !== undefined) {
          trial.legacyReferenced.push(target);
        }
      });
    });
  });

  const yearsOf = (flows: Flow[], fiscalYear: number): FinanceEffectProjectYear => {
    const fyStart = (fiscalYear - 1) * 12 + endMonth;
    const fyEnd = fiscalYear * 12 + endMonth - 1;
    let revenueYen = 0;
    let costReductionYen = 0;
    let costIncreaseYen = 0;
    let revenueOperatingIncomeYen: number | null = 0;
    let grossProfitYen: number | null = 0;
    for (const flow of flows) {
      const from = Math.max(fyStart, flow.startIdx);
      const to = Math.min(fyEnd, flow.endIdx ?? Number.POSITIVE_INFINITY);
      const months = Math.max(0, to - from + 1);
      if (months === 0) continue;
      const amount = months * flow.perMonthYen;
      if (flow.kind === 'REVENUE_UP') {
        revenueYen += amount;
        if (flow.opPerMonthYen === null) revenueOperatingIncomeYen = null;
        else if (revenueOperatingIncomeYen !== null) revenueOperatingIncomeYen += months * flow.opPerMonthYen;
        if (flow.grossPerMonthYen === null) grossProfitYen = null;
        else if (grossProfitYen !== null) grossProfitYen += months * flow.grossPerMonthYen;
      } else if (flow.kind === 'COST_REDUCTION') costReductionYen += amount;
      else costIncreaseYen += amount;
    }
    return {
      fiscalYear,
      revenueYen,
      costReductionYen,
      costIncreaseYen,
      revenueOperatingIncomeYen,
      grossProfitYen,
      operatingIncomeYen: revenueOperatingIncomeYen === null ? null : revenueOperatingIncomeYen + costReductionYen - costIncreaseYen,
    };
  };

  for (const row of rows) {
    if (row.status !== 'REFLECTED') continue;
    const flows = flowsOf.get(`${row.deptIndex}:${row.projectIndex}:${row.effectIndex}`) ?? [];
    row.years = args.fiscalYears.map((fy) => yearsOf(flows, fy));
    row.operatingUnknown = row.years.some((y) => y.operatingIncomeYen === null);
  }

  trial.years = args.fiscalYears.map((fiscalYear) =>
    sumYear(
      fiscalYear,
      rows.filter((row) => row.status === 'REFLECTED').map((row) => row.years.find((v) => v.fiscalYear === fiscalYear)!),
    ),
  );

  const reflectedKinds = new Set(
    rows.filter((row) => row.status === 'REFLECTED').map((row) => `${row.deptIndex}:${row.projectIndex}:${row.kind}`),
  );
  const countedDraftKinds = new Set<string>();
  for (const row of rows) {
    if (row.status !== 'DRAFT' || !row.kind) continue;
    const id = `${row.deptIndex}:${row.projectIndex}:${row.kind}`;
    if (reflectedKinds.has(id)) {
      row.scenarioYears = null;
      row.scenarioNote = SCENARIO_DUPLICATE_REFLECTED;
      continue;
    }
    if (countedDraftKinds.has(id)) {
      row.scenarioYears = null;
      row.scenarioNote = SCENARIO_DUPLICATE_DRAFT;
      continue;
    }
    const flow = draftFlowsOf.get(`${row.deptIndex}:${row.projectIndex}:${row.effectIndex}`);
    if (!flow) continue;
    countedDraftKinds.add(id);
    row.scenarioYears = args.fiscalYears.map((fy) => yearsOf([flow], fy));
    row.scenarioNote = null;
  }
  const scenarioRows = rows.filter((row) => row.status === 'DRAFT' && row.scenarioYears);
  trial.scenario = {
    years: args.fiscalYears.map((fiscalYear) =>
      sumYear(fiscalYear, scenarioRows.map((row) => row.scenarioYears!.find((v) => v.fiscalYear === fiscalYear)!)),
    ),
  };

  trial.projects = rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  return trial;
}

const STATUS_ORDER: Record<FinanceEffectProjectStatus, number> = {
  REFLECTED: 0,
  DRAFT: 1,
  INCOMPLETE: 2,
  NOT_FINANCIAL: 3,
  NOT_SET: 4,
};
