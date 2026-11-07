import type { FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { computeStage1ValueAnalysis } from '@/utils/valueAnalysis';

export type FinancialIndicatorInput = {
  financePL?: FinancePLRow[];
  financeBS?: FinanceBSRow[];
  isListed?: boolean | null;
  pbrManual?: string | null;
  stage1Benchmarks?: { waccManual?: number | null } | null;
};

const UNCALCULATED = '未算出';

const percent = (value: number | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}%` : UNCALCULATED;

const multiple = (value: number | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}倍` : UNCALCULATED;

/**
 * 株主向け計画書に渡す財務指標。現状分析と同じ計算関数の結果だけを使い、
 * 計算できない指標は未算出と示す。入力が何もなければ空文字を返す。
 */
export function buildFinancialIndicatorBlock(input: FinancialIndicatorInput): string {
  const hasPL = Array.isArray(input.financePL) && input.financePL.length > 0;
  const waccManual = input.stage1Benchmarks?.waccManual;
  const hasWacc = typeof waccManual === 'number' && Number.isFinite(waccManual);
  if (!hasPL && !hasWacc && input.isListed === undefined) return '';

  const company = computeStage1ValueAnalysis({
    financePL: input.financePL,
    financeBS: input.financeBS,
    pbrManual: input.pbrManual ?? undefined,
  }).company;

  const listing = input.isListed === true ? '上場' : input.isListed === false ? '非上場' : '未入力';
  const wacc = hasWacc ? waccManual : company.wacc;
  const years = (input.financePL ?? [])
    .filter((row) => Number.isFinite(row.year) && Number(row.revenue) > 0)
    .map((row) => row.year);
  const latest = years.length > 0 ? Math.max(...years) : undefined;
  const first = years.length > 0 ? Math.min(...years) : undefined;
  const latestLabel = latest === undefined ? '直近年度' : `${latest}年度`;
  const cagrLabel =
    first === undefined || latest === undefined
      ? '期間'
      : first === latest
        ? `${latest}年度`
        : `${first}〜${latest}年度`;
  const lines = [
    '【財務指標（現状分析の計算値）】',
    `上場区分：${listing}`,
    `売上高の年平均成長率（${cagrLabel}）：${percent(company.revenueCagrPct)}`,
    `営業利益率（${latestLabel}）：${percent(company.operatingMarginPctLatest)}`,
    `ROIC（投下資本利益率・${latestLabel}）：${percent(company.roic)}`,
    `ROE（自己資本利益率・${latestLabel}）：${percent(company.roe)}`,
    `D/Eレシオ（負債資本倍率・${latestLabel}）：${multiple(company.debtEquityRatio)}`,
    `WACC（資本コスト・経営者の入力値）：${percent(wacc)}`,
  ];
  if (input.isListed === true && typeof company.pbr === 'number' && Number.isFinite(company.pbr)) {
    lines.push(`PBR（株価純資産倍率）：${multiple(company.pbr)}`);
  }
  lines.push(
    '※上記は入力データからの計算値です。未算出の指標は未算出と書き、数値を補わないこと。',
    '',
  );
  return lines.join('\n');
}
