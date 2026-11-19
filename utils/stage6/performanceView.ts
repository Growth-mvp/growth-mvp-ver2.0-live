/* 成果の可視化（トップ画面・STAGE6の共通）：既存の財務試算と計画・実績の照合結果を、表示用の値に変える（計算はしない）。
 * 未登録・未算定は 0 にせず、理由を返す。営業利益の実績は費用削減の実績だけを使い、売上増加の実績を営業利益として扱わない。
 * 達成率は同じ年度どうしの値（当会計年度の目標と実績）からだけ算出する。 */
import type { Department } from '@/types/strategy';
import { parseFiscalYearEndMonth } from './investmentDemand';
import type { FinanceEffectProjectRow, FinanceEffectTrialYear } from './financeEffectPlan';
import { planActualYearRowsOf, type PlanActualProject, type PlanActualYearStatus } from './planActualComparison';
import type { PlTarget } from './unifiedPl';

export type PerformanceMetric = 'REVENUE' | 'OPERATING_INCOME';

export type PerformanceBarId = 'COMPANY_CURRENT' | 'COMPANY_TARGET' | 'PROJECT_TARGET' | 'PROJECT_ACTUAL';

export type PerformanceBar = {
  id: PerformanceBarId;
  group: 'COMPANY' | 'PROJECT';
  label: string;
  /** 対象年度（例：2025年度、2030年度、2027年3月期） */
  periodLabel: string;
  yen: number | null;
  /** yen が null のときの理由。0円として扱わない */
  unknownText: string | null;
  /** 補足（登録途中は参考値）。棒の下に示す */
  note: string | null;
};

/** 達成率。参考（登録途中の実績）の場合は reference を true にし、確定値として見せない */
export type Achievement = {
  pct: number | null;
  text: string | null;
  caption: string;
  reference: boolean;
};

export type CurrentSummary = {
  periodLabel: string;
  targetYen: number | null;
  targetUnknownText: string | null;
  actualYen: number | null;
  actualUnknownText: string | null;
  actualNote: string | null;
  achievement: Achievement;
};

export type PerformanceView = {
  metric: PerformanceMetric;
  endMonth: number | null;
  /** 経営目標の目標年度（指標ごと）。プロジェクトの目標の対象年度 */
  targetFiscalYear: number | null;
  /** 当会計年度（決算期の終了年）。プロジェクトの実績と達成率の対象年度 */
  currentFiscalYear: number | null;
  bars: PerformanceBar[];
  current: CurrentSummary;
};

/** 目標の状態。計画期間外と0円、未算定を区別する */
export type TargetKind = 'VALUE' | 'OUT_OF_PERIOD' | 'NONE' | 'UNKNOWN';

export type ProjectPerformanceRow = {
  deptName: string;
  projectTitle: string;
  targetKind: TargetKind;
  targetYen: number | null;
  /** 金額がないときの表示（計画期間外・財務効果なし・未算定） */
  targetLabel: string | null;
  actualYen: number | null;
  actualLabel: string | null;
  actualNote: string | null;
  achievement: Achievement;
};

export type ProjectPerformanceTable = {
  groups: { deptName: string; rows: ProjectPerformanceRow[] }[];
  total: { targetYen: number | null; targetLabel: string | null; actualYen: number | null; actualLabel: string | null; actualNote: string | null; achievement: Achievement };
};

export const METRIC_LABEL: Record<PerformanceMetric, string> = { REVENUE: '売上高', OPERATING_INCOME: '営業利益' };

export function endMonthOf(fiscalYearEnd: string | null | undefined): number | null {
  return parseFiscalYearEndMonth(fiscalYearEnd ?? undefined);
}

/** 当会計年度（決算期の終了年）。決算月が未設定なら null */
export function currentFiscalYearOf(now: Date, endMonth: number | null): number | null {
  if (endMonth === null) return null;
  const month = now.getMonth() + 1;
  return month > endMonth ? now.getFullYear() + 1 : now.getFullYear();
}

export function fiscalPeriodLabel(fiscalYear: number, endMonth: number | null): string {
  return endMonth === null ? `${fiscalYear}年度` : `${fiscalYear}年${endMonth}月期`;
}

