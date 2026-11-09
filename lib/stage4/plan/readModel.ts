/* 段階A：保存済みのSTAGE3のプロジェクト情報を、文書型の計画書が読める形に変換する（読み取りのみ・DBに書かない）。
 * 確定KPI・確定の印が無いKPI・AI仮提案KPIを分けて返す。プロジェクトごとに別の計画を返し、混在させない。 */
import { kpiBasisOf, type KpiBasis } from './kpiBasis';
import { resolveProjectScope, type MembershipRow, type ResolveFailure, type StrategyRow } from './projectResolver';

export type ReadKpi = {
  label: string;
  target: number | null;
  unit: string;
  due: string | null;
  owner: string | null;
  basis: KpiBasis;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const finiteOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ymOf = (v: unknown): string | null => {
  const t = str(v);
  return t && /^\d{4}-\d{2}/.test(t) ? t.slice(0, 7) : null;
};

/** プロジェクトに入っているKPIを、根拠の印（targetBasis）つきで読む。目標値0は0のまま残す */
export function readKpisOf(project: Record<string, unknown>): ReadKpi[] {
  const list = Array.isArray(project.okrsV2) ? (project.okrsV2 as Array<Record<string, unknown>>) : [];
  return list
    .filter((k) => k && str(k.label))
    .map((k) => ({
      label: str(k.label) ?? '',
      target: finiteOrNull(k.target),
      unit: str(k.unit) ?? '',
      due: ymOf(k.due),
      owner: str(k.owner),
      basis: kpiBasisOf(k),
    }));
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
      department: { name: string; strategicRole: string | null; keyIssues: string[] };
      project: { title: string; hypothesis: string | null; rationale: string | null; role: string | null };
      kpis: { confirmed: ReadKpi[]; unconfirmed: ReadKpi[]; aiProvisional: ReadKpi[] };
      savedPlan: ReadPlanState;
    };

const sameKpis = (a: Array<{ label: string; target: number | null }>, b: Array<{ label: string; target: number | null }>) => {
  const key = (xs: Array<{ label: string; target: number | null }>) =>
    xs.map((x) => `${x.label}|${x.target ?? 'null'}`).sort().join('\n');
  return key(a) === key(b);
};

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
  const { project, companyId, strategyId, projectKey, departmentName, department: dept } = resolved.project;

  const kpis = readKpisOf(project);
  const locked = kpis.filter((k) => k.basis !== 'AI_PROVISIONAL');
  const saved = args.savedPlans.find(
    (r) => r.companyId === companyId && r.strategyId === strategyId && r.projectKey === projectKey
  );
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
      strategicRole: str(dept?.strategicRole),
      keyIssues: Array.isArray(dept?.keyIssues) ? (dept.keyIssues as unknown[]).map(str).filter((x): x is string => x !== null) : [],
    },
    project: {
      title: str(project.title) ?? '',
      hypothesis: str(project.hypothesis),
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
