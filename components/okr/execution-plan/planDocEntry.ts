/* 画面に出す1件の草案の状態。保存・読み込み・採用・開始・競合の結果を、ここで画面の状態へ変換する（純粋関数）。 */
import type { UserEdits } from '@/lib/stage4/plan/mergeUserEdits';
import type { PersistResult, StoredState } from '@/lib/stage4/plan/persistDraft';
import type { AdoptionInfo, PlanDocEvent, PlanDocRecord, StartInfo } from '@/lib/stage4/plan/planDocumentStore';
import { EMPTY_REGULATORY, regulatoryComplete, type RegulatoryRecord } from '@/lib/stage4/planView/model';
import { INITIAL_PLAN_STATE, type ProjectPlanState } from '@/lib/stage4/planView/planState';
import type { Edits } from '@/lib/stage4/planView/documentModel';
import { listEditableItems } from '@/lib/stage4/planView/regen';

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

/* サーバーが持つ記録（採用・開始・規制・操作履歴）。ブラウザ内の保存先では無い */
export type ServerState = {
  status: string;
  adoption: AdoptionInfo | null;
  startInfo: StartInfo | null;
  regulatory: RegulatoryRecord;
  events: PlanDocEvent[];
};

export type PlanDocEntry = {
  /** AIが作った草案（作成後は変えない） */
  aiDraft: Record<string, unknown>;
  /** 保存済みの版（未保存なら null） */
  stored: StoredState | null;
  plan: ProjectPlanState;
  view: 'document' | 'start';
  save: SaveView;
  server: ServerState | null;
  /** 直近の操作の結果（採用・開始の失敗など、利用者に伝える文言） */
  notice: string | null;
};

const serverOf = (record: PlanDocRecord): ServerState => ({
  status: record.status ?? 'DRAFT',
  adoption: record.adoption ?? null,
  startInfo: record.startInfo ?? null,
  regulatory: record.regulatory ?? EMPTY_REGULATORY,
  events: record.events ?? [],
});

export const entryFromDraft = (aiDraft: Record<string, unknown>): PlanDocEntry => ({
  aiDraft,
  stored: null,
  plan: INITIAL_PLAN_STATE,
  view: 'document',
  save: { status: 'IDLE' },
  server: null,
  notice: null,
});

export const entryFromRecord = (record: PlanDocRecord): PlanDocEntry => ({
  aiDraft: record.aiDraft,
  stored: { version: record.version, base: record.userEdits, adopted: record.adopted },
  plan: {
    ...INITIAL_PLAN_STATE,
    committed: toEdits(record.userEdits),
    adopted: record.adopted,
    started: record.startInfo != null,
    regulatory: record.regulatory ?? EMPTY_REGULATORY,
  },
  view: 'document',
  save: { status: 'SAVED', version: record.version, mergedFromRemote: false },
  server: serverOf(record),
  notice: null,
});

/* サーバーが受け付けた操作の結果で、画面の状態を置き換える（採用・開始・規制の記録） */
export function entryAfterTransition(entry: PlanDocEntry, record: PlanDocRecord, notice: string | null = null): PlanDocEntry {
  return {
    ...entry,
    aiDraft: record.aiDraft,
    stored: { version: record.version, base: record.userEdits, adopted: record.adopted },
    plan: {
      ...entry.plan,
      committed: toEdits(record.userEdits),
      adopted: record.adopted,
      started: record.startInfo != null,
      regulatory: record.regulatory ?? EMPTY_REGULATORY,
    },
    save: { status: 'SAVED', version: record.version, mergedFromRemote: false },
    server: serverOf(record),
    notice,
  };
}

const SAVE_RESET_NOTICE = '修正を保存したため、採用・規制の判断・実行開始を解除しました。内容を確認してから、改めて採用してください。';

/* 保存すると、サーバーが採用・規制の判断・実行開始を解除する（利用者の修正が変わり、かつ記録が残っている） */
export function saveWillReset(entry: PlanDocEntry): boolean {
  if (!entry.stored) return false;
  const changed = canonicalJson(entry.plan.committed) !== canonicalJson(entry.stored.base);
  const recorded = entry.plan.adopted || entry.plan.started || regulatoryComplete(entry.server?.regulatory ?? EMPTY_REGULATORY);
  return changed && recorded;
}

export function entryAfterPersist(entry: PlanDocEntry, result: PersistResult): PlanDocEntry {
  if (result.status === 'SAVED') {
    const { record } = result;
    const wasRecorded = entry.plan.adopted || entry.plan.started || regulatoryComplete(entry.server?.regulatory ?? EMPTY_REGULATORY);
    const isRecorded = record.adopted || record.startInfo != null || regulatoryComplete(record.regulatory ?? EMPTY_REGULATORY);
    return {
      ...entry,
      stored: result.stored,
      plan: {
        ...entry.plan,
        ...(result.mergedFromRemote ? { committed: toEdits(record.userEdits) } : {}),
        adopted: record.adopted,
        started: record.startInfo != null,
        regulatory: record.regulatory ?? EMPTY_REGULATORY,
      },
      save: { status: 'SAVED', version: record.version, mergedFromRemote: result.mergedFromRemote },
      server: serverOf(record),
      notice: wasRecorded && !isRecorded ? SAVE_RESET_NOTICE : null,
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

/* 項目の順は保存先（jsonb）で変わるため、順を揃えて比べる */
const canonicalJson = (value: unknown): string => {
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted);
    if (!v || typeof v !== 'object') return v;
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, sorted(x)])
    );
  };
  return JSON.stringify(sorted(value));
};

/* 保存されていない修正（または採用の変更）があるか */
export function isDirty(entry: PlanDocEntry): boolean {
  if (!entry.stored) return true;
  return canonicalJson(entry.plan.committed) !== canonicalJson(entry.stored.base) || entry.plan.adopted !== entry.stored.adopted;
}

/* 計画書の本文に未保存の修正があるか。実行責任者は、開始の操作の中で保存するため、ここには含めない */
export function isBodyDirty(entry: PlanDocEntry): boolean {
  if (!entry.stored) return true;
  const body = (e: Record<string, unknown>) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'responsible'));
  return (
    canonicalJson(body(entry.plan.committed as Record<string, unknown>)) !== canonicalJson(body(entry.stored.base as Record<string, unknown>)) ||
    entry.plan.adopted !== entry.stored.adopted
  );
}

/* 画面に出す実行責任者（保存された内容）。未設定は空文字 */
export function responsibleOf(entry: PlanDocEntry): string {
  const v = (entry.plan.committed as Record<string, unknown>).responsible;
  return typeof v === 'string' ? v : '';
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
