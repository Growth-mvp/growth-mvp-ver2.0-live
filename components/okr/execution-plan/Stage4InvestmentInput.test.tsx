/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ExecutionHumanInvestment } from '@/types/strategy';
import type { InvestmentRowDraft } from '@/lib/stage4/planView/investmentRows';
import { Stage4InvestmentInput } from './Stage4InvestmentInput';

const savedOpex: ExecutionHumanInvestment = {
  id: 'rec-opex',
  type: 'OTHER',
  name: '外注費',
  amount: 1200000,
  spend: { category: 'OPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-05', opexRelation: 'NOT_IN_PLAN' },
};

function renderInput(over: Partial<React.ComponentProps<typeof Stage4InvestmentInput>> = {}) {
  const onChange = jest.fn();
  const props = {
    saved: [] as ExecutionHumanInvestment[],
    rows: [] as InvestmentRowDraft[],
    writable: true,
    onChange,
    newRecordId: () => 'rec-new',
    ...over,
  };
  render(<Stage4InvestmentInput {...props} />);
  return { onChange };
}

describe('Stage4InvestmentInput', () => {
  it('保存済みの明細を表示し、編集で同じIDの入力行を開く', () => {
    const { onChange } = renderInput({ saved: [savedOpex] });
    expect(screen.getByText('外注費')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '編集' }));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ recordId: 'rec-opex', name: '外注費', category: 'OPEX', opexRelation: 'NOT_IN_PLAN' })]);
  });

  it('追加ボタンで、採番したIDの空の入力行を作る', () => {
    const { onChange } = renderInput();
    fireEvent.click(screen.getByRole('button', { name: '+ 投資・追加費用を追加' }));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ recordId: 'rec-new', category: '', amount: '' })]);
  });

  it('OPEXを選ぶと営業利益との関係の欄を出し、未入力の理由を表示する', () => {
    const row: InvestmentRowDraft = {
      key: 'k',
      recordId: 'rec-new',
      name: '人件費',
      category: 'OPEX',
      amount: '500000',
      recurrence: 'ONE_TIME',
      paymentYm: '2026-06',
      startYm: '',
      endYm: '',
      amountBasis: '',
      opexRelation: '',
    };
    renderInput({ rows: [row] });
    expect(screen.getByLabelText('投資・追加費用の営業利益との関係')).toBeTruthy();
    expect(screen.getByText(/未入力のため保存されません：営業利益との関係/)).toBeTruthy();
  });

  it('CAPEXの一時支出は、金額基準と営業利益との関係を出さない', () => {
    const row: InvestmentRowDraft = {
      key: 'k',
      recordId: 'rec-new',
      name: '検査装置',
      category: 'CAPEX',
      amount: '3000000',
      recurrence: 'ONE_TIME',
      paymentYm: '2026-09',
      startYm: '',
      endYm: '',
      amountBasis: '',
      opexRelation: '',
    };
    renderInput({ rows: [row] });
    expect(screen.queryByLabelText('投資・追加費用の営業利益との関係')).toBeNull();
    expect(screen.queryByLabelText('投資・追加費用の金額基準')).toBeNull();
    expect(screen.getByText('入力がそろいました。「計画を保存」で保存されます。')).toBeTruthy();
  });

  it('確認済みの追加費用がある案件では、同じ費用・別の費用の選択肢を出す', () => {
    const row: InvestmentRowDraft = {
      key: 'k',
      recordId: 'rec-new',
      name: '外注費',
      category: 'OPEX',
      amount: '500000',
      recurrence: 'ONE_TIME',
      paymentYm: '2026-06',
      startYm: '',
      endYm: '',
      amountBasis: '',
      opexRelation: '',
    };
    renderInput({ rows: [row], addCostConfirmed: true });
    const select = screen.getByLabelText('投資・追加費用の営業利益との関係') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['', 'IN_PLAN', 'NOT_IN_PLAN', 'SAME_AS_ADD_COST', 'DIFFERENT_FROM_ADD_COST']);
  });

  it('書き込めない状態では入力を止め、理由を表示する', () => {
    renderInput({ writable: false, reasonNotWritable: '計画書を読み込んでいます。' });
    expect((screen.getByRole('button', { name: '+ 投資・追加費用を追加' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('計画書を読み込んでいます。')).toBeTruthy();
  });
});
