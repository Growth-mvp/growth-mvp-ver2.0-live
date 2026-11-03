import { mkBaseFigures, mkBaselineTrajectory } from './baseline';
import { calcYearlyFromKrs } from './compute';

const M = 1_000_000;
const state = {
  financePL: [
    { year: 2024, revenue: 900 * M, cogs: 600 * M, sga: 250 * M, operatingIncome: 50 * M },
    { year: 2025, revenue: 930 * M, cogs: 620 * M, sga: 258 * M, operatingIncome: 52 * M },
  ],
};

describe('販管費は人件費を含む総額として一度だけ計上する（P1c）', () => {
  it('人件費の内訳が未登録なら、人件費は0（販管費を別建てで加えない）', () => {
    expect(mkBaseFigures(state as any)!.personnel_cost).toBe(0);
    const traj = mkBaselineTrajectory(state as any)!;
    expect(Object.values(traj.personnelCostMonthly).every((v) => v === 0)).toBe(true);
  });

  it('基準年の売上・営業利益は実績を再現する（売上930、営業利益52）', () => {
    const traj = mkBaselineTrajectory(state as any)!;
    const rows = calcYearlyFromKrs({ baseTraj: traj, baseFigures: mkBaseFigures(state as any), krs: [], scenario: { successRate: 1, synergyRate: 0 } } as any);
    const y2025 = rows.find((r: any) => r.year === 2025)!;
    expect(y2025.revenue).toBeCloseTo(930 * M, 0);
    expect(y2025.op_income).toBeCloseTo(52 * M, 0);
  });
});
