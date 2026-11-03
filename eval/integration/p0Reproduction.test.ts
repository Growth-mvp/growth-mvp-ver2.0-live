/* STAGE6 P0 の再現（評価専用。本番DB・実OpenAIには接続しない）。
 * アプリの計算関数（mkBaselineTrajectory・mkBaseFigures・calcYearlyFromKrs・computeStage6FinancePlan・
 * isRevenueLabel・extractMetricFromYearlyPL・guessKindAndBase）をそのまま実行する。
 * 「修正後」の値は、アプリのコードを変えずに入力を変えて同じ関数を再実行した結果であり、修正そのものではない。 */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { mkBaselineTrajectory, mkBaseFigures } from '@/utils/stage6/baseline';
import { calcYearlyFromKrs, extractMetricFromYearlyPL, isRevenueLabel } from '@/utils/stage6/compute';
import { computeStage6FinancePlan } from '@/utils/stage6/financePlanPipeline';
import { guessKindAndBase } from '@/app/okr/_lib/okrModels';
import { FICTIONAL_DEPARTMENTS, FICTIONAL_STRATEGY_ROW } from '../quality/fictionalCompany';

const OUT_DIR = path.join(__dirname, 'results-verify');
const M = 1_000_000;
const RESULTS: Record<string, any> = {};

beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

afterAll(() => {
  writeFileSync(path.join(OUT_DIR, 'p0-reproduction.json'), JSON.stringify(RESULTS, null, 2), 'utf8');
});

/* ---------- 入力（架空企業。基準年の費用・利息・税は、登録データに無いため仮定） ---------- */

const PL = (FICTIONAL_STRATEGY_ROW.financePL as any[]).map((r) =>
  r.year === 2025 ? { ...r, cogs: 620 * M, sga: 258 * M, interest: 5 * M, tax: 14 * M } : r
);
const BS = FICTIONAL_STRATEGY_ROW.financeBS as any[];
const STATE = { financePL: PL, financeBS: BS };

function baseline() {
  const baseTraj = mkBaselineTrajectory(STATE as any)!;
  const baseFigures = mkBaseFigures(STATE as any);
  return { baseTraj, baseFigures };
}

const SCEN = { successRate: 1, synergyRate: 0 };

/** 画面と同じ規則で、KR（種類は作成時と同じ推定関数で決める）を変換する。 */
function krsFromDepartments(): any[] {
  const out: any[] = [];
  for (const dept of FICTIONAL_DEPARTMENTS as any[]) for (const proj of dept.projects) {
    for (const kr of proj.okrsV2 ?? []) {
      const g = guessKindAndBase(kr.label);
      out.push({ id: kr.label, kind: g.kind, label: kr.label, target: kr.target, unit: kr.unit, scope: 'company', baseKey: g.baseKey, due: kr.due });
    }
  }
  return out;
}

function yearlyPick(yearly: any[], years: number[]) {
  return years.map((y) => {
    const r = yearly.find((x) => x.year === y);
    return { year: y, revenue: r?.revenue ?? null, op_income: r?.op_income ?? null };
  });
}

function deltaByYear(a: any[], b: any[], years: number[]) {
  return years.map((y) => {
    const ra = a.find((x) => x.year === y);
    const rb = b.find((x) => x.year === y);
    return { year: y, revenueDelta: (rb?.revenue ?? 0) - (ra?.revenue ?? 0), opDelta: (rb?.op_income ?? 0) - (ra?.op_income ?? 0) };
  });
}

const YEARS = [2025, 2026, 2027, 2028];

/* ---------- P0-1：実績年度にKRの効果が加算される ---------- */

