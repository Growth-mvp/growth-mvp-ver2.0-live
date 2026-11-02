import { computeStage1ValueAnalysis, computeValueAnalysisBundle, computeValueAnalysis } from './valueAnalysis';

const PL = [
  { year: 2021, revenue: 1_000_000_000, operatingIncome: 50_000_000 },
  { year: 2022, revenue: 1_100_000_000, operatingIncome: 66_000_000 },
  { year: 2023, revenue: 1_210_000_000, operatingIncome: 84_700_000 },
  { year: 2024, revenue: 1_331_000_000, operatingIncome: 106_480_000 },
] as any[];

const BS = [{ year: 2024, netAssets: 500_000_000, interestBearingDebt: 200_000_000 }] as any[];

describe('computeStage1ValueAnalysis（STAGE1 と CEO チャットの共通算出）', () => {
  it('正常な PL/BS で 5 指標が手計算と一致する', () => {
    const { company } = computeStage1ValueAnalysis({ financePL: PL, financeBS: BS, pbrManual: '1.5' });
    expect(company.revenueCagrPct).toBeCloseTo(10, 6); // (1331/1000)^(1/3)-1
    expect(company.operatingMarginPctLatest).toBeCloseTo(8, 6); // 106.48 / 1331
    expect(company.roic).toBeCloseTo(10.648, 6); // 106.48*0.7 / (500+200)
    expect(company.pbr).toBe(1.5);
    expect(company.meta?.basis?.years).toEqual([2021, 2022, 2023, 2024]);
    expect(company.meta?.basis?.latestYear).toBe(2024);
  });

  it('PL がある場合は、既存の PL/BS 算出（computeValueAnalysisBundle）と同じ値になる', () => {
    const shared = computeStage1ValueAnalysis({ financePL: PL, financeBS: BS, pbrManual: '1.5' }).company;
    const direct = computeValueAnalysisBundle({ companyPL: PL, companyBS: BS, pbrManual: '1.5' }).company;
    expect({
      revenueCagrPct: shared.revenueCagrPct,
      operatingMarginPctLatest: shared.operatingMarginPctLatest,
      roic: shared.roic,
      pbr: shared.pbr,
      debtEquityRatio: shared.debtEquityRatio,
    }).toEqual({
      revenueCagrPct: direct.revenueCagrPct,
      operatingMarginPctLatest: direct.operatingMarginPctLatest,
      roic: direct.roic,
      pbr: direct.pbr,
      debtEquityRatio: direct.debtEquityRatio,
    });
  });

  it('PL がない場合は financeSummary の既存算出（computeValueAnalysis）を使う', () => {
    const summary = [
      { year: 2021, revenue: 1_000_000_000, operating_income: 50_000_000 },
      { year: 2024, revenue: 1_331_000_000, operating_income: 106_480_000 },
    ] as any[];
    const shared = computeStage1ValueAnalysis({ financeSummary: summary, financeBS: BS }).company;
    const direct = computeValueAnalysis({ financeSummary: summary, financeBS: BS });
    expect(shared.revenueCagrPct).toBeCloseTo(10, 6);
    expect(shared.operatingMarginPctLatest).toBeCloseTo(8, 6);
    expect(shared.revenueCagrPct).toBe(direct.revenueCagrPct);
    expect(shared.operatingMarginPctLatest).toBe(direct.operatingMarginPctLatest);
  });

  it('単位が円でも百万円でも、同じ比率になる（比率は単位に依存しない）', () => {
    const scale = (n: number) => n / 1_000_000;
    const plM = PL.map((r) => ({ ...r, revenue: scale(r.revenue), operatingIncome: scale(r.operatingIncome) }));
    const bsM = BS.map((r) => ({ ...r, netAssets: scale(r.netAssets), interestBearingDebt: scale(r.interestBearingDebt) }));
    const yen = computeStage1ValueAnalysis({ financePL: PL, financeBS: BS, pbrManual: '1.5' }).company;
    const million = computeStage1ValueAnalysis({ financePL: plM, financeBS: bsM, pbrManual: '1.5' }).company;
    expect(million.revenueCagrPct).toBeCloseTo(yen.revenueCagrPct as number, 9);
    expect(million.operatingMarginPctLatest).toBeCloseTo(yen.operatingMarginPctLatest as number, 9);
    expect(million.roic).toBeCloseTo(yen.roic as number, 9);
  });

  it('最新年の売上が0なら、営業利益率を出さない（0%や無限大を作らない）', () => {
    const pl = [...PL.slice(0, 3), { year: 2024, revenue: 0, operatingIncome: 0 }] as any[];
    const { company } = computeStage1ValueAnalysis({ financePL: pl, financeBS: BS });
    expect(company.operatingMarginPctLatest).toBeUndefined();
    expect(company.revenueCagrPct).toBeCloseTo(10, 6); // 売上>0 の 2021→2023
  });

  it('赤字の場合は負の値を示し、ROIC は参考値の注記を付ける', () => {
    const pl = [...PL.slice(0, 3), { year: 2024, revenue: 1_331_000_000, operatingIncome: -20_000_000 }] as any[];
    const { company } = computeStage1ValueAnalysis({ financePL: pl, financeBS: BS });
    expect(company.operatingMarginPctLatest).toBeLessThan(0);
    expect(company.roic).toBeCloseTo(-2, 6); // -20*0.7 / 700
    expect(company.meta?.notes?.join('\n')).toContain('参考値');
  });

  it('貸借対照表がなければ ROIC と D/E は出さない（推定値で埋めない）', () => {
    const { company } = computeStage1ValueAnalysis({ financePL: PL, financeBS: [] });
    expect(company.roic).toBeUndefined();
    expect(company.debtEquityRatio).toBeUndefined();
    expect(company.revenueCagrPct).toBeCloseTo(10, 6);
  });

  it('PBR 手入力がなければ PBR は未設定になる', () => {
    expect(computeStage1ValueAnalysis({ financePL: PL, financeBS: BS, pbrManual: '' }).company.pbr).toBeUndefined();
  });

  it('データが何もなければ、すべて未設定（捏造しない）', () => {
    const { company } = computeStage1ValueAnalysis({});
    expect(company.revenueCagrPct).toBeUndefined();
    expect(company.operatingMarginPctLatest).toBeUndefined();
    expect(company.roic).toBeUndefined();
    expect(company.pbr).toBeUndefined();
  });

  it('セグメント PL があれば、セグメントの算出も返す', () => {
    const { segments } = computeStage1ValueAnalysis({
      financePL: PL,
      financeBS: BS,
      segmentPL: { 事業A: PL },
    });
    expect(Object.keys(segments ?? {})).toEqual(['事業A']);
  });
});
