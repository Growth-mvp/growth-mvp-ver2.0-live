import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { createMockModel } from './mockGenerate';
import { generatePlanDraft, type GenerateDeps } from './planGenerate';
import { buildStage3Tree } from './stage3Read';
import type { GatewayResult, PlanGateway, ServiceContext } from './planService';
import type { PlanDocRecord } from './planDocumentStore';
import type { RawPlanStrategy } from './source';

const CO = 'fict-co-a';
const ST = 'fict-strategy-a';
const HANDED = 'p-7f3c1a2e-0000-4000-8000-000000000001';

const ok = <T,>(value: T): GatewayResult<T> => ({ ok: true, value });
const rec = (): PlanDocRecord => ({
  key: { companyId: CO, strategyId: ST, projectId: HANDED },
  version: 1,
  aiDraft: {},
  userEdits: {},
  adopted: false,
  updatedAt: '2026-11-10T00:00:00.000Z',
  updatedBy: 'u',
  status: 'DRAFT',
  adoption: null,
  startInfo: null,
});

/* STAGE3で採用されたプロジェクトと同じ形：IDと文章の項目だけ（KPI・OKRは採用時に持ち込まない） */
function strategyWithAdoptedProject(): Record<string, unknown> {
  const base = JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0])) as Record<string, unknown>;
  const departments = (base.departments as Array<Record<string, unknown>>).map((d, i) =>
    i === 0
      ? {
          ...d,
          projects: [
            ...((d.projects as unknown[]) ?? []),
            {
              id: HANDED,
              title: '引き継いだ新規施策',
              hypothesis: '既存顧客の再発注の手間を減らせば、受注が安定する',
              reason: '再発注の手間が受注の取りこぼしにつながっている',
              description: '書類の作成を一度で済ませる形にする',
              sourceType: 'new',
            },
          ],
        }
      : d
  );
  return { ...base, departments };
}

function gateway(row: Record<string, unknown>) {
  const completed: { draft: Record<string, unknown> | null } = { draft: null };
  const g = {
    membershipRole: async () => ok('member'),
    readStrategyRow: async () => ok(row),
    claimGeneration: async () => ok({ claimed: true as const, record: { ...rec(), status: 'GENERATING' as const } }),
    completeGeneration: async (_k: unknown, _u: unknown, aiDraft: Record<string, unknown>) => {
      completed.draft = aiDraft;
      return ok(rec());
    },
    failGeneration: async () => ok({ ...rec(), status: 'GENERATION_FAILED' as const }),
  } as unknown as PlanGateway;
  return { g, completed };
}

const deps = (): GenerateDeps => ({
  now: () => '2026-11-10T00:00:00.000Z',
  currentYm: () => '2026-11',
  mapStrategy: (row) => row as unknown as RawPlanStrategy,
  modelFor: async (raw) => {
    const mock = createMockModel(raw);
    return async (prompt) => mock(prompt);
  },
});

describe('STAGE3で確定したプロジェクトからの実行計画書の生成', () => {
  it('KPI・OKRを持たない採用プロジェクトでも、草案を作れる（INVALIDにならない）', async () => {
    const t = gateway(strategyWithAdoptedProject());
    const ctx: ServiceContext = { userId: 'u-1', gateway: t.g };
    const out = await generatePlanDraft(ctx, { companyId: CO, strategyId: ST, projectId: HANDED, companyName: '架空' }, deps());
    expect(out.status).toBe('CREATED');
  });
});

describe('STAGE3で確定したプロジェクトの、STAGE4の一覧での見え方', () => {
  it('確定で正式データに入った採用プロジェクトは、STAGE4の一覧に、同じIDの選択キーで出る', () => {
    const strategy = strategyWithAdoptedProject();
    const tree = buildStage3Tree({
      memberships: [{ company_id: CO, role: 'member' }],
      strategies: [{ id: ST, company_id: CO, departments: strategy.departments } as never],
    });
    const projects = tree.flatMap((s) => s.departments.flatMap((d) => d.projects));
    expect(projects.map((p) => p.projectKey)).toContain(`id:${HANDED}`);
  });
});
