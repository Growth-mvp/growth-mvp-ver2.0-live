import { buildFinanceEffectTrial } from '@/utils/stage6/financeEffectPlan';
import { listAccessibleProjects } from '@/lib/stage4/plan/projectResolver';
import { isProjectActive, lifecycleActionRefusal, lifecycleOf, setProjectLifecycle, stage6PlanDepartments } from './projectLifecycle';
import { planConfirm } from './stage3Confirm';
import { candidateProjectId, newProjectCandidatesFrom, projectSelectionsFrom } from './stage3Draft';

const NOW = '2026-11-17T00:00:00.000Z';
const STOP_AT = '2027-10-15T00:00:00.000Z';

const sales = (projects: Array<Record<string, unknown>>) => ({ id: 'd-sales', name: '営業部', projects });
const project = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `施策${id}`, ...extra });

describe('施策の有効・無効の判定', () => {
  it('状態が未設定の既存の施策は有効として扱う（後方互換）', () => {
    expect(isProjectActive(project('p-1'))).toBe(true);
    expect(lifecycleOf(project('p-1'))).toBeNull();
  });

  it('計画から外した施策と中止した施策は、有効ではない', () => {
    expect(isProjectActive(project('p-1', { lifecycle: { status: 'EXCLUDED', changedAt: NOW, changedBy: 'u' } }))).toBe(false);
    expect(isProjectActive(project('p-1', { lifecycle: { status: 'STOPPED', changedAt: NOW, changedBy: 'u', stoppedAt: STOP_AT } }))).toBe(false);
  });
});

