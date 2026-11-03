/* STAGE4〜6 統一設計の必要最小限の検証（評価専用。本番DB・実OpenAIには接続しない）。
 * 入力の数値はすべて架空の検証用の値。アプリ本体の計算関数を実行して結果を記録する。 */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { mkBaseFigures, mkBaselineTrajectory } from '@/utils/stage6/baseline';
import { calcYearlyFromKrs } from '@/utils/stage6/compute';
import { fiscalYearOf } from '@/utils/stage6/investmentDemand';
import { FICTIONAL_STRATEGY_ROW } from '../quality/fictionalCompany';

const OUT_DIR = path.join(__dirname, 'results-verify');
const M = 1_000_000;
const R: Record<string, any> = {};
const SCEN = { successRate: 1, synergyRate: 0 };

beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));
afterAll(() => writeFileSync(path.join(OUT_DIR, 'unified-design-probe.json'), JSON.stringify(R, null, 2), 'utf8'));

const PL = (FICTIONAL_STRATEGY_ROW.financePL as any[]).map((r) =>
  r.year === 2025 ? { ...r, cogs: 620 * M, sga: 258 * M, interest: 5 * M, tax: 14 * M } : r
);
const STATE = { financePL: PL, financeBS: FICTIONAL_STRATEGY_ROW.financeBS as any[] };
const mb = (x: number) => Math.round(x / 1e5) / 10;

function run(krs: any[]) {
  const baseTraj = mkBaselineTrajectory(STATE as any)!;
  const baseFigures = mkBaseFigures(STATE as any);
  return calcYearlyFromKrs({ baseTraj, baseFigures, krs, scenario: SCEN } as any);
}
const at = (rows: any[], y: number) => rows.find((r) => r.year === y)!;
const delta = (krs: any[], y: number) => {
  const no = at(run([]), y);
  const w = at(run(krs), y);
  return { revenueMb: mb(w.revenue - no.revenue), opMb: mb(w.op_income - no.op_income) };
};

/* ---------- ケースA：製造原価削減 ---------- */
describe('ケースA：製造原価削減', () => {
  it('既存の変動費KR（%）は、削減率を原価ではなく売上に対して適用する', () => {
    const kr = { id: 'a1', kind: 'COST_VARIABLE', label: '原価削減', target: -5, unit: '%', scope: 'company', baseKey: 'variable_cost', due: '2028-12' };
    const d = delta([kr], 2026);
    R.A1_costVariablePercent = {
      input: { reductionPct: 5, intendedBaseCogsYen: 620 * M, intendedSavingYen: 31 * M },
      measured2026: d,
      intendedAnnualSavingMb: 31,
      revenueBasedSavingMb: 46.5,
      note: '変動費KRの%は売上（qty×arpu）に対する原価率の増減として適用される（simulationBridge.ts:284-286、financeSimulation.ts の cogsRate 分岐）',
    };
    // P1.5 適用後：変動費率KRは売上へ掛けない（修正前は +46.5）
    expect(d.opMb).toBeCloseTo(0, 1);
  });

  it('金額KR（JPY）は月額として毎月加算される。年額を入れると12倍になる', () => {
    const annualSaving = 31 * M;
    const asMonthly = { id: 'a2', kind: 'COST_VARIABLE', label: '原価削減（月額入力）', target: -annualSaving / 12, unit: 'JPY', scope: 'company', baseKey: 'variable_cost', due: '2028-12' };
    const asAnnual = { ...asMonthly, id: 'a3', label: '原価削減（年額入力）', target: -annualSaving };
    R.A2_costVariableJpy = {
      intendedAnnualSavingMb: 31,
      monthlyTargetMb: mb(-annualSaving / 12),
      measured2026WhenMonthlyTarget: delta([asMonthly], 2026),
      measured2026WhenAnnualTarget: delta([asAnnual], 2026),
      note: 'COST_VARIABLE の金額は applyAdd により各月へ同額が入る（simulationBridge.ts:288）',
    };
    // P1.5 適用後：金額の費用KRは期間が不明なため、月額でも年額でも加算しない（修正前は月額 +31、年額 +372）
    expect(R.A2_costVariableJpy.measured2026WhenMonthlyTarget.opMb).toBeCloseTo(0, 1);
    expect(R.A2_costVariableJpy.measured2026WhenAnnualTarget.opMb).toBeCloseTo(0, 1);
  });
});

