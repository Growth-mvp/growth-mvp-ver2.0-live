jest.mock('server-only', () => ({}));

import { buildConfirmPlan } from './stage3ConfirmPlan';
import { emptyWorkspaceState, type WorkspaceState } from '@/lib/cascade/stage3StrategyBook';

const text = { title: '既存顧客の再受注施策', reason: null, hypothesis: '手間が減る', description: null };
const departments = () => [
  {
    id: 'd-sales',
    name: '営業部',
    projects: [
      {
        id: 'p-1',
        title: '既存顧客の再受注施策',
        hypothesis: '手間が減る',
        okrs: [{ objective: '再受注を増やす', keyResults: [{ id: 'kr-1', statement: '再受注率 40%' }] }],
      },
    ],
  },
];

const adoptedProposal = {
  departmentKey: 'id:d-sales',
  departmentName: '営業部',
  projectId: 'p-1',
  projectTitle: '既存顧客の再受注施策',
  reason: '話し合いで再受注率の目標を見直した',
  base: { ...text, kpis: ['再受注率 40%'] },
  proposed: { ...text, title: '既存顧客の再受注施策（改名）', kpis: ['再受注率 45%'] },
  decision: 'adopted' as const,
};

const stateWith = (over: Partial<WorkspaceState>): WorkspaceState => ({ ...emptyWorkspaceState(), ...over });
const run = (state: WorkspaceState, deps = departments()) =>
  buildConfirmPlan({} as never, { companyId: 'c-1', strategyId: 's-1', state, departments: deps, actorUserId: 'u-1' });

describe('buildConfirmPlan（採用した計画・KPIの変更候補）', () => {
  it('採用した変更候補だけを、文章とKPIの編集として正式データへ反映する', async () => {
    const pending = { ...adoptedProposal, decision: 'pending' as const, projectId: 'p-1' };
    const result = await run(stateWith({ projectProposals: [adoptedProposal, { ...pending, departmentKey: 'id:x' }] }));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.plan.editedProjectCount).toBe(1);
    const project = (result.plan.departments[0].projects as Array<Record<string, any>>)[0];
    expect(project.title).toBe('既存顧客の再受注施策（改名）');
    expect(project.id).toBe('p-1');
    expect(project.okrs[0].keyResults[0]).toEqual({ id: 'kr-1', statement: '再受注率 45%' });
  });

  it('採用していない変更候補は、正式データを変えない', async () => {
    const result = await run(stateWith({ projectProposals: [{ ...adoptedProposal, decision: 'rejected' }] }));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.plan.editedProjectCount).toBe(0);
    expect(result.plan.departments).toEqual(departments());
  });

  it('確定前に正式データのKPIが変わっていれば、確定を止める', async () => {
    const changed = departments();
    (changed[0].projects[0].okrs[0].keyResults[0] as { statement: string }).statement = '別の人が直したKPI';
    const result = await run(stateWith({ projectProposals: [adoptedProposal] }), changed);
    expect(result).toEqual({
      kind: 'failed',
      failure: { ok: false, error: 'project_changed', departmentName: '営業部', item: 'project' },
    });
  });
});
