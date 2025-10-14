// /utils/financeSummary.ts

export type FinanceSummaryRow = {
  year: number;
  business_unit: string;
  revenue: number;
  operating_income: number;
  operating_margin_pct: number; // 営業利益率%
  revenue_share_pct: number;    // 年度内構成比%
};

/** ゆるい数値変換（"1,234" や "12.3%" を許容） */
function toNum(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim().replaceAll(',', '').replace('%', '');
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 年度×事業で売上・営業利益を集計し、
 * 年度内総売上に対する構成比と営業利益率を算出。
 * - 入力 rows は英語ヘッダ（business_unit/year/revenue/operating_income ...）を想定
 * - 不足値は 0 集計（堅牢化）
 */
export function buildFinanceSummary(rows: any[]): FinanceSummaryRow[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  type Agg = { revenue: number; income: number };
  const byYearBU = new Map<string, Agg>();

  for (const raw of rows) {
    const year = toNum(raw?.year);
    const bu = String(raw?.business_unit ?? raw?.businessUnit ?? raw?.['事業'] ?? '').trim();
    if (!year || !bu) continue;

    const rev = toNum(raw?.revenue) ?? 0;
    const inc = toNum(raw?.operating_income ?? raw?.operatingIncome) ?? 0;
    const key = `${year}__${bu}`;

    const cur = byYearBU.get(key) ?? { revenue: 0, income: 0 };
    cur.revenue += rev;
    cur.income += inc;
    byYearBU.set(key, cur);
  }

  // 年度総売上
  const yearTotal: Record<number, number> = {};
  for (const [key, agg] of byYearBU.entries()) {
    const [y] = key.split('__');
    const yy = Number(y);
    yearTotal[yy] = (yearTotal[yy] ?? 0) + agg.revenue;
  }

  // 出力
  const out: FinanceSummaryRow[] = [];
  for (const [key, agg] of byYearBU.entries()) {
    const [y, bu] = key.split('__');
    const year = Number(y);
    const revenue = Math.round(agg.revenue);
    const income = Math.round(agg.income);

    const opm = revenue > 0 ? (income / revenue) * 100 : 0;
    const share = (yearTotal[year] ?? 0) > 0 ? (revenue / yearTotal[year]) * 100 : 0;

    out.push({
      year,
      business_unit: bu,
      revenue,
      operating_income: income,
      operating_margin_pct: Number(opm.toFixed(1)),
      revenue_share_pct: Number(share.toFixed(1)),
    });
  }

  return out.sort((a, b) =>
    a.year === b.year ? a.business_unit.localeCompare(b.business_unit) : a.year - b.year
  );
}
