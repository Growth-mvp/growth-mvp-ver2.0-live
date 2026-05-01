/**
 * /utils/export/buildStage2ReportData.ts
 *
 * 目的：
 * - STAGE2 経営戦略ストーリーレポート用データの構築
 * - 読み取り専用
 */

import type { StrategyState } from '@/store/strategyStore';

export interface Stage2ReportData {
  companyName: string;
  generatedDate: string;

  // CEO思い
  ceoIntent?: string;

  // MVV
  mvv: {
    mission?: string;
    vision?: string;
    value?: string;
  };

  // SWOT
  swot: {
    strength?: string;
    weakness?: string;
    opportunity?: string;
    threat?: string;
  };

  // ストーリー4章（最終版）
  storyChapters: Array<{
    index: number;
    title: string;
    content: string;
  }>;

  // 勝ち筋
  winPatterns: Array<{
    id: string;
    name: string;
    valueDrivers?: string[];
  }>;

  // North Star メトリクス（業績目標）
  companyTargets: Array<{
    label: string;
    unit: string;
    baseValue?: number;
    rationale?: string;
  }>;
}

/**
 * STAGE2 レポートデータを構築
 */
export function buildStage2ReportData(state: StrategyState): Stage2ReportData {
  const now = new Date();
  const generatedDate = now.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return {
    companyName: state.companyName || '（会社名未入力）',
    generatedDate,
    ceoIntent: (state as any)?.ceoIntent,
    mvv: extractMVV(state),
    swot: extractSWOT(state),
    storyChapters: extractStoryChapters(state),
    winPatterns: extractWinPatterns(state),
    companyTargets: extractCompanyTargets(state),
  };
}

/**
 * MVV を抽出
 */
function extractMVV(state: StrategyState): Stage2ReportData['mvv'] {
  return {
    mission: state.mission,
    vision: state.vision,
    value: state.value,
  };
}

/**
 * SWOT を抽出
 */
function extractSWOT(state: StrategyState): Stage2ReportData['swot'] {
  return {
    strength: state.strength,
    weakness: state.weakness,
    opportunity: state.opportunity,
    threat: state.threat,
  };
}

/**
 * ストーリー4章を抽出（最終版優先）
 */
function extractStoryChapters(state: StrategyState): Stage2ReportData['storyChapters'] {
  // finalStoryFinal > finalStoryEdited > finalStoryDraft > finalStory の優先順位
  const finalStoryFinal = (state as any)?.finalStoryFinal;
  const finalStoryEdited = (state as any)?.finalStoryEdited;
  const finalStoryDraft = (state as any)?.finalStoryDraft;
  const finalStory = (state as any)?.finalStory;

  const storyToUse = finalStoryFinal || finalStoryEdited || finalStoryDraft || finalStory;

  if (Array.isArray(storyToUse)) {
    return storyToUse
      .map((ch: any, idx: number) => ({
        index: idx + 1,
        title: ch?.title || `第${idx + 1}章`,
        content: ch?.body || ch?.content || '（未入力）',
      }))
      .slice(0, 4);
  }

  return [];
}

/**
 * 勝ち筋を抽出
 */
function extractWinPatterns(state: StrategyState): Stage2ReportData['winPatterns'] {
  const winPatterns = (state as any)?.winPatternsCandidate;
  if (!Array.isArray(winPatterns)) {
    return [];
  }

  return winPatterns
    .filter((wp: any) => wp && wp.name)
    .map((wp: any) => ({
      id: wp.id || wp.name,
      name: wp.name,
      valueDrivers: Array.isArray(wp.valueDrivers) ? wp.valueDrivers : undefined,
    }))
    .slice(0, 3);
}

/**
 * 業績目標（Company Targets）を抽出
 */
function extractCompanyTargets(state: StrategyState): Stage2ReportData['companyTargets'] {
  const targets = (state as any)?.companyTargets;
  if (!Array.isArray(targets)) {
    return [];
  }

  return targets
    .filter((t: any) => t && t.label)
    .map((t: any) => ({
      label: t.label || '（未入力）',
      unit: t.unit || '',
      baseValue: t.base,
      rationale: t.rationale,
    }))
    .slice(0, 10);
}
