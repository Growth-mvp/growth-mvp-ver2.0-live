/* STAGE4→STAGE6 の一連の検証用の永続化ストア（評価専用）。架空の既存効果は入れない（検証の初期状態を空にするため）。
 * flowStore.ts と同じ保存契約に加え、財務計画（csvFinanceData.financePlanAssumptions）を localStorage の
 * `flow:<companyId>` へ保存・再読込する。DB・認証・通信には接続しない。
 * 初回の架空データには、目標年度（2030年度）と、確認済み1件・未確認1件の財務効果を入れる。 */
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector';
import { FICTIONAL_DEPARTMENTS, FICTIONAL_STRATEGY_ROW } from '../../../quality/fictionalCompany';
import { normalizeStrategyData } from '@/utils/supabase/normalize';
import { applyWorkingSnapshot, workingHashOf } from '@/utils/stage6/financePlanSnapshot';

export const COMPANY_SWITCH_SAVE_MESSAGE =
  '会社の切り替え中のため、保存されませんでした。切り替えが完了してから、もう一度保存してください。';
export const COMPANY_SCOPE_MISSING_SAVE_MESSAGE =
  '会社が選択されていないため、保存されませんでした。会社を選択してから、もう一度保存してください。';

export type StrategyState = any;
export type SaveResult = any;
export type FinanceSummaryRow = any;

const w: any = typeof window !== 'undefined' ? window : globalThis;
w.__storeLog = w.__storeLog || [];
w.__saveLog = w.__saveLog || [];

export const MAIN_COMPANY = 'fict-co-a';
export const OTHER_COMPANY = 'FICTIONAL-OTHER';

export const storageKey = (companyId: string): string => `flow:${companyId}`;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

function fixtureDepartments(companyId: string): any[] {
  if (companyId === OTHER_COMPANY) {
    return [{ id: 'other-dept', name: '他社の部門（架空）', projects: [{ id: 'other-proj', title: '他社の施策（架空）', planStatus: 'draft' }] }];
  }
  const deps = clone(FICTIONAL_DEPARTMENTS) as any[];
  return deps;
}

/* 保存データがあれば実際の正規化関数で読み直し、なければ架空データから始める */
function loadCompany(companyId: string): { departments: any[]; revision: number; csvFinanceData: any } {
  const raw = localStorage.getItem(storageKey(companyId));
  if (raw) {
    const parsed = JSON.parse(raw);
    const normalized: any = normalizeStrategyData({ departments: parsed.departments } as any);
    return {
      departments: normalized.departments ?? [],
      revision: Number(parsed.revision ?? 0),
      csvFinanceData: parsed.csvFinanceData ?? {},
    };
  }
  return { departments: fixtureDepartments(companyId), revision: 0, csvFinanceData: {} };
}

const first = loadCompany(MAIN_COMPANY);
w.__flowCompanyId = MAIN_COMPANY;

let state: any = {
  companyId: MAIN_COMPANY,
  strategyId: 'fict-strategy-a',
  hydrated: true,
  restoreReady: true,
  isRestoring: false,
  boot: { isHydrating: false, isHydrated: true, isSaving: false, isRestoring: false },
  lastServerSnapshot: null,
  departments: first.departments,
  revision: first.revision,
  fiscalYearEnd: '3',
  financePL: (FICTIONAL_STRATEGY_ROW as any).financePL,
  financeBS: (FICTIONAL_STRATEGY_ROW as any).financeBS,
  companyTargets: [
    { id: 'rev', label: '売上', unit: '百万円', base: 1200, dueYear: 2030, low: 1100, high: 1300 },
    { id: 'op', label: '営業利益', unit: '百万円', base: 80, dueYear: 2030, low: 70, high: 90 },
  ],
  projectTargetImpacts: [],
  csvFinanceData: first.csvFinanceData,
  financePlanSavedHash: workingHashOf(first.csvFinanceData),
  canEditStrategy: true,
  dirty: false,
  version: 1,
};

const listeners = new Set<(s: any, prev: any) => void>();
function subscribe(l: (s: any, prev: any) => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function setState(partial: any, _replace?: boolean): void {
  const prev = state;
  const next = typeof partial === 'function' ? partial(state) : partial;
  state = { ...state, ...next };
  listeners.forEach((l) => l(state, prev));
}

/* 店舗の操作のうち、状態を変えないものは「呼ばれたこと」だけを記録する */
const ACTION = /^(set|update|add|remove|refetch|reset|save|load|fetch|clear|toggle|apply|upsert|delete|reorder|patch|invalidate|hydrate|commit|mark)/;
const views = new WeakMap<object, any>();
function viewOf(st: any): any {
  let v = views.get(st);
  if (!v) {
    v = new Proxy(st, {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        if (typeof prop === 'string' && ACTION.test(prop)) {
          return (...args: any[]) => {
            w.__storeLog.push({ action: prop, args: args.length });
          };
        }
        return undefined;
      },
    });
    views.set(st, v);
  }
  return v;
}

