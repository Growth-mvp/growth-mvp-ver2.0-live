/* STAGE6：プロジェクト別の財務効果の「計画（STAGE4）」と「登録済み実績（STAGE5）」を年度別に照らす（参照専用の純粋関数）。
 * 計画の金額は buildFinanceEffectTrial と opexDecisionsOf の結果をそのまま使う。実績は書き換えない。 */
import type { Department, FinanceActualEntry } from '@/types/strategy';
import { buildFinanceEffectTrial, effectFactsOf, opexDecisionsFor, type EffectFact } from './financeEffectPlan';
import { fiscalYearOf, parseFiscalYearEndMonth } from './investmentDemand';
import type { OpexDecision, OpexDecisionStatus } from './opexDeduction';

export type PlanActualKind = 'REVENUE_UP' | 'COST_REDUCTION' | 'COST_INCREASE' | 'OPEX';
export type PlanActualMode = 'REVENUE' | 'COST' | 'OPERATING';
export type PlanActualPlanState = 'PLANNED' | 'DRAFT' | 'NOT_CALCULATED' | 'NOT_READY' | 'NO_PLAN' | 'AMBIGUOUS';
export type PlanActualOperatingState = 'ADDS' | 'SUBTRACTS' | 'HELD' | 'NOT_DEDUCTED';
export type PlanActualYearStatus = 'COMPLETE' | 'PARTIAL' | 'NO_ACTUAL' | 'OUT_OF_PERIOD' | 'NOT_COMPARABLE';

export type PlanActualPlanYear = { fiscalYear: number; amountYen: number; months: string[] };

export type PlanActualItem = {
  deptIndex: number;
  projectIndex: number;
  deptName: string;
  projectTitle: string;
  itemKey: string;
  kind: PlanActualKind;
  label: string;
  planState: PlanActualPlanState;
  planStateText: string;
  /** 計画期間が確定し、期間内の登録月と照合できるか */
  comparable: boolean;
  periodText: string;
  /** 計画の金額（正の値・総額の年度配分）。計画がない年度は含めない */
  plan: PlanActualPlanYear[];
  operatingState: PlanActualOperatingState | null;
  operatingNote: string | null;
  /** 照合できた実績（同じ財務項目のみ。照合保留の項目には割り当てない） */
  actuals: FinanceActualEntry[];
};

export type PlanActualProject = {
  deptIndex: number;
  projectIndex: number;
  deptName: string;
  projectTitle: string;
  items: PlanActualItem[];
};

export type PlanActualYearRow = {
  fiscalYear: number;
  label: string;
  /** 計画額（表示対象の符号つき）。計画がない・未算定の年度は null（0円ではない） */
  planYen: number | null;
  /** 計画期間内に登録された実績の合計。未登録は null */
  actualYen: number | null;
  /** 計画期間外に登録された実績（会計年度に集計し、計画の達成状況には含めない） */
  outOfPeriodYen: number | null;
  /** 差額は、計画期間の全月が登録されている年度だけ計算する */
  differenceYen: number | null;
  status: PlanActualYearStatus;
};

const EFFECT_KINDS = ['REVENUE_UP', 'COST_REDUCTION', 'COST_INCREASE'] as const;
const KIND_LABEL: Record<PlanActualKind, string> = {
  REVENUE_UP: '売上増加',
  COST_REDUCTION: '費用削減',
  COST_INCREASE: '追加費用',
  OPEX: '営業費用（OPEX）',
};
const MAX_YEARS = 30;

const monthsBetween = (startYm: string, endYm: string): string[] => {
  const out: string[] = [];
  let y = Number(startYm.slice(0, 4));
  let m = Number(startYm.slice(5, 7));
  const endIdx = Number(endYm.slice(0, 4)) * 12 + Number(endYm.slice(5, 7));
  while (y * 12 + m <= endIdx && out.length < 600) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
};

const isYmText = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v);

