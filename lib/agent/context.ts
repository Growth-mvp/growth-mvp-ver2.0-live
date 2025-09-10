// /lib/agent/context.ts
import type { StrategyData, ChapterAnswers, ChapterStory } from '@/types/strategy';
import { supabase, getFullStrategyData } from '@/utils/supabase';

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

export async function getAgentContext(strategyId: string, userId: string): Promise<AgentContext> {
  // --- 戦略本体は utils/supabase の正規ルートから取得（スキーマ差異を吸収） ---
  const { data: strategy } = await getFullStrategyData(userId, strategyId);

  // 可能性のあるキー名のゆらぎを吸収
  const mission = (strategy as any)?.mission;
  const vision = (strategy as any)?.vision;
  const value  = (strategy as any)?.value;

  const strength   = (strategy as any)?.strength;
  const weakness   = (strategy as any)?.weakness;
  const opportunity= (strategy as any)?.opportunity;
  const threat     = (strategy as any)?.threat;

  const storyDraft = safeArray<ChapterStory>((strategy as any)?.story);
  const finalStory = safeArray<ChapterStory>((strategy as any)?.finalStory ?? (strategy as any)?.finalstory);
  const answers2   = safeArray<ChapterAnswers>((strategy as any)?.answers2);

  // --- 進捗ログ：content列に依存しない実装に変更 ---
  //   rating_comment が [FB] で始まる時はフィードバック本文を表示、
  //   それ以外は progress_text / help_request / advice を合成して “content” を作る。
  const { data: logsRaw } = await supabase
    .from('progress_logs')
    .select('okr_id, progress_text, rating_comment, advice, help_request, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);

  const okrProgress =
    (logsRaw ?? []).map((l: any) => {
      const createdAt = String(l?.created_at ?? '');
      const okrId = String(l?.okr_id ?? '');

      const ratingComment = String(l?.rating_comment ?? '');
      const isFB = ratingComment.startsWith('[FB]');
      if (isFB) {
        // フィードバック行
        const text = ratingComment.replace(/^\[FB]\s*\n?/, '').trim();
        return { okrId, content: text, createdAt };
      }

      // 進捗メモ行（空を除外しつつ結合）
      const parts = [
        String(l?.progress_text ?? '').trim(),
        String(l?.help_request ?? '').trim(),
        String(l?.advice ?? '').trim(),
      ].filter(Boolean);
      const content = parts.join('\n').trim();

      return { okrId, content, createdAt };
    });

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
