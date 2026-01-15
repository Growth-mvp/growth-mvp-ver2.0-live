// /utils/stage1DummyData.ts
/**
 * STAGE1 動作確認用ダミーデータ
 * - 全社PL/BS + 事業部PL/BS + 本社調整 + PBR + 論点ブロック
 * - ValueAnalysis が一通り表示されることを確認するためのテストデータ
 */

import type {
  BusinessSegment,
  FinancePLRow,
  FinanceBSRow,
  SegmentBSRow,
  IssueBlock,
} from '@/types/strategy';

/* =========================================================
 * 年度設定（過去5年）
 * ========================================================= */

const YEARS = [2020, 2021, 2022, 2023, 2024];

/* =========================================================
 * 事業セグメント（5事業部）
 * ========================================================= */

export const dummyBusinessSegments: BusinessSegment[] = [
  { id: 'seg_001', name: '製造事業', scope: '国内工場・製品製造' },
  { id: 'seg_002', name: 'サービス事業', scope: 'メンテナンス・保守' },
  { id: 'seg_003', name: '海外事業', scope: 'アジア・北米展開' },
  { id: 'seg_004', name: 'ソリューション事業', scope: 'SIer・コンサル' },
  { id: 'seg_005', name: '新規事業', scope: 'DX関連・スタートアップ投資' },
];

/* =========================================================
 * 全社PL（過去5年）
 * - 事業部PLの合計より5〜8%大きく設定（本社調整で差分が出る）
 * ========================================================= */

export const dummyFinancePL: FinancePLRow[] = [
  {
    year: 2020,
    revenue: 120000,
    grossProfit: 42000,
    cogs: 78000,
    sga: 28000,
    operatingIncome: 14000,
    depreciation: 8000,
    interest: 1200,
    tax: 4000,
    netIncome: 8800,
  },
  {
    year: 2021,
    revenue: 128000,
    grossProfit: 46000,
    cogs: 82000,
    sga: 30000,
    operatingIncome: 16000,
    depreciation: 8500,
    interest: 1100,
    tax: 4700,
    netIncome: 10200,
  },
  {
    year: 2022,
    revenue: 135000,
    grossProfit: 49000,
    cogs: 86000,
    sga: 32000,
    operatingIncome: 17000,
    depreciation: 9000,
    interest: 1000,
    tax: 5100,
    netIncome: 10900,
  },
  {
    year: 2023,
    revenue: 138000,
    grossProfit: 48500,
    cogs: 89500,
    sga: 34000,
    operatingIncome: 14500,
    depreciation: 9500,
    interest: 950,
    tax: 4100,
    netIncome: 9450,
  },
  {
    year: 2024,
    revenue: 142000,
    grossProfit: 50000,
    cogs: 92000,
    sga: 35000,
    operatingIncome: 15000,
    depreciation: 10000,
    interest: 900,
    tax: 4300,
    netIncome: 9800,
  },
];

/* =========================================================
 * 全社BS（過去5年）
 * ========================================================= */

export const dummyFinanceBS: FinanceBSRow[] = [
  {
    year: 2020,
    cash: 15000,
    ar: 18000,
    inventory: 12000,
    ap: 10000,
    fixedAssets: 45000,
    totalAssets: 95000,
    interestBearingDebt: 25000,
    equity: 48000,
    netAssets: 48000,
  },
  {
    year: 2021,
    cash: 18000,
    ar: 20000,
    inventory: 13000,
    ap: 11000,
    fixedAssets: 48000,
    totalAssets: 105000,
    interestBearingDebt: 24000,
    equity: 55000,
    netAssets: 55000,
  },
  {
    year: 2022,
    cash: 20000,
    ar: 22000,
    inventory: 14000,
    ap: 12000,
    fixedAssets: 52000,
    totalAssets: 115000,
    interestBearingDebt: 23000,
    equity: 62000,
    netAssets: 62000,
  },
  {
    year: 2023,
    cash: 19000,
    ar: 23000,
    inventory: 15000,
    ap: 12500,
    fixedAssets: 55000,
    totalAssets: 120000,
    interestBearingDebt: 24000,
    equity: 68000,
    netAssets: 68000,
  },
  {
    year: 2024,
    cash: 21000,
    ar: 24000,
    inventory: 15500,
    ap: 13000,
    fixedAssets: 58000,
    totalAssets: 128000,
    interestBearingDebt: 23000,
    equity: 75000,
    netAssets: 75000,
  },
];

/* =========================================================
 * 事業部PL（各事業部×過去5年）
 * - 合計が全社PLより5〜8%小さくなるように調整
 * ========================================================= */

