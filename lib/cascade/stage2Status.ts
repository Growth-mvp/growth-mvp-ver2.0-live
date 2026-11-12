import { formatCompanyStrategy } from '@/lib/cascade/stage3Adjustment';
import { toConfirmedEdits } from '@/lib/stage2/finalDocument';

type AnyRecord = Record<string, unknown>;

export type Stage2Status =
  | { status: 'confirmed'; companyStrategy: string }
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
 * STAGE2の確定状態を判定する（新STAGE3の唯一の判定）。
 * - 確定記録（stage2_final_document_edits.confirmed）があり、確定版の本文（final_story_final）もあれば「確定済み」。
 *   結論は空でもよい（結論が手入力もAI生成もなければ、確定記録の結論は空になる）。
 * - 確定記録がない下書きだけ（draftChangedAt のみ）は「未確定」。
 * - 旧データで確定記録がなく本文だけがある場合は、STAGE2画面と同じく確定版として扱う。
 * - 確定記録があるのに本文がない場合は「本文欠落」（未確定とは区別する）。
 * 確定していない戦略を確定扱いにはしない。
 */
export function stage2StatusOf(edits: unknown, finalStoryFinal: unknown): Stage2Status {
  const record = (edits && typeof edits === 'object' ? edits : undefined) as AnyRecord | undefined;
  const story = storyChapters(finalStoryFinal);
  const hasRecord = !!record?.confirmed && typeof record.confirmed === 'object';
  const legacyConfirmed = !record?.confirmed && !record?.draftChangedAt && story.length > 0;
  if (!hasRecord && !legacyConfirmed) return { status: 'not_confirmed' };
  if (story.length === 0) return { status: 'story_missing' };

  const confirmed = toConfirmedEdits(record as never) ?? {};
  const conclusion = confirmed.conclusion ?? (typeof record?.conclusion === 'string' ? record.conclusion : '');
  return {
    status: 'confirmed',
    companyStrategy: formatCompanyStrategy({
      conclusion,
      assumptions: confirmed.assumptions,
      story,
    }),
  };
}
