import { departmentKeyOf } from '@/lib/cascade/stage3Adjustment';
import { computeFinanceEffect } from '@/lib/financeEffect';
import type { FinanceEffect, ProjectLifecycle, ProjectLifecycleStatus } from '@/types/strategy';

/* 施策の有効・無効（計画から外す／中止）の判定と、その状態変更の共通処理。
 * STAGE3の確定と、STAGE4の「…」メニューの両方がここを使う。物理削除はしない（参照と実績を残す）。 */

type AnyRecord = Record<string, unknown>;

export type LifecycleError = 'department_missing' | 'project_missing' | 'project_ambiguous' | 'exclusion_refused';

export type ExclusionFacts = {
  /** 採用済み、または実行開始済み（実行計画書・OKRがある）の施策か */
  executing: boolean;
};

export function lifecycleOf(project: unknown): ProjectLifecycle | null {
  const l = (project as AnyRecord | null | undefined)?.lifecycle;
  if (!l || typeof l !== 'object') return null;
  const status = (l as AnyRecord).status;
  return status === 'EXCLUDED' || status === 'STOPPED' ? (l as ProjectLifecycle) : null;
}

/** 状態が未設定の既存の施策は有効として扱う（後方互換） */
export const isProjectActive = (project: unknown): boolean => lifecycleOf(project) === null;

export const isProjectStopped = (project: unknown): boolean => lifecycleOf(project)?.status === 'STOPPED';

/** 計画から外せない理由。承認済みと、採用済み・実行開始済みは外さず、先に取り消すか中止する */
export function exclusionRefusal(project: unknown, facts: ExclusionFacts): 'APPROVED' | 'EXECUTING' | null {
  if ((project as AnyRecord | null)?.planStatus === 'approved') return 'APPROVED';
  if (facts.executing) return 'EXECUTING';
  return null;
}

const idOf = (project: unknown): string => String((project as AnyRecord | null)?.id ?? '');

/* 同じIDの施策を1件に特定してから、状態を変える。部門を指定したときは、その部門の施策だけを対象にする。 */
export function setProjectLifecycle(
  departments: unknown[],
  args: {
    projectId: string;
    departmentKey?: string;
    status: ProjectLifecycleStatus | null;
    changedAt: string;
    changedBy: string | null;
    stoppedAt?: string | null;
  },
): { ok: true; departments: AnyRecord[] } | { ok: false; error: LifecycleError } {
  const next = JSON.parse(JSON.stringify(departments)) as AnyRecord[];
  const hits: Array<{ d: number; p: number }> = [];
  next.forEach((dept, d) => {
    const list = Array.isArray(dept?.projects) ? (dept.projects as unknown[]) : [];
    list.forEach((project, p) => {
      if (idOf(project) === args.projectId && args.projectId !== '') hits.push({ d, p });
    });
  });
  if (hits.length === 0) return { ok: false, error: 'project_missing' };
  if (hits.length > 1) return { ok: false, error: 'project_ambiguous' };
  const { d, p } = hits[0];
  if (args.departmentKey !== undefined && departmentKeyOf(next[d]) !== args.departmentKey) {
    return { ok: false, error: 'department_missing' };
  }
  const project = (next[d].projects as AnyRecord[])[p];
  if (args.status === null) {
    delete project.lifecycle;
  } else {
    project.lifecycle = {
      status: args.status,
      changedAt: args.changedAt,
      changedBy: args.changedBy,
      ...(args.status === 'STOPPED' ? { stoppedAt: args.stoppedAt ?? args.changedAt } : {}),
    };
  }
  return { ok: true, departments: next };
}

export type LifecycleAction = 'EXCLUDE' | 'STOP';

/* 操作ごとの拒否理由。計画から外すは実行中・承認済みを止め、中止は実行を開始した計画だけに使う */
export function lifecycleActionRefusal(
  project: unknown,
  action: LifecycleAction,
  facts: { executing: boolean; started: boolean },
): 'ALREADY_OUT' | 'APPROVED' | 'EXECUTING' | 'NOT_STARTED' | null {
  if (!isProjectActive(project)) return 'ALREADY_OUT';
  if (action === 'EXCLUDE') return exclusionRefusal(project, { executing: facts.executing });
  return facts.started ? null : 'NOT_STARTED';
}

/* 経営計画書など、有効な施策だけを載せる場合。除外・中止の施策は外す（入力は変えない）。 */
export function activeProjectsOnly<T extends { departments?: unknown } | null>(state: T): T {
  if (!state || !Array.isArray(state.departments)) return state;
  const departments = (state.departments as AnyRecord[]).map((dept) =>
    dept && Array.isArray(dept.projects) ? { ...dept, projects: (dept.projects as AnyRecord[]).filter((p) => isProjectActive(p)) } : dept,
  );
  return { ...state, departments } as T;
}

