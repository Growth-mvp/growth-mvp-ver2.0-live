import { COMMERCIAL_GOLDEN_DRAFT } from '@/eval/plan/fixtures/commercial.golden';
import { entryAfterPersist, entryFromDraft, entryFromRecord, conflictRows, isDirty, saveWillReset, type PlanDocEntry } from './planDocEntry';
import type { PlanDocRecord } from '@/lib/stage4/plan/planDocumentStore';
import { regulatoryComplete } from '@/lib/stage4/planView/model';

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

  it('保存先が項目の順を変えて返しても、同じ修正なら未保存とは扱わない', () => {
    const e = entryFromRecord(record(2, { 'action:1:title': '案', responsible: '山田' }));
    const reordered = { ...e, plan: { ...e.plan, committed: { responsible: '山田', 'action:1:title': '案' } } };
    expect(isDirty(reordered)).toBe(false);
  });

  it('保存に成功すると版を更新し、保存中に入力した修正は失わない（統合が無い場合）', () => {
    const e = { ...entryFromDraft(DRAFT), plan: { ...entryFromDraft(DRAFT).plan, committed: { a: '保存中の入力' } } };
    const after = entryAfterPersist(e, {
      status: 'SAVED',
      stored: { version: 1, base: { a: '送った内容' }, adopted: false },
      record: record(1, { a: '送った内容' }),
      userEdits: { a: '送った内容' },
      adopted: false,
      mergedFromRemote: false,
    });
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

describe('保存後の採用・規制・開始の表示（DBの状態と一致させる）', () => {
  const adoptedRecord = (version: number, userEdits: Record<string, unknown>): PlanDocRecord => ({
    ...record(version, userEdits),
    adopted: true,
    adoption: { version: version - 1, byUserId: 'bob', at: '2026-11-10T00:00:00.000Z', edits: {} },
  });
  const savedResult = (r: PlanDocRecord) => ({
    status: 'SAVED' as const,
    stored: { version: r.version, base: r.userEdits, adopted: r.adopted },
    record: r,
    userEdits: r.userEdits,
    adopted: r.adopted,
    mergedFromRemote: false,
  });
  const regulatory = { decision: 'NOT_APPLICABLE' as const, judgement: '対象外', confirmer: '確認者', confirmedOn: '2026-11-10', basis: '根拠' };

  it('採用済みの計画を修正すると、保存で解除されることを示す（内容が変わらなければ示さない）', () => {
    const e = entryFromRecord(adoptedRecord(3, {}));
    expect(saveWillReset({ ...e, plan: { ...e.plan, committed: { responsible: '山田' } } })).toBe(true);
    expect(saveWillReset(e)).toBe(false);
  });

  it('採用も記録も無い計画は、修正しても解除の警告を出さない', () => {
    const e = entryFromRecord(record(1, {}));
    expect(saveWillReset({ ...e, plan: { ...e.plan, committed: { responsible: '山田' } } })).toBe(false);
  });

  it('保存で解除されたら、採用・開始・規制の表示もサーバーの状態に合わせ、理由を示す', () => {
    const before = entryFromRecord({ ...adoptedRecord(3, {}), startInfo: { version: 3, byUserId: 'bob', at: '2026-11-10T00:00:00.000Z' }, regulatory });
    const edited = { ...before, plan: { ...before.plan, committed: { responsible: '山田' } } };
    const after = entryAfterPersist(edited, savedResult({ ...record(4, { responsible: '山田' }), adopted: false, adoption: null, startInfo: null }));
    expect(after.plan.adopted).toBe(false);
    expect(after.plan.started).toBe(false);
    expect(regulatoryComplete(after.plan.regulatory)).toBe(false);
    expect(after.server?.adoption).toBeNull();
    expect(after.server?.startInfo).toBeNull();
    expect(after.notice).toContain('解除');
  });

  it('内容が変わらない保存では、採用は残り、解除の説明も出さない', () => {
    const e = entryFromRecord(adoptedRecord(3, { a: '同じ' }));
    const after = entryAfterPersist(e, savedResult(adoptedRecord(4, { a: '同じ' })));
    expect(after.plan.adopted).toBe(true);
    expect(after.notice).toBeNull();
  });

  it('記録が無い計画の保存では、解除の説明を出さない', () => {
    const e = entryFromRecord(record(1, {}));
    const after = entryAfterPersist({ ...e, plan: { ...e.plan, committed: { a: '新' } } }, savedResult(record(2, { a: '新' })));
    expect(after.notice).toBeNull();
  });
});
