/* 確定フラグ（confirmed）の判定の回帰テスト。
 * 以前は computeFinanceEffect が真偽値の真偽判定（truthy）で確定にしていたため、文字列 "false" や数値 1 が
 * 試算（utils/stage6/financeEffectPlan.ts）で確定扱いになり、画面（normalizeFinanceEffect は === true）と食い違っていた。
 * 判定を === true にそろえ、確定は真偽値の true だけとする。 */
import { computeFinanceEffect, normalizeFinanceEffect } from '@/lib/financeEffect';
import type { FinanceEffect } from '@/types/strategy';

const base = {
  kind: 'REVENUE_UP',
  method: 'DIRECT_AMOUNT',
  directAmountYen: 1000000,
  amountBasis: 'TOTAL',
  startYm: '2027-02',
  sourceNote: '回帰テスト',
  source: 'USER_INPUT',
} as const;

const withConfirmed = (v: unknown) => ({ ...base, confirmed: v }) as unknown as FinanceEffect;

describe('confirmed 判定（真偽値の true だけが確定）', () => {
  it('真偽値の true は、両方の判定で確定になる', () => {
    expect(computeFinanceEffect(withConfirmed(true)).status).toBe('CONFIRMED');
    expect(normalizeFinanceEffect(withConfirmed(true))?.confirmed).toBe(true);
  });

  it('真偽値の false は、両方の判定で未確定になる', () => {
    expect(computeFinanceEffect(withConfirmed(false)).status).toBe('DRAFT');
    expect(normalizeFinanceEffect(withConfirmed(false))?.confirmed).toBe(false);
  });

  it('文字列 "false" は未確定になり、正規化の結果と一致する', () => {
    expect(computeFinanceEffect(withConfirmed('false')).status).toBe('DRAFT');
    expect(normalizeFinanceEffect(withConfirmed('false'))?.confirmed).toBe(false);
  });

  it('文字列 "true" も確定にならない（確定は真偽値の true だけ）', () => {
    expect(computeFinanceEffect(withConfirmed('true')).status).toBe('DRAFT');
    expect(normalizeFinanceEffect(withConfirmed('true'))?.confirmed).toBe(false);
  });

  it('数値の 1 も未確定になり、正規化の結果と一致する', () => {
    expect(computeFinanceEffect(withConfirmed(1)).status).toBe('DRAFT');
    expect(normalizeFinanceEffect(withConfirmed(1))?.confirmed).toBe(false);
  });

  it('確定フラグの有無で、金額の計算は変わらない（判定だけの変更）', () => {
    const confirmed = computeFinanceEffect(withConfirmed(true));
    const draft = computeFinanceEffect(withConfirmed('false'));
    expect(draft.totalYen).toBe(confirmed.totalYen);
    expect(draft.totalYen).toBe(1000000);
  });
});
