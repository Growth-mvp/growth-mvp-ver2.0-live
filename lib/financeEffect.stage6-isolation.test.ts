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
  path.join(ROOT, 'utils', 'stage6', 'unifiedPl.ts'),
  path.join(ROOT, 'utils', 'stage6', 'financeOutlook.ts'),
  path.join(ROOT, 'utils', 'stage6', 'bankFinancialPlan.ts'),
  path.join(ROOT, 'components', 'stage6', 'UnifiedPlPanel.tsx'),
  path.join(ROOT, 'components', 'stage6', 'FinancePlanSection.tsx'),
  path.join(ROOT, 'components', 'stage6', 'FinanceEffectProjectList.tsx'),
];

const STAGE6_CALCULATION_AND_DISPLAY = [
  ...sourceFiles(path.join(ROOT, 'components', 'stage6')),
  ...sourceFiles(path.join(ROOT, 'utils', 'stage6')),
  ...sourceFiles(path.join(ROOT, 'app', 'stage6')),
  path.join(ROOT, 'utils', 'simulationBridge.ts'),
  path.join(ROOT, 'utils', 'financeSimulation.ts'),
  path.join(ROOT, 'utils', 'okrFinanceRunner.ts'),
];

/* 連動境界の外で禁止する、生の財務効果の解釈（計算モジュール・生の型・生の項目）。
 * 境界モジュール（financeEffectPlan など）が作った結果を読むことは、境界の仕事なので許す。 */
const RAW_FINANCE_EFFECT_USE = [
  /from\s+['"](?:@\/|(?:\.\.?\/)+)lib\/financeEffect['"]/,
  /\bcomputeFinanceEffect\b|\bnormalizeFinanceEffects?\b|\bfindFinanceEffectOverlaps\b|\brevenueSgaRuleOf\b/,
  /\bFinanceEffect\b/,
  /\.financeEffects?\b/,
];

describe('STAGE4の財務効果は、承認された連動境界の外のSTAGE6計算・表示で解釈されない', () => {
  const outside = STAGE6_CALCULATION_AND_DISPLAY.filter((f) => !FINANCE_EFFECT_BOUNDARY.includes(f));

  it.each(outside.map((f) => [path.relative(ROOT, f), f]))('生の財務効果を解釈しない: %s', (_rel, file) => {
    const text = readFileSync(file, 'utf8');
    for (const pattern of RAW_FINANCE_EFFECT_USE) expect(text).not.toMatch(pattern);
  });

  it.each(outside.map((f) => [path.relative(ROOT, f), f]))('財務効果の関連モジュールは、連動境界からだけ読む: %s', (_rel, file) => {
    const text = readFileSync(file, 'utf8');
    const specifiers = [...text.matchAll(/from\s+['"]([^'"]*financeEffect[^'"]*)['"]/gi)].map((m) => m[1]);
    for (const spec of specifiers) expect(spec.endsWith('financeEffectPlan')).toBe(true);
  });

  it('連動境界のモジュールは、既存のCF計算・財務計画パイプラインを呼ばない（PL試算のみ）', () => {
    const text = readFileSync(FINANCE_EFFECT_BOUNDARY[0], 'utf8');
    expect(text).not.toMatch(/financePlanPipeline|computeStage6FinancePlan|buildCashFlowPlan/);
    expect(text).not.toMatch(/import\s+(?!type\s)[^;]*from\s+'\.\/cashflow'/);
  });

  it('対象の一覧が空でない（スキャンが機能している）', () => {
    expect(STAGE6_CALCULATION_AND_DISPLAY.length).toBeGreaterThan(20);
  });
});
