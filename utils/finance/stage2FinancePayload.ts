import type { FinancePLRow } from '@/types/strategy';
import { financePLYearKey } from './financeInputUnits';

export type Stage2FinanceRow = {
  year: number;
  '売上高(円)'?: number;
  '営業利益(円)'?: number;
};

function isYenAmount(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * STAGE2最終ストーリー生成へ渡す会社PLの金額（円）。
 * 要求先の会社と読み込み中の会社が一致するときだけ返す。
 * 年度が欠落・重複した行は、どの行が正しいか判断できないため除外する（同じ年度の行はすべて除外）。
 * 数値でない値は、その項目だけ省く。欠損は省き、明示された0は0として残す。
 */
export function buildStage2FinancePayload(args: {
  requestCompanyId: string | null | undefined;
  storeCompanyId: string | null | undefined;
  financePL: FinancePLRow[] | undefined;
}): Stage2FinanceRow[] | undefined {
  const { requestCompanyId, storeCompanyId, financePL } = args;
  if (!requestCompanyId || requestCompanyId !== storeCompanyId) return undefined;
  if (!Array.isArray(financePL)) return undefined;

  const years = financePL.map((row) => financePLYearKey(row));
  const yearCount = new Map<number, number>();
  for (const y of years) {
    if (y !== null) yearCount.set(y, (yearCount.get(y) ?? 0) + 1);
  }

  const rows: Stage2FinanceRow[] = [];
  financePL.forEach((row, i) => {
    const year = years[i];
    if (year === null || (yearCount.get(year) ?? 0) > 1) return;

    const out: Stage2FinanceRow = { year };
    if (isYenAmount(row.revenue)) out['売上高(円)'] = row.revenue;
    if (isYenAmount(row.operatingIncome)) out['営業利益(円)'] = row.operatingIncome;
    if (out['売上高(円)'] !== undefined || out['営業利益(円)'] !== undefined) rows.push(out);
  });
  return rows.length > 0 ? rows : undefined;
}
