import {
  FINANCE_PLAN_CALC_VERSION,
  freshnessLabel,
  judgeFreshness,
  readStoredFinancePlan,
  type CalcSnapshotMeta,
} from '@/utils/stage6/financePlanSnapshot';
import { computeStage6FinancePlan } from '@/utils/stage6/financePlanPipeline';
import { buildFinanceOutlook, forecastHorizonOf, type FinanceOutlook } from '@/utils/stage6/financeOutlook';
import { performanceViewOf, projectPerformanceTableOf, type PerformanceView } from '@/utils/stage6/performanceView';
import { planActualProjectsOf } from '@/utils/stage6/planActualComparison';
import type { FinanceEffectTrial } from '@/utils/stage6/financeEffectPlan';
import { formatAmount } from '@/lib/ceoChat/stage1Blocks';

export const STAGE6_CHAR_BUDGET = 3200;
const MAX_YEARS = 5;
const MAX_PROJECTS = 8;
const OUTLOOK_NOTE =
  '- 業績・資金の見通しは、現在のSTAGE1・4のデータと保存済みの財務計画から、トップ画面・STAGE6・銀行向け計画書と同じ計算で出した推計です（確定値ではありません）。保存済みシミュレーション（保存時点の計算結果）より、この見通しを優先すること。未算定の項目は推測で補わないこと。登録目標は見通しではなく目標として扱うこと。';
const SIMULATION_MAX = 3;
const HEADER = '# 業績・資金の数値（STAGE6、区分ごとに表示）';
const CATEGORY_NOTE =
  '- 数値の区分：実績＝STAGE1に登録された値、目標＝経営者が設定した目標値、見通し＝現在のデータから計算した推計、保存済み＝過去に保存された計算結果。区分を取り違えないこと。';
const FORECAST_NOTE =
  '- 予測未算出：売上・営業利益・現預金の将来予測は、目標と独立した計算結果がありません（成長や資金の前提が登録されていません）。目標年以降の値は目標そのものであり、予測として扱わないこと。';
const CASH_FORECAST_NOTE = '- 期末現預金の予測：未算出（現在の実績とは別の区分。推測で補わないこと）。';
const SIMULATION_STALE_NOTE =
  '- 以下の保存済みシミュレーションは保存時点の計算結果です。現在のSTAGE1・4のデータとの一致は未検証で、現在の計画と一致するとは断定できません。保存結果は再計算・補完していません。';

const PROJECT_CUE = /プロジェクト|施策|部門|貢献|寄与|効果|どれ|どの/;
const PERF_CUE = /実績|達成|進捗|登録|月次|実際|未達|上振れ|下振れ|成果|成績|届|年3月期|決算/;
const DEBT_CUE = /借入|返済|利息|設備|投資|人員|現預金|資金|キャッシュ|不足|DSCR|返済余力|CF/i;
const SIMULATION_CUE = /シミュレーション|保存|過去|前回/;
const KIND_LABEL: Record<string, string> = { REVENUE_UP: '売上増加', COST_REDUCTION: '費用削減', COST_INCREASE: '追加費用' };

function isRecord(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function dayOf(v: unknown): string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '';
}

function money(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? formatAmount(v) : '未登録';
}

const calc = (v: number | null | undefined): string => (typeof v === 'number' && Number.isFinite(v) ? formatAmount(v) : '未算定');

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
type OkStored = Extract<Stored, { kind: 'OK' }>;

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

/* 質問に含まれる年度（2030年度・2027年3月期・2030年）。質問の年度を優先して参照する */
export function yearsMentionedIn(question: string): number[] {
  const out = new Set<number>();
  const re = /(\d{4})\s*年(?:\s*\d{1,2}\s*月期|\s*度)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(question ?? '')) !== null) {
    const y = Number(m[1]);
    if (y >= 2000 && y <= 2100) out.add(y);
  }
  return [...out].sort((a, b) => a - b);
}

type Selection = { debt: boolean; project: boolean; perf: boolean; simulation: boolean };

/** 質問がない（従来の全体参照）ときは全区画、質問があるときは関係する区画だけ */
export function selectionOf(question: string | undefined): Selection {
  if (question === undefined) return { debt: true, project: true, perf: true, simulation: true };
  return {
    debt: DEBT_CUE.test(question),
    project: PROJECT_CUE.test(question),
    perf: PERF_CUE.test(question),
    simulation: SIMULATION_CUE.test(question),
  };
}

