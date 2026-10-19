'use client';

import { useMemo } from 'react';

import { useStrategyStore } from '@/store/strategyStore';
import { buildPlanData, type AudienceType, type PlanData } from '@/utils/export/buildPlanData';

export type PlanSource =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; planData: PlanData };

/**
 * 計画書画面の元データ（会社・戦略）の状態を返す。
 *
 * - 会社名が取得できていれば ready（読み込み前の一時的な未設定エラーは持ち越さない）
 * - 復元が完了し、会社名がなければ missing（会社情報の入力を案内する）
 * - 復元に失敗していれば error
 * - それ以外は loading（ストアの読み込み中）
 */
export function usePlanSource(audience: AudienceType): PlanSource {
  const strategyState = useStrategyStore((state) => state);

  return useMemo<PlanSource>(() => {
    const switching = !!strategyState.pendingCompanyId;

    if (!switching && strategyState.companyName) {
      try {
        const planData = buildPlanData(strategyState, audience, {
          companyId: strategyState.companyId || undefined,
          strategyId: strategyState.strategyId || undefined,
        });
        return { status: 'ready', planData };
      } catch (err) {
        console.error('計画書データ構築エラー:', err);
        return { status: 'error', message: 'データの読み込みに失敗しました。ページをリロードしてください。' };
      }
    }

    if (strategyState.__lastServerError) {
      return { status: 'error', message: '会社データの読み込みに失敗しました。ページをリロードしてください。' };
    }

    if (switching) return { status: 'loading' };

    const settled =
      strategyState.restoreReady === true &&
      !strategyState.isRestoring &&
      !strategyState.__isFetchingFromServer;
    return settled ? { status: 'missing' } : { status: 'loading' };
  }, [strategyState, audience]);
}
