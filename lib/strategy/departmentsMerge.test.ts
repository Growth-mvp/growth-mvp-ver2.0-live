import { assessRevisionAdvance, mergeDepartmentsForConflict } from './departmentsMerge';

const proj = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `案${id}`, okrs: [], ...extra });
const dept = (projects: any[], extra: Record<string, unknown> = {}) => ({ name: '営業部', mission: '顧客を広げる', projects, ...extra });

describe('別々のプロジェクトを、それぞれの利用者が変えた場合', () => {
  it('他の利用者の追加と、自分の編集の両方を残す', () => {
    const base = [dept([proj('p1')])];
    const local = [dept([proj('p1', { executionHumanInvestments: [{ id: 'h' }] })])];
    const server = [dept([proj('p1'), proj('p2')])];
    const out = mergeDepartmentsForConflict({ base, local, server });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.departments[0].projects.map((p: any) => p.id)).toEqual(['p1', 'p2']);
      expect(out.departments[0].projects[0].executionHumanInvestments).toEqual([{ id: 'h' }]);
    }
  });

  it('他の利用者が更新した OKR を、自分が触っていないプロジェクトで保持する', () => {
    const base = [dept([proj('p1', { okrs: [{ objective: 'a' }] })])];
    const local = [dept([proj('p1', { okrs: [{ objective: 'a' }] })])];
    const server = [dept([proj('p1', { okrs: [{ objective: 'a' }, { objective: 'b（他の人）' }] })])];
    const out = mergeDepartmentsForConflict({ base, local, server });
    expect(out.ok && out.departments[0].projects[0].okrs).toEqual([{ objective: 'a' }, { objective: 'b（他の人）' }]);
  });

  it('部門の内容（ミッション）を自分だけが変えた場合は、自分の変更を残す', () => {
    const base = [dept([proj('p1')])];
    const local = [dept([proj('p1')], { mission: '自分の新しいミッション' })];
    const server = [dept([proj('p1'), proj('p2')])];
    const out = mergeDepartmentsForConflict({ base, local, server });
    expect(out.ok && out.departments[0].mission).toBe('自分の新しいミッション');
    expect(out.ok && out.departments[0].projects.map((p: any) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('同じ項目を両方が違う内容に変えた場合は、自動で選ばない（競合）', () => {
  it('同じプロジェクトを両方が変えたら、競合として返す', () => {
    const base = [dept([proj('p1', { planStatus: 'draft' })])];
    const local = [dept([proj('p1', { planStatus: 'draft', executionHumanInvestments: [{ id: 'h' }] })])];
    const server = [dept([proj('p1', { planStatus: 'review' })])];
    const out = mergeDepartmentsForConflict({ base, local, server });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.conflicts).toEqual([{ departmentName: '営業部', projectId: 'p1', title: '案p1' }]);
  });

  it('部門の同じ項目を両方が違う内容に変えたら、競合として返す', () => {
    const base = [dept([])];
    const local = [dept([], { mission: '自分' })];
    const server = [dept([], { mission: '他の人' })];
    const out = mergeDepartmentsForConflict({ base, local, server });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.conflicts[0]).toEqual({ departmentName: '営業部', projectId: null, title: 'mission' });
  });

  it('両方が同じ内容に変えたなら、競合にしない', () => {
    const base = [dept([proj('p1')])];
    const changed = [dept([proj('p1', { planStatus: 'review' })])];
    expect(mergeDepartmentsForConflict({ base, local: changed, server: changed }).ok).toBe(true);
  });
});

describe('削除', () => {
  it('自分が消したプロジェクトは、他の利用者が触っていなければ消える', () => {
    const base = [dept([proj('p1'), proj('p2')])];
    const local = [dept([proj('p1')])];
    const server = [dept([proj('p1'), proj('p2')])];
    const out = mergeDepartmentsForConflict({ base, local, server });
    expect(out.ok && out.departments[0].projects.map((p: any) => p.id)).toEqual(['p1']);
  });

  it('他の利用者が消したプロジェクトを、自分が触っていなければ消したままにする', () => {
    const base = [dept([proj('p1'), proj('p2')])];
    const local = [dept([proj('p1'), proj('p2')])];
    const server = [dept([proj('p1')])];
    const out = mergeDepartmentsForConflict({ base, local, server });
    expect(out.ok && out.departments[0].projects.map((p: any) => p.id)).toEqual(['p1']);
  });

  it('他の利用者が消したプロジェクトを、自分が編集していたら競合にする', () => {
    const base = [dept([proj('p1')])];
    const local = [dept([proj('p1', { executionHumanInvestments: [{ id: 'h' }] })])];
    const server = [dept([])];
    expect(mergeDepartmentsForConflict({ base, local, server }).ok).toBe(false);
  });
});

describe('追加された部門', () => {
  it('他の利用者が追加した部門、自分が追加した部門は、どちらも残す', () => {
    const base = [dept([])];
    const local = [dept([]), { name: '開発部', projects: [proj('d1')] }];
    const server = [dept([]), { name: '総務部', projects: [proj('g1')] }];
    const out = mergeDepartmentsForConflict({ base, local, server });
    expect(out.ok && out.departments.map((d: any) => d.name)).toEqual(['営業部', '総務部', '開発部']);
  });
});

describe('revision の進みの判定', () => {
  it('進んでいれば advanced、進んでいなければ not_advanced、不明なら unknown', () => {
    expect(assessRevisionAdvance({ before: 5, after: 6 })).toBe('advanced');
    expect(assessRevisionAdvance({ before: 5, after: 5 })).toBe('not_advanced');
    expect(assessRevisionAdvance({ before: undefined, after: 5 })).toBe('unknown');
    expect(assessRevisionAdvance({ before: 5, after: undefined })).toBe('unknown');
  });
});

describe('DB を通して返された JSON（キーの並びが変わる）', () => {
  it('キーの並びだけが違う同じプロジェクトは、変更として扱わない（誤った競合を作らない）', () => {
    const base = [dept([{ id: 'p1', title: '既存', planStatus: 'approved', executionHumanInvestments: [{ id: 'h1' }], okrs: [] }])];
    const local = [dept([{ id: 'p1', title: '既存', planStatus: 'approved', executionHumanInvestments: [{ id: 'h1' }, { id: 'h2' }], okrs: [] }])];
    const server = [
      dept([
        { okrs: [], title: '既存', id: 'p1', executionHumanInvestments: [{ id: 'h1' }], planStatus: 'approved' },
        { id: 'added', title: '追加', okrs: [] },
      ]),
    ];
    const out = mergeDepartmentsForConflict({ base, local, server });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.departments[0].projects.map((p: any) => p.id)).toEqual(['p1', 'added']);
  });
});
