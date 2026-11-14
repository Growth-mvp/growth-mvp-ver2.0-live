export type RecordKind = 'feedback' | 'share';

export function recordKindOf(cleanContent: string): RecordKind {
  return cleanContent.startsWith('[FB]') ? 'feedback' : 'share';
}

/** 編集・削除できるのは投稿者本人だけ。フィードバックは現在もフィードバックを書ける権限者に限る。 */
export function canEditRecord(args: {
  kind: RecordKind;
  rowUserId?: string | null;
  viewerUserId?: string | null;
  canFeedback: boolean;
}): boolean {
  const viewer = (args.viewerUserId ?? '').trim();
  const author = (args.rowUserId ?? '').trim();
  if (!viewer || viewer !== author) return false;
  return args.kind === 'share' || args.canFeedback;
}
