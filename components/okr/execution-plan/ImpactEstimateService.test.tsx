/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { estimateProjectImpact } from '@/lib/stage4/planView/impactEstimate';
import { ImpactEstimateBlock } from './ImpactEstimateBlock';

const toEdits = (edits: Record<string, number>) => Object.fromEntries(Object.entries(edits).map(([k, v]) => [`impact:${k}`, v]));

describe('参考試算の入力欄（案件の性質に合う項目だけ）', () => {
  it('サービス型では、件数と単価の欄を出し、受注率と平均受注額の欄は出さない', () => {
    const estimate = estimateProjectImpact(
      { role: 'REVENUE', okrsV2: [] },
      { edits: toEdits({ serviceRevenue: 1, customers: 2, serviceCountPerCustomerMonthly: 12, serviceUnitPriceYen: 2500 }) },
    );
    render(<ImpactEstimateBlock estimate={estimate} onEdit={jest.fn()} />);
    expect(screen.getByLabelText('サービス提供型で売上を計算する（顧客数×件数×料金）')).toBeTruthy();
    expect(screen.getByLabelText('顧客数を修正する')).toBeTruthy();
    expect(screen.getByLabelText('1社当たり月間配送件数を修正する')).toBeTruthy();
    expect(screen.getByLabelText('1件当たり料金を修正する')).toBeTruthy();
    expect(screen.queryByLabelText('受注率を修正する')).toBeNull();
    expect(screen.queryByLabelText('平均受注額を修正する')).toBeNull();
  });

  it('通常の新規売上型では、件数と単価の欄は出さない', () => {
    const estimate = estimateProjectImpact({ role: 'REVENUE', okrsV2: [] }, { edits: toEdits({ customers: 30, rate: 20, deal: 20 }) });
    render(<ImpactEstimateBlock estimate={estimate} onEdit={jest.fn()} />);
    expect(screen.getByLabelText('受注率を修正する')).toBeTruthy();
    expect(screen.queryByLabelText('1件当たり料金を修正する')).toBeNull();
    expect(screen.queryByLabelText('サービス提供型で売上を計算する（顧客数×件数×料金）')).not.toBeNull();
  });
});
