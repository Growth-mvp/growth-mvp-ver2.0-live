import { computeROICFromPLBS, computeStage1ValueAnalysis, computeValueAnalysisBundle, computeValueAnalysis } from './valueAnalysis';

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

describe('ROIC の税率（実効税率 = 法人税等 ÷ 税引前利益）', () => {
  const BS = [{ year: 2024, netAssets: 500, interestBearingDebt: 200 }]; // 投下資本 700
  const roicOf = (pl: Record<string, number>) => computeROICFromPLBS([{ year: 2024, ...pl }] as any, BS as any);

  it('正常値：税引前利益90・法人税等27なら実効税率30%、NOPAT70、ROIC10%', () => {
    const r = roicOf({ operatingIncome: 100, interest: 10, tax: 27 });
    expect(r.roic).toBeCloseTo(10, 6);
    expect(r.meta.join('|')).not.toContain('税率は仮定値');
  });

  it('利益0：NOPATを出せず、ROICは出さない', () => {
    expect(roicOf({ operatingIncome: 0, interest: 0, tax: 0 }).roic).toBeUndefined();
  });

  it('赤字：税引前利益が負なら仮定値30%で推定し、参考値と明記する', () => {
    const r = roicOf({ operatingIncome: -20, interest: 2, tax: 0 });
    expect(r.roic).toBeCloseTo(-2, 6);
    expect(r.meta.join('|')).toContain('税率は仮定値 30% を使用');
    expect(r.meta.join('|')).toContain('参考値');
  });

  it('税引前利益0：税率を計算せず、仮定値30%を使う', () => {
    const r = roicOf({ operatingIncome: 10, interest: 10, tax: 3 });
    expect(r.roic).toBeCloseTo(1, 6);
    expect(r.meta.join('|')).toContain('税引前利益が0以下');
  });

  it('税率が異常（税額が税引前利益を超える・負）なら、異常な率を使わず仮定値30%を使う', () => {
    const over = roicOf({ operatingIncome: 100, interest: 10, tax: 120 });
    expect(over.roic).toBeCloseTo(10, 6);
    expect(over.meta.join('|')).toContain('範囲外');
    expect(roicOf({ operatingIncome: 100, interest: 10, tax: -5 }).roic).toBeCloseTo(10, 6);
  });

  it('支払利息が未入力なら税引前利益を確定できないので、仮定値30%を使い注記する', () => {
    const r = roicOf({ operatingIncome: 100, tax: 27 });
    expect(r.roic).toBeCloseTo(10, 6);
    expect(r.meta.join('|')).toContain('支払利息が未入力');
  });
});

describe('手入力WACC（STAGE1 → 価値分析）', () => {
  const PL = [{ year: 2024, revenue: 1_000_000_000, operatingIncome: 100_000_000 }];

  it('手入力WACC（%）があれば、その値を価値分析の WACC として引き継ぐ', () => {
    expect(computeStage1ValueAnalysis({ financePL: PL, waccManual: 8 }).company.wacc).toBe(8);
  });

  it('未入力（undefined・null）は0%とせず、WACCを設定しない', () => {
    expect(computeStage1ValueAnalysis({ financePL: PL }).company.wacc).toBeUndefined();
    expect(computeStage1ValueAnalysis({ financePL: PL, waccManual: null }).company.wacc).toBeUndefined();
  });

  it('0以下・100以上の値は採用しない', () => {
    expect(computeStage1ValueAnalysis({ financePL: PL, waccManual: 0 }).company.wacc).toBeUndefined();
    expect(computeStage1ValueAnalysis({ financePL: PL, waccManual: 120 }).company.wacc).toBeUndefined();
  });

  it('単位は％。0.08は0.08%として扱い、比率へ換算しない', () => {
    expect(computeStage1ValueAnalysis({ financePL: PL, waccManual: 0.08 }).company.wacc).toBe(0.08);
  });

  it('PLがない（financeSummary の経路）でも手入力WACCを引き継ぐ', () => {
    expect(computeStage1ValueAnalysis({ waccManual: 8 }).company.wacc).toBe(8);
  });
});
