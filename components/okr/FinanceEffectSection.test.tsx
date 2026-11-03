/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { FinanceEffectSection } from './FinanceEffectSection';
import type { FinanceEffect } from '@/types/strategy';

const complete: FinanceEffect = {
  kind: 'COST_REDUCTION',
  method: 'DIRECT_AMOUNT',
  directAmountYen: 18_000_000,
  amountBasis: 'ANNUAL',
  startYm: '2027-04',
  sourceNote: '見積書（架空）',
  source: 'USER_INPUT',
  confirmed: false,
};

function setup(effect: FinanceEffect | undefined, overlapCandidates: string[] = []) {
  const onChange = jest.fn();
  render(<FinanceEffectSection effect={effect} disabled={false} overlapCandidates={overlapCandidates} onChange={onChange} />);
  return onChange;
}

describe('STAGE4 財務効果の入力欄', () => {
  it('未設定の施策は、任意の入力として表示される', () => {
    setup(undefined);
    expect(screen.getByText('未設定（任意）')).toBeTruthy();
  });

  it('入力が不足していれば「未算定」と不足項目を表示する（金額は出さない）', () => {
    setup({ ...complete, amountBasis: undefined, sourceNote: undefined });
    expect(screen.getByText('未算定（入力不足）')).toBeTruthy();
    expect(screen.getByText(/不足：金額の単位/)).toBeTruthy();
  });

  it('入力が揃っても、確認するまでは確認済みにならない', () => {
    setup(complete);
    expect(screen.getByText('未確定（確認待ち）')).toBeTruthy();
    expect(screen.getByText('内容を確認し、確認済みにする')).toBeTruthy();
  });

  it('確認ボタンは、確認済みの値（確認日時つき）を保存する', () => {
    const onChange = setup(complete);
    fireEvent.click(screen.getByText('内容を確認し、確認済みにする'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(next.confirmed).toBe(true);
    expect(typeof next.confirmedAt).toBe('string');
  });

  it('確認済みの値の金額を変えると、確認は外れる', () => {
    const onChange = setup({ ...complete, confirmed: true, confirmedAt: '2026-11-01T00:00:00.000Z' });
    expect(screen.getByText('利用者が確認済み')).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('18'), { target: { value: '20' } });
    const next = onChange.mock.calls[0][0];
    expect(next.directAmountYen).toBe(20_000_000);
    expect(next.confirmed).toBe(false);
    expect(next.confirmedAt).toBeUndefined();
  });

  it('金額は百万円で入力し、円で保存する', () => {
    const onChange = setup(complete);
    expect(screen.getByDisplayValue('18')).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('18'), { target: { value: '2.5' } });
    expect(onChange.mock.calls[0][0].directAmountYen).toBe(2_500_000);
  });

  it('財務換算しない施策は、算定方法や金額の入力を出さない', () => {
    const onChange = setup(complete);
    fireEvent.change(screen.getByDisplayValue('原価削減'), { target: { value: 'NOT_FINANCIAL' } });
    const next = onChange.mock.calls[0][0];
    expect(next.kind).toBe('NOT_FINANCIAL');
    expect(next.method).toBeUndefined();
  });

  it('重複候補は、自動では除外されない旨とともに表示する', () => {
    setup(complete, ['製造部 / 工程B']);
    expect(screen.getByText('重複の可能性がある施策（自動では除外しません）')).toBeTruthy();
    expect(screen.getByText('製造部 / 工程B')).toBeTruthy();
  });

  it('利用者が操作できない状態では、入力も確認も無効になる', () => {
    render(<FinanceEffectSection effect={complete} disabled onChange={jest.fn()} overlapCandidates={[]} />);
    const confirm = screen.getByText('内容を確認し、確認済みにする') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });
});
