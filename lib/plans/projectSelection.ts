export type ProjectForSelection = {
  revenueYen: number | null;
  investmentYen: number;
};

export const MAIN_PROJECT_LIMIT = 8;
const RANK_QUOTA = 4;

function topIndexes<T>(rows: T[], value: (row: T) => number, quota: number): Set<number> {
  const ranked = rows
    .map((row, index) => ({ index, value: value(row) }))
    .filter((entry) => Number.isFinite(entry.value) && entry.value > 0)
    .sort((a, b) => b.value - a.value || a.index - b.index);
  return new Set(ranked.slice(0, quota).map((entry) => entry.index));
}

/**
 * 主要施策を選ぶ。売上寄与の大きい施策と投資額の大きい施策を両方含め、
 * 売上寄与だけで重要度を決めない。元の並び順を保つ。
 */
export function selectMainProjects<T extends ProjectForSelection>(rows: T[], limit = MAIN_PROJECT_LIMIT): T[] {
  const byRevenue = topIndexes(rows, (r) => r.revenueYen ?? 0, RANK_QUOTA);
  const byInvestment = topIndexes(rows, (r) => r.investmentYen, RANK_QUOTA);
  const picked = rows.filter((_, index) => byRevenue.has(index) || byInvestment.has(index));
  return picked.length > limit ? picked.slice(0, limit) : picked;
}
