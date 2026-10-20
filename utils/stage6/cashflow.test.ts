import { readFileSync } from 'fs';
import path from 'path';
import { buildCashFlowPlan, type CashFlowInput, type CfAssumptions } from './cashflow';

const NOW = 2026;

const basePL = [
  { year: 2024, revenue: 900_000_000, operatingIncome: 80_000_000, interest: 4_000_000, tax: 20_000_000, netIncome: 56_000_000, depreciation: 18_000_000 },
  { year: 2025, revenue: 1_000_000_000, operatingIncome: 100_000_000, interest: 5_000_000, tax: 28_500_000, netIncome: 66_500_000, depreciation: 20_000_000 },
];

const baseBS = [
  { year: 2024, cash: 250_000_000, ar: 135_000_000, inventory: 72_000_000, ap: 81_000_000 },
  { year: 2025, cash: 300_000_000, ar: 150_000_000, inventory: 80_000_000, ap: 90_000_000 },
];

const noInvestment = {
  yearlyByCategory: [],
  unclassifiedYen: 0,
  unscheduledYen: 0,
  candidateYen: 0,
  basisPendingYen: 0,
};

const noAssumptions: CfAssumptions = {
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

function input(overrides: Partial<CashFlowInput> = {}, assumptions: Partial<CfAssumptions> = {}): CashFlowInput {
  return {
    financePL: basePL,
    financeBS: baseBS,
    investment: noInvestment,
    assumptions: { ...noAssumptions, ...assumptions },
    horizonYears: 3,
    ...overrides,
  };
}

function yearOf(plan: ReturnType<typeof buildCashFlowPlan>, year: number) {
  const found = plan.years.find((y) => y.year === year);
  if (!found) throw new Error(`no year ${year}`);
  return found;
}

describe('営業キャッシュフローの計算', () => {
  it('税引後利益＋減価償却費−運転資金増加で営業CFを計算する', () => {
    const plan = buildCashFlowPlan(input(), NOW);
    const y = yearOf(plan, 2026);
    // 営業利益1億円−利息500万円＝税引前9,500万円、税率30%で税引後6,650万円
    expect(y.netIncome.value).toBeCloseTo(66_500_000, 0);
    expect(y.depreciation.value).toBe(20_000_000);
    expect(y.workingCapitalChange.value).toBeCloseTo(0, 0);
    expect(y.operatingCf.value).toBeCloseTo(86_500_000, 0);
  });

  it('減価償却費を加算する（0にすると営業CFが減る）', () => {
    const withDep = yearOf(buildCashFlowPlan(input(), NOW), 2026).operatingCf.value as number;
    const noDep = yearOf(buildCashFlowPlan(input({}, { depreciationYen: 0 }), NOW), 2026);
    expect(noDep.depreciation.value).toBe(0);
    expect(withDep - (noDep.operatingCf.value as number)).toBeCloseTo(20_000_000, 0);
  });

  it('売上増加に伴う運転資金増加を差し引く', () => {
    const plan = buildCashFlowPlan(input({}, { targetRevenueYen: 1_200_000_000, targetYear: 2027 }), NOW);
    const y26 = yearOf(plan, 2026);
    // 2026年の推計売上1.1億円×運転資金比率14%＝増加1,400万円
    expect(y26.revenue.value).toBeCloseTo(1_100_000_000, 0);
    expect(y26.workingCapitalChange.value).toBeCloseTo(14_000_000, 0);
    expect(y26.operatingCf.value).toBeCloseTo(66_500_000 + 20_000_000 - 14_000_000, 0);
  });

  it('税率が未指定なら、基準年度の法人税等から税率を求め、根拠を示す', () => {
    const plan = buildCashFlowPlan(input({}, { taxRate: null }), NOW);
    expect(plan.taxRate.basis).toBe('ESTIMATE');
    expect(plan.taxRate.value).toBeCloseTo(28_500_000 / 95_000_000, 6);
  });

  it('税率・税金の実績がどちらも無ければ、ゼロ税率とせず評価保留にする', () => {
    const pl = [{ year: 2025, revenue: 1_000_000_000, operatingIncome: 100_000_000, interest: 5_000_000, depreciation: 20_000_000 }];
    const plan = buildCashFlowPlan(input({ financePL: pl }, { taxRate: null }), NOW);
    expect(plan.taxRate.value).toBeNull();
    expect(yearOf(plan, 2026).operatingCf.value).toBeNull();
  });
});

describe('運転資金', () => {
  it('基準年度BSの比率を据え置いて将来の運転資金を推計する', () => {
    const plan = buildCashFlowPlan(input(), NOW);
    expect(plan.workingCapitalRatios.ar.value).toBeCloseTo(0.15, 6);
    expect(plan.workingCapitalRatios.inventory.value).toBeCloseTo(0.08, 6);
    expect(plan.workingCapitalRatios.ap.value).toBeCloseTo(0.09, 6);
    expect(yearOf(plan, 2026).workingCapital.value).toBeCloseTo(140_000_000, 0);
  });

  it('利用者が指定した比率はその値を使い、根拠を利用者指定とする', () => {
    const plan = buildCashFlowPlan(input({}, { arRatio: 0.2 }), NOW);
    expect(plan.workingCapitalRatios.ar.basis).toBe('USER');
    expect(plan.workingCapitalRatios.ar.value).toBe(0.2);
  });

  it('比率の算出に必要な実績が無ければ、値を捏造せず評価保留にする', () => {
    const bs = [{ year: 2025, cash: 300_000_000 }];
    const plan = buildCashFlowPlan(input({ financeBS: bs }), NOW);
    expect(plan.workingCapitalRatios.ar.value).toBeNull();
    expect(yearOf(plan, 2026).workingCapitalChange.value).toBeNull();
    expect(yearOf(plan, 2026).operatingCf.value).toBeNull();
  });

  it('履歴の運転資金比率を年度ごとに返す', () => {
    const plan = buildCashFlowPlan(input(), NOW);
    expect(plan.historicalWorkingCapital.map((h) => h.year)).toEqual([2024, 2025]);
    expect(plan.historicalWorkingCapital[1].ar).toBeCloseTo(0.15, 6);
  });
});

describe('投資キャッシュフローとOPEX', () => {
  const investment = {
    yearlyByCategory: [{ fiscalYear: 2026, CAPEX: 30_000_000, OPEX: 10_000_000, OTHER: 5_000_000 }],
    unclassifiedYen: 0,
    unscheduledYen: 0,
    candidateYen: 0,
    basisPendingYen: 0,
  };

  it('CAPEXの年度別集計を投資CFの支出として計上する', () => {
    const plan = buildCashFlowPlan(input({ investment }), NOW);
    const y = yearOf(plan, 2026);
    expect(y.capex.value).toBe(30_000_000);
    expect(y.investingCf.value).toBe(-30_000_000);
    expect(yearOf(plan, 2027).capex.value).toBe(0);
  });

  it('OPEXを営業CFから二重に控除しない（営業CFは投資データの有無で変わらない）', () => {
    const without = yearOf(buildCashFlowPlan(input(), NOW), 2026).operatingCf.value;
    const withOpex = yearOf(buildCashFlowPlan(input({ investment }), NOW), 2026).operatingCf.value;
    expect(withOpex).toBe(without);
    expect(yearOf(buildCashFlowPlan(input({ investment }), NOW), 2026).opexRegistered).toBe(10_000_000);
  });

  it('OTHERは投資CFに含めず、表示用に別途保持する', () => {
    const plan = buildCashFlowPlan(input({ investment }), NOW);
    const y = yearOf(plan, 2026);
    expect(y.otherRegistered).toBe(5_000_000);
    expect(y.investingCf.value).toBe(-30_000_000);
  });

  it('未分類・時期未設定・重複確認中は計算から除外し、制約として表示する', () => {
    const plan = buildCashFlowPlan(
      input({ investment: { ...investment, unclassifiedYen: 7_000_000, unscheduledYen: 3_000_000, candidateYen: 2_000_000 } }),
      NOW,
    );
    expect(yearOf(plan, 2026).capex.value).toBe(30_000_000);
    const message = plan.globalHolds.find((h) => h.includes('未確定の投資'));
    expect(message).toContain('分類未確定 7,000,000 円');
    expect(message).toContain('時期未設定 3,000,000 円');
    expect(message).toContain('重複確認中 2,000,000 円');
  });

  it('STAGE4に登録のない年度の投資支出は0と表示し、登録がないことを明示する', () => {
    const plan = buildCashFlowPlan(input({ investment }), NOW);
    expect(yearOf(plan, 2027).capex.note).toContain('登録なし');
  });
});

describe('FCF・年度末現預金・資金不足', () => {
  const investment = {
    yearlyByCategory: [{ fiscalYear: 2026, CAPEX: 30_000_000, OPEX: 0, OTHER: 0 }],
    unclassifiedYen: 0,
    unscheduledYen: 0,
    candidateYen: 0,
    basisPendingYen: 0,
  };

  it('FCF＝営業CF＋投資CF', () => {
    const y = yearOf(buildCashFlowPlan(input({ investment }), NOW), 2026);
    expect(y.fcf.value).toBeCloseTo(86_500_000 - 30_000_000, 0);
  });

  it('期末現預金（資金調達前）を期首＋営業CF＋投資CFで繰り越す', () => {
    const plan = buildCashFlowPlan(input({ investment }), NOW);
    const y26 = yearOf(plan, 2026);
    const y27 = yearOf(plan, 2027);
    expect(y26.openingCash.value).toBe(300_000_000);
    expect(y26.closingCashBeforeFinancing.value).toBeCloseTo(356_500_000, 0);
    expect(y27.openingCash.value).toBeCloseTo(356_500_000, 0);
    expect(y27.closingCashBeforeFinancing.value).toBeCloseTo(356_500_000 + 86_500_000, 0);
  });

  it('最低必要現預金を下回る年度で資金不足額を判定する', () => {
    const plan = buildCashFlowPlan(input({ investment }, { minCashYen: 400_000_000 }), NOW);
    expect(yearOf(plan, 2026).shortfall.value).toBeCloseTo(43_500_000, 0);
    expect(yearOf(plan, 2027).shortfall.value).toBe(0);
    expect(yearOf(plan, 2026).shortfall.note).toContain('参考値');
  });

  it('最低必要現預金が未入力なら不足額は評価保留にする', () => {
    const plan = buildCashFlowPlan(input({ investment }), NOW);
    expect(yearOf(plan, 2026).shortfall.value).toBeNull();
    expect(plan.globalHolds.some((h) => h.includes('最低必要現預金が未入力'))).toBe(true);
  });
});

describe('未入力値とゼロの区別', () => {
  it('減価償却費が未入力なら0として扱わず、営業CFを保留にする', () => {
    const pl = basePL.map((r) => ({ ...r, depreciation: undefined }));
    const plan = buildCashFlowPlan(input({ financePL: pl }), NOW);
    const y = yearOf(plan, 2026);
    expect(y.depreciation.value).toBeNull();
    expect(y.operatingCf.value).toBeNull();
    expect(y.holds.some((h) => h.includes('減価償却費'))).toBe(true);
  });

  it('支払利息が未入力なら税引前利益を算出せず保留にする', () => {
    const pl = basePL.map((r) => ({ ...r, interest: undefined }));
    const plan = buildCashFlowPlan(input({ financePL: pl }), NOW);
    expect(yearOf(plan, 2026).netIncome.value).toBeNull();
    expect(yearOf(plan, 2026).closingCashBeforeFinancing.value).toBeNull();
  });

  it('保留の年度が出た後の年度も連鎖して保留になり、値を埋めない', () => {
    const pl = basePL.map((r) => ({ ...r, depreciation: undefined }));
    const plan = buildCashFlowPlan(input({ financePL: pl }, { minCashYen: 1 }), NOW);
    expect(yearOf(plan, 2026).closingCashBeforeFinancing.value).toBeNull();
    expect(yearOf(plan, 2027).openingCash.value).toBeNull();
    expect(yearOf(plan, 2027).shortfall.value).toBeNull();
  });
});

describe('単位不一致とPL・BSの年度不一致', () => {
  it('売上高に対して桁の小さすぎる値があれば、単位不一致の疑いとして全体を評価保留にする', () => {
    const pl = [{ ...basePL[1], netIncome: 66 }];
    const plan = buildCashFlowPlan(input({ financePL: pl }), NOW);
    expect(plan.unitSuspects.length).toBeGreaterThan(0);
    expect(plan.globalHolds.some((h) => h.includes('単位不一致の疑い'))).toBe(true);
    expect(yearOf(plan, 2026).fcf.value).toBeNull();
    expect(yearOf(plan, 2026).revenue.value).toBeNull();
  });

  it('同じ桁の値（円）だけなら単位不一致とはしない', () => {
    const plan = buildCashFlowPlan(input(), NOW);
    expect(plan.unitSuspects).toEqual([]);
  });

  it('PLとBSの基準年度が異なる場合は、その事実を表示し、同一年として推計しない', () => {
    const plan = buildCashFlowPlan(input({ financeBS: [baseBS[0]] }), NOW);
    expect(plan.yearMismatch).toBe(true);
    expect(plan.bsBaseYear).toBe(2024);
    expect(plan.globalHolds.some((h) => h.includes('基準年度') && h.includes('異なる'))).toBe(true);
    expect(yearOf(plan, 2026).operatingCf.value).toBeNull();
  });

  it('推計シナリオの目標年度が基準年度以前なら評価保留にする', () => {
    const plan = buildCashFlowPlan(input({}, { targetRevenueYen: 1_200_000_000, targetYear: 2025 }), NOW);
    expect(plan.globalHolds.some((h) => h.includes('目標年度'))).toBe(true);
  });
});

describe('推計シナリオの表示', () => {
  it('シナリオ未指定は横ばいとして明示し、利用者指定は正式な目標ではないと明示する', () => {
    expect(buildCashFlowPlan(input(), NOW).scenario.basis).toBe('ESTIMATE');
    const user = buildCashFlowPlan(input({}, { targetRevenueYen: 1_200_000_000, targetYear: 2027 }), NOW);
    expect(user.scenario.basis).toBe('USER');
    expect(user.scenario.note).toContain('正式な目標ではありません');
  });

  it('推計値は基準年度の実績と区別できる根拠を持つ', () => {
    const plan = buildCashFlowPlan(input(), NOW);
    expect(yearOf(plan, 2025).kind).toBe('ACTUAL');
    expect(yearOf(plan, 2026).kind).toBe('FORECAST');
    expect(yearOf(plan, 2026).operatingCf.basis).toBe('ESTIMATE');
  });
});

describe('既存STAGE6計算への非干渉と分離', () => {
  it('キャッシュフロー計算は既存のSTAGE6計算・ストアを読み込まない', () => {
    const source = readFileSync(path.join(__dirname, 'cashflow.ts'), 'utf8');
    const imports = source.split('\n').filter((l) => l.startsWith('import'));
    for (const line of imports) {
      expect(line).not.toMatch(/compute|baseline|useStage6Data|simulationBridge|financeSimulation|strategyStore/);
    }
  });

  it('入力に含まれない年度の投資は計上されず、年度をまたいで混ざらない', () => {
    const plan = buildCashFlowPlan(
      input({
        investment: {
          yearlyByCategory: [
            { fiscalYear: 2027, CAPEX: 9_000_000, OPEX: 0, OTHER: 0 },
          ],
          unclassifiedYen: 0,
          unscheduledYen: 0,
          candidateYen: 0,
          basisPendingYen: 0,
        },
      }),
      NOW,
    );
    expect(yearOf(plan, 2026).capex.value).toBe(0);
    expect(yearOf(plan, 2027).capex.value).toBe(9_000_000);
  });

  it('基準年度より後のデータ（現在年より未来）は使用しない', () => {
    const futurePL = [...basePL, { year: 2030, revenue: 9_999_000_000, operatingIncome: 1 }];
    const plan = buildCashFlowPlan(input({ financePL: futurePL }), NOW);
    expect(plan.baseYear).toBe(2025);
  });
});
