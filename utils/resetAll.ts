// /utils/resetAll.ts
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { clearCompanyScopedStorage } from '@/utils/scopedStorage';

/**
 * 会社切替/ログアウト時の“完全リセット”。
 * - Zustand ストアの初期化
 * - 会社スコープ外の Storage キー削除
 * - （将来）SWR/React Query 等のキャッシュもここでクリア
 */
export function hardResetForCompanySwitch(nextCompanyId: string | null) {
  console.log('[reset] hard reset for company switch →', nextCompanyId);

  // --- 1. Strategy store を完全初期化 ---
  const st = useStrategyStore.getState();
  if (typeof st.resetAll === 'function') {
    st.resetAll();
  } else {
    // 型が古い環境でも安全に落とすフォールバック
    st.reset?.();
  }
  // 会社スコープを最新に
  st.setCompanyScope?.(nextCompanyId);

  // --- 2. ユーザーストアの membership も更新 ---
  useUserStore
    .getState()
    .setMembership({ companyId: nextCompanyId ?? undefined, departmentId: undefined });

  // --- 3. ストレージを会社スコープで一掃 ---
  clearCompanyScopedStorage(nextCompanyId);

  // --- 4. （必要なら）SWR/React Query などのキャッシュクリアをここに追加 ---
  // e.g. queryClient.clear(); swrCache.clear(); など
}
