/* ブラウザ検証用の周辺モジュールのスタブ（流れの検証用・評価専用）。misc.ts の複製。
 * 違い：(1) safeGetSession はアクセストークンを返す（AI案の取得経路を通すため）
 *       (2) ユーザーの companyId は flowStore の現在の会社に追随する（会社切替を再現するため）
 * 通信・保存・認証は行わず、固定の値を返す。 */
import type { ReactNode } from 'react';

const wf: any = typeof window !== 'undefined' ? window : globalThis;
const userState: any = {
  role: 'admin',
  get companyId(): string {
    return wf.__flowCompanyId ?? 'FICTIONAL-CO';
  },
  user: { id: 'u-test' },
  bootstrapReady: true,
};
export function useUserStore(selector?: (s: any) => any): any {
  return selector ? selector(userState) : userState;
}

useUserStore.getState = () => userState;
useUserStore.subscribe = (_l: unknown): (() => void) => () => {};

export function useCapabilities(): any {
  return {
    canEditContent: true,
    canEditDept: true,
    canEditKr: true,
    canTransitionToPlanStatus: true,
    canEditStrategy: true,
  };
}

export function hardResetForCompanySwitch(_companyId?: unknown): void {}

export async function loadAndHydrate(..._args: unknown[]): Promise<void> {}

export function debugLog(..._args: unknown[]): void {}

export async function safeGetSession(): Promise<{ data: { session: { access_token: string } }; error: null }> {
  return { data: { session: { access_token: 'harness-token' } }, error: null };
}

export function useAutoSave(_args?: unknown): void {}

export function useStage4PdfExport(): { exportToPdf: () => Promise<void> } {
  return { exportToPdf: async () => {} };
}

const wm: any = typeof window !== 'undefined' ? window : globalThis;
wm.__okrCalls = wm.__okrCalls || [];

export const okrService: any = {
  upsertOkr: async (...a: unknown[]) => {
    wm.__okrCalls.push({ method: 'upsertOkr', projectId: a[1] ?? null });
    return { ok: true, data: null };
  },
  deleteOkr: async (..._a: unknown[]) => ({ ok: true }),
  reorderOkrs: async (..._a: unknown[]) => ({ ok: true }),
  resolveProjectsWithOkrs: async (..._a: unknown[]) => ({ resolvedOkrs: [] }),
};

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams('');
}

export default function StrategyGuard({ children }: { children?: ReactNode }): ReactNode {
  return children;
}

/* STAGE5 画面が直接参照する Supabase クライアント（通信しない。空の結果を返す） */
function makeEmptyQuery(): any {
  const q: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej);
        if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
        return (..._a: unknown[]) => q;
      },
    },
  );
  return q;
}
export const supabase: any = {
  from: (..._a: unknown[]) => makeEmptyQuery(),
  auth: {
    getSession: async () => ({ data: { session: { access_token: 'test-token', user: { id: 'u-test' } } }, error: null }),
    getUser: async () => ({ data: { user: { id: 'u-test' } }, error: null }),
  },
};
