import { compareLegacyImpact } from './financeEffect';

const M = 1_000_000;

const confirmedRevenue = {
  kind: 'REVENUE_UP',
  method: 'DIRECT_AMOUNT',
  directAmountYen: 20 * M,
  amountBasis: 'ANNUAL',
  startYm: '2027-04',
  sourceNote: '架空の算定根拠',
  source: 'USER_INPUT',
  confirmed: true,
  confirmedAt: '2026-11-01T00:00:00.000Z',
} as const;

const notesOf = (view: ReturnType<typeof compareLegacyImpact>) => view.notes.join('\n');

describe('従来の成果見込みと財務効果の新旧値の表示', () => {
  it('旧金額1000万円と財務効果2000万円は、食い違いとして注記される', () => {
    const view = compareLegacyImpact(confirmedRevenue as any, { revenueMJPY: 10 });
    expect(view.rows).toEqual(
      expect.arrayContaining([
        { label: '従来の売上見込み（旧値・検証済みではありません）', value: '10百万円' },
        { label: '財務効果の年額売上', value: '20百万円（確認済み）' },
      ]),
    );
    expect(notesOf(view)).toContain('異なります');
    expect(notesOf(view)).toContain('旧値は自動では採用しません');
  });

  it('新旧が一致すれば、食い違いの注記は出ない', () => {
    const view = compareLegacyImpact(confirmedRevenue as any, { revenueMJPY: 20 });
    expect(notesOf(view)).not.toContain('異なります');
  });

  it('未確認の財務効果は、確認するまで統一試算に入らない旨を注記する', () => {
    const view = compareLegacyImpact({ ...confirmedRevenue, confirmed: false } as any, { revenueMJPY: 10 });
    expect(view.rows).toEqual(expect.arrayContaining([{ label: '財務効果の年額売上', value: '20百万円（未確認）' }]));
    expect(notesOf(view)).toContain('財務効果は未確認です');
  });

  it('財務効果が未入力で旧値だけがある施策は、移行まで統一試算に入らない旨を注記する', () => {
    const view = compareLegacyImpact(undefined, { revenueMJPY: 120 });
    expect(notesOf(view)).toContain('財務効果の算定根拠は未入力です');
    expect(view.rows.map((r) => r.label)).not.toContain('財務効果の年額売上');
  });

  it('財務換算しない施策に旧値がある場合は、その矛盾を注記する', () => {
    const view = compareLegacyImpact({ kind: 'NOT_FINANCIAL', source: 'USER_INPUT', confirmed: false } as any, { revenueMJPY: 10 });
    expect(notesOf(view)).toContain('財務換算しない施策ですが、従来の見込み額が入っています');
  });

  it('営業利益の旧値と財務効果の食い違いも注記する', () => {
    const cost = {
      kind: 'COST_REDUCTION',
      method: 'DIRECT_AMOUNT',
      directAmountYen: 5 * M,
      amountBasis: 'ANNUAL',
      startYm: '2027-04',
      sourceNote: '架空',
      source: 'USER_INPUT',
      confirmed: true,
      confirmedAt: '2026-11-01T00:00:00.000Z',
    } as any;
    const view = compareLegacyImpact(cost, { opIncomeMJPY: 3 });
    expect(notesOf(view)).toContain('従来の営業利益見込み（3百万円）と財務効果の営業利益への効果（5百万円）が異なります');
  });
});
