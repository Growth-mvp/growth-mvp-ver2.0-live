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

export function resolveProjectScope(args: {
  memberships: MembershipRow[];
  strategies: StrategyRow[];
  projectTitle: string;
  departmentName?: string;
  projectId?: string;
  requestedCompanyId?: string;
  requestedStrategyId?: string;
}): { ok: true; project: ResolvedProject } | { ok: false; reason: ResolveFailure } {
  const allowed = Array.from(
    new Set(args.memberships.filter((m) => ALLOWED_ROLES.includes(m.role)).map((m) => String(m.company_id)))
  );
  if (allowed.length === 0) return { ok: false, reason: 'NO_ACCESS' };

  let companies = allowed;
  if (args.requestedCompanyId !== undefined) {
    if (!allowed.includes(String(args.requestedCompanyId))) return { ok: false, reason: 'COMPANY_NOT_ACCESSIBLE' };
    companies = [String(args.requestedCompanyId)];
  }

  let strategies = args.strategies.filter((s) => companies.includes(String(s.company_id)));
  if (args.requestedStrategyId !== undefined) {
    strategies = strategies.filter((s) => String(s.id) === String(args.requestedStrategyId));
    if (strategies.length === 0) return { ok: false, reason: 'STRATEGY_NOT_ACCESSIBLE' };
  }

  const title = trimmed(args.projectTitle);
  const dept = trimmed(args.departmentName);
  const hits: ResolvedProject[] = [];
  for (const strategy of strategies) {
    const departments: DeptLike[] = Array.isArray(strategy.departments) ? (strategy.departments as DeptLike[]) : [];
    departments.forEach((d, di) => {
      const deptName = trimmed(d?.name);
      if (dept && deptName !== dept) return;
      const projects: Record<string, unknown>[] = Array.isArray(d?.projects) ? (d.projects as Record<string, unknown>[]) : [];
      projects.forEach((p, pi) => {
        if (!p || trimmed(p.title) !== title) return;
        if (args.projectId !== undefined) {
          const id = p.id ?? p.projectUid;
          if (id === undefined || String(id) !== String(args.projectId)) return;
        }
        hits.push({
          companyId: String(strategy.company_id),
          strategyId: String(strategy.id),
          departmentName: deptName,
          department: d as Record<string, unknown>,
          projectKey: `d${di}-p${pi}`,
          project: p,
        });
      });
    });
  }

  if (hits.length === 0) return { ok: false, reason: 'PROJECT_NOT_FOUND' };
  if (hits.length > 1) return { ok: false, reason: 'PROJECT_AMBIGUOUS' };
  return { ok: true, project: hits[0] };
}
