// /utils/valueAnalysis.ts
import type {
  FinanceBSRow,
  FinancePLRow,
  SegmentBSRow,
  ValueAnalysis,
} from '@/types/strategy';
import type { FinanceSummaryRow } from '@/store/strategyStore';

/* ===============================
 * ユーティリティ
 * =============================== */

function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function safePct(num: number, den: number): number {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  return (num / den) * 100;
}

/**
 * CAGR 計算：計算不可の場合は undefined を返す（0でなく）
 * @param start 初年度の値（>0 であること）
 * @param end 最終年度の値（>0 であること）
 * @param years 期間（年数、>0 であること）
 * @returns CAGR %、計算不可なら undefined
 */
function calcCagrPct(start: number, end: number, years: number): number | undefined {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(years)) return undefined;
  if (start <= 0 || end <= 0 || years <= 0) return undefined;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

/* ===============================
 * 全社合算の年次データ構築
 * =============================== */

type CompanyYearAgg = {
  year: number;
  revenue: number;
  operatingIncome: number;
  operatingMarginPct: number;
};

function buildCompanyAgg(rows: FinanceSummaryRow[]): CompanyYearAgg[] {
  const byYear = new Map<number, { revenue: number; op: number }>();

  for (const r of rows) {
    const y = Number((r as any)?.year);
    if (!Number.isFinite(y)) continue;
    const prev = byYear.get(y) ?? { revenue: 0, op: 0 };
    prev.revenue += toNumber((r as any)?.revenue);
    prev.op += toNumber((r as any)?.operating_income);
    byYear.set(y, prev);
  }

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  return years.map((y) => {
    const v = byYear.get(y)!;
    const margin = v.revenue !== 0 ? (v.op / v.revenue) * 100 : 0;
    return {
      year: y,
      revenue: v.revenue,
      operatingIncome: v.op,
      operatingMarginPct: margin,
    };
  });
}

/* ===============================
 * financeSummary → ValueAnalysis（基本）
 * =============================== */

/**
 * financeSummary(事業×年) から "全社合算の年次" を作り、
 * - 最新年の営業利益率
 * - 期間の売上CAGR
 * を算出する
 */
export function computeValueAnalysisFromSummary(
  financeSummary: FinanceSummaryRow[] | undefined,
  opts?: { pbrManual?: string }
): ValueAnalysis {
  const rows = Array.isArray(financeSummary) ? financeSummary : [];
  const companyAgg = buildCompanyAgg(rows);

  const years = companyAgg.map((c) => c.year);
  const firstY = years.length > 0 ? years[0] : undefined;
  const lastY = years.length > 0 ? years[years.length - 1] : undefined;

  const first = companyAgg.length > 0 ? companyAgg[0] : undefined;
  const last = companyAgg.length > 0 ? companyAgg[companyAgg.length - 1] : undefined;

  const operatingMarginPctLatest = last?.operatingMarginPct;

  const revenueCagrPct =
    first && last && firstY != null && lastY != null && lastY > firstY
      ? calcCagrPct(first.revenue, last.revenue, lastY - firstY)
      : undefined;

  const pbrManual = opts?.pbrManual?.trim();
  const pbr = pbrManual ? toNumber(pbrManual) : undefined;

  return {
    operatingMarginPctLatest,
    revenueCagrPct,
    pbr,
    // 旧形式にも値を入れておく（互換）
    operatingMarginRate: operatingMarginPctLatest,
    revenueGrowthRate: revenueCagrPct,
    baseYear: lastY,
    calculatedAt: new Date().toISOString(),
    meta: {
      computedAt: new Date().toISOString(),
      source: 'local',
      basis: {
        years: years,
        latestYear: lastY,
      },
    },
  };
}

/* ===============================
 * BS → D/E, ROIC, ROE, ROA
 * =============================== */

/**
 * BS行はプロジェクトごとに形が揺れやすいので、
 * "よくあるキー"をヒューリスティックに拾って D/E を計算する。
 *
 * 期待キー例：
 * - equity / total_equity / shareholders_equity / netAssets / net_assets
 * - debt / interest_bearing_debt / total_debt / interestBearingDebt
 */
