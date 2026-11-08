import type { Department, FinanceEffect, FinanceEffectKind } from '@/types/strategy';
import { computeFinanceEffect } from '@/lib/financeEffect';
import { fiscalYearOf, parseFiscalYearEndMonth } from './investmentDemand';
import type { CfAssumptions } from './cashflow';

/** 経営目標への補間（目標経路）を外した前提。目標を入れていても現状延長（基準年度の横置き）になる */
export function withoutTargetPath(assumptions: CfAssumptions): CfAssumptions {
  return { ...assumptions, targetRevenueYen: null, targetOperatingIncomeYen: null, targetYear: null };
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
};

export type FinanceEffectTrial = {
  ready: boolean;
  notSetCount: number;
  included: (FinanceEffectTrialTarget & { kind: 'REVENUE_UP' | 'COST_REDUCTION' | 'COST_INCREASE' })[];
  excluded: FinanceEffectTrialExclusion[];
  revenueCostUnknown: FinanceEffectTrialTarget[];
  legacyReferenced: FinanceEffectTrialTarget[];
  years: FinanceEffectTrialYear[];
  /** 全施策の一覧（反映状態つき）。years はこの REFLECTED 行の合計と一致する */
  projects: FinanceEffectProjectRow[];
};

type Flow = {
  kind: 'REVENUE_UP' | 'COST_REDUCTION' | 'COST_INCREASE';
  startIdx: number;
  endIdx: number | null;
  perMonthYen: number;
  /** 売上増加の施策のみ：営業利益の増分（月あたり）。入力がなければ null */
  opPerMonthYen: number | null;
};

const monthIndexOf = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;

function revenueOperatingPerMonthOf(effect: FinanceEffect, startIdx: number, endIdx: number | null): number | null {
  const value = effect.operatingIncomeEffectYen;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (effect.amountBasis === 'TOTAL') return value / (endIdx === null ? 1 : endIdx - startIdx + 1);
  return effect.amountBasis === 'MONTHLY' ? value : value / 12;
}

const REASON: Record<Exclude<FinanceEffectProjectStatus, 'REFLECTED' | 'NOT_SET'>, string> = {
  DRAFT: '利用者が未確認（確認すると試算に入ります）',
  INCOMPLETE: '入力不足のため未算定',
  NOT_FINANCIAL: '非財務の効果のため、財務試算には含めない',
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
    projects: [],
  };
  if (endMonth === null) return trial;

  /** 施策ごとの月次フロー（反映された施策だけ） */
  const flowsOf = new Map<string, Flow[]>();
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

      effects.forEach((effect, effectIndex) => {
        const effectBase = { ...base, effectIndex };
        const key = `${deptIndex}:${projectIndex}:${effectIndex}`;
        const result = computeFinanceEffect(effect);
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
        if (result.status === 'DRAFT') return notReflected('DRAFT', REASON.DRAFT);

        const reflectedKind = effect.kind as Flow['kind'];
        const startIdx = monthIndexOf(effect.startYm!);
        const endIdx = effect.endYm ? monthIndexOf(effect.endYm) : null;
        const perMonthYen =
          effect.amountBasis === 'TOTAL'
            ? result.totalYen! / (endIdx === null ? 1 : endIdx - startIdx + 1)
            : result.monthlyYen!;
        const flowEnd = effect.amountBasis === 'TOTAL' && endIdx === null ? startIdx : endIdx;
        const opPerMonthYen = reflectedKind === 'REVENUE_UP' ? revenueOperatingPerMonthOf(effect, startIdx, endIdx) : 0;
        flowsOf.set(key, [{ kind: reflectedKind, startIdx, endIdx: flowEnd, perMonthYen, opPerMonthYen }]);
        rows.push({ ...effectBase, status: 'REFLECTED', kind, startFiscalYear: startFy, endFiscalYear: endFy, reason: null, years: [] });
        trial.included.push({ ...target, kind: reflectedKind });
        if (reflectedKind === 'REVENUE_UP') trial.revenueCostUnknown.push(target);
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
      } else if (flow.kind === 'COST_REDUCTION') costReductionYen += amount;
      else costIncreaseYen += amount;
    }
    return {
      fiscalYear,
      revenueYen,
      costReductionYen,
      costIncreaseYen,
      revenueOperatingIncomeYen,
      operatingIncomeYen: revenueOperatingIncomeYen === null ? null : revenueOperatingIncomeYen + costReductionYen - costIncreaseYen,
    };
  };

  for (const row of rows) {
    if (row.status !== 'REFLECTED') continue;
    const flows = flowsOf.get(`${row.deptIndex}:${row.projectIndex}:${row.effectIndex}`) ?? [];
    row.years = args.fiscalYears.map((fy) => yearsOf(flows, fy));
    row.operatingUnknown = row.years.some((y) => y.operatingIncomeYen === null);
  }

  trial.years = args.fiscalYears.map((fiscalYear) => {
    let revenueYen = 0;
    let costReductionYen = 0;
    let costIncreaseYen = 0;
    let revenueOperatingIncomeYen: number | null = 0;
    for (const row of rows) {
      if (row.status !== 'REFLECTED') continue;
      const y = row.years.find((v) => v.fiscalYear === fiscalYear)!;
      revenueYen += y.revenueYen ?? 0;
      costReductionYen += y.costReductionYen ?? 0;
      costIncreaseYen += y.costIncreaseYen ?? 0;
      if (y.revenueOperatingIncomeYen === null) revenueOperatingIncomeYen = null;
      else if (revenueOperatingIncomeYen !== null) revenueOperatingIncomeYen += y.revenueOperatingIncomeYen;
    }
    return {
      fiscalYear,
      revenueYen,
      costReductionYen,
      costIncreaseYen,
      operatingEffectYen: costReductionYen - costIncreaseYen,
      revenueOperatingIncomeYen,
    };
  });

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