type Outlook = FinanceOutlook;

function outlookOf(args: Args, domain: OkStored['domain']): Outlook | null {
  try {
    return buildFinanceOutlook({
      financePL: Array.isArray(args.financePL) ? (args.financePL as any) : [],
      financeBS: Array.isArray(args.financeBS) ? (args.financeBS as any) : [],
      departments: Array.isArray(args.departments) ? (args.departments as any) : [],
      fiscalYearEnd: args.fiscalYearEnd,
      companyTargets: Array.isArray(args.companyTargets) ? (args.companyTargets as any) : [],
      domain,
      currentYear: args.currentYear,
    });
  } catch {
    return null;
  }
}

/* 参照する予測年度：質問の年度と経営目標の年度を優先し、無ければ直近の3年度 */
function yearsFor(outlook: Outlook, question: string | undefined, domainTargetYear: number | null) {
  const forecast = outlook.financedPlan.years.filter((y) => y.kind === 'FORECAST').map((y) => y.year);
  const mentioned = yearsMentionedIn(question ?? '');
  const targets = [outlook.target.revenueDueYear, outlook.target.operatingIncomeDueYear, domainTargetYear].filter(
    (y): y is number => typeof y === 'number'
  );
  const want = new Set([...mentioned, ...targets].filter((y) => forecast.includes(y)));
  const years = (want.size > 0 ? [...want].sort((a, b) => a - b) : forecast.slice(0, 3)).slice(0, MAX_YEARS);
  const outside = mentioned.filter((y) => !forecast.includes(y));
  return { years, outside, forecastRange: forecast.length > 0 ? [forecast[0], forecast[forecast.length - 1]] : null };
}

function coreLines(outlook: Outlook, years: number[], outside: number[], range: number[] | null): string[] {
  const unified = new Map(outlook.unifiedPl.years.map((u) => [u.fiscalYear, u]));
  const cash = new Map(outlook.financedPlan.years.map((y) => [y.year, y]));
  const lines = ['- 年度別（施策反映後。既存事業＋確認済み施策効果、借入反映後の現預金）：'];
  for (const y of years) {
    const u = unified.get(y);
    const c = cash.get(y);
    lines.push(
      `  ・${y}年度｜売上 ${calc(u?.plan.revenueYen)}（既存事業 ${calc(u?.baseline.revenueYen)}・施策効果 ${calc(u?.effect.revenueUpYen)}）｜営業利益 ${calc(u?.plan.operatingIncomeYen)}（既存事業 ${calc(u?.baseline.operatingIncomeYen)}・施策効果 ${calc(u?.confirmedOperatingImprovementYen)}）｜期末現預金 ${calc(c?.closingCashAfterFinancing.value)}`
    );
    if (c?.verdict) lines.push(`    判定：${c.verdict}`);
  }
  if (outside.length > 0 && range) {
    lines.push(`- 指定の${outside.join('・')}年度は予測期間（${range[0]}〜${range[1]}年度）の外のため、算出していません。`);
  }
  return lines;
}

function gapLines(outlook: Outlook): string[] {
  const gap = outlook.unifiedPl.gap;
  if (!gap) return [];
  const row = (label: string, g: { fiscalYear: number | null; valueYen: number | null; reason: string | null }) => {
    const at = g.fiscalYear !== null ? `${g.fiscalYear}年度` : '';
    if (g.valueYen === null) return `  ・${label}：未算定${g.reason ? `（${g.reason}）` : ''}`;
    if (g.valueYen > 0) return `  ・${label}：目標に対して不足 ${formatAmount(g.valueYen)}（${at}）`;
    if (g.valueYen < 0) return `  ・${label}：目標を超過 ${formatAmount(-g.valueYen)}（${at}）`;
    return `  ・${label}：目標と同額（${at}）`;
  };
  return ['- 経営目標（STAGE2の業績目標）との差（施策反映後）：', row('売上', gap.revenue), row('営業利益', gap.operatingIncome)];
}

