/* STAGE6 P0 Phase 2 の調査用（評価専用。本番DB・実OpenAIには接続しない）。
 * アプリの計算関数をそのまま実行し、数値を記録する。アプリ本体は変更しない。
 * 記録した「現状」の値は、修正が行われるまでの基準であり、正しさの保証ではない。 */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { mkBaseFigures, mkBaselineTrajectory } from '@/utils/stage6/baseline';
import { calcYearlyFromKrs } from '@/utils/stage6/compute';
import { computeStage6FinancePlan } from '@/utils/stage6/financePlanPipeline';
import { buildInvestmentDemandSummary } from '@/utils/stage6/investmentDemand';
import { guessKindAndBase } from '@/app/okr/_lib/okrModels';
import { FICTIONAL_DEPARTMENTS, FICTIONAL_STRATEGY_ROW } from '../quality/fictionalCompany';

const OUT_DIR = path.join(__dirname, 'results-verify');
const M = 1_000_000;
const R: Record<string, any> = {};
const SCEN = { successRate: 1, synergyRate: 0 };

beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));
afterAll(() => writeFileSync(path.join(OUT_DIR, 'phase2-probe.json'), JSON.stringify(R, null, 2), 'utf8'));

const PL = (FICTIONAL_STRATEGY_ROW.financePL as any[]).map((r) =>
  r.year === 2025 ? { ...r, cogs: 620 * M, sga: 258 * M, interest: 5 * M, tax: 14 * M } : r
);
const BS = FICTIONAL_STRATEGY_ROW.financeBS as any[];
const STATE = { financePL: PL, financeBS: BS };
const mb = (x: number) => Math.round(x / 1e5) / 10;

function baseline() {
  return { baseTraj: mkBaselineTrajectory(STATE as any)!, baseFigures: mkBaseFigures(STATE as any) };
}
function yearly(krs: any[], traj?: any) {
  const { baseTraj, baseFigures } = baseline();
  return calcYearlyFromKrs({ baseTraj: traj ?? baseTraj, baseFigures, krs, scenario: SCEN } as any);
}
const at = (rows: any[], y: number) => rows.find((r) => r.year === y)!;

/* ---------- 1. P0-6：販管費と人件費 ---------- */
describe('1. P0-6 販管費と人件費の計上', () => {
  it('現状の内訳と、人件費の割合を変えた時の営業利益（総額が1回だけ計上されるか）', () => {
    const { baseTraj, baseFigures } = baseline();
    const v = baseTraj.fixedCostMonthly[Object.keys(baseTraj.fixedCostMonthly)[0] as any] as number;
    const p = baseTraj.personnelCostMonthly[Object.keys(baseTraj.personnelCostMonthly)[0] as any] as number;
    const withSplit = (fixedMul: number, persMul: number) => ({
      ...baseTraj,
      fixedCostMonthly: Object.fromEntries(Object.keys(baseTraj.fixedCostMonthly).map((k) => [k, v * fixedMul])),
      personnelCostMonthly: Object.fromEntries(Object.keys(baseTraj.personnelCostMonthly).map((k) => [k, v * persMul])),
    });
    const op = (t: any) => at(yearly([], t), 2025).op_income;
    const cur = at(yearly([]), 2025);
    const sgaYear = 258 * M;
    R.P0_6 = {
      stage1Input: { revenue2025: 930 * M, cogs2025: 620 * M, sga2025: sgaYear, operatingIncome2025: 52 * M },
      code: 'baseline.ts:170-172（固定費=sga/12、人件費=sga/2/12）、baseline.ts:297-300（系列も同じ）、financeSimulation.ts（sga=fixed+personnel、op=revenue−(cogs+sga)）',
      currentMonthlyFixedYen: v,
      currentMonthlyPersonnelYen: p,
      currentCostTotal2025Yen: cur.revenue - cur.op_income,
      currentOp2025Yen: cur.op_income,
      sgaCountedTimes: (v * 12 + p * 12) / sgaYear,
      byPersonnelShare: {
        current_fixed_1_0_personnel_0_5: mb(op(baseTraj)),
        personnel_0_fixed_1_0: mb(op(withSplit(1, 0))),
        personnel_40pct: mb(op(withSplit(0.6, 0.4))),
        personnel_60pct: mb(op(withSplit(0.4, 0.6))),
      },
      personnelUsedBy: ['simulateMonthlyPL（PL の SG&A と営業利益）のみ。cashflow.ts は営業利益を目標パスから取るため人件費系列を使わない'],
      personnelKrEffect: null as any,
    };
    // 人件費KR（PERSONNEL）は月額として加算される（applyAdd）。人件費系列を0にした場合のKR効果を記録
    const personnelKr = { id: 'p1', kind: 'PERSONNEL', label: '人員計画', target: 1 * M, unit: 'JPY', scope: 'company', baseKey: 'personnel_cost', due: '2027-12' };
    const noKr = yearly([], withSplit(1, 0));
    const withKr = yearly([personnelKr], withSplit(1, 0));
    R.P0_6.personnelKrEffect = {
      target1MYenPerKr: 1 * M,
      opDeltaByYear: [2026, 2027].map((y) => ({ year: y, opDeltaMb: mb(at(withKr, y).op_income - at(noKr, y).op_income) })),
    };
    // P1c 適用後：人件費の系列は0。割合を変えても総額は販管費258百万円の1回分で、営業利益は52
    expect(R.P0_6.sgaCountedTimes).toBeCloseTo(1, 5);
    expect(R.P0_6.byPersonnelShare.personnel_40pct).toBeCloseTo(52, 1);
    expect(R.P0_6.byPersonnelShare.personnel_0_fixed_1_0).toBeCloseTo(52, 1);
    expect(R.P0_6.byPersonnelShare.current_fixed_1_0_personnel_0_5).toBeCloseTo(52, 1);
  });
});

