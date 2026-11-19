import { hasLocalDepartmentEdits } from './departmentsMerge';

const deptWithProject = (projectIds: string[]) => [
  { name: '営業部', mission: '顧客を広げる', projects: projectIds.map((id) => ({ id, title: `案${id}` })) },
];

describe('復元時に、キャッシュ由来の部門を残さない', () => {
  it('最後の同期がない（ブラウザのキャッシュだけで復元した）場合は、DBの部門を優先する', () => {
    const cached = deptWithProject(['p1', 'p2']);
    expect(hasLocalDepartmentEdits(cached, undefined)).toBe(false);
  });

  it('同期済みの内容から変わっていなければ、削除されたプロジェクトを復活させない', () => {
    const lastSynced = deptWithProject(['p1', 'p2']);
    const cachedAfterDbDeletion = deptWithProject(['p1', 'p2']);
    expect(hasLocalDepartmentEdits(cachedAfterDbDeletion, lastSynced)).toBe(false);
  });

  it('利用者が部門を変えた場合は、その変更を残す', () => {
    const lastSynced = deptWithProject(['p1', 'p2']);
    const edited = deptWithProject(['p1']);
    expect(hasLocalDepartmentEdits(edited, lastSynced)).toBe(true);
  });

  it('空の部門一覧に対しても、同期済みと同じなら変更なしとみなす', () => {
    expect(hasLocalDepartmentEdits([], [])).toBe(false);
    expect(hasLocalDepartmentEdits(deptWithProject(['p1']), [])).toBe(true);
  });
});
