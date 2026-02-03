/**
 * STAGE1/STAGE2 localStorage スナップショット I/O
 *
 * 目的:
 * - Supabase保存が不安定な場合でも、STAGE2デモを成立させる
 * - localStorageを「復旧用」に限定し、テナント混入を防ぐ
 *
 * キー:
 * - "growth.stage1.snapshot:<companyId>" : Stage1Snapshot
 * - "growth.stage2.snapshot:<companyId>" : Stage2Snapshot
 *
 * 旧キー（互換/掃除対象）:
 * - "growth.stage1.snapshot"
 * - "growth.stage2.snapshot"
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
const STAGE1_SNAPSHOT_KEY_LEGACY = 'growth.stage1.snapshot';
const STAGE2_SNAPSHOT_KEY_LEGACY = 'growth.stage2.snapshot';

function stage1Key(companyId?: string) {
  return companyId ? `growth.stage1.snapshot:${companyId}` : STAGE1_SNAPSHOT_KEY_LEGACY;
}
function stage2Key(companyId?: string) {
  return companyId ? `growth.stage2.snapshot:${companyId}` : STAGE2_SNAPSHOT_KEY_LEGACY;
}

/** 旧キー掃除（安全に） */
function cleanupLegacyKeys(kind: 'stage1' | 'stage2') {
  if (typeof window === 'undefined') return;
  try {
    if (kind === 'stage1') localStorage.removeItem(STAGE1_SNAPSHOT_KEY_LEGACY);
    if (kind === 'stage2') localStorage.removeItem(STAGE2_SNAPSHOT_KEY_LEGACY);
  } catch {}
}

/* ===== ユーティリティ ===== */
export function valueAnalysisToMetricsSummary(
  va: ValueAnalysis | undefined,
  _overallNote?: string
): MetricsSummary {
  if (!va) return {};
  return { ...va };
}

/* ===== STAGE1 Snapshot I/O ===== */
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
  if (!companyId) {
    // テナント混入防止：companyIdなし保存は禁止（必要なら呼び出し側で渡す）
    console.warn('[stageSnapshot] saveStage1Snapshot skipped: companyId is required');
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

    localStorage.setItem(stage1Key(companyId), JSON.stringify(snapshot));
    cleanupLegacyKeys('stage1');
    console.log('[stageSnapshot] Stage1 snapshot saved:', {
      key: stage1Key(companyId),
      issueBlocksCount: snapshot.issueBlocks.length,
      hasSummary: !!(snapshot.metricsSummary as any)?.roic,
    });
    return true;
  } catch (e) {
    console.error('[stageSnapshot] saveStage1Snapshot failed:', e);
    return false;
  }
}

export function loadStage1SnapshotFromLocalStorage(companyId?: string): Stage1Snapshot | null {
  if (typeof window === 'undefined') {
    console.warn('[stageSnapshot] loadStage1Snapshot: window is undefined (SSR)');
    return null;
  }
  if (!companyId) return null;

  try {
    const raw = localStorage.getItem(stage1Key(companyId));
    if (!raw) {
      console.log('[stageSnapshot] Stage1 snapshot not found');
      return null;
    }
    const parsed = JSON.parse(raw) as Stage1Snapshot;

    if (!parsed.savedAt || !Array.isArray(parsed.issueBlocks)) {
      console.warn('[stageSnapshot] Stage1 snapshot invalid format');
      return null;
    }
    if (parsed.companyId && parsed.companyId !== companyId) {
      console.warn('[stageSnapshot] Stage1 snapshot companyId mismatch; ignored', {
        expected: companyId,
        got: parsed.companyId,
      });
      return null;
    }

    console.log('[stageSnapshot] Stage1 snapshot loaded:', {
      key: stage1Key(companyId),
      savedAt: parsed.savedAt,
      issueBlocksCount: parsed.issueBlocks.length,
    });
    return parsed;
  } catch (e) {
    console.error('[stageSnapshot] loadStage1Snapshot failed:', e);
    return null;
  }
}

export function clearStage1Snapshot(companyId?: string): void {
  if (typeof window === 'undefined') return;
  if (!companyId) return;
  try {
    localStorage.removeItem(stage1Key(companyId));
    cleanupLegacyKeys('stage1');
    console.log('[stageSnapshot] Stage1 snapshot cleared', { key: stage1Key(companyId) });
  } catch (e) {
    console.error('[stageSnapshot] clearStage1Snapshot failed:', e);
  }
}

