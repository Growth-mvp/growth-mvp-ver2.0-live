import type { CfAssumptions } from './cashflow';
import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import {
  bankFinancialPlanForRow,
  buildBankFinancialPlanBlock,
  withBankFinancialPlan,
  type BankFinancialPlanBlock,
} from './bankFinancialPlan';
import type { Stage6SourceInputs } from './bankFinancialPlanSource';
import { computeStage6FinancePlan } from './financePlanPipeline';
import {
  FINANCE_PLAN_CALC_VERSION,
  buildStoredFinancePlan,
  type CalcSnapshotMeta,
  type FinancePlanDomain,
} from './financePlanSnapshot';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY = '22222222-2222-4222-8222-222222222222';
const STRATEGY = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-20T00:00:00Z');
const CURRENT_YEAR = 2026;
const SAVED_AT = '2026-10-19T00:00:00.000Z';

const financePL: FinancePLRow[] = [
  { year: 2024, revenue: 900_000_000, operatingIncome: 40_000_000, netIncome: 25_000_000, depreciation: 18_000_000, interest: 6_000_000, tax: 8_000_000 },
  { year: 2025, revenue: 1_000_000_000, operatingIncome: 50_000_000, netIncome: 30_000_000, depreciation: 20_000_000, interest: 5_000_000, tax: 10_000_000 },
];

const financeBS: FinanceBSRow[] = [
  { year: 2025, cash: 100_000_000, ar: 150_000_000, inventory: 80_000_000, ap: 60_000_000, interestBearingDebt: 300_000_000 },
];

const departments = [
  {
    name: '営業部',
    projects: [
      {
        title: 'A社開拓',
        planStatus: 'approved',
        impactRevenueMJPY: 100,
        impactOpIncomeMJPY: 10,
        skillPlans: [
          {
            id: 'sk1',
            skillName: '提案力',
            cost: 30_000_000,
            spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2027-03' },
          },
          { id: 'sk2', skillName: '外注', cost: 5_000_000 },
          { id: 'sk3', skillName: '研修', cost: 2_000_000, spend: { category: 'OPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL' } },
        ],
      },
      { title: '未評価施策', planStatus: 'draft' },
    ],
  },
] as unknown as Department[];

const assumptions: CfAssumptions = {
  minCashYen: 80_000_000,
  taxRate: 0.3,
  depreciationYen: null,
  arRatio: null,
  inventoryRatio: null,
  apRatio: null,
  targetRevenueYen: 1_200_000_000,
  targetOperatingIncomeYen: 80_000_000,
  targetYear: 2028,
};

const domain: FinancePlanDomain = {
  assumptions,
  existingLoans: [
    {
      id: 'e1',
      name: 'A銀行 長期借入',
      category: 'BANK',
      balanceYen: 300_000_000,
      annualRate: 0.02,
      scheduledPrincipalYen: { 2026: 30_000_000, 2027: 30_000_000, 2028: 30_000_000 },
    },
  ],
  newLoans: [],
  dividendsYen: { 2026: 0, 2027: 5_000_000 },
};

const companyTargets = [
  { id: 't1', label: '売上高', unit: '百万円', dueYear: 2028, base: 1500, priority: 1 },
  { id: 't2', label: '営業利益率', unit: '%', dueYear: 2028, base: 8, priority: 2 },
  { id: 't3', label: '営業利益', unit: '百万円', dueYear: 2028, base: 70, priority: 1 },
];

function inputsWith(overrides: Partial<Stage6SourceInputs> = {}): Stage6SourceInputs {
  return {
    financePL,
    financeBS,
    departments,
    fiscalYearEnd: '3',
    companyTargets,
    storedFinancePlan: undefined,
    ...overrides,
  };
}

const roundTrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function savedFor(
  domainToSave: FinancePlanDomain,
  inputs: Stage6SourceInputs,
  options: { companyId?: string; metaCompanyId?: string } = {},
) {
  const companyId = options.companyId ?? COMPANY;
  const computed = computeStage6FinancePlan({
    financePL: inputs.financePL,
    financeBS: inputs.financeBS,
    departments: inputs.departments,
    fiscalYearEnd: inputs.fiscalYearEnd,
    domain: domainToSave,
    currentYear: CURRENT_YEAR,
  });
  const meta: CalcSnapshotMeta = {
    calcVersion: FINANCE_PLAN_CALC_VERSION,
    companyId: options.metaCompanyId ?? companyId,
    baseYear: computed.basePlan.baseYear,
    bsBaseYear: computed.basePlan.bsBaseYear,
    assumptionsHash: computed.assumptionsHash,
    sourceHash: computed.sourceHash,
    unconfirmed: {
      unapprovedReadyYen: computed.investment.unapprovedReadyYen,
      unclassifiedYen: computed.investment.unclassifiedYen,
      unscheduledYen: computed.investment.unscheduledYen,
      candidateYen: computed.investment.candidateYen,
      basisPendingYen: computed.investment.basisPendingYen,
    },
    computedAt: SAVED_AT,
  };
  return roundTrip(buildStoredFinancePlan({ domain: domainToSave, companyId, meta, savedAt: SAVED_AT }));
}

