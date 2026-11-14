/* STAGE4→STAGE6 の一連の検証用の計画ストア（評価専用）。通信しない。
 * 計画書の読込は架空の計画を返し、案件の番号づけは実際の画面の状態（保存されるストア）に対して行う。
 * AI生成・採用・開始などの通信を伴う操作は、この検証の対象外として失敗させる。 */
import { generateMockExecutionPlan } from '@/lib/stage4/plan/mockGenerate';
import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { buildDocModel } from '@/lib/stage4/planView/documentModel';
import { withProjectId, type IdentityApi, type ProjectView } from '@/lib/stage4/plan/planClient';
import { useStrategyStore } from '@/store/strategyStore';

const w: any = typeof window !== 'undefined' ? window : globalThis;
w.__planLoads = w.__planLoads || [];
let cached: any = null;

async function draft(): Promise<any> {
  if (!cached) {
    const r: any = await generateMockExecutionPlan({
      strategy: JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0])),
      membershipCompanyId: 'fict-co-a',
      requestedStrategyId: 'fict-strategy-a',
      requestedProjectId: 'fict-proj-renewal',
      currentYm: '2026-11',
      companyName: '架空',
      createdAt: '2026-11-10T00:00:00.000Z',
    });
    cached = r.bundle;
  }
  return cached;
}

export function currentPlanStoreKind(): 'remote' {
  return 'remote';
}

/* 計画書の保存は、財務効果の保存（persistDraft が SAVED のときだけ行う）を通すため、保存済みを返す。
 * 版番号は読み込んだ版から進める。保存先は持たない（検証は画面の状態と財務効果の保存で行う）。 */
export function planStoreFor(_kind: string) {
  const saved = (key: any, version: number, userEdits: unknown, adopted: boolean) => ({
    status: 'SAVED' as const,
    record: {
      key,
      version,
      aiDraft: cached,
      userEdits,
      adopted,
      updatedAt: '2026-11-12T09:00:00.000Z',
      updatedBy: 'u-test',
      status: 'DRAFT',
      adoption: { version: 3, byUserId: 'u-test', at: '2026-11-11T08:00:00.000Z', edits: {} },
      startInfo: { version: 4, byUserId: 'u-test', at: '2026-11-11T09:00:00.000Z' },
      regulatory: undefined,
    },
  });
  return {
    create: async (_actor: unknown, key: any, input: any) => saved(key, 1, input.userEdits, input.adopted),
    update: async (_actor: unknown, key: any, expectedVersion: number, input: any) =>
      saved(key, expectedVersion + 1, input.userEdits, input.adopted),
    load: async (_actor: unknown, key: any) => {
      w.__planLoads.push({ projectId: key.projectId });
      const aiDraft = await draft();
      const base = buildDocModel(aiDraft, {});
      const kpi = base.goals.kpis.find((k: any) => k.targetKey);
      const userEdits = kpi?.targetKey ? { [kpi.targetKey]: '3社（ハーネス修正）' } : {};
      return {
        status: 'FOUND',
        record: {
          key,
          version: 4,
          aiDraft,
          userEdits,
          adopted: true,
          updatedAt: '2026-11-11T09:00:00.000Z',
          updatedBy: 'u-test',
          status: 'DRAFT',
          adoption: { version: 3, byUserId: 'u-test', at: '2026-11-11T08:00:00.000Z', edits: {} },
          startInfo: { version: 4, byUserId: 'u-test', at: '2026-11-11T09:00:00.000Z' },
          regulatory: undefined,
        },
      };
    },
  };
}

/* 案件の番号づけ：画面の状態（会社・戦略・部門・施策）を読み、無い番号だけを付ける（通信しない） */
export function identityApiFor(_kind: string): IdentityApi {
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
        })),
      );
      return { status: 'FOUND', revision: 0, projects };
    },
    async assign(args) {
      const st = useStrategyStore.getState() as unknown as { departments?: unknown };
      const next = withProjectId(st.departments, args.departmentIndex, args.projectIndex, args.newId);
      useStrategyStore.setState({ departments: next } as never);
      return { status: 'ASSIGNED', projectId: args.newId, alreadyAssigned: false, revision: 0 };
    },
  } as IdentityApi;
}

const BLOCKED = { status: 'FAILED', message: '検証では通信しません（AI生成・採用・開始は対象外）' };

/* AI生成・採用・開始などの通信操作は遮断する */
export function remotePlanOps() {
  return {
    list: async () => ({ status: 'DISABLED' as const }),
    generate: async () => BLOCKED,
    transition: async () => BLOCKED,
    preview: async () => BLOCKED,
    useDraft: async () => BLOCKED,
  } as any;
}
