import { renderToStaticMarkup } from 'react-dom/server';
import type { FinanceEffect } from '@/types/strategy';
import { FinanceEffectSection } from './FinanceEffectSection';

const M = 1_000_000;

function html(effect: FinanceEffect | undefined) {
  return renderToStaticMarkup(
    <FinanceEffectSection effect={effect} disabled={false} overlapCandidates={[]} onChange={() => {}} />,
  );
}

describe('財務効果：旧見込みの表示と営業利益の増分入力', () => {
  it('旧見込みから候補を作る表示や、旧値との比較は出さない', () => {
    const out = html(undefined);
    expect(out).not.toContain('従来の見込みから候補を作成');
    expect(out).not.toContain('従来の成果見込みと、新しい財務効果の関係');
  });

  it('売上増加の施策には、営業利益の増分を任意で入力する欄を出す（原価率は参考のまま）', () => {
    const out = html({ kind: 'REVENUE_UP', source: 'USER_INPUT', confirmed: false, costRatePct: 40 });
    expect(out).toContain('5. 営業利益への増分効果');
    expect(out).toContain('売上増加に伴う営業利益の増分（百万円・変動費・追加費用を含む純額）');
    expect(out).toContain('原価率（%・参考。利益へは自動で差し引かない）');
  });

  it('費用削減の施策には、売上増加用の営業利益欄を出さない', () => {
    const out = html({ kind: 'COST_REDUCTION', source: 'USER_INPUT', confirmed: false, directAmountYen: 1 * M });
    expect(out).not.toContain('売上増加に伴う営業利益の増分');
  });
});