function blockFor(inputs: Stage6SourceInputs, companyId: string = COMPANY): BankFinancialPlanBlock {
  return buildBankFinancialPlanBlock({
    companyId,
    strategyId: STRATEGY,
    storedFinancePlan: inputs.storedFinancePlan,
    inputs,
    currentYear: CURRENT_YEAR,
    computedAt: NOW.toISOString(),
  });
}

describe('1. 保存済み前提の取得', () => {
  it('現在の元データと一致する保存済み前提からCURRENTで数値を返す', () => {
    const base = inputsWith();
    const block = blockFor({ ...base, storedFinancePlan: savedFor(domain, base) });
    expect(block.status).toBe('CURRENT');
    expect(block.sections).not.toBeNull();
    expect(block.numbersConfirmed).toBe(true);
    expect(block.reproducibility.savedAssumptionsHash).toBe(block.reproducibility.currentAssumptionsHash);
    expect(block.reproducibility.savedSourceHash).toBe(block.reproducibility.currentSourceHash);
    expect(block.sections!.basisAndConstraints.forecastWindow).toEqual([2026, 2027, 2028]);
  });

  it('DBの行から組み立てても、保存時と同じ識別子になる（保存時は決算期未設定）', () => {
    const noFye = inputsWith({ fiscalYearEnd: undefined });
    const stored = savedFor(domain, noFye);
    const row = {
      id: STRATEGY,
      company_id: COMPANY,
      departments,
      finance_pl: financePL,
      company_targets: companyTargets,
      csv_finance_data: { financeBS, financePlanAssumptions: stored },
    };
    const block = bankFinancialPlanForRow({ row, companyId: COMPANY, now: NOW });
    expect(block.status).toBe('CURRENT');
    expect(block.reproducibility.savedSourceHash).toBe(block.reproducibility.currentSourceHash);
    expect(block.reproducibility.savedAssumptionsHash).toBe(block.reproducibility.currentAssumptionsHash);
    expect(block.numbersConfirmed).toBe(false);
  });
});

describe('2. 会社ID不一致時の拒否', () => {
  it('保存データの会社IDが現在の会社と異なれば数値を使わない', () => {
    const base = inputsWith();
    const block = blockFor({ ...base, storedFinancePlan: savedFor(domain, base, { companyId: OTHER_COMPANY }) });
    expect(block.status).toBe('DIFFERENT_COMPANY');
    expect(block.sections).toBeNull();
  });

  it('保存情報の会社IDだけが異なる場合も拒否する', () => {
    const base = inputsWith();
    const block = blockFor({ ...base, storedFinancePlan: savedFor(domain, base, { metaCompanyId: OTHER_COMPANY }) });
    expect(block.status).toBe('DIFFERENT_COMPANY');
    expect(block.sections).toBeNull();
  });
});

describe('3. 未保存の場合の扱い', () => {
  it('保存データがなければ財務数値を生成しない', () => {
    const block = blockFor(inputsWith({ storedFinancePlan: undefined }));
    expect(block.status).toBe('NOT_SAVED');
    expect(block.sections).toBeNull();
    expect(block.numbersConfirmed).toBe(false);
  });
});

describe('4. 保存形式・単位・計算ロジック版の検証', () => {
  const base = inputsWith();

  it('未知の保存形式版は使用しない', () => {
    const stored = { ...savedFor(domain, base), formatVersion: 2 };
    const block = blockFor({ ...base, storedFinancePlan: stored });
    expect(block.status).toBe('INVALID');
    expect(block.sections).toBeNull();
  });

  it('金額単位がJPYでなければ使用しない', () => {
    const stored = { ...savedFor(domain, base), unit: 'MJPY' };
    const block = blockFor({ ...base, storedFinancePlan: stored });
    expect(block.status).toBe('INVALID');
    expect(block.sections).toBeNull();
  });

  it('未対応の計算ロジック版は変換せず使用しない', () => {
    const stored = savedFor(domain, base) as unknown as { meta: { calcVersion: string } };
    stored.meta.calcVersion = 'phase3-v9';
    const block = blockFor({ ...base, storedFinancePlan: stored });
    expect(block.status).toBe('INVALID');
    expect(block.statusReasons.join('')).toContain('未対応の計算ロジック版');
    expect(block.sections).toBeNull();
  });

  it('保存後に前提値が書き換えられていれば識別子の不一致として使用しない', () => {
    const stored = savedFor(domain, base) as unknown as { existingLoans: { balanceYen: number }[] };
    stored.existingLoans[0].balanceYen = 1;
    const block = blockFor({ ...base, storedFinancePlan: stored });
    expect(block.status).toBe('INVALID');
    expect(block.sections).toBeNull();
  });
});

