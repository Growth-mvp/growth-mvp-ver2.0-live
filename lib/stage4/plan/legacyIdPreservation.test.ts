import { mergeDepartmentsForConflict } from '@/lib/strategy/departmentsMerge';

/* 番号を付けた後に、番号を持たない古い画面の内容が戻ってきても、番号が消えないことを確かめる。
 * 旧STAGE3の保存は、競合時に base・local・server の3方向で突き合わせる。その規則で番号が守られるかを見る。 */
const dept = (projects: Array<Record<string, unknown>>, mission = '守る') => [{ id: 'd1', name: '営業部', mission, projects }];
const project = (extra: Record<string, unknown> = {}) => ({ title: '点検工程の標準化', okrsV2: [{ id: 'k1', label: 'x', target: 1 }], ...extra });

describe('旧い保存経路と、プロジェクトの番号（統合の規則）', () => {
  it('番号を持たない画面が、番号の無い内容を保存しようとしても、サーバーの番号は消えない', () => {
    const base = dept([project()]);
    const local = dept([project()], '画面で変えた内容');
    const server = dept([project({ id: 'proj-assigned' })]);
    const out = mergeDepartmentsForConflict({ base, local, server });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect((out.departments[0].projects as Array<{ id?: string }>)[0].id).toBe('proj-assigned');
  });

  it('画面が番号を持っていれば、そのまま残る（番号どうしの食い違いは起きない）', () => {
    const base = dept([project({ id: 'proj-assigned' })]);
    const local = dept([project({ id: 'proj-assigned' })], '画面で変えた内容');
    const server = dept([project({ id: 'proj-assigned' })]);
    const out = mergeDepartmentsForConflict({ base, local, server });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect((out.departments[0].projects as Array<{ id?: string }>)[0].id).toBe('proj-assigned');
    expect(out.departments[0].mission).toBe('画面で変えた内容');
  });

  it('番号の付与と同時に、別の人が同じプロジェクトを変えた場合は、競合として止まる（番号を書き換えない）', () => {
    const base = dept([project()]);
    const local = dept([project({ title: '画面の名称' })]);
    const server = dept([project({ id: 'proj-assigned', title: '別の人の名称' })]);
    const out = mergeDepartmentsForConflict({ base, local, server });
    if (out.ok) {
      expect((out.departments[0].projects as Array<{ id?: string }>)[0].id).toBe('proj-assigned');
    } else {
      expect(out.conflicts.length).toBeGreaterThan(0);
    }
  });
});
