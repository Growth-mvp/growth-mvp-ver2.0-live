import type { ConsultFocus } from '@/lib/consult/consultFocus';
import { DRAFT_CHAPTER_HEADINGS } from '@/lib/stage2/draftStoryView';
import type { Stage2DeepDive, StoryChapter } from '@/types/strategy';

/*
 * STAGE2 の画面を CEOチャットの相談文脈に変換する純粋関数。
 * 上限は lib/consult/consultFocus.ts の ConsultFocusSchema の入力上限に合わせる。
 * 上限を超えると文脈全体が検証で落ちるため、ここで必ず切り詰める。
 */
const LIMIT = {
  section: 80,
  label: 80,
  value: 600,
  draft: 1200,
} as const;

type Focus = Omit<ConsultFocus, 'pathname'>;
type Item = NonNullable<Focus['items']>[number];

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

/** 空の見出しで検証が落ちないよう、ラベルは必ず1文字以上にする */
const labelOf = (s: string | undefined, fallback: string) => clip(s?.trim() || fallback, LIMIT.label);

/* ===================================================
 * SWOT分析（owner: stage2-swot）
 * =================================================== */
export function buildSwotConsultFocus(input: {
  strength: string;
  weakness: string;
  opportunity: string;
  threat: string;
  saved: boolean;
}): Focus {
  const { saved } = input;
  return {
    stage: 2,
    section: 'SWOT分析',
    items: [
      { label: 'Strength（強み）', value: clip(input.strength, LIMIT.value), saved },
      { label: 'Weakness（弱み）', value: clip(input.weakness, LIMIT.value), saved },
      { label: 'Opportunity（機会）', value: clip(input.opportunity, LIMIT.value), saved },
      { label: 'Threat（脅威）', value: clip(input.threat, LIMIT.value), saved },
    ],
  };
}

/* ===================================================
 * 12問＋たたき台（owner: stage2-questions）
 * - draft は選択中の回答（正式な保存状態つき）
 * - items は入力済み件数・選択中の深掘り（あれば）・たたき台の章の要点
 * =================================================== */
export function buildQuestionsConsultFocus(input: {
  question: { id: string; title: string; intent?: string };
  answer: string;
  answeredCount: number;
  total: number;
  deepDive?: Stage2DeepDive;
  storyDraft: StoryChapter[];
  saved: boolean;
}): Focus {
  const { saved } = input;
  const items: Item[] = [{ label: '入力済み', value: `${input.answeredCount}/${input.total}`, saved }];

  if (input.deepDive) {
    items.push({ label: 'AI深掘りの問い', value: clip(input.deepDive.question ?? '', LIMIT.value), saved });
    items.push({ label: 'AI深掘りへの回答', value: clip(input.deepDive.answer ?? '', LIMIT.value), saved });
  }

  input.storyDraft.slice(0, 4).forEach((chapter, i) => {
    items.push({
      label: labelOf(DRAFT_CHAPTER_HEADINGS[i] ?? chapter.title, `第${i + 1}章`),
      value: clip(chapter.body ?? '', LIMIT.value),
      saved,
    });
  });

  return {
    stage: 2,
    section: 'たたき台と戦略を掘り下げる議論のテーマ',
    question: { id: input.question.id, title: input.question.title, intent: input.question.intent },
    draft: { text: clip(input.answer, LIMIT.draft), saved },
    items,
  };
}

/* ===================================================
 * 経営戦略書（owner: stage2-final-document）
 * - 編集中の本文（章・結論）は draft に、結論・確定状態・章の要点は items に
 * - 編集モード中の本文は「保存」を押すまで正式データに含まれないため saved=false
 * =================================================== */
export type StoryEditTarget = { kind: 'chapter'; index: number } | { kind: 'conclusion' } | null;

export function buildFinalDocumentConsultFocus(input: {
  editing: boolean;
  /** 編集中は編集内容（editingStory）、表示中は表示対象の章 */
  chapters: StoryChapter[];
  conclusion: string;
  finalized: boolean;
  /** 表示中の内容が正式に保存済みか（編集中は使わない） */
  saved: boolean;
  lastEdited: StoryEditTarget;
}): Focus | null {
  if (!input.editing && input.chapters.length === 0) return null;

  const saved = input.editing ? false : input.saved;
  const items: Item[] = [
    { label: '結論', value: clip(input.conclusion, LIMIT.value), saved },
    { label: '確定状態', value: input.finalized ? '確定済み' : '未確定', saved },
    ...input.chapters.slice(0, 4).map((chapter, i) => ({
      label: labelOf(chapter.title, `第${i + 1}章`),
      value: clip(chapter.body ?? '', LIMIT.value),
      saved,
    })),
  ];

  let section = input.editing ? '経営戦略書（本文を編集中）' : '経営戦略書';
  let draft: Focus['draft'];
  const last = input.lastEdited;
  if (input.editing && last?.kind === 'chapter' && input.chapters[last.index]) {
    const chapter = input.chapters[last.index];
    section = `経営戦略書（編集中：${chapter.title}）`;
    draft = { text: clip(chapter.body ?? '', LIMIT.draft), saved: false };
  } else if (input.editing && last?.kind === 'conclusion') {
    section = '経営戦略書（編集中：結論）';
    draft = { text: clip(input.conclusion, LIMIT.draft), saved: false };
  }

  return {
    stage: 2,
    section: clip(section, LIMIT.section),
    draft,
    items,
  };
}
