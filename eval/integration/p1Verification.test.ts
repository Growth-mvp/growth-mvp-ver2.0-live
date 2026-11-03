/* STAGE6 P1a・P1b・P1c の修正前後の比較（評価専用。本番DB・実OpenAIには接続しない）。
 * 架空企業のデータと、検証専用の架空の数値だけを使う。
 * 出力: results-verify/p1-<P1_TAG>.json（既定 current） */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { mkBaseFigures, mkBaselineTrajectory } from '@/utils/stage6/baseline';
import { calcYearlyFromKrs } from '@/utils/stage6/compute';
import { computeStage6FinancePlan } from '@/utils/stage6/financePlanPipeline';
import { guessKindAndBase } from '@/app/okr/_lib/okrModels';
import { FICTIONAL_DEPARTMENTS, FICTIONAL_STRATEGY_ROW } from '../quality/fictionalCompany';

const OUT_DIR = path.join(__dirname, 'results-verify');
const TAG = process.env.P1_TAG ?? 'current';
const M = 1_000_000;
const R: Record<string, any> = {};
const SCEN = { successRate: 1, synergyRate: 0 };

beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));
afterAll(() => writeFileSync(path.join(OUT_DIR, `p1-${TAG}.json`), JSON.stringify(R, null, 2), 'utf8'));

const PL = (FICTIONAL_STRATEGY_ROW.financePL as any[]).map((r) =>
  r.year === 2025 ? { ...r, cogs: 620 * M, sga: 258 * M, interest: 5 * M, tax: 14 * M } : r
);
const BS = FICTIONAL_STRATEGY_ROW.financeBS as any[];
const STATE = { financePL: PL, financeBS: BS };
const mb = (x: number) => Math.round(x / 1e5) / 10;
const at = (rows: any[], y: number) => rows.find((r) => r.year === y)!;
const YEARS = [2025, 2026, 2027, 2028];

function calc(krs: any[], scenario = SCEN) {
  const baseTraj = mkBaselineTrajectory(STATE as any)!;
  const baseFigures = mkBaseFigures(STATE as any);
  return calcYearlyFromKrs({ baseTraj, baseFigures, krs, scenario } as any);
}
function deltas(krs: any[], scenario = SCEN, baseScenario = SCEN) {
  const no = calc([], baseScenario);
  const w = calc(krs, scenario);
  return YEARS.map((y) => ({
    year: y,
    revenueMb: mb(at(w, y).revenue - at(no, y).revenue),
    opMb: mb(at(w, y).op_income - at(no, y).op_income),
  }));
}
const kr = (o: any) => ({ scope: 'company', baseKey: 'acq', ...o });

describe('P1c：販管費と人件費（基準）', () => {
  it('実績年の売上と営業利益、基準の費用の内訳', () => {
    const base = calc([]);
    const y25 = at(base, 2025);
    const bf: any = mkBaseFigures(STATE as any);
    R.P1c_baseline = {
      revenue2025Mb: mb(y25.revenue),
      op2025Mb: mb(y25.op_income),
      actualOp2025Mb: 52,
      baseFiguresFixedCostMonthlyMb: mb(bf.fixed_cost),
      baseFiguresPersonnelCostMonthlyMb: mb(bf.personnel_cost),
      costTotal2025Mb: mb(y25.revenue - y25.op_income),
    };
    expect(R.P1c_baseline.op2025Mb).toBeDefined();
  });
});