/* ===== STAGE2 Snapshot I/O ===== */
export function saveStage2SnapshotToLocalStorage(state: Stage2State, companyId?: string): boolean {
  if (typeof window === 'undefined') {
    console.warn('[stageSnapshot] saveStage2Snapshot: window is undefined (SSR)');
    return false;
  }
  if (!companyId) {
    console.warn('[stageSnapshot] saveStage2Snapshot skipped: companyId is required');
    return false;
  }

  try {
    const snapshot: Stage2Snapshot = {
      savedAt: new Date().toISOString(),
      state,
      companyId,
    };

    localStorage.setItem(stage2Key(companyId), JSON.stringify(snapshot));
    cleanupLegacyKeys('stage2');
    console.log('[stageSnapshot] Stage2 snapshot saved:', {
      key: stage2Key(companyId),
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

export function loadStage2SnapshotFromLocalStorage(companyId?: string): Stage2Snapshot | null {
  if (typeof window === 'undefined') {
    console.warn('[stageSnapshot] loadStage2Snapshot: window is undefined (SSR)');
    return null;
  }
  if (!companyId) return null;

  try {
    const raw = localStorage.getItem(stage2Key(companyId));
    if (!raw) {
      console.log('[stageSnapshot] Stage2 snapshot not found');
      return null;
    }

    const parsed = JSON.parse(raw) as Stage2Snapshot;

    if (!parsed.savedAt || !parsed.state) {
      console.warn('[stageSnapshot] Stage2 snapshot invalid format');
      return null;
    }
    if (parsed.companyId && parsed.companyId !== companyId) {
      console.warn('[stageSnapshot] Stage2 snapshot companyId mismatch; ignored', {
        expected: companyId,
        got: parsed.companyId,
      });
      return null;
    }

    console.log('[stageSnapshot] Stage2 snapshot loaded:', {
      key: stage2Key(companyId),
      savedAt: parsed.savedAt,
    });

    return parsed;
  } catch (e) {
    console.error('[stageSnapshot] loadStage2Snapshot failed:', e);
    return null;
  }
}

export function clearStage2Snapshot(companyId?: string): void {
  if (typeof window === 'undefined') return;
  if (!companyId) return;
  try {
    localStorage.removeItem(stage2Key(companyId));
    cleanupLegacyKeys('stage2');
    console.log('[stageSnapshot] Stage2 snapshot cleared', { key: stage2Key(companyId) });
  } catch (e) {
    console.error('[stageSnapshot] clearStage2Snapshot failed:', e);
  }
}

/* ===== 3段フォールバック用ヘルパー ===== */
export function getStage1DataWithFallback(
  storeData?: {
    stage1Issues?: IssueBlock[];
    valueAnalysis?: ValueAnalysis;
  },
  companyId?: string
): {
  issueBlocks: IssueBlock[];
  metricsSummary: MetricsSummary;
  source: 'store' | 'localStorage' | 'none';
} {
  if (storeData?.stage1Issues && storeData.stage1Issues.length > 0) {
    return {
      issueBlocks: storeData.stage1Issues,
      metricsSummary: valueAnalysisToMetricsSummary(storeData.valueAnalysis),
      source: 'store',
    };
  }

  const snapshot = companyId ? loadStage1SnapshotFromLocalStorage(companyId) : null;
  if (snapshot && snapshot.issueBlocks.length > 0) {
    return {
      issueBlocks: snapshot.issueBlocks,
      metricsSummary: snapshot.metricsSummary,
      source: 'localStorage',
    };
  }

  return {
    issueBlocks: [],
    metricsSummary: {},
    source: 'none',
  };
}

/**
 * ストアの状態から Stage2State を構築
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
  const storyDraft: StoryChapter[] | undefined = storeData.story?.length
    ? storeData.story.map((ch) => ({ title: ch.title, body: ch.body }))
    : undefined;

  const answers12: Stage2Answer[] | undefined = storeData.answers2?.length
    ? storeData.answers2.flatMap((ch) =>
        (ch.steps || []).map((step, idx) => ({
          id: `ch${ch.chapterIndex}-step${step.stepNumber ?? idx}`,
          question: step.question,
          answer: step.answer,
          required: (step.stepNumber ?? idx + 1) <= 4,
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
