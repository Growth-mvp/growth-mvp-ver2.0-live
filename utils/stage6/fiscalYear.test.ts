import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { normalizeStrategyData } from '@/utils/supabase/normalize';
import type { CfAssumptions } from './cashflow';
import { buildBankFinancialPlanBlock, type BankFinancialPlanBlock } from './bankFinancialPlan';
import type { Stage6SourceInputs } from './bankFinancialPlanSource';
import { computeStage6FinancePlan } from './financePlanPipeline';
import {
  FINANCE_PLAN_CALC_VERSION,
  buildStoredFinancePlan,
  sourceHashOf,
  type CalcSnapshotMeta,
  type FinancePlanDomain,
} from './financePlanSnapshot';
import { buildInvestmentDemandSummary, fiscalYearOf } from './investmentDemand';
import { normalizeFiscalYearEnd } from './fiscalYear';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const STRATEGY = '33333333-3333-4333-8333-333333333333';
const NOW_YEAR = 2026;
const SAVED_AT = '2026-10-19T00:00:00.000Z';

const financePL: FinancePLRow[] = [
  { year: 2025, revenue: 1_000_000_000, operatingIncome: 50_000_000, netIncome: 30_000_000, depreciation: 20_000_000, interest: 5_000_000, tax: 10_000_000 },
];
const financeBS: FinanceBSRow[] = [
  { year: 2025, cash: 100_000_000, ar: 150_000_000, inventory: 80_000_000, ap: 60_000_000, interestBearingDebt: 300_000_000 },
];
const assumptions: CfAssumptions = {
  minCashYen: 80_000_000,
  taxRate: 0.3,
  depreciationYen: null,
  arRatio: null,
  inventoryRatio: null,
  apRatio: null,
  targetRevenueYen: null,
  targetOperatingIncomeYen: null,
  targetYear: null,
};
const domain: FinancePlanDomain = { assumptions, existingLoans: [], newLoans: [], dividendsYen: {} };

function oneTimeCapex(ym: string, cost = 10_000_000): Department[] {
  return [
    {
      name: '営業部',
      projects: [
        {
          title: '設備投資',
          planStatus: 'approved',
          skillPlans: [
            { id: 's1', skillName: '設備', cost, spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: ym } },
          ],
        },
      ],
    },
  ] as unknown as Department[];
}

function inputsFor(fiscalYearEnd: string | undefined, departments: Department[]): Stage6SourceInputs {
  return { financePL, financeBS, departments, fiscalYearEnd, companyTargets: [], storedFinancePlan: undefined };
}

function savedFrom(inputs: Stage6SourceInputs) {
  const c = computeStage6FinancePlan({
    financePL,
    financeBS,
    departments: inputs.departments,
    fiscalYearEnd: inputs.fiscalYearEnd,
    domain,
    currentYear: NOW_YEAR,
  });
  const meta: CalcSnapshotMeta = {
    calcVersion: FINANCE_PLAN_CALC_VERSION,
    companyId: COMPANY,
    baseYear: c.basePlan.baseYear,
    bsBaseYear: c.basePlan.bsBaseYear,
    assumptionsHash: c.assumptionsHash,
    sourceHash: c.sourceHash,
    unconfirmed: {
      unapprovedReadyYen: c.investment.unapprovedReadyYen,
      unclassifiedYen: c.investment.unclassifiedYen,
      unscheduledYen: c.investment.unscheduledYen,
      candidateYen: c.investment.candidateYen,
      basisPendingYen: c.investment.basisPendingYen,
    },
    computedAt: SAVED_AT,
  };
  return JSON.parse(JSON.stringify(buildStoredFinancePlan({ domain, companyId: COMPANY, meta, savedAt: SAVED_AT }))) as unknown;
}

function blockFor(inputs: Stage6SourceInputs, saved: unknown = savedFrom(inputs)): BankFinancialPlanBlock {
  return buildBankFinancialPlanBlock({
    companyId: COMPANY,
    strategyId: STRATEGY,
    storedFinancePlan: saved,
    inputs: { ...inputs, storedFinancePlan: saved },
    currentYear: NOW_YEAR,
    computedAt: SAVED_AT,
  });
}

function fiscalYearOfSpend(ym: string, fiscalYearEnd: string): number | undefined {
  return buildInvestmentDemandSummary(oneTimeCapex(ym), fiscalYearEnd).yearly[0]?.fiscalYear;
}

