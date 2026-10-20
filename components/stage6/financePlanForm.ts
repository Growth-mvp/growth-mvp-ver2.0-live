import type { CfAssumptions } from '@/utils/stage6/cashflow';
import type { ExistingLoanInput, LoanCategory, NewLoanInput, RepaymentMethod } from '@/utils/stage6/debt';
import type { CashFlowForm } from './CashFlowSection';
import type { DebtForm } from './DebtPanel';

export const MILLION = 1_000_000;

export function parseNumber(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

const round6 = (v: number) => Number(v.toFixed(6));
const asText = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export function toCashFlowAssumptions(f: CashFlowForm): CfAssumptions {
  const pct = (s: string) => {
    const v = parseNumber(s);
    return v === null ? null : v / 100;
  };
  const mil = (s: string) => {
    const v = parseNumber(s);
    return v === null ? null : v * MILLION;
  };
  return {
    minCashYen: mil(f.minCash),
    taxRate: pct(f.taxRate),
    depreciationYen: mil(f.depreciation),
    arRatio: pct(f.ar),
    inventoryRatio: pct(f.inventory),
    apRatio: pct(f.ap),
    targetRevenueYen: mil(f.targetRevenue),
    targetOperatingIncomeYen: mil(f.targetOperatingIncome),
    targetYear: parseNumber(f.targetYear),
  };
}

export function cashFlowFormFrom(a: CfAssumptions): CashFlowForm {
  const pct = (v: number | null) => (v === null ? '' : asText(round6(v * 100)));
  const mil = (v: number | null) => (v === null ? '' : asText(round6(v / MILLION)));
  return {
    minCash: mil(a.minCashYen),
    taxRate: pct(a.taxRate),
    depreciation: mil(a.depreciationYen),
    ar: pct(a.arRatio),
    inventory: pct(a.inventoryRatio),
    ap: pct(a.apRatio),
    targetRevenue: mil(a.targetRevenueYen),
    targetOperatingIncome: mil(a.targetOperatingIncomeYen),
    targetYear: asText(a.targetYear),
  };
}

export type DebtDomain = {
  existingLoans: ExistingLoanInput[];
  newLoans: NewLoanInput[];
  dividendsYen: Record<number, number | null | undefined>;
};

export function toDebtDomain(f: DebtForm, forecastYears: number[]): DebtDomain {
  const mil = (s: string | undefined) => {
    const v = parseNumber(s ?? '');
    return v === null ? null : v * MILLION;
  };
  const pct = (s: string) => {
    const v = parseNumber(s);
    return v === null ? null : v / 100;
  };
  const num = (s: string) => parseNumber(s);
  const existingLoans: ExistingLoanInput[] = f.existing.map((r) => {
    const scheduled: Record<number, number | null> = {};
    for (const y of forecastYears) scheduled[y] = mil(r.schedule[y]);
    return {
      id: r.id,
      name: r.name,
      category: r.category as LoanCategory,
      balanceYen: mil(r.balance),
      annualRate: pct(r.rate),
      scheduledPrincipalYen: scheduled,
    };
  });
  const newLoans: NewLoanInput[] = f.newLoans.map((r) => ({
    id: r.id,
    name: r.name,
    drawYear: num(r.drawYear),
    drawMonth: num(r.drawMonth),
    amountYen: mil(r.amount),
    annualRate: pct(r.rate),
    termYears: num(r.term),
    graceYears: num(r.grace),
    method: r.method as RepaymentMethod,
  }));
  const dividendsYen: Record<number, number | null> = {};
  for (const y of forecastYears) dividendsYen[y] = mil(f.dividends[y]);
  return { existingLoans, newLoans, dividendsYen };
}

export function debtFormFrom(d: DebtDomain): DebtForm {
  const pctText = (v: number | null) => (v === null ? '' : asText(round6(v * 100)));
  const milText = (v: number | null) => (v === null ? '' : asText(round6(v / MILLION)));
  const existing = d.existingLoans.map((l) => {
    const schedule: Record<number, string> = {};
    for (const [k, v] of Object.entries(l.scheduledPrincipalYen)) schedule[Number(k)] = milText(v ?? null);
    return {
      id: l.id,
      name: l.name,
      category: l.category,
      balance: milText(l.balanceYen),
      rate: pctText(l.annualRate),
      schedule,
    };
  });
  const newLoans = d.newLoans.map((l) => ({
    id: l.id,
    name: l.name,
    drawYear: asText(l.drawYear),
    drawMonth: asText(l.drawMonth),
    amount: milText(l.amountYen),
    rate: pctText(l.annualRate),
    term: asText(l.termYears),
    grace: asText(l.graceYears),
    method: l.method,
  }));
  const dividends: Record<number, string> = {};
  for (const [k, v] of Object.entries(d.dividendsYen)) dividends[Number(k)] = milText(v ?? null);
  const used = [...existing.map((r) => r.id), ...newLoans.map((r) => r.id)]
    .map((id) => Number(/(\d+)$/.exec(id)?.[1] ?? -1))
    .filter((n) => n >= 0);
  const seq = used.length > 0 ? Math.max(...used) + 1 : 0;
  return { existing, newLoans, dividends, seq };
}
