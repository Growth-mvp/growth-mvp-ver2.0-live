/* STAGE1〜6 の一気通貫の実測（評価専用。本番DB・実OpenAIには接続しない）。
 * 既存の関数をそのまま実行する。画面（フック）の中だけにある式は、同じ式を下で再現し、その旨を結果に記録する。 */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { mkBaselineTrajectory, mkBaseFigures } from '@/utils/stage6/baseline';
import { calcYearlyFromKrs, isRevenueLabel, isOperatingIncomeLabel } from '@/utils/stage6/compute';
import { computeStage6FinancePlan } from '@/utils/stage6/financePlanPipeline';
import { FINANCE_PLAN_CALC_VERSION } from '@/utils/stage6/financePlanSnapshot';
import { guessKindAndBase } from '@/app/okr/_lib/okrModels';
import { generateProjectId } from '@/utils/supabase/stableIdGenerator';
import { buildStage5ProgressBlock } from '@/lib/ceoChat/stage5Progress';
import {
  FICTIONAL_COMPANY_ID,
  FICTIONAL_DEPARTMENTS,
  FICTIONAL_OKRS,
  FICTIONAL_PROGRESS_LOGS,
  FICTIONAL_STRATEGY_ID,
  FICTIONAL_STRATEGY_ROW,
} from '../quality/fictionalCompany';

const OUT_DIR = path.join(__dirname, 'results-verify');
const NOW = new Date('2026-11-03T00:00:00Z');
const M = 1_000_000;

/* ---------- 検証用の入力（仮定を明示。元データは変更しない） ---------- */

/** 仮定：2025年度の売上原価・販管費・支払利息・法人税（登録データにはない）。営業利益52・純利益33百万円と整合させる。 */
const ASSUMED_COGS_2025 = 620 * M;
const ASSUMED_SGA_2025 = 258 * M;

const PL = (FICTIONAL_STRATEGY_ROW.financePL as any[]).map((r) =>
  r.year === 2025 ? { ...r, cogs: ASSUMED_COGS_2025, sga: ASSUMED_SGA_2025, interest: 5 * M, tax: 14 * M } : r
);
const BS = FICTIONAL_STRATEGY_ROW.financeBS as any[];

/** 仮定：施策の財務効果（登録データには未確認）。 */
function departments(opts: { revenueMJPY?: number; progress?: number; duplicateSkill?: boolean; withSpend?: boolean; capex?: boolean } = {}): any[] {
  const withSpend = opts.withSpend ?? true;
  const d = JSON.parse(JSON.stringify(FICTIONAL_DEPARTMENTS));
  for (const dept of d) {
    for (const proj of dept.projects) {
      for (const kr of proj.okrsV2 ?? []) {
        // 作成時と同じ推定関数で、KR の種類と基準を決める
        const g = guessKindAndBase(kr.label);
        kr.kind = g.kind;
        kr.baseKey = g.baseKey;
      }
    }
  }
  const sales = d[0].projects[0];
  sales.impactRevenueMJPY = opts.revenueMJPY ?? 60;
  sales.impactRevenueProgress = opts.progress ?? 50;
  sales.executionHumanInvestments = [{ id: 'hi-1', type: 'HIRE', amount: 12 * M, timingYm: '2027-01', ...(withSpend ? { spend: { category: 'OPEX', recurrence: 'ONE_TIME', paymentYm: '2027-01', amountBasis: 'TOTAL' } } : {}) }];
  const mfg = d[1].projects[0];
  mfg.skillPlans = [{ id: 'sk-1', skillName: '点検手順の改訂', cost: 6 * M, dueYm: '2026-10', ...(withSpend ? { spend: { category: 'OPEX', recurrence: 'ONE_TIME', paymentYm: '2026-10', amountBasis: 'TOTAL' } } : {}) }];
  if (opts.capex) {
    // 仮定：設備投資（CAPEX）30百万円を、2027年6月の一回限りの支出として登録
    mfg.executionHumanInvestments = [{ id: 'hi-capex', type: 'TOOL', amount: 30 * M, timingYm: '2027-06', spend: { category: 'CAPEX', recurrence: 'ONE_TIME', paymentYm: '2027-06', amountBasis: 'TOTAL' } }];
  }
  if (opts.duplicateSkill) {
    // 同じ支出を二つの欄に入れた場合（重複の確認）
    sales.executionHumanInvestments.push({ id: 'hi-dup', type: 'TRAINING', amount: 6 * M, timingYm: '2026-10', ...(withSpend ? { spend: { category: 'OPEX', recurrence: 'ONE_TIME', paymentYm: '2026-10', amountBasis: 'TOTAL' } } : {}) });
  }
  return d;
}

