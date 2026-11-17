import type { Department, FinanceEffect } from '@/types/strategy';
import { computeFinanceEffect } from '@/lib/financeEffect';
import { buildInvestmentItems, fiscalYearOf, parseFiscalYearEndMonth } from './investmentDemand';

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

const HOLD_SAME_WITHOUT_ADD_COST = '同じ案件の確認済み追加費用がないため、同じ費用か確認できません';
const HOLD_NOT_IN_PLAN_WITH_ADD_COST = '同じ案件に確認済みの追加費用があるため、同じ費用か確認してください（二重に差し引かないため保留）';

const effectsOf = (project: { financeEffect?: FinanceEffect; financeEffects?: FinanceEffect[] }): FinanceEffect[] =>
  [project.financeEffect, ...(Array.isArray(project.financeEffects) ? project.financeEffects : [])].filter(
    (e): e is FinanceEffect => !!e && typeof e === 'object',
  );

/** 確認済み（STAGE6に反映される）の追加費用（COST_INCREASE）を持つか */
export function hasConfirmedAddCost(effects: readonly FinanceEffect[]): boolean {
  return effects.some((e) => e.kind === 'COST_INCREASE' && computeFinanceEffect(e).status === 'CONFIRMED');
}

/**
 * 営業利益計画に含まれないOPEXを、施策ごとに差し引く。
 * - IN_PLAN：営業利益に含まれているため差し引かない
 * - NOT_IN_PLAN：確認済みの追加費用が無い案件だけ差し引く。ある案件は同じ費用かを確認するまで保留
 * - SAME_AS_ADD_COST：確認済みの追加費用に含まれるため差し引かない（追加費用が無ければ保留）
 * - DIFFERENT_FROM_ADD_COST：追加費用とは別の費用として差し引く
 * 未確定（集計対象外）の明細と、営業利益との関係が無い既存の明細は対象外。
 */
export function opexDeductionOfProjects(departments: Department[] | null | undefined, fiscalYearEnd: string | undefined): OpexProjectDeduction[] {
  const endMonth = parseFiscalYearEndMonth(fiscalYearEnd);
  if (endMonth === null) return [];

  const addCostOf = new Map<string, boolean>();
  (departments ?? []).forEach((dept, dIdx) => {
    (dept?.projects ?? []).forEach((project, pIdx) => {
      if (project) addCostOf.set(`${dIdx}:${pIdx}`, hasConfirmedAddCost(effectsOf(project)));
    });
  });

  const byProject = new Map<string, OpexProjectDeduction & { amounts: Map<number, number> }>();
  for (const item of buildInvestmentItems(departments)) {
    const relation = item.spend?.opexRelation;
    if (item.category !== 'OPEX' || relation === undefined || !item.ready) continue;
    const key = `${item.ref.deptIndex}:${item.ref.projectIndex}`;
    let entry = byProject.get(key);
    if (!entry) {
      entry = { deptIndex: item.ref.deptIndex, projectIndex: item.ref.projectIndex, deptName: item.deptName, projectTitle: item.projectTitle, byFiscalYear: [], held: [], amounts: new Map() };
      byProject.set(key, entry);
    }
    const hasAddCost = addCostOf.get(key) === true;
    if (relation === 'IN_PLAN') continue;
    if (relation === 'SAME_AS_ADD_COST') {
      if (!hasAddCost) entry.held.push({ label: item.label, reason: HOLD_SAME_WITHOUT_ADD_COST });
      continue;
    }
    if (relation === 'NOT_IN_PLAN' && hasAddCost) {
      entry.held.push({ label: item.label, reason: HOLD_NOT_IN_PLAN_WITH_ADD_COST });
      continue;
    }
    for (const alloc of item.allocation) {
      const fy = fiscalYearOf(alloc.ym, endMonth);
      entry.amounts.set(fy, (entry.amounts.get(fy) ?? 0) + alloc.amountYen);
    }
  }

  return [...byProject.values()]
    .map(({ amounts, ...rest }) => ({
      ...rest,
      byFiscalYear: [...amounts.entries()].sort(([a], [b]) => a - b).map(([fiscalYear, amountYen]) => ({ fiscalYear, amountYen })),
    }))
    .filter((d) => d.byFiscalYear.length > 0 || d.held.length > 0)
    .sort((a, b) => a.deptIndex - b.deptIndex || a.projectIndex - b.projectIndex);
}

/** 全施策の差し引きを年度ごとに合計する（保存済み計画の鮮度判定に使う） */
export function opexDeductionYearly(list: readonly OpexProjectDeduction[]): { fiscalYear: number; amountYen: number }[] {
  const totals = new Map<number, number>();
  for (const d of list) for (const y of d.byFiscalYear) totals.set(y.fiscalYear, (totals.get(y.fiscalYear) ?? 0) + y.amountYen);
  return [...totals.entries()].sort(([a], [b]) => a - b).map(([fiscalYear, amountYen]) => ({ fiscalYear, amountYen }));
}