function debtLines(outlook: Outlook, years: number[]): string[] {
  const cash = new Map(outlook.financedPlan.years.map((y) => [y.year, y]));
  const lines = ['- 設備投資・借入・返済・資金（年度別、借入反映後）：'];
  for (const y of years) {
    const c = cash.get(y);
    const dscr = typeof c?.dscr.value === 'number' ? `${c.dscr.value.toFixed(2)}倍` : '未算定';
    const shortfall =
      typeof c?.postShortfall.value === 'number'
        ? c.postShortfall.value > 0
          ? `不足 ${formatAmount(c.postShortfall.value)}`
          : 'なし'
        : '未算定';
    lines.push(
      `  ・${y}年度｜設備投資 ${calc(c?.capex.value)}｜新規借入 ${calc(c?.draws.value)}｜元本返済 ${calc(c?.principal.value)}｜支払利息 ${calc(c?.interest.value)}｜返済余力（DSCR） ${dscr}｜資金不足 ${shortfall}`
    );
  }
  return lines;
}

function projectLines(trial: FinanceEffectTrial, years: number[]): string[] {
  const reflected = trial.projects.filter((r) => r.status === 'REFLECTED');
  const lines = ['- プロジェクト別の財務効果（確認済みで試算に反映されたもの）：'];
  if (reflected.length === 0) lines.push('  反映されている施策はありません。');
  for (const r of reflected.slice(0, MAX_PROJECTS)) {
    const isRevenue = r.kind === 'REVENUE_UP';
    const parts = years
      .map((fy) => r.years.find((y) => y.fiscalYear === fy))
      .filter((y): y is NonNullable<typeof y> => !!y)
      .map((y) =>
        isRevenue
          ? `${y.fiscalYear}年度 売上増 ${calc(y.revenueYen)}・営業利益効果 ${calc(y.operatingIncomeYen)}`
          : `${y.fiscalYear}年度 営業利益効果 ${calc(y.operatingIncomeYen)}`
      );
    const kind = r.kind ? KIND_LABEL[r.kind] ?? '種類未設定' : '種類未設定';
    lines.push(`  ・${r.deptName}／${r.projectTitle}（${kind}）：${parts.length ? parts.join('、') : '選択した年度の効果はありません'}`);
  }
  if (reflected.length > MAX_PROJECTS) lines.push(`  （ほか${reflected.length - MAX_PROJECTS}件）`);
  const pending = trial.projects.length - reflected.length;
  if (pending > 0) lines.push(`  試算に反映されていない施策：${pending}件（未確認・未入力のため金額は含めない）`);
  return lines;
}

function achievementText(v: PerformanceView['current']['achievement']): string {
  if (v.pct !== null) return `${(Math.round(v.pct * 10) / 10).toFixed(1)}%`;
  return v.text ?? '未算定';
}

function summaryLine(label: string, v: PerformanceView): string {
  const c = v.current;
  const target = c.targetYen !== null ? calc(c.targetYen) : (c.targetUnknownText ?? '未算定');
  const actual = c.actualYen !== null ? calc(c.actualYen) : (c.actualUnknownText ?? '未登録');
  const note = c.actualNote ?? (c.achievement.reference ? '登録途中の参考値' : '');
  const suffix = note ? `（${note}）` : '';
  return `- 会社全体・${label}（${c.periodLabel}）：目標 ${target}｜登録済みの実績 ${actual}｜達成率 ${achievementText(c.achievement)}${suffix}`;
}

function performanceLines(outlook: Outlook, args: Args, now: Date): string[] {
  const actual = outlook.baselinePlan.years.find((y) => y.kind === 'ACTUAL');
  const current = actual
    ? { fiscalYear: actual.year, revenueYen: actual.revenue.value, operatingIncomeYen: actual.operatingIncome.value }
    : null;
  const departments = Array.isArray(args.departments) ? (args.departments as any) : [];
  const projects = planActualProjectsOf(departments, args.fiscalYearEnd);
  const base = { now, fiscalYearEnd: args.fiscalYearEnd, current, target: outlook.target, trialYears: outlook.effectTrial.years, projects };
  const revenue = performanceViewOf({ metric: 'REVENUE', ...base });
  const profit = performanceViewOf({ metric: 'OPERATING_INCOME', ...base });
  const table = projectPerformanceTableOf({
    metric: 'REVENUE',
    currentFiscalYear: revenue.currentFiscalYear,
    fiscalYearEnd: args.fiscalYearEnd,
    trialProjects: outlook.effectTrial.projects,
    projects,
    departments,
  });
  const rows = table.groups
    .flatMap((g) => g.rows)
    .filter((r) => r.targetYen !== null || r.actualYen !== null)
    .slice(0, MAX_PROJECTS);
  const lines = [
    '- 登録済みの実績と達成率（STAGE5・当会計年度。画面の数値と同じ計算）：',
    summaryLine('売上高', revenue),
    summaryLine('営業利益', profit),
  ];
  for (const r of rows) {
    const t = r.targetYen !== null ? calc(r.targetYen) : (r.targetLabel ?? '未算定');
    const a = r.actualYen !== null ? calc(r.actualYen) : (r.actualLabel ?? '未登録');
    lines.push(`  ・${r.deptName}／${r.projectTitle}：目標 ${t}｜実績 ${a}｜達成率 ${achievementText(r.achievement)}`);
  }
  if (rows.length === 0) lines.push('  施策別の目標・実績はまだ登録されていません。');
  return lines;
}

