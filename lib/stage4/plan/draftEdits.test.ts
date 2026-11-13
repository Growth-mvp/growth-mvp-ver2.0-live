import { listEditableItems } from '../planView/regen';
import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { editsAfterReplace } from './draftEdits';
import { generateMockExecutionPlan } from './mockGenerate';
import type { RawPlanStrategy } from './source';

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
const withPlan = (b: Record<string, unknown>, plan: unknown): Record<string, unknown> =>
  typeof b.rawOutput === 'string' ? { ...b, rawOutput: JSON.stringify(plan) } : { ...b, plan };

/* 本文が一箇所にしか無い項目を選び、その文だけを書き換えた案（同じ itemId で、意味が変わった想定） */
function changeOneItem(b: Record<string, unknown>): { next: Record<string, unknown>; itemId: string; oldText: string } {
  const plan = planOf(b);
  const planJson = JSON.stringify(plan);
  const item = listEditableItems(plan).find((i) => {
    const esc = JSON.stringify(i.text).slice(1, -1);
    return i.text.length >= 6 && planJson.split(esc).length === 2;
  });
  if (!item) throw new Error('一意な本文の項目が見つかりません');
  const esc = JSON.stringify(item.text).slice(1, -1);
  const changed = JSON.parse(planJson.replace(esc, JSON.stringify(`${item.text}（改定）`).slice(1, -1)));
  return { next: withPlan(b, changed), itemId: item.itemId, oldText: item.text };
}

describe('再生成の案に、以前の利用者の修正を引き継ぐ規則（editsAfterReplace）', () => {
  it('案が変わらなければ、修正はすべて引き継がれる', () => {
    const edits = { responsible: '佐藤（仮）', goal: '修正した目標' };
    const out = editsAfterReplace(edits, bundle, bundle);
    expect(out.kept).toEqual(edits);
    expect(out.dropped).toEqual([]);
  });

  it('同じ項目でも、AIの文（意味）が変わったものは引き継がず、前の修正を示す', () => {
    const { next, itemId, oldText } = changeOneItem(bundle);
    const edits = { responsible: '佐藤（仮）', [itemId]: '利用者が直した文' };
    const out = editsAfterReplace(edits, bundle, next);
    expect(out.kept).toEqual({ responsible: '佐藤（仮）' });
    expect(out.dropped).toEqual([expect.objectContaining({ key: itemId, reason: 'CHANGED', before: '利用者が直した文' })]);
    expect(out.dropped[0].label).toBeTruthy();
    expect(oldText).not.toBe('');
  });

  it('開始前の確認の記録（task:）と、財務前提（impact:）は、再生成でも引き継ぐ', () => {
    const { next } = changeOneItem(bundle);
    const edits = { 'task:verify-1': true, 'impact:customers': 12, 'stage3kpi:kr-renew-1:target': '3社' };
    const out = editsAfterReplace(edits, bundle, next);
    expect(out.kept).toEqual(edits);
    expect(out.dropped).toEqual([]);
  });

  it('案から無くなった項目への修正は、引き継がず「なくなった」として示す', () => {
    const out = editsAfterReplace({ 'action:999:title': '原案に無い修正' }, bundle, bundle);
    expect(out.kept).toEqual({});
    expect(out.dropped).toEqual([expect.objectContaining({ key: 'action:999:title', reason: 'REMOVED', before: '原案に無い修正' })]);
  });

  it('責任者と参考試算の前提は、AIの案に依らないので引き継ぐ', () => {
    const edits = { responsible: '佐藤（仮）', 'impact:startYear': 2027 };
    const { next } = changeOneItem(bundle);
    const out = editsAfterReplace(edits, bundle, next);
    expect(out.kept).toEqual(edits);
    expect(out.dropped).toEqual([]);
  });
});
