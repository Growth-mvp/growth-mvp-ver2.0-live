// /utils/loader.ts
'use client';

import { useStrategyStore } from '@/store/strategyStore';

/**
 * 初回ロード / 会社スコープ切替時のハイドレーション。
 *
 * 重要方針：
 * - strategyStore.ts に「正規の refetch 正規化・hydrated/hash/revision 管理」が既にあるため、
 *   loader 側で DB レスポンスを直接 setState しない（競合・揺れの原因になる）。
 * - ここでは「スコープ切替を宣言 → store の refetchFromServer() を実行」だけを行う。
 */
export async function loadAndHydrate(companyId: string) {
  if (!companyId) throw new Error('companyId is required');

  const store = useStrategyStore.getState();

  // これからロードするので Hydrating ON（autosave 停止）
  // ※ setCompanyScope でも hydrating を立てるが、既存呼び出し互換のため明示しておく
  store.setHydrating(true);

  // 会社切替（ローカル破壊はしない：pendingCompanyId に退避）
  store.setCompanyScope(companyId);

  try {
    // store 側の正規ルートで取得・正規化・hydrated を完了させる
    await store.refetchFromServer();

    // 念のため：UI 側で「サーバ読込完了」を条件にしている場合があるため立てる
    // （store.refetchFromServer() 側でも loaded:true にしているが、ここは冪等）
    store.markLoaded?.();

    return useStrategyStore.getState();
  } catch (e) {
    // 失敗時でも画面が固まらないよう最低限 hydrated を立てる（従来互換）
    useStrategyStore.setState((s) => ({
      ...s,
      boot: { isHydrating: false, isHydrated: true },
      hydrated: true,
    }));
    throw e;
  } finally {
    // store.refetchFromServer が成功していれば setHydrated() 内で isHydrating=false になる。
    // 失敗時も UI が解除されるようにしておく（冪等）
    store.setHydrating(false);
  }
}