export function tryComputeDebtEquityRatio(
  financeBS: FinanceBSRow[] | undefined
): number | undefined {
  const rows = Array.isArray(financeBS) ? financeBS : [];
  if (rows.length === 0) return undefined;

  // "最新っぽい行"を末尾優先で拾う（year列があれば最大年）
  let target: any = rows[rows.length - 1];
  const years = rows
    .map((r: any) => Number(r?.year))
    .filter((y) => Number.isFinite(y));
  if (years.length > 0) {
    const maxY = Math.max(...years);
    const found = rows.find((r: any) => Number(r?.year) === maxY);
    if (found) target = found;
  }

  const equity =
    toNumber(target?.equity) ||
    toNumber(target?.total_equity) ||
    toNumber(target?.shareholders_equity) ||
    toNumber(target?.netAssets) ||
    toNumber(target?.net_assets);

  const debt =
    toNumber(target?.debt) ||
    toNumber(target?.interest_bearing_debt) ||
    toNumber(target?.total_debt) ||
    toNumber(target?.interestBearingDebt) ||
    toNumber(target?.borrowings);

  if (!equity || equity === 0) return undefined;
  if (!debt) return 0;

  return debt / equity;
}

/**
 * ROIC = NOPAT / 投下資本
 * - NOPAT = 営業利益 × (1 - 税率)
 * - 投下資本 = 純資産 + 有利子負債
 */
export function tryComputeROIC(
  financeBS: FinanceBSRow[] | undefined,
  financeSummary: FinanceSummaryRow[] | undefined,
  taxRate: number = 0.3
): number | undefined {
  const bsRows = Array.isArray(financeBS) ? financeBS : [];
  if (bsRows.length === 0) return undefined;

  // 最新年の BS を取得
  let targetBS: any = bsRows[bsRows.length - 1];
  const bsYears = bsRows
    .map((r: any) => Number(r?.year))
    .filter((y) => Number.isFinite(y));
  if (bsYears.length > 0) {
    const maxY = Math.max(...bsYears);
    const found = bsRows.find((r: any) => Number(r?.year) === maxY);
    if (found) targetBS = found;
  }

  // 投下資本
  const netAssets =
    toNumber(targetBS?.netAssets) ||
    toNumber(targetBS?.net_assets) ||
    toNumber(targetBS?.equity) ||
    toNumber(targetBS?.total_equity);

  const interestBearingDebt =
    toNumber(targetBS?.interestBearingDebt) ||
    toNumber(targetBS?.interest_bearing_debt) ||
    toNumber(targetBS?.debt) ||
    toNumber(targetBS?.total_debt);

  // investedCapital が直接あれば使う
  const investedCapital =
    toNumber(targetBS?.investedCapital) ||
    toNumber(targetBS?.invested_capital) ||
    (netAssets + interestBearingDebt);

  if (!investedCapital || investedCapital === 0) return undefined;

  // NOPAT: BS に nopat があればそれを使う、なければ financeSummary の営業利益から推定
  let nopat = toNumber(targetBS?.nopat) || toNumber(targetBS?.NOPAT);

  if (!nopat && Array.isArray(financeSummary)) {
    const companyAgg = buildCompanyAgg(financeSummary);
    const targetYear = Number(targetBS?.year);
    const matchAgg = companyAgg.find((c) => c.year === targetYear);
    const latestAgg = companyAgg.length > 0 ? companyAgg[companyAgg.length - 1] : undefined;
    const opIncome = matchAgg?.operatingIncome ?? latestAgg?.operatingIncome ?? 0;
    nopat = opIncome * (1 - taxRate);
  }

  if (!nopat) return undefined;

  return safePct(nopat, investedCapital);
}

/**
 * ROE = 当期純利益 / 純資産
 * BS に netIncome があれば計算可能
 */
