import { captureSaveScope, isSaveScopeCurrent, type SaveScope } from '@/lib/strategy/saveScope';

type OkrOwnershipFields = {
  company_id?: string | null;
  strategy_id?: string | null;
  project_id?: string | null;
};

/** OKR 書き込み開始時のスコープ。会社・戦略が未確定、または所属会社・戦略がずれていれば null。 */
export function captureOkrWriteScope(accessCompanyId: string | undefined, strategyIdInUse: string): SaveScope | null {
  const scope = captureSaveScope();
  if (!scope || !accessCompanyId || scope.companyId !== accessCompanyId) return null;
  if (!strategyIdInUse || scope.strategyId !== strategyIdInUse) return null;
  return scope;
}

/** OKR 行が、スコープの会社・戦略・プロジェクトに属するか。 */
export function isOkrOwnedByScope(row: OkrOwnershipFields, scope: SaveScope, projectId: string): boolean {
  return row.company_id === scope.companyId && row.strategy_id === scope.strategyId && row.project_id === projectId;
}

export { isSaveScopeCurrent };
