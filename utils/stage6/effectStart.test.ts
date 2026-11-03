import { mkBaseFigures, mkBaselineTrajectory } from './baseline';
import { calcYearlyFromKrs } from './compute';

const M = 1_000_000;
const state = {
  financePL: [
    { year: 2024, revenue: 900 * M, cogs: 600 * M, sga: 250 * M, operatingIncome: 50 * M },
    { year: 2025, revenue: 930 * M, cogs: 620 * M, sga: 258 * M, operatingIncome: 52 * M },
  ],
};
const scenario = { successRate: 1, synergyRate: 0 };

function run(krs: any[]) {
  const baseTraj = mkBaselineTrajectory(state as any)!;
  const baseFigures = mkBaseFigures(state as any);
  return calcYearlyFromKrs({ baseTraj, baseFigures, krs, scenario } as any);
}

const yearOf = (rows: any[], year: number) => rows.find((r) => r.year === year)!;

describe('KR効果は実績年に加算しない（P0-1）', () => {
  it('効果の開始は、最新の実績年の翌年1月から', () => {
    expect(mkBaselineTrajectory(state as any)!.effectStartYm).toBe('2026-01');
  });

  it('売上の金額KRは、財務換算の根拠が無いため、どの年の売上も変えない（P1.5）', () => {
    const krs = [{ id: 'k1', kind: 'REVENUE', label: '新規受注（月額売上）', target: 40 * M, unit: 'JPY', scope: 'company', baseKey: 'revenue', due: '2027-03' }];
    const without = run([]);
    const withKr = run(krs);
    for (const y of [2025, 2026, 2027, 2028]) {
      expect(yearOf(withKr, y).revenue).toBe(yearOf(without, y).revenue);
    }
  });

  it('件数のACQは、財務換算の根拠が無いため売上を変えない（P1b）', () => {
    const krs = [{ id: 'k2', kind: 'ACQ', label: '新規商談数', target: 120, unit: '件', scope: 'company', baseKey: 'acq', due: '2027-03' }];
    const without = run([]);
    const withKr = run(krs);
    for (const y of [2025, 2026, 2027, 2028]) {
      expect(yearOf(withKr, y).revenue).toBe(yearOf(without, y).revenue);
    }
  });

  it('一回限りの投資KRは、実績年の営業利益を変えない', () => {
    const krs = [{ id: 'i1', kind: 'INVEST', label: '投資計画', target: 18 * M, unit: 'JPY', scope: 'project', baseKey: 'invest' }];
    const without = run([]);
    const withKr = run(krs);
    expect(yearOf(withKr, 2025).op_income).toBe(yearOf(without, 2025).op_income);
  });
});

describe('非財務の活動指標は売上へ換算しない（P0-4）', () => {
  it('ACTIVITYのKRは、どの年の売上も変えない', () => {
    const krs = [{ id: 'a1', kind: 'ACTIVITY', label: '点検報告の当日提出率', target: 90, unit: '%', scope: 'company', baseKey: 'acq', due: '2027-01' }];
    const without = run([]);
    const withKr = run(krs);
    for (const y of [2025, 2026, 2027, 2028]) {
      expect(yearOf(withKr, y).revenue).toBe(yearOf(without, y).revenue);
    }
  });
});
