/* 所属企業・戦略・プロジェクトの照合。DBの値は呼び出し側が読み、ここでは照合だけを行う（DBには触れない）。
 * ブラウザから届いた会社・戦略・プロジェクトの指定は、所属企業の中で一致するものだけを採る。 */

export type MembershipRow = { company_id: string; role: string };

export type StrategyRow = { id: string; company_id: string; departments: unknown };

/* 生成・閲覧の操作を許す役割。現行の動作（所属していれば利用可）を維持している。
 * 管理職・一般社員で操作を分けるかは承認事項（報告に記載）。 */
export const ALLOWED_ROLES: readonly string[] = ['admin', 'manager', 'member'];

export type ResolveFailure =
  | 'NO_ACCESS'
  | 'COMPANY_NOT_ACCESSIBLE'
  | 'STRATEGY_NOT_ACCESSIBLE'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_AMBIGUOUS';

export type ResolvedProject = {
  companyId: string;
  strategyId: string;
  departmentName: string;
  department: Record<string, unknown>;
  /** 安定したIDが無いプロジェクトは、部門と順番で区別する（同じ戦略の中でだけ有効） */
  projectKey: string;
  project: Record<string, unknown>;
};

type DeptLike = { name?: unknown; projects?: unknown };

const trimmed = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 所属していて、操作を許された企業の戦略だけを返す（他社の戦略はここで外れる） */
function accessibleStrategies(
  memberships: MembershipRow[],
  strategies: StrategyRow[],
  requestedCompanyId?: string,
  requestedStrategyId?: string
): { ok: true; strategies: StrategyRow[] } | { ok: false; reason: ResolveFailure } {
  const allowed = Array.from(
    new Set(memberships.filter((m) => ALLOWED_ROLES.includes(m.role)).map((m) => String(m.company_id)))
  );
  if (allowed.length === 0) return { ok: false, reason: 'NO_ACCESS' };

  let companies = allowed;
  if (requestedCompanyId !== undefined) {
    if (!allowed.includes(String(requestedCompanyId))) return { ok: false, reason: 'COMPANY_NOT_ACCESSIBLE' };
    companies = [String(requestedCompanyId)];
  }

  let list = strategies.filter((s) => companies.includes(String(s.company_id)));
  if (requestedStrategyId !== undefined) {
    list = list.filter((s) => String(s.id) === String(requestedStrategyId));
    if (list.length === 0) return { ok: false, reason: 'STRATEGY_NOT_ACCESSIBLE' };
  }
  return { ok: true, strategies: list };
}

function departmentsOf(strategy: StrategyRow): Array<{ dept: DeptLike & Record<string, unknown>; di: number }> {
  const list: DeptLike[] = Array.isArray(strategy.departments) ? (strategy.departments as DeptLike[]) : [];
  return list.map((d, di) => ({ dept: d as DeptLike & Record<string, unknown>, di })).filter((x) => !!x.dept);
}

function projectsOf(dept: DeptLike): Array<{ project: Record<string, unknown>; pi: number }> {
  const list: Record<string, unknown>[] = Array.isArray(dept.projects) ? (dept.projects as Record<string, unknown>[]) : [];
  return list.map((p, pi) => ({ project: p, pi })).filter((x) => !!x.project);
}

export function resolveProjectScope(args: {
  memberships: MembershipRow[];
  strategies: StrategyRow[];
  projectTitle: string;
  departmentName?: string;
  projectId?: string;
  requestedCompanyId?: string;
  requestedStrategyId?: string;
}): { ok: true; project: ResolvedProject } | { ok: false; reason: ResolveFailure } {
  const scope = accessibleStrategies(args.memberships, args.strategies, args.requestedCompanyId, args.requestedStrategyId);
  if (!scope.ok) return scope;

  const title = trimmed(args.projectTitle);
  const dept = trimmed(args.departmentName);
  const hits: ResolvedProject[] = [];
  for (const strategy of scope.strategies) {
    for (const { dept: d, di } of departmentsOf(strategy)) {
      const deptName = trimmed(d.name);
      if (dept && deptName !== dept) continue;
      for (const { project: p, pi } of projectsOf(d)) {
        if (trimmed(p.title) !== title) continue;
        if (args.projectId !== undefined) {
          const id = p.id ?? p.projectUid;
          if (id === undefined || String(id) !== String(args.projectId)) continue;
        }
        hits.push({
          companyId: String(strategy.company_id),
          strategyId: String(strategy.id),
          departmentName: deptName,
          department: d,
          projectKey: `d${di}-p${pi}`,
          project: p,
        });
      }
    }
  }

  if (hits.length === 0) return { ok: false, reason: 'PROJECT_NOT_FOUND' };
  if (hits.length > 1) return { ok: false, reason: 'PROJECT_AMBIGUOUS' };
  return { ok: true, project: hits[0] };
}

export type ProjectListing = {
  companyId: string;
  strategyId: string;
  departmentIndex: number;
  departmentName: string;
  projectKey: string;
  projectTitle: string;
  role: string | null;
};

/** 画面の選択に使う一覧。所属している企業の、部門ごとのプロジェクトを、キーつきで返す */
export function listAccessibleProjects(args: { memberships: MembershipRow[]; strategies: StrategyRow[] }): ProjectListing[] {
  const scope = accessibleStrategies(args.memberships, args.strategies);
  if (!scope.ok) return [];
  const out: ProjectListing[] = [];
  for (const strategy of scope.strategies) {
    for (const { dept, di } of departmentsOf(strategy)) {
      for (const { project, pi } of projectsOf(dept)) {
        out.push({
          companyId: String(strategy.company_id),
          strategyId: String(strategy.id),
          departmentIndex: di,
          departmentName: trimmed(dept.name),
          projectKey: `d${di}-p${pi}`,
          projectTitle: trimmed(project.title),
          role: typeof project.role === 'string' ? project.role : null,
        });
      }
    }
  }
  return out;
}

/** 一覧で選ばれたキー（企業・戦略・プロジェクト）を、そのまま照合する。別企業・存在しないキーは拒否する */
export function resolveProjectByKey(args: {
  memberships: MembershipRow[];
  strategies: StrategyRow[];
  companyId: string;
  strategyId: string;
  projectKey: string;
}): { ok: true; project: ResolvedProject } | { ok: false; reason: ResolveFailure } {
  const scope = accessibleStrategies(args.memberships, args.strategies, args.companyId, args.strategyId);
  if (!scope.ok) return scope;
  for (const strategy of scope.strategies) {
    for (const { dept, di } of departmentsOf(strategy)) {
      for (const { project, pi } of projectsOf(dept)) {
        if (`d${di}-p${pi}` !== args.projectKey) continue;
        return {
          ok: true,
          project: {
            companyId: String(strategy.company_id),
            strategyId: String(strategy.id),
            departmentName: trimmed(dept.name),
            department: dept,
            projectKey: args.projectKey,
            project,
          },
        };
      }
    }
  }
  return { ok: false, reason: 'PROJECT_NOT_FOUND' };
}
