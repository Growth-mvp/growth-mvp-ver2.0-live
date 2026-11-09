/* 段階A：保存済みのSTAGE3のプロジェクト情報を、文書型の計画書が読める形に変換する（読み取りのみ・DBに書かない）。
 * 確定KPI・確定の印が無いKPI・AI仮提案KPIを分けて返す。プロジェクトごとに別の計画を返し、混在させない。 */
import { kpiBasisOf, type KpiBasis } from './kpiBasis';
import { resolveProjectScope, type MembershipRow, type ResolveFailure, type ResolvedProject, type StrategyRow } from './projectResolver';

export type ReadKpi = {
  label: string;
  target: number | null;
  unit: string;
  due: string | null;
  owner: string | null;
  basis: KpiBasis;
  /** 目標値の置き場。旧形式（キーワードの文字列）は目標を持たない */
  origin: 'OKRS_V2' | 'LEGACY_LABEL';
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const finiteOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ymOf = (v: unknown): string | null => {
  const t = str(v);
  return t && /^\d{4}-\d{2}/.test(t) ? t.slice(0, 7) : null;
};

/** 仮説は文字列と、statement を持つオブジェクトのどちらの形もある（types/strategy.ts の Hypothesis） */
export function hypothesisText(h: unknown): string | null {
  if (typeof h === 'string') return str(h);
  if (h && typeof h === 'object') return str((h as { statement?: unknown }).statement);
  return null;
}

/** プロジェクトに入っているKPIを読む。新しい置き場（okrsV2）は根拠の印つき、旧形式の文字列は未確認として読む。目標値0は0のまま残す */
export function readKpisOf(project: Record<string, unknown>): ReadKpi[] {
  const list = Array.isArray(project.okrsV2) ? (project.okrsV2 as Array<Record<string, unknown>>) : [];
  const v2: ReadKpi[] = list
    .filter((k) => k && str(k.label))
    .map((k) => ({
      label: str(k.label) ?? '',
      target: finiteOrNull(k.target),
      unit: str(k.unit) ?? '',
      due: ymOf(k.due),
      owner: str(k.owner),
      basis: kpiBasisOf(k),
      origin: 'OKRS_V2' as const,
    }));
  const seen = new Set(v2.map((k) => k.label));
  const okr0 = (Array.isArray(project.okrs) ? project.okrs[0] : undefined) as Record<string, unknown> | undefined;
  const legacyLabels = [
    ...(Array.isArray(okr0?.keyResults) ? (okr0.keyResults as unknown[]) : []),
    ...(Array.isArray(project.kpis) ? (project.kpis as unknown[]) : []),
  ]
    .map(str)
    .filter((x): x is string => x !== null);
  const legacy: ReadKpi[] = [];
  for (const label of legacyLabels) {
    if (seen.has(label)) continue;
    seen.add(label);
    legacy.push({ label, target: null, unit: '', due: null, owner: null, basis: 'UNKNOWN', origin: 'LEGACY_LABEL' });
  }
  return [...v2, ...legacy];
}

/** 目的（なぜ取り組むか・何を実現するか）。OKR の目的は okrs[] の最初の値を読む */
export function objectiveOf(project: Record<string, unknown>): string | null {
  const okrs = Array.isArray(project.okrs) ? (project.okrs as Array<Record<string, unknown>>) : [];
  for (const o of okrs) {
    const t = str(o?.objective);
    if (t) return t;
  }
  return null;
}

export type SavedPlanRecord = {
  companyId: string;
  strategyId: string;
  projectKey: string;
  savedAt: string;
  kpiSnapshot: Array<{ label: string; target: number | null }>;
  plan: unknown;
};

export type ReadPlanState = { state: 'NONE' } | { state: 'SAVED'; savedAt: string; plan: unknown; kpiChanged: boolean };

export type Stage4ReadModel =
  | { status: 'NO_DATA'; reason: ResolveFailure }
  | {
      status: 'READY';
      scope: { companyId: string; strategyId: string; projectKey: string };
      department: { name: string; mission: string | null; missionDescription: string | null; strategy: string | null };
      project: {
        title: string;
        objective: string | null;
        hypothesis: string | null;
        rationale: string | null;
        role: string | null;
      };
      kpis: { confirmed: ReadKpi[]; unconfirmed: ReadKpi[]; aiProvisional: ReadKpi[] };
      savedPlan: ReadPlanState;
    };

const sameKpis = (a: Array<{ label: string; target: number | null }>, b: Array<{ label: string; target: number | null }>) => {
  const key = (xs: Array<{ label: string; target: number | null }>) =>
    xs.map((x) => `${x.label}|${x.target ?? 'null'}`).sort().join('\n');
  return key(a) === key(b);
};

/** 照合済みのプロジェクトを、文書型の読み取りモデルにする（DBには触れない） */
export function readModelFromResolved(resolved: ResolvedProject, savedPlans: SavedPlanRecord[]): Stage4ReadModel {
  const { project, companyId, strategyId, projectKey, departmentName, department: dept } = resolved;
  const kpis = readKpisOf(project);
  const locked = kpis.filter((k) => k.basis !== 'AI_PROVISIONAL');
  const saved = projectKey.startsWith('id:')
    ? savedPlans.find((r) => r.companyId === companyId && r.strategyId === strategyId && r.projectKey === projectKey)
    : undefined;
  const savedPlan: ReadPlanState = saved
    ? {
        state: 'SAVED',
        savedAt: saved.savedAt,
        plan: saved.plan,
        kpiChanged: !sameKpis(saved.kpiSnapshot, locked.map((k) => ({ label: k.label, target: k.target }))),
      }
    : { state: 'NONE' };

  return {
    status: 'READY',
    scope: { companyId, strategyId, projectKey },
    department: {
      name: departmentName,
      mission: str(dept.mission),
      missionDescription: str(dept.missionDescription),
      strategy: str(dept.strategy),
    },
    project: {
      title: str(project.title) ?? '',
      objective: objectiveOf(project),
      hypothesis: hypothesisText(project.hypothesis),
      rationale: str(project.rationale) ?? str(project.reason),
      role: str(project.role),
    },
    kpis: {
      confirmed: kpis.filter((k) => k.basis === 'USER_CONFIRMED'),
      unconfirmed: kpis.filter((k) => k.basis === 'UNKNOWN'),
      aiProvisional: kpis.filter((k) => k.basis === 'AI_PROVISIONAL'),
    },
    savedPlan,
  };
}

export function buildStage4ReadModel(args: {
  memberships: MembershipRow[];
  strategies: StrategyRow[];
  projectTitle: string;
  departmentName?: string;
  projectId?: string;
  requestedCompanyId?: string;
  requestedStrategyId?: string;
  savedPlans: SavedPlanRecord[];
}): Stage4ReadModel {
  const resolved = resolveProjectScope(args);
  if (!resolved.ok) return { status: 'NO_DATA', reason: resolved.reason };
  return readModelFromResolved(resolved.project, args.savedPlans);
}
