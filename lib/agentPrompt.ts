// /lib/agentPrompt.ts
import { StrategyData, ChapterAnswers, ChapterStory } from '@/types/strategy';

function oneLine(str?: string) {
  return (str || '').replace(/\s+/g, ' ').trim();
}

function compactStory(story: ChapterStory[] = []) {
  return story
    .map((c, i) => `第${i + 1}章「${oneLine(c.title)}」: ${oneLine(c.body).slice(0, 240)}…`)
    .join('\n');
}

export function summarizeAnswers2(a2: ChapterAnswers[] = []) {
  return a2.map((c) => ({
    chapterIndex: c.chapterIndex,
    chapterTitle: c.chapterTitle,
    recent: (c.steps ?? [])
      .slice(-2)
      .map((s) => ({ stepNumber: s.stepNumber, q: s.question, a: s.answer })),
  }));
}

export function buildAgentSystemPrompt(
  s: Partial<StrategyData> = {},
  a2: ChapterAnswers[] = [],
  finalStory: ChapterStory[] = []
) {
  const parts: string[] = [];

  parts.push(`あなたは経営者の参謀AI。口調は簡潔・具体・検証的。\n`);

  parts.push(
    `【会社の前提】
業種:${s.industry ?? ''} / 売上:${s.revenue ?? ''} / 従業員:${s.employees ?? ''}
MVV: M=${oneLine(s.mission)} / V=${oneLine(s.vision)} / Va=${oneLine(s.value)}
SWOT: S=${oneLine(s.strength)} / W=${oneLine(s.weakness)} / O=${oneLine(s.opportunity)} / T=${oneLine(s.threat)}`
  );

  if (finalStory?.length) {
    parts.push('【戦略ストーリー要約】\n' + compactStory(finalStory));
  }

  if (a2?.length) {
    parts.push('【直近の掘り下げQA（各章の最新2件）】\n' + JSON.stringify(summarizeAnswers2(a2), null, 2));
  }

  parts.push(`【振る舞い規範】
- 事実/仮説/提案をラベル付け
- 答えは箇条書き→最後に1行サマリ
- 可能なら次アクションを3件提示
- ツールが使えるときは関数呼び出しを提案し、必要データを質問して最小入力で実行`);

  return parts.join('\n\n');
}

// 互換用：defaultでも呼べるように
export default function agentPrompt(
  s?: Partial<StrategyData>,
  a2?: ChapterAnswers[],
  finalStory?: ChapterStory[]
) {
  return buildAgentSystemPrompt(s, a2, finalStory);
}