/** 計画と実績の両方を含む会計年度の範囲（最大 MAX_YEARS 年）。範囲の外は計画・実績とも扱わない */
function fiscalYearRangeOf(departments: Department[] | null | undefined, endMonth: number): number[] {
  const found: number[] = [];
  const add = (ym: unknown) => {
    if (isYmText(ym)) found.push(fiscalYearOf(ym, endMonth));
  };
  for (const dept of departments ?? []) {
    for (const project of dept?.projects ?? []) {
      if (!project) continue;
      for (const fact of effectFactsOf(project)) {
        add(fact.startYm);
        add(fact.endYm);
      }
      for (const r of project.executionHumanInvestments ?? []) {
        if (r?.spend?.category !== 'OPEX') continue;
        add(r.spend.paymentYm);
        add(r.spend.startYm);
        add(r.spend.endYm);
      }
      for (const a of project.financeActuals ?? []) add(a.ym);
    }
  }
  if (found.length === 0) return [];
  const min = Math.min(...found);
  const max = Math.min(Math.max(...found), min + MAX_YEARS - 1);
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

const PLAN_STATE_TEXT: Record<PlanActualPlanState, string> = {
  PLANNED: '計画あり（STAGE4で確認済み）',
  DRAFT: '未確認のため計画に含めていません（STAGE4で確認すると反映されます）',
  NOT_CALCULATED: '未算定（STAGE4の入力が不足しているため、計画額はありません）',
  NOT_READY: '計画未確定（金額・支出時期がそろっていません）',
  NO_PLAN: '計画が見つかりません（実績だけが登録されています）',
  AMBIGUOUS: '照合保留（同じ種類の財務効果が複数あるため、実績を割り当てていません）',
};

const ambiguousItem = (base: Omit<PlanActualItem, 'planState' | 'planStateText' | 'comparable' | 'periodText' | 'plan' | 'operatingState' | 'operatingNote' | 'actuals'>): PlanActualItem => ({
  ...base,
  planState: 'AMBIGUOUS',
  planStateText: PLAN_STATE_TEXT.AMBIGUOUS,
  comparable: false,
  periodText: '—',
  plan: [],
  operatingState: null,
  operatingNote: PLAN_STATE_TEXT.AMBIGUOUS,
  actuals: [],
});

const noPlanItem = (
  base: Omit<PlanActualItem, 'planState' | 'planStateText' | 'comparable' | 'periodText' | 'plan' | 'operatingState' | 'operatingNote' | 'actuals'>,
  actuals: FinanceActualEntry[],
): PlanActualItem => ({
  ...base,
  planState: 'NO_PLAN',
  planStateText: PLAN_STATE_TEXT.NO_PLAN,
  comparable: false,
  periodText: '—',
  plan: [],
  operatingState: null,
  operatingNote: PLAN_STATE_TEXT.NO_PLAN,
  actuals,
});

/** STAGE6の参照表示用：プロジェクトごとの財務項目（計画と照合済みの実績）。実績が無く計画も無い項目は含めない */
export function planActualProjectsOf(departments: Department[] | null | undefined, fiscalYearEnd: string | undefined): PlanActualProject[] {
  const endMonth = parseFiscalYearEndMonth(fiscalYearEnd);
  if (endMonth === null) return [];
  const fiscalYears = fiscalYearRangeOf(departments, endMonth);
  if (fiscalYears.length === 0) return [];
  const trial = buildFinanceEffectTrial({ departments, fiscalYearEnd, fiscalYears });
  const decisions = opexDecisionsFor(departments, fiscalYearEnd);

  const out: PlanActualProject[] = [];
  (departments ?? []).forEach((dept, deptIndex) => {
    (dept?.projects ?? []).forEach((project, projectIndex) => {
      if (!project) return;
      const deptName = dept.name || '（部署名なし）';
      const projectTitle = project.title || '（施策名なし）';
      const base = { deptIndex, projectIndex, deptName, projectTitle };
      const actuals = Array.isArray(project.financeActuals) ? project.financeActuals : [];
      const items: PlanActualItem[] = [];
      const effects: EffectFact[] = effectFactsOf(project);

      for (const kind of EFFECT_KINDS) {
        const itemKey = `EFFECT:${kind}`;
        const label = KIND_LABEL[kind];
        const matches = effects.filter((x) => x.kind === kind);
        const own = actuals.filter((a) => a.itemKey === itemKey);
        if (matches.length === 0) {
          if (own.length > 0) items.push(noPlanItem({ ...base, itemKey, kind, label }, own));
          continue;
        }
        if (matches.length > 1) {
          items.push(ambiguousItem({ ...base, itemKey, kind, label }));
          continue;
        }
        const fact = matches[0];
        const row = trial.projects.find(
          (r) => r.deptIndex === deptIndex && r.projectIndex === projectIndex && r.kind === kind && r.source === undefined,
        );
        const planState: PlanActualPlanState = row?.status === 'REFLECTED' ? 'PLANNED' : row?.status === 'DRAFT' ? 'DRAFT' : 'NOT_CALCULATED';
        const startYm = fact.startYm;
        const endYm = fact.endYm;
        const oneTime = fact.totalAmount && !endYm;
        const comparable = planState === 'PLANNED' && startYm !== null && (endYm !== null ? endYm >= startYm : oneTime);
        const months = startYm === null ? [] : oneTime ? [startYm] : endYm !== null && endYm >= startYm ? monthsBetween(startYm, endYm) : [];
        const amountOf = (y: { revenueYen: number | null; costReductionYen: number | null; costIncreaseYen: number | null }) =>
          (kind === 'REVENUE_UP' ? y.revenueYen : kind === 'COST_REDUCTION' ? y.costReductionYen : y.costIncreaseYen) ?? 0;
        const plan: PlanActualPlanYear[] =
          planState === 'PLANNED' && row
            ? row.years
                .map((y) => ({ fiscalYear: y.fiscalYear, amountYen: amountOf(y), months: months.filter((ym) => fiscalYearOf(ym, endMonth) === y.fiscalYear) }))
                .filter((p) => p.amountYen !== 0 || p.months.length > 0)
            : [];
        const operatingState: PlanActualOperatingState | null =
          planState !== 'PLANNED' ? null : kind === 'COST_REDUCTION' ? 'ADDS' : kind === 'COST_INCREASE' ? 'SUBTRACTS' : null;
        items.push({
          ...base,
          itemKey,
          kind,
          label,
          planState,
          planStateText: planState === 'PLANNED' && !comparable ? '計画あり（期間の終了が未設定のため、差額は算出しません）' : PLAN_STATE_TEXT[planState],
          comparable,
          periodText: startYm === null ? '開始時期 未設定' : `${startYm} 〜 ${endYm ?? (oneTime ? startYm : '終了未設定')}`,
          plan,
          operatingState,
          operatingNote: operatingState === null && kind !== 'REVENUE_UP' ? PLAN_STATE_TEXT[planState] : null,
          actuals: own,
        });
      }

      const opexOf = (d: OpexDecision): boolean => d.deptIndex === deptIndex && d.projectIndex === projectIndex && d.source === 'HUMAN_INVESTMENT' && !!d.recordId;
      const decided = decisions.filter(opexOf);
      const decidedKeys = new Set(decided.map((d) => `OPEX:${d.recordId}`));
      for (const d of decided) {
        const itemKey = `OPEX:${d.recordId}`;
        const own = actuals.filter((a) => a.itemKey === itemKey);
        const ready = d.status !== 'NOT_READY';
        const plan: PlanActualPlanYear[] = ready
          ? d.byFiscalYear.map((y) => ({
              fiscalYear: y.fiscalYear,
              amountYen: y.amountYen,
              months: d.allocation.filter((a) => fiscalYearOf(a.ym, endMonth) === y.fiscalYear).map((a) => a.ym),
            }))
          : [];
        const periodYms = d.allocation.map((a) => a.ym).sort();
        items.push({
          ...base,
          itemKey,
          kind: 'OPEX',
          label: d.label,
          planState: ready ? 'PLANNED' : 'NOT_READY',
          planStateText: ready ? PLAN_STATE_TEXT.PLANNED : PLAN_STATE_TEXT.NOT_READY,
          comparable: ready,
          periodText: periodYms.length === 0 ? '支出時期 未設定' : periodYms.length === 1 ? `支出年月 ${periodYms[0]}` : `${periodYms[0]} 〜 ${periodYms[periodYms.length - 1]}`,
          plan,
          operatingState: opexState(d.status),
          operatingNote: d.status === 'DEDUCTED' || !ready ? null : d.reason,
          actuals: own,
        });
      }
      for (const key of new Set(actuals.filter((a) => a.itemKey.startsWith('OPEX:')).map((a) => a.itemKey))) {
        if (decidedKeys.has(key)) continue;
        items.push(noPlanItem({ ...base, itemKey: key, kind: 'OPEX', label: 'OPEX（対応する明細が見つかりません）' }, actuals.filter((a) => a.itemKey === key)));
      }

      if (items.length > 0) out.push({ deptIndex, projectIndex, deptName, projectTitle, items });
    });
  });
  return out;
}

function opexState(status: OpexDecisionStatus): PlanActualOperatingState | null {
  if (status === 'DEDUCTED') return 'SUBTRACTS';
  if (status === 'HELD') return 'HELD';
  if (status === 'NOT_DEDUCTED') return 'NOT_DEDUCTED';
  return null;
}

/** 表示対象ごとの財務項目。売上効果は売上増加だけ、費用・営業利益は費用系の項目だけを並べる */
export function planActualItemsForMode(items: readonly PlanActualItem[], mode: PlanActualMode): PlanActualItem[] {
  return items.filter((i) => (mode === 'REVENUE' ? i.kind === 'REVENUE_UP' : i.kind !== 'REVENUE_UP'));
}

/** 表示対象の符号。営業利益は、費用削減をプラス、追加費用と差し引かれるOPEXをマイナスにする */
function signOf(item: PlanActualItem, mode: PlanActualMode): 1 | -1 | null {
  if (mode === 'REVENUE') return item.kind === 'REVENUE_UP' ? 1 : null;
  if (mode === 'COST') return item.kind === 'REVENUE_UP' ? null : 1;
  if (item.kind === 'COST_REDUCTION') return 1;
  if (item.kind === 'COST_INCREASE') return -1;
  if (item.kind === 'OPEX') return item.operatingState === 'SUBTRACTS' ? -1 : null;
  return null;
}

const sumOf = (list: readonly FinanceActualEntry[]) => list.reduce((s, a) => s + a.amountYen, 0);

/**
 * 年度別の比較行。
 * - 計画期間内に登録された月だけを実績として数える。期間外の登録は別の欄に分ける（会計年度には集計する）
 * - 計画期間の全月が登録済みの年度だけ差額を出す。途中の年度・未算定・期間未確定は差額を出さない
 */
export function planActualYearRowsOf(item: PlanActualItem, mode: PlanActualMode, endMonth: number): PlanActualYearRow[] {
  const sign = signOf(item, mode);
  if (sign === null) return [];
  const planMonths = new Set(item.plan.flatMap((p) => p.months));
  const years = new Set<number>();
  item.plan.forEach((p) => years.add(p.fiscalYear));
  item.actuals.forEach((a) => years.add(fiscalYearOf(a.ym, endMonth)));

  const rows: PlanActualYearRow[] = [];
  for (const fiscalYear of [...years].sort((a, b) => a - b)) {
    const inYear = item.actuals.filter((a) => fiscalYearOf(a.ym, endMonth) === fiscalYear);
    const inPeriod = inYear.filter((a) => planMonths.has(a.ym));
    const outOfPeriod = inYear.filter((a) => !planMonths.has(a.ym));
    const plan = item.plan.find((p) => p.fiscalYear === fiscalYear) ?? null;
    const outOfPeriodYen = outOfPeriod.length > 0 ? sign * sumOf(outOfPeriod) : null;
    const planYen = item.planState === 'PLANNED' && plan ? sign * plan.amountYen : null;

    if (item.planState !== 'PLANNED' || !item.comparable) {
      if (inYear.length === 0 && planYen === null) continue;
      rows.push({
        fiscalYear,
        label: `${fiscalYear}年${endMonth}月期`,
        planYen,
        actualYen: inYear.length > 0 ? sign * sumOf(inYear) : null,
        outOfPeriodYen: null,
        differenceYen: null,
        status: 'NOT_COMPARABLE',
      });
      continue;
    }

    if (!plan) {
      if (outOfPeriod.length === 0) continue;
      rows.push({ fiscalYear, label: `${fiscalYear}年${endMonth}月期`, planYen: null, actualYen: null, outOfPeriodYen, differenceYen: null, status: 'OUT_OF_PERIOD' });
      continue;
    }

    const registered = new Set(inPeriod.map((a) => a.ym)).size;
    const actualYen = inPeriod.length > 0 ? sign * sumOf(inPeriod) : null;
    const base = { fiscalYear, label: `${fiscalYear}年${endMonth}月期`, planYen, outOfPeriodYen };
    if (registered === 0) {
      rows.push({ ...base, actualYen: null, differenceYen: null, status: outOfPeriod.length > 0 ? 'OUT_OF_PERIOD' : 'NO_ACTUAL' });
    } else if (registered < plan.months.length) {
      rows.push({ ...base, actualYen, differenceYen: null, status: 'PARTIAL' });
    } else {
      rows.push({ ...base, actualYen, differenceYen: actualYen! - planYen!, status: 'COMPLETE' });
    }
  }
  return rows;
}
