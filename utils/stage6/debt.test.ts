import { readFileSync } from 'fs';
import path from 'path';
import { buildCashFlowPlan, type CashFlowInput, type CfAssumptions } from './cashflow';
import {
  buildDebtSchedule,
  type DebtInput,
  type ExistingLoanInput,
  type NewLoanInput,
} from './debt';

const FY = [2026, 2027, 2028, 2029];

function debtInput(overrides: Partial<DebtInput> = {}): DebtInput {
  return {
    forecastYears: FY,
    existingLoans: [],
    newLoans: [],
    stage1InterestBearingDebtYen: null,
    dividendsYen: { 2026: 0, 2027: 0, 2028: 0, 2029: 0 },
    fiscalYearEndSet: true,
    ...overrides,
  };
}

function loan(overrides: Partial<NewLoanInput> = {}): NewLoanInput {
  return {
    id: 'n1',
    name: '新規',
    drawYear: 2026,
    drawMonth: 1,
    amountYen: 300_000_000,
    annualRate: 0.02,
    termYears: 3,
    graceYears: 0,
    method: 'EQUAL_PRINCIPAL',
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingLoanInput> = {}): ExistingLoanInput {
  return {
    id: 'e1',
    name: '既存A',
    category: 'BANK',
    balanceYen: 100_000_000,
    annualRate: 0.05,
    scheduledPrincipalYen: { 2026: 10_000_000, 2027: 10_000_000, 2028: 10_000_000, 2029: 10_000_000 },
    ...overrides,
  };
}

function yr(schedule: ReturnType<typeof buildDebtSchedule>, year: number) {
  const found = schedule.years.find((y) => y.year === year);
  if (!found) throw new Error(`no year ${year}`);
  return found;
}

describe('既存借入残高の取込と照合', () => {
  it('内訳の合計がSTAGE1の有利子負債合計と一致すれば照合OKとする', () => {
    const s = buildDebtSchedule(
      debtInput({ existingLoans: [existing(), existing({ id: 'e2', name: '既存B', balanceYen: 50_000_000 })], stage1InterestBearingDebtYen: 150_000_000 }),
    );
    expect(s.reconciliation.status).toBe('MATCH');
    expect(s.reconciliation.statedTotalYen).toBe(150_000_000);
  });

  it('内訳と合計が違う場合は差額を表示し、自動補正しない', () => {
    const s = buildDebtSchedule(debtInput({ existingLoans: [existing()], stage1InterestBearingDebtYen: 120_000_000 }));
    expect(s.reconciliation.status).toBe('DIFFERENT');
    expect(s.reconciliation.differenceYen).toBe(-20_000_000);
    expect(s.globalHolds.some((h) => h.includes('差額'))).toBe(true);
    expect(yr(s, 2026).openingBalance.value).toBe(100_000_000 + 0);
  });

  it('内訳が未入力なら照合せず、既存借入の返済・利息を推定しない', () => {
    const s = buildDebtSchedule(debtInput({ stage1InterestBearingDebtYen: 100_000_000 }));
    expect(s.reconciliation.status).toBe('NOT_ENTERED');
    expect(s.existingLoansEntered).toBe(false);
    expect(yr(s, 2026).existingPrincipal.value).toBeNull();
    expect(yr(s, 2026).existingInterest.value).toBeNull();
    expect(yr(s, 2026).holds.some((h) => h.includes('内訳が未入力'))).toBe(true);
  });

  it('有利子負債はリース等を含みうる旨を未確認事項に残す', () => {
    const s = buildDebtSchedule(debtInput({ existingLoans: [existing()], stage1InterestBearingDebtYen: 100_000_000 }));
    expect(s.globalHolds.some((h) => h.includes('リース'))).toBe(true);
  });
});

describe('新規借入の返済方式', () => {
  it('元金均等返済：返済期間で均等に元本を返し、利息は年初残高に対して計算する', () => {
    const s = buildDebtSchedule(debtInput({ newLoans: [loan()] }));
    expect(yr(s, 2026).draw.value).toBe(300_000_000);
    expect(yr(s, 2026).newPrincipal.value).toBe(0);
    expect(yr(s, 2026).newInterest.value).toBeCloseTo(6_000_000, 0);
    expect(yr(s, 2027).newPrincipal.value).toBeCloseTo(100_000_000, 0);
    expect(yr(s, 2027).newInterest.value).toBeCloseTo(6_000_000, 0);
    expect(yr(s, 2028).newPrincipal.value).toBeCloseTo(100_000_000, 0);
    expect(yr(s, 2028).newInterest.value).toBeCloseTo(4_000_000, 0);
    expect(yr(s, 2029).newPrincipal.value).toBeCloseTo(100_000_000, 0);
    expect(yr(s, 2029).newClosingBalance.value).toBeCloseTo(0, 0);
  });

  it('期日一括返済：返済期間の最終年度に全額を返し、それまでは利息のみ', () => {
    const s = buildDebtSchedule(debtInput({ newLoans: [loan({ method: 'BULLET' })] }));
    expect(yr(s, 2027).newPrincipal.value).toBe(0);
    expect(yr(s, 2027).newInterest.value).toBeCloseTo(6_000_000, 0);
    expect(yr(s, 2028).newPrincipal.value).toBe(0);
    expect(yr(s, 2029).newPrincipal.value).toBeCloseTo(300_000_000, 0);
    expect(yr(s, 2029).newClosingBalance.value).toBeCloseTo(0, 0);
  });

  it('据置期間の間は元本を返さず、据置後に元金均等で返す', () => {
    const s = buildDebtSchedule(
      debtInput({ forecastYears: [2026, 2027, 2028, 2029, 2030], newLoans: [loan({ termYears: 4, graceYears: 1 })] }),
    );
    expect(yr(s, 2027).newPrincipal.value).toBe(0);
    expect(yr(s, 2027).newInterest.value).toBeCloseTo(6_000_000, 0);
    expect(yr(s, 2028).newPrincipal.value).toBeCloseTo(100_000_000, 0);
    expect(yr(s, 2030).newPrincipal.value).toBeCloseTo(100_000_000, 0);
    expect(yr(s, 2030).newClosingBalance.value).toBeCloseTo(0, 0);
  });

  it('据置期間が返済期間以上なら不正として保留にする', () => {
    const s = buildDebtSchedule(debtInput({ newLoans: [loan({ termYears: 2, graceYears: 2 })] }));
    expect(yr(s, 2027).newPrincipal.value).toBeNull();
    expect(yr(s, 2027).holds.some((h) => h.includes('据置期間'))).toBe(true);
  });
});

describe('借入実行時期と利息', () => {
  it('実行月から年末までの利息を按分する', () => {
    const s = buildDebtSchedule(debtInput({ newLoans: [loan({ drawMonth: 7 })] }));
    expect(yr(s, 2026).newInterest.value).toBeCloseTo(300_000_000 * 0.02 * 6 / 12, 0);
  });

  it('実行月が未入力なら1月実行と仮定し、その旨を前提に表示する', () => {
    const s = buildDebtSchedule(debtInput({ newLoans: [loan({ drawMonth: null })] }));
    expect(yr(s, 2026).newInterest.value).toBeCloseTo(6_000_000, 0);
    expect(s.assumptions.some((a) => a.includes('1月実行'))).toBe(true);
  });
});

describe('年度別の残高推移と非負', () => {
  it('期首残高は前年度末残高と一致し、残高はマイナスにならない', () => {
    const s = buildDebtSchedule(debtInput({ newLoans: [loan()], existingLoans: [existing()], stage1InterestBearingDebtYen: 100_000_000 }));
    for (let i = 1; i < s.years.length; i++) {
      const prev = s.years[i - 1];
      const cur = s.years[i];
      expect(cur.openingBalance.value).toBeCloseTo(prev.closingBalance.value as number, 0);
      expect((cur.closingBalance.value as number) >= -1e-6).toBe(true);
    }
  });

  it('既存借入の元本返済予定が残高を超える場合は保留にし、負の残高を作らない', () => {
    const s = buildDebtSchedule(
      debtInput({
        existingLoans: [existing({ balanceYen: 5_000_000, scheduledPrincipalYen: { 2026: 10_000_000, 2027: 0, 2028: 0, 2029: 0 } })],
        stage1InterestBearingDebtYen: 5_000_000,
      }),
    );
    expect(yr(s, 2026).principal.value).toBeNull();
    expect(yr(s, 2026).holds.some((h) => h.includes('残高を超えて'))).toBe(true);
    expect(yr(s, 2026).closingBalance.value).toBeNull();
  });

  it('既存借入の返済予定が未入力の年度は0とみなさず保留にする', () => {
    const s = buildDebtSchedule(
      debtInput({ existingLoans: [existing({ scheduledPrincipalYen: { 2026: 10_000_000 } })], stage1InterestBearingDebtYen: 100_000_000 }),
    );
    expect(yr(s, 2026).existingPrincipal.value).toBe(10_000_000);
    expect(yr(s, 2027).existingPrincipal.value).toBeNull();
  });

  it('金利が未入力の既存借入は利息を推定しない', () => {
    const s = buildDebtSchedule(debtInput({ existingLoans: [existing({ annualRate: null })], stage1InterestBearingDebtYen: 100_000_000 }));
    expect(yr(s, 2026).existingInterest.value).toBeNull();
    expect(yr(s, 2026).holds.some((h) => h.includes('金利が未入力'))).toBe(true);
  });
});

describe('元本返済額・利払額の年度別集計', () => {
  it('既存と新規の元本・利息を合算し、内訳も保持する', () => {
    const s = buildDebtSchedule(
      debtInput({ existingLoans: [existing()], newLoans: [loan()], stage1InterestBearingDebtYen: 100_000_000 }),
    );
    const y = yr(s, 2026);
    expect(y.existingInterest.value).toBeCloseTo(5_000_000, 0);
    expect(y.newInterest.value).toBeCloseTo(6_000_000, 0);
    expect(y.interest.value).toBeCloseTo(11_000_000, 0);
    expect(y.principal.value).toBeCloseTo(10_000_000, 0);
    expect(y.debtService.value).toBeCloseTo(21_000_000, 0);
  });
});

describe('未入力とゼロの区別（配当・借入）', () => {
  it('配当が未入力なら0とせず保留にし、0と入力すれば0として扱う', () => {
    const missing = buildDebtSchedule(debtInput({ dividendsYen: {} }));
    expect(yr(missing, 2026).dividends.value).toBeNull();
    const zero = buildDebtSchedule(debtInput({ dividendsYen: { 2026: 0 } }));
    expect(yr(zero, 2026).dividends.value).toBe(0);
    expect(yr(zero, 2026).dividends.basis).toBe('USER');
  });

  it('新規借入が無ければ借入は0として計算し、その旨を明示する', () => {
    const s = buildDebtSchedule(debtInput());
    expect(yr(s, 2026).draw.value).toBe(0);
    expect(yr(s, 2026).draw.note).toContain('入力なし');
  });

  it('金額・金利が未入力の新規借入は保留にする', () => {
    const s = buildDebtSchedule(debtInput({ newLoans: [loan({ amountYen: null })] }));
    expect(yr(s, 2026).draw.value).toBeNull();
    expect(yr(s, 2026).holds.some((h) => h.includes('借入金額'))).toBe(true);
  });
});

describe('CFへの反映・利息の二重控除防止・財務CF・期末現預金', () => {
  const pl = [
    { year: 2024, revenue: 900_000_000, operatingIncome: 80_000_000, interest: 4_000_000, tax: 20_000_000, netIncome: 56_000_000, depreciation: 18_000_000 },
    { year: 2025, revenue: 1_000_000_000, operatingIncome: 100_000_000, interest: 5_000_000, tax: 28_500_000, netIncome: 66_500_000, depreciation: 20_000_000 },
  ];
  const bs = [
    { year: 2024, cash: 250_000_000, ar: 135_000_000, inventory: 72_000_000, ap: 81_000_000 },
    { year: 2025, cash: 300_000_000, ar: 150_000_000, inventory: 80_000_000, ap: 90_000_000 },
  ];
  const assumptions: CfAssumptions = {
    minCashYen: 200_000_000,
    taxRate: 0.3,
    depreciationYen: null,
    arRatio: null,
    inventoryRatio: null,
    apRatio: null,
    targetRevenueYen: null,
    targetOperatingIncomeYen: null,
    targetYear: null,
  };
  const investment = { yearlyByCategory: [], unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 };
  const base: CashFlowInput = { financePL: pl, financeBS: bs, investment, assumptions, horizonYears: 3 };

  const debt = buildDebtSchedule({
    forecastYears: [2026, 2027, 2028],
    existingLoans: [existing({ scheduledPrincipalYen: { 2026: 10_000_000, 2027: 10_000_000, 2028: 10_000_000 } })],
    newLoans: [loan({ amountYen: 200_000_000, termYears: 3, graceYears: 1 })],
    stage1InterestBearingDebtYen: 100_000_000,
    dividendsYen: { 2026: 0, 2027: 0, 2028: 0 },
    fiscalYearEndSet: true,
  });

  const withDebt = buildCashFlowPlan({ ...base, debt }, 2026);
  const noDebt = buildCashFlowPlan(base, 2026);
  const y26 = withDebt.years.find((y) => y.year === 2026)!;
  const y27 = withDebt.years.find((y) => y.year === 2027)!;

  it('支払利息は借入計画の利息に置き換わり、営業CFに一度だけ反映される', () => {
    // 利息＝既存5百万円＋新規4百万円（200百万円×2%）＝9百万円
    expect(y26.interest.value).toBeCloseTo(9_000_000, 0);
    // 税引後利益＝（1億円−900万円）×0.7＝6,370万円。営業CF＝6,370万＋減価償却2,000万＝8,370万
    expect(y26.operatingCf.value).toBeCloseTo(83_700_000, 0);
    // 比較：借入なしのPhase 2では利息500万円のまま
    expect(noDebt.years.find((y) => y.year === 2026)!.netIncome.value).toBeCloseTo(66_500_000, 0);
  });

  it('財務CFは新規借入−元本返済−配当で、利息を二重に控除しない', () => {
    // 財務CF＝新規借入2億円−元本1,000万円−配当0＝1億9,000万円
    expect(y26.financingCf.value).toBeCloseTo(190_000_000, 0);
    expect(y26.principal.value).toBeCloseTo(10_000_000, 0);
    expect(y26.draws.value).toBe(200_000_000);
  });

  it('期末現預金（借入反映後）＝期首＋営業CF＋投資CF＋財務CF で繰り越す', () => {
    expect(y26.closingCashAfterFinancing.value).toBeCloseTo(300_000_000 + 83_700_000 + 190_000_000, 0);
    expect(y27.openingCash.value).toBeCloseTo(y26.closingCashAfterFinancing.value as number, 0);
  });

  it('借入反映前の期末現預金は既存借入の返済を含み、財務CFの影響（新規借入）を含まない', () => {
    expect(y26.closingCashBeforeFinancing.value).toBeCloseTo(300_000_000 + 83_700_000, 0);
  });

  it('最低必要現預金との差額（返済後）を表示する', () => {
    expect(y26.postShortfall.value).toBe(0);
    const tight = buildCashFlowPlan({ ...base, debt, assumptions: { ...assumptions, minCashYen: 900_000_000 } }, 2026);
    expect(tight.years.find((y) => y.year === 2026)!.postShortfall.value).toBeCloseTo(900_000_000 - 573_700_000, 0);
  });

  it('DSCR＝（営業CF＋支払利息）÷（元本返済＋支払利息）', () => {
    expect(y26.dscr.value).toBeCloseTo((83_700_000 + 9_000_000) / (10_000_000 + 9_000_000), 6);
  });

  it('借入計画がない場合、財務CFと返済可能性は保留（0とみなさない）', () => {
    expect(noDebt.years.find((y) => y.year === 2026)!.financingCf.value).toBeNull();
    expect(noDebt.years.find((y) => y.year === 2026)!.verdict).toBe('評価保留');
  });

  it('借入の期末現預金が増えても、それだけで返済可能とは判定しない', () => {
    const huge = buildDebtSchedule({
      forecastYears: [2026, 2027, 2028],
      existingLoans: [existing({ balanceYen: 0, annualRate: 0, scheduledPrincipalYen: { 2026: 0, 2027: 0, 2028: 0 } })],
      newLoans: [loan({ amountYen: 1_000_000_000, annualRate: 0, termYears: 5, graceYears: 4 })],
      stage1InterestBearingDebtYen: 0,
      dividendsYen: { 2026: 0, 2027: 0, 2028: 0 },
      fiscalYearEndSet: true,
    });
    const plan = buildCashFlowPlan({ ...base, debt: huge }, 2026);
    const y = plan.years.find((v) => v.year === 2026)!;
    expect(y.closingCashAfterFinancing.value!).toBeGreaterThan(y.closingCashBeforeFinancing.value!);
    expect(y.verdict).not.toContain('計算上は資金不足・DSCR不足なし');
  });

  it('決算期が未確認なら返済可能性の判定を保留にする', () => {
    const plan = buildCashFlowPlan({ ...base, debt, fiscalYearEndSet: false }, 2026);
    expect(plan.years.find((y) => y.year === 2026)!.verdict).toBe('評価保留（決算期未設定）');
  });

  it('返済額が営業CFに比べて大きい場合はDSCR 1倍未満と判定する', () => {
    const heavy = buildDebtSchedule({
      forecastYears: [2026, 2027, 2028],
      existingLoans: [existing({ balanceYen: 100_000_000, scheduledPrincipalYen: { 2026: 90_000_000, 2027: 0, 2028: 0 } })],
      newLoans: [],
      stage1InterestBearingDebtYen: 100_000_000,
      dividendsYen: { 2026: 0, 2027: 0, 2028: 0 },
      fiscalYearEndSet: true,
    });
    const plan = buildCashFlowPlan({ ...base, debt: heavy }, 2026);
    const y = plan.years.find((v) => v.year === 2026)!;
    expect(y.dscr.value!).toBeLessThan(1);
    expect(y.verdict).toContain('DSCR 1倍未満');
  });

  it('単位不一致や基準年度の不一致は借入計画の結果にも保留として伝播する', () => {
    const mismatch = buildCashFlowPlan({ ...base, financeBS: [bs[0]], debt }, 2026);
    expect(mismatch.yearMismatch).toBe(true);
    expect(mismatch.years.find((y) => y.year === 2026)!.operatingCf.value).toBeNull();
    expect(mismatch.years.find((y) => y.year === 2026)!.verdict).toBe('評価保留');
  });

  it('既存借入の内訳がない借入計画では利息を据置にせず保留にする', () => {
    const newOnly = buildDebtSchedule({
      forecastYears: [2026, 2027, 2028],
      existingLoans: [],
      newLoans: [loan()],
      stage1InterestBearingDebtYen: 100_000_000,
      dividendsYen: { 2026: 0, 2027: 0, 2028: 0 },
      fiscalYearEndSet: true,
    });
    const plan = buildCashFlowPlan({ ...base, debt: newOnly }, 2026);
    expect(plan.years.find((y) => y.year === 2026)!.interest.value).toBeNull();
    expect(plan.years.find((y) => y.year === 2026)!.operatingCf.value).toBeNull();
  });
});

describe('既存STAGE6計算への非干渉', () => {
  it('借入計算は既存のSTAGE6計算・ストア・保存処理を読み込まない', () => {
    for (const file of ['debt.ts', 'cashflow.ts']) {
      const source = readFileSync(path.join(__dirname, file), 'utf8');
      const imports = source.split('\n').filter((l) => l.startsWith('import'));
      for (const line of imports) {
        expect(line).not.toMatch(/compute|baseline|useStage6Data|simulationBridge|financeSimulation|strategyStore|supabase/);
      }
    }
  });
});
