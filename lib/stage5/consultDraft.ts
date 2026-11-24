import { z } from 'zod';

/* 右側のAI経営コンサルタントとの相談から作る、STAGE5の社内共有の入力案。
 * 本人の言葉は、相談文の文を原文のまま選んで使う（AIは文を書き換えない）。
 * AIの整理（気づき）は、本人の言葉とは別の補足として扱う。
 * 会話全文は含めず、本人が確認・編集した内容だけを社内共有の入力欄に反映する。 */

const MAX_OWN = 8;
const MAX_PLANNED = 5;
const MAX_INSIGHTS = 3;
const INSIGHT_MAX = 200;

export const consultSelectionSchema = z.object({
  ownSentenceIndexes: z.array(z.number().int().min(0).max(999)).max(20),
  plannedSentenceIndexes: z.array(z.number().int().min(0).max(999)).max(10),
  insights: z.array(z.string().trim().min(1).max(INSIGHT_MAX)).max(MAX_INSIGHTS),
});

export type ConsultSelection = z.infer<typeof consultSelectionSchema>;

export type ConsultDraft = {
  ownWords: string[];
  insights: string[];
  plannedActions: string[];
};

/** 相談文を、文ごとに分ける（文の中身は変えない） */
export function splitSentences(text: string): string[] {
  const matches = text.match(/[^。！？!?\n]+[。！？!?]*/g) ?? [];
  return matches.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** AIが選んだ文番号から、相談文の原文を取り出す。番号以外の内容は入力案に入らない */
export function buildConsultDraft(args: { question: string; selection: unknown }): ConsultDraft | null {
  const parsed = consultSelectionSchema.safeParse(args.selection);
  if (!parsed.success) return null;
  const sentences = splitSentences(args.question);
  const pick = (indexes: number[], max: number): string[] =>
    [...new Set(indexes)]
      .filter((i) => i < sentences.length)
      .sort((a, b) => a - b)
      .slice(0, max)
      .map((i) => sentences[i]);

  const ownWords = pick(parsed.data.ownSentenceIndexes, MAX_OWN);
  if (ownWords.length === 0) return null;
  const plannedActions = pick(parsed.data.plannedSentenceIndexes, MAX_PLANNED).filter((s) => !ownWords.includes(s));
  return { ownWords, insights: parsed.data.insights, plannedActions };
}

export function formatConsultDraft(d: ConsultDraft): string {
  const parts = [`【私が困っていること】\n${d.ownWords.join('')}`];
  if (d.insights.length > 0) {
    parts.push(`【相談して気づいたこと（AIの補足）】\n${d.insights.map((i) => `・${i}`).join('\n')}`);
  }
  if (d.plannedActions.length > 0) {
    parts.push(`【これから試したいこと】\n${d.plannedActions.join('')}`);
  }
  return parts.join('\n\n');
}

/** 入力中の文字を消さないよう、空でなければ区切りを入れて末尾に追記する */
export function appendDraftText(current: string, draft: string): string {
  const base = current.replace(/\s+$/, '');
  if (base.trim() === '') return draft;
  return `${base}\n\n${draft}`;
}

export type DraftTarget = {
  companyId: string;
  strategyId: string;
  departmentId: string;
  projectId: string;
};

/** 反映先（選んでいる案件）と、回答を得た相談の対象が同じか */
export function isSameDraftTarget(a: DraftTarget | null | undefined, b: DraftTarget | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.companyId === b.companyId &&
    a.strategyId === b.strategyId &&
    a.departmentId === b.departmentId &&
    a.projectId === b.projectId
  );
}