/* ---------- ケースB：新規顧客開拓 ---------- */
describe('ケースB：新規顧客開拓', () => {
  // 検証用の値：商談10件/月 × 受注率20% × 平均受注額20百万円 = 40百万円/月（売上）
  const monthlyRevenue = 10 * 0.2 * 20 * M;
  const revenueKr = (lag: number) => ({ id: 'b1', kind: 'REVENUE', label: '新規受注（月額売上）', target: monthlyRevenue, unit: 'JPY', scope: 'company', baseKey: 'revenue', due: '2028-12', lagMonths: lag });
  const costKr = { id: 'b2', kind: 'COST_VARIABLE', label: '新規受注の原価', target: monthlyRevenue * 0.4, unit: 'JPY', scope: 'company', baseKey: 'variable_cost', due: '2028-12' };

  it('商談×受注率×平均受注額は、月次の売上として計上でき、計上時期（遅行月）も反映できる', () => {
    R.B1_funnel = {
      input: { meetingsPerMonth: 10, winRatePct: 20, averageDealMb: 20, marketCostRatePct: 40 },
      monthlyRevenueMb: mb(monthlyRevenue),
      yearlyRevenueMb: mb(monthlyRevenue * 12),
      measured2026_lag0: delta([revenueKr(0)], 2026),
      measured2026_lag3: delta([revenueKr(3)], 2026),
      measured2027_lag3: delta([revenueKr(3)], 2027),
    };
    // P1.5 適用後：売上の金額KRは期間が不明なため加算しない（修正前は 480 / 360）
    expect(R.B1_funnel.measured2026_lag0.revenueMb).toBeCloseTo(0, 0);
    expect(R.B1_funnel.measured2026_lag3.revenueMb).toBeCloseTo(0, 0);
  });

  it('売上に原価率を反映するには、既存の変動費デルタを併用する（現状、新規売上に原価はかからない）', () => {
    const withoutCost = delta([revenueKr(0)], 2026);
    const withCost = delta([revenueKr(0), costKr], 2026);
    R.B2_costOfNewRevenue = {
      revenueOnly: withoutCost,
      revenueWithVariableCostRatio40: withCost,
      note: '売上KRだけでは営業利益が売上と同額増える。原価率の入力欄が無い限り、KRの売上から原価を推測しない',
    };
    expect(withoutCost.opMb).toBeCloseTo(withoutCost.revenueMb, 0);
    // P1.5 適用後：売上・原価のどちらもKR経路では加算しない（修正前は 288）
    expect(withCost.opMb).toBeCloseTo(0, 0);
  });

  it('既存の売上換算式（app/okr/page.tsx:89 の式）は期間を持たない', () => {
    const revenueMJPY = 30 * (20 / 100) * 20; // targetCustomers × conversionRatePct × averageDealMJPY
    R.B3_existingImpactFormula = {
      sampleInput: { targetCustomers: 30, conversionRatePct: 20, averageDealMJPY: 20 },
      sampleResultMb: revenueMJPY,
      note: '結果は「年度額」か「期間総額」か未定義。impactRevenueMJPY として保存され、北極星の寄与に使われる（チャート・CFには入らない）',
    };
    expect(revenueMJPY).toBe(120);
  });
});

/* ---------- ケースC：部門間連携改善 ---------- */
describe('ケースC：部門間連携改善', () => {
  it('連携（SYNERGY）KRは、全社の売上に掛からない（P1b 適用後。修正前は売上 +46.5百万円/年）', () => {
    const kr = { id: 'c1', kind: 'SYNERGY', label: '部門間連携の改善', target: 5, unit: '%', scope: 'company', baseKey: 'synergy', due: '2028-12' };
    const d = delta([kr], 2026);
    R.C1_synergy = {
      input: { synergyPct: 5, note: 'KRの値は連携の達成度（検証用）' },
      measured2026: d,
      note: '連携KRは売上全体に倍率として掛かる（financeSimulation.ts の applySynergyTo 既定 revenue）。財務換算の根拠がない場合は、この経路に入れない設計が必要',
    };
    expect(d.revenueMb).toBeCloseTo(0, 1);
  });
});

/* ---------- 暦年と決算年度 ---------- */
describe('暦年（PL・チャート）と決算年度（CF・支出）', () => {
  it('同じ支払月でも、暦年と決算年度の所属が一致しない', () => {
    R.calendarVsFiscal = {
      fiscalYearEnd: 3,
      samples: ['2027-01', '2027-03', '2027-04', '2027-06'].map((ym) => ({ ym, calendarYear: Number(ym.slice(0, 4)), fiscalYear: fiscalYearOf(ym, 3) })),
    };
    expect(fiscalYearOf('2027-06', 3)).toBe(2028);
    expect(fiscalYearOf('2027-01', 3)).toBe(2027);
  });
});
