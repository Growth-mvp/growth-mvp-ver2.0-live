import { clearCompanyScopedStorage } from '@/utils/scopedStorage';
import { clearStage1Snapshot, clearStage2Snapshot } from '@/utils/stageSnapshot';

const STRATEGY_STORE_KEYS = ['strategy-store-v5', 'strategy-persist'] as const;

/**
 * 端末内の戦略データのキャッシュを削除する。
 * ログイン情報（user-storage）・会社所属・削除確認フラグは対象外。
 */
export function clearLocalStrategyCache(): void {
  if (typeof localStorage === 'undefined') return;
  for (const key of STRATEGY_STORE_KEYS) localStorage.removeItem(key);
  clearStage1Snapshot();
  clearStage2Snapshot();
  clearCompanyScopedStorage(null);
}
