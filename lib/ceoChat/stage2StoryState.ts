/* STAGE2の戦略ストーリーの保存状態を、確定版・草案・編集中の内容に分けて示す（読み取りのみ）。
 * 確定版（finalStoryFinal）が現在有効な確定版。草案と編集中の内容は、確定するまで有効ではない。 */
type Chapter = { title?: unknown; body?: unknown };

const chaptersOf = (v: unknown): Chapter[] | null => (Array.isArray(v) && v.length > 0 ? (v as Chapter[]) : null);
const signature = (chapters: Chapter[]): string =>
  JSON.stringify(chapters.map((c) => [String(c?.title ?? ''), String(c?.body ?? '')]));

export function buildStage2StoryStateBlock(strategy: Record<string, unknown> | null | undefined): string {
  const confirmed = chaptersOf(strategy?.finalStoryFinal);
  const draft = chaptersOf(strategy?.finalStoryDraft);
  const edited = chaptersOf(strategy?.finalStoryEdited);
  const unconfirmed = edited ?? draft;

  const lines = [
    '【STAGE2 戦略ストーリーの保存状態（区別して答える）】',
    `- 現在有効な確定版：${confirmed ? `あり（${confirmed.length}章。確定した内容）` : 'なし（まだ確定していない）'}`,
    `- 現在の草案：${draft ? `あり（${draft.length}章。未確定。確定版ではない）` : 'なし'}`,
    `- 編集中の内容：${edited ? `あり（${edited.length}章。未確定）` : 'なし'}`,
  ];
  if (confirmed && unconfirmed) {
    lines.push(
      signature(confirmed) === signature(unconfirmed)
        ? '- 未確定の内容は、確定版と同じ内容。'
        : '- 未確定の内容は確定版と異なる。前回の確定版を「最新の戦略」と説明せず、未確定の草案を「確定した戦略」と説明しない。',
    );
  }
  const source = confirmed
    ? '現在有効な確定版（前回確定した内容）'
    : unconfirmed
      ? '未確定の草案（確定版はない）'
      : 'なし';
  lines.push(`- 下の【戦略ストーリー要約】は、${source}の内容。`);
  return lines.join('\n');
}
