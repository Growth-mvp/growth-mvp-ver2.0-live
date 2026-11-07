import type { StoryChapter } from '@/types/strategy';

export const FINAL_STORY_CHAPTER_COUNT = 4;
export const FINAL_STORY_PLACEHOLDER_BODY = '（この章は未生成です）';
export const FINAL_STORY_INVALID_MESSAGE =
  '最終ストーリーの生成結果が空または不正だったため、既存の下書きは変更していません。もう一度お試しください。';
export const FINAL_STORY_SAVE_FAILED_MESSAGE =
  '最終ストーリーを保存できませんでした。既存の下書きと編集内容は変更していません。もう一度お試しください。';

function isPersistedFinalStoryDraft(saved: unknown, chapters: StoryChapter[]): boolean {
  const persisted = (saved as { finalStoryDraft?: unknown } | null | undefined)?.finalStoryDraft;
  return (
    Array.isArray(persisted) &&
    persisted.length === chapters.length &&
    chapters.every((ch, i) => persisted[i]?.title === ch.title && persisted[i]?.body === ch.body)
  );
}

export function isValidFinalStoryDraft(value: unknown): value is StoryChapter[] {
  return (
    Array.isArray(value) &&
    value.length === FINAL_STORY_CHAPTER_COUNT &&
    value.every(
      (ch) =>
        typeof ch?.title === 'string' &&
        typeof ch?.body === 'string' &&
        ch.body.trim() !== '' &&
        ch.body !== FINAL_STORY_PLACEHOLDER_BODY,
    )
  );
}

export type FinalStoryDraftSaveResult = { data?: { revision?: number } | null; error: unknown } | null;

export type FinalStoryDraftCommit = {
  chapters: unknown;
  runId: number;
  latestRunId: () => number;
  isScopeCurrent: () => boolean;
  save: () => Promise<FinalStoryDraftSaveResult>;
  onSaved: (revision: number | undefined) => void;
  apply: (chapters: StoryChapter[]) => void;
};

export type FinalStoryDraftCommitOutcome =
  | { status: 'applied' }
  | { status: 'invalid' }
  | { status: 'stale' }
  | { status: 'out_of_scope' }
  | { status: 'not_persisted' }
  | { status: 'save_failed'; error: unknown };

/**
 * 生成結果を保存し、今回の下書きが保存結果に含まれることを確認できた場合にだけ画面へ反映する。
 * save が null を返した場合は保存スコープが変わったことを表す。
 * 保存がスキップされた場合は error が null でも data に今回の下書きが含まれないため、保存成功とはみなさない。
 */
export async function commitFinalStoryDraft(input: FinalStoryDraftCommit): Promise<FinalStoryDraftCommitOutcome> {
  if (!isValidFinalStoryDraft(input.chapters)) return { status: 'invalid' };
  if (input.latestRunId() !== input.runId) return { status: 'stale' };

  const result = await input.save();
  if (!input.isScopeCurrent() || result === null) return { status: 'out_of_scope' };
  if (result.error) return { status: 'save_failed', error: result.error };
  if (!isPersistedFinalStoryDraft(result.data, input.chapters)) return { status: 'not_persisted' };

  input.onSaved(result.data?.revision);
  if (input.latestRunId() !== input.runId) return { status: 'stale' };

  input.apply(input.chapters);
  return { status: 'applied' };
}