/* ===== STAGE6（将来の財務効果・投資予定）へ渡す形 =====
 * 施策の並び（位置）は変えない。STAGE6の表示用に配列を絞ると、保存データの位置とずれて別の施策を更新するおそれがあるため。
 * 除外：財務効果・投資・旧投資データを空にする（施策そのものは残す）。
 * 中止：中止月以降の予定を外す。中止月にまたがる予定は中止前の分に縮める。総額は残る月数の割合だけ減らし、月あたりの配分額は変えない。
 * 元の保存データは変えない（計算のための写しを作る）。 */

const ymOf = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})/.exec(value);
  return m ? `${m[1]}-${m[2]}` : null;
};

const monthIdx = (ym: string): number => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const idxYm = (i: number): string => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
const monthsBetween = (startYm: string, endYm: string): number => monthIdx(endYm) - monthIdx(startYm) + 1;

type SpendCut = { drop: true } | { drop: false; scale: number; spend: AnyRecord | undefined };

/* 支出条件を中止月で切る。scale は金額に掛ける割合（総額の場合だけ1未満）。
 * forceTotal は、金額が期間全体の総額だと決まっている項目（期待成果の前提）に使う。 */
function cutSpend(spend: AnyRecord | undefined, stopYm: string, forceTotal = false): SpendCut {
  const keep: SpendCut = { drop: false, scale: 1, spend };
  if (!spend) return keep;
  const stopI = monthIdx(stopYm);
  if (spend.recurrence === 'ONE_TIME') {
    const paid = ymOf(spend.paymentYm);
    return paid && monthIdx(paid) >= stopI ? { drop: true } : keep;
  }
  const start = ymOf(spend.startYm);
  if (!start) return keep;
  if (monthIdx(start) >= stopI) return { drop: true };
  const end = ymOf(spend.endYm);
  const isTotal = forceTotal || spend.amountBasis === 'TOTAL';
  if (!end) {
    if (isTotal) return keep;
    return { drop: false, scale: 1, spend: { ...spend, endYm: idxYm(stopI - 1) } };
  }
  if (monthIdx(end) < stopI) return keep;
  const scale = isTotal ? (stopI - monthIdx(start)) / monthsBetween(start, end) : 1;
  return { drop: false, scale, spend: { ...spend, endYm: idxYm(stopI - 1) } };
}

/* 財務効果。総額の効果は、残る月数の割合の総額にする（方法は直接金額に置き換え、月あたりの金額は変えない） */
function cutEffect(effect: AnyRecord, stopYm: string): AnyRecord | null {
  const start = ymOf(effect.startYm);
  if (!start) return effect;
  const stopI = monthIdx(stopYm);
  if (monthIdx(start) >= stopI) return null;
  const end = ymOf(effect.endYm);
  if (end && monthIdx(end) < stopI) return effect;
  if (!end && effect.amountBasis === 'TOTAL') return effect;
  const endYm = idxYm(stopI - 1);
  if (effect.amountBasis !== 'TOTAL' || !end) return { ...effect, endYm };
  const total = computeFinanceEffect(effect as unknown as FinanceEffect).totalYen;
  if (total === undefined) return { ...effect, endYm };
  const r = (stopI - monthIdx(start)) / monthsBetween(start, end);
  const out: AnyRecord = { ...effect, method: 'DIRECT_AMOUNT', directAmountYen: total * r, endYm };
  for (const key of ['quantity', 'unitPriceYen', 'meetingsPerPeriod', 'winRatePct', 'averageDealYen']) delete out[key];
  for (const key of ['operatingIncomeEffectYen', 'sgaCostYen']) {
    if (typeof effect[key] === 'number') out[key] = (effect[key] as number) * r;
  }
  return out;
}

/* 支出条件を持つ投資・費用（人的投資・スキル・INVEST KR など）。時期が無いものは、基準の年月があればそれで判断する */
function cutRecord(record: AnyRecord, amountKey: string, stopYm: string, refKeys: string[]): AnyRecord[] {
  const spend = record.spend as AnyRecord | undefined;
  if (!spend) {
    const ref = refKeys.map((k) => ymOf(record[k])).find((v): v is string => v !== null);
    return ref && monthIdx(ref) >= monthIdx(stopYm) ? [] : [record];
  }
  const cut = cutSpend(spend, stopYm);
  if (cut.drop) return [];
  const out: AnyRecord = { ...record, spend: cut.spend };
  if (typeof record[amountKey] === 'number') out[amountKey] = (record[amountKey] as number) * cut.scale;
  return [out];
}