describe('P0-1 実績年度へのKR効果の加算', () => {
  it('入力：基準（実績年 2025）と、KRの積み上げ。出力：2025年（実績年）の売上の変化', () => {
    const { baseTraj, baseFigures } = baseline();
    const krs = krsFromDepartments();
    const noKr = calcYearlyFromKrs({ baseTraj, baseFigures, krs: [], scenario: SCEN } as any);
    const withKr = calcYearlyFromKrs({ baseTraj, baseFigures, krs, scenario: SCEN } as any);
    const delta = deltaByYear(noKr, withKr, YEARS);

    // 修正後の期待値：2025年は実績（930百万円）であり、KRの効果は0。効果は実績の翌年（2026年）以降から。
    // 修正の仮定：基準の開始月を実績年の翌年にする（入力のみ変更して同じ関数を再実行）
    const shiftedTraj = { ...baseTraj, startYm: '2026-01' as any };
    const noKrShift = calcYearlyFromKrs({ baseTraj: shiftedTraj, baseFigures, krs: [], scenario: SCEN } as any);
    const withKrShift = calcYearlyFromKrs({ baseTraj: shiftedTraj, baseFigures, krs, scenario: SCEN } as any);

    RESULTS.P0_1 = {
      input: { baselineStartYm: baseTraj.startYm, baselineEndYm: baseTraj.endYm, krCount: krs.length, krs: krs.map((k) => ({ label: k.label, kind: k.kind, target: k.target, unit: k.unit, due: k.due })) },
      function: 'calcYearlyFromKrs → applyAdd（simulationBridge.ts:212-） → getApplyMonths（simulationBridge.ts:147-160：開始月 = max(基準の開始月, KRの開始月)）',
      root: 'mkBaselineTrajectory は開始月を「最新の実績年の1月」にする（baseline.ts: startYm = `${year}-01`）。KRの開始月が無いため、効果は実績年の1月から加算される',
      outputWithKr: yearlyPick(withKr, YEARS),
      deltaByYear: delta,
      expected: { year2025Delta: 0, note: '2025年は実績（売上930百万円）。効果は2026年以降' },
      whatIfStartAfterActual: { deltaByYear: deltaByYear(noKrShift, withKrShift, [2026, 2027, 2028]), note: '入力の開始月を2026-01にして再実行（アプリのコードは未変更）' },
    };
    // 修正後（Phase 1）：実績年（2025）への効果は0。修正前は +1,133.2百万円（results-verify/p0-before-phase1.json）
    expect(delta.find((d) => d.year === 2025)!.revenueDelta).toBe(0);
    // 修正後（P1b）：新規商談120件（ACQ・件）は財務換算の根拠が無いため売上を変えない。修正前は2026年 +1,133.2百万円
    expect(delta.find((d) => d.year === 2026)!.revenueDelta).toBe(0);
  });
});

/* ---------- P0-2：投資（INVEST）が月次で繰り返し計上される ---------- */

describe('P0-2 INVESTの月次繰り返し計上', () => {
  it('入力：投資計画18百万円（一回限り）。出力：年次の営業利益の変化', () => {
    const { baseTraj, baseFigures } = baseline();
    const invest = { id: 'invest-test', kind: 'INVEST', label: '投資計画', target: 18 * M, unit: 'JPY', scope: 'project', baseKey: 'invest' };
    const noKr = calcYearlyFromKrs({ baseTraj, baseFigures, krs: [], scenario: SCEN } as any);
    const withInvest = calcYearlyFromKrs({ baseTraj, baseFigures, krs: [invest], scenario: SCEN } as any);
    const delta = deltaByYear(noKr, withInvest, YEARS);
    const totalOpDelta = delta.reduce((s, d) => s + d.opDelta, 0);

    // 修正後の期待値：支出は支出月（paymentYm）の一回だけ。2027年1月に支出する想定なら、その年度の損益に−18百万円のみ
    const oneTime = { ...invest, startYm: '2027-01', due: '2027-01' };
    const withOneTime = calcYearlyFromKrs({ baseTraj, baseFigures, krs: [oneTime], scenario: SCEN } as any);

    RESULTS.P0_2 = {
      input: { investAmountYen: 18 * M, dueMonth: null, note: 'KRに期限が無いため、適用期間は基準の開始月〜終了月（全期間）' },
      function: 'buildBridgeDeltas の INVEST（simulationBridge.ts:294-295: applyAdd(deltas.invest, kr.target, applyMonths)）→ financeSimulation.ts:336（fixed += invest × investAlpha(=1.0)）',
      root: 'INVESTの金額（一回限りの総額）を、毎月の固定費として加算している。期限のないKRは全期間の各月に加算される',
      deltaByYear: delta,
      totalOpDeltaOverHorizonYen: totalOpDelta,
      expected: { note: '一回限りの支出は、支出月の一回だけ。損益への影響は−18百万円（その年度のみ）' },
      whatIfOneTimeInMonth: { deltaByYear: deltaByYear(noKr, withOneTime, YEARS), note: '適用期間を2027年1月の一か月に限定して同じ関数を再実行' },
    };
    // 修正後（P1a）：投資目標は営業費用へ毎月加算しない。修正前は毎年 −216百万円
    expect(delta.find((d) => d.year === 2027)!.opDelta).toBe(0);
  });
});

