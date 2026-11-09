/* 実アプリのレイアウト確認用の認証状態（評価専用）。管理者として、架空の会社にログイン済みの状態を返す。通信はしない。
 * set〇〇 は値を実際に更新し購読者へ通知する（Zustand と同じく、アクションの参照は安定させる）。 */
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector';

export const MOCK_COMPANY_ID = '00000000-0000-4000-8000-00000000c0de';

const w: any = typeof window !== 'undefined' ? window : globalThis;
w.__userLog = w.__userLog || [];

let raw: Record<string, unknown> = {
  user: { id: 'u-mock', email: 'mock@example.invalid' },
  role: 'admin',
  companyId: MOCK_COMPANY_ID,
  departmentId: undefined,
  membership: { companyId: MOCK_COMPANY_ID, departmentId: undefined },
  membershipLoaded: true,
  bootstrapReady: true,
};

const listeners = new Set<(s: unknown) => void>();

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function setPartial(partial: Record<string, unknown>, action: string): void {
  raw = { ...raw, ...partial };
  w.__userLog.push({ action });
  state = makeState();
  listeners.forEach((l) => l(state));
}

const actions = new Map<string, (...args: unknown[]) => void>();
function actionFor(name: string): (...args: unknown[]) => void {
  let fn = actions.get(name);
  if (fn) return fn;
  const set = /^set([A-Z].*)$/.exec(name);
  if (set) {
    const key = lowerFirst(set[1]);
    fn = (value?: unknown) => setPartial({ [key]: value }, name);
  } else if (name === 'clearUser') {
    fn = () => setPartial({ user: null, role: null, membership: { companyId: undefined, departmentId: undefined } }, name);
  } else {
    fn = () => {};
  }
  actions.set(name, fn);
  return fn;
}

function makeState(): any {
  const data = raw;
  return new Proxy(data, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) return target[prop];
      return actionFor(prop);
    },
  });
}

let state: any = makeState();

function subscribe(l: (s: unknown) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useUserStore(selector?: (s: any) => any): any {
  const sel = selector ?? ((s: any) => s);
  return useSyncExternalStoreWithSelector(subscribe, () => state, undefined, (s: any) => sel(s));
}
useUserStore.getState = () => state;
useUserStore.setState = (partial: Record<string, unknown>) => setPartial(partial, 'setState');
useUserStore.subscribe = subscribe;
