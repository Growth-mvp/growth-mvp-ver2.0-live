import type { StrategyState } from '@/store/strategyStore';
import { workingHashOf } from '@/utils/stage6/financePlanSnapshot';

export type SaveStatusType = 'error' | 'saving' | 'dirty' | 'saved';

/** 画面左下の保存状態と同じ判定。AIの説明もこの判定を使い、表示と食い違わないようにする */
export function saveStatusTypeOf(s: StrategyState): SaveStatusType {
  if (s.saveError) return 'error';
  if (s.boot?.isSaving) return 'saving';
  const working = workingHashOf(s.csvFinanceData);
  const dirtyFinancePlan = working !== undefined && s.financePlanSavedHash !== undefined && s.financePlanSavedHash !== working;
  return (s.dirty ?? false) || dirtyFinancePlan ? 'dirty' : 'saved';
}