describe('5. サーバー側のCF再計算', () => {
  it('FORECAST年度の値が営業CF・投資CF・FCF・期末現預金の関係式を満たす', () => {
    const base = inputsWith();
    const block = blockFor({ ...base, storedFinancePlan: savedFor(domain, base) });
    const years = block.sections!.cashFlow.years.filter((y) => y.kind === 'FORECAST');
    expect(years.map((y) => y.year)).toEqual([2026, 2027, 2028]);

    const y26 = years[0];
    expect(y26.capex).toEqual({ value: 0, basis: 'REGISTERED', note: 'STAGE4に確定済みの資本的支出の登録なし' });
    const y27 = years[1];
    expect(y27.capex).toEqual({ value: 30_000_000, basis: 'REGISTERED', note: 'STAGE4の確定済み資本的支出' });
    expect(y27.fcf.value).toBe((y27.operatingCf.value as number) - 30_000_000);
    expect(y27.closingCashAfterFinancing.value).toBe(
      (y27.closingCashBeforeFinancing.value as number) + (y27.financingCf.value as number),
    );
  });

  it('営業CFを、推計売上・営業利益・既存借入利息・税率・減価償却・運転資金から再計算する', () => {
    const base = inputsWith();
    const block = blockFor({ ...base, storedFinancePlan: savedFor(domain, base) });
    const ratio = 0.15 + 0.08 - 0.06;
    const revenue26 = 1_000_000_000 + (200_000_000 * 1) / 3;
    const revenue27 = 1_000_000_000 + (200_000_000 * 2) / 3;
    const oi27 = 50_000_000 + (80_000_000 - 50_000_000) * (2 / 3);
    const netIncome27 = (oi27 - 5_400_000) * (1 - 0.3);
    const wcChange27 = ratio * (revenue27 - revenue26);
    const expectedOcf27 = netIncome27 + 20_000_000 - wcChange27;

    const revenueRow = block.sections!.revenuePlan.years.find((y) => y.year === 2027)!;
    expect(revenueRow.revenue.value).toBeCloseTo(revenue27, 0);
    expect(revenueRow.operatingIncome.value).toBeCloseTo(oi27, 0);
    const cf27 = block.sections!.cashFlow.years.find((y) => y.year === 2027)!;
    expect(cf27.operatingCf.value).toBeCloseTo(expectedOcf27, 0);
  });
});

describe('6. 借入・返済計算', () => {
  it('既存借入の年利・元本返済・期末残高を年度ごとに計算する', () => {
    const base = inputsWith();
    const block = blockFor({ ...base, storedFinancePlan: savedFor(domain, base) });
    const d = block.sections!.debtRepayment;
    expect(d.entered).toBe(true);
    const y26 = d.years.find((y) => y.year === 2026)!;
    expect(y26.interest.value).toBe(6_000_000);
    expect(y26.principal.value).toBe(30_000_000);
    expect(y26.debtService.value).toBe(36_000_000);
    expect(y26.closingBalance.value).toBe(270_000_000);
    expect(y26.existingClosingBalance.value).toBe(270_000_000);

    const y27 = d.years.find((y) => y.year === 2027)!;
    expect(y27.interest.value).toBe(5_400_000);
    expect(y27.closingBalance.value).toBe(240_000_000);
  });

  it('DSCRは（営業CF＋利息）÷（元本返済＋利息）で計算される', () => {
    const base = inputsWith();
    const block = blockFor({ ...base, storedFinancePlan: savedFor(domain, base) });
    const cf27 = block.sections!.cashFlow.years.find((y) => y.year === 2027)!;
    const d27 = block.sections!.debtRepayment.years.find((y) => y.year === 2027)!;
    expect(d27.dscr.value).toBeCloseTo(((cf27.operatingCf.value as number) + 5_400_000) / 35_400_000, 10);
  });
});

