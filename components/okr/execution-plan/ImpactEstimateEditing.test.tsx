/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { estimateProjectImpact } from '@/lib/stage4/planView/impactEstimate';
import { ImpactEstimateBlock } from './ImpactEstimateBlock';

const project = {
  id: 'p-jnc-renewal',
  role: 'REVENUE',
  impactAssumptions: { targetCustomers: 10, conversionRatePct: 30, averageDealMJPY: 20 },
  impactRationale: '追加費用6百万円を見込む',
};

describe('ImpactEstimateBlock（前提と試算の一体化）', () => {
  it('前提は折りたたまず、そのまま入力できる。入力した値が前提の修正として渡る', () => {
    const est = estimateProjectImpact(project, {});
    const onEdit = jest.fn();
    render(<ImpactEstimateBlock estimate={est} onEdit={onEdit} />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs.length).toBeGreaterThanOrEqual(3);
    fireEvent.change(inputs[0], { target: { value: '12' } });
    expect(onEdit).toHaveBeenLastCalledWith('customers', 12);
  });

  it('前提を変えると、保存された編集から試算が計算し直される（計算式は変わらない）', () => {
    const before = estimateProjectImpact(project, {});
    const { rerender } = render(<ImpactEstimateBlock estimate={before} onEdit={jest.fn()} />);
    expect(screen.getByText('10社 × 30% × 20百万円 = 60百万円')).toBeTruthy();
    const after = estimateProjectImpact(project, { edits: { 'impact:customers': 12 } });
    rerender(<ImpactEstimateBlock estimate={after} onEdit={jest.fn()} />);
    expect(screen.getByText('12社 × 30% × 20百万円 = 72百万円')).toBeTruthy();
    expect(screen.queryByText('10社 × 30% × 20百万円 = 60百万円')).toBeNull();
  });

  it('試算値の欄は入力できない（読み取り専用）', () => {
    const est = estimateProjectImpact(project, {});
    const { container } = render(<ImpactEstimateBlock estimate={est} onEdit={jest.fn()} />);
    const table = container.querySelector('table') as HTMLElement;
    expect(table.querySelectorAll('input').length).toBe(0);
  });
});
