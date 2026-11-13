import { planConfirm, type ConfirmChange } from './stage3Confirm';
import { draftDepartmentsFrom, selectionsFrom } from './stage3Draft';
import { buildDeptProposals } from './stage3Candidates';

const official = () => [
  {
    id: 'd-sales',
    name: '営業部',
    intraDeptCollab: ['既存の連携'],
    projects: [{ id: 'p-1', title: '既存顧客の再受注施策', kpis: ['再受注率 40%'] }],
  },
  {
    id: 'd-mkt',
    name: 'マーケティング部',
    interDeptCollab: [],
    projects: [{ title: '旧データの計画（ID無し）', description: '名称で対応していた計画' }],
  },
];

const sequence = () => {
  let n = 0;
  return () => `p-test-${++n}`;
};

const change = (over: Partial<ConfirmChange> = {}): ConfirmChange => ({
  departmentKey: 'id:d-sales',
  departmentName: '営業部',
  item: 'collab',
  proposed: {
    intraDeptCollab: ['既存の連携'],
    interDeptCollab: ['マーケ部とセミナーの案内先を分ける'],
    needsCollab: ['既存の連携', 'マーケ部とセミナーの案内先を分ける'],
  },
  base: { intraDeptCollab: ['既存の連携'], interDeptCollab: null, needsCollab: null },
  ...over,
});

