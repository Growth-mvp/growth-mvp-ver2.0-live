import { departmentKeyOf } from '@/lib/cascade/stage3Adjustment';
import type { ProjectLifecycle, ProjectLifecycleStatus } from '@/types/strategy';

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

/* ===== STAGE6（将来の財務効果・投資予定）へ渡す形 ===== */

const ymOf = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})/.exec(value);
  return m ? `${m[1]}-${m[2]}` : null;
};

const prevYm = (ym: string): string => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/* 中止月より後の効果は外し、中止月にまたがる効果は中止の前月で終わらせる。中止前の分は残す。 */
function truncateEffect(effect: AnyRecord, stopYm: string): AnyRecord | null {
  const start = ymOf(effect.startYm);
  if (!start || start >= stopYm) return null;
  const end = ymOf(effect.endYm);
  if (!end || end >= stopYm) return { ...effect, endYm: prevYm(stopYm) };
  return effect;
}

function truncateInvestment(record: AnyRecord, stopYm: string): AnyRecord | null {
  const spend = record.spend as AnyRecord | undefined;
  if (!spend) return record;
  if (spend.recurrence === 'ONE_TIME') {
    const paid = ymOf(spend.paymentYm);
    if (paid && paid >= stopYm) return null;
    return record;
  }
  const start = ymOf(spend.startYm);
  if (start && start >= stopYm) return null;
  const end = ymOf(spend.endYm);
  if (end && end >= stopYm) return { ...record, spend: { ...spend, endYm: prevYm(stopYm) } };
  return record;
}

/* 経営計画書など、有効な施策だけを載せる場合。除外・中止の施策は外す（入力は変えない）。 */
export function activeProjectsOnly<T extends { departments?: unknown } | null>(state: T): T {
  if (!state || !Array.isArray(state.departments)) return state;
  const departments = (state.departments as AnyRecord[]).map((dept) =>
    dept && Array.isArray(dept.projects) ? { ...dept, projects: (dept.projects as AnyRecord[]).filter((p) => isProjectActive(p)) } : dept,
  );
  return { ...state, departments } as T;
}

/* STAGE6の計算に渡す施策の一覧。除外した施策は外し、中止した施策は中止月以降の予定だけを外す。
 * 中止前の予定・実績（STAGE5の財務実績を含む）は残す。入力の departments は変えない。 */
export function stage6PlanDepartments(departments: unknown): AnyRecord[] {
  if (!Array.isArray(departments)) return [];
  return (departments as AnyRecord[]).map((dept) => {
    if (!dept || !Array.isArray(dept.projects)) return dept;
    const projects = (dept.projects as AnyRecord[]).flatMap((project) => {
      const life = lifecycleOf(project);
      if (!life) return [project];
      if (life.status === 'EXCLUDED') return [];
      const stopYm = ymOf(life.stoppedAt ?? life.changedAt);
      if (!stopYm) return [project];
      const out: AnyRecord = { ...project };
      const primary = out.financeEffect as AnyRecord | undefined;
      if (primary) {
        const kept = truncateEffect(primary, stopYm);
        if (kept) out.financeEffect = kept;
        else delete out.financeEffect;
      }
      if (Array.isArray(out.financeEffects)) {
        out.financeEffects = (out.financeEffects as AnyRecord[]).flatMap((e) => {
          const kept = truncateEffect(e, stopYm);
          return kept ? [kept] : [];
        });
      }
      if (Array.isArray(out.executionHumanInvestments)) {
        out.executionHumanInvestments = (out.executionHumanInvestments as AnyRecord[]).flatMap((r) => {
          const kept = truncateInvestment(r, stopYm);
          return kept ? [kept] : [];
        });
      }
      return [out];
    });
    return { ...dept, projects };
  });
}
