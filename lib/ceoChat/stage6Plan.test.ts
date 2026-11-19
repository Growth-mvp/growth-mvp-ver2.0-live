import { buildStage6PlanBlock, buildCashPositionBlock, latestActual, yearsMentionedIn } from './stage6Plan';
import { buildFinanceOutlook } from '@/utils/stage6/financeOutlook';
import { computeStage6FinancePlan } from '@/utils/stage6/financePlanPipeline';
import { buildStoredFinancePlan, FINANCE_PLAN_CALC_VERSION, readStoredFinancePlan, type FinancePlanDomain } from '@/utils/stage6/financePlanSnapshot';
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

  it('保存済みの計画がある場合、見通しは「予測未算出」と書かず、登録目標を見通しとして扱わない', () => {
    const text = block();
    expect(text).not.toContain('予測未算出');
    expect(text).toContain('登録目標は見通しではなく目標として扱うこと');
  });

  it('期末現預金の見通しは未算定の項目を未算定と書き、STAGE6と同じ計算だと明示する（Q5）', () => {
    const text = block();
    expect(text).toContain('期末現預金 未算定');
    expect(text).toContain('トップ画面・STAGE6・銀行向け計画書と同じ計算');
  });

  it('年度別の売上・営業利益・期末現預金は、STAGE6と同じ buildFinanceOutlook の結果と一致する（目標年度の行）', () => {
    const stored = readStoredFinancePlan(storedFor(COMPANY_A), COMPANY_A);
    if (stored.kind !== 'OK') throw new Error('stored plan must be OK');
    const outlook = buildFinanceOutlook({
      financePL: PL,
      financeBS: BS,
      departments: [],
      fiscalYearEnd: '3',
      companyTargets: [],
      domain: stored.domain,
      currentYear: CURRENT_YEAR,
    });
    const year = 2027;
    const u = outlook.unifiedPl.years.find((r) => r.fiscalYear === year);
    const c = outlook.financedPlan.years.find((r) => r.year === year);
    expect(u && c).toBeTruthy();
    const text = block();
    expect(text).toContain(
      `・${year}年度｜売上 ${formatAmount(u!.plan.revenueYen as number)}（既存事業 ${formatAmount(u!.baseline.revenueYen as number)}・施策効果 ${formatAmount(u!.effect.revenueUpYen)}）｜営業利益 ${formatAmount(u!.plan.operatingIncomeYen as number)}（既存事業 ${formatAmount(u!.baseline.operatingIncomeYen as number)}・施策効果 ${formatAmount(u!.confirmedOperatingImprovementYen)}）｜期末現預金 ${
        typeof c!.closingCashAfterFinancing.value === 'number' ? formatAmount(c!.closingCashAfterFinancing.value) : '未算定'
      }`
    );
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
  it('保存なし（他の項目を含む保存データで、前提が無いと確認できる）：未保存と書き、目標を出さない', () => {
    const text = block({ csvFinanceData: { financeBS: [] } });
    expect(text).toContain('保存済みの資金計画はありません');
    expect(text).not.toContain('目標（経営者が登録）');
    expect(text).toContain('予測未算出');
    expect(text).toContain('実績（STAGE1登録、2025年度）');
  });

  it('保存なしと確認できない（保存データが空）：未保存と断定せず、目標を出さない', () => {
    const text = block({ csvFinanceData: {} });
    expect(text).not.toContain('保存済みの資金計画はありません');
    expect(text).toContain('保存済みの資金計画は今回参照した情報では確認できません');
    expect(text).not.toContain('目標（経営者が登録）');
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

  it('前提の保存日時と、保存時点から元データが変わったことを書く（画面と同じ判定）', () => {
    const text = block();
    expect(text).toContain('前提の保存日時: 2026-10-20');
    expect(text).toContain('- 保存状態：過去の計算です（');
    expect(text).toContain('STAGE1またはSTAGE4の元データが変わりました');
  });

  it('画面と同じ入力の保存値なら、保存状態は一致と書く', () => {
    const stored = readStoredFinancePlan(storedFor(COMPANY_A), COMPANY_A);
    if (stored.kind !== 'OK') throw new Error('stored plan must be OK');
    const computed = computeStage6FinancePlan({
      financePL: PL as any,
      financeBS: BS as any,
      departments: [],
      fiscalYearEnd: '3',
      domain: stored.domain,
      currentYear: CURRENT_YEAR,
    });
    const saved = buildStoredFinancePlan({
      domain: stored.domain,
      companyId: COMPANY_A,
      savedAt: '2026-10-20T00:00:00Z',
      meta: {
        calcVersion: FINANCE_PLAN_CALC_VERSION,
        companyId: COMPANY_A,
        baseYear: computed.basePlan.baseYear,
        bsBaseYear: computed.basePlan.bsBaseYear,
        assumptionsHash: computed.assumptionsHash,
        sourceHash: computed.sourceHash,
        unconfirmed: { unapprovedReadyYen: 0, unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
        computedAt: '2026-10-20T00:00:00Z',
      },
    });
    const text = block({ csvFinanceData: { financePlanAssumptions: saved } });
    expect(text).toContain('- 保存状態：保存済みの前提と最新の元データが一致');
  });
});

describe('質問に応じた参照（関係する年度と区画だけを出す）', () => {
  it('質問の年度（2026年度）と、経営目標の年度（2027年度）を参照する', () => {
    const text = block({ question: '2026年度の売上高の見込みは？' });
    expect(text).toMatch(/・2026年度｜売上/);
    expect(text).toMatch(/・2027年度｜売上/);
    expect(text).not.toMatch(/・2028年度｜売上/);
  });

  it('予測期間の外の年度は、算出していないと書く', () => {
    const text = block({ question: '2035年度の売上高は？' });
    expect(text).toContain('指定の2035年度は予測期間');
    expect(text).toContain('の外のため、算出していません');
  });

  it('売上・利益の質問では、借入・プロジェクト・保存済みシミュレーションの区画を出さない', () => {
    const text = block({ question: '2027年度の売上高と営業利益の見込みは？', simulationResults: [] });
    expect(text).toContain('・2027年度｜売上');
    expect(text).not.toContain('設備投資・借入・返済・資金（年度別');
    expect(text).not.toContain('プロジェクト別の財務効果');
    expect(text).not.toContain('保存済みシミュレーションはありません');
    expect(text).not.toContain('- 保存済み（保存時点の計算結果）');
  });

  it('資金の質問では、設備投資・借入・返済・資金不足を出す', () => {
    const text = block({ question: '資金不足や借入返済の懸念は？' });
    expect(text).toContain('- 設備投資・借入・返済・資金（年度別、借入反映後）：');
    expect(text).toContain('元本返済');
    expect(text).toContain('返済余力（DSCR）');
  });

  it('達成率の質問では、STAGE5の登録済みの実績と達成率を出す', () => {
    const text = block({ question: '達成率が表示されないのはなぜですか？' });
    expect(text).toContain('登録済みの実績と達成率（STAGE5・当会計年度');
  });

  it('年度の表記（2027年3月期・2030年度）を質問から読む', () => {
    expect(yearsMentionedIn('2027年3月期の実績は？')).toEqual([2027]);
    expect(yearsMentionedIn('2030年度の見込み、2028年の現預金')).toEqual([2028, 2030]);
    expect(yearsMentionedIn('KPIの目標値は？')).toEqual([]);
  });

  it('質問の無い従来の呼び出しは、全区画を出す', () => {
    const text = block();
    expect(text).toContain('- 設備投資・借入・返済・資金（年度別、借入反映後）：');
    expect(text).toContain('保存済みシミュレーションはありません');
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
  it('現預金の実績と最低現預金、STAGE6と同じ年度別の期末現預金を出す', () => {
    const text = buildCashPositionBlock({
      csvFinanceData: { financePlanAssumptions: storedFor(COMPANY_A) },
      companyId: COMPANY_A,
      financePL: PL,
      financeBS: BS,
      departments: [],
      fiscalYearEnd: '3',
      currentYear: CURRENT_YEAR,
      companyTargets: [],
    });
    expect(text).toContain(`期末現預金 ${formatAmount(210_000_000)}`);
    expect(text).toContain(`最低現預金（登録前提）：${formatAmount(150_000_000)}`);
    expect(text).toContain('- 期末現預金（施策反映後・借入反映後）：2027年度 未算定');
    expect(text).toContain('期末現預金（施策反映後・借入反映後）');
    expect(text).not.toContain('期末現預金の予測：未算出');
    expect(text).not.toMatch(/年度（予測）/);
  });

  it('保存済みの計画が無ければ、現預金の予測は未算出と書く', () => {
    const text = buildCashPositionBlock({
      csvFinanceData: { financeBS: [] },
      companyId: COMPANY_A,
      financePL: PL,
      financeBS: BS,
      departments: [],
      fiscalYearEnd: '3',
      currentYear: CURRENT_YEAR,
      companyTargets: [],
    });
    expect(text).toContain('期末現預金の予測：未算出');
  });

  it('最低現預金が未登録と確認できれば未登録と書く', () => {
    const text = buildCashPositionBlock({
      csvFinanceData: { financeBS: [] },
      companyId: COMPANY_A,
      financePL: PL,
      financeBS: BS,
      departments: [],
      fiscalYearEnd: '3',
      currentYear: CURRENT_YEAR,
      companyTargets: [],
    });
    expect(text).toContain('最低現預金：未登録です');
  });

  it('保存データが空で未登録と確認できなければ、未登録と断定しない', () => {
    const text = buildCashPositionBlock({
      csvFinanceData: {},
      companyId: COMPANY_A,
      financePL: PL,
      financeBS: BS,
      departments: [],
      fiscalYearEnd: '3',
      currentYear: CURRENT_YEAR,
      companyTargets: [],
    });
    expect(text).not.toContain('最低現預金：未登録です');
    expect(text).toContain('最低現預金：保存済みの資金計画は今回参照した情報では確認できません');
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
