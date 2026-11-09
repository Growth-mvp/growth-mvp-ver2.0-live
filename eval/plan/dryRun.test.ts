import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { BUDGET_USD } from '@/eval/quality/costGuard';
import { buildDryRun } from './dryRun';
import { CROSSDEPT_INPUT } from './quality/crossdept';
import { GROWTH_INPUT } from './quality/growth';
import { PROFIT_INPUT } from './quality/profit';

const outDir = path.join(__dirname, 'results-dryrun');
const cases = [
  { id: 'growth', name: '成長戦略型', raw: GROWTH_INPUT },
  { id: 'profit', name: '収益改善型', raw: PROFIT_INPUT },
  { id: 'crossdept', name: '組織横断型', raw: CROSSDEPT_INPUT },
];

describe('dry-run（実API呼び出しなし）', () => {
  const report = buildDryRun({ cases, now: { year: 2026, month: 11, day: 9 }, outDir });

  it('3件 × 2方式 = 6回。予算とガードの上限の内側に収まる', () => {
    expect(report.plannedCalls).toBe(6);
    expect(report.model).toBe('gpt-5.6-luna');
    expect(report.worstCaseTotalUsd).toBeLessThan(BUDGET_USD);
    expect(report.estTotalUsd).toBeLessThanOrEqual(report.worstCaseTotalUsd);
  });

  it('期間の根拠の3通りが、件ごとに分かれている', () => {
    expect(report.cases.map((c) => c.periodBasis)).toEqual(['COMPANY_PLAN', 'STAGE3_KPI_DUE', null]);
    expect(report.cases[2].periodEndYm).toBeNull();
  });

  it('入力の量（段落の数）を件ごとに示す', () => {
    for (const c of report.cases) {
      expect(c.stage1Years).toBeGreaterThan(0);
      expect(c.storyChapters).toBeGreaterThan(0);
      expect(c.stage3Kpis).toBeGreaterThan(0);
      expect(c.engineSources).toBeGreaterThan(5);
    }
  });

  it('報告を結果フォルダ（git管理外）に保存する', () => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'dryrun-report.json'), JSON.stringify(report, null, 2), 'utf8');
  });
});
