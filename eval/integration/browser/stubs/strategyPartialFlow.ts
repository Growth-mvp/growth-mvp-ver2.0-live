/* 検証用の部分更新（評価専用）。保存先は flowStore と同じ localStorage。revision の条件が合う時だけ書く（実装と同じ契約）。 */
import { useStrategyStore } from '@/store/strategyStore';

const storageKey = (companyId: string): string => `flow:${companyId}`;

const w: any = typeof window !== 'undefined' ? window : globalThis;
w.__partialWrites = w.__partialWrites || [];

export const strategyPartialIo = {
  async read(companyId: string) {
    const raw = localStorage.getItem(storageKey(companyId));
    const p = raw ? JSON.parse(raw) : { departments: useStrategyStore.getState().departments ?? [], revision: useStrategyStore.getState().revision ?? 0 };
    return { row: { id: 'flow-row', revision: Number(p.revision ?? 0), departments: p.departments ?? [] }, error: null };
  },
  async write({ companyId, expectedRevision, departments, actorId }: any) {
    w.__partialWrites.push({ companyId, expectedRevision, actorId });
    if (w.__flow?.failSave) return { row: null, error: { message: 'mock write failure' } };
    const raw = localStorage.getItem(storageKey(companyId));
    const current = raw ? JSON.parse(raw) : { revision: useStrategyStore.getState().revision ?? 0 };
    if (Number(current.revision ?? 0) !== expectedRevision) return { row: null, error: null };
    const next = { departments, revision: expectedRevision + 1 };
    localStorage.setItem(storageKey(companyId), JSON.stringify(next));
    return { row: { id: 'flow-row', revision: next.revision, departments }, error: null };
  },
};
