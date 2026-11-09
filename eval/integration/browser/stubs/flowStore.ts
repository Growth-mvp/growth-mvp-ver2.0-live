/* 流れの検証用の永続化ストア（評価専用）。
 * 保存先は localStorage の `flow:<companyId>` だけで、DB・認証・通信には接続しない。
 * saveStrategyData は実ストア（store/strategyStore.ts）の SaveResult 契約に合わせる:
 *   成功 {ok:true, revision} / 失敗 {ok:false, reason:'api_error', error}
 *   会社・戦略の切替中に応答 {ok:false, skipped:true, reason:'scope_changed'}（書き込まない）
 * subscribe は実ストアと同じく (state, prevState) を渡す（lib/strategy/saveScope.ts が prev を読むため）。 */
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector';
import { FICTIONAL_DEPARTMENTS, FICTIONAL_STRATEGY_ROW } from '../../../quality/fictionalCompany';
import { normalizeStrategyData } from '@/utils/supabase/normalize';

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

export const MAIN_COMPANY = 'FICTIONAL-CO';
export const OTHER_COMPANY = 'FICTIONAL-OTHER';

/* 検証用：下書きにする施策（承認済みは編集・反映が止まる仕様のため）。架空データ本体の内容は変えない。 */
const DRAFT_TITLES = ['既存顧客の保守契約更新', '点検工程の標準化'];
/* ?legacy=1 のとき、保存データがない初回読込でだけ、これらの施策のKRから id を外す（旧データの再現） */
const LEGACY_TITLES = ['点検工程の標準化', '新規顧客開拓'];

export const storageKey = (companyId: string): string => `flow:${companyId}`;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

const legacyMode: boolean =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('legacy') === '1';

function fixtureDepartments(companyId: string): any[] {
  if (companyId === OTHER_COMPANY) {
    return [
      {
        id: 'other-dept',
        name: '他社の部門（架空）',
        projects: [
          {
            id: 'other-proj',
            title: '他社の施策（架空）',
            planStatus: 'draft',
            okrsV2: [{ id: 'kr-other-1', label: '他社のKR', target: 10, unit: '件' }],
          },
        ],
      },
    ];
  }
  const deps = clone(FICTIONAL_DEPARTMENTS) as any[];
  for (const d of deps) {
    for (const pr of d.projects ?? []) {
      if (DRAFT_TITLES.includes(pr.title)) pr.planStatus = 'draft';
      const noId = legacyMode && LEGACY_TITLES.includes(pr.title);
      (pr.okrsV2 ?? []).forEach((kr: any, i: number) => {
        if (!noId && !kr.id) kr.id = `kr-${pr.id ?? 'p'}-${i}`;
      });
    }
  }
  return deps;
}

/* 保存データがあれば実際の正規化関数で読み直し、なければ架空データから始める */
function loadCompany(companyId: string): { departments: any[]; revision: number } {
  const raw = localStorage.getItem(storageKey(companyId));
  if (raw) {
    const parsed = JSON.parse(raw);
    const normalized: any = normalizeStrategyData({ departments: parsed.departments } as any);
    return { departments: normalized.departments ?? [], revision: Number(parsed.revision ?? 0) };
  }
  return { departments: fixtureDepartments(companyId), revision: 0 };
}

const first = loadCompany(MAIN_COMPANY);
w.__flowCompanyId = MAIN_COMPANY;

let state: any = {
  companyId: MAIN_COMPANY,
  strategyId: 'FICTIONAL-STRATEGY',
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
    { id: 'rev', label: '売上', unit: '百万円', base: 1000, low: 900, high: 1100 },
    { id: 'op', label: '営業利益', unit: '百万円', base: 70, low: 60, high: 80 },
  ],
  projectTargetImpacts: [],
  csvFinanceData: {},
  financePlanSavedHash: undefined,
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
state.setFinancePlanAssumptions = (...args: any[]) => {
  w.__storeLog.push({ action: 'setFinancePlanAssumptions', args: args.length });
};

/* 保存：呼び出し時点の departments を写しとり、遅延の後で会社が変わっていなければ呼び出し時の会社のキーへ書く。
 * 実ストアも、保存のペイロードは API 呼び出しの前に作る。 */
state.saveStrategyData = async (opts?: { reason?: string; force?: boolean }) => {
  const startCompany: string = state.companyId;
  const flow = w.__flow;
  const rec: any = { reason: opts?.reason ?? 'manual', force: !!opts?.force, company: startCompany, result: 'pending' };
  w.__saveLog.push(rec);
  const snapshot = clone(state.departments);

  if (flow.failSave) {
    rec.result = 'api_error';
    return { ok: false, reason: 'api_error', error: new Error('mock save failure') };
  }
  if (flow.conflict) {
    rec.result = 'revision_conflict';
    return { ok: false, reason: 'revision_conflict_persist', code: 'REVISION_CONFLICT' };
  }
  if (flow.delayMs > 0) await new Promise((r) => setTimeout(r, flow.delayMs));
  if (state.companyId !== startCompany) {
    rec.result = 'scope_changed';
    return { ok: false, skipped: true, reason: 'scope_changed' };
  }
  const revision = (state.revision ?? 0) + 1;
  localStorage.setItem(storageKey(startCompany), JSON.stringify({ departments: snapshot, revision }));
  setState({ revision });
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
    dirty: false,
  });
}

w.__flow = {
  failSave: false,
  conflict: false,
  delayMs: 0,
  legacyMode,
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
