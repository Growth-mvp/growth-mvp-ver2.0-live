import { adoptableImpact } from './impactAdoption';

const DRAFT = { revenueMJPY: 12, opIncomeMJPY: 3, investmentMJPY: 5 };

describe('AI草案の効果額は、役割に対応する欄にだけ入る', () => {
  it('REVENUE は売上増分、COST は営業利益増分、FUTURE は必要投資の欄に対応する', () => {
    expect(adoptableImpact({ role: 'REVENUE', draftImpact: DRAFT, calculatedValue: null, current: {} })).toEqual({
      kind: 'adoptable', field: 'impactRevenueMJPY', value: 12,
    });
    expect(adoptableImpact({ role: 'COST', draftImpact: DRAFT, calculatedValue: null, current: {} })).toEqual({
      kind: 'adoptable', field: 'impactOpIncomeMJPY', value: 3,
    });
    expect(adoptableImpact({ role: 'FUTURE', draftImpact: DRAFT, calculatedValue: null, current: {} })).toEqual({
      kind: 'adoptable', field: 'impactInvestmentMJPY', value: 5,
    });
  });

  it('役割が無い、または未知の役割なら、何も採用しない', () => {
    expect(adoptableImpact({ role: undefined, draftImpact: DRAFT, calculatedValue: 9, current: {} }).kind).toBe('no_role_field');
    expect(adoptableImpact({ role: 'OTHER', draftImpact: DRAFT, calculatedValue: 9, current: {} }).kind).toBe('no_role_field');
  });

  it('既存の承認済みの値は変えない（上書きしない）', () => {
    const current = { impactRevenueMJPY: 40 };
    expect(adoptableImpact({ role: 'REVENUE', draftImpact: DRAFT, calculatedValue: 99, current })).toEqual({
      kind: 'already_set', field: 'impactRevenueMJPY', current: 40,
    });
  });

  it('計算値（前提から算出した値）を、草案の値より優先する', () => {
    expect(adoptableImpact({ role: 'REVENUE', draftImpact: DRAFT, calculatedValue: 7.5, current: {} })).toEqual({
      kind: 'adoptable', field: 'impactRevenueMJPY', value: 7.5,
    });
  });

  it('値が無い、または数値でない場合は採用しない', () => {
    expect(adoptableImpact({ role: 'REVENUE', draftImpact: { revenueMJPY: null }, calculatedValue: null, current: {} }).kind).toBe('no_value');
    expect(adoptableImpact({ role: 'COST', draftImpact: { opIncomeMJPY: 'abc' }, calculatedValue: null, current: {} }).kind).toBe('no_value');
    expect(adoptableImpact({ role: 'FUTURE', draftImpact: DRAFT, calculatedValue: Number.NaN, current: {} }).kind).toBe('no_value');
  });

  it('判定は採用の可否を返すだけで、書き込みはしない（書き込みは利用者の「反映」操作の中）', () => {
    const r = adoptableImpact({ role: 'REVENUE', draftImpact: DRAFT, calculatedValue: null, current: {} });
    expect(r.kind).toBe('adoptable');
  });
});
