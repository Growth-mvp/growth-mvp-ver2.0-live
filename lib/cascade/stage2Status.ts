import { formatCompanyStrategy } from '@/lib/cascade/stage3Adjustment';
import { sameChapters, toConfirmedEdits } from '@/lib/stage2/finalDocument';

type AnyRecord = Record<string, unknown>;

export type Stage2Status =
  | { status: 'confirmed'; companyStrategy: string; pendingChanges: boolean }
  | { status: 'not_confirmed' }
  | { status: 'story_missing' };

const storyChapters = (value: unknown): Array<{ title: string; body: string }> =>
  Array.isArray(value)
    ? value
        .map((c) => ({
          title: String((c as AnyRecord)?.title ?? '').trim(),
          body: String((c as AnyRecord)?.body ?? '').trim(),
        }))
        .filter((c) => c.title || c.body)
    : [];

/**
 * STAGE2の確定状態を判定する（STAGE2画面と新STAGE3で共通の基準）。
 * - 確定版（final_story_final）が無ければ未確定。AI草案（finalStoryDraft / finalStoryEdited）だけでは確定扱いにしない。
 * - 確定版があれば確定済み。確定記録（confirmed）があれば、結論・前提はその値を使う。
 * - 確定記録があるのに確定版が無い場合は「本文欠落」（未確定とは区別する）。
 * - 編集中の章が確定版と異なる場合は、確定済みのまま pendingChanges で未確定の変更を伝える。
 */
export function stage2StatusOf(
  edits: unknown,
  finalStoryFinal: unknown,
  finalStoryEdited?: unknown,
): Stage2Status {
  const record = (edits && typeof edits === 'object' ? edits : undefined) as AnyRecord | undefined;
  const story = storyChapters(finalStoryFinal);
  const hasRecord = !!record?.confirmed && typeof record.confirmed === 'object';
  if (story.length === 0) return { status: hasRecord ? 'story_missing' : 'not_confirmed' };

  const confirmed = toConfirmedEdits(record as never) ?? {};
  const conclusion = confirmed.conclusion ?? (typeof record?.conclusion === 'string' ? record.conclusion : '');
  const edited = storyChapters(finalStoryEdited);
  return {
    status: 'confirmed',
    companyStrategy: formatCompanyStrategy({
      conclusion,
      assumptions: confirmed.assumptions,
      story,
    }),
    pendingChanges: edited.length > 0 && !sameChapters(edited, story),
  };
}
