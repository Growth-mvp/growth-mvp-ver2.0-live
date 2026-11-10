/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { KrPlanActualPanel } from './KrPlanActualPanel';

const departments = [
  {
    id: 'd1',
    name: '営業部',
    projects: [
      {
        id: 'p-coating',
        title: '塗料メーカー向けプロジェクト',
        okrsV2: [
          { id: 'k-proposals', label: '設計段階の有効提案数', target: 6, unit: '件', due: '2027-02', actual: { value: 3, asOf: '2027-01', recordedAt: 'r' } },
          { id: 'k-paid', label: '有償開発受注数', target: 3, unit: '件', due: '2027-03' },
        ],
      },
    ],
  },
];

describe('KrPlanActualPanel（STAGE6のKR計画・実績）', () => {
  it('KRの計画・実績・達成率を表示し、金額には換算しない', () => {
    render(<KrPlanActualPanel departments={departments} />);
    const row = screen.getByText('設計段階の有効提案数').closest('tr')!;
    expect(row.textContent).toContain('6件');
    expect(row.textContent).toContain('3件');
    expect(row.textContent).toContain('50%');
    expect(row.textContent).toContain('比較できます');
  });

  it('実績が無いKRは「未登録」とし、達成率を出さない', () => {
    render(<KrPlanActualPanel departments={departments} />);
    const row = screen.getByText('有償開発受注数').closest('tr')!;
    expect(row.textContent).toContain('未登録');
    expect(row.textContent).toContain('実績未登録');
    expect(row.textContent).not.toContain('%');
  });

  it('財務の実績は未登録であることを明示する（売上・営業利益の金額は表示しない）', () => {
    render(<KrPlanActualPanel departments={departments} />);
    expect(screen.getByText(/売上・営業利益の実績は、この画面に登録されていない/)).toBeTruthy();
  });

  it('KRが無い場合は、その旨を表示する', () => {
    render(<KrPlanActualPanel departments={[]} />);
    expect(screen.getByText('KRがまだありません。')).toBeTruthy();
  });
});
