import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { buildFinanceOutlook } from './financeOutlook';

/* 手計算の前提（架空、百万円）
 * 基準：2024年度 売上 1,000・営業利益 70（直近実績）。予測 2025〜2027年度（決算月3月）
 * A 売上増加：年額60、営業利益の増分 年額10（2025年4月開始）→ 2026年度から
 * B 費用削減：月額1（2025年4月〜）→ 12/年
 * C 追加費用：月額0.5（2026年4月〜）→ 2027年度から6
 * 未確認の施策 D（売上 +100）は一切加算しない
 */
const M = 1_000_000;
const PL: FinancePLRow[] = [{ year: 2024, revenue: 1_000 * M, operatingIncome: 70 * M, interest: 0 }];
const BS: FinanceBSRow[] = [{ year: 2024, cash: 100 * M, ar: 150 * M, inventory: 50 * M, ap: 80 * M }];
const eff = (over: Record<string, unknown>) => ({ confirmed: true, sourceNote: '見積書（架空）', source: 'USER_INPUT', ...over });
const DEPTS = [
  {
    id: 'd1',
    name: '営業部',
    projects: [
      { id: 'A', title: '新規開拓', financeEffect: eff({ kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 60 * M, amountBasis: 'ANNUAL', startYm: '2025-04', operatingIncomeEffectYen: 10 * M }) },
      { id: 'B', title: '工程改善', financeEffect: eff({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1 * M, amountBasis: 'MONTHLY', startYm: '2025-04' }) },
      { id: 'C', title: '人員増', financeEffect: eff({ kind: 'COST_INCREASE', method: 'DIRECT_AMOUNT', directAmountYen: 0.5 * M, amountBasis: 'MONTHLY', startYm: '2026-04' }) },
      { id: 'D', title: '未確認', financeEffect: eff({ kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 100 * M, amountBasis: 'ANNUAL', startYm: '2025-04', operatingIncomeEffectYen: 30 * M, confirmed: false }) },
    ],
  },
] as unknown as Department[];

const outlook = buildFinanceOutlook({
  financePL: PL,
  financeBS: BS,
  departments: DEPTS,
  fiscalYearEnd: '3',
  companyTargets: [],
  domain: null,
  currentYear: 2025,
});

describe('STAGE6グラフ・プロジェクト別一覧・試算の値が一致する', () => {
  it('グラフの施策効果（施策反映後−既存事業）は、統一試算の年度合計と一致する', () => {
    for (const row of outlook.unifiedPl.years) {
      const trialYear = outlook.effectTrial.years.find((y) => y.fiscalYear === row.fiscalYear)!;
      expect((row.plan.revenueYen ?? 0) - (row.baseline.revenueYen ?? 0)).toBe(trialYear.revenueYen);
      if (row.plan.operatingIncomeYen !== null && row.baseline.operatingIncomeYen !== null) {
        expect(row.plan.operatingIncomeYen - row.baseline.operatingIncomeYen).toBe(
          (trialYear.revenueOperatingIncomeYen ?? 0) + trialYear.costReductionYen - trialYear.costIncreaseYen,
        );
      }
    }
  });

  it('プロジェクト別一覧の年度別金額は、試算の年度合計と一致する（未確認のDは含まない）', () => {
    const reflected = outlook.effectTrial.projects.filter((p) => p.status === 'REFLECTED');
    expect(outlook.effectTrial.projects.find((p) => p.projectTitle === '未確認')!.status).toBe('DRAFT');
    for (const trialYear of outlook.effectTrial.years) {
      const revenue = reflected.reduce((sum, p) => sum + (p.years.find((y) => y.fiscalYear === trialYear.fiscalYear)!.revenueYen ?? 0), 0);
      expect(revenue).toBe(trialYear.revenueYen);
    }
    const fy2026 = outlook.unifiedPl.years.find((y) => y.fiscalYear === 2026)!;
    expect(fy2026.plan.revenueYen).toBe(1_060 * M);
    expect(fy2026.plan.operatingIncomeYen).toBe((70 + 10 + 12) * M);
    expect(fy2026.plan.operatingExpenseYen).toBe((1_060 - 92) * M);
  });

  it('未確認の施策（D）は、グラフにも一覧の金額にも入らない', () => {
    const fy2027 = outlook.unifiedPl.years.find((y) => y.fiscalYear === 2027)!;
    expect(fy2027.plan.revenueYen).toBe(1_060 * M);
    expect(fy2027.plan.operatingIncomeYen).toBe((70 + 10 + 12 - 6) * M);
  });
});
