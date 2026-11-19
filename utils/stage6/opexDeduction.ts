import type { Department } from '@/types/strategy';
import type { OpexRelation } from '@/lib/stage4/planView/investmentRows';
import { buildInvestmentItems, fiscalYearOf, parseFiscalYearEndMonth, type InvestmentSource } from './investmentDemand';

export type OpexHold = { label: string; reason: string };

export type OpexProjectDeduction = {
  deptIndex: number;
  projectIndex: number;
  deptName: string;
  projectTitle: string;
  /** 営業利益から差し引く年度別金額（円）。保留の明細は含まない */
  byFiscalYear: { fiscalYear: number; amountYen: number }[];
  /** 同じ費用か確認できず、差し引きを保留した明細 */
  held: OpexHold[];
};

export type OpexDecisionStatus = 'DEDUCTED' | 'HELD' | 'NOT_DEDUCTED' | 'NOT_READY';

/** OPEX明細ごとの営業利益への判定。計画（支出額）と、差し引くかどうかを同じ規則で表す */
export type OpexDecision = {
  deptIndex: number;
  projectIndex: number;
  deptName: string;
  projectTitle: string;
  source: InvestmentSource;
  recordId: string | null;
  label: string;
  relation: OpexRelation | undefined;
  status: OpexDecisionStatus;
  reason: string | null;
  /** 集計対象の支出（年月と円）。計画が未確定の明細は空 */
  allocation: { ym: string; amountYen: number }[];
  byFiscalYear: { fiscalYear: number; amountYen: number }[];
};

const HOLD_SAME_WITHOUT_ADD_COST = '同じ案件の確認済み追加費用がないため、同じ費用か確認できません';
const HOLD_NOT_IN_PLAN_WITH_ADD_COST = '同じ案件に確認済みの追加費用があるため、同じ費用か確認してください（二重に差し引かないため保留）';

/** 施策が確認済みの追加費用を持つか。財務効果の解釈は境界モジュールが行い、ここには判定結果だけを渡す */
export type AddCostConfirmedCheck = (project: object) => boolean;

/**
 * OPEX明細ごとの判定。
 * - IN_PLAN：営業利益に含まれているため差し引かない
 * - NOT_IN_PLAN：確認済みの追加費用が無い案件だけ差し引く。ある案件は同じ費用かを確認するまで保留
 * - SAME_AS_ADD_COST：確認済みの追加費用に含まれるため差し引かない（追加費用が無ければ保留）
 * - DIFFERENT_FROM_ADD_COST：追加費用とは別の費用として差し引く
 * 関係が未確認の既存の明細は差し引かない。金額・時期がそろっていない明細は計画に含めない。
 */
export function opexDecisionsOf(
  departments: Department[] | null | undefined,
  fiscalYearEnd: string | undefined,
  addCostConfirmedOf: AddCostConfirmedCheck,
): OpexDecision[] {
  const endMonth = parseFiscalYearEndMonth(fiscalYearEnd);
  if (endMonth === null) return [];

  const addCostOf = new Map<string, boolean>();
  (departments ?? []).forEach((dept, dIdx) => {
    (dept?.projects ?? []).forEach((project, pIdx) => {
      if (project) addCostOf.set(`${dIdx}:${pIdx}`, addCostConfirmedOf(project));
    });
  });

  const decisions: OpexDecision[] = [];
  for (const item of buildInvestmentItems(departments)) {
    if (item.category !== 'OPEX') continue;
    const relation = item.spend?.opexRelation;
    const hasAddCost = addCostOf.get(`${item.ref.deptIndex}:${item.ref.projectIndex}`) === true;

    let status: OpexDecisionStatus;
    let reason: string | null = null;
    if (!item.ready) {
      status = 'NOT_READY';
      reason = '金額・支出時期がそろっていないため、計画に含めていません';
    } else if (relation === undefined) {
      status = 'NOT_DEDUCTED';
      reason = '営業利益との関係が未確認のため、差し引いていません';
    } else if (relation === 'IN_PLAN') {
      status = 'NOT_DEDUCTED';
      reason = '営業利益に既に含まれるため、差し引いていません';
    } else if (relation === 'SAME_AS_ADD_COST') {
      if (hasAddCost) {
        status = 'NOT_DEDUCTED';
        reason = '確認済みの追加費用に含まれるため、差し引いていません（二重控除を防ぐため）';
      } else {
        status = 'HELD';
        reason = HOLD_SAME_WITHOUT_ADD_COST;
      }
    } else if (relation === 'NOT_IN_PLAN' && hasAddCost) {
      status = 'HELD';
      reason = HOLD_NOT_IN_PLAN_WITH_ADD_COST;
    } else {
      status = 'DEDUCTED';
    }

    const allocation = item.ready ? item.allocation.map((a) => ({ ym: a.ym, amountYen: a.amountYen })) : [];
    const amounts = new Map<number, number>();
    for (const a of allocation) {
      const fy = fiscalYearOf(a.ym, endMonth);
      amounts.set(fy, (amounts.get(fy) ?? 0) + a.amountYen);
    }
    decisions.push({
      deptIndex: item.ref.deptIndex,
      projectIndex: item.ref.projectIndex,
      deptName: item.deptName,
      projectTitle: item.projectTitle,
      source: item.source,
      recordId: item.ref.recordId,
      label: item.label,
      relation,
      status,
      reason,
      allocation,
      byFiscalYear: [...amounts.entries()].sort(([a], [b]) => a - b).map(([fiscalYear, amountYen]) => ({ fiscalYear, amountYen })),
    });
  }
  return decisions;
}

