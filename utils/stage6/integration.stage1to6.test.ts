import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { buildDbRowFromState, buildStateFromDbRow } from '@/utils/supabase/strategy';
import { buildCashFlowPlan, type CfAssumptions, type CashFlowInput, type CashFlowPlan } from './cashflow';
import { buildFinanceEffectTrial, withoutTargetPath } from './financeEffectPlan';
import { buildConditionalCashFlow, type ConditionalCf } from './conditionalCf';
import { buildUnifiedPl, type PlTarget, type UnifiedPl } from './unifiedPl';

/*
 * 架空企業「テスト商事」の一貫データ（単位：百万円。計算は円で入力）
 * STAGE1 財務実績（FY2025・決算3月）：売上 1,000、営業利益 70、支払利息 2、減価償却費 10
 *   BS：現預金 200、売掛金 100、棚卸資産 50、買掛金 80
 *   税率 30%（利用者入力）
 * STAGE2 経営目標：売上 1,200、営業利益 80（期限 FY2028）
 * STAGE4 施策：
 *   営業部／新規開拓：売上増加 60/年（2026年4月開始・確認済み）。旧北極星の手動金額（売上 20）を保持
 *   製造部／工程改善：費用削減 0.5/月（2025年10月〜2026年9月・確認済み）。旧北極星の手動金額（売上 50）を保持
 *   製造部／設備保守の外注：追加費用 30（2026年1月〜6月）・未確認（下書き）
 * STAGE5 KR実績：工程改善の KR「不良率」に実績 0.8（目標 0.5）を記録
 *
 * 手計算の基準（横ばい）：営業CF 57.6（税引後47.6＋減価償却10）、期末 257.6 → 315.2 → 372.8
 */
const M = 1_000_000;
const YEARS = [2026, 2027, 2028];

const STAGE1_PL = [
  { year: 2024, revenue: 960 * M, operatingIncome: 66 * M, depreciation: 9 * M, interest: 2 * M },
  { year: 2025, revenue: 1_000 * M, operatingIncome: 70 * M, depreciation: 10 * M, interest: 2 * M },
] as FinancePLRow[];
const STAGE1_BS = [
  { year: 2024, cash: 190 * M, ar: 96 * M, inventory: 48 * M, ap: 76 * M },
  { year: 2025, cash: 200 * M, ar: 100 * M, inventory: 50 * M, ap: 80 * M },
] as FinanceBSRow[];
const NO_INVESTMENT: CashFlowInput['investment'] = { yearlyByCategory: [], unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 };
const ASSUMPTIONS: CfAssumptions = {
  minCashYen: null,
  taxRate: 0.3,
  depreciationYen: null,
  arRatio: null,
  inventoryRatio: null,
  apRatio: null,
  targetRevenueYen: null,
  targetOperatingIncomeYen: null,
  targetYear: null,
};
const TARGET: PlTarget = { revenueYen: 1_200 * M, operatingIncomeYen: 80 * M, dueYear: 2028 };

const confirmed = (over: Record<string, unknown>) => ({ confirmed: true, sourceNote: '見積書（架空）', source: 'USER_INPUT', ...over });
const EFFECT_REVENUE = confirmed({ kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 60 * M, amountBasis: 'ANNUAL', startYm: '2026-04' });
const EFFECT_COST_REDUCTION = confirmed({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 500_000, amountBasis: 'MONTHLY', startYm: '2025-10', endYm: '2026-09' });
const EFFECT_DRAFT_COST = { kind: 'COST_INCREASE', method: 'DIRECT_AMOUNT', directAmountYen: 30 * M, amountBasis: 'TOTAL', startYm: '2026-01', endYm: '2026-06', source: 'USER_INPUT', confirmed: false, sourceNote: '見積書（架空）' };

