import { COMMERCIAL_GOLDEN_DRAFT } from '@/eval/plan/fixtures/commercial.golden';
import { entryAfterPersist, entryFromDraft, entryFromRecord, conflictRows, isDirty, type PlanDocEntry } from './planDocEntry';
import type { PlanDocRecord } from '@/lib/stage4/plan/planDocumentStore';

const DRAFT = { rawOutput: JSON.stringify(COMMERCIAL_GOLDEN_DRAFT) };
const record = (version: number, userEdits: Record<string, unknown>): PlanDocRecord => ({
  key: { companyId: 'c', strategyId: 's', projectId: 'p' },
  version,
  aiDraft: DRAFT,
  userEdits,
  adopted: false,
  updatedAt: '2026-11-10T00:00:00.000Z',
  updatedBy: 'bob',
});

describe('草案の画面の状態', () => {
  it('保存済みの版を開くと、利用者の修正をそのまま復元し、未保存ではない', () => {
    const e = entryFromRecord(record(3, { 'action:1:title': '修正済み' }));
    expect(e.plan.committed).toEqual({ 'action:1:title': '修正済み' });
    expect(e.stored?.version).toBe(3);
    expect(isDirty(e)).toBe(false);
  });

  it('修正すると、保存されていない状態になる', () => {
    const e = entryFromRecord(record(1, {}));
    const changed = { ...e, plan: { ...e.plan, committed: { 'action:1:title': '新しい' } } };
    expect(isDirty(changed)).toBe(true);
  });

  it('保存に成功すると版を更新し、保存中に入力した修正は失わない（統合が無い場合）', () => {
    const e = { ...entryFromDraft(DRAFT), plan: { ...entryFromDraft(DRAFT).plan, committed: { a: '保存中の入力' } } };
    const after = entryAfterPersist(e, { status: 'SAVED', stored: { version: 1, base: { a: '送った内容' }, adopted: false }, userEdits: { a: '送った内容' }, adopted: false, mergedFromRemote: false });
    expect(after.save).toEqual({ status: 'SAVED', version: 1, mergedFromRemote: false });
    expect(after.plan.committed).toEqual({ a: '保存中の入力' });
    expect(after.stored?.version).toBe(1);
  });

  it('失敗したら失敗と表示し、編集内容は変えない', () => {
    const e = { ...entryFromDraft(DRAFT), plan: { ...entryFromDraft(DRAFT).plan, committed: { a: '未保存' } } };
    const after = entryAfterPersist(e, { status: 'FAILED', message: '保存できませんでした。' });
    expect(after.save).toEqual({ status: 'FAILED', message: '保存できませんでした。' });
    expect(after.plan.committed).toEqual({ a: '未保存' });
    expect(after.stored).toBeNull();
  });

  it('競合は、自分の修正と他の人の修正を並べて示せる', () => {
    const e: PlanDocEntry = {
      ...entryFromRecord(record(1, { 'action:1:title': '元' })),
      plan: { ...entryFromRecord(record(1, {})).plan, committed: { 'action:1:title': 'あなたの案' } },
    };
    const after = entryAfterPersist(e, {
      status: 'CONFLICT',
      conflicts: ['action:1:title'],
      remote: record(2, { 'action:1:title': '相手の案' }),
      local: { 'action:1:title': 'あなたの案' },
      adopted: false,
    });
    const rows = conflictRows(after);
    expect(rows).toHaveLength(1);
    expect(rows[0].yours).toBe('あなたの案');
    expect(rows[0].theirs).toBe('相手の案');
    expect(after.plan.committed).toEqual({ 'action:1:title': 'あなたの案' });
  });
});
