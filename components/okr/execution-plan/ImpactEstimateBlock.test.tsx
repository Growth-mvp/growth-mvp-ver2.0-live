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

describe('ImpactEstimateBlock（第5章の業績への貢献（試算））', () => {
  it('試算値と計算式、照合の結果、参考情報であることを表示する', () => {
    render(<ImpactEstimateBlock estimate={estimateProjectImpact(project)} />);
    expect(screen.getByRole('heading', { name: '業績への貢献（試算）' })).toBeTruthy();
    expect(screen.getByText(/確定した業績予測ではなく、STAGE6には反映していません/)).toBeTruthy();
    expect(screen.getByText('10社 × 30% × 20百万円 = 60百万円')).toBeTruthy();
    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
    expect(screen.getAllByText('STAGE3と一致').length).toBeGreaterThan(0);
    expect(screen.getByText(/費用削減の式/)).toBeTruthy();
    expect(screen.getByText(/計上年度は未確認/)).toBeTruthy();
  });

  it('前提が無い案件は、未算定と理由だけを表示する（数値を作らない）', () => {
    render(<ImpactEstimateBlock estimate={estimateProjectImpact({ ...project, impactAssumptions: null })} />);
    expect(screen.getByText(/未算定：/)).toBeTruthy();
    expect(screen.queryByText('売上（試算）')).toBeNull();
  });
});