/** 全社の現状（直近の実績年度）と目標（経営目標の目標年度） */
export function companyBarsOf(args: {
  metric: PerformanceMetric;
  current: { fiscalYear: number; revenueYen: number | null; operatingIncomeYen: number | null } | null;
  target: PlTarget;
}): PerformanceBar[] {
  const { metric, current, target } = args;
  const currentYen = current ? (metric === 'REVENUE' ? current.revenueYen : current.operatingIncomeYen) : null;
  const targetYen = metric === 'REVENUE' ? target.revenueYen : target.operatingIncomeYen;
  const dueYear = metric === 'REVENUE' ? target.revenueDueYear : target.operatingIncomeDueYear;
  return [
    {
      id: 'COMPANY_CURRENT',
      group: 'COMPANY',
      label: '現状',
      periodLabel: current ? `${current.fiscalYear}年度` : '実績なし',
      yen: currentYen,
      unknownText: currentYen === null ? '基準年度の実績が未入力' : null,
      note: null,
    },
    {
      id: 'COMPANY_TARGET',
      group: 'COMPANY',
      label: '目標',
      periodLabel: dueYear === null ? '目標年度なし' : `${dueYear}年度`,
      yen: targetYen,
      unknownText: targetYen === null ? '経営目標が未登録' : dueYear === null ? '目標年度が未登録' : null,
      note: null,
    },
  ];
}

/** 確認済みの財務効果の年度合計（営業利益はOPEX控除後）。試算の対象外の年度は null */
export function projectTargetYenOf(trialYears: readonly FinanceEffectTrialYear[], metric: PerformanceMetric, fiscalYear: number): number | null {
  const y = trialYears.find((t) => t.fiscalYear === fiscalYear);
  if (!y) return null;
  if (metric === 'REVENUE') return y.revenueYen;
  const cost = y.costReductionYen - y.costIncreaseYen;
  if (y.revenueOperatingIncomeYen !== null) return y.revenueOperatingIncomeYen + cost;
  return y.revenueYen === 0 ? cost : null;
}

/** 登録済みの実績の年度合計。売上は売上増加、営業利益は費用削減だけを使う */
export function projectActualOf(
  projects: readonly PlanActualProject[],
  metric: PerformanceMetric,
  fiscalYear: number,
  endMonth: number,
): { yen: number | null; status: PlanActualYearStatus | null } {
  const kind = metric === 'REVENUE' ? 'REVENUE_UP' : 'COST_REDUCTION';
  const mode = metric === 'REVENUE' ? 'REVENUE' : 'COST';
  let total: number | null = null;
  let worst: PlanActualYearStatus | null = null;
  for (const p of projects) {
    for (const item of p.items) {
      if (item.kind !== kind) continue;
      for (const row of planActualYearRowsOf(item, mode, endMonth)) {
        if (row.fiscalYear !== fiscalYear || row.actualYen === null) continue;
        total = (total ?? 0) + row.actualYen;
        worst = worst === 'PARTIAL' || row.status === 'PARTIAL' ? 'PARTIAL' : row.status;
      }
    }
  }
  return { yen: total, status: worst };
}

const pctOf = (value: number, target: number) => (value / target) * 100;

/**
 * 当会計年度の達成率：同じ年度の目標と実績からだけ算出する。
 * 登録途中の実績は参考値として算出し、reference を立てる。目標が0・未算定、実績が未登録のときは算出しない。
 */
export function projectAchievementOf(args: {
  targetYen: number | null;
  actualYen: number | null;
  actualStatus: PlanActualYearStatus | null;
  periodLabel: string;
}): Achievement {
  const { targetYen, actualYen, actualStatus, periodLabel } = args;
  const caption = `${periodLabel}の目標に対する実績`;
  const fail = (text: string): Achievement => ({ pct: null, text, caption, reference: false });
  if (targetYen === null) return fail('目標が未算定のため算出しません');
  if (targetYen === 0) return fail('目標が0円のため算出しません');
  if (targetYen < 0) return fail('目標が負の値のため算出しません');
  if (actualYen === null) return fail('実績が未登録のため算出しません');
  const reference = actualStatus !== 'COMPLETE';
  return { pct: pctOf(actualYen, targetYen), text: null, caption, reference };
}