/* ---------- P0-3：売上原価・売上総利益が売上高と誤認される ---------- */

describe('P0-3 売上原価・売上総利益の売上高への誤認', () => {
  it('入力：ラベル。出力：売上の判定と、目標の抽出（extractMetricFromYearlyPL）の結果', () => {
    const labels = ['売上高', '売上原価', '売上総利益', '売上債権比率', '営業収益', '売上成長率', 'Revenue Growth'];
    const judge = labels.map((l) => ({ label: l, isRevenueLabel: isRevenueLabel(l) }));
    // 目標の抽出：売上原価の目標（費用の上限）を、売上の金額として取り出してしまうか
    const yearly = [{ year: 2027, revenue: 1_000 * M, cogs: 620 * M, sga: 258 * M, gross_profit: 380 * M, op_income: 70 * M, margin: 0.07 }];
    const costTargetExtract = extractMetricFromYearlyPL(yearly as any, '売上原価', 2027);
    // ハンドで書くと、売上原価の実績は620百万円、売上高は1,000百万円
    // 候補の判定（修正案：原価・総利益・債権を除外）。修正は未実施。
    const candidate = (l: string) => isRevenueLabel(l) && !/原価|総利益|利益|債権/.test(l);
    RESULTS.P0_3 = {
      input: { labels, targetLabelOrder: ['売上原価', '売上高'], yearly2027: { revenueYen: 1_000 * M, cogsYen: 620 * M } },
      function: 'isRevenueLabel（compute.ts:65-）、extractMetricFromYearlyPL（compute.ts:105-）、useStage6Data の companyTargets.find(isRevenueLabel)',
      root: '判定が「売上」の文字列を含むかで決まるため、原価・総利益・債権を売上として扱う',
      judge,
      extractedForCostTargetYen: costTargetExtract,
      firstRevenueTargetPicked: [{ label: '売上原価', target: 300 }, { label: '売上高', target: 1000 }].find((t) => isRevenueLabel(t.label))?.label,
      candidateFix: labels.map((l) => ({ label: l, current: isRevenueLabel(l), candidate: candidate(l) })),
      expected: { '売上原価': false, '売上総利益': false, '売上高': true, '売上債権比率': false, extractForCostTarget: 'undefined（売上の金額ではない）または原価の値' },
    };
    // 修正後（Phase 1）：売上原価・売上総利益は売上ではない。修正前は売上原価が true、目標抽出は 1,000百万円
    expect(judge.find((j) => j.label === '売上原価')!.isRevenueLabel).toBe(false);
    expect(judge.find((j) => j.label === '売上総利益')!.isRevenueLabel).toBe(false);
    expect(judge.find((j) => j.label === '売上高')!.isRevenueLabel).toBe(true);
    expect(costTargetExtract).toBeUndefined();
  });
});

/* ---------- P0-4：報告率・継続率がACQに分類される ---------- */

