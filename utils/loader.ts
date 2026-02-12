// /utils/loader.ts
'use client';

import { useStrategyStore } from '@/store/strategyStore';

const DEBUG = process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1';

/**
 * unknown型のエラーを正規化して、実体を必ず取得する
 */
function normalizeUnknownError(e: unknown) {
  const isObj = typeof e === 'object' && e !== null;
  const anyErr = e as any;

  const ownKeys = isObj ? Object.getOwnPropertyNames(e) : [];
  const ownEntries =
    isObj
      ? Object.fromEntries(ownKeys.map((k) => [k, (anyErr as any)[k]]))
      : null;

  return {
    type: typeof e,
    isError: e instanceof Error,
    constructor: isObj ? (anyErr?.constructor?.name ?? 'unknown') : null,
    name: anyErr?.name,
    message: anyErr?.message ?? (typeof e === 'string' ? e : undefined),
    stack: anyErr?.stack,
    code: anyErr?.code,
    details: anyErr?.details,
    hint: anyErr?.hint,
    status: anyErr?.status,

    ownKeys,
    ownEntries,

    stringified: (() => {
      try {
        return JSON.stringify(e);
      } catch {
        return '[unstringifiable]';
      }
    })(),
    asString: (() => {
      try {
        return String(e);
      } catch {
        return '[unstringifiable]';
      }
    })(),
    raw: e,
  };
}

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

  // 初回取得（これからロードするので Hydrating ON）
  const store = useStrategyStore.getState();

  if (DEBUG) console.log('[loadAndHydrate] 🚀 開始', { companyId });

  store.setHydrating(true);

  // 会社切替（ローカル破壊はしない：pendingCompanyId に退避）
  store.setCompanyScope(companyId);

  try {
    // store 側の正規ルートで取得・正規化・hydrated を完了させる
    if (DEBUG) console.log('[loadAndHydrate] 📡 refetchFromServer 実行前');
    await store.refetchFromServer();
    if (DEBUG) console.log('[loadAndHydrate] ✅ refetchFromServer 完了');

    if (DEBUG) console.log('[loadAndHydrate] 🎉 成功完了', {
      hydrated: useStrategyStore.getState().hydrated,
      loaded: useStrategyStore.getState().loaded,
    });
    return useStrategyStore.getState();
  } catch (e) {
    const n = normalizeUnknownError(e);
    console.error('[loadAndHydrate] ❌ エラー発生:', n);

    const msg =
      n.message ??
      (n.ownEntries?.message as string | undefined) ??
      n.asString ??
      'Unknown error';

    const err = new Error(`[loadAndHydrate] ${msg}`);
    (err as any).meta = n;
    throw err;
  } finally {
    // ★ finally 内で getState() を取り直して、最新の store 参照を使う
    const freshStore = useStrategyStore.getState();

    // 成功/失敗に関わらず必ず markLoaded を呼んで loaded:true にする（画面固まり防止）
    if (DEBUG) console.log('[loadAndHydrate] 🔧 finally ブロック：markLoaded 実行');
    if (freshStore.markLoaded) {
      freshStore.markLoaded();
    } else {
      console.warn('[loadAndHydrate] markLoaded が存在しません（手動設定）');
      useStrategyStore.setState((s) => ({ ...s, loaded: true, hydrated: true }));
    }

    // setHydrating も最新の参照で実行
    freshStore.setHydrating(false);

    // 最終的な state を確認（companyId と pendingCompanyId も含む）
    const finalState = useStrategyStore.getState();
    if (DEBUG) console.log('[loadAndHydrate] 📋 finally 完了後の state:', {
      loaded: finalState.loaded,
      hydrated: finalState.hydrated,
      companyId: finalState.companyId,
      pendingCompanyId: finalState.pendingCompanyId,
      boot_isHydrating: (finalState.boot as any)?.isHydrating,
      boot_isHydrated: (finalState.boot as any)?.isHydrated,
    });
  }
}
