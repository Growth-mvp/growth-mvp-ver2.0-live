import { buildStage4ReadModel, readKpisOf, type SavedPlanRecord } from './readModel';
import { resolveProjectScope, type MembershipRow, type StrategyRow } from './projectResolver';

const CO_A = 'co-a';
const CO_B = 'co-b';

const projA1 = {
  title: '法人顧客の新規獲得',
  hypothesis: '既存の配送先の単価を上げる',
  rationale: '単価の下落が続いている',
  role: 'REVENUE',
  okrsV2: [
    { id: 'a1-c', label: '法人顧客の契約数', target: 10, unit: '件', due: '2027-04', owner: '田中', targetBasis: 'USER_CONFIRMED' },
    { id: 'a1-u', label: '既存配送先の単価', target: 0, unit: '%', due: '2027-05', owner: null },
    { id: 'a1-ai', label: '商談の件数', target: 5, unit: '件', due: '2027-06', owner: null, targetBasis: 'AI_PROVISIONAL' },
  ],
};
const projA2 = {
  title: '配送ルートの最適化',
  role: 'COST',
  okrsV2: [{ id: 'a2-c', label: '配送時間の短縮率', target: 15, unit: '%', due: '2027-08', owner: null, targetBasis: 'USER_CONFIRMED' }],
};
const projB = {
  title: '法人顧客の新規獲得',
  okrsV2: [{ id: 'b-c', label: '他社だけの秘密のKPI', target: 99, unit: '件', due: '2027-01', owner: null, targetBasis: 'USER_CONFIRMED' }],
};

const strategies: StrategyRow[] = [
  { id: 'st-a', company_id: CO_A, departments: [{ name: '物流営業部', mission: '法人顧客の獲得を進める', strategy: '既存配送先の単価を上げる', projects: [projA1, projA2] }] },
  { id: 'st-b', company_id: CO_B, departments: [{ name: '物流営業部', projects: [projB] }] },
];
const memberA: MembershipRow[] = [{ company_id: CO_A, role: 'member' }];

const base = { memberships: memberA, strategies, projectTitle: '法人顧客の新規獲得', savedPlans: [] as SavedPlanRecord[] };

describe('プロジェクトの照合（resolveProjectScope）', () => {
  it('正常：所属企業の戦略の中で、プロジェクトが一意に決まる', () => {
    const r = resolveProjectScope(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.project.companyId).toBe(CO_A);
      expect(r.project.strategyId).toBe('st-a');
      expect(r.project.departmentName).toBe('物流営業部');
    }
  });

  it('他社の戦略IDを指定すると拒否する（所属していない企業の戦略は見えない）', () => {
    expect(resolveProjectScope({ ...base, requestedStrategyId: 'st-b' })).toEqual({ ok: false, reason: 'STRATEGY_NOT_ACCESSIBLE' });
  });

  it('所属していない企業を指定すると拒否する', () => {
    expect(resolveProjectScope({ ...base, requestedCompanyId: CO_B })).toEqual({ ok: false, reason: 'COMPANY_NOT_ACCESSIBLE' });
  });

  it('他社にしかないプロジェクトは、自社の戦略では見つからない', () => {
    const r = resolveProjectScope({ ...base, projectTitle: '他社だけの案件' });
    expect(r).toEqual({ ok: false, reason: 'PROJECT_NOT_FOUND' });
  });

  it('プロジェクトIDが合わなければ拒否する（IDを持たないプロジェクトに、IDを指定した場合も含む）', () => {
    expect(resolveProjectScope({ ...base, projectId: 'other-id' })).toEqual({ ok: false, reason: 'PROJECT_NOT_FOUND' });
  });

  it('同じ名前のプロジェクトが複数あると、対象を決めずに拒否する', () => {
    const dup: StrategyRow[] = [
      { id: 'st-a', company_id: CO_A, departments: [{ name: '部門1', projects: [projA1] }, { name: '部門2', projects: [projA1] }] },
    ];
    expect(resolveProjectScope({ ...base, strategies: dup })).toEqual({ ok: false, reason: 'PROJECT_AMBIGUOUS' });
    expect(resolveProjectScope({ ...base, strategies: dup, departmentName: '部門2' }).ok).toBe(true);
  });

  it('権限がない（所属していない・許されていない役割）と拒否する', () => {
    expect(resolveProjectScope({ ...base, memberships: [] })).toEqual({ ok: false, reason: 'NO_ACCESS' });
    expect(resolveProjectScope({ ...base, memberships: [{ company_id: CO_A, role: 'viewer' }] })).toEqual({ ok: false, reason: 'NO_ACCESS' });
  });
});