export function tryComputeROE(
  financeBS: FinanceBSRow[] | undefined
): number | undefined {
  const rows = Array.isArray(financeBS) ? financeBS : [];
  if (rows.length === 0) return undefined;

  let target: any = rows[rows.length - 1];
  const years = rows
    .map((r: any) => Number(r?.year))
    .filter((y) => Number.isFinite(y));
  if (years.length > 0) {
    const maxY = Math.max(...years);
    const found = rows.find((r: any) => Number(r?.year) === maxY);
    if (found) target = found;
  }

  const netIncome =
    toNumber(target?.netIncome) ||
    toNumber(target?.net_income) ||
    toNumber(target?.profit);

  const netAssets =
    toNumber(target?.netAssets) ||
    toNumber(target?.net_assets) ||
    toNumber(target?.equity) ||
    toNumber(target?.total_equity);

  if (!netIncome || !netAssets || netAssets === 0) return undefined;

  return safePct(netIncome, netAssets);
}

/**
 * ROA = 当期純利益 / 総資産
 */
export function tryComputeROA(
  financeBS: FinanceBSRow[] | undefined
): number | undefined {
  const rows = Array.isArray(financeBS) ? financeBS : [];
  if (rows.length === 0) return undefined;

  let target: any = rows[rows.length - 1];
  const years = rows
    .map((r: any) => Number(r?.year))
    .filter((y) => Number.isFinite(y));
  if (years.length > 0) {
    const maxY = Math.max(...years);
    const found = rows.find((r: any) => Number(r?.year) === maxY);
    if (found) target = found;
  }

  const netIncome =
    toNumber(target?.netIncome) ||
    toNumber(target?.net_income) ||
    toNumber(target?.profit);

  const totalAssets =
    toNumber(target?.totalAssets) ||
    toNumber(target?.total_assets) ||
    toNumber(target?.assets);

  if (!netIncome || !totalAssets || totalAssets === 0) return undefined;

  return safePct(netIncome, totalAssets);
}

/* ===============================
 * メイン：computeValueAnalysis
 * =============================== */

/**
 * まとめ：financeSummary + financeBS + pbrManual から ValueAnalysis を算出
 * - 営業利益率（最新）
 * - 売上CAGR（期間）
 * - D/E（BSがあれば）
 * - ROIC（BSとfinanceSummaryがあれば）
 * - ROE / ROA（BSがあれば）
 * - PBR（手入力があれば）
 */
export function computeValueAnalysis(args: {
  financeSummary?: FinanceSummaryRow[];
  financeBS?: FinanceBSRow[];
  pbrManual?: string;
  taxRate?: number;
}): ValueAnalysis {
  const base = computeValueAnalysisFromSummary(args.financeSummary, {
    pbrManual: args.pbrManual,
  });

  const de = tryComputeDebtEquityRatio(args.financeBS);
  const roic = tryComputeROIC(args.financeBS, args.financeSummary, args.taxRate ?? 0.3);
  const roe = tryComputeROE(args.financeBS);
  const roa = tryComputeROA(args.financeBS);

  return {
    ...base,
    debtEquityRatio: de,
    roic: roic ?? base.roic,
    roe,
    roa,
    meta: {
      ...base.meta,
      computedAt: new Date().toISOString(),
      source: 'local',
    },
  };
}

/* ===============================
 * 新形式：FinancePLRow/FinanceBSRow から直接計算
 * =============================== */

/** 最新年（year が最大）の行を取得 */
function getLatestRow<T extends { year: number }>(rows: T[]): T | undefined {
  if (rows.length === 0) return undefined;
  return rows.reduce((a, b) => (a.year >= b.year ? a : b));
}

/** 最古年（year が最小）の行を取得 */
function getOldestRow<T extends { year: number }>(rows: T[]): T | undefined {
  if (rows.length === 0) return undefined;
  return rows.reduce((a, b) => (a.year <= b.year ? a : b));
}