describe('決算月の正規化', () => {
  it.each<[unknown, string]>([
    ['3', '3'],
    [3, '3'],
    [' 12 ', '12'],
    ['03', '3'],
    ['1', '1'],
    ['12', '12'],
    ['0', ''],
    ['13', ''],
    ['3.5', ''],
    ['3月', ''],
    ['', ''],
    [0, ''],
    [13, ''],
    [null, ''],
    [undefined, ''],
  ])('入力 %p は %p として扱う（不正・未設定は既定値を補わない）', (input, expected) => {
    expect(normalizeFiscalYearEnd(input)).toBe(expected);
  });
});

describe('月次支出の会計年度への集計（年度境界）', () => {
  it.each<[string, string, number]>([
    ['2026-03', '3', 2026],
    ['2026-04', '3', 2027],
    ['2026-12', '3', 2027],
    ['2027-01', '3', 2027],
    ['2026-01', '12', 2026],
    ['2026-12', '12', 2026],
    ['2027-01', '12', 2027],
    ['2026-02', '2', 2026],
    ['2026-03', '2', 2027],
    ['2027-02', '2', 2027],
    ['2027-03', '2', 2028],
  ])('支出月 %s を %s月決算で集計すると FY%i', (ym, fye, expected) => {
    expect(fiscalYearOfSpend(ym, fye)).toBe(expected);
    expect(fiscalYearOf(ym, Number(fye))).toBe(expected);
  });

  it('月額の期間支出は決算月の境界をまたいで年度ごとに按分される（3月決算）', () => {
    const depts = [
      {
        name: '営業部',
        projects: [
          {
            title: '運用費',
            planStatus: 'approved',
            skillPlans: [
              {
                id: 's2',
                skillName: '保守',
                cost: 1_000_000,
                spend: { category: 'OPEX', recurrence: 'RECURRING', amountBasis: 'MONTHLY', startYm: '2026-02', endYm: '2026-05' },
              },
            ],
          },
        ],
      },
    ] as unknown as Department[];
    const s = buildInvestmentDemandSummary(depts, '3');
    expect(s.yearly).toEqual([
      expect.objectContaining({ fiscalYear: 2026, amountYen: 2_000_000 }),
      expect.objectContaining({ fiscalYear: 2027, amountYen: 2_000_000 }),
    ]);
  });

  it('同じ期間支出を12月決算で集計すると1年度にまとまる', () => {
    const depts = [
      {
        name: '営業部',
        projects: [
          {
            title: '運用費',
            planStatus: 'approved',
            skillPlans: [
              {
                id: 's2',
                skillName: '保守',
                cost: 1_000_000,
                spend: { category: 'OPEX', recurrence: 'RECURRING', amountBasis: 'MONTHLY', startYm: '2026-02', endYm: '2026-05' },
              },
            ],
          },
        ],
      },
    ] as unknown as Department[];
    expect(buildInvestmentDemandSummary(depts, '12').yearly).toEqual([
      expect.objectContaining({ fiscalYear: 2026, amountYen: 4_000_000 }),
    ]);
  });

  it('年度ラベルは「決算期の終了年＋月期」で表記する（既存の「2024年3月期」表記と同じ）', () => {
    const s = buildInvestmentDemandSummary(oneTimeCapex('2026-04'), '3');
    expect(s.yearly[0].label).toBe('2027年3月期');
    expect(s.fiscalYearEndMonth).toBe(3);
  });
});

describe('決算月の未設定', () => {
  it('未設定なら暦年（12月期）として仮集計し、確定値として扱わない', () => {
    const s = buildInvestmentDemandSummary(oneTimeCapex('2027-03'), '');
    expect(s.fiscalYearEndMonth).toBeNull();
    expect(s.yearly[0].label).toBe('2027年12月期');
  });

  it('未設定の計画書データは numbersConfirmed=false とし、仮定の年度集計である旨と保留理由を示す', () => {
    const block = blockFor(inputsFor(undefined, oneTimeCapex('2027-03')));
    expect(block.status).toBe('CURRENT');
    expect(block.numbersConfirmed).toBe(false);
    expect(block.sections!.investmentPlan.fiscalYearBucketing).toBe('ASSUMED_DECEMBER');
    expect(block.sections!.basisAndConstraints.fiscalYearEndMonth).toBeNull();
    expect(block.sections!.basisAndConstraints.fiscalYearEndSet).toBe(false);
    expect(block.sections!.basisAndConstraints.holds.join('')).toContain('決算月が未設定');
  });

  it('未設定と空文字は同じ扱いになる', () => {
    const a = blockFor(inputsFor(undefined, oneTimeCapex('2027-03')));
    const b = blockFor(inputsFor('', oneTimeCapex('2027-03')));
    expect(a.numbersConfirmed).toBe(false);
    expect(b.numbersConfirmed).toBe(false);
    expect(b.sections!.basisAndConstraints.fiscalYearEndMonth).toBeNull();
  });
});

