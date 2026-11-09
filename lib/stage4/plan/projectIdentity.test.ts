import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { assignProjectId } from './projectIdentity';

const depts = () => JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0].departments)) as Array<Record<string, unknown>>;
const withoutId = (list: Array<Record<string, unknown>>, di: number, pi: number) => {
  const copy = JSON.parse(JSON.stringify(list)) as Array<{ projects: Array<Record<string, unknown>> }>;
  delete copy[di].projects[pi].id;
  return copy;
};

describe('assignProjectId（IDのない既存プロジェクトへの一度だけの付与）', () => {
  it('対象のプロジェクトだけに id を付け、他の項目は変えない', () => {
    const list = withoutId(depts(), 0, 0);
    const before = JSON.parse(JSON.stringify(list));
    const r = assignProjectId({ departments: list, departmentIndex: 0, projectIndex: 0, expectedTitle: '既存顧客の保守契約更新', newId: 'new-1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = r.departments as typeof before;
    expect(after[0].projects[0]).toEqual({ ...before[0].projects[0], id: 'new-1' });
    expect(after[0].projects[1]).toEqual(before[0].projects[1]);
    expect(after[1]).toEqual(before[1]);
    expect(list).toEqual(before);
  });

  it('画面で見ていた名称と違えば付けない（並び替え後に別のプロジェクトへ付けない）', () => {
    const list = withoutId(depts(), 0, 0);
    const r = assignProjectId({ departments: list, departmentIndex: 0, projectIndex: 0, expectedTitle: '新規顧客開拓', newId: 'new-1' });
    expect(r).toEqual({ ok: false, reason: 'TITLE_CHANGED' });
  });

  it('既に安定IDがあれば、付け直さずそのIDを返す', () => {
    const r = assignProjectId({ departments: depts(), departmentIndex: 0, projectIndex: 0, expectedTitle: '既存顧客の保守契約更新', newId: 'x' });
    expect(r).toEqual({ ok: false, reason: 'ALREADY_HAS_ID', projectId: 'fict-proj-renewal' });
  });

  it('同じIDが戦略内で既に使われていれば付けない', () => {
    const list = withoutId(depts(), 0, 0);
    const r = assignProjectId({ departments: list, departmentIndex: 0, projectIndex: 0, expectedTitle: '既存顧客の保守契約更新', newId: 'fict-proj-inspection' });
    expect(r).toEqual({ ok: false, reason: 'ID_IN_USE' });
  });

  it('存在しない位置は NOT_FOUND', () => {
    const r = assignProjectId({ departments: depts(), departmentIndex: 9, projectIndex: 0, expectedTitle: 'x', newId: 'n' });
    expect(r).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });
});