function companyDepartments(opts: { includeRevenueUp?: boolean; kr?: Record<string, unknown> } = {}): Department[] {
  const kr = { id: 'kr-defect', kind: 'QUALITY', label: '不良率', target: 0.5, unit: '%', scope: 'company', baseKey: 'quality', ...(opts.kr ?? {}) };
  const sales = opts.includeRevenueUp === false ? [] : [{ id: 'p-sales', title: '新規開拓', projectUid: 'uid-sales', impactRevenueMJPY: 20, financeEffect: EFFECT_REVENUE }];
  return [
    { id: 'd-sales', name: '営業部', projects: sales },
    {
      id: 'd-mfg',
      name: '製造部',
      projects: [
        { id: 'p-cost', title: '工程改善', projectUid: 'uid-cost', impactRevenueMJPY: 50, financeEffect: EFFECT_COST_REDUCTION, okrsV2: [kr] },
        { id: 'p-outsource', title: '設備保守の外注', projectUid: 'uid-outsource', financeEffect: EFFECT_DRAFT_COST },
      ],
    },
  ] as unknown as Department[];
}

function computeAll(departments: Department[], opts: { target?: PlTarget | null; pl?: FinancePLRow[]; bs?: FinanceBSRow[]; assumptions?: CfAssumptions } = {}) {
  const assumptions = withoutTargetPath(opts.assumptions ?? ASSUMPTIONS);
  const baseline: CashFlowPlan = buildCashFlowPlan(
    { financePL: opts.pl ?? STAGE1_PL, financeBS: opts.bs ?? STAGE1_BS, investment: NO_INVESTMENT, assumptions, fiscalYearEndSet: true },
    2025,
  );
  const trial = buildFinanceEffectTrial({ departments, fiscalYearEnd: '3', fiscalYears: YEARS });
  const forecast = baseline.years.filter((y) => y.kind === 'FORECAST');
  const unified: UnifiedPl = buildUnifiedPl({
    baseline: forecast.map((y) => ({ fiscalYear: y.year, revenueYen: y.revenue.value, operatingIncomeYen: y.operatingIncome.value })),
    effects: trial.years,
    target: opts.target === undefined ? TARGET : opts.target,
  });
  const cf: ConditionalCf = buildConditionalCashFlow({ baseline, unified });
  return { baseline, trial, unified, cf };
}

const mil = (x: number | null) => (x === null ? null : Math.round((x / M) * 100) / 100);
const milAll = (xs: (number | null)[]) => xs.map(mil);

describe('統合1：STAGE1の確定実績は、計算と保存・読込の前後で変わらない', () => {
  it('計算の前後で財務PL・BSが同一（改変なし）', () => {
    const pl = structuredClone(STAGE1_PL);
    const bs = structuredClone(STAGE1_BS);
    computeAll(companyDepartments(), { pl, bs });
    expect(pl).toEqual(STAGE1_PL);
    expect(bs).toEqual(STAGE1_BS);
  });
});

describe('統合2：経営目標は予測に加算されない', () => {
  it('目標あり・なしで、統一PLの売上・営業利益・条件付きCFは同一（目標は差額の比較にだけ使う）', () => {
    const withT = computeAll(companyDepartments(), { target: TARGET });
    const withoutT = computeAll(companyDepartments(), { target: null });
    expect(withT.unified.years).toEqual(withoutT.unified.years);
    expect(withT.cf.years).toEqual(withoutT.cf.years);
    // 手計算：FY2028 の売上は 基準 1,000 + 売上増加 60 = 1,060（目標 1,200 は足さない）
    expect(mil(withT.unified.years[2].plan.revenueYen)).toBe(1_060);
    // 差額 ＝ 目標 1,200 − 試算 1,060 = 140
    expect(withT.unified.gap?.revenueYen).toBe(140 * M);
  });
});