describe('3月・12月・2月決算の計画書データ', () => {
  it.each<[string, number, number]>([
    ['3', 3, 2027],
    ['12', 12, 2027],
    ['2', 2, 2028],
  ])('%s月決算：決算月を渡し、2027-03支出を FY%i に集計する', (fye, month, fy) => {
    const block = blockFor(inputsFor(fye, oneTimeCapex('2027-03')));
    expect(block.sections!.basisAndConstraints.fiscalYearEndMonth).toBe(month);
    expect(block.sections!.investmentPlan.fiscalYearEndMonth).toBe(month);
    expect(block.sections!.investmentPlan.fiscalYearBucketing).toBe('CONFIRMED');
    expect(block.sections!.investmentPlan.byFiscalYear).toContainEqual(expect.objectContaining({ fiscalYear: fy, capexYen: 10_000_000 }));
    expect(block.numbersConfirmed).toBe(true);
  });
});

describe('保存後に決算月が変わった場合', () => {
  it('保存時は未設定、現在は3月の場合は STALE として数値を確定扱いにしない', () => {
    const saved = savedFrom(inputsFor(undefined, oneTimeCapex('2027-03')));
    const block = blockFor(inputsFor('3', oneTimeCapex('2027-03')), saved);
    expect(block.status).toBe('STALE');
    expect(block.numbersConfirmed).toBe(false);
    expect(block.statusReasons.join('')).toContain('元データが保存時点から変わっています');
  });

  it('保存時は3月、現在は12月の場合も STALE になる', () => {
    const saved = savedFrom(inputsFor('3', oneTimeCapex('2027-03')));
    const block = blockFor(inputsFor('12', oneTimeCapex('2027-03')), saved);
    expect(block.status).toBe('STALE');
    expect(block.numbersConfirmed).toBe(false);
  });
});

describe('既存の保存データとの互換性', () => {
  const base = { financePL, financeBS, investment: {
    approvedReadyYen: 0, unapprovedReadyYen: 0, unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0, yearlyByCategory: [],
  } };

  it('未設定の決算月は識別子に含めないため、既存の保存済み前提の識別子は変わらない', () => {
    const without = sourceHashOf(base);
    expect(sourceHashOf({ ...base, fiscalYearEnd: undefined })).toBe(without);
    expect(sourceHashOf({ ...base, fiscalYearEnd: '' })).toBe(without);
  });

  it('決算月を設定すると識別子が変わり、保存時点との相違として検出される', () => {
    expect(sourceHashOf({ ...base, fiscalYearEnd: '3' })).not.toBe(sourceHashOf(base));
    expect(sourceHashOf({ ...base, fiscalYearEnd: '3' })).not.toBe(sourceHashOf({ ...base, fiscalYearEnd: '12' }));
  });
});

describe('保存・復元の正規化（既存の会社情報を保つ）', () => {
  it('DBの決算月（文字列）を状態に復元し、既存の会社情報は変えない', () => {
    const out = normalizeStrategyData({ companyName: 'テスト株式会社', fiscalYearEnd: '3' });
    expect(out.fiscalYearEnd).toBe('3');
    expect(out.companyName).toBe('テスト株式会社');
  });

  it('DBの決算月が null や不正値の場合は未設定（空文字）に戻す', () => {
    expect(normalizeStrategyData({ fiscalYearEnd: null }).fiscalYearEnd).toBe('');
    expect(normalizeStrategyData({ fiscalYearEnd: '13' }).fiscalYearEnd).toBe('');
    expect(normalizeStrategyData({}).fiscalYearEnd).toBe('');
  });

  it('snake_case の fiscal_year_end 列からも読める', () => {
    expect(normalizeStrategyData({ fiscal_year_end: '12' }).fiscalYearEnd).toBe('12');
  });
});