/**
 * 投下資本を計算（FinanceBSRow または SegmentBSRow）
 * 優先順位：
 * 1. investedCapital が直接あればそれを使用
 * 2. (AR + Inventory - AP) + FixedAssets（運転資本 + 固定資産）
 * 3. netAssets + interestBearingDebt（純資産 + 有利子負債）
 */
function computeInvestedCapital(row: FinanceBSRow | SegmentBSRow): number | undefined {
  if (row.investedCapital && row.investedCapital > 0) {
    return row.investedCapital;
  }

  const ar = toNumber(row.ar);
  const inventory = toNumber(row.inventory);
  const ap = toNumber(row.ap);
  const fixedAssets = toNumber(row.fixedAssets);

  // 運転資本 + 固定資産方式
  if ((ar > 0 || inventory > 0) && fixedAssets > 0) {
    const workingCapital = ar + inventory - ap;
    return workingCapital + fixedAssets;
  }

  // 純資産 + 有利子負債方式（FinanceBSRow のみ）
  const bsRow = row as FinanceBSRow;
  const netAssets = toNumber(bsRow.netAssets) || toNumber(bsRow.equity);
  const debt = toNumber(bsRow.interestBearingDebt);
  if (netAssets > 0) {
    return netAssets + debt;
  }

  return undefined;
}

/**
 * PL行から NOPAT を計算
 * - NOPAT = operatingIncome * (1 - taxRate)
 * - taxRate が未指定の場合は 0.3（30%）をデフォルト使用
 */
function computeNOPAT(pl: FinancePLRow, taxRate: number = 0.3): number | undefined {
  const opIncome = toNumber(pl.operatingIncome);
  if (!opIncome) return undefined;

  // PL に tax があればそれを使って実効税率を推定
  if (pl.tax !== undefined && opIncome > 0) {
    const effectiveTaxRate = Math.min(1, Math.max(0, toNumber(pl.tax) / opIncome));
    return opIncome * (1 - effectiveTaxRate);
  }

  return opIncome * (1 - taxRate);
}

/**
 * FinancePLRow 配列から営業利益率（最新年）を計算
 */
export function computeOperatingMarginFromPL(
  rows: FinancePLRow[]
): number | undefined {
  const latest = getLatestRow(rows);
  if (!latest) return undefined;

  const revenue = toNumber(latest.revenue);
  const opIncome = toNumber(latest.operatingIncome);
  if (!revenue || revenue === 0) return undefined;

  return safePct(opIncome, revenue);
}

/**
 * FinancePLRow 配列から売上 CAGR（期間全体）を計算
 * ★ 修正：売上が有効（>0）な年だけを対象にする
 * - 2021 年の売上が 0 でも、2022-2024 の売上があれば 2022→2024 で計算
 * - データ不足なら undefined を返す
 */
export function computeRevenueCagrFromPL(
  rows: FinancePLRow[]
): number | undefined {
  if (rows.length < 2) return undefined;

  // ★ 売上が有効（>0）な行だけでフィルタリング
  const validRows = rows.filter((r) => {
    const rev = toNumber(r.revenue);
    return Number.isFinite(r.year) && rev > 0;
  });

  if (validRows.length < 2) return undefined;

  const oldest = getOldestRow(validRows);
  const latest = getLatestRow(validRows);
  if (!oldest || !latest || oldest.year >= latest.year) return undefined;

  const startRev = toNumber(oldest.revenue);
  const endRev = toNumber(latest.revenue);
  const years = latest.year - oldest.year;

  return calcCagrPct(startRev, endRev, years);
}

/**
 * FinanceBSRow 配列から D/E レシオ（最新年）を計算
 */
export function computeDERatioFromBS(
  rows: FinanceBSRow[]
): number | undefined {
  const latest = getLatestRow(rows);
  if (!latest) return undefined;

  const equity = toNumber(latest.equity) || toNumber(latest.netAssets);
  const debt = toNumber(latest.interestBearingDebt);

  if (!equity || equity === 0) return undefined;
  return debt / equity;
}

/**
 * FinancePLRow + FinanceBSRow から ROIC を計算（最新年同士をマッチ）
 */