/* ---------- 2. P0-2：INVEST・CAPEX・OPEX ---------- */
describe('2. P0-2 INVESTの扱いと、PL・CFの二重計上', () => {
  it('INVEST KRが支出条件を持つ場合、PLの費用とCFの投資が同じ金額を二度計上する', () => {
    const d = JSON.parse(JSON.stringify(FICTIONAL_DEPARTMENTS));
    const proj = d[1].projects[0];
    proj.okrsV2 = [...(proj.okrsV2 ?? []), {
      id: 'inv-1', kind: 'INVEST', label: '投資計画', target: 18 * M, unit: 'JPY', scope: 'project', baseKey: 'invest',
      due: '2027-01', spend: { category: 'CAPEX', recurrence: 'ONE_TIME', paymentYm: '2027-01', amountBasis: 'TOTAL' },
    }];
    const krs = [{ id: 'inv-1', kind: 'INVEST', label: '投資計画', target: 18 * M, unit: 'JPY', scope: 'project', baseKey: 'invest', due: '2027-01' }];
    const pl = yearly(krs);
    const plNo = yearly([]);
    const run = (departments: any) => computeStage6FinancePlan({
      financePL: PL as any, financeBS: BS as any, departments, fiscalYearEnd: '3',
      domain: { assumptions: { minCashYen: 150 * M, taxRate: 0.3, depreciationYen: 20 * M, arRatio: 128 / 930, inventoryRatio: 72 / 930, apRatio: 79 / 930, targetRevenueYen: 1000 * M, targetOperatingIncomeYen: 70 * M, targetYear: 2027 }, existingLoans: [{ id: 'loan-zero', name: '既存借入（残高ゼロの仮定）', category: 'BANK', balanceYen: 0, annualRate: 0, scheduledPrincipalYen: { 2026: 0, 2027: 0, 2028: 0 } }], newLoans: [], dividendsYen: { 2026: 0, 2027: 0, 2028: 0 } } as any,
      currentYear: 2026,
    } as any).plan.years.filter((y: any) => y.kind === 'FORECAST').map((y: any) => ({
      year: y.year,
      capex: y.capex?.value ?? null,
      investingCf: y.investingCf?.value ?? null,
      depreciation: y.depreciation?.value ?? null,
    }));
    const cf = run(d);
    const cfNo = run(JSON.parse(JSON.stringify(FICTIONAL_DEPARTMENTS)));
    const summary = buildInvestmentDemandSummary(d as any, '3');
    R.P0_2 = {
      inputs: { investKrTargetYen: 18 * M, dueYm: '2027-01', spend: { category: 'CAPEX', recurrence: 'ONE_TIME', paymentYm: '2027-01' } },
      pl_opDeltaMbByYear: [2026, 2027, 2028].map((y) => ({ year: y, mb: mb(at(pl, y).op_income - at(plNo, y).op_income) })),
      cf_byYear: cf.map((y: any) => ({ year: y.year, capexMb: mb(y.capex ?? 0), investingCfMb: mb(y.investingCf ?? 0), depreciationMb: mb(y.depreciation ?? 0) })),
      cfWithoutInvestKrByYear: cfNo.map((y: any) => ({ year: y.year, capexMb: mb(y.capex ?? 0), depreciationMb: mb(y.depreciation ?? 0) })),
      investmentSummary: { yearlyByCategory: summary.yearlyByCategory, unclassifiedYen: summary.unclassifiedYen },
    };
    // 同じ18百万円が、PL（2026-01〜2027-01の13か月）とCF（2027年の資本的支出）の両方に入る
    const plTotal = R.P0_2.pl_opDeltaMbByYear.reduce((s: number, r: any) => s + r.mb, 0);
    // P1a 適用後：投資目標はPLに入らず、PLの合計は0。CFのCAPEXは支出条件から一度だけ計上される
    expect(plTotal).toBe(0);
    expect(R.P0_2.cf_byYear.find((y: any) => y.year === 2027).capexMb).toBeCloseTo(18, 1);
    expect(R.P0_2.cf_byYear.map((y: any) => y.depreciationMb)).toEqual(R.P0_2.cfWithoutInvestKrByYear.map((y: any) => y.depreciationMb));
  });
});

