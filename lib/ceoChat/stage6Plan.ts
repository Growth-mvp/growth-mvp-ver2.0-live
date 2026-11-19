import { readStoredFinancePlan } from '@/utils/stage6/financePlanSnapshot';
import { computeStage6FinancePlan } from '@/utils/stage6/financePlanPipeline';
import { buildFinanceOutlook, forecastHorizonOf, type FinanceOutlook } from '@/utils/stage6/financeOutlook';
import { formatAmount } from '@/lib/ceoChat/stage1Blocks';

export const STAGE6_CHAR_BUDGET = 2000;
const OUTLOOK_YEARS = 3;
const OUTLOOK_NOTE =
  '- 業績・資金の見通しは、保存済みの財務計画と現在のデータから、トップ画面・STAGE6・銀行向け計画書と同じ計算で出した推計です（確定値ではありません）。未算定の項目は推測で補わないこと。登録目標は見通しではなく目標として扱うこと。期末現預金の見通しは、現在の実績（STAGE1登録）とは別の区分です。';
const SIMULATION_MAX = 3;
const HEADER = '# 業績・資金の数値（STAGE6、区分ごとに表示）';
const CATEGORY_NOTE =
  '- 数値の区分：実績＝STAGE1に登録された値、目標＝経営者が設定した目標値、保存済み＝過去に保存された計算結果。区分を取り違えないこと。';
const FORECAST_NOTE =
  '- 予測未算出：売上・営業利益・現預金の将来予測は、目標と独立した計算結果がありません（成長や資金の前提が登録されていません）。目標年以降の値は目標そのものであり、予測として扱わないこと。';
const CASH_FORECAST_NOTE = '- 期末現預金の予測：未算出（現在の実績とは別の区分。推測で補わないこと）。';
const SIMULATION_STALE_NOTE =
  '- 以下の保存済みシミュレーションは保存時点の計算結果です。現在のSTAGE1・4のデータとの一致は未検証で、現在の計画と一致するとは断定できません。保存結果は再計算・補完していません。';
const ASSUMPTION_STALE_NOTE = '- 保存済みの前提も、現在のSTAGE1・4のデータとの一致は未検証です。';

function isRecord(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function dayOf(v: unknown): string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '';
}

function money(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? formatAmount(v) : '未登録';
}

type Actual = { year: number; revenue: number | null; operatingIncome: number | null; cash: number | null };

/** STAGE1に登録された最新の実績（損益の最新年度。現預金は同じ年度の貸借対照表から）。 */
export function latestActual(financePL: unknown, financeBS: unknown): Actual | null {
  const pl = Array.isArray(financePL) ? financePL.filter(isRecord).filter((r) => typeof r.year === 'number') : [];
  if (pl.length === 0) return null;
  const latest = pl.reduce((a, b) => (b.year > a.year ? b : a));
  const bs = Array.isArray(financeBS) ? financeBS.filter(isRecord) : [];
  const bsRow = bs.find((r) => r.year === latest.year);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    year: latest.year,
    revenue: num(latest.revenue),
    operatingIncome: num(latest.operatingIncome),
    cash: num(bsRow?.cash),
  };
}

/** 正規化後の損益配列が空のときだけ、損益データの未登録と断定できる（正規化は保存値を空にしないため） */
export function isStage6FinanceAbsent(financePL: unknown): boolean {
  return Array.isArray(financePL) && financePL.length === 0;
}

/** 他の項目を含む保存データがあり、前提キーだけが無いときだけ、保存済み資金計画の未保存と断定できる */
export function isStage6StoreNoneConfirmed(csvFinanceData: unknown): boolean {
  return isRecord(csvFinanceData) && Object.keys(csvFinanceData).length > 0 && csvFinanceData.financePlanAssumptions == null;
}

function actualLine(a: Actual | null, financeAbsent: boolean): string {
  if (!a) {
    return financeAbsent
      ? '- 実績（STAGE1登録）：損益データが未登録です。'
      : '- 実績（STAGE1登録）：今回参照した情報では確認できません。';
  }
  return `- 実績（STAGE1登録、${a.year}年度）：売上 ${money(a.revenue)}｜営業利益 ${money(a.operatingIncome)}｜期末現預金 ${money(a.cash)}`;
}

