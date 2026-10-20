import { stage6SourceInputsFromRow } from './bankFinancialPlanSource';

const financeBS = [{ year: 2025, cash: 100_000_000, interestBearingDebt: 300_000_000 }];

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    company_id: '11111111-1111-4111-8111-111111111111',
    departments: [],
    finance_pl: [{ year: 2025, revenue: 1_000_000_000 }],
    company_targets: [{ id: 't1', label: '売上高', unit: '百万円', base: 1500, dueYear: 2028 }],
    csv_finance_data: { financeBS },
    ...overrides,
  };
}

describe('bankFinancialPlanSource', () => {
  it('csv_finance_data の多重ネストを剥がして financeBS を読む', () => {
    const nested = { '0': { '0': { financeBS } } };
    const out = stage6SourceInputsFromRow(row({ csv_finance_data: nested }));
    expect(out.financeBS).toHaveLength(1);
    expect(out.financeBS[0].year).toBe(2025);
  });

  it('財務前提は csv_finance_data の直下にあるものだけを読む（ブラウザの読み取りと同じ）', () => {
    const stored = { formatVersion: 1 };
    const direct = stage6SourceInputsFromRow(row({ csv_finance_data: { financeBS, financePlanAssumptions: stored } }));
    expect(direct.storedFinancePlan).toBe(stored);

    const nested = stage6SourceInputsFromRow(row({ csv_finance_data: { '0': { financePlanAssumptions: stored } } }));
    expect(nested.storedFinancePlan).toBeUndefined();
  });

  it('決算月は strategy_data.fiscal_year_end 列から読む（csv内の同名キーは使わない）', () => {
    const out = stage6SourceInputsFromRow(row({ fiscal_year_end: '3', csv_finance_data: { fiscalYearEnd: '12', financeBS } }));
    expect(out.fiscalYearEnd).toBe('3');
  });

  it('決算月が未設定・不正な値の場合は未設定（undefined）として扱い、既定値を補わない', () => {
    expect(stage6SourceInputsFromRow(row({ fiscal_year_end: null })).fiscalYearEnd).toBeUndefined();
    expect(stage6SourceInputsFromRow(row({ fiscal_year_end: '0' })).fiscalYearEnd).toBeUndefined();
    expect(stage6SourceInputsFromRow(row({ fiscal_year_end: '13' })).fiscalYearEnd).toBeUndefined();
    expect(stage6SourceInputsFromRow(row()).fiscalYearEnd).toBeUndefined();
  });

  it('投資計算に使う skillPlans の spend を正規化後も保持する', () => {
    const departments = [
      {
        name: '営業部',
        projects: [
          {
            title: 'A社開拓',
            skillPlans: [
              {
                id: 'sk1',
                skillName: '提案力',
                cost: 30_000_000,
                spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2027-03' },
              },
            ],
          },
        ],
      },
    ];
    const out = stage6SourceInputsFromRow(row({ departments }));
    const sk = (out.departments[0].projects![0] as unknown as { skillPlans: { spend: unknown }[] }).skillPlans[0];
    expect(sk.spend).toMatchObject({ category: 'CAPEX', paymentYm: '2027-03' });
  });

  it('STAGE2の目標は未加工のまま渡し、欠損は空配列にする', () => {
    expect(stage6SourceInputsFromRow(row()).companyTargets).toHaveLength(1);
    expect(stage6SourceInputsFromRow(row({ company_targets: null })).companyTargets).toEqual([]);
  });

  it('部門が配列でなくても例外にせず空として扱う', () => {
    const out = stage6SourceInputsFromRow(row({ departments: 'broken' }));
    expect(out.departments).toEqual([]);
  });
});
