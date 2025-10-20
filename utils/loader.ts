// /utils/loader.ts
'use client';

import { useStrategyStore } from '@/store/strategyStore';
import { getFullStrategyDataByCompany } from '@/utils/supabase/strategy';

/** 簡易安定ハッシュ（djb2） */
function stableHash(input: any): string {
  const s = typeof input === 'string' ? input : JSON.stringify(input);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

/** storeの現在値から保存スナップショットを構築（strategyStore.ts の buildSavePayload と整合） */
function buildSnapshotFromState(s: ReturnType<typeof useStrategyStore.getState>) {
  const base: any = {
    strategyId: s.strategyId ?? undefined,
    story: s.story,
    finalStory: s.finalStory,
    answers2: s.answers2,
    departments: s.departments,
    companyName: s.companyName,
    mission: s.mission,
    vision: s.vision,
    value: s.value,
    thought: s.thought,
  };
  if (typeof s.businessPortfolio !== 'undefined') base.businessPortfolio = s.businessPortfolio;
  if (Array.isArray(s.csvFinanceData)) base.csvFinanceData = s.csvFinanceData;
  if (Array.isArray(s.financeSummary)) base.financeSummary = s.financeSummary;
  if (s.simulationResult !== undefined) base.simulationResult = s.simulationResult;
  return base;
}

/**
 * 初回ロード/会社スコープ切替時のハイドレーション。
 * 1) isHydrating=true
 * 2) Supabaseから取得→stateへ反映（representationを尊重）
 * 3) 現在stateからスナップショットを作りハッシュ計算
 * 4) setHydrated(revision, hash) で autosave を解放
 */
export async function loadAndHydrate(companyId: string) {
  if (!companyId) throw new Error('companyId is required');

  const store = useStrategyStore.getState();
  // これからロードするので Hydrating ON（autosave 停止）
  useStrategyStore.getState().setHydrating(true);

  try {
    const { data, error } = await getFullStrategyDataByCompany(companyId);
    if (error) throw error;

    if (data) {
      // サーバの representation を尊重して最小限マージ
      useStrategyStore.setState((s) => ({
        ...s,
        companyId, // スコープを確実に保持
        ...(data as Partial<typeof s>),
      }));
    } else {
      // 空会社：companyIdだけ反映（他は空のまま）
      useStrategyStore.setState((s) => ({ ...s, companyId }));
    }

    // サーバ側の revision を取り出し（無ければ0）
    const rev =
      typeof (data as any)?.revision === 'number'
        ? (data as any).revision
        : typeof useStrategyStore.getState().revision === 'number'
        ? useStrategyStore.getState().revision!
        : 0;

    // 直近サーバスナップショットのハッシュを算出し、保存条件の基準にする
    const after = useStrategyStore.getState();
    const snapshot = buildSnapshotFromState(after);
    const hash = stableHash(snapshot);

    // ハイドレーション完了（autosave 解放）＋ サーバ世代とハッシュを記録
    useStrategyStore.getState().setHydrated(rev, hash);

    return after;
  } catch (e) {
    // 失敗時でも画面が固まらないよう最低限 isHydrated を立てる
    useStrategyStore.setState((s) => ({
      ...s,
      boot: { isHydrating: false, isHydrated: true },
      hydrated: true, // 互換
    }));
    throw e;
  }
}