export function computeROICFromPLBS(
  plRows: FinancePLRow[],
  bsRows: FinanceBSRow[],
  taxRate: number = 0.3
): { roic: number | undefined; meta: string[] } {
  const meta: string[] = [];

  const latestPL = getLatestRow(plRows);
  const latestBS = getLatestRow(bsRows);

  if (!latestPL || !latestBS) {
    return { roic: undefined, meta: ['PL/BS データが不足'] };
  }

  // 年度マッチ確認
  if (latestPL.year !== latestBS.year) {
    meta.push(`PL年度(${latestPL.year})とBS年度(${latestBS.year})が不一致。直近年で計算。`);
  }

  const nopat = computeNOPAT(latestPL, taxRate);
  const investedCapital = computeInvestedCapital(latestBS);

  if (nopat === undefined) {
    meta.push('NOPAT 算出不可（operatingIncome なし）');
    return { roic: undefined, meta };
  }
  if (!investedCapital || investedCapital === 0) {
    meta.push('投下資本 算出不可');
    return { roic: undefined, meta };
  }

  // デフォルト税率使用時は明記
  if (latestPL.tax === undefined) {
    meta.push(`税率は仮定値 ${(taxRate * 100).toFixed(0)}% を使用`);
  }

  return { roic: safePct(nopat, investedCapital), meta };
}

/**
 * FinancePLRow + FinanceBSRow から ROE を計算
 * - netIncome があればそれを使用
 * - なければ operatingIncome - interest - tax で推計
 */
export function computeROEFromPLBS(
  plRows: FinancePLRow[],
  bsRows: FinanceBSRow[]
): { roe: number | undefined; meta: string[] } {
  const meta: string[] = [];

  const latestPL = getLatestRow(plRows);
  const latestBS = getLatestRow(bsRows);

  if (!latestPL || !latestBS) {
    return { roe: undefined, meta: ['PL/BS データが不足'] };
  }

  // 純利益
  let netIncome = toNumber(latestPL.netIncome);
  if (!netIncome) {
    // 推計：営業利益 - 支払利息 - 法人税
    const opIncome = toNumber(latestPL.operatingIncome);
    const interest = toNumber(latestPL.interest);
    const tax = toNumber(latestPL.tax);
    if (opIncome) {
      netIncome = opIncome - interest - tax;
      meta.push('netIncome は operatingIncome - interest - tax で推計');
    }
  }

  const equity = toNumber(latestBS.equity) || toNumber(latestBS.netAssets);

  if (!netIncome) {
    return { roe: undefined, meta: ['純利益データなし'] };
  }
  if (!equity || equity === 0) {
    return { roe: undefined, meta: ['株主資本データなし'] };
  }

  return { roe: safePct(netIncome, equity), meta };
}

/**
 * FinancePLRow + FinanceBSRow から ROA を計算
 */
export function computeROAFromPLBS(
  plRows: FinancePLRow[],
  bsRows: FinanceBSRow[]
): { roa: number | undefined; meta: string[] } {
  const meta: string[] = [];

  const latestPL = getLatestRow(plRows);
  const latestBS = getLatestRow(bsRows);

  if (!latestPL || !latestBS) {
    return { roa: undefined, meta: ['PL/BS データが不足'] };
  }

  // 純利益
  let netIncome = toNumber(latestPL.netIncome);
  if (!netIncome) {
    const opIncome = toNumber(latestPL.operatingIncome);
    const interest = toNumber(latestPL.interest);
    const tax = toNumber(latestPL.tax);
    if (opIncome) {
      netIncome = opIncome - interest - tax;
      meta.push('netIncome は operatingIncome - interest - tax で推計');
    }
  }

  // 総資産
  let totalAssets = toNumber(latestBS.totalAssets);
  if (!totalAssets) {
    // 近似：cash + ar + inventory + fixedAssets
    const cash = toNumber(latestBS.cash);
    const ar = toNumber(latestBS.ar);
    const inventory = toNumber(latestBS.inventory);
    const fixedAssets = toNumber(latestBS.fixedAssets);
    if (cash > 0 || ar > 0 || inventory > 0 || fixedAssets > 0) {
      totalAssets = cash + ar + inventory + fixedAssets;
      meta.push('totalAssets は cash+ar+inventory+fixedAssets で近似');
    }
  }

  if (!netIncome) {
    return { roa: undefined, meta: ['純利益データなし'] };
  }
  if (!totalAssets || totalAssets === 0) {
    return { roa: undefined, meta: ['総資産データなし'] };
  }

  return { roa: safePct(netIncome, totalAssets), meta };
}

