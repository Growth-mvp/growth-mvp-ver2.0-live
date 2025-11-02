// /lib/agent/context.ts
'use server';

import type { StrategyData, ChapterAnswers, ChapterStory } from '@/types/strategy';
import { supabase } from '@/utils/supabase/client';

export type AgentContext = {
  meta: { strategyId: string };
  mvv: { mission?: string; vision?: string; value?: string };
  swot: { strength?: string; weakness?: string; opportunity?: string; threat?: string };
  draftChapters: ChapterStory[];
  finalChapters: ChapterStory[];
  answers2: ChapterAnswers[];
  okrProgress: Array<{ okrId: string; content: string; createdAt: string }>;
};

const safeArray = <T,>(v: any): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * 旧 getFullStrategyData の置き換え：
 * - `strategy_data` を strategyId + userId で直接取得（RLSに沿う）
 * - キー名のゆらぎ（finalStory/finalstory 等）を吸収
 * - 進捗ログは `progress_logs` から user_id で抽出し、content を合成
 */
export async function getAgentContext(strategyId: string, userId: string): Promise<AgentContext> {
  // --- 戦略本体の取得 ---
  let strategy: Partial<StrategyData> | null = null;
  try {
    const { data, error } = await supabase
      .from('strategy_data')
      .select('*')
      .eq('id', strategyId)
      .eq('user_id', userId) // 安全側：自分の戦略のみヒット
      .maybeSingle();

    if (error) {
      console.warn('[getAgentContext] strategy_data fetch error:', error);
    }
    strategy = (data as any) ?? null;
  } catch (e) {
    console.error('[getAgentContext] strategy_data fetch failed:', e);
  }

  // 可能性のあるキー名のゆらぎを吸収
  const mission = (strategy as any)?.mission;
  const vision = (strategy as any)?.vision;
  const value = (strategy as any)?.value;

  const strength = (strategy as any)?.strength;
  const weakness = (strategy as any)?.weakness;
  const opportunity = (strategy as any)?.opportunity;
  const threat = (strategy as any)?.threat;

  const storyDraft = safeArray<ChapterStory>((strategy as any)?.story);
  const finalStory =
    safeArray<ChapterStory>((strategy as any)?.finalStory) ||
    safeArray<ChapterStory>((strategy as any)?.finalstory);
  const answers2 = safeArray<ChapterAnswers>((strategy as any)?.answers2);

  // --- 進捗ログ：content列に依存しない実装（合成） ---
  // rating_comment が [FB] で始まる場合はそれを本文に、他は progress_text / help_request / advice を結合
  let okrProgress: Array<{ okrId: string; content: string; createdAt: string }> = [];
  try {
    const { data: logsRaw, error: logsErr } = await supabase
      .from('progress_logs')
      .select('okr_id, progress_text, rating_comment, advice, help_request, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (logsErr) {
      console.warn('[getAgentContext] progress_logs fetch error:', logsErr);
    }

    okrProgress =
      (logsRaw ?? []).map((l: any) => {
        const createdAt = String(l?.created_at ?? '');
        const okrId = String(l?.okr_id ?? '');

        const ratingComment = String(l?.rating_comment ?? '');
        const isFB = ratingComment.startsWith('[FB]');
        if (isFB) {
          const text = ratingComment.replace(/^\[FB]\s*\n?/, '').trim();
          return { okrId, content: text, createdAt };
        }

        const parts = [
          String(l?.progress_text ?? '').trim(),
          String(l?.help_request ?? '').trim(),
          String(l?.advice ?? '').trim(),
        ].filter(Boolean);
        const content = parts.join('\n').trim();

        return { okrId, content, createdAt };
      }) ?? [];
  } catch (e) {
    console.error('[getAgentContext] progress_logs fetch failed:', e);
  }

  return {
    meta: { strategyId },
    mvv: { mission, vision, value },
    swot: { strength, weakness, opportunity, threat },
    draftChapters: storyDraft,
    finalChapters: finalStory,
    answers2,
    okrProgress,
  };
}

export default getAgentContext;
