'use client';

/* 開発用の実行計画書の保存先（評価専用）。実DBには接続せず、このブラウザの保存領域に記録する。
 * 契約（PlanDocumentStore）は、DBの実装に差し替えられるように同じ形にしてある。 */
import { createMemoryPlanDocumentStore, type MemoryPlanDocumentStore } from '@/lib/stage4/plan/planDocumentStore';
import { useStrategyStore } from '@/store/strategyStore';

const STORAGE_KEY = 'growth-shift.stage4.planDocuments.dev';

let instance: MemoryPlanDocumentStore | null = null;

export function devPlanDocumentStore(): MemoryPlanDocumentStore {
  if (instance) return instance;
  const hasStorage = typeof window !== 'undefined' && !!window.localStorage;
  instance = createMemoryPlanDocumentStore({
    getStrategies: () => {
      const st = useStrategyStore.getState() as unknown as { strategyId?: string; companyId?: string; departments?: unknown };
      return [{ id: String(st.strategyId ?? ''), company_id: String(st.companyId ?? ''), departments: st.departments ?? [] }];
    },
    now: () => new Date().toISOString(),
    storage: hasStorage
      ? {
          read: () => window.localStorage.getItem(STORAGE_KEY),
          write: (value) => window.localStorage.setItem(STORAGE_KEY, value),
        }
      : undefined,
  });
  if (typeof window !== 'undefined') (window as unknown as { __planStore?: MemoryPlanDocumentStore }).__planStore = instance;
  return instance;
}