/** 保存済みの計画が、現在のSTAGE1・4のデータと一致するかを、STAGE6の画面と同じ判定で確かめる */
function freshnessOf(stored: OkStored, companyId: string | null, computed: ReturnType<typeof computeStage6FinancePlan>): string {
  const inv = computed.investment;
  const current: CalcSnapshotMeta = {
    calcVersion: FINANCE_PLAN_CALC_VERSION,
    companyId: companyId ?? stored.meta.companyId,
    baseYear: computed.basePlan.baseYear,
    bsBaseYear: computed.basePlan.bsBaseYear,
    assumptionsHash: computed.assumptionsHash,
    sourceHash: computed.sourceHash,
    unconfirmed: {
      unapprovedReadyYen: inv.unapprovedReadyYen,
      unclassifiedYen: inv.unclassifiedYen,
      unscheduledYen: inv.unscheduledYen,
      candidateYen: inv.candidateYen,
      basisPendingYen: inv.basisPendingYen,
    },
    computedAt: stored.meta.computedAt,
  };
  return `- 保存状態：${freshnessLabel(judgeFreshness(stored.meta, current))}`;
}

type Args = {
  csvFinanceData: unknown;
  companyId: string | null;
  financePL: unknown;
  financeBS: unknown;
  departments: unknown;
  fiscalYearEnd?: string;
  currentYear: number;
  companyTargets?: unknown;
  simulationResults?: unknown;
  question?: string;
  now?: Date;
};

type CashArgs = Pick<Args, 'csvFinanceData' | 'companyId' | 'financePL' | 'financeBS' | 'departments' | 'fiscalYearEnd' | 'currentYear' | 'companyTargets' | 'question'>;

type Section = { title: string; lines: string[] };

function assemble(fixed: string[], sections: Section[]): string {
  let out = fixed.join('\n');
  const omitted: string[] = [];
  for (const s of sections) {
    const block = s.lines.join('\n');
    if (out.length + 1 + block.length <= STAGE6_CHAR_BUDGET) out += `\n${block}`;
    else omitted.push(s.title);
  }
  if (omitted.length > 0) out += `\n- ${omitted.join('、')}は上限のため省略（質問に関係する場合は、その年度や施策を指定して再度確認すること）`;
  return out;
}

