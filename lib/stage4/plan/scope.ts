export type ScopeFailure = 'STRATEGY_MISMATCH' | 'COMPANY_MISMATCH' | 'PROJECT_NOT_IN_STRATEGY';

export class PlanScopeError extends Error {
  constructor(readonly reason: ScopeFailure) {
    super(reason);
    this.name = 'PlanScopeError';
  }
}

export type PlanScope = {
  companyId: string;
  strategyId: string;
  projectId: string;
  departmentId: string;
  departmentName: string;
};

type ScopeDepartment = {
  id?: string | number;
  name: string;
  projects: Array<{ id?: string | number }>;
};

/**
 * 呼び出し元の所属企業・要求された戦略/プロジェクトが、DBから読んだ戦略行と一致するかを照合する。
 * 本番ルートでは membership の companyId を requireMembership(admin, userId, companyId) で得たものを渡す。
 */
export function resolvePlanScope(args: {
  membershipCompanyId: string;
  requestedStrategyId: string;
  requestedProjectId: string;
  strategy: { id: string; company_id: string };
  departments: ScopeDepartment[];
}): PlanScope {
  const { membershipCompanyId, requestedStrategyId, requestedProjectId, strategy, departments } = args;

  if (String(strategy.id) !== String(requestedStrategyId)) {
    throw new PlanScopeError('STRATEGY_MISMATCH');
  }
  if (String(strategy.company_id) !== String(membershipCompanyId)) {
    throw new PlanScopeError('COMPANY_MISMATCH');
  }

  for (const dept of departments) {
    const hit = dept.projects.find((p) => p.id !== undefined && String(p.id) === String(requestedProjectId));
    if (hit) {
      return {
        companyId: String(strategy.company_id),
        strategyId: String(strategy.id),
        projectId: String(requestedProjectId),
        departmentId: dept.id === undefined ? '' : String(dept.id),
        departmentName: dept.name,
      };
    }
  }
  throw new PlanScopeError('PROJECT_NOT_IN_STRATEGY');
}
