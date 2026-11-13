import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { generateMockExecutionPlan } from '@/lib/stage4/plan/mockGenerate';
import type { RawPlanStrategy } from '@/lib/stage4/plan/source';
import { buildDocModel } from './documentModel';
import { listEditableItems } from './regen';

let bundle: Record<string, unknown>;
beforeAll(async () => {
  const r = await generateMockExecutionPlan({
    strategy: JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0])) as RawPlanStrategy,
    membershipCompanyId: 'fict-co-a',
    requestedStrategyId: 'fict-strategy-a',
    requestedProjectId: 'fict-proj-renewal',
    currentYm: '2026-11',
    companyName: '架空',
    createdAt: '2026-11-10T00:00:00.000Z',
  });
  if (r.status !== 'READY') throw new Error('mock draft must be ready');
  bundle = r.bundle;
});

const planOf = (b: Record<string, unknown>): any => (typeof b.rawOutput === 'string' ? JSON.parse(b.rawOutput) : b.plan);

describe('AI生成の計画内容は、原則すべて直接編集できる（編集の項目と、画面の表示が一致する）', () => {
  it('実施事項の主な内容・担当・成果物・次に進める条件・収益化の段階が、編集の項目になる', () => {
    const ids = listEditableItems(planOf(bundle)).map((i) => i.itemId);
    for (const f of ['content', 'owner', 'deliverable', 'exit', 'stage']) expect(ids).toContain(`action:1:${f}`);
  });

  it('編集した内容は、文書の表示にそのまま出る', () => {
    const edits = {
      'action:1:content': '新しい主な内容',
      'action:1:owner': '営業部長（仮）',
      'action:1:deliverable': '新しい成果物',
      'action:1:exit': '新しい判断条件',
      'action:1:stage': '新しい段階',
      responsible: '佐藤（仮）',
    };
    const doc = buildDocModel(bundle, edits);
    const a = doc.actions[0];
    expect(a.content).toBe('新しい主な内容');
    expect(a.owner).toBe('営業部長（仮）');
    expect(a.deliverable).toBe('新しい成果物');
    expect(a.exitCondition).toBe('新しい判断条件');
    expect(a.stage).toBe('新しい段階');
    expect(doc.responsible.raw).toBe('佐藤（仮）');
  });

  it('スケジュールは、実施事項の期限・内容と一緒に担当も表示する（期限は一箇所だけに保存する）', () => {
    const doc = buildDocModel(bundle, { 'action:1:owner': '営業部長（仮）', 'action:1:due': '2027-06' });
    expect(doc.organization.schedule[0].who).toBe(doc.actions[0].owner);
    expect(doc.organization.schedule[0].who).toBe('営業部長（仮）');
    expect(doc.organization.schedule[0].when).toBe(doc.actions[0].due);
  });

  it('STAGE3由来のKPIの目標・期限・担当は、STAGE4上で変えられ、元のSTAGE3の値を参照できる', () => {
    const base = buildDocModel(bundle, {});
    const kpi = base.goals.kpis.find((k) => k.confirmed);
    expect(kpi).toBeTruthy();
    expect(kpi?.stage3Changed).toBe(false);
    expect(kpi?.targetKey).toMatch(/^stage3kpi:/);
    const doc = buildDocModel(bundle, { [kpi!.targetKey!]: '3社', [kpi!.dueKey!]: '2028-03' });
    const changed = doc.goals.kpis.find((k) => k.label === kpi!.label);
    expect(changed?.target).toBe('3社');
    expect(changed?.due).toBe('2028年3月');
    expect(changed?.stage3Changed).toBe(true);
    expect(changed?.stage3Reference).toContain(kpi!.target);
    // STAGE3の元の表示は変わらない（STAGE4上の修正だけが変わる）
    expect(base.goals.kpis.find((k) => k.label === kpi!.label)?.target).toBe(kpi!.target);
  });

  it('開始前の確認は、利用者が確認済みとして記録でき、その記録は文書に残る（判定条件は変わらない）', () => {
    const base = buildDocModel(bundle, {});
    const item = base.organization.beforeStart[0] ?? base.impact.regulatory[0];
    expect(item).toBeTruthy();
    expect(item.done).toBe(false);
    const doc = buildDocModel(bundle, { [item.key]: true });
    const again = [...doc.organization.beforeStart, ...doc.impact.regulatory].find((c) => c.key === item.key);
    expect(again?.done).toBe(true);
    expect(again?.title).toBe(item.title);
  });

  it('編集の欄の鍵は、表示の鍵と同じ形で、実施事項ごとに分かれる', () => {
    const doc = buildDocModel(bundle, {});
    expect(doc.actions[1].contentKey).toBe('action:2:content');
    expect(doc.actions[1].ownerKey).toBe('action:2:owner');
  });
});