/* ===============================
 * computeValueAnalysisFromPLBS
 * FinancePLRow + FinanceBSRow から ValueAnalysis を算出
 * =============================== */

export function computeValueAnalysisFromPLBS(args: {
  companyPL: FinancePLRow[];
  companyBS: FinanceBSRow[];
  pbrManual?: string;
  taxRate?: number;
}): ValueAnalysis {
  const { companyPL, companyBS, pbrManual, taxRate = 0.3 } = args;
  const metaNotes: string[] = [];

  // ★ 修正：meta.basis.years に「有効な売上がある年」だけを入れる
  const validYears = companyPL
    .filter((r) => {
      const rev = toNumber(r.revenue);
      return Number.isFinite(r.year) && rev > 0;
    })
    .map((r) => r.year)
    .sort((a, b) => a - b);

  const firstY = validYears.length > 0 ? validYears[0] : undefined;
  const lastY = validYears.length > 0 ? validYears[validYears.length - 1] : undefined;

  // 営業利益率（最新年）
  const operatingMarginPctLatest = computeOperatingMarginFromPL(companyPL);

  // 売上CAGR
  const revenueCagrPct = computeRevenueCagrFromPL(companyPL);

  // D/E レシオ
  const debtEquityRatio = computeDERatioFromBS(companyBS);

  // ROIC
  const roicResult = computeROICFromPLBS(companyPL, companyBS, taxRate);
  if (roicResult.meta.length > 0) metaNotes.push(...roicResult.meta);

  // ROE
  const roeResult = computeROEFromPLBS(companyPL, companyBS);
  if (roeResult.meta.length > 0) metaNotes.push(...roeResult.meta);

  // ROA
  const roaResult = computeROAFromPLBS(companyPL, companyBS);
  if (roaResult.meta.length > 0) metaNotes.push(...roaResult.meta);

  // PBR（手入力）
  const pbrStr = pbrManual?.trim();
  const pbr = pbrStr ? toNumber(pbrStr) : undefined;

  return {
    // 新形式
    operatingMarginPctLatest,
    revenueCagrPct,
    debtEquityRatio,
    roic: roicResult.roic,
    roe: roeResult.roe,
    roa: roaResult.roa,
    pbr,

    // 旧形式互換
    operatingMarginRate: operatingMarginPctLatest,
    revenueGrowthRate: revenueCagrPct,
    baseYear: lastY,
    calculatedAt: new Date().toISOString(),

    meta: {
      computedAt: new Date().toISOString(),
      source: 'local',
      basis: {
        // ★ 修正：meta.basis.years は「有効な売上がある年」だけを使用
        years: validYears,
        latestYear: lastY,
      },
      notes: metaNotes.length > 0 ? metaNotes : undefined,
    },
  };
}

/* ===============================
 * セグメント別 ValueAnalysis 計算
 * =============================== */

/**
 * セグメントの PL/BS から ValueAnalysis を算出
 * - BS がない場合は margin/cagr のみ計算
 */
