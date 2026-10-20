import { cashFlowFormFrom, debtFormFrom, toCashFlowAssumptions, toDebtDomain } from './financePlanForm';
import type { CashFlowForm } from './CashFlowSection';
import type { DebtForm } from './DebtPanel';

const cashForm: CashFlowForm = {
  minCash: '200',
  taxRate: '30',
  depreciation: '',
  ar: '15',
  inventory: '',
  ap: '0',
  targetRevenue: '1200',
  targetOperatingIncome: '',
  targetYear: '2027',
};

describe('画面入力と保存値の相互変換', () => {
  it('CF前提：百万円・%の入力を円・比率に変換し、元の入力に戻せる', () => {
    const a = toCashFlowAssumptions(cashForm);
    expect(a.minCashYen).toBe(200_000_000);
    expect(a.taxRate).toBeCloseTo(0.3, 9);
    expect(a.apRatio).toBe(0);
    expect(a.depreciationYen).toBeNull();
    expect(cashFlowFormFrom(a)).toEqual(cashForm);
  });

  it('借入：既存借入・新規借入・年度別返済・配当を往復させても同じ入力に戻る', () => {
    const form: DebtForm = {
      existing: [
        {
          id: 'e1',
          name: '既存A',
          category: 'BANK',
          balance: '100',
          rate: '5',
          schedule: { 2026: '10', 2027: '', 2028: '0' },
        },
      ],
      newLoans: [
        {
          id: 'n1',
          name: '新規B',
          drawYear: '2026',
          drawMonth: '',
          amount: '200',
          rate: '2',
          term: '3',
          grace: '1',
          method: 'EQUAL_PRINCIPAL',
        },
      ],
      dividends: { 2026: '0', 2027: '', 2028: '5' },
      seq: 2,
    };
    const domain = toDebtDomain(form, [2026, 2027, 2028]);
    expect(domain.existingLoans[0].scheduledPrincipalYen).toEqual({ 2026: 10_000_000, 2027: null, 2028: 0 });
    expect(domain.newLoans[0].drawMonth).toBeNull();
    expect(domain.dividendsYen).toEqual({ 2026: 0, 2027: null, 2028: 5_000_000 });
    const back = debtFormFrom(domain);
    expect(back.existing[0].schedule).toEqual({ 2026: '10', 2027: '', 2028: '0' });
    expect(back.newLoans[0].drawMonth).toBe('');
    expect(back.dividends).toEqual({ 2026: '0', 2027: '', 2028: '5' });
  });

  it('復元後に追加する行のIDは既存のIDと衝突しない', () => {
    const domain = toDebtDomain(
      {
        existing: [{ id: 'e2', name: 'a', category: 'BANK', balance: '', rate: '', schedule: {} }],
        newLoans: [{ id: 'n5', name: 'b', drawYear: '', drawMonth: '', amount: '', rate: '', term: '', grace: '', method: 'BULLET' }],
        dividends: {},
        seq: 0,
      },
      [],
    );
    const back = debtFormFrom(domain);
    expect(back.seq).toBeGreaterThanOrEqual(6);
  });
});
