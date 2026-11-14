import type { DebtForm } from './DebtPanel';
import { MILLION, toDebtDomain } from './financePlanForm';

const form = {
  existing: [
    {
      id: 'e1',
      name: '既存借入A',
      category: 'BANK',
      balance: '100',
      rate: '1',
      schedule: { 2027: '10', 2028: '10', 2029: '10', 2030: '10' },
    },
  ],
  newLoans: [],
  dividends: { 2030: '5' },
  seq: 2,
} as unknown as DebtForm;

describe('借入・配当の入力は、予測期間を縮めても消えない', () => {
  it('予測期間が3年（2027〜2029）に戻っても、2030年度の返済・配当の入力は保存データに残る', () => {
    const domain = toDebtDomain(form, [2027, 2028, 2029]);
    expect(domain.existingLoans[0].scheduledPrincipalYen[2030]).toBe(10 * MILLION);
    expect(domain.dividendsYen[2030]).toBe(5 * MILLION);
    expect(domain.existingLoans[0].scheduledPrincipalYen[2029]).toBe(10 * MILLION);
  });

  it('予測期間を延ばしたとき、新しい年度は空欄（null）として加わり、既存の入力は変わらない', () => {
    const domain = toDebtDomain({ ...form, dividends: {} } as DebtForm, [2027, 2028, 2029, 2030]);
    expect(domain.existingLoans[0].scheduledPrincipalYen[2027]).toBe(10 * MILLION);
    expect(domain.existingLoans[0].scheduledPrincipalYen[2030]).toBe(10 * MILLION);
    expect(domain.dividendsYen[2027]).toBeNull();
  });
});
