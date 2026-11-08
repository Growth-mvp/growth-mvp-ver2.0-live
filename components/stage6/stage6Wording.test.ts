import { readFileSync } from 'fs';
import path from 'path';

const read = (rel: string) => readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

describe('STAGE6 画面の語句：目標・補間値・条件付き試算を「予測」と表示しない', () => {
  const screens = [
    'components/stage6/TargetOverview.tsx',
    'components/stage6/FinancePlanSection.tsx',
    'components/stage6/CashFlowSection.tsx',
  ];

  it.each(screens)('%s に、予測として誤読される表示が無い', (file) => {
    const s = read(file);
    for (const bad of ['予測値', '達成予測', '目標達成見込み', 'プロジェクト合計予測', '今後の業績の見通し', '見込み ${']) {
      expect(s).not.toContain(bad);
    }
  });

  it('CF の売上・営業利益の補間は「目標への補間」と表示し、補間値は独立した予測ではないと明示する', () => {
    const cf = read('components/stage6/CashFlowSection.tsx');
    expect(cf).toContain("'目標への補間'");
    expect(cf).toContain('補間値は目標への通過点であり、独立した予測ではありません');
  });
});