describe('統合3：施策効果は年度・決算月に正しく割り付く', () => {
  it('費用削減（2025/10〜2026/9）は FY2026 に3、FY2027 に3、FY2028 は0（決算3月）', () => {
    const { trial } = computeAll(companyDepartments());
    expect(milAll(trial.years.map((y) => y.costReductionYen))).toEqual([3, 3, 0]);
  });

  it('売上増加（2026/4開始・年額60）は FY2026 に 0（FY2026は2025年4月〜2026年3月）、FY2027・FY2028 に 60', () => {
    const { trial } = computeAll(companyDepartments());
    expect(milAll(trial.years.map((y) => y.revenueYen))).toEqual([0, 60, 60]);
  });
});

describe('統合4：STAGE5のKR実績・進捗は財務効果に換算されない', () => {
  it('KRの実績を変えても、統一PL・条件付きCFは同一', () => {
    const a = computeAll(companyDepartments({ kr: { actual: { value: 0.8, asOf: '2026-10', recordedAt: '2026-11-03T00:00:00.000Z' } } }));
    const b = computeAll(companyDepartments({ kr: { actual: { value: 0.3, asOf: '2026-11', recordedAt: '2026-11-04T00:00:00.000Z' }, executionWeight: 0.1 } }));
    expect(b.unified).toEqual(a.unified);
    expect(b.cf).toEqual(a.cf);
    expect(b.trial).toEqual(a.trial);
  });
});

describe('統合5：旧北極星の手動金額とfinanceEffectを二重計上しない', () => {
  it('売上は 1,000 に売上増加 60 だけを足す（旧金額 20・50 は入らない）。利益は費用削減の 3 だけ', () => {
    const { unified } = computeAll(companyDepartments({ includeRevenueUp: false }));
    // 営業部の売上増加を外した場合：FY2026 売上1,000、営業利益 73（費用削減3）
    expect(mil(unified.years[0].plan.revenueYen)).toBe(1_000);
    expect(mil(unified.years[0].plan.operatingIncomeYen)).toBe(73);
    expect(mil(unified.years[1].plan.operatingIncomeYen)).toBe(73);
  });

  it('売上増加あり：FY2027 の売上は 1,060（旧金額 20 を足さない）', () => {
    const { unified } = computeAll(companyDepartments());
    expect(mil(unified.years[1].plan.revenueYen)).toBe(1_060);
    expect(unified.years[1].plan.operatingIncomeYen).toBeNull();
  });
});

describe('統合6：PL・CF・期末現預金が同じ前提で整合する', () => {
  it('売上増加なし：営業CF・期末の差は PL の営業利益差 × (1 − 30%) の累計（独立の手計算）', () => {
    const { baseline, unified, cf } = computeAll(companyDepartments({ includeRevenueUp: false }));
    // 手計算：利益差 +3（FY2026・27）→ 税引後 +2.1、FY2028 は 0
    expect(milAll(cf.years.map((y) => y.operatingCf.conditionalYen))).toEqual([59.7, 59.7, 57.6]);
    expect(milAll(cf.years.map((y) => y.closingCashYen))).toEqual([259.7, 319.4, 377]);
    // PL の営業利益差から CF 差を再計算して一致
    const baseOi = baseline.years.filter((y) => y.kind === 'FORECAST').map((y) => y.operatingIncome.value as number);
    cf.years.forEach((y, i) => {
      const dOi = (unified.years[i].plan.operatingIncomeYen as number) - baseOi[i];
      expect(Math.abs((y.operatingCf.deltaYen as number) - dOi * 0.7)).toBeLessThan(1);
    });
  });

  it('期末現預金の恒等式：期末 = 期首 + 営業CF + 投資CF（借入計画なし）', () => {
    const { cf } = computeAll(companyDepartments({ includeRevenueUp: false }));
    cf.years.forEach((y) => {
      expect(y.closingCashYen).toBe((y.openingCashYen as number) + (y.operatingCf.conditionalYen as number) + (y.investingCfYen as number));
    });
  });

  it('売上増加あり：FY2026 は確定、FY2027 以降は営業利益未算定のため営業CF・期末も未算定（推測しない）', () => {
    const { cf } = computeAll(companyDepartments());
    expect(mil(cf.years[0].closingCashYen)).toBe(259.7);
    expect(cf.years[1].operatingCf.conditionalYen).toBeNull();
    expect(cf.years[1].closingCashYen).toBeNull();
    expect(cf.years[2].closingCashYen).toBeNull();
  });
});

