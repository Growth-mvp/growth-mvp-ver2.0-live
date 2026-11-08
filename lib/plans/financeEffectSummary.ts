import type { Department, FinanceEffect, Project } from '@/types/strategy';
import { computeFinanceEffect, normalizeFinanceEffect } from '@/lib/financeEffect';

const MILLION = 1_000_000;

export type ProjectFinanceSummary = {
  revenueText: string;
  operatingText: string;
  confirmedRevenueYen: number | null;
  confirmedOperatingYen: number | null;
  confirmedCount: number;
  pendingCount: number;
};

export type FinanceTotals = {
  revenueYen: number | null;
  operatingIncomeYen: number | null;
  projectCount: number;
  projectsWithConfirmedCount: number;
  confirmedCount: number;
  pendingCount: number;
};

function effectsOf(project: Project): FinanceEffect[] {
  const raw = [project.financeEffect, ...(Array.isArray(project.financeEffects) ? project.financeEffects : [])];
  return raw.map((e) => normalizeFinanceEffect(e)).filter((e): e is FinanceEffect => e !== undefined);
}

function signedMillion(yen: number): string {
  const v = Math.round((yen / MILLION) * 10) / 10;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}百万円`;
}

/** 経路Bの財務効果（確認済み）だけを、計画書の数値にする。未確認・未算定は金額を入れず、理由を示す */
export function projectFinanceSummary(project: Project): ProjectFinanceSummary {
  const effects = effectsOf(project);
  const revenueParts: string[] = [];
  const operatingParts: string[] = [];
  let confirmedRevenueYen: number | null = null;
  let confirmedOperatingYen: number | null = null;
  let confirmedCount = 0;
  let pendingCount = 0;
  let hasRevenueEffect = false;

  for (const effect of effects) {
    const r = computeFinanceEffect(effect);
    if (r.status === 'NOT_FINANCIAL' || r.status === 'NOT_SET') continue;
    const basis = effect.amountBasis === 'TOTAL' ? '一回限り' : '年額換算';
    const isRevenue = effect.kind === 'REVENUE_UP';
    if (isRevenue) hasRevenueEffect = true;

    if (r.status !== 'CONFIRMED') {
      pendingCount++;
      const note = r.status === 'DRAFT' ? '未確認（財務試算に含まない）' : `未算定（不足：${r.missing.join('、')}）`;
      if (isRevenue) revenueParts.push(note);
      operatingParts.push(note);
      continue;
    }

    confirmedCount++;
    const revenueYen = isRevenue ? (r.annualRevenueYen ?? r.totalYen ?? null) : null;
    const operatingYen = r.annualOperatingEffectYen ?? r.oneTimeOperatingEffectYen ?? null;
    if (revenueYen !== null) {
      confirmedRevenueYen = (confirmedRevenueYen ?? 0) + revenueYen;
      revenueParts.push(`${basis} ${signedMillion(revenueYen)}（確認済み）`);
    }
    if (operatingYen !== null) {
      confirmedOperatingYen = (confirmedOperatingYen ?? 0) + operatingYen;
      operatingParts.push(`${basis} ${signedMillion(operatingYen)}（確認済み）`);
    } else if (isRevenue) {
      operatingParts.push('売上増の営業利益の増分は未算定');
    }
  }

  return {
    revenueText: revenueParts.length > 0 ? revenueParts.join(' ／ ') : hasRevenueEffect ? '未算定' : '売上の財務効果なし',
    operatingText: operatingParts.length > 0 ? operatingParts.join(' ／ ') : '財務効果なし',
    confirmedRevenueYen,
    confirmedOperatingYen,
    confirmedCount,
    pendingCount,
  };
}

/** 全社の財務効果の合計（確認済みのみ）。全社の財務試算（統一PL）の内訳として使い、そこへ加算しないこと */
export function financeTotals(departments: Department[] | null | undefined): FinanceTotals {
  const totals: FinanceTotals = {
    revenueYen: null,
    operatingIncomeYen: null,
    projectCount: 0,
    projectsWithConfirmedCount: 0,
    confirmedCount: 0,
    pendingCount: 0,
  };
  for (const dept of departments ?? []) {
    for (const project of dept?.projects ?? []) {
      totals.projectCount++;
      const s = projectFinanceSummary(project);
      if (s.confirmedCount > 0) totals.projectsWithConfirmedCount++;
      totals.confirmedCount += s.confirmedCount;
      totals.pendingCount += s.pendingCount;
      if (s.confirmedRevenueYen !== null) totals.revenueYen = (totals.revenueYen ?? 0) + s.confirmedRevenueYen;
      if (s.confirmedOperatingYen !== null) totals.operatingIncomeYen = (totals.operatingIncomeYen ?? 0) + s.confirmedOperatingYen;
    }
  }
  return totals;
}
