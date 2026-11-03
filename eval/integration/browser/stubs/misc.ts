/* ブラウザ検証用の周辺モジュールのスタブ（評価専用）。通信・保存・認証は行わず、固定の値を返す。 */
import type { ReactNode } from 'react';

const userState: any = { role: 'admin', companyId: 'FICTIONAL-CO', user: { id: 'u-test' }, bootstrapReady: true };
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

export async function safeGetSession(): Promise<{ data: { session: null }; error: null }> {
  return { data: { session: null }, error: null };
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
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
  },
};
