import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import type { CfAssumptions } from '@/utils/stage6/cashflow';
import { buildBankFinancialPlanBlock, type BankFinancialPlanBlock } from '@/utils/stage6/bankFinancialPlan';
import type { Stage6SourceInputs } from '@/utils/stage6/bankFinancialPlanSource';
import { computeStage6FinancePlan } from '@/utils/stage6/financePlanPipeline';
import {
  FINANCE_PLAN_CALC_VERSION,
  buildStoredFinancePlan,
  type CalcSnapshotMeta,
  type FinancePlanDomain,
} from '@/utils/stage6/financePlanSnapshot';
import { markdownToBlocks } from './export/planExportDocument';
import { buildBankFinancialFacts } from './bankFinancialDocument';
import { BANK_TABLE_PLACEHOLDER, finalizeBankPlanText } from './bankFinancialText';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const STRATEGY = '33333333-3333-4333-8333-333333333333';
const NOW_YEAR = 2026;
const SAVED_AT = '2026-10-19T00:00:00.000Z';
const WARNING = '金額の単位をご確認ください';

const normalPL: FinancePLRow[] = [
  { year: 2025, revenue: 1_000_000_000, operatingIncome: 50_000_000, netIncome: 30_000_000, depreciation: 20_000_000, interest: 5_000_000, tax: 10_000_000 },
];
// 減価償却費と支払利息が、円の桁としては小さすぎる値（単位の疑い）
const suspectPL: FinancePLRow[] = [
  { year: 2025, revenue: 1_000_000_000, operatingIncome: 50_000_000, netIncome: 30_000_000, depreciation: 200, interest: 800, tax: 10_000_000 },
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
const domain: FinancePlanDomain = {
  assumptions,
  existingLoans: [
    { id: 'e1', name: 'A銀行', category: 'BANK', balanceYen: 300_000_000, annualRate: 0.02, scheduledPrincipalYen: { 2026: 30_000_000, 2027: 30_000_000, 2028: 30_000_000 } },
  ],
  newLoans: [],
  dividendsYen: {},
};
const companyTargets = [{ id: 't1', label: '売上高', unit: '百万円', dueYear: 2028, base: 1500, priority: 1 }];

function departments(): Department[] {
  return [
    {
      name: '営業部',
      projects: [
        {
          title: 'A社開拓',
          planStatus: 'approved',
          skillPlans: [{ id: 'sk1', skillName: '設備', cost: 30_000_000, spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2027-03' } }],
        },
      ],
    },
  ] as unknown as Department[];
}

function inputs(financePL: FinancePLRow[]): Stage6SourceInputs {
  return { financePL, financeBS, departments: departments(), fiscalYearEnd: '3', companyTargets, storedFinancePlan: undefined };
}

/** 保存時点の計算結果（同じ入力なら CURRENT になる） */
function savedFrom(src: Stage6SourceInputs): unknown {
  const c = computeStage6FinancePlan({
    financePL: src.financePL,
    financeBS: src.financeBS,
    departments: src.departments,
    fiscalYearEnd: src.fiscalYearEnd,
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
  return JSON.parse(JSON.stringify(buildStoredFinancePlan({ domain, companyId: COMPANY, meta, savedAt: SAVED_AT })));
}

function blockOf(src: Stage6SourceInputs, saved: unknown): BankFinancialPlanBlock {
  return buildBankFinancialPlanBlock({
    companyId: COMPANY,
    strategyId: STRATEGY,
    storedFinancePlan: saved,
    inputs: { ...src, storedFinancePlan: saved },
    currentYear: NOW_YEAR,
    computedAt: SAVED_AT,
  });
}

const FINANCE_CHAPTER = `## 4. 財務計画と返済可能性\n\n${BANK_TABLE_PLACEHOLDER}\n`;

describe('銀行向け計画書の単位の警告', () => {
  it('単位の疑いがなければ、警告は表示されない', () => {
    const src = inputs(normalPL);
    const block = blockOf(src, savedFrom(src));
    const facts = buildBankFinancialFacts(block);

    expect(block.status).toBe('CURRENT');
    expect(block.numbersConfirmed).toBe(true);
    expect(facts?.markdown).not.toContain(WARNING);
  });

  it('単位の疑いがあっても、確定の計算結果は表示したまま、断定しない警告を出す', () => {
    const src = inputs(suspectPL);
    const block = blockOf(src, savedFrom(src));
    const facts = buildBankFinancialFacts(block);

    expect(block.status).toBe('CURRENT');
    expect(block.numbersConfirmed).toBe(true);
    expect(block.sections?.cashFlow.unitSuspects.length).toBeGreaterThan(0);
    expect(facts?.usable).toBe(true);
    expect(facts?.markdown).toContain(WARNING);
    expect(facts?.markdown).toContain('減価償却費');
    expect(facts?.markdown).toContain('計算や計画書の作成を止めるものではありません');
    expect(facts?.markdown).not.toContain('単位不一致');
    expect(facts?.statusLines[0]).toContain('STAGE6の財務計画による計算結果です');
  });

  it('警告は本文の引用（Word・PDF・プレビューと同じ形式）として出力される', () => {
    const src = inputs(suspectPL);
    const block = blockOf(src, savedFrom(src));
    const facts = buildBankFinancialFacts(block);
    const blocks = JSON.stringify(markdownToBlocks(facts?.markdown ?? ''));

    expect(blocks).toContain(WARNING);
  });

  it('警告があっても、財務章への計画の挿入と生成は止まらない', () => {
    const src = inputs(suspectPL);
    const block = blockOf(src, savedFrom(src));
    const out = finalizeBankPlanText(FINANCE_CHAPTER, block);

    expect(out.check.applied).toBe(true);
    expect(out.check.usable).toBe(true);
    expect(out.check.placeholderFound).toBe(true);
    expect(out.text).toContain(WARNING);
    expect(out.text).not.toContain(BANK_TABLE_PLACEHOLDER);
  });

  it('参考値（保存後に元データが変わった場合）でも、警告は理由とは別に表示される', () => {
    const saved = savedFrom(inputs(normalPL));
    const block = blockOf(inputs(suspectPL), saved);
    const facts = buildBankFinancialFacts(block);

    expect(block.status).toBe('STALE');
    expect(block.statusReasons.some((r) => r.includes('単位不一致'))).toBe(false);
    expect(facts?.markdown).toContain(WARNING);
    expect(facts?.statusLines[0]).toContain('参考値');
  });
});
