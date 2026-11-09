/* 画面に出す1件の草案の状態。保存・読み込み・競合の結果を、ここで画面の状態へ変換する（純粋関数）。 */
import type { UserEdits } from '@/lib/stage4/plan/mergeUserEdits';
import type { PersistResult, StoredState } from '@/lib/stage4/plan/persistDraft';
import type { PlanDocRecord } from '@/lib/stage4/plan/planDocumentStore';
import { INITIAL_PLAN_STATE, type ProjectPlanState } from '@/lib/stage4/planView/planState';
import { listEditableItems } from '@/lib/stage4/planView/regen';
import type { Edits } from '@/lib/stage4/planView/documentModel';

export const toEdits = (edits: UserEdits): Edits => edits as Edits;

export type SaveView =
  | { status: 'IDLE' }
  | { status: 'SAVING' }
  | { status: 'SAVED'; version: number; mergedFromRemote: boolean }
  | { status: 'FAILED'; message: string }
  | { status: 'DENIED' }
  | {
      status: 'CONFLICT';
      conflicts: string[];
      remote: PlanDocRecord;
      local: UserEdits;
      picks: Record<string, 'local' | 'remote'>;
    };

export type PlanDocEntry = {
  /** AIが作った草案（作成後は変えない） */
  aiDraft: Record<string, unknown>;
  /** 保存済みの版（未保存なら null） */
  stored: StoredState | null;
  plan: ProjectPlanState;
  view: 'document' | 'start';
  save: SaveView;
};

export const entryFromDraft = (aiDraft: Record<string, unknown>): PlanDocEntry => ({
  aiDraft,
  stored: null,
  plan: INITIAL_PLAN_STATE,
  view: 'document',
  save: { status: 'IDLE' },
});

export const entryFromRecord = (record: PlanDocRecord): PlanDocEntry => ({
  aiDraft: record.aiDraft,
  stored: { version: record.version, base: record.userEdits, adopted: record.adopted },
  plan: { ...INITIAL_PLAN_STATE, committed: toEdits(record.userEdits), adopted: record.adopted },
  view: 'document',
  save: { status: 'SAVED', version: record.version, mergedFromRemote: false },
});

export function entryAfterPersist(entry: PlanDocEntry, result: PersistResult): PlanDocEntry {
  if (result.status === 'SAVED') {
    return {
      ...entry,
      stored: result.stored,
      plan: result.mergedFromRemote ? { ...entry.plan, committed: toEdits(result.userEdits), adopted: result.adopted } : { ...entry.plan, adopted: result.adopted },
      save: { status: 'SAVED', version: result.stored.version, mergedFromRemote: result.mergedFromRemote },
    };
  }
  if (result.status === 'CONFLICT') {
    return {
      ...entry,
      save: { status: 'CONFLICT', conflicts: result.conflicts, remote: result.remote, local: result.local, picks: {} },
    };
  }
  if (result.status === 'FAILED') return { ...entry, save: { status: 'FAILED', message: result.message } };
  return { ...entry, save: { status: 'DENIED' } };
}

/* 保存されていない修正（または採用の変更）があるか */
export function isDirty(entry: PlanDocEntry): boolean {
  if (!entry.stored) return true;
  return JSON.stringify(entry.plan.committed) !== JSON.stringify(entry.stored.base) || entry.plan.adopted !== entry.stored.adopted;
}

export type ConflictRow = { key: string; label: string; yours: string; theirs: string };

/* 競合の項目を、画面に出せる文言にする（元の草案の値は、修正が無い側の表示に使う） */
export function conflictRows(entry: PlanDocEntry): ConflictRow[] {
  const save = entry.save;
  if (save.status !== 'CONFLICT') return [];
  const bundle = entry.aiDraft as { rawOutput?: unknown; plan?: unknown };
  const draft = typeof bundle.rawOutput === 'string' ? JSON.parse(bundle.rawOutput) : bundle.plan;
  const items = draft ? listEditableItems(draft) : [];
  const text = (v: unknown) => (v === undefined || v === null || v === '' ? '（空欄）' : String(v));
  return save.conflicts.map((key) => {
    const item = items.find((i) => i.itemId === key);
    return {
      key,
      label: item ? `${item.label}：${item.text}` : key,
      yours: text(save.local[key] ?? item?.value),
      theirs: text(save.remote.userEdits[key] ?? item?.value),
    };
  });
}
