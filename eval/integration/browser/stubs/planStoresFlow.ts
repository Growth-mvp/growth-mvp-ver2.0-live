/* 検証用の計画の読み込み（評価専用）。通信しない。STAGE4で開始し、利用者が一つ修正した計画を返す。 */
import { generateMockExecutionPlan } from '@/lib/stage4/plan/mockGenerate';
import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { buildDocModel } from '@/lib/stage4/planView/documentModel';

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

export function planStoreFor(_kind: string) {
  return {
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
