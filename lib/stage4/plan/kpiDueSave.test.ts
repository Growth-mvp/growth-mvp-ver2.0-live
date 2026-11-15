import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { buildDocModel } from '../planView/documentModel';
import { generateMockExecutionPlan } from './mockGenerate';
import { createMemoryPlanDocumentStore, type PlanDocActor, type PlanDocKey } from './planDocumentStore';
import type { RawPlanStrategy, RawPlanStrategy as Strategy } from './source';

const CO = 'fict-co-a';
const KEY: PlanDocKey = { companyId: CO, strategyId: 'fict-strategy-a', projectId: 'fict-proj-renewal' };
const ACTOR: PlanDocActor = { userId: 'alice', memberships: [{ companyId: CO, role: 'member' }] };

describe('STAGE3由来KPIの期限（月）は、保存して再読込しても計画書に残る', () => {
  it('正しい形式（YYYY-MM）で入力した期限は、保存・再読込の後も表示される', async () => {
    const generated = await generateMockExecutionPlan({
      strategy: JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0])) as RawPlanStrategy,
      membershipCompanyId: CO,
      requestedStrategyId: KEY.strategyId,
      requestedProjectId: KEY.projectId,
      currentYm: '2026-11',
      companyName: '架空',
      createdAt: '2026-11-10T00:00:00.000Z',
    });
    if (generated.status !== 'READY') throw new Error('mock draft must be ready');
    const bundle = generated.bundle;
    const kpi = buildDocModel(bundle, {}).goals.kpis.find((k) => k.confirmed && k.dueKey);
    expect(kpi?.dueKey).toMatch(/^stage3kpi:.+:due$/);

    const store = createMemoryPlanDocumentStore({
      getStrategies: () => JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES.slice(0, 1))) as Strategy[] as never,
      now: () => '2026-11-10T00:00:00.000Z',
    });
    expect((await store.create(ACTOR, KEY, { aiDraft: bundle, userEdits: {}, adopted: false })).status).toBe('SAVED');
    const saved = await store.update(ACTOR, KEY, 1, { userEdits: { [kpi!.dueKey!]: '2027-01' }, adopted: false });
    expect(saved.status).toBe('SAVED');

    const reloaded = await store.load(ACTOR, KEY);
    if (reloaded.status !== 'FOUND') throw new Error('reload');
    const shown = buildDocModel(reloaded.record.aiDraft as typeof bundle, reloaded.record.userEdits as Parameters<typeof buildDocModel>[1]).goals.kpis.find(
      (k) => k.label === kpi!.label,
    );
    expect(shown?.due).toMatch(/^2027年1月/);
    expect(shown?.dueKey).toBe(kpi!.dueKey);
    expect(shown?.target).toBe(kpi!.target);
    expect(shown?.owner).toBe(kpi!.owner);
  });
});
