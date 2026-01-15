/**
 * STAGE1/STAGE2 localStorage スナップショット I/O
 *
 * 目的:
 * - Supabase保存が不安定な場合でも、STAGE2デモを成立させる
 * - localStorageを「3段フォールバック」の2段目として使用
 *
 * キー:
 * - "growth.stage1.snapshot" : Stage1Snapshot
 * - "growth.stage2.snapshot" : Stage2Snapshot
 */

import type {
  IssueBlock,
  MetricsSummary,
  ValueAnalysis,
  Stage1Snapshot,
  Stage2Snapshot,
  Stage2State,
  StoryChapter,
  Stage2Answer,
  ChapterStory,
  ChapterAnswers,
} from '@/types/strategy';

/* ===== 定数 ===== */
const STAGE1_SNAPSHOT_KEY = 'growth.stage1.snapshot';
const STAGE2_SNAPSHOT_KEY = 'growth.stage2.snapshot';

/* ===== ユーティリティ ===== */

/**
 * ValueAnalysis から MetricsSummary を生成
 * - MetricsSummary = ValueAnalysis のエイリアスなので、そのまま返す
 * - undefined の場合は空オブジェクトを返す
 */
export function valueAnalysisToMetricsSummary(
  va: ValueAnalysis | undefined,
  _overallNote?: string // 互換用（使用しない）
): MetricsSummary {
  if (!va) {
    return {};
  }
  // MetricsSummary = ValueAnalysis なので、そのまま返す
  return { ...va };
}

/* ===== STAGE1 Snapshot I/O ===== */

/**
 * STAGE1スナップショットをlocalStorageに保存
 *
 * @param issueBlocks 論点ブロック
 * @param valueAnalysis ValueAnalysis（MetricsSummaryに変換）
 * @param companyName 会社名（任意）
 * @param companyId 会社ID（任意）
 */
export function saveStage1SnapshotToLocalStorage(
  issueBlocks: IssueBlock[],
  valueAnalysis: ValueAnalysis | undefined,
  companyName?: string,
  companyId?: string
): boolean {
  if (typeof window === 'undefined') {
    console.warn('[stageSnapshot] saveStage1Snapshot: window is undefined (SSR)');
    return false;
  }

  try {
    const snapshot: Stage1Snapshot = {
      savedAt: new Date().toISOString(),
      issueBlocks: issueBlocks ?? [],
      metricsSummary: valueAnalysisToMetricsSummary(valueAnalysis),
      companyName,
      companyId,
    };

    localStorage.setItem(STAGE1_SNAPSHOT_KEY, JSON.stringify(snapshot));
    console.log('[stageSnapshot] Stage1 snapshot saved:', {
      issueBlocksCount: snapshot.issueBlocks.length,
      hasSummary: !!snapshot.metricsSummary.roic,
    });
    return true;
  } catch (e) {
    console.error('[stageSnapshot] saveStage1Snapshot failed:', e);
    return false;
  }
}

/**
 * STAGE1スナップショットをlocalStorageから読み込み
 *
 * @returns Stage1Snapshot | null
 */
export function loadStage1SnapshotFromLocalStorage(): Stage1Snapshot | null {
  if (typeof window === 'undefined') {
    console.warn('[stageSnapshot] loadStage1Snapshot: window is undefined (SSR)');
    return null;
  }

  try {
    const raw = localStorage.getItem(STAGE1_SNAPSHOT_KEY);
    if (!raw) {
      console.log('[stageSnapshot] Stage1 snapshot not found');
      return null;
    }

    const parsed = JSON.parse(raw) as Stage1Snapshot;

    // バリデーション
    if (!parsed.savedAt || !Array.isArray(parsed.issueBlocks)) {
      console.warn('[stageSnapshot] Stage1 snapshot invalid format');
      return null;
    }

    console.log('[stageSnapshot] Stage1 snapshot loaded:', {
      savedAt: parsed.savedAt,
      issueBlocksCount: parsed.issueBlocks.length,
    });

    return parsed;
  } catch (e) {
    console.error('[stageSnapshot] loadStage1Snapshot failed:', e);
    return null;
  }
}

/**
 * STAGE1スナップショットをクリア
 */
export function clearStage1Snapshot(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STAGE1_SNAPSHOT_KEY);
    console.log('[stageSnapshot] Stage1 snapshot cleared');
  } catch (e) {
    console.error('[stageSnapshot] clearStage1Snapshot failed:', e);
  }
}

/* ===== STAGE2 Snapshot I/O ===== */

/**
 * STAGE2スナップショットをlocalStorageに保存
 */
export function saveStage2SnapshotToLocalStorage(
  state: Stage2State,
  companyId?: string
): boolean {
  if (typeof window === 'undefined') {
    console.warn('[stageSnapshot] saveStage2Snapshot: window is undefined (SSR)');
    return false;
  }

  try {
    const snapshot: Stage2Snapshot = {
      savedAt: new Date().toISOString(),
      state,
      companyId,
    };

    localStorage.setItem(STAGE2_SNAPSHOT_KEY, JSON.stringify(snapshot));
    console.log('[stageSnapshot] Stage2 snapshot saved:', {
      hasMVV: !!state.mvv.mission,
      hasSWOT: !!state.swot.strength,
      winPatternsCandidateCount: state.winPatternsCandidate?.length ?? 0,
    });
    return true;
  } catch (e) {
    console.error('[stageSnapshot] saveStage2Snapshot failed:', e);
    return false;
  }
}

