// /utils/loader.ts
'use client';

import { useStrategyStore } from '@/store/strategyStore';
import { getFullStrategyDataByCompany } from '@/utils/supabase/strategy';

/* ============================================
 * ユーティリティ
 * ========================================== */

/** 簡易安定ハッシュ（djb2） */
function stableHash(input: any): string {
  const s =
    typeof input === 'string'
      ? input
      : input == null
      ? ''
      : JSON.stringify(input);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

/** undefined / null / 空文字 などを深い階層まで除去（strategyStore と整合） */
function pruneUndefinedDeep<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj
      .map((v) => pruneUndefinedDeep(v))
      .filter(
        (v) =>
          !(
            v === undefined ||
            v === null ||
            (typeof v === 'string' && v.trim() === '')
          ),
      ) as unknown as T;
  }
  if (obj && typeof obj === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(obj as any)) {
      const pv = pruneUndefinedDeep(v);
      const drop =
        pv === undefined ||
        pv === null ||
        (typeof pv === 'string' && pv.trim() === '');
      if (!drop) out[k] = pv;
    }
    return out;
  }
  return obj;
}

/**
 * store の現在値から保存スナップショットを構築
 *  - /store/strategyStore.ts の buildSavePayload と同等構成
 */
function buildSnapshotFromState(state: ReturnType<typeof useStrategyStore.getState>) {
  const base: any = {
    strategyId: state.strategyId ?? undefined,

    // ストーリー系
    story: state.story,
    finalStory: state.finalStory,
    answers2: state.answers2,
    departments: state.departments,

    // プロフィール / MVV
    companyName: state.companyName,
    foundationYear: state.foundationYear,
    location: state.location,
    industry: state.industry,
    revenue: state.revenue,
    employees: state.employees,
    businessContent: state.businessContent,
    customerSegment: state.customerSegment,

    mission: state.mission,
    vision: state.vision,
    value: state.value,
    thought: state.thought,

    // SWOT
    strength: state.strength,
    weakness: state.weakness,
    opportunity: state.opportunity,
    threat: state.threat,
  };

  // 財務関連は存在していれば追加
  if (typeof state.businessPortfolio !== 'undefined') {
    base.businessPortfolio = state.businessPortfolio;
  }
  if (Array.isArray(state.csvFinanceData)) {
    base.csvFinanceData = state.csvFinanceData;
  }
  if (Array.isArray(state.financeSummary)) {
    base.financeSummary = state.financeSummary;
  }
  if (state.simulationResult !== undefined) {
    base.simulationResult = state.simulationResult;
  }

  return pruneUndefinedDeep(base);
}

/**
 * 初回ロード / 会社スコープ切替時のハイドレーション。
 *
 * 1) setHydrating(true) で autosave を一時停止
 * 2) Supabase から strategy_data + 分離テーブルを取得
 * 3) 取得したデータで state を上書き
 * 4) 現在 state からスナップショットを作りハッシュ計算
 * 5) setHydrated(revision, hash) で autosave を解放
 */
export async function loadAndHydrate(companyId: string) {
  if (!companyId) throw new Error('companyId is required');

  // これからロードするので Hydrating ON（autosave 停止）
  useStrategyStore.getState().setHydrating(true);

  try {
    const { data, error } = await getFullStrategyDataByCompany(companyId);
    if (error) throw error;

    if (data) {
      // Supabase から返ってきた StrategyData（normalize 済み）を
      // 主要フィールドについては「明示的に上書き」する
      useStrategyStore.setState((s) => ({
        ...s,
        companyId,

        // ID / メタ
        strategyId: (data as any).strategyId ?? s.strategyId,

        // ストーリー系
        story: Array.isArray((data as any).story) ? (data as any).story : [],
        finalStory: Array.isArray((data as any).finalStory)
          ? (data as any).finalStory
          : [],

        // 会社ストーリー用 answers2
        answers2: Array.isArray((data as any).answers2)
          ? (data as any).answers2
          : [],

        // 部門（normalize 済みのものをそのまま採用）
        departments: Array.isArray((data as any).departments)
          ? (data as any).departments
          : [],

        // プロフィール / MVV
        companyName: (data as any).companyName ?? s.companyName,
        foundationYear: (data as any).foundationYear ?? s.foundationYear,
        location: (data as any).location ?? s.location,
        industry: (data as any).industry ?? s.industry,
        revenue: (data as any).revenue ?? s.revenue,
        employees: (data as any).employees ?? s.employees,
        businessContent: (data as any).businessContent ?? s.businessContent,
        customerSegment:
          (data as any).customerSegment ?? s.customerSegment,

        mission: (data as any).mission ?? s.mission,
        vision: (data as any).vision ?? s.vision,
        value: (data as any).value ?? s.value,
        thought: (data as any).thought ?? s.thought,

        // SWOT
        strength: (data as any).strength ?? s.strength,
        weakness: (data as any).weakness ?? s.weakness,
        opportunity: (data as any).opportunity ?? s.opportunity,
        threat: (data as any).threat ?? s.threat,

        // 財務関連
        businessPortfolio:
          (data as any).businessPortfolio ?? s.businessPortfolio,
        csvFinanceData: Array.isArray((data as any).csvFinanceData)
          ? (data as any).csvFinanceData
          : s.csvFinanceData,
        financeSummary: Array.isArray((data as any).financeSummary)
          ? (data as any).financeSummary
          : s.financeSummary,
        simulationResult:
          (data as any).simulationResult ?? s.simulationResult,

        // revision はここで state にも反映しておく（あれば）
        revision:
          typeof (data as any).revision === 'number'
            ? (data as any).revision
            : s.revision,
      }));
    } else {
      // 空会社：companyIdだけ反映し、戦略系は明示的にリセット
      useStrategyStore.setState((s) => ({
        ...s,
        companyId,
        story: [],
        finalStory: [],
        answers2: [],
        departments: [],
      }));
    }

    // サーバ側の revision を取り出し（無ければ 0）
    const stateAfterSet = useStrategyStore.getState();
    const rev =
      typeof (data as any)?.revision === 'number'
        ? (data as any).revision
        : typeof stateAfterSet.revision === 'number'
        ? stateAfterSet.revision!
        : 0;

    // 直近サーバスナップショットのハッシュを算出し、保存条件の基準にする
    const snapshot = buildSnapshotFromState(stateAfterSet);
    const hash = stableHash(snapshot);

    // ハイドレーション完了（autosave 解放）＋ サーバ世代とハッシュを記録
    useStrategyStore.getState().setHydrated(rev, hash);

    return stateAfterSet;
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
