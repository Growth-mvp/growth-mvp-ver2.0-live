// /utils/valueAnalysis.ts
import type { FinanceBSRow, ValueAnalysis } from '@/types/strategy';
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

function calcCagrPct(start: number, end: number, years: number): number {
  if (start <= 0 || end <= 0 || years <= 0) return 0;
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
