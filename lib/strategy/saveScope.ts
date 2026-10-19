import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';

/**
 * ストアを経由しない直接保存の会社・戦略スコープ。
 * 会社IDは A→B→A と戻ることがあるため、切替ごとに増える世代番号で照合する。
 */
export type SaveScope = {
  generation: number;
  userId: string;
  companyId: string;
  strategyId: string | null;
};

export const SAVE_SCOPE_CHANGED = 'SAVE_SCOPE_CHANGED' as const;

let generation = 0;
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  useStrategyStore.subscribe((s, prev) => {
    if (s.companyId !== prev.companyId || s.pendingCompanyId !== prev.pendingCompanyId) generation += 1;
  });
  useUserStore.subscribe((s, prev) => {
    if (s.companyId !== prev.companyId || s.user?.id !== prev.user?.id) generation += 1;
  });
}

export function captureSaveScope(): SaveScope | null {
  listen();
  const user = useUserStore.getState();
  const strategy = useStrategyStore.getState();
  const userId = user.user?.id ?? null;
  const companyId = user.companyId ?? null;
  if (!userId || !companyId) return null;
  if (strategy.companyId !== companyId || strategy.pendingCompanyId) return null;
  return { generation, userId, companyId, strategyId: strategy.strategyId ?? null };
}

export function isSaveScopeCurrent(scope: SaveScope): boolean {
  if (scope.generation !== generation) return false;
  const user = useUserStore.getState();
  const strategy = useStrategyStore.getState();
  if (user.companyId !== scope.companyId) return false;
  if (strategy.companyId !== scope.companyId || strategy.pendingCompanyId) return false;
  return !scope.strategyId || strategy.strategyId === scope.strategyId;
}

/** 検証と保存の呼び出しを同じ同期区間で行う。保存関数は呼び出し時点のストアを読むこと。 */
export function runInSaveScope<T>(
  scope: SaveScope,
  save: () => Promise<T>,
): Promise<T | typeof SAVE_SCOPE_CHANGED> {
  if (!isSaveScopeCurrent(scope)) return Promise.resolve(SAVE_SCOPE_CHANGED);
  return save();
}
