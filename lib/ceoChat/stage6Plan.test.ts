import { buildStage6PlanBlock, buildCashPositionBlock, latestActual } from './stage6Plan';
import { buildStoredFinancePlan, FINANCE_PLAN_CALC_VERSION, type FinancePlanDomain } from '@/utils/stage6/financePlanSnapshot';
import { formatAmount } from './stage1Blocks';
import { FICTIONAL_STRATEGY_ROW, FICTIONAL_COMPANY_ID } from '../../eval/quality/fictionalCompany';

const COMPANY_A = FICTIONAL_COMPANY_ID;
const COMPANY_B = 'company-b';
const CURRENT_YEAR = 2026;

const PL = FICTIONAL_STRATEGY_ROW.financePL;
const BS = FICTIONAL_STRATEGY_ROW.financeBS;

function storedFor(companyId: string, domain?: Partial<FinancePlanDomain['assumptions']>) {
  return buildStoredFinancePlan({
    domain: {
      assumptions: {
        minCashYen: 150_000_000,
        taxRate: 0.3,
        depreciationYen: null,
        arRatio: null,
        inventoryRatio: null,
        apRatio: null,
        targetRevenueYen: 1_000_000_000,
        targetOperatingIncomeYen: 70_000_000,
        targetYear: 2027,
        ...domain,
      },
      existingLoans: [],
      newLoans: [],
      dividendsYen: {},
    },
    companyId,
    savedAt: '2026-10-20T00:00:00Z',
    meta: {
      calcVersion: FINANCE_PLAN_CALC_VERSION,
      companyId,
      baseYear: 2025,
      bsBaseYear: 2025,
      assumptionsHash: 'a',
      sourceHash: 's',
      unconfirmed: { unapprovedReadyYen: 0, unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
      computedAt: '2026-10-20T00:00:00Z',
    },
  });
}

function block(overrides: Partial<Parameters<typeof buildStage6PlanBlock>[0]> = {}) {
  return buildStage6PlanBlock({
    csvFinanceData: { financePlanAssumptions: storedFor(COMPANY_A) },
    companyId: COMPANY_A,
    financePL: PL,
    financeBS: BS,
    departments: [],
    fiscalYearEnd: '3',
    currentYear: CURRENT_YEAR,
    simulationResults: [],
    ...overrides,
  });
}

describe('実績・目標・予測の区分（Q2・Q5の誤りの再現と防止）', () => {
  it('目標年以降の登録目標を「予測」として出さない（年度（予測）の行が無い）', () => {
    const text = block();
    expect(text).not.toMatch(/年度（予測）/);
  });

  it('登録目標は「目標（経営者が登録）」として出す', () => {
    const text = block();
    expect(text).toContain(`目標（経営者が登録）：2027年度 売上 ${formatAmount(1_000_000_000)}｜営業利益 ${formatAmount(70_000_000)}`);
  });

  it('独立した予測が無いことを「予測未算出」と明示する', () => {
    const text = block();
    expect(text).toContain('予測未算出');
    expect(text).toContain('目標年以降の値は目標そのものであり、予測として扱わないこと');
  });

  it('期末現預金の予測は未算出で、現在の実績とは別の区分にする（Q5）', () => {
    const text = block();
    expect(text).toContain('期末現預金の予測：未算出');
    expect(text).toContain('現在の実績とは別の区分');
  });

  it('実績は STAGE1 の最新年度（売上・営業利益・期末現預金）を使い、区分名を付ける', () => {
    const text = block();
    expect(text).toContain(
      `実績（STAGE1登録、2025年度）：売上 ${formatAmount(930_000_000)}｜営業利益 ${formatAmount(52_000_000)}｜期末現預金 ${formatAmount(210_000_000)}`
    );
  });

  it('最低現預金は登録前提の値として出す（Q5の資金繰りの材料）', () => {
    expect(block()).toContain(`最低現預金（登録前提）：${formatAmount(150_000_000)}`);
  });

  it('目標の数値を、実績の数値の区分に混ぜない', () => {
    const text = block();
    const actualLine = text.split('\n').find((l) => l.startsWith('- 実績')) ?? '';
    expect(actualLine).not.toContain('2027');
    expect(actualLine).not.toContain(formatAmount(1_000_000_000));
  });
});

describe('保存済みの前提が使えないとき', () => {
  it('保存なし：目標を出さず、実績と予測未算出だけ', () => {
    const text = block({ csvFinanceData: {} });
    expect(text).toContain('保存済みの資金計画はありません');
    expect(text).not.toContain('目標（経営者が登録）');
    expect(text).toContain('予測未算出');
    expect(text).toContain('実績（STAGE1登録、2025年度）');
  });

  it('別の会社の前提は使わない', () => {
    const text = block({ csvFinanceData: { financePlanAssumptions: storedFor(COMPANY_B) } });
    expect(text).toContain('この会社のものとして確認できませんでした');
    expect(text).not.toContain('目標（経営者が登録）');
    expect(text).not.toMatch(/2027/);
  });

  it('形式が不正なら読めなかったと書く', () => {
    const broken = { ...storedFor(COMPANY_A), formatVersion: 999 };
    const text = block({ csvFinanceData: { financePlanAssumptions: broken } });
    expect(text).toContain('読めませんでした');
    expect(text).not.toContain('目標（経営者が登録）');
  });

  it('目標が未登録なら、未登録と書く', () => {
    const text = buildStage6PlanBlock({
      csvFinanceData: { financePlanAssumptions: storedFor(COMPANY_A, { targetRevenueYen: null, targetOperatingIncomeYen: null, targetYear: null }) },
      companyId: COMPANY_A,
      financePL: PL,
      financeBS: BS,
      departments: [],
      fiscalYearEnd: '3',
      currentYear: CURRENT_YEAR,
      simulationResults: [],
    });
    expect(text).toContain('目標（経営者が登録）：未登録です');
  });

  it('決算月が無ければ、年度の対応が未確定と書く', () => {
    expect(block({ fiscalYearEnd: undefined })).toContain('決算月が未登録');
  });

  it('前提の保存日時と、現在のデータとの一致は未検証であることを書く', () => {
    const text = block();
    expect(text).toContain('前提の保存日時: 2026-10-20');
    expect(text).toContain('保存済みの前提も、現在のSTAGE1・4のデータとの一致は未検証です');
  });
});

describe('保存済みシミュレーションは、保存時点の結果として区別する', () => {
  it('保存値をそのまま出し、再計算しない', () => {
    const text = block({
      simulationResults: [
        {
          id: 'w',
          created_at: '2026-09-01T00:00:00Z',
          title: '保存値',
          payload: { projection: { points: [{ year: '2028', sales: 500_000_000, op: 40_000_000 }] } },
        },
      ],
    });
    expect(text).toContain(`保存済み（保存時点の計算結果）：保存値（2026-09-01）：2028 売上${formatAmount(500_000_000)}・営業利益${formatAmount(40_000_000)}`);
  });

  it('現在の計画と一致すると断定しない注意を書く（未検証）', () => {
    const text = block({
      simulationResults: [{ id: 'x', created_at: '2026-09-01T00:00:00Z', title: '案', payload: { projection: { points: [] } } }],
    });
    expect(text).toContain('現在のSTAGE1・4のデータとの一致は未検証');
    expect(text).toContain('現在の計画と一致するとは断定できません');
    expect(text).toContain('保存結果は再計算・補完していません');
  });

  it('点が無ければ「点なし」と書き、数値を作らない', () => {
    const text = block({
      simulationResults: [{ id: 'z', created_at: '2026-09-01T00:00:00Z', title: '空', payload: { projection: { points: [] } } }],
    });
    expect(text).toContain('点なし');
  });

  it('保存済みシミュレーションが無ければ、そう書く', () => {
    expect(block({ simulationResults: [] })).toContain('保存済みシミュレーションはありません');
  });
});

describe('現預金の区分（資金の相談で単独に使う）', () => {
  it('現預金の実績と最低現預金、予測未算出を出す', () => {
    const text = buildCashPositionBlock({
      csvFinanceData: { financePlanAssumptions: storedFor(COMPANY_A) },
      companyId: COMPANY_A,
      financePL: PL,
      financeBS: BS,
    });
    expect(text).toContain(`期末現預金 ${formatAmount(210_000_000)}`);
    expect(text).toContain(`最低現預金（登録前提）：${formatAmount(150_000_000)}`);
    expect(text).toContain('期末現預金の予測：未算出');
    expect(text).not.toMatch(/年度（予測）/);
  });

  it('最低現預金が無ければ未登録と書く', () => {
    const text = buildCashPositionBlock({ csvFinanceData: {}, companyId: COMPANY_A, financePL: PL, financeBS: BS });
    expect(text).toContain('最低現預金：未登録です');
  });
});

describe('実績の取り出し', () => {
  it('最新年度を選び、現預金は同じ年度の貸借対照表から取る', () => {
    expect(latestActual(PL, BS)).toEqual({
      year: 2025,
      revenue: 930_000_000,
      operatingIncome: 52_000_000,
      cash: 210_000_000,
    });
  });

  it('損益が無ければ null', () => {
    expect(latestActual([], BS)).toBeNull();
  });
});
