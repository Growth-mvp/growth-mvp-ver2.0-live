// /hooks/useAutoSave.ts
'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useStrategyStore } from '@/store/strategyStore';

function useDebounced(fn: () => void, ms: number) {
  const t = useRef<number | null>(null);
  return useMemo(
    () => () => {
      if (t.current) window.clearTimeout(t.current);
      t.current = window.setTimeout(fn, ms);
    },
    [fn, ms]
  );
}

/**
 * 画面側はこのフックを呼ぶだけでOK。
 * - 依存領域の変更を拾って、保存を1本化
 * - 競合や多重POSTを防止
 */
export function useAutoSave(deps: unknown[], delayMs = 800) {
  const save = useStrategyStore((s) => s.saveStrategyData);
  const debounced = useDebounced(() => {
    try {
      save();
    } catch (e) {
      console.warn('[autoSave] failed:', e);
    }
  }, delayMs);

  useEffect(() => {
    debounced();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