type Stored = ReturnType<typeof readStoredFinancePlan>;

function storedOf(csvFinanceData: unknown, companyId: string | null): Stored {
  const csv = isRecord(csvFinanceData) ? csvFinanceData : {};
  return readStoredFinancePlan(csv.financePlanAssumptions, companyId);
}

function storedStatusLine(stored: Stored, noneConfirmed: boolean): string | null {
  switch (stored.kind) {
    case 'NONE':
      return noneConfirmed
        ? '- 保存済みの資金計画はありません。目標と借入・返済の数値は出しません。'
        : '- 保存済みの資金計画は今回参照した情報では確認できません。目標と借入・返済の数値は出しません。';
    case 'DIFFERENT_COMPANY':
      return '- 保存済みの資金計画は、この会社のものとして確認できませんでした。目標と借入・返済の数値は出しません。';
    case 'INVALID':
      return `- 保存済みの資金計画を読めませんでした（${stored.error}）。目標と借入・返済の数値は出しません。`;
    default:
      return null;
  }
}

const calc = (v: number | null | undefined): string => (typeof v === 'number' && Number.isFinite(v) ? formatAmount(v) : '未算定');

/* 施策反映後の売上・営業利益・期末現預金・判定を、STAGE6と同じ試算の結果から年度ごとに並べる（未算定は未算定と書く） */
function outlookLines(outlook: FinanceOutlook): string[] {
  const forecast = outlook.financedPlan.years.filter((y) => y.kind === 'FORECAST').slice(0, OUTLOOK_YEARS);
  if (forecast.length === 0) return [];
  const unified = new Map(outlook.unifiedPl.years.map((u) => [u.fiscalYear, u]));
  const lines: string[] = ['- 年度別（施策反映後）：売上・営業利益・期末現預金、施策効果の内訳'];
  for (const y of forecast) {
    const u = unified.get(y.year);
    const effect = u
      ? `（施策効果：売上 ${calc(u.effect.revenueUpYen)}、営業利益 ${calc(u.effect.revenueOperatingIncomeYen)}）`
      : '';
    lines.push(
      `  ・${y.year}年度：売上 ${calc(y.revenue.value)}・営業利益 ${calc(y.operatingIncome.value)}・期末現預金 ${calc(y.closingCashAfterFinancing.value)}${effect}`
    );
    if (y.verdict) lines.push(`    判定：${y.verdict}`);
  }
  return lines;
}

function safeOutlookLines(args: Parameters<typeof buildStage6PlanBlock>[0], domain: Parameters<typeof buildFinanceOutlook>[0]['domain']): string[] {
  try {
    const outlook = buildFinanceOutlook({
      financePL: Array.isArray(args.financePL) ? (args.financePL as any) : [],
      financeBS: Array.isArray(args.financeBS) ? (args.financeBS as any) : [],
      departments: Array.isArray(args.departments) ? (args.departments as any) : [],
      fiscalYearEnd: args.fiscalYearEnd,
      companyTargets: Array.isArray(args.companyTargets) ? (args.companyTargets as any) : [],
      domain,
      currentYear: args.currentYear,
    });
    return outlookLines(outlook);
  } catch {
    return [];
  }
}