describe('状態変更の共通処理（setProjectLifecycle）', () => {
  it('指定した施策だけを外し、他の施策と入力の値は変えない', () => {
    const input = [sales([project('p-1', { kpis: ['k'] }), project('p-2')])];
    const before = JSON.stringify(input);
    const out = setProjectLifecycle(input, { projectId: 'p-2', status: 'EXCLUDED', changedAt: NOW, changedBy: 'u-admin' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const projects = out.departments[0].projects as Array<Record<string, unknown>>;
    expect(projects[0]).toEqual(project('p-1', { kpis: ['k'] }));
    expect(projects[1].lifecycle).toEqual({ status: 'EXCLUDED', changedAt: NOW, changedBy: 'u-admin' });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('中止は中止時期を保持する', () => {
    const out = setProjectLifecycle([sales([project('p-1')])], { projectId: 'p-1', status: 'STOPPED', changedAt: NOW, changedBy: 'u', stoppedAt: STOP_AT });
    expect(out.ok && (out.departments[0].projects as Array<Record<string, unknown>>)[0].lifecycle).toEqual({
      status: 'STOPPED',
      changedAt: NOW,
      changedBy: 'u',
      stoppedAt: STOP_AT,
    });
  });

  it('同じIDの施策が複数ある時は、どれか分からないため何も変えない', () => {
    const input = [sales([project('p-1')]), { id: 'd-mkt', name: 'マーケ部', projects: [project('p-1')] }];
    expect(setProjectLifecycle(input, { projectId: 'p-1', status: 'EXCLUDED', changedAt: NOW, changedBy: null })).toEqual({ ok: false, error: 'project_ambiguous' });
  });

  it('存在しない施策や、部門が違う時は変えない（他の部門・他の案件に影響させない）', () => {
    const input = [sales([project('p-1')])];
    expect(setProjectLifecycle(input, { projectId: 'p-x', status: 'EXCLUDED', changedAt: NOW, changedBy: null })).toEqual({ ok: false, error: 'project_missing' });
    expect(setProjectLifecycle(input, { projectId: 'p-1', departmentKey: 'id:d-mkt', status: 'EXCLUDED', changedAt: NOW, changedBy: null })).toEqual({
      ok: false,
      error: 'department_missing',
    });
  });

  it('状態を戻すと、有効な施策に戻る（同じID・同じ中身）', () => {
    const excluded = setProjectLifecycle([sales([project('p-1')])], { projectId: 'p-1', status: 'EXCLUDED', changedAt: NOW, changedBy: null });
    if (!excluded.ok) throw new Error('fixture');
    const restored = setProjectLifecycle(excluded.departments, { projectId: 'p-1', status: null, changedAt: NOW, changedBy: null });
    expect(restored.ok && restored.departments).toEqual([sales([project('p-1')])]);
  });
});

describe('操作ごとの拒否理由（lifecycleActionRefusal）', () => {
  const ok = { executing: false, started: false };
  it('計画から外す：承認済み・採用済み/実行中は外せない。それ以外は外せる', () => {
    expect(lifecycleActionRefusal(project('p-1', { planStatus: 'approved' }), 'EXCLUDE', ok)).toBe('APPROVED');
    expect(lifecycleActionRefusal(project('p-1'), 'EXCLUDE', { executing: true, started: false })).toBe('EXECUTING');
    expect(lifecycleActionRefusal(project('p-1'), 'EXCLUDE', ok)).toBeNull();
  });
  it('中止：実行を開始した計画だけ止められる。すでに外れた施策は操作できない', () => {
    expect(lifecycleActionRefusal(project('p-1'), 'STOP', ok)).toBe('NOT_STARTED');
    expect(lifecycleActionRefusal(project('p-1'), 'STOP', { executing: true, started: true })).toBeNull();
    expect(lifecycleActionRefusal(project('p-1', { lifecycle: { status: 'EXCLUDED', changedAt: NOW, changedBy: null } }), 'STOP', { executing: true, started: true })).toBe('ALREADY_OUT');
  });
});

describe('採用・不採用・再採用と重複防止（STAGE3の確定）', () => {
  const official = () => [sales([])];
  const adopt = (departments: unknown[], candidateId: string, id: string) =>
    planConfirm({
      departments,
      changes: [],
      adoptions: [{ departmentKey: 'id:d-sales', departmentName: '営業部', candidateId, project: { title: '新しい案', reason: '理由' } }],
      mintId: () => id,
      nowIso: NOW,
      actorUserId: 'u-admin',
    });

  it('採用→再確定→不採用→再採用。重複せず、同じIDで戻る', () => {
    const first = adopt(official(), 'np-00000001', 'p-1');
    if (!first.ok) throw new Error('adopt');
    expect(first.adoptedProjectIds).toEqual(['p-1']);

    const again = adopt(first.departments, 'np-00000001', 'p-dup');
    if (!again.ok) throw new Error('re-confirm');
    expect(again.adoptedProjectIds).toEqual([]);
    expect((again.departments[0].projects as unknown[]).length).toBe(1);

    const removed = planConfirm({
      departments: again.departments,
      changes: [],
      projectRemovals: [{ departmentKey: 'id:d-sales', departmentName: '営業部', projectId: 'p-1', base: { title: '新しい案' } }],
      mintId: () => 'p-x',
      nowIso: NOW,
      actorUserId: 'u-admin',
    });
    if (!removed.ok) throw new Error('exclude');
    expect(removed.excludedProjectIds).toEqual(['p-1']);
    expect(isProjectActive((removed.departments[0].projects as unknown[])[0])).toBe(false);

    const readopted = adopt(removed.departments, 'np-00000001', 'p-new');
    if (!readopted.ok) throw new Error('re-adopt');
    const projects = readopted.departments[0].projects as Array<Record<string, unknown>>;
    expect(readopted.adoptedProjectIds).toEqual(['p-1']);
    expect(projects.length).toBe(1);
    expect(projects[0].id).toBe('p-1');
    expect(projects[0].lifecycle).toBeUndefined();
  });

  it('計画から外した施策は、次の草案で同じ候補IDの候補として出る（採用し直せる）', () => {
    const adopted = adopt(official(), 'np-00000002', 'p-7');
    if (!adopted.ok) throw new Error('adopt');
    const excluded = setProjectLifecycle(adopted.departments, { projectId: 'p-7', status: 'EXCLUDED', changedAt: NOW, changedBy: null });
    if (!excluded.ok) throw new Error('exclude');
    const candidates = newProjectCandidatesFrom(excluded.departments as Array<Record<string, unknown>>, {});
    expect(candidates.map((c) => c.candidateId)).toEqual(['np-00000002']);
    const selections = projectSelectionsFrom(excluded.departments as Array<Record<string, unknown>>, candidates, []);
    expect(selections[0].decision).toBe('pending');
  });

  it('計画に入っている候補は、採用済みとして初期表示し、重複候補として採用しない', () => {
    const cid = candidateProjectId('id:d-sales', '新しい案');
    const adopted = adopt(official(), cid, 'p-9');
    if (!adopted.ok) throw new Error('adopt');
    const candidates = newProjectCandidatesFrom(adopted.departments as Array<Record<string, unknown>>, {
      'id:d-sales': [{ title: '新しい案' }],
    });
    const selections = projectSelectionsFrom(adopted.departments as Array<Record<string, unknown>>, candidates, []);
    expect(selections.find((s) => s.candidateId === cid)?.decision).toBe('applied');
    const again = adopt(adopted.departments, cid, 'p-dup');
    expect(again.ok && again.adoptedProjectIds).toEqual([]);
  });
});

describe('STAGE4〜6への反映（中止・除外）', () => {
  const costEffect = (startYm: string, endYm?: string) => ({
    kind: 'COST_REDUCTION',
    method: 'DIRECT_AMOUNT',
    directAmountYen: 1000000,
    amountBasis: 'ANNUAL',
    startYm,
    ...(endYm ? { endYm } : {}),
    sourceNote: '根拠',
    source: 'USER_INPUT',
    confirmed: true,
  });

  it('STAGE6：除外した施策は将来の財務効果から外す。中止した施策は中止月以降の予定だけ外し、前の予定と実績は残す', () => {
    const departments = [
      sales([
        project('p-keep', { financeEffect: costEffect('2027-04', '2028-03') }),
        project('p-stop', {
          financeEffects: [costEffect('2027-04', '2028-03'), costEffect('2027-11', '2028-03')],
          executionHumanInvestments: [
            { id: 'i1', type: 'OTHER', name: '設備', amount: 100, spend: { category: 'CAPEX', recurrence: 'ONE_TIME', paymentYm: '2027-05' } },
            { id: 'i2', type: 'OTHER', name: '保守', amount: 100, spend: { category: 'CAPEX', recurrence: 'ONE_TIME', paymentYm: '2027-12' } },
            { id: 'i3', type: 'OTHER', name: '委託', amount: 100, spend: { category: 'OPEX', recurrence: 'RECURRING', amountBasis: 'MONTHLY', startYm: '2027-03', endYm: '2028-03' } },
          ],
          financeActuals: [{ itemKey: 'EFFECT:COST_REDUCTION', ym: '2027-06', amountYen: 50000, recordedAt: NOW, createdAt: NOW }],
          lifecycle: { status: 'STOPPED', changedAt: NOW, changedBy: null, stoppedAt: STOP_AT },
        }),
        project('p-out', { financeEffect: costEffect('2027-04', '2028-03'), lifecycle: { status: 'EXCLUDED', changedAt: NOW, changedBy: null } }),
      ]),
    ];
    const plan = stage6PlanDepartments(departments);
    const projects = plan[0].projects as Array<Record<string, unknown>>;
    expect(projects.map((p) => p.id)).toEqual(['p-keep', 'p-stop']);

    const stop = projects[1];
    expect((stop.financeEffects as Array<{ endYm: string }>).map((e) => e.endYm)).toEqual(['2027-09']);
    const withPrimary = stage6PlanDepartments([sales([project('p-stop', { financeEffect: costEffect('2027-04', '2028-03'), lifecycle: { status: 'STOPPED', changedAt: NOW, changedBy: null, stoppedAt: STOP_AT } })])]);
    expect((withPrimary[0].projects as Array<{ financeEffect: { endYm: string } }>)[0].financeEffect.endYm).toBe('2027-09');

    const investments = stop.executionHumanInvestments as Array<{ id: string; spend: Record<string, unknown> }>;
    expect(investments.map((r) => r.id)).toEqual(['i1', 'i3']);
    expect(investments[1].spend.endYm).toBe('2027-09');

    expect(stop.financeActuals).toEqual([{ itemKey: 'EFFECT:COST_REDUCTION', ym: '2027-06', amountYen: 50000, recordedAt: NOW, createdAt: NOW }]);
  });

  it('STAGE6の試算：除外した施策は、試算の行に出ない', () => {
    const departments = [sales([project('p-keep', { financeEffect: costEffect('2027-04', '2028-03') }), project('p-out', { lifecycle: { status: 'EXCLUDED', changedAt: NOW, changedBy: null } })])];
    const before = buildFinanceEffectTrial({ departments: departments as never, fiscalYearEnd: '3', fiscalYears: [2027] });
    const after = buildFinanceEffectTrial({ departments: stage6PlanDepartments(departments) as never, fiscalYearEnd: '3', fiscalYears: [2027] });
    expect(before.projects.some((r) => r.projectTitle === '施策p-out')).toBe(true);
    expect(after.projects.some((r) => r.projectTitle === '施策p-out')).toBe(false);
    expect(after.projects.some((r) => r.projectTitle === '施策p-keep')).toBe(true);
  });

  it('STAGE4の一覧：除外した施策は出さず、中止した施策は中止時期つきで残す', () => {
    const listing = listAccessibleProjects({
      memberships: [{ company_id: 'c1', role: 'member' }],
      strategies: [
        {
          id: 's1',
          company_id: 'c1',
          departments: [
            sales([project('p-a'), project('p-b', { lifecycle: { status: 'EXCLUDED', changedAt: NOW, changedBy: null } }), project('p-c', { lifecycle: { status: 'STOPPED', changedAt: NOW, changedBy: null, stoppedAt: STOP_AT } })]),
          ],
        },
      ],
    });
    expect(listing.map((p) => p.stableId)).toEqual(['p-a', 'p-c']);
    expect(listing[1].stoppedAt).toBe(STOP_AT);
    expect(listing[0].stoppedAt).toBeNull();
  });
});