/* 旧データの期待成果の前提。金額は期間全体の合計なので、残る期間の割合で縮める */
function cutAssumptions(a: AnyRecord, stopYm: string): AnyRecord | null {
  const cut = cutSpend(a.spend as AnyRecord | undefined, stopYm, true);
  if (cut.drop) return null;
  const out: AnyRecord = { ...a };
  if (cut.spend) out.spend = cut.spend;
  else delete out.spend;
  if (cut.scale !== 1) {
    if (typeof a.durationMonths === 'number') out.durationMonths = a.durationMonths * cut.scale;
    if (typeof a.externalCostMJPY === 'number') out.externalCostMJPY = a.externalCostMJPY * cut.scale;
  }
  return out;
}

/* 時期を持たない将来の計画値（必要投資額の寄与）。除外・中止のどちらでも残さない */
const UNDATED_PLAN_KEYS = ['impactRevenueMJPY', 'impactOpIncomeMJPY'];

const PLAN_KEYS = [
  'financeEffect',
  'financeEffects',
  'executionHumanInvestments',
  'skillPlans',
  'impactInvestmentMJPY',
  'impactInvestmentSpend',
  'impactAssumptions',
  ...UNDATED_PLAN_KEYS,
];

function clearPlan(project: AnyRecord): AnyRecord {
  const out: AnyRecord = { ...project };
  for (const key of PLAN_KEYS) delete out[key];
  if (Array.isArray(out.okrsV2)) out.okrsV2 = (out.okrsV2 as AnyRecord[]).filter((kr) => kr?.kind !== 'INVEST');
  return out;
}

function cutPlan(project: AnyRecord, stopYm: string): AnyRecord {
  const out: AnyRecord = { ...project };
  for (const key of UNDATED_PLAN_KEYS) delete out[key];

  const primary = out.financeEffect as AnyRecord | undefined;
  if (primary) {
    const kept = cutEffect(primary, stopYm);
    if (kept) out.financeEffect = kept;
    else delete out.financeEffect;
  }
  if (Array.isArray(out.financeEffects)) {
    out.financeEffects = (out.financeEffects as AnyRecord[]).flatMap((e) => {
      const kept = cutEffect(e, stopYm);
      return kept ? [kept] : [];
    });
  }
  if (Array.isArray(out.executionHumanInvestments)) {
    out.executionHumanInvestments = (out.executionHumanInvestments as AnyRecord[]).flatMap((r) =>
      cutRecord(r, 'amount', stopYm, ['timingYm']),
    );
  }
  if (Array.isArray(out.skillPlans)) {
    out.skillPlans = (out.skillPlans as AnyRecord[]).flatMap((s) => cutRecord(s, 'cost', stopYm, ['dueYm']));
  }
  if (out.impactInvestmentMJPY !== undefined || out.impactInvestmentSpend !== undefined) {
    const cut = cutSpend(out.impactInvestmentSpend as AnyRecord | undefined, stopYm);
    if (cut.drop) {
      delete out.impactInvestmentMJPY;
      delete out.impactInvestmentSpend;
    } else {
      if (typeof out.impactInvestmentMJPY === 'number') out.impactInvestmentMJPY = out.impactInvestmentMJPY * cut.scale;
      if (cut.spend) out.impactInvestmentSpend = cut.spend;
      else delete out.impactInvestmentSpend;
    }
  }
  if (out.impactAssumptions && typeof out.impactAssumptions === 'object') {
    const kept = cutAssumptions(out.impactAssumptions as AnyRecord, stopYm);
    if (kept) out.impactAssumptions = kept;
    else delete out.impactAssumptions;
  }
  if (Array.isArray(out.okrsV2)) {
    out.okrsV2 = (out.okrsV2 as AnyRecord[]).flatMap((kr) =>
      kr?.kind === 'INVEST' ? cutRecord(kr, 'target', stopYm, ['due', 'startYm']) : [kr],
    );
  }
  return out;
}

function plannedProject(project: unknown): unknown {
  const life = lifecycleOf(project);
  if (!life) return project;
  if (life.status === 'EXCLUDED') return clearPlan(project as AnyRecord);
  const stopYm = ymOf(life.stoppedAt ?? life.changedAt);
  return stopYm ? cutPlan(project as AnyRecord, stopYm) : clearPlan(project as AnyRecord);
}

/* STAGE6の計算に渡す施策の一覧。施策の並びは変えず、除外した施策の予定を空にし、中止した施策は中止月以降の予定を外す。
 * 中止前の予定・実績（STAGE5の財務実績を含む）は残す。入力の departments は変えない。 */
export function stage6PlanDepartments(departments: unknown): AnyRecord[] {
  if (!Array.isArray(departments)) return [];
  return (departments as AnyRecord[]).map((dept) =>
    dept && Array.isArray(dept.projects) ? { ...dept, projects: (dept.projects as unknown[]).map(plannedProject) } : dept,
  );
}
