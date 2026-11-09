/* 実行計画書（草案）の保存の契約。永続化の実装（DB・API）はこの契約に従う。
 * ここにはメモリ実装を置き、保存・再読込・競合・権限の振る舞いを、DBに接続せずに確かめる。
 * キーは会社・戦略・プロジェクトID（安定ID）。配列位置や名称は使わない。版番号による楽観ロックを行う。 */
import { ALLOWED_ROLES, stableIdOf, type StrategyRow } from './projectResolver';
import type { UserEdits } from './mergeUserEdits';

export type PlanDocKey = { companyId: string; strategyId: string; projectId: string };

export type PlanDocRecord = {
  key: PlanDocKey;
  version: number;
  /** AIが作った草案（作成後は変えない） */
  aiDraft: Record<string, unknown>;
  /** 利用者が修正した項目（項目ID → 値） */
  userEdits: UserEdits;
  adopted: boolean;
  updatedAt: string;
  updatedBy: string;
};

export type PlanDocActor = { userId: string; memberships: Array<{ companyId: string; role: string }> };

export type LoadOutcome =
  | { status: 'FOUND'; record: PlanDocRecord }
  | { status: 'NONE' }
  | { status: 'DENIED' }
  | { status: 'FAILED'; message: string };

export type WriteOutcome =
  | { status: 'SAVED'; record: PlanDocRecord }
  | { status: 'CONFLICT'; current: PlanDocRecord }
  | { status: 'NOT_FOUND' }
  | { status: 'DENIED' }
  | { status: 'FAILED'; message: string };

export interface PlanDocumentStore {
  load(actor: PlanDocActor, key: PlanDocKey): Promise<LoadOutcome>;
  create(actor: PlanDocActor, key: PlanDocKey, input: { aiDraft: Record<string, unknown>; userEdits: UserEdits; adopted: boolean }): Promise<WriteOutcome>;
  update(actor: PlanDocActor, key: PlanDocKey, expectedVersion: number, input: { userEdits: UserEdits; adopted: boolean }): Promise<WriteOutcome>;
}

export const SAVE_FAILED_MESSAGE = '保存できませんでした。編集内容はこの画面に残っています。もう一度保存してください。';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const recordId = (key: PlanDocKey) => `${key.companyId}|${key.strategyId}|${key.projectId}`;

/* 会社の所属（許可された役割）と、戦略・プロジェクトが同じ会社のものかを確かめる */
function accessOf(actor: PlanDocActor, key: PlanDocKey, strategies: StrategyRow[]): 'OK' | 'DENIED' | 'NO_PROJECT' {
  const member = actor.memberships.some((m) => m.companyId === key.companyId && ALLOWED_ROLES.includes(m.role));
  if (!member) return 'DENIED';
  const strategy = strategies.find((s) => String(s.id) === key.strategyId && String(s.company_id) === key.companyId);
  if (!strategy) return 'DENIED';
  const departments = Array.isArray(strategy.departments) ? (strategy.departments as Array<{ projects?: unknown }>) : [];
  const hit = departments.some((d) =>
    (Array.isArray(d?.projects) ? (d.projects as Array<Record<string, unknown>>) : []).some((p) => stableIdOf(p) === key.projectId)
  );
  return hit ? 'OK' : 'NO_PROJECT';
}

export type MemoryStorage = { read: () => string | null; write: (value: string) => void };

export type MemoryPlanDocumentStore = PlanDocumentStore & {
  /** 次に失敗させる操作（テスト・検証用）。1回だけ失敗する */
  failNext(op: 'load' | 'write'): void;
  /** 他の利用者が、指定した項目だけを変えて保存した場合を再現する（版番号を上げる） */
  simulateRemoteSave(key: PlanDocKey, changes: UserEdits, byUserId: string): PlanDocRecord | null;
  records(): PlanDocRecord[];
};

export function createMemoryPlanDocumentStore(opts: {
  getStrategies: () => StrategyRow[];
  now: () => string;
  storage?: MemoryStorage;
}): MemoryPlanDocumentStore {
  const parse = (raw: string | null | undefined): Map<string, PlanDocRecord> => {
    const map = new Map<string, PlanDocRecord>();
    if (!raw) return map;
    for (const r of JSON.parse(raw) as PlanDocRecord[]) map.set(recordId(r.key), r);
    return map;
  };
  const records = parse(opts.storage?.read());
  const pending = new Set<'load' | 'write'>();
  const persist = () => opts.storage?.write(JSON.stringify([...records.values()]));

  const takeFailure = (op: 'load' | 'write'): boolean => {
    if (!pending.has(op)) return false;
    pending.delete(op);
    return true;
  };

  return {
    async load(actor, key) {
      if (takeFailure('load')) return { status: 'FAILED', message: '読み込めませんでした。もう一度開いてください。' };
      const access = accessOf(actor, key, opts.getStrategies());
      if (access === 'DENIED') return { status: 'DENIED' };
      if (access === 'NO_PROJECT') return { status: 'NONE' };
      const found = records.get(recordId(key));
      return found ? { status: 'FOUND', record: clone(found) } : { status: 'NONE' };
    },

    async create(actor, key, input) {
      if (takeFailure('write')) return { status: 'FAILED', message: SAVE_FAILED_MESSAGE };
      const access = accessOf(actor, key, opts.getStrategies());
      if (access !== 'OK') return access === 'DENIED' ? { status: 'DENIED' } : { status: 'NOT_FOUND' };
      const existing = records.get(recordId(key));
      if (existing) return { status: 'CONFLICT', current: clone(existing) };
      const record: PlanDocRecord = {
        key: { ...key },
        version: 1,
        aiDraft: clone(input.aiDraft),
        userEdits: clone(input.userEdits),
        adopted: input.adopted,
        updatedAt: opts.now(),
        updatedBy: actor.userId,
      };
      records.set(recordId(key), record);
      persist();
      return { status: 'SAVED', record: clone(record) };
    },

    async update(actor, key, expectedVersion, input) {
      if (takeFailure('write')) return { status: 'FAILED', message: SAVE_FAILED_MESSAGE };
      const access = accessOf(actor, key, opts.getStrategies());
      if (access !== 'OK') return access === 'DENIED' ? { status: 'DENIED' } : { status: 'NOT_FOUND' };
      const current = records.get(recordId(key));
      if (!current) return { status: 'NOT_FOUND' };
      if (current.version !== expectedVersion) return { status: 'CONFLICT', current: clone(current) };
      const next: PlanDocRecord = {
        ...current,
        version: current.version + 1,
        userEdits: clone(input.userEdits),
        adopted: input.adopted,
        updatedAt: opts.now(),
        updatedBy: actor.userId,
      };
      records.set(recordId(key), next);
      persist();
      return { status: 'SAVED', record: clone(next) };
    },

    failNext(op) {
      pending.add(op);
    },

    simulateRemoteSave(key, changes, byUserId) {
      const current = records.get(recordId(key));
      if (!current) return null;
      const next: PlanDocRecord = { ...current, version: current.version + 1, userEdits: clone({ ...current.userEdits, ...changes }), updatedAt: opts.now(), updatedBy: byUserId };
      records.set(recordId(key), next);
      persist();
      return clone(next);
    },

    records() {
      return [...records.values()].map((r) => clone(r));
    },
  };
}
