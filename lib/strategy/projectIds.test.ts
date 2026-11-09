import { assignMissingProjectIds, effectiveProjectId, findDuplicateProjectIds } from './projectIds';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
let seq = 0;
const fakeNewId = () => `new-${++seq}`;

describe('IDのないプロジェクトへの付与', () => {
  it('IDのないプロジェクトだけに付与し、既にあるID（位置由来の proj_0_0 を含む）は変えない', () => {
    const input = [
      { name: '設計部', projects: [{ id: 'proj_0_0', title: '既存' }, { title: '新規' }, { id: 'uuid-keep', title: '保持' }] },
    ];
    const before = JSON.parse(JSON.stringify(input));
    const out = assignMissingProjectIds(input, fakeNewId);
    expect(out.assigned).toBe(1);
    expect(out.departments[0].projects[0]).toEqual({ id: 'proj_0_0', title: '既存' });
    expect(out.departments[0].projects[1]).toEqual({ id: 'new-1', title: '新規' });
    expect(out.departments[0].projects[2]).toEqual({ id: 'uuid-keep', title: '保持' });
    expect(input).toEqual(before);
  });

  it('変更がなければ、元の配列をそのまま返す', () => {
    const input = [{ name: '設計部', projects: [{ id: 'a', title: 'x' }] }];
    const out = assignMissingProjectIds(input, fakeNewId);
    expect(out.assigned).toBe(0);
    expect(out.departments).toBe(input);
  });

  it('既定の付与は、配列の位置に依らないUUIDになる（同じ位置でも毎回違う）', () => {
    const out = assignMissingProjectIds([{ name: 'd', projects: [{ title: 'a' }, { title: 'b' }] }]);
    const [a, b] = (out.departments[0].projects as unknown as Array<{ id: string }>).map((p) => p.id);
    expect(a).toMatch(UUID);
    expect(b).toMatch(UUID);
    expect(a).not.toBe(b);
    expect(a).not.toMatch(/^proj_/);
    const again = assignMissingProjectIds(out.departments);
    expect(again.assigned).toBe(0);
  });

  it('projectId を持つものは、それを id として扱い、新しいIDを付けない', () => {
    expect(effectiveProjectId({ projectId: 'pj-1' })).toBe('pj-1');
    expect(assignMissingProjectIds([{ name: 'd', projects: [{ projectId: 'pj-1' }] }], fakeNewId).assigned).toBe(0);
  });
});

describe('重複したIDの検出（自動では直さない）', () => {
  it('同じIDが複数のプロジェクトにあれば、その場所を返す', () => {
    const dups = findDuplicateProjectIds([
      { name: '設計部', projects: [{ id: 'dup', title: 'a' }, { id: 'ok', title: 'b' }] },
      { name: '営業部', projects: [{ id: 'dup', title: 'c' }] },
    ]);
    expect(dups).toEqual([
      {
        id: 'dup',
        locations: [
          { departmentIndex: 0, projectIndex: 0 },
          { departmentIndex: 1, projectIndex: 0 },
        ],
      },
    ]);
  });

  it('重複がなければ空。IDのないプロジェクトは重複扱いしない', () => {
    expect(findDuplicateProjectIds([{ name: 'd', projects: [{ title: 'a' }, { title: 'b' }, { id: 'x' }] }])).toEqual([]);
  });
});