state.setDepartments = (deps: any) => {
  setState({ departments: typeof deps === 'function' ? deps(state.departments) : deps });
};
state.updateDepartments = (fn: any) => {
  setState({ departments: typeof fn === 'function' ? fn(state.departments) : fn });
};
state.setHydrated = () => {};
state.setCompanyScope = () => {};
state.refetchFromServer = async () => {};

/* 実ストア（store/strategyStore.ts）と同じ：財務計画を csvFinanceData に書き、保存の基準は初回だけ決める */
state.setFinancePlanAssumptions = (snapshot: unknown, options?: { markDirty?: boolean }) => {
  if (!state.companyId) return;
  const markDirty = options?.markDirty ?? true;
  setState({
    csvFinanceData: applyWorkingSnapshot(state.csvFinanceData, snapshot),
    financePlanSavedHash: state.financePlanSavedHash ?? workingHashOf(state.csvFinanceData),
    ...(markDirty ? { dirty: true, version: (state.version ?? 0) + 1 } : {}),
  });
};

/* 部分更新の結果を反映する（実ストアと同じ契約：未保存の変更がある間は反映しない） */
state.syncPartialSave = ({ departments, revision }: { departments: any[]; revision: number }) => {
  if (state.dirty) return false;
  setState({ departments: clone(departments), revision, version: (state.version ?? 0) + 1 });
  return true;
};

/* 保存：呼び出し時点の内容を写しとり、遅延の後で会社が変わっていなければ呼び出し時の会社のキーへ書く */
state.saveStrategyData = async (opts?: { reason?: string; force?: boolean }) => {
  const startCompany: string = state.companyId;
  const flow = w.__flow;
  const rec: any = { reason: opts?.reason ?? 'manual', force: !!opts?.force, company: startCompany, result: 'pending' };
  w.__saveLog.push(rec);
  const snapshot = clone(state.departments);
  const csvSnapshot = clone(state.csvFinanceData ?? {});

  if (flow.failSave) {
    rec.result = 'api_error';
    return { ok: false, reason: 'api_error', error: new Error('mock save failure') };
  }
  if (flow.delayMs > 0) await new Promise((r) => setTimeout(r, flow.delayMs));
  if (state.companyId !== startCompany) {
    rec.result = 'scope_changed';
    return { ok: false, skipped: true, reason: 'scope_changed' };
  }
  const revision = (state.revision ?? 0) + 1;
  localStorage.setItem(storageKey(startCompany), JSON.stringify({ departments: snapshot, revision, csvFinanceData: csvSnapshot }));
  setState({ revision, financePlanSavedHash: workingHashOf(csvSnapshot), dirty: false });
  rec.result = 'ok';
  rec.revision = revision;
  return { ok: true, revision };
};

/* 会社の切替（テスト用）：会社IDを変え、その会社の保存データ（なければ架空データ）に置き換える。書き込みはしない。 */
function switchCompany(nextId: string): void {
  const loaded = loadCompany(nextId);
  w.__flowCompanyId = nextId;
  w.__storeLog.push({ action: 'switchCompany', to: nextId });
  setState({
    companyId: nextId,
    strategyId: `STRATEGY-${nextId}`,
    departments: loaded.departments,
    revision: loaded.revision,
    csvFinanceData: loaded.csvFinanceData,
    dirty: false,
  });
}

w.__flow = {
  failSave: false,
  delayMs: 0,
  get companyId() {
    return state.companyId;
  },
  storageKey,
  switchCompany,
  read: (companyId: string) => JSON.parse(localStorage.getItem(storageKey(companyId)) || 'null'),
};
w.__getStrategyState = () => state;

function getState(): any {
  return viewOf(state);
}

export function getStrategyScopeEpoch(): number {
  return 0;
}

export function useStrategyStore(selector?: (s: any) => any): any {
  const sel = selector ?? ((s: any) => s);
  return useSyncExternalStoreWithSelector(subscribe, () => state, undefined, (st: any) => sel(viewOf(st)));
}
useStrategyStore.getState = getState;
useStrategyStore.setState = setState;
useStrategyStore.subscribe = subscribe;