describe('8. STAGE2目標との整合確認', () => {
  const base = inputsWith();
  const block = blockFor({ ...base, storedFinancePlan: savedFor(domain, base) });
  const targets = block.sections!.financialTargets;

  it('STAGE2の目標は登録済み・未承認として扱う', () => {
    expect(targets.stage2Registered.revenue).toMatchObject({
      valueYen: 1_500_000_000,
      dueYear: 2028,
      approval: 'REGISTERED_NOT_APPROVED',
    });
  });

  it('営業利益率の目標を営業利益の目標と取り違えない', () => {
    expect(targets.stage2Registered.operatingIncome).toMatchObject({ label: '営業利益', valueYen: 70_000_000 });
  });

  it('同年度のSTAGE6推計との差額を保持し、説明データがないことを示す', () => {
    expect(targets.gaps.revenue).toMatchObject({ projectedYen: 1_200_000_000, differenceYen: -300_000_000, reason: null });
    expect(targets.gaps.revenue.explanation.available).toBe(false);
    expect(targets.gaps.operatingIncome).toMatchObject({ projectedYen: 80_000_000, differenceYen: 10_000_000 });
  });

  it('単位を金額に換算できない目標は金額として扱わず、差額も出さない', () => {
    const alt = inputsWith({
      companyTargets: [{ id: 'x', label: '売上高', unit: '件', dueYear: 2028, base: 10 }],
    });
    const b = blockFor({ ...alt, storedFinancePlan: savedFor(domain, alt) });
    expect(b.sections!.financialTargets.stage2Registered.revenue!.valueYen).toBeNull();
    expect(b.sections!.financialTargets.gaps.revenue.differenceYen).toBeNull();
    expect(b.sections!.financialTargets.gaps.revenue.reason).toContain('金額');
  });

  it('目標年度が推計期間の外なら差額を計算せず理由を残す', () => {
    const alt = inputsWith({
      companyTargets: [{ id: 'x', label: '売上高', unit: '百万円', dueYear: 2031, base: 1500 }],
    });
    const b = blockFor({ ...alt, storedFinancePlan: savedFor(domain, alt) });
    expect(b.sections!.financialTargets.gaps.revenue.differenceYen).toBeNull();
    expect(b.sections!.financialTargets.gaps.revenue.reason).toContain('2031年');
  });

  it('STAGE2目標がない場合は登録なしとして扱う', () => {
    const alt = inputsWith({ companyTargets: [] });
    const b = blockFor({ ...alt, storedFinancePlan: savedFor(domain, alt) });
    expect(b.sections!.financialTargets.stage2Registered.revenue).toBeNull();
    expect(b.sections!.financialTargets.gaps.revenue.reason).toBe('STAGE2に正式目標が登録されていません');
  });
});

describe('9. STAGE4投資額との連携', () => {
  const base = inputsWith();
  const block = blockFor({ ...base, storedFinancePlan: savedFor(domain, base) });

  it('決算期が確認できる場合、CAPEXを年度別に計上する', () => {
    expect(block.sections!.investmentPlan.fiscalYearBucketing).toBe('CONFIRMED');
    expect(block.sections!.investmentPlan.byFiscalYear).toContainEqual(
      expect.objectContaining({ fiscalYear: 2027, capexYen: 30_000_000 }),
    );
  });

  it('施策別の期待効果は単純合計として別項目に置き、未入力の施策は件数で示す', () => {
    const s = block.sections!.financialTargets.stage4Contributions;
    expect(s.revenueYen).toBe(100_000_000);
    expect(s.operatingIncomeYen).toBe(10_000_000);
    expect(s.projectCount).toBe(2);
    expect(s.missingValueCount).toBe(1);
    expect(s.note).toContain('単純合計');
  });
});

describe('10. 未確定投資額の扱い', () => {
  const base = inputsWith();
  const block = blockFor({ ...base, storedFinancePlan: savedFor(domain, base) });

  it('金額基準が未確定の投資額は未確定欄に保持し、CAPEXや0円には混ぜない', () => {
    expect(block.sections!.investmentPlan.unresolved.basisPendingYen).toBe(5_000_000);
    expect(block.sections!.investmentPlan.byFiscalYear.find((b) => b.fiscalYear === 2027)!.capexYen).toBe(30_000_000);
  });

  it('時期が未設定の投資額は未設定欄に保持する', () => {
    expect(block.sections!.investmentPlan.unresolved.unscheduledYen).toBe(2_000_000);
  });

  it('投資額の出所を施策・項目ごとに残す', () => {
    const src = block.sections!.investmentPlan.sources.find(
      (s) => s.projectTitle === 'A社開拓' && s.amountYen === 30_000_000,
    );
    expect(src).toMatchObject({ source: 'SKILL_PLAN', counted: true, ready: true });
    expect(src?.sourceField).toEqual(expect.any(String));
  });
});