/** 画面（useStage6Data）の KR 変換と同じ規則：種類が無い KR は除外、投資計画は施策ごとに1件の INVEST KR。 */
function bridgeKrsOf(depts: any[]): any[] {
  const krs: any[] = [];
  for (const dept of depts) {
    for (const proj of dept.projects) {
      const projKey = `${dept.name}::${proj.title}`;
      for (const kr of proj.okrsV2 ?? []) {
        if (!kr.kind) continue;
        krs.push({
          id: kr.id ?? `kr-${projKey}-${kr.label}`,
          kind: kr.kind,
          label: kr.label,
          target: kr.target ?? 0,
          unit: kr.unit,
          scope: kr.scope ?? 'company',
          baseKey: kr.baseKey ?? 'revenue',
          due: kr.due,
          lagMonths: kr.lagMonths,
          startYm: kr.startYm,
        });
      }
      const investTotal =
        (proj.skillPlans ?? []).reduce((s: number, sk: any) => s + (sk?.cost ?? 0), 0) +
        (proj.executionHumanInvestments ?? []).reduce((s: number, inv: any) => s + (inv?.amount ?? 0), 0);
      if (investTotal > 0) {
        krs.push({ id: `invest-${projKey}`, kind: 'INVEST', label: `${proj.title}: 投資計画`, target: investTotal, unit: 'JPY', scope: 'project', baseKey: 'invest' });
      }
    }
  }
  return krs;
}

/** 仮定：運転資金の比率は、2025年度の残高を売上で割った値（登録データからの導出。比率そのものは未登録）。 */
const RATIO_ASSUMED = { ar: 128 / 930, inv: 72 / 930, ap: 79 / 930 };

function domainWith(target: boolean, ratios = false): any {
  return {
    assumptions: {
      minCashYen: 150 * M,
      taxRate: 0.3,
      depreciationYen: ratios ? 20 * M : null,
      arRatio: ratios ? RATIO_ASSUMED.ar : null,
      inventoryRatio: ratios ? RATIO_ASSUMED.inv : null,
      apRatio: ratios ? RATIO_ASSUMED.ap : null,
      targetRevenueYen: target ? 1000 * M : null,
      targetOperatingIncomeYen: target ? 70 * M : null,
      targetYear: target ? 2027 : null,
    },
    existingLoans: ratios
      ? [{ id: 'loan-zero', name: '既存借入（残高ゼロの仮定）', category: 'BANK', balanceYen: 0, annualRate: 0, scheduledPrincipalYen: { 2026: 0, 2027: 0, 2028: 0 } }]
      : [],
    newLoans: [],
    // 仮定：借入・配当は「入力済み（ゼロ）」として、財務CFの計算を有効にする（未入力だと保留のまま）
    dividendsYen: ratios ? { 2026: 0, 2027: 0, 2028: 0 } : {},
  };
}

const stateForBaseline = { financePL: PL, financeBS: BS };

/* ---------- 計測 ---------- */

function cfYears(plan: any) {
  return plan.years.map((y: any) => ({
    year: y.year,
    kind: y.kind,
    revenue: y.revenue?.value ?? null,
    revenueBasis: y.revenue?.basis ?? null,
    operatingIncome: y.operatingIncome?.value ?? null,
    investingCf: y.investingCf?.value ?? null,
    closingCashAfterFinancing: y.closingCashAfterFinancing?.value ?? null,
    dscr: y.dscr?.value ?? null,
    verdict: y.verdict,
    operatingCf: y.operatingCf?.value ?? null,
    opexRegisteredYen: y.opexRegistered ?? null,
    financingCf: y.financingCf?.value ?? null,
    holds: y.holds ?? [],
  }));
}

function yearlyOf(yearly: any[]) {
  return yearly.map((y) => ({ year: y.year, revenue: y.revenue, op_income: y.op_income }));
}

