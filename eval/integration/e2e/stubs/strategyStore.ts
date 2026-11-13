/* 評価用：STAGE3の架空の戦略データを、画面が読む店舗ストアとして置く。
 * 戦略データの保存（saveStrategyData）は、実DBの代わりにブラウザの localStorage へ書く（再読み込みで残るかを確かめるため）。 */
import { create } from 'zustand';
import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { IDS } from '../ids';

const KEY = 'e2e-strategy-departments';
const snapshot = JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0]));
const saved = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
const departments = saved ? JSON.parse(saved) : snapshot.departments;

export const useStrategyStore = create<any>(() => ({
  ...snapshot,
  departments,
  companyId: IDS.companyA,
  strategyId: IDS.strategyA,
  companyName: '架空精密計測株式会社（評価用）',
  hydrated: true,
  loaded: true,
  restoreReady: true,
  isRestoring: false,
  pendingCompanyId: null,
  saveStrategyData: async () => {
    if (window.localStorage.getItem('e2e-fail-finance') === '1') return { ok: false, reason: 'e2e-forced-failure' };
    window.localStorage.setItem(KEY, JSON.stringify(useStrategyStore.getState().departments));
    return { ok: true, revision: 1 };
  },
}));
