import type { Department } from '@/types/strategy';
import { projectInvestmentLabels } from './projectInvestment';

const capex = (id: string, cost: number) => ({
  id,
  skillName: '設備',
  cost,
  spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2027-03' },
});

const departments = [
  {
    name: '営業部',
    projects: [
      { title: '採用による体制強化', planStatus: 'draft', skillPlans: [capex('s1', 100_000_000)] },
      { title: '既存顧客の深耕', planStatus: 'approved', skillPlans: [capex('s2', 30_000_000)] },
      { title: '文化施設事業の知見を商業・ホテル施設へ展開', planStatus: 'draft', impactRevenueMJPY: 120 },
    ],
  },
] as unknown as Department[];

describe('施策ごとの投資額の表示', () => {
  it('支出の登録がある施策は合計と承認状態を示す', () => {
    const labels = projectInvestmentLabels(departments);
    expect(labels.get('採用による体制強化')).toBe('100.0百万円（承認未確認）');
    expect(labels.get('既存顧客の深耕')).toBe('30.0百万円（承認済み）');
  });

  it('支出の登録がない施策は含めない（「未定」として扱う）', () => {
    const labels = projectInvestmentLabels(departments);
    expect(labels.has('文化施設事業の知見を商業・ホテル施設へ展開')).toBe(false);
  });

  it('同名の施策が複数あるときは、どの施策か特定できないため含めない', () => {
    const duplicated = [
      { name: '営業部', projects: [{ title: '同名', planStatus: 'approved', skillPlans: [capex('a', 10_000_000)] }] },
      { name: '製造部', projects: [{ title: '同名', planStatus: 'approved', skillPlans: [capex('b', 20_000_000)] }] },
    ] as unknown as Department[];
    expect(projectInvestmentLabels(duplicated).has('同名')).toBe(false);
  });

  it('承認未確認の投資を承認済みとして示さない', () => {
    const mixed = [
      {
        name: '営業部',
        projects: [
          {
            title: '混在',
            planStatus: 'approved',
            skillPlans: [capex('m1', 10_000_000), { ...capex('m2', 5_000_000), spend: undefined }],
          },
        ],
      },
    ] as unknown as Department[];
    expect(projectInvestmentLabels(mixed).get('混在')).toBe('10.0百万円（承認済み）');
  });
});
