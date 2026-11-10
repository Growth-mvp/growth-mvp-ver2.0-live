import { FINANCIAL_ACTUAL_NOTE, buildKrPlanActualRows } from './krPlanActual';

const departments = [
  {
    id: 'd1',
    name: '営業部',
    projects: [
      {
        id: 'p-coating',
        title: '塗料メーカー向けプロジェクト',
        okrsV2: [
          { id: 'k-proposals', label: '設計段階の有効提案数', target: 6, unit: '件', due: '2027-02', actual: { value: 3, asOf: '2027-01', recordedAt: 'r' } },
          { id: 'k-paid', label: '有償開発受注数', target: 3, unit: '件', due: '2027-03' },
          { id: 'k-rate', label: '継続率', target: 95, unit: '%', due: '2027-06', actual: { value: 90, asOf: '2027-01', recordedAt: 'r' } },
          { label: 'IDのないKR', target: 1, unit: '件' },
          { id: 'k-noplan', label: '計画なし', target: null, unit: '件', actual: { value: 2, asOf: '2027-01', recordedAt: 'r' } },
        ],
        executionProgress: {
          a: { status: 'DONE', result: '', krIds: ['k-proposals'], updatedAt: 't', updatedBy: 'u' },
          b: { status: 'IN_PROGRESS', result: '', krIds: ['k-proposals'], updatedAt: 't', updatedBy: 'u' },
        },
      },
    ],
  },
];

describe('STAGE6のKR計画・実績の比較', () => {
  const rows = buildKrPlanActualRows(departments)[0].rows;
  const byId = (id: string) => rows.find((r) => r.krId === id)!;

  it('同じKR・同じ単位の計画と実績を比べ、達成率と差異を出す（6件に対して3件＝50%）', () => {
    const r = byId('k-proposals');
    expect(r.status).toBe('COMPARABLE');
    expect(r.achievementPct).toBe(50);
    expect(r.difference).toBe(-3);
    expect(r.unit).toBe('件');
  });

  it('実績が無いKRは、実績を作らず「実績未登録」にする', () => {
    const r = byId('k-paid');
    expect(r.status).toBe('NO_ACTUAL');
    expect(r.actual).toBeNull();
    expect(r.achievementPct).toBeNull();
  });

  it('計画（目標）が無いKRは比べない', () => {
    expect(byId('k-noplan').status).toBe('NO_PLAN');
    expect(byId('k-noplan').achievementPct).toBeNull();
  });

  it('IDのないKRは比べず、理由を示す（別のKRと取り違えない）', () => {
    const r = rows.find((x) => x.label === 'IDのないKR')!;
    expect(r.status).toBe('NO_ID');
  });

  it('実施事項の完了数は、そのKRに紐づけた記録だけで数える', () => {
    const r = byId('k-proposals');
    expect(r.linkedTotal).toBe(2);
    expect(r.linkedDone).toBe(1);
    expect(byId('k-paid').linkedTotal).toBe(0);
  });

  it('財務の実績は登録されていないと明示する（金額を作らない）', () => {
    expect(FINANCIAL_ACTUAL_NOTE).toContain('実績未登録');
  });

  it('KRの比率（%）も、同じ単位どうしで比べる', () => {
    expect(byId('k-rate').achievementPct).toBeCloseTo(94.7, 1);
  });
});