/**
 * 営業利益計画に含まれないOPEXを、施策ごとに差し引く（判定は opexDecisionsOf と同じ）。
 */
export function opexDeductionOfProjects(
  departments: Department[] | null | undefined,
  fiscalYearEnd: string | undefined,
  addCostConfirmedOf: AddCostConfirmedCheck,
): OpexProjectDeduction[] {
  const byProject = new Map<string, OpexProjectDeduction & { amounts: Map<number, number> }>();
  for (const d of opexDecisionsOf(departments, fiscalYearEnd, addCostConfirmedOf)) {
    if (d.status !== 'DEDUCTED' && d.status !== 'HELD') continue;
    const key = `${d.deptIndex}:${d.projectIndex}`;
    let entry = byProject.get(key);
    if (!entry) {
      entry = { deptIndex: d.deptIndex, projectIndex: d.projectIndex, deptName: d.deptName, projectTitle: d.projectTitle, byFiscalYear: [], held: [], amounts: new Map() };
      byProject.set(key, entry);
    }
    if (d.status === 'HELD') {
      entry.held.push({ label: d.label, reason: d.reason ?? '' });
      continue;
    }
    for (const y of d.byFiscalYear) entry.amounts.set(y.fiscalYear, (entry.amounts.get(y.fiscalYear) ?? 0) + y.amountYen);
  }

  return [...byProject.values()]
    .map(({ amounts, ...rest }) => ({
      ...rest,
      byFiscalYear: [...amounts.entries()].sort(([a], [b]) => a - b).map(([fiscalYear, amountYen]) => ({ fiscalYear, amountYen })),
    }))
    .filter((d) => d.byFiscalYear.length > 0 || d.held.length > 0)
    .sort((a, b) => a.deptIndex - b.deptIndex || a.projectIndex - b.projectIndex);
}

/** 全施策の差し引きを年度ごとに合計する */
export function opexDeductionYearly(list: readonly OpexProjectDeduction[]): { fiscalYear: number; amountYen: number }[] {
  const totals = new Map<number, number>();
  for (const d of list) for (const y of d.byFiscalYear) totals.set(y.fiscalYear, (totals.get(y.fiscalYear) ?? 0) + y.amountYen);
  return [...totals.entries()].sort(([a], [b]) => a - b).map(([fiscalYear, amountYen]) => ({ fiscalYear, amountYen }));
}

/** 保存済み財務計画の識別子に入れる差し引き額。差し引きが無いときは undefined（既存の識別子を変えないため） */
export function opexHashInputOf(
  departments: Department[] | null | undefined,
  fiscalYearEnd: string | undefined,
  addCostConfirmedOf: AddCostConfirmedCheck,
): { fiscalYear: number; amountYen: number }[] | undefined {
  const yearly = opexDeductionYearly(opexDeductionOfProjects(departments, fiscalYearEnd, addCostConfirmedOf));
  return yearly.length > 0 ? yearly : undefined;
}
