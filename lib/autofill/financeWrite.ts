/* 財務の反映：store の損益（financePL）と貸借（financeBS）の行を、年度ごとに結び付けて計画を適用し、
 * 変わった配列だけを返す。既存の行や項目は、計画が指定したものだけを変える。 */
import type { CurrentFinanceRow, FilingApplyPlan, FinanceKey } from './filingCandidates';

type PlRow = { year: number; revenue?: number | null; operatingIncome?: number | null; netIncome?: number | null } & Record<string, unknown>;
type BsRow = { year: number; totalAssets?: number | null; netAssets?: number | null } & Record<string, unknown>;

const PL_KEYS: FinanceKey[] = ['revenue', 'operatingIncome', 'netIncome'];
const BS_KEYS: FinanceKey[] = ['totalAssets', 'netAssets'];

export function combineFinance(pl: PlRow[], bs: BsRow[]): CurrentFinanceRow[] {
  const years = new Set<number>([...pl.map((r) => r.year), ...bs.map((r) => r.year)]);
  return [...years]
    .sort((a, b) => a - b)
    .map((year) => {
      const p = pl.find((r) => r.year === year);
      const b = bs.find((r) => r.year === year);
      return {
        year,
        revenue: p?.revenue ?? undefined,
        operatingIncome: p?.operatingIncome ?? undefined,
        netIncome: p?.netIncome ?? undefined,
        totalAssets: b?.totalAssets ?? undefined,
        netAssets: b?.netAssets ?? undefined,
      };
    });
}

/** 計画の結果を、損益と貸借の配列に戻す。変更がない配列は null（書き込まない） */
export function splitFinanceWrite(plan: FilingApplyPlan, pl: PlRow[], bs: BsRow[]): { pl: PlRow[] | null; bs: BsRow[] | null } {
  const changedPl = new Map<number, Partial<Record<FinanceKey, number>>>();
  const changedBs = new Map<number, Partial<Record<FinanceKey, number>>>();
  for (const applied of plan.financeApplied) {
    const row = plan.financeRows.find((r) => r.year === applied.year);
    if (!row) continue;
    for (const k of applied.keys) {
      const value = row[k];
      if (value === undefined || value === null) continue;
      if (PL_KEYS.includes(k)) changedPl.set(applied.year, { ...changedPl.get(applied.year), [k]: value });
      if (BS_KEYS.includes(k)) changedBs.set(applied.year, { ...changedBs.get(applied.year), [k]: value });
    }
  }

  const apply = <T extends { year: number }>(rows: T[], changes: Map<number, Partial<Record<FinanceKey, number>>>): T[] | null => {
    if (changes.size === 0) return null;
    const out = rows.map((r) => ({ ...r }));
    for (const [year, values] of changes) {
      const i = out.findIndex((r) => r.year === year);
      if (i >= 0) out[i] = { ...out[i], ...values };
      else out.push({ year, ...values } as unknown as T);
    }
    return out.sort((a, b) => a.year - b.year);
  };

  return { pl: apply(pl, changedPl), bs: apply(bs, changedBs) };
}