describe('統合7：保存・再読込のモック経路で、企業・施策・KRのデータが混在しない', () => {
  const stateOf = (name: string, companyId: string, departments: Department[], pl: FinancePLRow[], bs: FinanceBSRow[], targets: unknown[]) =>
    ({
      id: `strategy-${companyId}`,
      company_id: companyId,
      companyName: name,
      fiscalYearEnd: '3',
      departments,
      financePL: pl,
      csvFinanceData: { financeBS: bs },
      companyTargets: targets,
      finalStoryFinal: [{ title: '第1章', body: `${name}の確定文章` }],
      simulationResults: [{ id: `sim-${companyId}`, created_at: '2026-10-01T00:00:00.000Z', title: name, scenario_id: null, payload: {} }],
      stage3_strategy_bridge: { keyThemes: [`${name}のテーマ`] },
    }) as any;

  const roundTrip = (state: any) => buildStateFromDbRow(JSON.parse(JSON.stringify(buildDbRowFromState(state)))) as any;

  it('企業A・Bを順に保存・再読込しても、各企業の施策・KR・財務効果・計算結果がそのまま残り、混ざらない', () => {
    const stateA = stateOf('テスト商事', 'company-a', companyDepartments(), STAGE1_PL, STAGE1_BS, [{ id: 'rev', label: '売上', unit: '百万円', base: 1200, dueYear: 2028 }]);
    const stateB = stateOf('別会社', 'company-b', [{ id: 'd-x', name: '別部署', projects: [{ id: 'p-x', title: '別施策', projectUid: 'uid-x', financeEffect: EFFECT_COST_REDUCTION }] }] as unknown as Department[], STAGE1_PL, STAGE1_BS, []);

    const beforeA = computeAll(stateA.departments);
    const restoredA = roundTrip(stateA);
    const restoredB = roundTrip(stateB);

    // 企業Aの施策・KR・財務効果は往復で同じ
    const pA = restoredA.departments.flatMap((d: any) => d.projects);
    expect(pA.map((p: any) => p.projectUid)).toEqual(['uid-sales', 'uid-cost', 'uid-outsource']);
    expect(pA.find((p: any) => p.projectUid === 'uid-cost').financeEffect).toEqual(EFFECT_COST_REDUCTION);
    expect(pA.find((p: any) => p.projectUid === 'uid-cost').okrsV2[0]).toMatchObject({ id: 'kr-defect', label: '不良率', target: 0.5 });

    // 再読込後の計算結果は保存前と同じ
    const afterA = computeAll(restoredA.departments, { target: TARGET, pl: restoredA.financePL, bs: restoredA.csvFinanceData.financeBS });
    expect(afterA.unified).toEqual(beforeA.unified);
    expect(afterA.cf).toEqual(beforeA.cf);

    // 企業Bの施策は企業Aに混ざらない・企業Aの施策は企業Bに混ざらない
    const pB = restoredB.departments.flatMap((d: any) => d.projects);
    expect(pB.map((p: any) => p.projectUid)).toEqual(['uid-x']);
    expect(pA.some((p: any) => p.projectUid === 'uid-x')).toBe(false);
    expect(pB.some((p: any) => p.projectUid === 'uid-cost')).toBe(false);

    // 確定文章・シミュレーション履歴・橋渡しも企業ごとに残る
    expect(restoredA.finalStoryFinal[0].body).toBe('テスト商事の確定文章');
    expect(restoredB.finalStoryFinal[0].body).toBe('別会社の確定文章');
    expect(restoredA.simulationResults[0].id).toBe('sim-company-a');
    expect(restoredB.simulationResults[0].id).toBe('sim-company-b');
    expect(restoredA.stage3_strategy_bridge.keyThemes).toEqual(['テスト商事のテーマ']);
  });
});