/* ---------- 3. 既存KRの分類と売上換算（ACQ） ---------- */
describe('3. 既存KRの分類と売上換算', () => {
  const ratio2026 = (kr: any) => {
    const no = at(yearly([]), 2026).revenue;
    const w = at(yearly([kr]), 2026).revenue;
    return w / no;
  };
  const acq = (label: string, target: number, unit: string) => ({
    id: label, kind: 'ACQ', label, target, unit, scope: 'company', baseKey: 'acq', due: '2028-12',
  });

  it('P1b 適用後：ACQ（件数・率）は売上への倍率を変えない（修正前は大きさで倍率が変わっていた）', () => {
    const cases = {
      '件120': ratio2026(acq('新規商談数', 120, '件')),
      '件2': ratio2026(acq('新規商談数', 2, '件')),
      '件1': ratio2026(acq('新規商談数', 1, '件')),
      '件0.5': ratio2026(acq('新規商談数', 0.5, '件')),
      '%95': ratio2026(acq('保守契約の継続率', 95, '%')),
      '%90': ratio2026(acq('点検報告の当日提出率', 90, '%')),
      '%120': ratio2026(acq('改善率', 120, '%')),
      '%1.2': ratio2026(acq('改善率', 1.2, '%')),
      '%18.32': ratio2026(acq('改善率', 18.32, '%')),
    };
    const base2026 = at(yearly([]), 2026).revenue;
    R.P0_3 = {
      formulaCheck: 'simulateMonthlyPL（financeSimulation.ts:243-258付近）: acqCoefficient = dAcq>1 ? dAcq/100 : dAcq。ACQの delta は simulationBridge.ts:242 で 件=target、%=target/100 のまま渡る。毎月 qty×(1+coefficient)',
      base2026RevenueMb: mb(base2026),
      ratio2026: cases,
      deltaMb2026ForCount120: mb(base2026 * (cases['件120'] - 1)),
      expectedIfPercentOf120: { ratio: 1 + 120 / 100, deltaMb: mb(base2026 * 1.2) },
      krKindAfterPhase1: { 新規商談数: guessKindAndBase('新規商談数').kind, 保守契約の継続率: guessKindAndBase('保守契約の継続率').kind, 点検報告の当日提出率: guessKindAndBase('点検報告の当日提出率').kind },
      note: '件の目標は「期間内の件数」で、月次の割合ではない。売上へ換算する単価・成約率・期間の定義がデータに無い',
    };
    for (const v of Object.values(cases)) expect(v).toBeCloseTo(1, 6);
  });
});

/* ---------- 4. 金額型KRは毎月繰り返し計上される（P0-2・P0-6 共通） ---------- */
describe('4. 金額型KRの期間の扱い', () => {
  it('期限のない金額KRは、各月に同額が加算される（年額換算の仮定が無い）', () => {
    const krs = (kind: string, label: string) => [{ id: label, kind, label, target: 1 * M, unit: 'JPY', scope: 'company', baseKey: kind === 'COST_FIXED' ? 'fixed_cost' : 'invest' }];
    const no = yearly([]);
    const cost = yearly(krs('COST_FIXED', '固定費の増加'));
    R.P0_4 = {
      target1MYen: 1 * M,
      COST_FIXED_opDeltaMbByYear: [2026, 2027].map((y) => ({ year: y, mb: mb(at(cost, y).op_income - at(no, y).op_income) })),
    };
    // P1.5 適用後：金額型の費用KRは財務換算の根拠が無いため0（修正前は年 −12）
    expect(mb(at(cost, 2026).op_income - at(no, 2026).op_income)).toBeCloseTo(0, 1);
  });
});