describe('P1a：INVEST型KR', () => {
  it('投資目標の金額は、営業利益へ毎月加算されない', () => {
    const inv = kr({ id: 'inv-1', kind: 'INVEST', label: '投資計画', target: 18 * M, unit: 'JPY', baseKey: 'invest' });
    R.P1a_investNoSpend = { deltas: deltas([inv]) };
    expect(R.P1a_investNoSpend.deltas).toBeDefined();
  });

  it('支出条件（CAPEX・支払月）つきのINVESTは、資金計画の投資CFに一度だけ計上される（PLには入らない）', () => {
    const d = JSON.parse(JSON.stringify(FICTIONAL_DEPARTMENTS));
    const proj = d[1].projects[0];
    proj.okrsV2 = [...(proj.okrsV2 ?? []), {
      id: 'inv-2', kind: 'INVEST', label: '投資計画（支出条件あり）', target: 18 * M, unit: 'JPY', scope: 'project', baseKey: 'invest',
      due: '2027-01', spend: { category: 'CAPEX', recurrence: 'ONE_TIME', paymentYm: '2027-01', amountBasis: 'TOTAL' },
    }];
    const inv = kr({ id: 'inv-2', kind: 'INVEST', label: '投資計画（支出条件あり）', target: 18 * M, unit: 'JPY', baseKey: 'invest', due: '2027-01' });
    const plan = (departments: any) => computeStage6FinancePlan({
      financePL: PL as any, financeBS: BS as any, departments, fiscalYearEnd: '3',
      domain: { assumptions: { minCashYen: 150 * M, taxRate: 0.3, depreciationYen: 20 * M, arRatio: 128 / 930, inventoryRatio: 72 / 930, apRatio: 79 / 930, targetRevenueYen: 1000 * M, targetOperatingIncomeYen: 70 * M, targetYear: 2027 }, existingLoans: [{ id: 'loan-zero', name: '既存借入（残高ゼロの仮定）', category: 'BANK', balanceYen: 0, annualRate: 0, scheduledPrincipalYen: { 2026: 0, 2027: 0, 2028: 0 } }], newLoans: [], dividendsYen: { 2026: 0, 2027: 0, 2028: 0 } } as any,
      currentYear: 2026,
    } as any).plan.years.filter((y: any) => y.kind === 'FORECAST').map((y: any) => ({
      year: y.year, capexMb: mb(y.capex?.value ?? 0), investingCfMb: mb(y.investingCf?.value ?? 0),
      operatingCfMb: mb(y.operatingCf?.value ?? 0), operatingIncomeMb: mb(y.operatingIncome?.value ?? 0),
    }));
    R.P1a_investWithSpend = { deltasPl: deltas([inv]), planWithKr: plan(d), planWithoutKr: plan(JSON.parse(JSON.stringify(FICTIONAL_DEPARTMENTS))) };
    expect(R.P1a_investWithSpend.planWithKr).toBeDefined();
  });
});

describe('P1b：根拠のない売上換算', () => {
  it('新規商談120件・継続率95%・提出率90%（保存済みのACQ分類を含む）', () => {
    const acq = (label: string, target: number, unit: string, due: string) => kr({ id: label, kind: 'ACQ', label, target, unit, due, scope: 'company' });
    R.P1b_acq = {
      newBusiness120: deltas([acq('新規商談数', 120, '件', '2027-03')]),
      retention95pct: deltas([acq('保守契約の継続率', 95, '%', '2027-06')]),
      submission90pct: deltas([acq('点検報告の当日提出率', 90, '%', '2027-01')]),
    };
    expect(R.P1b_acq.newBusiness120).toBeDefined();
  });

  it('連携（SYNERGY）KRとシナリオの連携率は、全社売上へ掛からない', () => {
    const syn = kr({ id: 'syn', kind: 'SYNERGY', label: '部門間連携', target: 5, unit: '%', baseKey: 'synergy', due: '2028-12' });
    R.P1b_synergy = {
      synergyKr5pct: deltas([syn]),
      scenarioHighSynergy10pct: deltas([], { successRate: 1, synergyRate: 0.1 }, SCEN),
      scenarioLowSynergyMinus5pct: deltas([], { successRate: 1, synergyRate: -0.05 }, SCEN),
    };
    expect(R.P1b_synergy.synergyKr5pct).toBeDefined();
  });

  it('その他の金額・率KR（変更対象外）の計算結果を記録する', () => {
    const cost = kr({ id: 'cf', kind: 'COST_FIXED', label: '固定費の増加', target: 1 * M, unit: 'JPY', baseKey: 'fixed_cost', due: '2028-12' });
    const churn = kr({ id: 'ch', kind: 'CHURN', label: '解約率の改善', target: 1, unit: '%', baseKey: 'churn', due: '2028-12' });
    R.others = { COST_FIXED_1Mb: deltas([cost]), CHURN_1pct: deltas([churn]) };
    expect(R.others).toBeDefined();
  });
});

describe('既存の全KR（架空企業）', () => {
  it('STAGE4のKR全体を計算に入れたときの差分', () => {
    const krs: any[] = [];
    for (const d of FICTIONAL_DEPARTMENTS as any[]) for (const p of d.projects) for (const k of p.okrsV2 ?? []) {
      const g = guessKindAndBase(k.label);
      krs.push({ id: k.label, kind: g.kind, label: k.label, target: k.target, unit: k.unit, scope: 'company', baseKey: g.baseKey, due: k.due });
    }
    R.allFictionalKrs = { count: krs.length, kinds: krs.map((k) => ({ label: k.label, kind: k.kind })), deltas: deltas(krs) };
    expect(R.allFictionalKrs.count).toBeGreaterThan(0);
  });
});
