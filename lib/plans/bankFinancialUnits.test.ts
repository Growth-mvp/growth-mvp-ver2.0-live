import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import type { CfAssumptions } from '@/utils/stage6/cashflow';
import { buildBankFinancialPlanBlock, type BankFinancialPlanBlock } from '@/utils/stage6/bankFinancialPlan';
import { buildDebtSchedule } from '@/utils/stage6/debt';
import type { Stage6SourceInputs } from '@/utils/stage6/bankFinancialPlanSource';
import { computeStage6FinancePlan } from '@/utils/stage6/financePlanPipeline';
import type { ExistingLoanInput, NewLoanInput } from '@/utils/stage6/debt';
import {
  FINANCE_PLAN_CALC_VERSION,
  buildStoredFinancePlan,
  readStoredFinancePlan,
  type CalcSnapshotMeta,
  type FinancePlanDomain,
} from '@/utils/stage6/financePlanSnapshot';
import { buildPlanData } from '@/utils/export/buildPlanData';
import { cashFlowFormFrom, toCashFlowAssumptions } from '@/components/stage6/financePlanForm';
import { buildBankFinancialFacts } from './bankFinancialDocument';
import { formatMillionYen, formatMillionYenText } from './bankFinancialFormat';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const STRATEGY = '33333333-3333-4333-8333-333333333333';
const BASE_YEAR = 2026;
const COMPUTED_AT = '2026-10-20T00:00:00.000Z';

const financePL: FinancePLRow[] = [
  {
    year: BASE_YEAR,
    revenue: 107_222_000_000,
    operatingIncome: 8_358_000_000,
    netIncome: 5_993_000_000,
    depreciation: 194_000_000,
    interest: 8_000_000,
    tax: 1_000_000_000,
  },
];
const financeBS: FinanceBSRow[] = [
  {
    year: BASE_YEAR,
    cash: 17_592_000_000,
    ar: 22_624_000_000,
    inventory: 3_372_000_000,
    ap: 4_779_000_000,
    interestBearingDebt: 415_000_000,
  },
];
const departments = [
  {
    name: '営業部',
    projects: [
      {
        title: '設備',
        planStatus: 'approved',
        skillPlans: [
          {
            id: 's1',
            skillName: '設備',
            cost: 100_000_000,
            spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: `${BASE_YEAR + 1}-03` },
          },
        ],
      },
    ],
  },
] as unknown as Department[];

const assumptions: CfAssumptions = {
  minCashYen: 100_000_000,
  taxRate: 0.2,
  depreciationYen: null,
  arRatio: null,
  inventoryRatio: null,
  apRatio: null,
  targetRevenueYen: null,
  targetOperatingIncomeYen: null,
  targetYear: null,
};

const newLoan: NewLoanInput = {
  id: 'n0',
  name: '新規借入',
  drawYear: BASE_YEAR,
  drawMonth: 12,
  amountYen: 100_000_000,
  annualRate: 0.03,
  termYears: 5,
  graceYears: 0,
  method: 'EQUAL_PRINCIPAL',
};

const existingLoan: ExistingLoanInput = {
  id: 'e1',
  name: 'A銀行',
  category: 'BANK',
  balanceYen: 415_000_000,
  annualRate: 0.02,
  scheduledPrincipalYen: { [BASE_YEAR + 1]: 40_000_000, [BASE_YEAR + 2]: 40_000_000, [BASE_YEAR + 3]: 40_000_000 },
};

const companyTargets = [
  { id: 't1', label: '売上', unit: '百万円', dueYear: BASE_YEAR + 3, base: 130_000, priority: 4 },
  { id: 't2', label: '営業利益', unit: '百万円', dueYear: BASE_YEAR + 3, base: 11_700, priority: 4 },
];

/** store の保存処理（null・空文字を落とす）と同じ規則 */
function storePrune(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(storePrune).filter((v) => !(v === undefined || v === null));
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const pv = storePrune(v);
      const drop = pv === undefined || pv === null || (typeof pv === 'string' && pv.trim() === '');
      if (!drop) out[k] = pv;
    }
    return out;
  }
  return obj;
}

