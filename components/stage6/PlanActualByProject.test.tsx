/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Department } from '@/types/strategy';
import { PlanActualByProject } from './PlanActualByProject';

const departments = [
  {
    id: 'd1',
    name: '宅配事業',
    projects: [
      {
        id: 'p1',
        title: '少量配送',
        financeEffect: {
          kind: 'COST_REDUCTION',
          method: 'DIRECT_AMOUNT',
          directAmountYen: 5_000_000,
          amountBasis: 'ANNUAL',
          startYm: '2027-04',
          endYm: '2028-03',
          source: 'USER_INPUT',
          confirmed: true,
          sourceNote: '見積書（架空）',
        },
        executionHumanInvestments: [
          {
            id: 'ox1',
            type: 'OTHER',
            name: '外注費（検証用）',
            amount: 1_000_000,
            spend: { category: 'OPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-10', opexRelation: 'NOT_IN_PLAN' },
          },
        ],
        financeActuals: [
          { itemKey: 'EFFECT:COST_REDUCTION', ym: '2026-12', amountYen: 400_000, recordedAt: 't', createdAt: 't' },
          { itemKey: 'OPEX:ox1', ym: '2026-10', amountYen: 1_000_000, recordedAt: 't', createdAt: 't' },
        ],
      },
    ],
  },
] as unknown as Department[];

describe('PlanActualByProject（STAGE6のプロジェクト別 計画と実績）', () => {
  it('既定は営業利益効果。計画期間外の実績を会計年度に集計し、未登録の年度を「計画期間内は未登録」と示す', () => {
    render(<PlanActualByProject departments={departments} fiscalYearEnd="3" />);
    expect(screen.getByRole('heading', { name: 'プロジェクト別 財務効果の計画と実績' })).toBeTruthy();
    const table = screen.getByRole('table', { name: '費用削減の年度別の計画と実績' });
    expect(within(table).getByText('2027年3月期')).toBeTruthy();
    expect(within(table).getByText('+400,000円')).toBeTruthy();
    expect(within(table).getAllByText('計画期間内は未登録')).toHaveLength(2);
    expect(within(table).getByText('計画期間外の実績（達成状況には含めていません）')).toBeTruthy();
    expect(within(table).getByText('+5,000,000円')).toBeTruthy();
  });

  it('費用・支出額に切り替えると、OPEXの計画と登録済み実績を正の金額で示す', () => {
    render(<PlanActualByProject departments={departments} fiscalYearEnd="3" />);
    fireEvent.click(screen.getByRole('button', { name: '費用・支出額' }));
    fireEvent.change(screen.getByLabelText('財務項目'), { target: { value: 'OPEX:ox1' } });
    const table = screen.getByRole('table', { name: '外注費（検証用）の年度別の計画と実績' });
    expect(within(table).getByText('2027年3月期')).toBeTruthy();
    expect(within(table).getAllByText('+1,000,000円')).toHaveLength(2);
    expect(within(table).getByText('登録済み（計画期間の全月）')).toBeTruthy();
  });

  it('決算月が無い、または比較できる項目が無い場合は、その旨を示す', () => {
    render(<PlanActualByProject departments={[]} fiscalYearEnd="3" />);
    expect(screen.getByText(/比較できる財務効果・OPEXがありません/)).toBeTruthy();
  });
});