export const dummySegmentPL: Record<string, FinancePLRow[]> = {
  '製造事業': YEARS.map((year) => ({
    year,
    revenue: Math.round(38000 + (year - 2020) * 1500),
    operatingIncome: Math.round(5500 + (year - 2020) * 200 - (year === 2023 ? 800 : 0)),
  })),
  'サービス事業': YEARS.map((year) => ({
    year,
    revenue: Math.round(25000 + (year - 2020) * 1200),
    operatingIncome: Math.round(4200 + (year - 2020) * 150),
  })),
  '海外事業': YEARS.map((year) => ({
    year,
    revenue: Math.round(22000 + (year - 2020) * 2000),
    operatingIncome: Math.round(2800 + (year - 2020) * 250 - (year === 2023 ? 600 : 0)),
  })),
  'ソリューション事業': YEARS.map((year) => ({
    year,
    revenue: Math.round(18000 + (year - 2020) * 800),
    operatingIncome: Math.round(2000 + (year - 2020) * 100),
  })),
  '新規事業': YEARS.map((year) => ({
    year,
    revenue: Math.round(5000 + (year - 2020) * 1500),
    operatingIncome: Math.round(-500 + (year - 2020) * 300), // 初期赤字→徐々に黒字化
  })),
};

/* =========================================================
 * 事業部BS（投下資本推計用）
 * ========================================================= */

export const dummySegmentBS: Record<string, SegmentBSRow[]> = {
  '製造事業': YEARS.map((year) => ({
    year,
    ar: Math.round(6000 + (year - 2020) * 400),
    inventory: Math.round(5000 + (year - 2020) * 300),
    ap: Math.round(3500 + (year - 2020) * 200),
    fixedAssets: Math.round(18000 + (year - 2020) * 1500),
    equity: Math.round(15000 + (year - 2020) * 2000),
    interestBearingDebt: Math.round(8000 - (year - 2020) * 200),
  })),
  'サービス事業': YEARS.map((year) => ({
    year,
    ar: Math.round(4000 + (year - 2020) * 300),
    inventory: Math.round(1500 + (year - 2020) * 100),
    ap: Math.round(2000 + (year - 2020) * 150),
    fixedAssets: Math.round(8000 + (year - 2020) * 600),
    equity: Math.round(10000 + (year - 2020) * 1500),
    interestBearingDebt: Math.round(5000 - (year - 2020) * 100),
  })),
  '海外事業': YEARS.map((year) => ({
    year,
    ar: Math.round(5000 + (year - 2020) * 500),
    inventory: Math.round(3500 + (year - 2020) * 300),
    ap: Math.round(2500 + (year - 2020) * 200),
    fixedAssets: Math.round(12000 + (year - 2020) * 1200),
    equity: Math.round(12000 + (year - 2020) * 1800),
    interestBearingDebt: Math.round(7000 - (year - 2020) * 150),
  })),
  'ソリューション事業': YEARS.map((year) => ({
    year,
    ar: Math.round(2500 + (year - 2020) * 200),
    inventory: Math.round(500 + (year - 2020) * 50),
    ap: Math.round(1500 + (year - 2020) * 100),
    fixedAssets: Math.round(4000 + (year - 2020) * 400),
    equity: Math.round(6000 + (year - 2020) * 800),
    interestBearingDebt: Math.round(3000 - (year - 2020) * 50),
  })),
  '新規事業': YEARS.map((year) => ({
    year,
    ar: Math.round(800 + (year - 2020) * 300),
    inventory: Math.round(300 + (year - 2020) * 100),
    ap: Math.round(500 + (year - 2020) * 80),
    fixedAssets: Math.round(2000 + (year - 2020) * 800),
    equity: Math.round(3000 + (year - 2020) * 1200),
    interestBearingDebt: Math.round(2000 + (year - 2020) * 200), // 新規事業は借入増
  })),
};

/* =========================================================
 * PBR（手入力値）
 * ========================================================= */

export const dummyPbrManual = '1.25';

/* =========================================================
 * 論点ブロック（3件）
 * ========================================================= */

export const dummyStage1Issues: IssueBlock[] = [
  {
    title: '収益性の改善',
    description:
      '2023年に営業利益率が低下。製造事業と海外事業でコスト増の影響が見られる。' +
      'ROICも10%を下回っており、投下資本効率の改善が急務。',
    linkedMetrics: ['operatingMargin', 'roic'],
    scope: 'company',
  },
  {
    title: '成長率の維持',
    description:
      '売上CAGRは4%台で推移しているが、市場成長率（6%）を下回る。' +
      '新規事業の立ち上げ遅延と海外展開の停滞が主因。',
    linkedMetrics: ['revenueCAGR'],
    scope: 'company',
  },
  {
    title: '財務健全性の確保',
    description:
      'D/Eレシオは0.3台で安定しているが、新規投資のための財務余力を確保する必要がある。' +
      'フリーキャッシュフローの改善と有利子負債の最適化を検討。',
    linkedMetrics: ['debtEquityRatio'],
    scope: 'company',
  },
];

/* =========================================================
 * 一括エクスポート（便利用）
 * ========================================================= */

export const stage1DummyDataBundle = {
  businessSegments: dummyBusinessSegments,
  financePL: dummyFinancePL,
  financeBS: dummyFinanceBS,
  segmentPL: dummySegmentPL,
  segmentBS: dummySegmentBS,
  pbrManual: dummyPbrManual,
  stage1Issues: dummyStage1Issues,
};