describe('planConfirm（一括確定の検証）', () => {
  it('全件が通れば、すべての変更を入れた departments を返す', () => {
    const mkt = change({
      departmentKey: 'id:d-mkt',
      departmentName: 'マーケティング部',
      proposed: { intraDeptCollab: [], interDeptCollab: ['営業と役割を分ける'], needsCollab: ['営業と役割を分ける'] },
      base: { intraDeptCollab: null, interDeptCollab: [], needsCollab: null },
    });
    const plan = planConfirm({ departments: official(), changes: [change(), mkt], mintId: sequence() });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.appliedCount).toBe(2);
    expect(plan.departments[0].interDeptCollab).toEqual(['マーケ部とセミナーの案内先を分ける']);
    expect(plan.departments[1].interDeptCollab).toEqual(['営業と役割を分ける']);
  });

  it('1件でも現在値と違えば、何も返さない（部分反映にしない）', () => {
    const stale = change({
      departmentKey: 'id:d-mkt',
      departmentName: 'マーケティング部',
      base: { intraDeptCollab: null, interDeptCollab: ['別の値'], needsCollab: null },
      proposed: { intraDeptCollab: [], interDeptCollab: ['新しい案'], needsCollab: ['新しい案'] },
    });
    const plan = planConfirm({ departments: official(), changes: [change(), stale], mintId: sequence() });
    expect(plan).toEqual({
      ok: false,
      error: 'current_value_changed',
      departmentName: 'マーケティング部',
      item: 'collab',
    });
  });

  it('存在しない部門への変更は、他が正しくても全体を止める', () => {
    const ghost = change({ departmentKey: 'id:d-none', departmentName: '消えた部門' });
    const plan = planConfirm({ departments: official(), changes: [change(), ghost], mintId: sequence() });
    expect(plan).toMatchObject({ ok: false, error: 'department_missing', departmentName: '消えた部門' });
  });

  it('不正な値（空の配列など）は拒否する', () => {
    const empty = change({ proposed: { intraDeptCollab: [], interDeptCollab: [], needsCollab: [] } });
    expect(planConfirm({ departments: official(), changes: [empty], mintId: sequence() })).toMatchObject({
      ok: false,
      error: 'invalid_change',
    });
  });

  it('同じ部門・項目への変更の重複は拒否する', () => {
    const plan = planConfirm({ departments: official(), changes: [change(), change()], mintId: sequence() });
    expect(plan).toMatchObject({ ok: false, error: 'duplicate_change' });
  });

  it('旧データの計画には ID を付けない（既存の計画は内容もIDも変えない）', () => {
    const plan = planConfirm({ departments: official(), changes: [], mintId: sequence() });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.departments).toEqual(official());
    expect(plan.adoptedProjectIds).toEqual([]);
  });

  it('採用するプロジェクトだけ、新しいIDを発行して末尾に追加する。既存の計画は変えない', () => {
    const plan = planConfirm({
      departments: official(),
      changes: [],
      adoptions: [
        {
          departmentKey: 'id:d-sales',
          departmentName: '営業部',
          project: { id: 'cand-1', title: '新しい案', reason: '理由', approvedAt: 'x', okrs: [{ id: 'o1', objective: 'o', keyResults: ['k'] }] },
        },
      ],
      mintId: sequence(),
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const projects = plan.departments[0].projects as Array<Record<string, unknown>>;
    expect(projects[0]).toEqual(official()[0].projects[0]);
    expect(projects[1]).toMatchObject({ id: 'p-test-1', title: '新しい案', reason: '理由' });
    expect(projects[1]).not.toHaveProperty('approvedAt');
    expect((projects[1].okrs as Array<Record<string, unknown>>)[0]).not.toHaveProperty('id');
    expect(plan.adoptedProjectIds).toEqual(['p-test-1']);
  });

  it('採用するプロジェクトに題名が無い場合は、全体を止める', () => {
    const plan = planConfirm({
      departments: official(),
      changes: [],
      adoptions: [{ departmentKey: 'id:d-sales', departmentName: '営業部', project: { id: 'c', title: '  ' } }],
      mintId: sequence(),
    });
    expect(plan).toMatchObject({ ok: false, error: 'invalid_project' });
  });

  it('入力の departments は変えない', () => {
    const input = official();
    const before = JSON.stringify(input);
    planConfirm({ departments: input, changes: [change()], mintId: sequence() });
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('draftDepartmentsFrom（初回・再生成案の草案化）', () => {
  it('既存の計画のIDを保ち、生成された候補は別の計画として追加する。既存と同じIDの候補は足さない', () => {
    const drafts = draftDepartmentsFrom(official(), {
      'id:d-sales': [
        { id: 'p-1', title: '既存顧客の再受注施策（生成）' },
        { id: 'p-new', title: '6問を反映した新しい案', description: '新規' },
      ],
    });
    expect(drafts[0].id).toBe('d-sales');
    expect(drafts[0].projects.map((p) => [p.id, p.title])).toEqual([
      ['p-1', '既存顧客の再受注施策'],
      ['p-new', '6問を反映した新しい案'],
    ]);
    expect(drafts[1].id).toBe('d-mkt');
    expect(drafts[1].projects[0].id).toBeUndefined();
  });

  it('IDの無い部門は、IDを作らず名称で対応する', () => {
    const noId = [{ name: 'IT部', projects: [{ title: '旧計画' }] }];
    expect(draftDepartmentsFrom(noId, {})[0]).toEqual({ name: 'IT部', projects: [{ title: '旧計画' }] });
  });
});

describe('selectionsFrom（変更案の作業状態化）', () => {
  const dept = official()[0];
  const proposals = buildDeptProposals(dept, { interDeptCollab: ['新しい連携'] });

  it('新しい案は、読んで直す項目として反映扱いで入る（決定ボタンは無い）', () => {
    const first = selectionsFrom([dept], { 'id:d-sales': proposals }, []);
    expect(first.map((s) => s.decision)).toEqual(['applied']);
  });

  it('同じ項目の古い判断は、新しい案に置き換わる', () => {
    const decided = selectionsFrom([dept], { 'id:d-sales': proposals }, []).map((s) => ({ ...s, decision: 'deferred' as const }));
    const again = selectionsFrom([dept], { 'id:d-sales': proposals }, decided);
    expect(again.map((s) => s.decision)).toEqual(['applied']);
    expect(again).toHaveLength(1);
  });

  it('判断済みの別の項目は残す', () => {
    const other = { departmentKey: 'id:d-mkt', departmentName: 'マーケティング部', item: 'keyIssues' as const, proposed: { keyIssues: ['a'] }, base: { keyIssues: null }, decision: 'discarded' as const };
    const result = selectionsFrom([dept], { 'id:d-sales': proposals }, [other]);
    expect(result.map((s) => s.decision)).toEqual(['discarded', 'applied']);
  });
});

describe('planConfirm（既存プロジェクトの編集と計画から外す）', () => {
  const baseProject = {
    id: 'p-1',
    title: '既存顧客の再受注施策',
    reason: '再受注',
    hypothesis: '手間が減る',
    description: '書類を一度で済ませる',
    kpis: ['再受注率 40%'],
    okrs: [{ objective: '再受注', keyResults: ['再受注率 40%'] }],
  };
  const departments = () => [{ id: 'd-sales', name: '営業部', projects: [{ ...baseProject }, { id: 'p-2', title: '別の施策' }] }];
  const baseText = {
    title: '既存顧客の再受注施策',
    reason: '再受注',
    hypothesis: '手間が減る',
    description: '書類を一度で済ませる',
  };
  const edit = {
    departmentKey: 'id:d-sales',
    departmentName: '営業部',
    projectId: 'p-1',
    fields: { ...baseText, title: '改名した施策', reason: null },
    base: baseText,
  };
  const removal = { departmentKey: 'id:d-sales', departmentName: '営業部', projectId: 'p-2', base: { title: '別の施策' } };
  const run = (extra: Record<string, unknown>) =>
    planConfirm({ departments: departments(), changes: [], mintId: () => 'p-new', ...extra });

  it('編集は文章の項目だけを変え、IDとKPI・OKRは変えない。空にした項目は外す', () => {
    const plan = run({ projectEdits: [edit] });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const p = (plan.departments[0].projects as Array<Record<string, unknown>>)[0];
    expect(p).toEqual(
      expect.objectContaining({ id: 'p-1', title: '改名した施策', hypothesis: '手間が減る', description: '書類を一度で済ませる', kpis: ['再受注率 40%'], okrs: baseProject.okrs }),
    );
    expect('reason' in p).toBe(false);
  });

  it('正式データが編集時点から変わっていれば、編集は確定しない', () => {
    const changed = departments();
    (changed[0].projects as Array<Record<string, unknown>>)[0].title = '別の人が直した名前';
    const plan = planConfirm({ departments: changed, changes: [], projectEdits: [edit], mintId: () => 'p-new' });
    expect(plan).toEqual({ ok: false, error: 'project_changed', departmentName: '営業部', item: 'project' });
  });

  it('計画から外すと、そのプロジェクトだけが正式データから消え、他は残る', () => {
    const plan = run({ projectRemovals: [removal] });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect((plan.departments[0].projects as Array<{ id: string }>).map((p) => p.id)).toEqual(['p-1']);
  });

  it('参照のある計画は、外さずに止める', () => {
    const plan = run({ projectRemovals: [removal], referencedProjectKeys: new Set(['id:d-sales p-2']) });
    expect(plan).toEqual({ ok: false, error: 'project_referenced', departmentName: '営業部', item: 'project' });
  });

  it('編集と外すを同じプロジェクトに入れた時は、外すを優先し、編集は捨てる', () => {
    const plan = run({ projectEdits: [{ ...edit, projectId: 'p-2', base: { ...baseText, title: '別の施策', reason: null, hypothesis: null, description: null }, fields: { ...baseText, title: '別の施策', reason: null, hypothesis: null, description: null } }], projectRemovals: [removal] });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect((plan.departments[0].projects as Array<{ id: string }>).map((p) => p.id)).toEqual(['p-1']);
  });

  it('存在しないプロジェクトの編集・削除は、全体を止める', () => {
    expect(run({ projectRemovals: [{ ...removal, projectId: 'p-x' }] })).toEqual({ ok: false, error: 'project_missing', departmentName: '営業部', item: 'project' });
    expect(run({ projectEdits: [{ ...edit, projectId: 'p-x' }] })).toEqual({ ok: false, error: 'project_missing', departmentName: '営業部', item: 'project' });
  });
});