describe('P0-4 報告率・継続率のACQ分類', () => {
  it('入力：KRのラベル。出力：推定される種類と、その種類での売上への寄与', () => {
    const labels = ['新規商談数', '保守契約の継続率', '点検報告の当日提出率'];
    const kinds = labels.map((l) => ({ label: l, ...guessKindAndBase(l) }));
    const { baseTraj, baseFigures } = baseline();
    const contrib = labels.map((l, i) => {
      const k = kinds[i];
      const kr = { id: l, kind: k.kind, label: l, target: l === '新規商談数' ? 120 : l.includes('継続') ? 95 : 90, unit: l === '新規商談数' ? '件' : '%', scope: 'company', baseKey: k.baseKey, due: '2027-03' };
      const without = calcYearlyFromKrs({ baseTraj, baseFigures, krs: [], scenario: SCEN } as any);
      const withIt = calcYearlyFromKrs({ baseTraj, baseFigures, krs: [kr], scenario: SCEN } as any);
      return { label: l, kind: k.kind, revenueDeltaByYear: deltaByYear(without, withIt, [2026, 2027]) };
    });
    RESULTS.P0_4 = {
      input: { labels },
      function: 'guessKindAndBase（app/okr/_lib/okrModels.ts:371-392）の既定値 ACQ（どの規則にも当たらないラベル）',
      root: '「継続」「報告」「提出」は規則に無く、既定値のACQになる。%の単位のACQは「改善率」として顧客数に加算される',
      kinds,
      contributionIfAcq: contrib,
      expected: { '保守契約の継続率': '顧客獲得（ACQ）ではない。解約率（CHURN）の定義を利用者が確認する。未確認なら種類を空にする', '点検報告の当日提出率': '業務指標（売上に直接結びつけない）。種類を空にするか、非財務の指標として扱う' },
    };
    // 修正後（Phase 1）：新規商談数は根拠のあるACQのまま。継続率・提出率は非財務の活動指標（ACTIVITY）で、売上へ換算しない
    // 修正前は両方ACQで、継続率 +883.5百万円（2026年）、提出率 +837.0百万円（2026年）を売上に加算していた
    expect(kinds.find((k) => k.label === '新規商談数')!.kind).toBe('ACQ');
    expect(kinds.find((k) => k.label === '保守契約の継続率')!.kind).toBe('ACTIVITY');
    expect(kinds.find((k) => k.label === '点検報告の当日提出率')!.kind).toBe('ACTIVITY');
    for (const label of ['保守契約の継続率', '点検報告の当日提出率']) {
      expect(contrib.find((c) => c.label === label)!.revenueDeltaByYear.every((d: any) => d.revenueDelta === 0)).toBe(true);
    }
  });
});

/* ---------- P0-5：STAGE4のOPEXが営業CFに反映されない ---------- */

describe('P0-5 OPEXの営業CFへの反映', () => {
  it('入力：OPEXの支出（2027年）あり／なし。出力：営業CFの差', () => {
    const base = (withOpex: boolean) => {
      const d = JSON.parse(JSON.stringify(FICTIONAL_DEPARTMENTS));
      const mfg = d[1].projects[0];
      const opexSpend = { category: 'OPEX', recurrence: 'ONE_TIME', paymentYm: '2027-01', amountBasis: 'TOTAL' };
      mfg.skillPlans = withOpex ? [{ id: 'sk-1', skillName: '育成', cost: 18 * M, dueYm: '2027-01', spend: opexSpend }] : [];
      return d;
    };
    const run = (withOpex: boolean) => {
      const r = computeStage6FinancePlan({
        financePL: PL as any, financeBS: BS as any, departments: base(withOpex) as any, fiscalYearEnd: '3',
        domain: { assumptions: { minCashYen: 150 * M, taxRate: 0.3, depreciationYen: 20 * M, arRatio: 128 / 930, inventoryRatio: 72 / 930, apRatio: 79 / 930, targetRevenueYen: 1000 * M, targetOperatingIncomeYen: 70 * M, targetYear: 2027 }, existingLoans: [{ id: 'loan-zero', name: '既存借入（残高ゼロの仮定）', category: 'BANK', balanceYen: 0, annualRate: 0, scheduledPrincipalYen: { 2026: 0, 2027: 0, 2028: 0 } }], newLoans: [], dividendsYen: { 2026: 0, 2027: 0, 2028: 0 } } as any,
        currentYear: 2026,
      } as any);
      return r.plan.years.filter((y: any) => y.kind === 'FORECAST').map((y: any) => ({ year: y.year, operatingIncome: y.operatingIncome?.value ?? null, operatingCf: y.operatingCf?.value ?? null, opexRegisteredYen: y.opexRegistered }));
    };
    const without = run(false);
    const withOpex = run(true);
    RESULTS.P0_5 = {
      input: { opexYen: 18 * M, year: 2027, taxRate: 0.3 },
      function: 'buildCashFlowPlan の営業CF = 税引後利益＋減価償却費−運転資金増加（cashflow.ts:466-468）。税引後利益は目標の営業利益から導く',
      root: 'OPEXは営業利益（目標パス）に含まれず、CFの計算に届かない。opexRegistered は表示だけに使われる',
      withoutOpex: without,
      withOpex,
      expected: {
        note: '営業利益が目標パスのままなら、OPEXは営業CFに現れない（現状）。OPEXを反映するには、営業利益をOPEXを含むPLから得る必要がある。単純に営業CFから控除すると二重計上になる（営業利益が既にOPEXを含む場合）',
        ifOpexReducedOperatingIncomeBy18m_operatingCfDeltaYen: -18 * M * (1 - 0.3),
      },
    };
    expect(withOpex.find((y: any) => y.year === 2027)!.operatingCf).toBe(without.find((y: any) => y.year === 2027)!.operatingCf);
  });
});