export function performanceViewOf(args: {
  metric: PerformanceMetric;
  now: Date;
  fiscalYearEnd: string | null | undefined;
  current: { fiscalYear: number; revenueYen: number | null; operatingIncomeYen: number | null } | null;
  target: PlTarget;
  trialYears: readonly FinanceEffectTrialYear[];
  projects: readonly PlanActualProject[];
}): PerformanceView {
  const { metric, now, current, target, trialYears, projects } = args;
  const endMonth = endMonthOf(args.fiscalYearEnd);
  const currentFiscalYear = currentFiscalYearOf(now, endMonth);
  const targetFiscalYear = metric === 'REVENUE' ? target.revenueDueYear : target.operatingIncomeDueYear;
  const bars = companyBarsOf({ metric, current, target });

  // プロジェクトの目標：経営目標の目標年度の財務効果
  let targetBarYen: number | null = null;
  let targetBarUnknown: string | null = '目標年度が未登録のため算出しません';
  if (targetFiscalYear !== null) {
    targetBarYen = projectTargetYenOf(trialYears, metric, targetFiscalYear);
    targetBarUnknown = trialYears.some((t) => t.fiscalYear === targetFiscalYear)
      ? metric === 'OPERATING_INCOME'
        ? '営業利益を算定できない施策があります'
        : '対象年度の金額が未算定です'
      : '目標年度が財務試算の期間の外です';
  }
  const targetPeriod = targetFiscalYear === null ? '目標年度なし' : `${targetFiscalYear}年度`;
  bars.push({
    id: 'PROJECT_TARGET',
    group: 'PROJECT',
    label: '目標',
    periodLabel: targetPeriod,
    yen: targetBarYen,
    unknownText: targetBarYen === null ? targetBarUnknown : null,
    note: null,
  });

  // プロジェクトの実績：当会計年度の登録済み実績
  const period = currentFiscalYear === null ? '当会計年度なし' : fiscalPeriodLabel(currentFiscalYear, endMonth);
  const emptyCurrent = (text: string): CurrentSummary => ({
    periodLabel: period,
    targetYen: null,
    targetUnknownText: text,
    actualYen: null,
    actualUnknownText: text,
    actualNote: null,
    achievement: { pct: null, text, caption: `${period}の目標に対する実績`, reference: false },
  });

  if (currentFiscalYear === null || endMonth === null) {
    const text = '決算月が未設定のため当会計年度を決められません';
    bars.push(
      { id: 'PROJECT_ACTUAL', group: 'PROJECT', label: '実績', periodLabel: '当会計年度なし', yen: null, unknownText: text, note: null },
    );
    return { metric, endMonth, targetFiscalYear, currentFiscalYear, bars, current: emptyCurrent(text) };
  }

  const actual = projectActualOf(projects, metric, currentFiscalYear, endMonth);
  const currentTarget = projectTargetYenOf(trialYears, metric, currentFiscalYear);
  const actualNote =
    actual.yen === null
      ? null
      : actual.status === 'COMPLETE'
        ? '登録済みの実績'
        : '登録途中の実績（参考値）';
  const actualNoteWithScope = actualNote && metric === 'OPERATING_INCOME' ? `${actualNote}（費用削減分）` : actualNote;
  bars.push({
    id: 'PROJECT_ACTUAL',
    group: 'PROJECT',
    label: '実績',
    periodLabel: period,
    yen: actual.yen,
    unknownText: actual.yen === null ? '未登録' : null,
    note: actualNoteWithScope,
  });

  const currentTargetUnknown =
    currentTarget === null
      ? trialYears.some((t) => t.fiscalYear === currentFiscalYear)
        ? metric === 'OPERATING_INCOME'
          ? '営業利益を算定できない施策があります'
          : '対象年度の金額が未算定です'
        : '当会計年度が財務試算の期間の外です'
      : null;

  return {
    metric,
    endMonth,
    targetFiscalYear,
    currentFiscalYear,
    bars,
    current: {
      periodLabel: period,
      targetYen: currentTarget,
      targetUnknownText: currentTargetUnknown,
      actualYen: actual.yen,
      actualUnknownText: actual.yen === null ? '未登録' : null,
      actualNote: actualNoteWithScope,
      achievement: projectAchievementOf({
        targetYen: currentTarget,
        actualYen: actual.yen,
        actualStatus: actual.status,
        periodLabel: period,
      }),
    },
  };
}