function inputsFor(domain: FinancePlanDomain, overrides: Partial<Stage6SourceInputs> = {}): Stage6SourceInputs {
  const base: Stage6SourceInputs = {
    financePL,
    financeBS,
    departments,
    fiscalYearEnd: '3',
    companyTargets,
    storedFinancePlan: undefined,
  };
  const src = { ...base, ...overrides };
  const c = computeStage6FinancePlan({
    financePL: src.financePL,
    financeBS: src.financeBS,
    departments: src.departments,
    fiscalYearEnd: src.fiscalYearEnd,
    domain,
    currentYear: BASE_YEAR,
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
    computedAt: COMPUTED_AT,
  };
  const stored = storePrune(buildStoredFinancePlan({ domain, companyId: COMPANY, meta, savedAt: COMPUTED_AT }));
  return { ...src, storedFinancePlan: JSON.parse(JSON.stringify(stored)) };
}

function blockFor(domain: FinancePlanDomain, overrides: Partial<Stage6SourceInputs> = {}): BankFinancialPlanBlock {
  const src = inputsFor(domain, overrides);
  return buildBankFinancialPlanBlock({
    companyId: COMPANY,
    strategyId: STRATEGY,
    storedFinancePlan: src.storedFinancePlan,
    inputs: src,
    currentYear: BASE_YEAR,
    computedAt: COMPUTED_AT,
  });
}

const withNewOnly: FinancePlanDomain = { assumptions, existingLoans: [], newLoans: [newLoan], dividendsYen: {} };
const withBothLoans: FinancePlanDomain = {
  assumptions,
  existingLoans: [existingLoan],
  newLoans: [newLoan],
  dividendsYen: { [BASE_YEAR + 1]: 0, [BASE_YEAR + 2]: 0, [BASE_YEAR + 3]: 0 },
};
const forecastYear = (y: number) => y;

describe('1・2. 円と百万円の変換・最低必要現預金の保存と復元', () => {
  it('1億円は 100,000,000 円 = 100.0 百万円。百万円の入力は円として保存される', () => {
    expect(formatMillionYen(100_000_000)).toBe('100.0');
    const form = cashFlowFormFrom({ ...assumptions, minCashYen: 100_000_000 });
    expect(form.minCash).toBe('100');
    expect(toCashFlowAssumptions({ ...form, minCash: '100' }).minCashYen).toBe(100_000_000);
  });

  it('2. 最低必要現預金1億円を保存し、読み戻しても同じ金額・同じ入力表示になる', () => {
    const saved = JSON.parse(JSON.stringify(storePrune(buildStoredFinancePlan({
      domain: withNewOnly,
      companyId: COMPANY,
      meta: {
        calcVersion: FINANCE_PLAN_CALC_VERSION,
        companyId: COMPANY,
        baseYear: BASE_YEAR,
        bsBaseYear: BASE_YEAR,
        assumptionsHash: 'x',
        sourceHash: 'x',
        unconfirmed: { unapprovedReadyYen: 0, unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
        computedAt: COMPUTED_AT,
      },
      savedAt: COMPUTED_AT,
    }))));
    const read = readStoredFinancePlan(saved, COMPANY);
    expect(read.kind).toBe('OK');
    if (read.kind !== 'OK') return;
    expect(read.domain.assumptions.minCashYen).toBe(100_000_000);
    expect(cashFlowFormFrom(read.domain.assumptions).minCash).toBe('100');
  });
});

describe('4. 同金額の銀行向け計画書表示', () => {
  it('最低必要現預金は、STAGE6画面と同じ書式（小数第1位・百万円）で表示される', () => {
    const facts = buildBankFinancialFacts(blockFor(withNewOnly))!;
    const stage6Display = (100_000_000 / 1_000_000).toLocaleString('ja-JP', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    expect(stage6Display).toBe('100.0');
    expect(facts.markdown).toContain('最低必要現預金：100.0百万円');
    expect(facts.markdown).toMatch(/\|\s*2027年\s*\|[^\n]*\|\s*100\.0\s*\|/);
  });

  it('桁違いの入力（1億を百万円欄へ入れた値）は、そのまま表示しつつ確認事項として示す', () => {
    const mis: FinancePlanDomain = { ...withNewOnly, assumptions: { ...assumptions, minCashYen: 100_000_000_000_000 } };
    const facts = buildBankFinancialFacts(blockFor(mis))!;
    expect(facts.markdown).toContain('最低必要現預金：100,000,000.0百万円');
    expect(facts.markdown).toContain('基準年度の売上高の100倍以上です');
    expect(facts.issues.some((i) => i.includes('100倍以上'))).toBe(true);
  });
});

describe('5. STAGE1とSTAGE6の基準年度金額一致', () => {
  it('STAGE1の基準年度売上高とSTAGE6の基準年度売上高は同じ円の値である', () => {
    const state = { companyName: 'テスト', financePL, departments: [] } as unknown as Parameters<typeof buildPlanData>[0];
    const stage1 = buildPlanData(state, 'bank').stage1.historicalFinances!.find((f) => f.year === BASE_YEAR)!;
    const block = blockFor(withNewOnly);
    expect(stage1.revenue).toBe(block.sections!.financialTargets.baseYearRevenueYen);
    expect(formatMillionYen(stage1.revenue)).toBe(formatMillionYen(block.sections!.financialTargets.baseYearRevenueYen));
  });

  it('STAGE1の単位は確定できないため「未確認」のまま表示し、計画書の注記で計算上の扱いを示す', () => {
    const state = { companyName: 'テスト', financePL, departments: [] } as unknown as Parameters<typeof buildPlanData>[0];
    const stage1 = buildPlanData(state, 'bank').stage1.historicalFinances!.find((f) => f.year === BASE_YEAR)!;
    expect(stage1.unit).toBe('未確認');
    const facts = buildBankFinancialFacts(blockFor(withNewOnly))!;
    expect(facts.markdown).toContain('STAGE1の財務実績の単位：未確認');
  });
});

describe('6・7. 未入力と0の区別、既存借入0件・明細未入力', () => {
  it('既存借入の明細が無い場合は「0件」ではなく「明細未入力」と表示する', () => {
    const facts = buildBankFinancialFacts(blockFor(withNewOnly))!;
    expect(facts.markdown).toContain('既存借入：明細未入力（0件とはしていません）');
    expect(facts.markdown).not.toContain('既存借入：0件');
  });

  it('STAGE1の有利子負債は計画書に示すが、内訳が無いため既存借入の残高は未確定とする', () => {
    const facts = buildBankFinancialFacts(blockFor(withNewOnly))!;
    expect(facts.markdown).toContain('STAGE1に登録された2026年末の有利子負債の合計は415.0百万円');
    expect(facts.markdown).toContain('既存借入の残高・利息・元利返済は未確定');
  });

  it('金額0の既存借入は入力済みとして扱い、「明細未入力」にはしない', () => {
    const zeroLoan: FinancePlanDomain = {
      assumptions,
      existingLoans: [{ ...existingLoan, balanceYen: 0, scheduledPrincipalYen: {} }],
      newLoans: [],
      dividendsYen: {},
    };
    const facts = buildBankFinancialFacts(blockFor(zeroLoan))!;
    expect(facts.markdown).toContain('既存借入：1件');
    expect(facts.markdown).not.toContain('明細未入力');
  });

  it('値の未入力は「未確定」、0は「0.0」と表示する', () => {
    const facts = buildBankFinancialFacts(blockFor(withNewOnly))!;
    expect(facts.markdown).toContain('未確定');
    expect(formatMillionYenText(null)).toBe('未確定');
    expect(formatMillionYenText(0)).toBe('0.0百万円');
  });
});

describe('8・9. 営業CFの評価保留と計算可能時の算出', () => {
  it('既存借入の明細が無い場合、利息と営業CFは評価保留になり、理由を示す', () => {
    const block = blockFor(withNewOnly);
    const y = block.sections!.cashFlow.years.find((r) => r.year === forecastYear(BASE_YEAR + 1))!;
    expect(y.operatingCf.value).toBeNull();
    expect(y.holds).toEqual(expect.arrayContaining(['既存借入の内訳が未入力']));
  });

  it('既存借入の明細と配当が入力されていれば、営業CFと資金残高を算出する', () => {
    const block = blockFor(withBothLoans);
    const y = block.sections!.cashFlow.years.find((r) => r.year === forecastYear(BASE_YEAR + 1))!;
    expect(y.operatingCf.value).not.toBeNull();
    expect(typeof y.closingCashAfterFinancing.value).toBe('number');
    expect(block.numbersConfirmed).toBe(true);
  });
});

describe('10. 借入・返済計画の整合性', () => {
  it('年初残高＋借入−元本返済＝年末残高が各年度で一致する', () => {
    const block = blockFor(withBothLoans);
    for (const d of block.sections!.debtRepayment.years) {
      const open = d.openingBalance.value;
      const draw = d.draw.value;
      const principal = d.principal.value;
      const close = d.closingBalance.value;
      if (open === null || draw === null || principal === null || close === null) continue;
      expect(open + draw - principal).toBeCloseTo(close, 0);
    }
  });

  it('新規借入のみの場合、元本・利息・期末残高は入力条件から計算される（2027年：元本2,000万・利息300万・残高8,000万）', () => {
    const block = blockFor(withNewOnly);
    const y = block.sections!.debtRepayment.years.find((d) => d.year === BASE_YEAR + 1)!;
    expect(y.newPrincipal.value).toBe(20_000_000);
    expect(y.newInterest.value).toBe(3_000_000);
    expect(y.newClosingBalance.value).toBe(80_000_000);
    const facts = buildBankFinancialFacts(block)!;
    expect(facts.markdown).toContain('**新規借入の返済計画（計算可能な部分）**');
    expect(facts.markdown).toMatch(/\|\s*2027年\s*\|\s*80\.0\s*\|\s*20\.0\s*\|\s*3\.0\s*\|\s*23\.0\s*\|/);
  });
});

describe('10補. 基準年度中に実行された新規借入が予測期間に反映される', () => {
  it('予測期間の前年（基準年度）に実行した借入の残高・利息・元本を、予測年度に計上する', () => {
    const schedule = buildDebtSchedule({
      forecastYears: [BASE_YEAR + 1, BASE_YEAR + 2, BASE_YEAR + 3],
      existingLoans: [],
      newLoans: [newLoan],
      stage1InterestBearingDebtYen: null,
      dividendsYen: {},
      fiscalYearEndSet: true,
    });
    const y27 = schedule.years[0];
    expect(y27.newClosingBalance.value).toBe(80_000_000);
    expect(y27.newPrincipal.value).toBe(20_000_000);
    expect(y27.newInterest.value).toBe(3_000_000);
    expect(schedule.years[1].newClosingBalance.value).toBe(60_000_000);
  });
});

describe('11. DSCRの計算条件', () => {
  it('DSCRは（営業CF＋支払利息）÷（元本返済＋支払利息）で計算される', () => {
    const block = blockFor(withBothLoans);
    const cf = block.sections!.cashFlow.years.find((r) => r.year === BASE_YEAR + 1)!;
    const debt = block.sections!.debtRepayment.years.find((d) => d.year === BASE_YEAR + 1)!;
    const ocf = cf.operatingCf.value!;
    const interest = debt.interest.value!;
    const principal = debt.principal.value!;
    expect(debt.dscr.value).toBeCloseTo((ocf + interest) / (principal + interest), 10);
  });

  it('元利返済が0の年はDSCRを算出しない（0での除算をしない）', () => {
    const noService: FinancePlanDomain = {
      assumptions,
      existingLoans: [
        {
          ...existingLoan,
          balanceYen: 0,
          scheduledPrincipalYen: { [BASE_YEAR + 1]: 0, [BASE_YEAR + 2]: 0, [BASE_YEAR + 3]: 0 },
        },
      ],
      newLoans: [],
      dividendsYen: {},
    };
    const block = blockFor(noService);
    const debt = block.sections!.debtRepayment.years.find((d) => d.year === BASE_YEAR + 1)!;
    expect(debt.dscr.value).toBeNull();
  });
});

describe('12. STAGE2目標とSTAGE6推計の差額', () => {
  it('2029年の売上・営業利益の差額を、STAGE2目標とSTAGE6推計の差として示す（自動置換しない）', () => {
    const block = blockFor(withNewOnly);
    const facts = buildBankFinancialFacts(block)!;
    expect(facts.markdown).toContain('| 売上高 | 130,000.0 | 107,222.0 | -22,778.0 |');
    expect(facts.markdown).toContain('| 営業利益 | 11,700.0 | 8,358.0 | -3,342.0 |');
    expect(block.sections!.financialTargets.gaps.revenue.explanation.available).toBe(false);
    expect(block.sections!.financialTargets.stage6Scenario.revenueYen).toBeNull();
  });
});

describe('13. 銀行向け以外の計画書への非干渉', () => {
  it('株主向け・社員向けの過去実績は従来どおり単位未確認で出力される', () => {
    const state = { companyName: 'テスト', financePL, departments: [] } as unknown as Parameters<typeof buildPlanData>[0];
    for (const audience of ['shareholder', 'employee'] as const) {
      const f = buildPlanData(state, audience).stage1.historicalFinances!.find((r) => r.year === BASE_YEAR)!;
      expect(f.unit).toBe('未確認');
      expect(f.revenue).toBe(107_222_000_000);
    }
  });
});

describe('14. 既存の保存済み財務前提との互換性', () => {
  it('保存時に null が落ちた既存の前提でも、読み込みと識別子の照合は通る', () => {
    const src = inputsFor(withNewOnly);
    const block = blockFor(withNewOnly);
    expect(block.status).toBe('CURRENT');
    expect(src.storedFinancePlan).toBeDefined();
  });
});
