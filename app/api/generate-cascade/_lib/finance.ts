/**
 * _lib/finance.ts
 * Finance and portfolio summarization functions
 */

import { toNum } from './utils';

/**
 * csvFinanceData から「表示用に抜粋できる"行配列"」を抽出する。
 * - 旧：csvFinanceData が配列（row[]）
 * - 新：csvFinanceData がオブジェクト（{financeBS, segmentPL, segmentBS, 0: {...}} 等）
 */
export function extractCsvPreviewRows(csvFinanceData: any): any[] {
  if (!csvFinanceData) return [];

  // 1) 既に配列
  if (Array.isArray(csvFinanceData)) return csvFinanceData;

  // 2) rows/data が配列
  if (Array.isArray(csvFinanceData?.rows)) return csvFinanceData.rows;
  if (Array.isArray(csvFinanceData?.data)) return csvFinanceData.data;

  // 3) 数値キーが混ざるケース（0,1,...）
  if (typeof csvFinanceData === 'object') {
    const numericKeys = Object.keys(csvFinanceData).filter((k) => /^\d+$/.test(k));
    if (numericKeys.length > 0) {
      numericKeys.sort((a, b) => Number(a) - Number(b));
      const first = (csvFinanceData as any)[numericKeys[0]];
      if (Array.isArray(first)) return first;
      if (first && typeof first === 'object') return [first];
    }
  }

  // 4) financeBS / segmentPL / segmentBS などの構造から無理やり数行作る
  const out: any[] = [];

  if (Array.isArray(csvFinanceData?.financeBS)) {
    out.push(...csvFinanceData.financeBS.slice(0, 3).map((r: any) => ({ source: 'financeBS', ...r })));
  }

  const segPL = csvFinanceData?.segmentPL;
  if (segPL && typeof segPL === 'object') {
    const segNames = Object.keys(segPL).slice(0, 2);
    for (const name of segNames) {
      const rows = Array.isArray(segPL[name]) ? segPL[name] : [];
      out.push(...rows.slice(0, 2).map((r: any) => ({ source: `segmentPL:${name}`, ...r })));
    }
  }

  const segBS = csvFinanceData?.segmentBS;
  if (segBS && typeof segBS === 'object') {
    const segNames = Object.keys(segBS).slice(0, 1);
    for (const name of segNames) {
      const rows = Array.isArray(segBS[name]) ? segBS[name] : [];
      out.push(...rows.slice(0, 2).map((r: any) => ({ source: `segmentBS:${name}`, ...r })));
    }
  }

  return out;
}

/**
 * 財務サマリをテキスト化（AI用）
 */
export function summarizeFinanceSummary(financeSummary: any, limitYears = 4): string {
  if (!financeSummary) return '（サマリー未入力）';

  const rows: any[] = Array.isArray(financeSummary)
    ? financeSummary
    : Array.isArray(financeSummary?.rows)
      ? financeSummary.rows
      : [];

  if (!rows.length) return '（サマリー未入力）';

  const byYear = new Map<string, any[]>();

  for (const r of rows) {
    const yRaw = r.year ?? r.fiscal_year ?? r.yearLabel ?? 'N/A';
    const yKey = String(yRaw);
    if (!byYear.has(yKey)) byYear.set(yKey, []);
    byYear.get(yKey)!.push(r);
  }

  // 年度は「最新→過去」を優先（数字化できるものは数字で比較、できないものは文字列）
  const yearKeys = [...byYear.keys()].sort((a, b) => {
    const na = toNum(a);
    const nb = toNum(b);
    if (na != null && nb != null) return nb - na; // desc
    if (na != null && nb == null) return -1;
    if (na == null && nb != null) return 1;
    return String(b).localeCompare(String(a));
  });

  const pickedYears = yearKeys.slice(0, limitYears);

  const lines: string[] = [];
  for (const y of pickedYears) {
    const group = byYear.get(y) || [];
    const yearLabel = String(y);

    const unitLines = group
      .slice(0, 3)
      .map((r: any) => {
        const bu = r.business_unit ?? r.unitName ?? '全社';
        const rev = r.revenue ?? r.sales ?? r.net_sales;
        const op = r.operating_income ?? r.op ?? r.operatingProfit;

        const revNum = toNum(rev);
        const opNum = toNum(op);
        const margin =
          toNum(r.operating_margin_pct ?? r.opMargin) ??
          (revNum != null && revNum !== 0 && opNum != null ? Math.round((opNum / revNum) * 1000) / 10 : null);

        const revStr = revNum != null ? `${revNum}百万円` : '—';
        const opStr = opNum != null ? `${opNum}百万円` : '—';
        const mStr = margin != null ? `${margin}%` : '—';
        return `    - ${bu}: 売上=${revStr}, 営業利益=${opStr}, 利益率=${mStr}`;
      })
      .join('\n');

    lines.push(`  <${yearLabel}年>:\n${unitLines || '    - （データ不足）'}`);
  }

  return lines.join('\n');
}

/**
 * ビジネスポートフォリオをテキスト化（AI用）
 */
export function summarizeBusinessPortfolio(bp: any, limitUnits = 8): string {
  if (!bp || typeof bp !== 'object') return '（ポートフォリオ未入力）';

  const units: any[] = Array.isArray(bp.units) ? bp.units : [];
  if (!units.length) return '（ポートフォリオ未入力）';

  const lines = units.slice(0, limitUnits).map((u: any) => {
    const name = u.name ?? u.label ?? '不明ユニット';
    const revNum = toNum(u.revenue ?? u.sales ?? u.netSales);
    const opNum = toNum(u.operatingProfit ?? u.profit ?? u.op);
    const growthNum = toNum(u.growthRate ?? u.growth ?? u.salesGrowthRate);
    const marginNum = toNum(u.profitMargin ?? u.margin ?? u.opMargin);

    const revStr = revNum != null ? `${revNum}百万円` : '—';
    const opStr = opNum != null ? `${opNum}百万円` : '—';
    const gStr = growthNum != null ? `${growthNum}%` : '—';
    const mStr = marginNum != null ? `${marginNum}%` : '—';

    const pos =
      growthNum != null && marginNum != null
        ? growthNum >= 0 && marginNum >= 0
          ? '高成長×高収益（攻めの投資候補）'
          : growthNum >= 0 && marginNum < 0
            ? '高成長×低収益（テコ入れ前提の投資）'
            : growthNum < 0 && marginNum >= 0
              ? '低成長×高収益（収穫・守り）'
              : '低成長×低収益（撤退・縮小候補）'
        : 'ポジション不明';

    return `  - ${name}: 売上=${revStr}, 利益=${opStr}, 成長率=${gStr}, 利益率=${mStr} → ${pos}`;
  });

  return lines.join('\n');
}
