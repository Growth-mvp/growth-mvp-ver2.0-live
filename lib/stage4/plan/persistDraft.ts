/* 草案の保存の手順。新規作成・版番号つき更新・競合時の統合を行い、結果を「保存できた / 競合 / 失敗」で明確に分けて返す。
 * 失敗や競合のとき、呼び出し側の編集内容は変えない（失わない）。 */
import { mergeUserEdits, type UserEdits } from './mergeUserEdits';
import type { PlanDocActor, PlanDocKey, PlanDocRecord, PlanDocumentStore } from './planDocumentStore';

export type StoredState = { version: number; base: UserEdits; adopted: boolean };

export type PersistResult =
  | { status: 'SAVED'; stored: StoredState; userEdits: UserEdits; adopted: boolean; mergedFromRemote: boolean }
  | { status: 'CONFLICT'; conflicts: string[]; remote: PlanDocRecord; local: UserEdits; adopted: boolean }
  | { status: 'FAILED'; message: string }
  | { status: 'DENIED' };

const toSaved = (record: PlanDocRecord, mergedFromRemote: boolean): PersistResult => ({
  status: 'SAVED',
  stored: { version: record.version, base: record.userEdits, adopted: record.adopted },
  userEdits: record.userEdits,
  adopted: record.adopted,
  mergedFromRemote,
});

export async function persistDraft(args: {
  store: PlanDocumentStore;
  actor: PlanDocActor;
  key: PlanDocKey;
  aiDraft: Record<string, unknown>;
  local: UserEdits;
  adopted: boolean;
  stored: StoredState | null;
}): Promise<PersistResult> {
  const { store, actor, key, local, adopted } = args;

  if (!args.stored) {
    const out = await store.create(actor, key, { aiDraft: args.aiDraft, userEdits: local, adopted });
    if (out.status === 'SAVED') return toSaved(out.record, false);
    if (out.status === 'CONFLICT') {
      const { conflicts } = mergeUserEdits({}, local, out.current.userEdits);
      return { status: 'CONFLICT', conflicts, remote: out.current, local, adopted };
    }
    if (out.status === 'DENIED') return { status: 'DENIED' };
    if (out.status === 'NOT_FOUND') return { status: 'FAILED', message: 'プロジェクトが見つからないため、保存できませんでした。' };
    return { status: 'FAILED', message: out.message };
  }

  const first = await store.update(actor, key, args.stored.version, { userEdits: local, adopted });
  if (first.status === 'SAVED') return toSaved(first.record, false);
  if (first.status === 'DENIED') return { status: 'DENIED' };
  if (first.status === 'NOT_FOUND') return { status: 'FAILED', message: '保存先が見つからないため、保存できませんでした。' };
  if (first.status === 'FAILED') return { status: 'FAILED', message: first.message };

  const { merged, conflicts } = mergeUserEdits(args.stored.base, local, first.current.userEdits);
  if (conflicts.length > 0) return { status: 'CONFLICT', conflicts, remote: first.current, local, adopted };

  const retry = await store.update(actor, key, first.current.version, { userEdits: merged, adopted });
  if (retry.status === 'SAVED') return toSaved(retry.record, true);
  if (retry.status === 'CONFLICT') return { status: 'CONFLICT', conflicts: [], remote: retry.current, local, adopted };
  if (retry.status === 'DENIED') return { status: 'DENIED' };
  if (retry.status === 'FAILED') return { status: 'FAILED', message: retry.message };
  return { status: 'FAILED', message: 'プロジェクトが見つからないため、保存できませんでした。' };
}