/**
 * 目標の状態（当会計年度）。計画期間の外は「計画期間外」、期間内で金額が0なら0、
 * 確認待ちの効果しかない・金額を算定できない年度は未算定として、0と区別する。
 */
function projectTargetKindOf(
  rows: readonly FinanceEffectProjectRow[],
  metric: PerformanceMetric,
  fiscalYear: number,
): { kind: TargetKind; yen: number | null; label: string | null } {
  const reflected = rows.filter((r) => r.status === 'REFLECTED');
  if (reflected.length === 0) {
    if (rows.some((r) => r.status !== 'REFLECTED')) return { kind: 'UNKNOWN', yen: null, label: '未算定' };
    return { kind: 'NONE', yen: null, label: '財務効果なし' };
  }
  let sum = 0;
  let inPeriodCount = 0;
  for (const r of reflected) {
    const inPeriod = (r.startFiscalYear === null || fiscalYear >= r.startFiscalYear) && (r.endFiscalYear === null || fiscalYear <= r.endFiscalYear);
    if (!inPeriod) continue;
    inPeriodCount += 1;
    const y = r.years.find((v) => v.fiscalYear === fiscalYear);
    const value = y ? (metric === 'REVENUE' ? y.revenueYen : y.operatingIncomeYen) : null;
    if (value === null || value === undefined) return { kind: 'UNKNOWN', yen: null, label: '未算定' };
    sum += value;
  }
  if (inPeriodCount === 0) return { kind: 'OUT_OF_PERIOD', yen: null, label: '計画期間外' };
  return { kind: 'VALUE', yen: sum, label: null };
}

/** 一覧の達成率。目標が0・負・未算定・計画期間外のときは算出しない。登録途中の実績は参考値 */
function rowAchievementOf(args: {
  targetYen: number | null;
  targetLabel: string | null;
  actualYen: number | null;
  actualStatus: PlanActualYearStatus | null;
  periodLabel: string;
}): Achievement {
  if (args.targetYen === null) {
    const label = args.targetLabel ?? '未算定';
    return { pct: null, text: `${label}のため算出しません`, caption: `${args.periodLabel}の目標に対する実績`, reference: false };
  }
  return projectAchievementOf({
    targetYen: args.targetYen,
    actualYen: args.actualYen,
    actualStatus: args.actualStatus,
    periodLabel: args.periodLabel,
  });
}

/**
 * 部門・プロジェクト別の一覧（すべて当会計年度）。目標は確認済みの財務効果、実績は登録済みの実績、達成率は同じ年度どうしの値から。
 * 全社合計は、未算定の施策が含まれるときは合計を出さず、0として足さない。
 */
