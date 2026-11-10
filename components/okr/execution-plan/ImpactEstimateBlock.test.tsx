/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { estimateProjectImpact } from '@/lib/stage4/planView/impactEstimate';
import { ImpactEstimateBlock } from './ImpactEstimateBlock';

const project = {
  role: 'COST',
  impactAssumptions: { targetCustomers: 10, conversionRatePct: 30, averageDealMJPY: 20, currentCostMJPY: 200, reductionRatePct: 20 },
  impactRevenueMJPY: 60,
  impactOpIncomeMJPY: 40,
  impactRationale: '粗利率25%による粗利15百万円から案件対応の追加費用6百万円を差し引き、営業利益増分を9百万円と見込む。',
  okrsV2: [{ label: '用途別案件の粗利率', target: 20, unit: '%' }],
};

describe('ImpactEstimateBlock（第5章の業績への貢献（参考試算））', () => {
  it('参考試算の値・計算式・出所・未確認事項を表示し、STAGE6へは反映しないと明示する', () => {
    render(<ImpactEstimateBlock estimate={estimateProjectImpact(project)} />);
    expect(screen.getByRole('heading', { name: '業績への貢献（参考試算）' })).toBeTruthy();
    expect(screen.getByText(/確定した業績予測ではなく、STAGE6の正式な計画には反映していません/)).toBeTruthy();
    expect(screen.getByText('10社 × 30% × 20百万円 = 60百万円')).toBeTruthy();
    expect(screen.getByText('60百万円 × 20% = 12百万円')).toBeTruthy();
    expect(screen.getByText(/別の入力値に基づく比較値/)).toBeTruthy();
    expect(screen.getAllByText('6〜9').length).toBeGreaterThan(0);
    expect(screen.getByText(/確定した営業利益としては扱わない/)).toBeTruthy();
    expect(screen.getByText('売上の対象区分（有償開発か量産か）は未確認')).toBeTruthy();
    expect(screen.getByText('計上年度は未確認のため、年度別の業績としては表示しない')).toBeTruthy();
  });

  it('STAGE3の営業利益（費用削減）の数値は、利益貢献として表示しない', () => {
    const { container } = render(<ImpactEstimateBlock estimate={estimateProjectImpact(project)} />);
    expect(container.textContent).not.toContain('40百万円');
    expect(container.textContent).not.toContain('費用削減の式');
  });

  it('前提が無い案件は、未算定と理由だけを表示する（数値を作らない）', () => {
    render(<ImpactEstimateBlock estimate={estimateProjectImpact({ ...project, impactAssumptions: null })} />);
    expect(screen.getByText(/未算定：/)).toBeTruthy();
    expect(screen.queryByText(/売上（参考試算）/)).toBeNull();
  });
});
