'use client';

/* 画面が使う保存先と番号の窓口。URLの ?planStore=remote（または環境変数）でAPIに切り替える。
 * 既定はブラウザ内の開発用の保存先。どちらも、戦略全体の保存（saveStrategyData）は呼ばない。 */
import { useStrategyStore } from '@/store/strategyStore';
import type { PlanDocumentStore } from '@/lib/stage4/plan/planDocumentStore';
import {
  createRemoteIdentityApi,
  createRemotePlanOps,
  createRemotePlanStore,
  planStoreKindFrom,
  withProjectId,
  type IdentityApi,
  type PlanStoreKind,
  type ProjectView,
} from '@/lib/stage4/plan/planClient';
import { isStage4DocumentScreenEnabled } from '@/lib/stage4/plan/documentScreenFlag';
import { safeGetSession } from '@/utils/supabase/client';

import { devPlanDocumentStore } from './devPlanStore';

const overrideOf = <T,>(key: string): T | undefined =>
  typeof window === 'undefined' ? undefined : ((window as unknown as Record<string, unknown>)[key] as T | undefined);

export function currentPlanStoreKind(): PlanStoreKind {
  if (isStage4DocumentScreenEnabled()) return 'remote';
  const search = typeof window === 'undefined' ? '' : window.location.search;
  return planStoreKindFrom(search, process.env.NEXT_PUBLIC_STAGE4_PLAN_STORE);
}

const apiOptions = () => ({
  baseUrl: overrideOf<string>('__stage4ApiBase') ?? '',
  getToken: async (): Promise<string | null> => {
    const override = overrideOf<string>('__stage4Token');
    if (override) return override;
    const r = await safeGetSession();
    return r.data.session?.access_token ?? null;
  },
});

export function planStoreFor(kind: PlanStoreKind): PlanDocumentStore {
  return kind === 'remote' ? createRemotePlanStore(apiOptions()) : devPlanDocumentStore();
}

/* ブラウザ内の番号の窓口：画面の状態の該当項目にだけ番号を入れる（保存はしない） */
function createLocalIdentityApi(): IdentityApi {
  return {
    async readStrategy(companyId, strategyId) {
      const st = useStrategyStore.getState() as unknown as { companyId?: string; strategyId?: string; departments?: unknown };
      if (st.companyId !== companyId || st.strategyId !== strategyId) return { status: 'NOT_FOUND' };
      const list = Array.isArray(st.departments) ? (st.departments as Array<{ projects?: unknown }>) : [];
      const projects: ProjectView[] = list.flatMap((d, departmentIndex) =>
        (Array.isArray(d?.projects) ? (d.projects as Array<Record<string, unknown>>) : []).map((p, projectIndex) => ({
          departmentIndex,
          projectIndex,
          title: typeof p.title === 'string' ? p.title.trim() : '',
          projectId: typeof p.id === 'string' && p.id.trim() ? p.id.trim() : null,
        }))
      );
      return { status: 'FOUND', revision: 0, projects };
    },
    async assign(args) {
      const st = useStrategyStore.getState() as unknown as { departments?: unknown };
      const next = withProjectId(st.departments, args.departmentIndex, args.projectIndex, args.newId);
      const ids = next.flatMap((d) =>
        (Array.isArray((d as { projects?: unknown }).projects) ? ((d as { projects: Array<Record<string, unknown>> }).projects) : []).map((p) =>
          typeof p.id === 'string' ? p.id : null
        )
      );
      const present = ids.filter((x): x is string => !!x);
      if (new Set(present).size !== present.length) return { status: 'ID_IN_USE' };
      useStrategyStore.setState({ departments: next } as never);
      return { status: 'ASSIGNED', projectId: args.newId, alreadyAssigned: false, revision: 0 };
    },
  };
}

export function identityApiFor(kind: PlanStoreKind): IdentityApi {
  return kind === 'remote' ? createRemoteIdentityApi(apiOptions()) : createLocalIdentityApi();
}

export function remotePlanOps() {
  return createRemotePlanOps(apiOptions());
}
