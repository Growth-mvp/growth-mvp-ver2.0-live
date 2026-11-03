import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const FINANCE_EFFECT_BOUNDARY = [
  path.join(ROOT, 'utils', 'stage6', 'financeEffectPlan.ts'),
  path.join(ROOT, 'components', 'stage6', 'FinanceEffectTrialPanel.tsx'),
  path.join(ROOT, 'components', 'stage6', 'FinancePlanSection.tsx'),
];

const STAGE6_CALCULATION_AND_DISPLAY = [
  ...sourceFiles(path.join(ROOT, 'components', 'stage6')),
  ...sourceFiles(path.join(ROOT, 'utils', 'stage6')),
  ...sourceFiles(path.join(ROOT, 'app', 'stage6')),
  path.join(ROOT, 'utils', 'simulationBridge.ts'),
  path.join(ROOT, 'utils', 'financeSimulation.ts'),
  path.join(ROOT, 'utils', 'okrFinanceRunner.ts'),
];

describe('STAGE4の財務効果は、承認された連動境界の外のSTAGE6計算・表示から参照されない', () => {
  const outside = STAGE6_CALCULATION_AND_DISPLAY.filter((f) => !FINANCE_EFFECT_BOUNDARY.includes(f));

  it.each(outside.map((f) => [path.relative(ROOT, f), f]))('%s', (_rel, file) => {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/financeEffect|FinanceEffect|lib\/financeEffect/);
  });

  it('連動境界のモジュールは、既存のCF計算・財務計画パイプラインを呼ばない（PL試算のみ）', () => {
    const text = readFileSync(FINANCE_EFFECT_BOUNDARY[0], 'utf8');
    expect(text).not.toMatch(/cashflow|financePlanPipeline|computeStage6FinancePlan|buildCashFlowPlan/);
  });

  it('対象の一覧が空でない（スキャンが機能している）', () => {
    expect(STAGE6_CALCULATION_AND_DISPLAY.length).toBeGreaterThan(20);
  });
});
