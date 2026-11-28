/* 経営点検の評価用フィクスチャ（架空企業）。保存形式の行を組み立てる。実企業のデータは使わない。 */
import { FICTIONAL_STRATEGY_ROW } from './fictionalCompany';

export const RISK_NOW = new Date('2027-06-15T09:00:00+09:00');

export type RiskFixtureOptions = {
  /** 資金計画そのものが未保存なら 'none' */
  finance?: 'saved' | 'none';
  minCashYen?: number;
  /** 新規借入：行なし（未入力）・0円の行（明示的なゼロ）・金額の行 */
  newLoan?: 'none' | 'zero' | 'amount';
  /** 配当：未入力・0円（明示的なゼロ） */
  dividends?: 'none' | 'zero';
  stage6Target?: boolean;
  stage6RevenueTargetYen?: number;
  stage6OperatingIncomeTargetYen?: number;
  stage2Target?: boolean;
  krOverdue?: boolean;
  /** 実施事項の進捗：記録なし・最近更新・30日以上更新なし（進行中） */
  progress?: 'none' | 'recent' | 'stalled';
};

const DEFAULTS: Required<RiskFixtureOptions> = {
  finance: 'saved',
  minCashYen: 150_000_000,
  newLoan: 'zero',
  dividends: 'zero',
  stage6Target: true,
  stage6RevenueTargetYen: 1_000_000_000,
  stage6OperatingIncomeTargetYen: 70_000_000,
  stage2Target: false,
  krOverdue: false,
  progress: 'none',
};

export function riskStrategyFixture(options: RiskFixtureOptions = {}): Record<string, any> {
  const o = { ...DEFAULTS, ...options };
  const row = JSON.parse(JSON.stringify(FICTIONAL_STRATEGY_ROW)) as Record<string, any>;

  const sales = row.departments[0].projects[0];
  const mfg = row.departments[1].projects[0];
  if (o.krOverdue) {
    sales.okrsV2[0].actual = { value: 80 };
    mfg.okrsV2[0].due = '2027-01';
  } else {
    sales.okrsV2[0].due = '2028-03';
    mfg.okrsV2[0].due = '2028-01';
  }
  if (o.progress !== 'none') {
    mfg.executionProgress = {
      'action-1': {
        status: 'IN_PROGRESS',
        result: '',
        issue: '',
        nextAction: '',
        krIds: [],
        updatedAt: o.progress === 'stalled' ? '2026-10-01T00:00:00Z' : '2027-06-01T00:00:00Z',
      },
    };
  }

  row.companyTargets = o.stage2Target
    ? [
        { id: 't-revenue', label: '売上', unit: '円', dueYear: 2027, base: 1_000_000_000, linkedIssueIds: [], rationale: '架空の業績目標' },
        { id: 't-oi', label: '営業利益', unit: '円', dueYear: 2027, base: 70_000_000, linkedIssueIds: [], rationale: '架空の業績目標' },
      ]
    : [];

  if (o.finance === 'none') {
    delete row.csvFinanceData;
    return row;
  }

  const saved = row.csvFinanceData.financePlanAssumptions;
  const cash = saved.cashFlow;
  Object.assign(cash, { minCashYen: o.minCashYen, depreciationYen: 20_000_000, arRatio: 0.14, inventoryRatio: 0.077, apRatio: 0.085 });
  if (o.stage6Target) {
    Object.assign(cash, {
      targetRevenueYen: o.stage6RevenueTargetYen,
      targetOperatingIncomeYen: o.stage6OperatingIncomeTargetYen,
      targetYear: 2027,
    });
  } else {
    delete cash.targetRevenueYen;
    delete cash.targetOperatingIncomeYen;
    delete cash.targetYear;
  }
  saved.dividendsYen = o.dividends === 'zero' ? { 2026: 0, 2027: 0, 2028: 0 } : {};
  saved.existingLoans = [
    {
      id: 'loan-1',
      name: '長期借入金（架空）',
      category: 'BANK',
      balanceYen: 200_000_000,
      annualRate: 0.01,
      scheduledPrincipalYen: { 2026: 20_000_000, 2027: 20_000_000, 2028: 20_000_000 },
    },
  ];
  saved.newLoans =
    o.newLoan === 'none'
      ? []
      : [
          {
            id: 'new-1',
            name: '新規借入（架空）',
            drawYear: 2026,
            drawMonth: 4,
            amountYen: o.newLoan === 'zero' ? 0 : 50_000_000,
            annualRate: 0.01,
            termYears: 5,
            graceYears: 0,
            method: 'EQUAL_PRINCIPAL',
          },
        ];
  return row;
}
