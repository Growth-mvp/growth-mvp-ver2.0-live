import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { generateMockExecutionPlan, hasDuplicateProjectIds, withSessionIds } from './mockGenerate';
import type { RawPlanStrategy } from './source';

const base = () => JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0])) as RawPlanStrategy;
const args = (strategy: RawPlanStrategy, projectId: string) => ({
  strategy,
  membershipCompanyId: 'fict-co-a',
  requestedStrategyId: 'fict-strategy-a',
  requestedProjectId: projectId,
  currentYm: '2026-11',
  companyName: '架空精密計測株式会社（評価用）',
  createdAt: '2026-11-09T00:00:00.000Z',
});
const errorsOf = (r: { issues: Array<{ severity: string; code: string }> }) =>
  r.issues.filter((i) => i.severity === 'error').map((i) => i.code);

const PROJECT_IDS = ['fict-proj-renewal', 'fict-proj-referral-sales', 'fict-proj-inspection', 'fict-proj-referral-design', 'fict-proj-clinic-pilot'];

describe('実行計画書の AI作成（モック）', () => {
  it.each(PROJECT_IDS)('安定IDのあるプロジェクト（%s）は、エラーなしの草案になる', async (id) => {
    const r = await generateMockExecutionPlan(args(base(), id));
    expect(r.status).toBe('READY');
    if (r.status !== 'READY') return;
    expect(errorsOf(r)).toEqual([]);
    expect(r.bundle.caseId).toBe(`mock:${id}`);
    expect(r.bundle.mock).toBe(true);
  });

  it('確定KPIは入力のまま組み込まれ、AIの追加KPIは出さない。仮の目標（AI_PROVISIONAL）は確定に入らない', async () => {
    const r = await generateMockExecutionPlan(args(base(), 'fict-proj-renewal'));
    if (r.status !== 'READY') throw new Error('READYであるべき');
    const plan = r.bundle.plan as { section3: { protectedKpis: Array<{ label: string }>; proposedKpis: unknown[] } };
    expect(plan.section3.protectedKpis.map((k) => k.label)).toEqual(['保守契約の継続率', '更新案内の到達率']);
    expect(plan.section3.proposedKpis).toEqual([]);
  });

  it('費用の数値は作らない（予算は null）。財務はAIの仮説だけで、確定の数値は作らない', async () => {
    const r = await generateMockExecutionPlan(args(base(), 'fict-proj-clinic-pilot'));
    if (r.status !== 'READY') throw new Error('READYであるべき');
    const plan = r.bundle.plan as {
      section5: { budget: unknown };
      section4: { financeItems: Array<{ inputs: Array<{ basis: string; confirmState: string }> }> };
    };
    expect(plan.section5.budget).toBeNull();
    for (const item of plan.section4.financeItems) {
      for (const input of item.inputs) {
        expect(input.basis).toBe('HYPOTHESIS');
        expect(input.confirmState).toBe('AI_PROPOSED');
      }
    }
    expect((r.bundle.estimates as Array<{ status: string }>).every((e) => e.status !== 'CONFIRMED')).toBe(true);
  });

  it('担当者は決めず、実行は開始できない状態で返す（利用者が確認する）', async () => {
    const r = await generateMockExecutionPlan(args(base(), 'fict-proj-renewal'));
    if (r.status !== 'READY') throw new Error('READYであるべき');
    expect(r.bundle.executionStartable).toBe(false);
    expect((r.bundle.plan as { section5: { responsible: { name: unknown } } }).section5.responsible.name).toBeNull();
  });

  it('行動の期限は計画期間の中で、順番どおりに並ぶ', async () => {
    const r = await generateMockExecutionPlan(args(base(), 'fict-proj-inspection'));
    if (r.status !== 'READY') throw new Error('READYであるべき');
    const plan = r.bundle.plan as { period: { startYm: string; endYm: string }; section2: { actions: Array<{ dueYm: string }> } };
    const dues = plan.section2.actions.map((a) => a.dueYm);
    expect(dues).toEqual([...dues].sort());
    for (const d of dues) {
      expect(d >= plan.period.startYm && d <= plan.period.endYm).toBe(true);
    }
  });

  it('安定IDのないプロジェクトも、一時IDで草案になる（元の戦略データは変えない）', async () => {
    const strategy = base();
    const dept = strategy.departments as Array<{ projects: Array<Record<string, unknown>> }>;
    delete dept[0].projects[1].id;
    const before = JSON.stringify(strategy);
    const r = await generateMockExecutionPlan(args(strategy, 'session:d0-p1'));
    expect(r.status).toBe('READY');
    if (r.status !== 'READY') return;
    expect(r.bundle.caseId).toBe('mock:session:d0-p1');
    expect(errorsOf(r)).toEqual([]);
    expect(JSON.stringify(strategy)).toBe(before);
  });

  it('同じIDのプロジェクトが複数あるときは、作らない', async () => {
    const strategy = base();
    const dept = strategy.departments as Array<{ projects: Array<Record<string, unknown>> }>;
    dept[1].projects[0].id = 'fict-proj-renewal';
    expect(hasDuplicateProjectIds(strategy)).toBe(true);
    const r = await generateMockExecutionPlan(args(strategy, 'fict-proj-renewal'));
    expect(r.status).toBe('FAILED');
    expect(r.issues[0]?.code).toBe('PROJECT_AMBIGUOUS');
  });

  it('一時IDは、安定IDのあるプロジェクトには付かない', () => {
    const s = withSessionIds(base());
    const dept = s.departments as Array<{ projects: Array<{ id: string }> }>;
    expect(dept[0].projects.map((p) => p.id)).toEqual(['fict-proj-renewal', 'fict-proj-referral-sales']);
  });
});
