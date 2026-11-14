import type { FinanceEffect } from '@/types/strategy';
import { isEditLocked, revisedEffectToSave, unconfirmedEffect } from './financeEffectRevision';

const M = 1_000_000;
const confirmedCost = (over: Partial<FinanceEffect> = {}): FinanceEffect => ({
  kind: 'COST_INCREASE',
  method: 'DIRECT_AMOUNT',
  directAmountYen: 6 * M,
  amountBasis: 'ANNUAL',
  startYm: '2027-04',
  endYm: '2028-03',
  source: 'USER_INPUT',
  confirmed: true,
  confirmedAt: '2026-11-10T00:00:00.000Z',
  sourceNote: '第5章の参考試算',
  ...over,
});

describe('旧 /okr の財務効果の修正', () => {
  it('確認済みの効果は、修正する前は編集できない。修正中は編集できる', () => {
    expect(isEditLocked(confirmedCost(), false)).toBe(true);
    expect(isEditLocked(confirmedCost(), true)).toBe(false);
    expect(isEditLocked({ ...confirmedCost(), confirmed: false }, false)).toBe(false);
    expect(isEditLocked(undefined, false)).toBe(false);
  });

  it('修正内容の内容が変わったら、確認は外れる（再確認が必要）', () => {
    const buffer = { ...confirmedCost(), directAmountYen: 10 * M, confirmed: true };
    const next = revisedEffectToSave(confirmedCost(), buffer);
    expect(next?.directAmountYen).toBe(10 * M);
    expect(next?.confirmed).toBe(false);
  });

  it('修正内容が同じで確認済みのままなら、確認は維持する', () => {
    const saved = confirmedCost();
    const next = revisedEffectToSave(saved, { ...saved });
    expect(next?.confirmed).toBe(true);
  });

  it('確認の解除は、内容を変えずに未確認にする', () => {
    const next = unconfirmedEffect(confirmedCost());
    expect(next?.confirmed).toBe(false);
    expect(next?.confirmedAt).toBeUndefined();
    expect(next?.directAmountYen).toBe(6 * M);
    expect(unconfirmedEffect(undefined)).toBeUndefined();
  });
});