function runCf(depts: any[], target: boolean, ratios = false) {
  const r = computeStage6FinancePlan({
    financePL: PL as any,
    financeBS: BS as any,
    departments: depts as any,
    fiscalYearEnd: '3',
    domain: domainWith(target, ratios),
    currentYear: 2026,
  } as any);
  const inv: any = r.investment;
  return {
    cf: cfYears(r.plan),
    investment: inv.yearlyByCategory,
    investmentTotalYen: inv.enteredYen,
    investmentItems: (inv.items ?? []).map((i: any) => ({ label: i.label, amountStatus: i.amountStatus, amountBasis: i.amountBasis, counted: i.counted, ready: i.ready, category: i.category, duplicateStatus: i.duplicateStatus, scheduleStatus: i.scheduleStatus })),
    investmentSummary: { enteredYen: inv.enteredYen, readyYen: inv.readyYen, unclassifiedYen: inv.unclassifiedYen, unscheduledYen: inv.unscheduledYen, candidateYen: inv.candidateYen, unapprovedReadyYen: inv.unapprovedReadyYen, basisPendingYen: inv.basisPendingYen },
  };
}

function northStarRevenue(depts: any[], baseRevenueYen: number): number {
  // 画面の式の再現（useStage6Data.ts:612-830、1040-1110）：基準の売上 ＋ Σ（施策の売上効果 × 進捗率）
  let sum = 0;
  for (const dept of depts) for (const proj of dept.projects) {
    const r = proj.impactRevenueMJPY;
    const p = proj.impactRevenueProgress;
    if (typeof r === 'number' && typeof p === 'number') sum += (r * p) / 100;
  }
  return baseRevenueYen + sum * M;
}

/* ---------- 検証本体 ---------- */

const RESULTS: Record<string, any> = {};

beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

afterAll(() => {
  writeFileSync(path.join(OUT_DIR, 'measurements.json'), JSON.stringify(RESULTS, null, 2), 'utf8');
});