export function buildStage6PlanBlock(args: {
  csvFinanceData: unknown;
  companyId: string | null;
  financePL: unknown;
  financeBS: unknown;
  departments: unknown;
  fiscalYearEnd?: string;
  currentYear: number;
  companyTargets?: unknown;
  simulationResults?: unknown;
}): string {
  const lines: string[] = [HEADER, CATEGORY_NOTE];
  const stored = storedOf(args.csvFinanceData, args.companyId);
  const status = storedStatusLine(stored, isStage6StoreNoneConfirmed(args.csvFinanceData));
  lines.push(actualLine(latestActual(args.financePL, args.financeBS), isStage6FinanceAbsent(args.financePL)));

  if (stored.kind === 'OK') {
    const a = stored.domain.assumptions;
    if (a.targetYear !== null && (a.targetRevenueYen !== null || a.targetOperatingIncomeYen !== null)) {
      lines.push(
        `- 目標（経営者が登録）：${a.targetYear}年度 売上 ${money(a.targetRevenueYen)}｜営業利益 ${money(a.targetOperatingIncomeYen)}`
      );
    } else {
      lines.push('- 目標（経営者が登録）：未登録です。');
    }
    if (a.minCashYen !== null) lines.push(`- 最低現預金（登録前提）：${money(a.minCashYen)}`);
    lines.push(`- 前提の保存日時: ${dayOf(stored.savedAt) || '日付未登録'}`);
    lines.push(ASSUMPTION_STALE_NOTE);
  } else if (status) {
    lines.push(status);
  }

  const outlook = stored.kind === 'OK' ? safeOutlookLines(args, stored.domain) : [];
  if (outlook.length > 0) {
    lines.push(OUTLOOK_NOTE, ...outlook);
  } else {
    lines.push(FORECAST_NOTE);
    lines.push(CASH_FORECAST_NOTE);
  }

  if (stored.kind === 'OK') {
    try {
      const financePL = Array.isArray(args.financePL) ? (args.financePL as any) : [];
      const computed = computeStage6FinancePlan({
        financePL,
        financeBS: Array.isArray(args.financeBS) ? (args.financeBS as any) : [],
        departments: Array.isArray(args.departments) ? (args.departments as any) : [],
        fiscalYearEnd: args.fiscalYearEnd,
        domain: stored.domain,
        currentYear: args.currentYear,
        horizonYears: forecastHorizonOf(financePL, args.currentYear, args.companyTargets as any),
      });
      if (!computed.fiscalYearEndSet) lines.push('- 決算月が未登録のため、年度の対応は確定していません。');
      if (computed.plan.yearMismatch) lines.push('- PLとBSの基準年度が一致しません。');
      if (computed.plan.unitSuspects.length > 0) lines.push(`- 単位を確認してください: ${computed.plan.unitSuspects.join('、')}`);
      if (!computed.debtEntered) lines.push('- 既存借入・新規借入・配当は未登録です。返済額は算出していません。');
    } catch {
      lines.push('- 入力データの整合を確認できませんでした（数値は出しません）。');
    }
  }

  const rows = Array.isArray(args.simulationResults) ? args.simulationResults.filter(isRecord) : [];
  if (rows.length === 0) {
    lines.push('- 保存済みシミュレーションはありません。');
  } else {
    lines.push(SIMULATION_STALE_NOTE);
    for (const r of rows.slice(0, SIMULATION_MAX)) {
      const points = Array.isArray(r.payload?.projection?.points) ? r.payload.projection.points.filter(isRecord) : [];
      const pts = points
        .map((p: Record<string, any>) => `${p.year} 売上${formatAmount(p.sales)}・営業利益${formatAmount(p.op)}`)
        .join('、');
      const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : '無題';
      const date = dayOf(r.created_at) || '日付未登録';
      lines.push(`- 保存済み（保存時点の計算結果）：${title}（${date}）：${pts || '点なし'}`);
    }
  }

  let out = lines.join('\n');
  if (out.length > STAGE6_CHAR_BUDGET) out = `${out.slice(0, STAGE6_CHAR_BUDGET)}…（上限のため省略）`;
  return out;
}

/** 資金の相談で、現預金の実績と最低現預金だけを渡す（予測は含めない）。 */
export function buildCashPositionBlock(args: {
  csvFinanceData: unknown;
  companyId: string | null;
  financePL: unknown;
  financeBS: unknown;
}): string {
  const lines = [
    '# 現預金（区分ごとに表示）',
    CATEGORY_NOTE,
    actualLine(latestActual(args.financePL, args.financeBS), isStage6FinanceAbsent(args.financePL)),
  ];
  const stored = storedOf(args.csvFinanceData, args.companyId);
  if (stored.kind === 'OK' && stored.domain.assumptions.minCashYen !== null) {
    lines.push(`- 最低現預金（登録前提）：${money(stored.domain.assumptions.minCashYen)}`);
  } else if (stored.kind === 'OK' || (stored.kind === 'NONE' && isStage6StoreNoneConfirmed(args.csvFinanceData))) {
    lines.push('- 最低現預金：未登録です。');
  } else {
    lines.push('- 最低現預金：保存済みの資金計画は今回参照した情報では確認できません。');
  }
  lines.push(CASH_FORECAST_NOTE);
  return lines.join('\n');
}
