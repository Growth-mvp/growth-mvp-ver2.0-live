import { mkBaseFigures, mkBaselineTrajectory } from './baseline';
import { buildProjectContributions, calcYearlyFromKrs } from './compute';

const M = 1_000_000;
const financePL = [
  { year: 2024, revenue: 900 * M, cogs: 600 * M, sga: 250 * M, operatingIncome: 50 * M },
  { year: 2025, revenue: 930 * M, cogs: 620 * M, sga: 258 * M, operatingIncome: 52 * M },
];

function contribution(krs: any[]) {
  const state = { financePL };
  const baseTraj = mkBaselineTrajectory(state as any)!;
  const baseFigures = mkBaseFigures(state as any)!;
  const baselineYearly = calcYearlyFromKrs({ baseTraj, baseFigures, krs: [], scenario: { successRate: 0.8, synergyRate: 0 } } as any);
  const rows = buildProjectContributions({
    core: {
      ready: true,
      approved: [{ key: 'p1', dept: '検証部', proj: '検証プロジェクト', investTotal: 0, krCount: krs.length }],
      projectKrsMap: new Map([['p1', krs]]),
      baselineYearly,
    },
    financePL,
    departments: [],
    effectiveSelectedKeys: ['p1'],
    mkBaseFigures: () => baseFigures,
    mkBaselineTrajectory: () => baseTraj,
    getEvidenceFromProject: () => ({ source: 'estimated', confidence: 'low' }),
    executionWeightsMap: new Map(),
  } as any);
  return rows[0] as any;
}

const kr = (o: any) => ({ id: o.label, scope: 'company', baseKey: 'acq', due: '2028-12', ...o });

describe('プロジェクト別の寄与は、財務換算の根拠が無いKRから売上を推定しない（P1.5）', () => {
  it.each([
    ['投資目標（支出条件なし）', kr({ kind: 'INVEST', label: '投資計画', target: 18 * M, unit: 'JPY' })],
    ['成功率（%）', kr({ kind: 'SUCCESS_RATE', label: '成約率', target: 80, unit: '%' })],
    ['新規商談の改善率（%）', kr({ kind: 'ACQ', label: '改善率', target: 18.32, unit: '%' })],
    ['売上の金額（月額）', kr({ kind: 'REVENUE', label: '新規受注', target: 40 * M, unit: 'JPY' })],
  ])('%s：売上の寄与は0で、対象外のKRとして数える', (_name, k) => {
    const row = contribution([k]);
    expect(row.deltaRevenueTotal).toBe(0);
    expect(row.deltaOpTotal).toBe(0);
    expect(row.krCount).toBe(1);
    expect(row.financeExcludedKrCount).toBe(1);
  });
});
