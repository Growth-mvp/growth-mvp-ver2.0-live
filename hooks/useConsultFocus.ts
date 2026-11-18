import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useStrategyStore } from '@/store/strategyStore';
import { useConsultFocusStore } from '@/store/consultFocusStore';
import type { ConsultFocus, ConsultFocusEntry } from '@/lib/consult/consultFocus';

/** 画面の質問・入力中の回答を、CEOチャットの相談文脈として登録する。画面を離れたら自動で外す。 */
export function useConsultFocus(owner: string, focus: Omit<ConsultFocus, 'pathname'> | null): void {
  const pathname = usePathname() ?? '';
  const strategyId = useStrategyStore((s) => s.strategyId ?? null);
  const setEntry = useConsultFocusStore((s) => s.setEntry);
  const entry: ConsultFocusEntry | null = focus ? { ...focus, pathname, strategyId } : null;
  const key = JSON.stringify(entry);

  useEffect(() => {
    setEntry(owner, entry);
    // key は entry の内容を表す（参照の変化で再登録しないため）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, key, setEntry]);

  useEffect(() => () => setEntry(owner, null), [owner, setEntry]);
}
