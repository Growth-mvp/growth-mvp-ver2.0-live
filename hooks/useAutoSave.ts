// /hooks/useAutoSave.ts
'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { saveStrategyData } from '@/utils/supabase/strategy';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';

type Options = {
  enabled?: boolean;
  debounceMs?: number;
};

/**
 * 小型デバウンスユーティリティ
 */
function useDebounced(fn: () => void, delayMs: number) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const trigger = useCallback(() => {
    cancel();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      try {
        fn();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[useAutoSave] debounced exec error:', e);
      }
    }, Math.max(0, delayMs));
  }, [fn, delayMs, cancel]);

  useEffect(() => cancel, [cancel]);

  return { trigger, cancel };
}

/**
 * JSON安定化（循環対策）
 */
function safeStableStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, (key, value) => {
      if (value instanceof Date) return value.toISOString();
      return value;
    });
  } catch {
    return '';
  }
}

/**
 * 互換対応:
 *  - 旧: useAutoSave([dep1, dep2, ...])
 *  - 新: useAutoSave({ enabled, debounceMs })
 *  - 併用: useAutoSave({ enabled }, [dep1, dep2])
 */
export function useAutoSave(
  arg1?: Options | any[],
  arg2?: any[],
) {
  const isArg1Array = Array.isArray(arg1);
  const options: Options = isArg1Array ? {} : (arg1 ?? {});
  const externalDeps: any[] = isArg1Array ? (arg1 as any[]) : (Array.isArray(arg2) ? arg2! : []);

  const enabled = options.enabled ?? true;
  const debounceMs = options.debounceMs ?? 1200;

  // ユーザー情報
  const { user } = useUserStore();

  // Strategy の全体状態（storeのshapeは any 扱い）
  const strategy = useStrategyStore((s: any) => s);
  const hydrated: boolean = useStrategyStore((s: any) => !!s?.hydrated);
  const revision: number | undefined = useStrategyStore((s: any) => s?.revision);
  const setAfterSave = useStrategyStore((s: any) => s?.__afterSave?.bind?.(s) ?? null);

  // 保存中フラグ
  const savingRef = useRef(false);

  // 内部で主要フィールドから変更シグネチャを生成
  const internalSignature = useMemo(() => {
    const pick = {
      companyName: (strategy as any)?.companyName,
      mission: (strategy as any)?.mission,
      vision: (strategy as any)?.vision,
      value: (strategy as any)?.value,
      thought: (strategy as any)?.thought,
      story: (strategy as any)?.story,
      finalStory: (strategy as any)?.finalStory,
      answers2: (strategy as any)?.answers2,
      departments: (strategy as any)?.departments,
      csvFinanceData: (strategy as any)?.csvFinanceData,
      financeSummary: (strategy as any)?.financeSummary,
      businessPortfolio: (strategy as any)?.businessPortfolio,
      simulationResults: (strategy as any)?.simulationResults,
    };
    return safeStableStringify(pick);
  }, [
    (strategy as any)?.companyName,
    (strategy as any)?.mission,
    (strategy as any)?.vision,
    (strategy as any)?.value,
    (strategy as any)?.thought,
    (strategy as any)?.story,
    (strategy as any)?.finalStory,
    (strategy as any)?.answers2,
    (strategy as any)?.departments,
    (strategy as any)?.csvFinanceData,
    (strategy as any)?.financeSummary,
    (strategy as any)?.businessPortfolio,
    (strategy as any)?.simulationResults,
  ]);

  // 互換: 依存配列を与えられた場合は、それも変更トリガに含める
  const depsSignature = useMemo(() => {
    if (!externalDeps || externalDeps.length === 0) return '';
    return safeStableStringify(externalDeps);
  }, [externalDeps]);

  const combinedSignature = internalSignature + '|' + depsSignature;

  const doSave = useCallback(async () => {
    if (!enabled) {
      // eslint-disable-next-line no-console
      console.log('[useAutoSave] skipped: disabled');
      return;
    }
    if (!hydrated) {
      // eslint-disable-next-line no-console
      console.log('[useAutoSave] skipped: not hydrated');
      return;
    }
    if (!user?.id) {
      // eslint-disable-next-line no-console
      console.log('[useAutoSave] skipped: no user id');
      return;
    }
    if (savingRef.current) {
      // eslint-disable-next-line no-console
      console.log('[useAutoSave] skipped: already saving');
      return;
    }

    savingRef.current = true;
    try {
      const payload = { ...(strategy as any) };
      // eslint-disable-next-line no-console
      console.log('[useAutoSave] saving...', { rev: revision });

      const res = await saveStrategyData(payload, user.id, null, revision);
      if (res.error) {
        // eslint-disable-next-line no-console
        console.error('[useAutoSave] ❌ save error:', res.error);
        return;
      }
      if (res.data) {
        if (typeof setAfterSave === 'function') {
          try {
            setAfterSave(res.data);
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[useAutoSave] afterSave hook error:', e);
          }
        }
        // eslint-disable-next-line no-console
        console.log('[useAutoSave] ✅ saved (rev maybe):', (res.data as any)?.revision);
      }
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[useAutoSave] ❌ fatal:', {
        message: e?.message,
        code: e?.code,
        status: e?.status,
        details: e?.details,
        hint: e?.hint,
      });
    } finally {
      savingRef.current = false;
    }
  }, [enabled, hydrated, user?.id, strategy, revision, setAfterSave]);

  const { trigger, cancel } = useDebounced(doSave, debounceMs);

  useEffect(() => {
    if (!enabled) return;
    trigger();
    return cancel;
  }, [enabled, combinedSignature, trigger, cancel]);

  useEffect(() => {
    return () => {
      // flushは行わない（遷移中断の可能性が高い）
    };
  }, []);
}