/* ---------- P0-6：STAGE1の営業利益実績と基準計算が一致しない ---------- */

describe('P0-6 基準計算の営業利益と実績の不一致', () => {
  it('入力：基準年2025の実績。出力：基準の年次の営業利益と、その内訳', () => {
    const { baseTraj, baseFigures } = baseline();
    const base = calcYearlyFromKrs({ baseTraj, baseFigures, krs: [], scenario: SCEN } as any);
    const y2025 = base.find((y: any) => y.year === 2025)!;
    const bf: any = baseFigures;
    const fixedYear = bf.fixed_cost * 12;
    const variableYear = bf.variable_cost * 12;
    const personnelYear = bf.personnel_cost * 12;
    // simulateMonthlyPL は baseTraj.personnelCostMonthly / fixedCostMonthly を使う（baseFigures.personnel_cost は使われない）
    const withTraj = (fixed: (v: number) => number, personnel: (v: number) => number) => ({
      ...baseTraj,
      fixedCostMonthly: Object.fromEntries(Object.entries(baseTraj.fixedCostMonthly).map(([ym, v]) => [ym, fixed(v as number)])),
      personnelCostMonthly: Object.fromEntries(Object.entries(baseTraj.personnelCostMonthly).map(([ym, v]) => [ym, personnel(v as number)])),
    });
    const personnelZeroed = calcYearlyFromKrs({ baseTraj: withTraj((v) => v, () => 0), baseFigures, krs: [], scenario: SCEN } as any).find((y: any) => y.year === 2025)!;
    const sgaSplitHalf = calcYearlyFromKrs({ baseTraj: withTraj((v) => v / 2, (v) => v), baseFigures, krs: [], scenario: SCEN } as any).find((y: any) => y.year === 2025)!;
    RESULTS.P0_6 = {
      input: { actualBaseYear: 2025, actualRevenueYen: 930 * M, actualOperatingIncomeYen: 52 * M, actualCogsYen: 620 * M, actualSgaYen: 258 * M, storedBaseFiguresOperatingIncomeYen: bf.operatingIncome },
      function: 'mkBaseFigures（baseline.ts:115-196）→ calcYearlyFromKrs → simulateMonthlyPL（financeSimulation.ts:183, 349: op = revenue − (cogs + (fixed + personnel))）',
      root: 'mkBaseFigures は fixed_cost = 販管費÷12 と personnel_cost = 販管費÷2÷12 を両方設定する。費用は販管費の1.5倍になり、人件費が二重計上される。保存された operatingIncome（52）は年次の計算に使われない',
      baseline2025Yearly: { revenue: y2025.revenue, op_income: y2025.op_income },
      decomposition: { revenueYen: y2025.revenue, variableCostYen: variableYear, fixedCostYen: fixedYear, personnelCostYen: personnelYear, impliedOpYen: y2025.revenue - variableYear - fixedYear - personnelYear },
      whatIfPersonnelZeroed: { op_income2025: personnelZeroed.op_income, note: '人件費系列を0にし、販管費258百万円を固定費系列で1回だけ計上（入力データに人件費の内訳が無いため、この方向が整合する。修正は未実施）' },
      whatIfSgaSplitHalf: { op_income2025: sgaSplitHalf.op_income, note: '禁止された修正（営業利益52に合わせるための半分化）。比較のための記録のみ。採用しない' },
      expected: { op_income2025Yen: 52 * M, note: '基準年の営業利益は実績（52百万円）と一致すること' },
    };
    // 修正後（P1c）：販管費は人件費を含む総額として一度だけ計上し、実績の営業利益52百万円を再現する。修正前は −77百万円
    expect(y2025.op_income).toBeCloseTo(52 * M, 0);
  });
});