export function buildStage6PlanBlock(args: Args): string {
  const fixed: string[] = [HEADER, CATEGORY_NOTE];
  const stored = storedOf(args.csvFinanceData, args.companyId);
  const status = storedStatusLine(stored, isStage6StoreNoneConfirmed(args.csvFinanceData));
  fixed.push(actualLine(latestActual(args.financePL, args.financeBS), isStage6FinanceAbsent(args.financePL)));
  const sel = selectionOf(args.question);
  const sections: Section[] = [];

  if (stored.kind === 'OK') {
    const a = stored.domain.assumptions;
    if (a.targetYear !== null && (a.targetRevenueYen !== null || a.targetOperatingIncomeYen !== null)) {
      fixed.push(`- 目標（経営者が登録）：${a.targetYear}年度 売上 ${money(a.targetRevenueYen)}｜営業利益 ${money(a.targetOperatingIncomeYen)}`);
    } else {
      fixed.push('- 目標（経営者が登録）：未登録です。');
    }
    if (a.minCashYen !== null) fixed.push(`- 最低現預金（登録前提）：${money(a.minCashYen)}`);
    fixed.push(`- 前提の保存日時: ${dayOf(stored.savedAt) || '日付未登録'}`);

    let computed: ReturnType<typeof computeStage6FinancePlan> | null = null;
    try {
      const financePL = Array.isArray(args.financePL) ? (args.financePL as any) : [];
      computed = computeStage6FinancePlan({
        financePL,
        financeBS: Array.isArray(args.financeBS) ? (args.financeBS as any) : [],
        departments: Array.isArray(args.departments) ? (args.departments as any) : [],
        fiscalYearEnd: args.fiscalYearEnd,
        domain: stored.domain,
        currentYear: args.currentYear,
        horizonYears: forecastHorizonOf(financePL, args.currentYear, args.companyTargets as any),
      });
    } catch {
      computed = null;
    }
    if (computed) {
      fixed.push(freshnessOf(stored, args.companyId, computed));
      if (!computed.fiscalYearEndSet) fixed.push('- 決算月が未登録のため、年度の対応は確定していません。');
      if (computed.plan.yearMismatch) fixed.push('- PLとBSの基準年度が一致しません。');
      if (computed.plan.unitSuspects.length > 0) fixed.push(`- 単位を確認してください: ${computed.plan.unitSuspects.join('、')}`);
      if (!computed.debtEntered) fixed.push('- 既存借入・新規借入・配当は未登録です。返済額は算出していません。');
    } else {
      fixed.push('- 入力データの整合を確認できませんでした（数値は出しません）。');
    }

    const outlook = computed ? outlookOf(args, stored.domain) : null;
    if (outlook) {
      const picked = yearsFor(outlook, args.question, stored.domain.assumptions.targetYear);
      fixed.push(OUTLOOK_NOTE);
      sections.push({ title: '年度別の見通し', lines: coreLines(outlook, picked.years, picked.outside, picked.forecastRange) });
      const gap = gapLines(outlook);
      if (gap.length > 0) sections.push({ title: '経営目標との差', lines: gap });
      if (sel.debt) sections.push({ title: '設備投資・借入・返済', lines: debtLines(outlook, picked.years) });
      if (sel.project) sections.push({ title: 'プロジェクト別の財務効果', lines: projectLines(outlook.effectTrial, picked.years) });
      if (sel.perf) {
        try {
          sections.push({ title: 'STAGE5の実績と達成率', lines: performanceLines(outlook, args, args.now ?? new Date()) });
        } catch {
          sections.push({ title: 'STAGE5の実績と達成率', lines: ['- 実績と達成率を算出できませんでした（数値は出しません）。'] });
        }
      }
    } else {
      fixed.push(FORECAST_NOTE, CASH_FORECAST_NOTE);
    }
  } else {
    if (status) fixed.push(status);
    fixed.push(FORECAST_NOTE, CASH_FORECAST_NOTE);
  }

  if (sel.simulation) {
    const rows = Array.isArray(args.simulationResults) ? args.simulationResults.filter(isRecord) : [];
    const lines: string[] = [];
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
    const simulation: Section = { title: '保存済みシミュレーション', lines };
    const asked = args.question !== undefined && SIMULATION_CUE.test(args.question);
    if (asked) sections.splice(1, 0, simulation);
    else sections.push(simulation);
  }

  return assemble(fixed, sections);
}

/** 資金の相談で、現預金の実績と最低現預金、年度別の期末現預金（STAGE6と同じ試算）を渡す。 */
export function buildCashPositionBlock(args: CashArgs): string {
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
  const outlook = stored.kind === 'OK' ? outlookOf(args, stored.domain) : null;
  if (stored.kind === 'OK' && outlook) {
    const picked = yearsFor(outlook, args.question, stored.domain.assumptions.targetYear);
    const cash = new Map(outlook.financedPlan.years.map((y) => [y.year, y]));
    const parts = picked.years.map((y) => `${y}年度 ${calc(cash.get(y)?.closingCashAfterFinancing.value)}`);
    lines.push(OUTLOOK_NOTE, `- 期末現預金（施策反映後・借入反映後）：${parts.join('｜') || '算出できる年度がありません'}`);
  } else {
    lines.push(CASH_FORECAST_NOTE);
  }
  return lines.join('\n');
}
