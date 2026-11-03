/* STAGE6 Phase 1.5（残存するKR自動換算）の修正前後の比較。評価専用（本番DB・実OpenAIには接続しない）。
 * 架空企業のデータと、検証専用の架空の数値だけを使う。
 * 出力: results-verify/p15-<P15_TAG>.json（既定 current） */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { mkBaseFigures, mkBaselineTrajectory } from '@/utils/stage6/baseline';
import { buildProjectContributions, calcYearlyFromKrs } from '@/utils/stage6/compute';
import { FICTIONAL_STRATEGY_ROW } from '../quality/fictionalCompany';

const OUT_DIR = path.join(__dirname, 'results-verify');
const TAG = process.env.P15_TAG ?? 'current';
const M = 1_000_000;
const R: Record<string, any> = {};
const SCEN = { successRate: 1, synergyRate: 0 };

beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));
afterAll(() => writeFileSync(path.join(OUT_DIR, `p15-${TAG}.json`), JSON.stringify(R, null, 2), 'utf8'));

const PL = (FICTIONAL_STRATEGY_ROW.financePL as any[]).map((r) =>
  r.year === 2025 ? { ...r, cogs: 620 * M, sga: 258 * M, interest: 5 * M, tax: 14 * M } : r
);
const STATE = { financePL: PL, financeBS: FICTIONAL_STRATEGY_ROW.financeBS as any[] };
const mb = (x: number) => Math.round(x / 1e5) / 10;
const at = (rows: any[], y: number) => rows.find((r) => r.year === y)!;
const YEARS = [2025, 2026, 2027, 2028];

function calc(krs: any[]) {
  return calcYearlyFromKrs({
    baseTraj: mkBaselineTrajectory(STATE as any)!,
    baseFigures: mkBaseFigures(STATE as any),
    krs,
    scenario: SCEN,
  } as any);
}
function deltas(krs: any[]) {
  const no = calc([]);
  const w = calc(krs);
  return YEARS.map((y) => ({
    year: y,
    revenueMb: mb(at(w, y).revenue - at(no, y).revenue),
    opMb: mb(at(w, y).op_income - at(no, y).op_income),
  }));
}
const kr = (o: any) => ({ scope: 'company', baseKey: 'acq', due: '2028-12', ...o, id: o.label });

function contribution(krs: any[]) {
  const baseTraj = mkBaselineTrajectory(STATE as any)!;
  const baseFigures = mkBaseFigures(STATE as any);
  const baselineYearly = calc([]);
  const core = {
    ready: true,
    approved: [{ key: 'p1', dept: '検証部', proj: '検証プロジェクト', investTotal: 0, krCount: krs.length }],
    projectKrsMap: new Map([['p1', krs]]),
    baselineYearly,
  };
  const rows = buildProjectContributions({
    core,
    financePL: STATE.financePL,
    departments: [],
    effectiveSelectedKeys: ['p1'],
    mkBaseFigures: () => baseFigures,
    mkBaselineTrajectory: () => baseTraj,
    getEvidenceFromProject: () => ({ source: 'estimated', confidence: 'low' }),
    executionWeightsMap: new Map(),
  } as any);
  const r = rows[0] as any;
  return r ? { deltaRevenueMb: mb(r.deltaRevenueTotal ?? 0), deltaOpMb: mb(r.deltaOpTotal ?? 0), krCount: r.krCount } : null;
}

const CASES: Record<string, any> = {
  REVENUE_40Mb_per_month: kr({ id: 'rev', kind: 'REVENUE', label: '新規受注（月額）', target: 40 * M, unit: 'JPY' }),
  ARPU_10pct: kr({ kind: 'ARPU', label: '単価改善', target: 10, unit: '%' }),
  ARPU_100000yen: kr({ kind: 'ARPU', label: '単価改善（円）', target: 100000, unit: 'JPY' }),
  CHURN_1pct: kr({ kind: 'CHURN', label: '解約率の改善', target: 1, unit: '%' }),
  CHURN_5pct_labelled_retention: kr({ kind: 'CHURN', label: '継続率改善', target: 5, unit: '%' }),
  COST_FIXED_1Mb_per_month: kr({ kind: 'COST_FIXED', label: '固定費の増加', target: 1 * M, unit: 'JPY' }),
  COST_VARIABLE_1Mb_per_month: kr({ kind: 'COST_VARIABLE', label: '変動費の増加', target: 1 * M, unit: 'JPY' }),
  COST_VARIABLE_minus5pct: kr({ kind: 'COST_VARIABLE', label: '変動費率の改善', target: -5, unit: '%' }),
  PERSONNEL_1Mb_per_month: kr({ kind: 'PERSONNEL', label: '人員計画', target: 1 * M, unit: 'JPY' }),
  SUCCESS_RATE_80pct: kr({ kind: 'SUCCESS_RATE', label: '成約率', target: 80, unit: '%' }),
  INVEST_18Mb_no_spend: kr({ kind: 'INVEST', label: '投資計画', target: 18 * M, unit: 'JPY' }),
  ACQ_18_32pct: kr({ kind: 'ACQ', label: '改善率', target: 18.32, unit: '%' }),
};

describe('Phase 1.5：KRの種類ごとの財務換算（バケットの計算）', () => {
  it('残存する金額型・率型KRの計算結果を記録する', () => {
    R.bridge = Object.fromEntries(Object.entries(CASES).map(([k, v]) => [k, deltas([v])]));
    expect(R.bridge).toBeDefined();
  });
});

describe('Phase 1.5：プロジェクト別の寄与（TabImpactの表示元）', () => {
  it('単独のKRごとの寄与（計算値＋フォールバック）を記録する', () => {
    R.contribution = Object.fromEntries(Object.entries(CASES).map(([k, v]) => [k, contribution([v])]));
    expect(R.contribution).toBeDefined();
  });
});
