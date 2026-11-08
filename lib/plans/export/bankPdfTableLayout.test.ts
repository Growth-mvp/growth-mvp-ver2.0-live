import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import type { CfAssumptions } from '@/utils/stage6/cashflow';
import { buildBankFinancialPlanBlock, type BankFinancialPlanBlock } from '@/utils/stage6/bankFinancialPlan';
import { computeStage6FinancePlan } from '@/utils/stage6/financePlanPipeline';
import { FINANCE_PLAN_CALC_VERSION, buildStoredFinancePlan, type CalcSnapshotMeta, type FinancePlanDomain } from '@/utils/stage6/financePlanSnapshot';
import { buildBankFinancialFacts } from '../bankFinancialDocument';
import { buildPlanExportDocument } from './planExportDocument';
import { buildPlanPdfDefinition } from './toPdf';

const revenueEffect = (mjpy: number) => ({
  kind: 'REVENUE_UP',
  method: 'DIRECT_AMOUNT',
  directAmountYen: mjpy * 1_000_000,
  amountBasis: 'ANNUAL',
  startYm: '2026-04',
  sourceNote: '架空',
  source: 'USER_INPUT',
  confirmed: true,
});

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
const domain: FinancePlanDomain = {
  assumptions,
  existingLoans: [
    {
      id: 'e1',
      name: 'A銀行',
      category: 'BANK',
      balanceYen: 300_000_000,
      annualRate: 0.02,
      scheduledPrincipalYen: { 2026: 30_000_000, 2027: 30_000_000, 2028: 30_000_000 },
    },
  ],
  newLoans: [],
  dividendsYen: {},
};
const departments = [
  {
    name: '営業部',
    projects: [
      {
        title: 'A社開拓',
        planStatus: 'approved',
        financeEffect: revenueEffect(120),
        skillPlans: [
          { id: 'sk1', skillName: '設備', cost: 30_000_000, spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2027-03' } },
        ],
      },
    ],
  },
] as unknown as Department[];

/** 保存済みの財務計画と同じ前提で、銀行向け計画の表示（財務表と付録）を作る */
function bankFacts() {
  const inputs = { financePL, financeBS, departments, fiscalYearEnd: '3', companyTargets: [] as unknown[], storedFinancePlan: undefined };
  const c = computeStage6FinancePlan({
    financePL,
    financeBS,
    departments,
    fiscalYearEnd: '3',
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
  const saved = JSON.parse(JSON.stringify(buildStoredFinancePlan({ domain, companyId: COMPANY, meta, savedAt: SAVED_AT })));
  const block: BankFinancialPlanBlock = buildBankFinancialPlanBlock({
    companyId: COMPANY,
    strategyId: STRATEGY,
    storedFinancePlan: saved,
    inputs: { ...inputs, storedFinancePlan: saved },
    currentYear: NOW_YEAR,
    computedAt: SAVED_AT,
  });
  return buildBankFinancialFacts(block)!;
}

type PdfTable = { widths: number[]; body: Array<Array<Record<string, unknown>>> };

function pdfTables(def: Record<string, unknown>): PdfTable[] {
  const content = def.content as Array<Record<string, unknown>>;
  return content.filter((c) => 'table' in c).map((c) => c.table as PdfTable);
}

function cellText(cell: Record<string, unknown>): string {
  const text = cell.text;
  if (typeof text === 'string') return text;
  if (Array.isArray(text)) return text.map((run) => (run as { text?: string }).text ?? '').join('');
  return '';
}

/** 太字9ptの見出しの幅（全角9pt、半角5pt）。折り返しが起きないかの目安に使う */
function headingWidthPt(text: string): number {
  return [...text].reduce((w, ch) => w + (/[\x00-\x7F]/.test(ch) ? 5 : 9), 0);
}

describe('銀行向け財務表のレイアウト（PDFの定義で確認）', () => {
  it('各表の見出しは列の幅に収まる（折り返しを減らす）', () => {
    const facts = bankFacts();
    const doc = buildPlanExportDocument({
      audience: 'bank',
      companyName: 'テスト株式会社',
      generatedAt: '2026-11-07T00:00:00.000Z',
      markdown: facts.markdown + '\n\n' + facts.appendixMarkdown,
    });
    const tables = pdfTables(buildPlanPdfDefinition(doc));
    expect(tables.length).toBeGreaterThanOrEqual(5);
    for (const table of tables) {
      table.body[0].forEach((cell, i) => {
        expect(table.widths[i]).toBeGreaterThanOrEqual(headingWidthPt(cellText(cell)) * 0.9);
      });
    }
  });

  it('株主・社員向けの表の幅は従来どおり（銀行向けの幅の指定を付けない）', () => {
    const markdown = '| 項目 | 金額 |\n| --- | --- |\n| 売上高 | 120百万円 |';
    for (const audience of ['shareholder', 'employee'] as const) {
      const doc = buildPlanExportDocument({ audience, companyName: 'テスト株式会社', generatedAt: '2026-11-07T00:00:00.000Z', markdown });
      const table = doc.blocks.find((b) => b.type === 'table');
      expect(table && 'weights' in table).toBe(false);
    }
  });

  it('金額・比率を含む表は、単位の注記と単位の分かる見出しで出力される', () => {
    const facts = bankFacts();
    const doc = buildPlanExportDocument({
      audience: 'bank',
      companyName: 'テスト株式会社',
      generatedAt: '2026-11-07T00:00:00.000Z',
      markdown: facts.markdown,
    });
    const text = JSON.stringify(buildPlanPdfDefinition(doc));
    expect(text).toContain('単位：百万円');
    expect(text).toContain('DSCR（倍）');
    expect(text).toContain('前年比（差額：百万円／率：%）');
  });
});