export function projectPerformanceTableOf(args: {
  metric: PerformanceMetric;
  currentFiscalYear: number | null;
  fiscalYearEnd: string | null | undefined;
  trialProjects: readonly FinanceEffectProjectRow[];
  projects: readonly PlanActualProject[];
  departments: readonly Department[];
}): ProjectPerformanceTable {
  const endMonth = endMonthOf(args.fiscalYearEnd);
  const fy = args.currentFiscalYear;
  const period = fy === null ? '当会計年度なし' : fiscalPeriodLabel(fy, endMonth);
  const keyOf = (d: number, p: number) => `${d}:${p}`;
  const names = new Map<string, { deptIndex: number; projectIndex: number; deptName: string; projectTitle: string }>();
  for (const r of args.trialProjects) {
    names.set(keyOf(r.deptIndex, r.projectIndex), { deptIndex: r.deptIndex, projectIndex: r.projectIndex, deptName: r.deptName, projectTitle: r.projectTitle });
  }
  args.departments.forEach((dept, d) => {
    (dept?.projects ?? []).forEach((project, p) => {
      const key = keyOf(d, p);
      if (!names.has(key)) names.set(key, { deptIndex: d, projectIndex: p, deptName: dept?.name ?? '（部署名なし）', projectTitle: project?.title ?? '（施策名なし）' });
    });
  });

  const sorted = [...names.values()].sort((a, b) => a.deptIndex - b.deptIndex || a.projectIndex - b.projectIndex);
  const byDept = new Map<string, ProjectPerformanceRow[]>();
  const all: { target: TargetKind; targetYen: number | null; actualYen: number | null; actualStatus: PlanActualYearStatus | null }[] = [];

  for (const n of sorted) {
    const rows = args.trialProjects.filter((r) => r.deptIndex === n.deptIndex && r.projectIndex === n.projectIndex);
    const target = fy === null ? { kind: 'UNKNOWN' as TargetKind, yen: null, label: '当会計年度なし' } : projectTargetKindOf(rows, args.metric, fy);
    const planProject = args.projects.find((p) => p.deptIndex === n.deptIndex && p.projectIndex === n.projectIndex);
    const actual = planProject && fy !== null && endMonth !== null ? projectActualOf([planProject], args.metric, fy, endMonth) : { yen: null, status: null };
    const actualNote = actual.yen === null ? null : actual.status === 'COMPLETE' ? null : '登録途中（参考値）';
    const row: ProjectPerformanceRow = {
      deptName: n.deptName,
      projectTitle: n.projectTitle,
      targetKind: target.kind,
      targetYen: target.yen,
      targetLabel: target.label,
      actualYen: actual.yen,
      actualLabel: actual.yen === null ? '未登録' : null,
      actualNote: args.metric === 'OPERATING_INCOME' && actual.yen !== null ? `${actualNote ?? '登録済み'}・費用削減分` : actualNote,
      achievement: rowAchievementOf({ targetYen: target.yen, targetLabel: target.label, actualYen: actual.yen, actualStatus: actual.status, periodLabel: period }),
    };
    const list = byDept.get(n.deptName) ?? [];
    list.push(row);
    byDept.set(n.deptName, list);
    all.push({ target: target.kind, targetYen: target.yen, actualYen: actual.yen, actualStatus: actual.status });
  }

  // 全社合計：未算定の施策があれば合計しない（0として足さない）。計画期間外・財務効果なしは合計に影響しない
  const unknownCount = all.filter((a) => a.target === 'UNKNOWN').length;
  const valueRows = all.filter((a) => a.target === 'VALUE');
  const targetYen = unknownCount > 0 ? null : valueRows.length > 0 ? valueRows.reduce((s, a) => s + (a.targetYen ?? 0), 0) : null;
  const targetLabel = unknownCount > 0 ? '一部未算定のため合計できません' : valueRows.length > 0 ? null : '計画期間内の施策なし';
  const actualRows = all.filter((a) => a.actualYen !== null);
  const actualYen = actualRows.length > 0 ? actualRows.reduce((s, a) => s + (a.actualYen ?? 0), 0) : null;
  const actualStatus: PlanActualYearStatus | null =
    actualRows.length === 0 ? null : actualRows.every((a) => a.actualStatus === 'COMPLETE') ? 'COMPLETE' : 'PARTIAL';
  const totalAchievement: Achievement =
    targetYen === null && unknownCount > 0
      ? { pct: null, text: '未算定の施策を含むため算出しません', caption: `${period}の目標に対する実績`, reference: false }
      : rowAchievementOf({ targetYen, targetLabel, actualYen, actualStatus, periodLabel: period });

  return {
    groups: [...byDept.entries()].map(([deptName, rows]) => ({ deptName, rows })),
    total: {
      targetYen,
      targetLabel,
      actualYen,
      actualLabel: actualYen === null ? '未登録' : null,
      actualNote: actualYen !== null && actualStatus !== 'COMPLETE' ? '登録途中（参考値）' : null,
      achievement: totalAchievement,
    },
  };
}
