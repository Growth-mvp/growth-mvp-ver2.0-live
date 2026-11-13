import { listAccessibleProjects, projectKeyOf } from '@/lib/stage4/plan/projectResolver';
import { planConfirm, type ConfirmAdoption } from './stage3Confirm';

/* 確定後の部門データを、STAGE4の一覧・照合が読むときの対応を確かめる。
 * 既存の計画（ID・KPI・位置によるキー）は、新規採用の前後で変わらないこと。 */

const before = () => [
  {
    id: 'd-sales',
    name: '営業部',
    projects: [
      {
        id: 'p-1',
        title: '既存顧客の再受注施策',
        okrs: [{ id: 'o-1', objective: '再受注', keyResults: ['再受注率 40%'] }],
        kpis: ['商談数 120件'],
      },
    ],
  },
  { id: 'd-mkt', name: 'マーケティング部', projects: [{ title: '旧データの計画（ID無し）' }] },
];

const adoption: ConfirmAdoption = {
  departmentKey: 'id:d-sales',
  departmentName: '営業部',
  project: {
    id: 'cand-temp',
    title: '6問を反映した新しい案',
    hypothesis: '既存顧客の失注理由を減らせる',
    okrs: [{ id: 'old-okr', objective: '新しい目標', keyResults: ['新しい指標'] }],
  },
};

const listing = (departments: unknown[]) =>
  listAccessibleProjects({
    memberships: [{ company_id: 'c1', role: 'member' }],
    strategies: [{ id: 's1', company_id: 'c1', departments }],
  });

describe('確定後のSTAGE4への引き継ぎ', () => {
  const plan = planConfirm({ departments: before(), changes: [], adoptions: [adoption], mintId: () => 'p-new-1' });
  if (!plan.ok) throw new Error('adoption must succeed in this fixture');
  const after = plan.departments;

  it('既存の計画は、同じIDと同じキーで見える', () => {
    const b = listing(before());
    const a = listing(after);
    const pick = (rows: typeof b, title: string) => rows.find((r) => r.projectTitle === title);
    expect(pick(a, '既存顧客の再受注施策')).toMatchObject({
      stableId: 'p-1',
      projectKey: 'id:p-1',
      departmentIndex: 0,
      projectIndex: 0,
    });
    expect(pick(a, '既存顧客の再受注施策')?.projectKey).toBe(pick(b, '既存顧客の再受注施策')?.projectKey);
    expect(pick(a, '旧データの計画（ID無し）')?.projectKey).toBe(pick(b, '旧データの計画（ID無し）')?.projectKey);
  });

  it('採用した新規プロジェクトは、新しいIDで、営業部の末尾に見える', () => {
    const rows = listing(after).filter((r) => r.departmentName === '営業部');
    expect(rows.map((r) => r.projectTitle)).toEqual(['既存顧客の再受注施策', '6問を反映した新しい案']);
    expect(rows[1]).toMatchObject({ stableId: 'p-new-1', projectKey: 'id:p-new-1', projectIndex: 1 });
    expect(rows[1].projectKey).not.toBe(rows[0].projectKey);
  });

  it('既存の計画のKPIとOKRは、新規採用の前後で同じ内容のまま', () => {
    const sales = after[0].projects as Array<Record<string, unknown>>;
    expect(sales).toHaveLength(2);
    expect(sales[0]).toEqual(before()[0].projects[0]);
    expect(JSON.stringify(sales[0])).toBe(JSON.stringify(before()[0].projects[0]));
  });

  it('採用した新規プロジェクトには、以前のOKRのIDを持ち込まない（進捗の引き継ぎを防ぐ）', () => {
    const added = (after[0].projects as Array<Record<string, unknown>>)[1];
    expect(added.okrs).toEqual([{ objective: '新しい目標', keyResults: ['新しい指標'] }]);
    expect(added.hypothesis).toBe('既存顧客の失注理由を減らせる');
  });

  it('旧データの計画は、ID無しの位置キーのまま（IDを自動で付けない）', () => {
    const keys = listing(after).filter((r) => r.departmentName === 'マーケティング部').map((r) => r.projectKey);
    expect(keys).toEqual([projectKeyOf({ title: '旧データの計画（ID無し）' }, 1, 0)]);
    expect(keys[0]).toBe('d1-p0');
  });
});