export function computeSegmentValueAnalysis(args: {
  segmentPL: FinancePLRow[];
  segmentBS?: SegmentBSRow[];
  taxRate?: number;
}): ValueAnalysis {
  const { segmentPL, segmentBS, taxRate = 0.3 } = args;
  const metaNotes: string[] = [];

  // ★ 修正：「有効な売上がある年」だけを抽出
  const validYears = segmentPL
    .filter((r) => {
      const rev = toNumber(r.revenue);
      return Number.isFinite(r.year) && rev > 0;
    })
    .map((r) => r.year)
    .sort((a, b) => a - b);

  const lastY = validYears.length > 0 ? validYears[validYears.length - 1] : undefined;

  // 営業利益率（最新年）
  const operatingMarginPctLatest = computeOperatingMarginFromPL(segmentPL);

  // 売上CAGR
  const revenueCagrPct = computeRevenueCagrFromPL(segmentPL);

  // ROIC（BS があれば）
  let roic: number | undefined;
  if (segmentBS && segmentBS.length > 0) {
    const latestPL = getLatestRow(segmentPL);
    const latestBS = getLatestRow(segmentBS);

    if (latestPL && latestBS) {
      const nopat = computeNOPAT(latestPL, taxRate);
      const investedCapital = computeInvestedCapital(latestBS);

      if (nopat !== undefined && investedCapital && investedCapital > 0) {
        roic = safePct(nopat, investedCapital);
        if (latestPL.tax === undefined) {
          metaNotes.push(`税率は仮定値 ${(taxRate * 100).toFixed(0)}% を使用`);
        }
      } else {
        metaNotes.push('セグメントROIC算出不可（NOPAT or 投下資本不足）');
      }
    }
  } else {
    metaNotes.push('セグメントBSなし（ROIC算出不可）');
  }

  return {
    operatingMarginPctLatest,
    revenueCagrPct,
    roic,

    // 旧形式互換
    operatingMarginRate: operatingMarginPctLatest,
    revenueGrowthRate: revenueCagrPct,
    baseYear: lastY,
    calculatedAt: new Date().toISOString(),

    meta: {
      computedAt: new Date().toISOString(),
      source: 'local',
      basis: {
        // ★ 修正：meta.basis.years は「有効な売上がある年」だけを使用
        years: validYears,
        latestYear: lastY,
      },
      notes: metaNotes.length > 0 ? metaNotes : undefined,
    },
  };
}

/* ===============================
 * computeValueAnalysisBundle
 * 会社全体 + セグメント別の ValueAnalysis を一括算出
 * =============================== */

export type ValueAnalysisBundleResult = {
  company: ValueAnalysis;
  segments: Record<string, ValueAnalysis>;
};

/**
 * 会社全体とセグメント別の ValueAnalysis を一括計算
 *
 * @param args.companyPL - 会社全体のPL（必須）
 * @param args.companyBS - 会社全体のBS（必須）
 * @param args.segmentPL - セグメント別PL（任意）。キーは BusinessSegment.name
 * @param args.segmentBS - セグメント別BS（任意）。キーは BusinessSegment.name
 * @param args.pbrManual - PBR手入力値
 * @param args.taxRate - 税率（デフォルト 0.3）
 *
 * @returns { company: ValueAnalysis, segments: Record<string, ValueAnalysis> }
 */
export function computeValueAnalysisBundle(args: {
  companyPL: FinancePLRow[];
  companyBS: FinanceBSRow[];
  segmentPL?: Record<string, FinancePLRow[]>;
  segmentBS?: Record<string, SegmentBSRow[]>;
  pbrManual?: string;
  taxRate?: number;
}): ValueAnalysisBundleResult {
  const { companyPL, companyBS, segmentPL, segmentBS, pbrManual, taxRate = 0.3 } = args;

  // 会社全体
  const company = computeValueAnalysisFromPLBS({
    companyPL,
    companyBS,
    pbrManual,
    taxRate,
  });

  // セグメント別
  const segments: Record<string, ValueAnalysis> = {};

  if (segmentPL) {
    for (const [segmentName, plRows] of Object.entries(segmentPL)) {
      if (!Array.isArray(plRows) || plRows.length === 0) continue;

      const bsRows = segmentBS?.[segmentName];
      segments[segmentName] = computeSegmentValueAnalysis({
        segmentPL: plRows,
        segmentBS: bsRows,
        taxRate,
      });
    }
  }

  return { company, segments };
}
