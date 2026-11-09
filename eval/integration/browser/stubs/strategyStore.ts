/* ブラウザ検証用のstore（評価専用）。購読できる最小のstoreで、架空データだけを持つ。DB・認証・保存には接続しない。 */
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector';
import { FICTIONAL_DEPARTMENTS, FICTIONAL_STRATEGY_ROW } from '../../../quality/fictionalCompany';

export const COMPANY_SWITCH_SAVE_MESSAGE =
  '会社の切り替え中のため、保存されませんでした。切り替えが完了してから、もう一度保存してください。';
export const COMPANY_SCOPE_MISSING_SAVE_MESSAGE =
  '会社が選択されていないため、保存されませんでした。会社を選択してから、もう一度保存してください。';

export type StrategyState = any;

const w: any = typeof window !== 'undefined' ? window : globalThis;
w.__storeLog = w.__storeLog || [];

const TEST_DRAFT_TITLE = '既存顧客の保守契約更新';

let state: any = {
  companyId: 'FICTIONAL-CO',
  strategyId: 'FICTIONAL-STRATEGY',
  hydrated: true,
  restoreReady: true,
  isRestoring: false,
  boot: { isHydrating: false, isHydrated: true, isSaving: false, isRestoring: false },
  lastServerSnapshot: null,
  departments: JSON.parse(JSON.stringify(FICTIONAL_DEPARTMENTS)),
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

/* 検証用：この施策だけ下書きにする（承認済みは編集不可の仕様のため）。架空データ本体は変えない。 */
for (const d of state.departments) for (const pr of d.projects ?? []) if (pr.title === TEST_DRAFT_TITLE) pr.planStatus = 'draft';
/* 検証用：KRに一意なidを付ける（実データのKRは id を持つ前提。架空データの欠落を補う） */
/* ?noKrId=1 のときは付与しない（IDのない旧データの再現用） */
const noKrIdMode = typeof window !== 'undefined' && window.location.search.includes('noKrId');
if (!noKrIdMode) {
  for (const d of state.departments) for (const pr of d.projects ?? []) (pr.okrsV2 ?? []).forEach((kr: any, i: number) => { if (!kr.id) kr.id = `kr-${pr.id ?? 'p'}-${i}`; });
}

const listeners = new Set<(state: unknown) => void>();
function subscribe(l: (state: unknown) => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function setState(partial: any, _replace?: boolean): void {
  const next = typeof partial === 'function' ? partial(state) : partial;
  state = { ...state, ...next };
  listeners.forEach((l) => l(state));
}

/* 店舗の操作（アクション）のうち、状態を変えないものは「呼ばれたこと」だけを記録する。
 * 状態を変えるものは下の個別の実装を使う。 */
const ACTION = /^(set|update|add|remove|refetch|reset|save|load|fetch|clear|toggle|apply|upsert|delete|reorder|patch|invalidate|hydrate|commit|mark)/;
const views = new WeakMap<object, any>();
function viewOf(st: any): any {
  let v = views.get(st);
  if (!v) {
    const fns = new Map<string, (...args: any[]) => void>();
    v = new Proxy(st, {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        if (typeof prop === 'string' && ACTION.test(prop)) {
          let fn = fns.get(prop);
          if (!fn) {
            fn = (...args: any[]) => {
              w.__storeLog.push({ action: prop, args: args.length });
            };
            fns.set(prop, fn);
          }
          return fn;
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
state.setHydrated = () => {};
state.setCompanyScope = () => {};
state.refetchFromServer = async () => {};
state.saveStrategyData = async (...args: any[]) => {
  w.__storeLog.push({ action: 'saveStrategyData', args: args.length });
  return { ok: true as const };
};
state.setFinancePlanAssumptions = (...args: any[]) => {
  w.__storeLog.push({ action: 'setFinancePlanAssumptions', args: args.length });
};

function getState(): any {
  return viewOf(state);
}

w.__getStrategyState = () => state;

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
