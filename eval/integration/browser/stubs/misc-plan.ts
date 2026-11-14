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
/* 検証用：このプロジェクトのOKR（okr-anchor-proj-retention）に紐づく記録だけを返す。別の案件の記録は返さない。 */
const w0: any = typeof window !== 'undefined' ? window : globalThis;
w0.__fixtureLogs = w0.__fixtureLogs || [
  { id: 'fb-latest', company_id: 'FICTIONAL-CO', okr_id: 'okr-anchor-proj-retention', user_id: 'u-manager', created_at: '2026-11-13T09:00:00.000Z', content: '[FB]\n来週の引き継ぎの場は、まず対象の顧客を3件に絞って進めてください。', score: null, status: null },
  { id: 'fb-old', company_id: 'FICTIONAL-CO', okr_id: 'okr-anchor-proj-retention', user_id: 'u-manager', created_at: '2026-11-10T09:00:00.000Z', content: '[FB]\n更新案内の文面を一緒に確認しましょう。', score: null, status: null },
  { id: 'memo-other', company_id: 'FICTIONAL-CO', okr_id: 'okr-anchor-proj-retention', user_id: 'u-other', created_at: '2026-11-12T09:00:00.000Z', content: '担当が変わった顧客を洗い出し中', score: null, status: null },
  { id: 'fb-other-project', company_id: 'FICTIONAL-CO', okr_id: 'okr-other-project', user_id: 'u-manager', created_at: '2026-11-12T10:00:00.000Z', content: '[FB]\n別の案件へのフィードバック（表示されてはいけない）', score: null, status: null },
];
function makeFixtureQuery(table: string): any {
  const filters: Record<string, unknown> = {};
  const rows = () => {
    if (table !== 'progress_logs') return [];
    return (w0.__fixtureLogs as any[]).filter((r) => Object.entries(filters).every(([k, v]) => (r as any)[k] === v));
  };
  const q: any = {
    select: () => q,
    eq: (k: string, v: unknown) => {
      filters[k] = v;
      return q;
    },
    order: () => q,
    limit: () => q,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
  };
  return q;
}
export const supabase: any = {
  from: (table: string) => makeFixtureQuery(table),
  auth: {
    getSession: async () => ({ data: { session: { access_token: 'test-token', user: { id: 'u-test' } } }, error: null }),
    getUser: async () => ({ data: { user: { id: 'u-test' } }, error: null }),
  },
};