describe('11. 未入力と0の区別', () => {
  it('配当の未入力はnull（HELD）、0円入力は0（USER）として区別する', () => {
    const base = inputsWith();
    const block = blockFor({ ...base, storedFinancePlan: savedFor(domain, base) });
    const y26 = block.sections!.debtRepayment.years.find((y) => y.year === 2026)!;
    const y28 = block.sections!.debtRepayment.years.find((y) => y.year === 2028)!;
    expect(y26.dividends).toMatchObject({ value: 0, basis: 'USER' });
    expect(y28.dividends).toMatchObject({ value: null, basis: 'HELD' });
  });

  it('借入が未入力の場合、返済額は0ではなく未算出として示す', () => {
    const noDebt: FinancePlanDomain = { ...domain, existingLoans: [], dividendsYen: {} };
    const base = inputsWith();
    const block = blockFor({ ...base, storedFinancePlan: savedFor(noDebt, base) });
    expect(block.sections!.debtRepayment.entered).toBe(false);
    expect(block.sections!.debtRepayment.years).toEqual([]);
  });
});

describe('12. 年度不一致時の評価保留', () => {
  it('PLとBSの基準年度が異なる場合は資金計画を保留し、数値を確定扱いにしない', () => {
    const mismatchBS: FinanceBSRow[] = [{ ...financeBS[0], year: 2024 }];
    const base = inputsWith({ financeBS: mismatchBS });
    const block = blockFor({ ...base, storedFinancePlan: savedFor(domain, base) });
    expect(block.sections!.cashFlow.yearMismatch).toBe(true);
    expect(block.numbersConfirmed).toBe(false);
    expect(block.statusReasons.join('')).toContain('一致しない');
    const y27 = block.sections!.cashFlow.years.find((y) => y.year === 2027)!;
    expect(y27.verdict).toBe('評価保留');
  });
});

describe('13. 保存時点と現在の元データの相違', () => {
  it('保存後に元データが変わった場合はSTALEとし、数値を確定扱いにしない', () => {
    const saved = savedFor(domain, inputsWith());
    const changed = inputsWith({
      financeBS: [{ ...financeBS[0], cash: 120_000_000 }],
    });
    const block = blockFor({ ...changed, storedFinancePlan: saved });
    expect(block.status).toBe('STALE');
    expect(block.numbersConfirmed).toBe(false);
    expect(block.statusReasons.join('')).toContain('元データが保存時点から変わっています');
    expect(block.reproducibility.savedSourceHash).not.toBe(block.reproducibility.currentSourceHash);
    expect(block.sections).not.toBeNull();
  });
});

describe('14・15. 銀行向け以外への非干渉と既存データの維持', () => {
  const planData = { audience: 'bank', companyName: 'テスト株式会社', stage1: { industry: '製造' } };
  const block = blockFor({ ...inputsWith(), storedFinancePlan: savedFor(domain, inputsWith()) });

  it('銀行向け以外の計画書データには財務ブロックを追加しない', () => {
    expect(withBankFinancialPlan({ ...planData, audience: 'shareholder' }, 'shareholder', block)).not.toHaveProperty(
      'bankFinancialPlan',
    );
    expect(withBankFinancialPlan({ ...planData, audience: 'employee' }, 'employee', block)).not.toHaveProperty(
      'bankFinancialPlan',
    );
  });

  it('銀行向けでも既存フィールドは変えず、元のオブジェクトも変更しない', () => {
    const out = withBankFinancialPlan(planData, 'bank', block);
    expect(out.bankFinancialPlan).toBe(block);
    expect(out.companyName).toBe(planData.companyName);
    expect(out.stage1).toBe(planData.stage1);
    expect(planData).not.toHaveProperty('bankFinancialPlan');
  });

  it('計算中の例外は握りつぶし、数値を含まないUNAVAILABLEを返す', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = {
      id: STRATEGY,
      get csv_finance_data(): never {
        throw new Error('boom');
      },
    };
    const b = bankFinancialPlanForRow({ row: broken as unknown as Record<string, unknown>, companyId: COMPANY, now: NOW });
    expect(b.status).toBe('UNAVAILABLE');
    expect(b.sections).toBeNull();
    errSpy.mockRestore();
  });

  it('保存データがないDB行でも例外にならずNOT_SAVEDを返す', () => {
    const b = bankFinancialPlanForRow({
      row: { id: STRATEGY, company_id: COMPANY, departments: 'broken', csv_finance_data: null },
      companyId: COMPANY,
      now: NOW,
    });
    expect(b.status).toBe('NOT_SAVED');
  });
});