describe('段階Aの読み取りモデル（buildStage4ReadModel）', () => {
  it('確定KPI・確定の印が無いKPI・AI仮提案KPIを分けて返す。目標0は0のまま', () => {
    const m = buildStage4ReadModel(base);
    expect(m.status).toBe('READY');
    if (m.status !== 'READY') return;
    expect(m.kpis.confirmed.map((k) => k.label)).toEqual(['法人顧客の契約数']);
    expect(m.kpis.unconfirmed.map((k) => ({ label: k.label, target: k.target }))).toEqual([{ label: '既存配送先の単価', target: 0 }]);
    expect(m.kpis.aiProvisional.map((k) => k.label)).toEqual(['商談の件数']);
    expect(m.department).toEqual({ name: '物流営業部', mission: '法人顧客の獲得を進める', missionDescription: null, strategy: '既存配送先の単価を上げる' });
    expect(m.project).toEqual({ title: '法人顧客の新規獲得', objective: null, hypothesis: '既存の配送先の単価を上げる', rationale: '単価の下落が続いている', role: 'REVENUE' });
  });

  it('他社のKPIは、どのプロジェクトの表示にも混ざらない', () => {
    const m = buildStage4ReadModel(base);
    const text = JSON.stringify(m);
    expect(text).not.toContain('他社だけの秘密のKPI');
  });

  it('プロジェクトを切り替えると、別の計画・KPIになる（保存済みの計画も混ざらない）', () => {
    const saved: SavedPlanRecord[] = [
      { companyId: CO_A, strategyId: 'st-a', projectKey: 'd0-p0', savedAt: '2026-11-01', kpiSnapshot: [{ label: '法人顧客の契約数', target: 10 }], plan: { note: 'プロジェクト1の計画' } },
    ];
    const first = buildStage4ReadModel({ ...base, savedPlans: saved });
    const second = buildStage4ReadModel({ ...base, projectTitle: '配送ルートの最適化', savedPlans: saved });
    expect(first.status === 'READY' && first.savedPlan.state).toBe('SAVED');
    expect(second.status === 'READY' && second.savedPlan.state).toBe('NONE');
    expect(second.status === 'READY' && second.kpis.confirmed.map((k) => k.label)).toEqual(['配送時間の短縮率']);
  });

  it('保存済みの計画は、KPIが変わっていれば変わったと示す（自動では作り直さない）', () => {
    const saved: SavedPlanRecord[] = [
      { companyId: CO_A, strategyId: 'st-a', projectKey: 'd0-p0', savedAt: '2026-11-01', kpiSnapshot: [{ label: '法人顧客の契約数', target: 8 }, { label: '既存配送先の単価', target: 0 }], plan: {} },
    ];
    const m = buildStage4ReadModel({ ...base, savedPlans: saved });
    expect(m.status === 'READY' && m.savedPlan).toMatchObject({ state: 'SAVED', kpiChanged: true });
  });

  it('該当データがなければ、理由だけを返す（中身は出さない）', () => {
    expect(buildStage4ReadModel({ ...base, projectTitle: 'なし' })).toEqual({ status: 'NO_DATA', reason: 'PROJECT_NOT_FOUND' });
  });

  it('読み取りだけ：入力の戦略データを変えない', () => {
    const before = JSON.stringify({ strategies, base });
    buildStage4ReadModel({ ...base, savedPlans: [] });
    expect(JSON.stringify({ strategies, base })).toBe(before);
  });
});

describe('readKpisOf', () => {
  it('根拠の印が無いKPIも、目標・期限・担当を読み取る', () => {
    const [k] = readKpisOf({ okrsV2: [{ label: '来店数', target: 0, unit: '件', due: '2027-02-15', owner: '' }] });
    expect(k).toEqual({ label: '来店数', target: 0, unit: '件', due: '2027-02', owner: null, basis: 'UNKNOWN', origin: 'OKRS_V2' });
  });
});
