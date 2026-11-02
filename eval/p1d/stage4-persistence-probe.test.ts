/* STAGE4 保存・復元の影響確認（モック・読み取り専用）。実 DB・実 API には接続しない。コードは変更しない。 */
import { buildDbRowFromState, buildStateFromDbRow } from '@/utils/supabase/strategy';
import { buildPlanData } from '@/utils/export/buildPlanData';

const DEPARTMENTS = [
  {
    id: 'dept-sales',
    name: '営業部',
    projects: [
      {
        id: 'proj-1',
        title: '新規顧客開拓',
        ownerName: '山田太郎',
        okrsV2: [{ id: 'kr-1', objective: '受注を増やす', owner: '山田太郎', due: '2027-03' }],
        humanInvestments: [{ id: 'hi-1', amount: 1200000, timingYm: '2027-01' }],
        impact: { revenueMJPY: 50 },
      },
    ],
  },
];

const STAGE4_PLANS = [
  {
    departmentId: 'dept-sales',
    status: 'Approved',
    baseline: { projects: [{ title: '新規顧客開拓', kpiTargets: { 'OKR1': 100 } }] },
    current: { projects: [{ title: '新規顧客開拓', kpiTargets: { 'OKR1': 120 }, valueDriverLinks: ['売上'] }] },
  },
];

const BASELINE = { companyId: 'company-a', createdAt: 1, snapshot: [] };

describe('A. 保存時に STAGE4 の計画が DB 行へ入らない', () => {
  it('stage4Plans・executionPlanBaseline は行に含まれず、current の編集値も含まれない', () => {
    const row: any = buildDbRowFromState({
      companyName: 'モック株式会社',
      departments: DEPARTMENTS,
      stage4Plans: STAGE4_PLANS,
      executionPlanBaseline: BASELINE,
    } as any);
    const keys = Object.keys(row);
    expect(keys).not.toEqual(expect.arrayContaining(['stage4_plans', 'stage4Plans', 'execution_plan_baseline', 'executionPlanBaseline']));
    const json = JSON.stringify(row);
    expect(json).not.toContain('"Approved"');
    expect(json).not.toContain('"valueDriverLinks"');
    expect(json).not.toContain('"OKR1":120');
  });

  it('departments 内の担当・期限・費用・OKR は DB 行に保存される', () => {
    const row: any = buildDbRowFromState({ companyName: 'x', departments: DEPARTMENTS } as any);
    const p = row.departments[0].projects[0];
    expect(p.ownerName).toBe('山田太郎');
    expect(p.okrsV2[0]).toMatchObject({ id: 'kr-1', owner: '山田太郎', due: '2027-03' });
    expect(p.humanInvestments[0]).toMatchObject({ amount: 1200000, timingYm: '2027-01' });
  });
});

describe('B. 別端末・再読込（DB からの復元）', () => {
  it('DB の departments は復元され、stage4Plans・executionPlanBaseline は空になる', () => {
    const row = { id: 'strategy-a', company_id: 'company-a', company_name: 'モック株式会社', departments: DEPARTMENTS };
    const state: any = buildStateFromDbRow(row);
    expect(state.departments[0].projects[0].okrsV2[0].due).toBe('2027-03');
    expect(state.departments[0].projects[0].humanInvestments[0].amount).toBe(1200000);
    expect(state.stage4Plans).toBeUndefined();
    expect(state.executionPlanBaseline).toBeUndefined();
  });
});

describe('C. 経営計画書の出力への影響', () => {
  const base = { departments: DEPARTMENTS, companyName: 'モック株式会社', mission: 'm', vision: 'v', value: 'x' } as any;

  it('stage4Plans の有無は、計画書の STAGE4 部分（プロジェクトの影響）を変えない', () => {
    const without = buildPlanData(base, 'bank');
    const withPlans = buildPlanData({ ...base, stage4Plans: STAGE4_PLANS }, 'bank');
    expect(withPlans.stage4).toEqual(without.stage4);
  });

  it('executionPlanBaseline の有無は、銀行向けの注記（月次CF計画）だけを変える', () => {
    const missing = buildPlanData(base, 'bank');
    const present = buildPlanData({ ...base, executionPlanBaseline: BASELINE }, 'bank');
    expect(missing.stage56.projectionNote).toContain('月次CF計画: 入力待機中');
    expect(present.stage56.projectionNote).not.toContain('月次CF計画: 入力待機中');
  });
});

describe('D. 現状は未使用の対応づけ（潜在リスクの確認）', () => {
  it('executionPlans が値を持つと、存在しない列 execution_plans への書き込みになる（現状は値が入らないため発生しない）', () => {
    const none: any = buildDbRowFromState({ companyName: 'x', departments: DEPARTMENTS } as any);
    expect(Object.keys(none)).not.toContain('execution_plans');
    const set: any = buildDbRowFromState({ companyName: 'x', departments: DEPARTMENTS, executionPlans: [{}] } as any);
    expect(Object.keys(set)).toContain('execution_plans');
  });
});