/**
 * STAGE2スナップショットをlocalStorageから読み込み
 */
export function loadStage2SnapshotFromLocalStorage(): Stage2Snapshot | null {
  if (typeof window === 'undefined') {
    console.warn('[stageSnapshot] loadStage2Snapshot: window is undefined (SSR)');
    return null;
  }

  try {
    const raw = localStorage.getItem(STAGE2_SNAPSHOT_KEY);
    if (!raw) {
      console.log('[stageSnapshot] Stage2 snapshot not found');
      return null;
    }

    const parsed = JSON.parse(raw) as Stage2Snapshot;

    // バリデーション
    if (!parsed.savedAt || !parsed.state) {
      console.warn('[stageSnapshot] Stage2 snapshot invalid format');
      return null;
    }

    console.log('[stageSnapshot] Stage2 snapshot loaded:', {
      savedAt: parsed.savedAt,
    });

    return parsed;
  } catch (e) {
    console.error('[stageSnapshot] loadStage2Snapshot failed:', e);
    return null;
  }
}

/**
 * STAGE2スナップショットをクリア
 */
export function clearStage2Snapshot(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STAGE2_SNAPSHOT_KEY);
    console.log('[stageSnapshot] Stage2 snapshot cleared');
  } catch (e) {
    console.error('[stageSnapshot] clearStage2Snapshot failed:', e);
  }
}

/* ===== 3段フォールバック用ヘルパー ===== */

/**
 * STAGE1データを3段フォールバックで取得
 * 1) Zustand store（引数で渡す）
 * 2) localStorage snapshot
 * 3) Supabase（呼び出し側で行う）
 *
 * @param storeData store から取得したデータ（あれば）
 * @returns { issueBlocks, metricsSummary, source }
 */
export function getStage1DataWithFallback(
  storeData?: {
    stage1Issues?: IssueBlock[];
    valueAnalysis?: ValueAnalysis;
  }
): {
  issueBlocks: IssueBlock[];
  metricsSummary: MetricsSummary;
  source: 'store' | 'localStorage' | 'none';
} {
  // 1) Store から取得
  if (storeData?.stage1Issues && storeData.stage1Issues.length > 0) {
    return {
      issueBlocks: storeData.stage1Issues,
      metricsSummary: valueAnalysisToMetricsSummary(storeData.valueAnalysis),
      source: 'store',
    };
  }

  // 2) localStorage から取得
  const snapshot = loadStage1SnapshotFromLocalStorage();
  if (snapshot && snapshot.issueBlocks.length > 0) {
    return {
      issueBlocks: snapshot.issueBlocks,
      metricsSummary: snapshot.metricsSummary,
      source: 'localStorage',
    };
  }

  // 3) なし（呼び出し側で Supabase を試行）
  return {
    issueBlocks: [],
    metricsSummary: {},
    source: 'none',
  };
}

/**
 * ストアの状態から Stage2State を構築
 * - ストアの既存キー（story, answers2, finalStory）を Stage2State に変換
 */
export function buildStage2StateFromStore(storeData: {
  thought?: string;
  mission?: string;
  vision?: string;
  value?: string;
  strength?: string;
  weakness?: string;
  opportunity?: string;
  threat?: string;
  story?: ChapterStory[];
  finalStory?: ChapterStory[];
  answers2?: ChapterAnswers[];
  winPatterns?: any[];
}): Stage2State {
  // storyDraft: StoryChapter[] 形式に変換（既存 story から）
  const storyDraft: StoryChapter[] | undefined = storeData.story?.length
    ? storeData.story.map((ch) => ({ title: ch.title, body: ch.body }))
    : undefined;

  // answers12: ChapterAnswers から Stage2Answer[] に変換
  // 簡易版：各章の steps を展開して Stage2Answer に変換
  const answers12: Stage2Answer[] | undefined = storeData.answers2?.length
    ? storeData.answers2.flatMap((ch) =>
        (ch.steps || []).map((step, idx) => ({
          id: `ch${ch.chapterIndex}-step${step.stepNumber ?? idx}`,
          question: step.question,
          answer: step.answer,
          required: step.stepNumber <= 4, // 骨格4問を必須とする例
        }))
      )
    : undefined;

  return {
    mvv: {
      thought: storeData.thought,
      mission: storeData.mission,
      vision: storeData.vision,
      value: storeData.value,
    },
    swot: {
      strength: storeData.strength,
      weakness: storeData.weakness,
      opportunity: storeData.opportunity,
      threat: storeData.threat,
    },
    storyDraft,
    answers12,
    finalStory: storeData.finalStory,
  };
}