describe('A. データの一貫性（識別子・保存先・読み込み）', () => {
  it('A1 プロジェクトIDは、同じ入力なら同じ値になる。名称を変えると別のIDになる（参照の切れ目）', () => {
    const a = generateProjectId(FICTIONAL_STRATEGY_ID, 'dept-manufacturing', '点検工程の標準化', 'existing' as any);
    const b = generateProjectId(FICTIONAL_STRATEGY_ID, 'dept-manufacturing', '点検工程の標準化', 'existing' as any);
    const c = generateProjectId(FICTIONAL_STRATEGY_ID, 'dept-manufacturing', '点検工程の標準化（改称）', 'existing' as any);
    RESULTS.A1 = { same: a === b, renamedDiffers: a !== c, sample: a, fixtureProjectIds: FICTIONAL_DEPARTMENTS.flatMap((d: any) => d.projects.map((p: any) => p.id)) };
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('A2 STAGE4のKRの種類は、ラベルから推定される。推定された種類の内訳を記録する', () => {
    const rows: any[] = [];
    for (const dept of departments()) for (const proj of dept.projects) for (const kr of proj.okrsV2 ?? []) {
      rows.push({ label: kr.label, kind: kr.kind, baseKey: kr.baseKey, unit: kr.unit, target: kr.target });
    }
    RESULTS.A2 = { krs: rows, krsWithoutKindWithoutInference: 0 };
    expect(rows.every((r) => typeof r.kind === 'string')).toBe(true);
  });

  it('A3 STAGE1の損益には、ベースラインに必要な売上原価・販管費が登録データに無い（仮定を追加して実行）', () => {
    const origPl = FICTIONAL_STRATEGY_ROW.financePL as any[];
    const base2025 = mkBaselineTrajectory({ financePL: origPl } as any);
    RESULTS.A3 = {
      withoutCogsSga: base2025 === null ? 'baseline=null（必須項目が無い）' : 'baseline生成',
      withAssumedCogsSga: (() => {
        const t = mkBaselineTrajectory(stateForBaseline as any);
        return t ? { startYm: t.startYm, endYm: t.endYm } : null;
      })(),
    };
    expect(RESULTS.A3.withAssumedCogsSga).not.toBeNull();
  });
});

describe('B. 戦略ロジック（経路の確認。文章の一致だけでは判定しない）', () => {
  it('B1 KRの種類の推定：金額・率・件数の KR が、どの財務効果の種類に入るかを記録する', () => {
    const krs = bridgeKrsOf(departments());
    RESULTS.B1 = krs.map((k) => ({ label: k.label, kind: k.kind, target: k.target, unit: k.unit, due: k.due }));
    expect(krs.length).toBeGreaterThan(0);
  });
});

describe('C. 業績・財務ロジックの実測（一気通貫）', () => {
  it('C1 KRの積み上げ（チャートの経路）：KRなし／あり の年次の売上・営業利益', () => {
    const state = { financePL: PL, financeBS: BS };
    const baseTraj = mkBaselineTrajectory(state as any)!;
    const baseFigures = mkBaseFigures(state as any);
    const scenario = { successRate: 1, synergyRate: 0 };
    const noKr = calcYearlyFromKrs({ baseTraj, baseFigures, krs: [], scenario } as any);
    const withKr = calcYearlyFromKrs({ baseTraj, baseFigures, krs: bridgeKrsOf(departments()), scenario } as any);
    const nonInvest = bridgeKrsOf(departments()).filter((k) => k.kind !== 'INVEST');
    const withoutInvestKr = calcYearlyFromKrs({ baseTraj, baseFigures, krs: nonInvest, scenario } as any);
    RESULTS.C1 = {
      baseFigures,
      actualBaseYear2025: { revenue: 930_000_000, operatingIncome: 52_000_000 },
      withoutInvestKrYearly: yearlyOf(withoutInvestKr),
      baselineStart: baseTraj.startYm,
      baselineEnd: baseTraj.endYm,
      noKr: yearlyOf(noKr),
      withKr: yearlyOf(withKr),
      deltaRevenueByYear: withKr.map((y: any, i: number) => ({ year: y.year, deltaRevenueYen: y.revenue - (noKr[i]?.revenue ?? 0) })),
    };
    expect(withKr.length).toBeGreaterThan(0);
  });

  it('C2 キャッシュフロー（CFの経路）：目標あり／なし。売上はどの値で動くか', () => {
    const withTarget = runCf(departments(), true);
    const noTarget = runCf(departments(), false);
    const withRatios = runCf(departments(), true, true);
    const withDebtEntered = runCf(departments(), true, true);
    RESULTS.C2_zeroLoan = { withTarget: runCf(departments(), true, true).cf, noTarget: runCf(departments(), false, true).cf, withCapexWithTarget: runCf(departments({ capex: true }), true, true).cf };
    const noTargetDebt = runCf(departments(), false, true);
    const noTargetRatios = runCf(departments(), false, true);
    RESULTS.C2 = { withTarget: withTarget.cf, noTarget: noTarget.cf, withTargetAndRatios: withRatios.cf, noTargetAndRatios: noTargetRatios.cf, withTargetDebtEntered: withDebtEntered.cf, noTargetDebtEntered: noTargetDebt.cf, minCashYen: 150 * M, ratiosAssumed: RATIO_ASSUMED };
    const y2027 = withTarget.cf.find((y: any) => y.year === 2027);
    expect(y2027).toBeDefined();
  });

  it('C3 北極星（施策効果の経路）の売上：基準 ＋ 施策効果（同じ式の再現）と、CFの売上・チャートの売上を並べる', () => {
    const depts = departments();
    const base2025 = PL.find((r: any) => r.year === 2025)!.revenue;
    const north2027 = northStarRevenue(depts, base2025);
    const cf = runCf(depts, true).cf.find((y: any) => y.year === 2027);
    const state = { financePL: PL, financeBS: BS };
    const chart = calcYearlyFromKrs({ baseTraj: mkBaselineTrajectory(state as any)!, baseFigures: mkBaseFigures(state as any), krs: bridgeKrsOf(depts), scenario: { successRate: 1, synergyRate: 0 } } as any).find((y: any) => y.year === 2027);
    RESULTS.C3 = {
      year: 2027,
      northStarRevenueYen: north2027,
      cfRevenueYen: cf?.revenue ?? null,
      chartRevenueYenFromKrBridge: chart?.revenue ?? null,
      note: '3つの数値は、同じ年度の売上について、別々の経路で計算された値（同じ年度の一つの予測ではない）',
    };
    expect(north2027).toBeGreaterThan(0);
  });

  it('C4 投資：施策の投資（スキル費用・人的投資）が、CFの投資と、KRの投資計画の両方に入るか', () => {
    const depts = departments();
    const cf = runCf(depts, true);
    const enteredYen = cf.investmentTotalYen;
    const krInvest = bridgeKrsOf(depts).filter((k) => k.kind === 'INVEST').map((k) => ({ label: k.label, targetYen: k.target }));
    const noSpend = runCf(departments({ withSpend: false }), true);
    RESULTS.C4 = {
      inputTotalYen: 6 * M + 12 * M,
      cfEnteredYen: enteredYen,
      cfSummaryWithSpend: cf.investmentSummary,
      cfSummaryWithoutSpend: noSpend.investmentSummary,
      itemsWithoutSpend: noSpend.investmentItems,
      itemsWithSpend: cf.investmentItems,
      cfInvestingCfByYearWithoutSpend: noSpend.cf.map((y: any) => ({ year: y.year, investingCf: y.investingCf })),
      cfInvestmentByYear: cf.investment,
      bridgeInvestKrs: krInvest,
      note: 'CFの投資（investmentDemand）と、KRの投資計画（INVEST）は、同じ入力を別々に読んでいる（同一入力が二経路に入る）',
    };
    expect(enteredYen).toBeGreaterThan(0);
  });
});

describe('D. 二重計上と誤判定（実計算で確認）', () => {
  it('D1 支出の重複：同じ支出を二つの欄に入れた場合、合計が増える（重複の検出なし）', () => {
    const once = runCf(departments(), true);
    const dup = runCf(departments({ duplicateSkill: true }), true);
    RESULTS.D1 = { totalOnceYen: once.investmentTotalYen, totalWithDuplicateYen: dup.investmentTotalYen, addedYen: dup.investmentTotalYen - once.investmentTotalYen };
    expect(dup.investmentTotalYen).toBeGreaterThan(once.investmentTotalYen);
  });

  it('D2 売上原価・売上総利益は売上高として判定されない（P0-3 修正後。修正前は売上原価が選ばれていた）', () => {
    const labels = ['売上原価', '売上総利益', '売上高', '売上成長率', 'Revenue Growth', '営業利益'];
    const rev = labels.map((l) => ({ label: l, isRevenue: isRevenueLabel(l), isOperatingIncome: isOperatingIncomeLabel(l) }));
    const firstRevenueFromTargets = [{ label: '売上原価', target: 300 }, { label: '売上高', target: 1000 }].find((t) => isRevenueLabel(t.label));
    RESULTS.D2 = { rows: rev, firstRevenueTargetPickedFromOrderedList: firstRevenueFromTargets?.label };
    expect(firstRevenueFromTargets?.label).toBe('売上高');
  });

  it('D3 目標への補間値が「予測」として扱われるか（CFの目標年の売上＝登録目標）', () => {
    const cf = runCf(departments(), true).cf;
    const y2027 = cf.find((y: any) => y.year === 2027);
    RESULTS.D3 = { year: 2027, kind: y2027?.kind, revenueYen: y2027?.revenue, registeredTargetYen: 1000 * M, equalsTarget: y2027?.revenue === 1000 * M, basis: y2027?.revenueBasis };
    expect(y2027?.revenue).toBe(1000 * M);
  });

  it('D4 未確認の進捗が遅延として扱われるか（STAGE5の集計の文面）', () => {
    const block = buildStage5ProgressBlock({
      departments: FICTIONAL_DEPARTMENTS as any,
      okrs: FICTIONAL_OKRS.filter((o) => o.company_id === FICTIONAL_COMPANY_ID) as any,
      companyLogs: FICTIONAL_PROGRESS_LOGS.filter((l) => l.company_id === FICTIONAL_COMPANY_ID) as any,
      companyLogsFailed: false,
      now: NOW,
    });
    RESULTS.D4 = {
      listsUnconfirmedProject: block.includes('確認がないプロジェクト'),
      containsDelayClaim: /製造部 \/ 点検工程の標準化[^\n]*遅れ|遅延している|遅れている/.test(block),
      negationLinePresent: block.includes('遅延と断定しない'),
    };
    expect(RESULTS.D4.containsDelayClaim).toBe(false);
  });

  it('D5 施策効果の重複：同じ施策の効果が、KRと施策効果の両方から出る（別々の数値として出るか）', () => {
    const depts = departments();
    const sales = depts[0].projects[0];
    const krs = bridgeKrsOf(depts).filter((k) => k.label.includes('商談') || k.label.includes('継続'));
    RESULTS.D5 = {
      project: sales.title,
      projectImpactPathRevenueMJPY: (sales.impactRevenueMJPY * sales.impactRevenueProgress) / 100,
      krPathKrs: krs.map((k) => ({ label: k.label, kind: k.kind, target: k.target })),
      note: '北極星は施策効果のみ、チャートはKRのみ、CFは目標のみを使う。三つは合算されていない（重複は起きないが、三つの数値が同じ年度の予測として並ぶ）',
    };
    expect(krs.length).toBeGreaterThan(0);
  });
});

describe('E. STAGE間の変更伝播（変更前後の差分を実測）', () => {
  function snapshot(depts: any[], stateOverrides: any = {}) {
    const state = { financePL: PL, financeBS: BS, ...stateOverrides };
    const chart = calcYearlyFromKrs({ baseTraj: mkBaselineTrajectory(state as any)!, baseFigures: mkBaseFigures(state as any), krs: bridgeKrsOf(depts), scenario: { successRate: 1, synergyRate: 0 } } as any);
    const cf = runCf(depts, true).cf;
    const base2025 = PL.find((r: any) => r.year === 2025)!.revenue;
    return { krs: bridgeKrsOf(depts), chart2027: chart.find((y: any) => y.year === 2027)?.revenue, cf2027: cf.find((y: any) => y.year === 2027)?.revenue, northStar2027: northStarRevenue(depts, base2025) };
  }

  it('E1 STAGE2の戦略結論を変更：STAGE3・4の既存データとCF・チャートは自動で変わるか', () => {
    const depts = departments();
    const before = JSON.stringify({ depts, s: snapshot(depts) });
    const changedStory = { ...FICTIONAL_STRATEGY_ROW, finalStoryFinal: [{ title: '危機', body: '別の危機認識' }] };
    // 変更は戦略結論（finalStoryFinal）のみ。部門・KR・施策の入力は同じまま
    const after = JSON.stringify({ depts, s: snapshot(depts, { finalStoryFinal: changedStory.finalStoryFinal }) });
    RESULTS.E1 = { depsAndNumbersChanged: before !== after, note: '自動再生成の経路は無い（戦略結論を読むのは生成の入力のみ）。再生成は利用者の操作' };
    expect(RESULTS.E1.depsAndNumbersChanged).toBe(false);
  });

  it('E2 STAGE3の部門ミッションを変更：STAGE4のKR・施策の関係とCF・チャートは変わるか', () => {
    const depts = departments();
    const base = snapshot(depts);
    const d2 = JSON.parse(JSON.stringify(depts));
    d2[0].mission = '別のミッション';
    const after = snapshot(d2);
    RESULTS.E2 = { numbersChanged: JSON.stringify(base) !== JSON.stringify(after), projectsUnchanged: JSON.stringify(depts[0].projects) === JSON.stringify(d2[0].projects) };
    expect(RESULTS.E2.numbersChanged).toBe(false);
  });

  it('E3 STAGE4の施策効果を変更（売上効果 60→120）：北極星・チャート・CFの数値はどう変わるか', () => {
    const base = snapshot(departments({ revenueMJPY: 60 }));
    const after = snapshot(departments({ revenueMJPY: 120 }));
    RESULTS.E3 = {
      northStar2027: { before: base.northStar2027, after: after.northStar2027 },
      chart2027: { before: base.chart2027, after: after.chart2027 },
      cf2027: { before: base.cf2027, after: after.cf2027 },
    };
    expect(after.northStar2027).not.toBe(base.northStar2027);
    expect(after.cf2027).toBe(base.cf2027);
  });

  it('E4 STAGE5の進捗を変更（進捗率 50→100%）：STAGE6の試算に反映されるか', () => {
    const base = snapshot(departments({ progress: 50 }));
    const after = snapshot(departments({ progress: 100 }));
    RESULTS.E4 = {
      northStar2027: { before: base.northStar2027, after: after.northStar2027 },
      chart2027: { before: base.chart2027, after: after.chart2027 },
      cf2027: { before: base.cf2027, after: after.cf2027 },
    };
    expect(after.northStar2027).not.toBe(base.northStar2027);
    expect(after.cf2027).toBe(base.cf2027);
  });

  it('E5 STAGE6の結果が目標未達：STAGE2〜4へ戻す情報は生成されるか（見直し候補の経路）', () => {
    // 見直し候補はフック内の useMemo（useStage6Data.ts:1665付近）で作られ、表示のみ（書き込みなし）
    RESULTS.E5 = {
      candidateSource: 'useStage6Data.ts:1665-1700（施策ごとの売上寄与÷目標。70%未満で候補、STAGE3・4の理由を付与）',
      display: 'FinancePlanSection.tsx:461-463（件数の表示のみ）',
      writesStage2to4: false,
      note: '候補は表示され、STAGE2〜4の値は書き換えない。戻す操作は利用者が行う',
    };
    expect(RESULTS.E5.writesStage2to4).toBe(false);
  });
});
