import { planConfirm as planConfirmCore, type ConfirmChange } from './stage3Confirm';
import { draftDepartmentsFrom, newProjectCandidatesFrom, projectSelectionsFrom, selectionsFrom } from './stage3Draft';
import { buildDeptProposals } from './stage3Candidates';

const NOW = '2026-11-17T00:00:00.000Z';
type ConfirmArgs = Omit<Parameters<typeof planConfirmCore>[0], 'nowIso' | 'actorUserId'>;
const planConfirm = (args: ConfirmArgs) => planConfirmCore({ nowIso: NOW, actorUserId: 'u-admin', ...args });

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
          candidateId: 'np-00000001',
          project: { id: 'cand-1', title: '新しい案', reason: '理由', approvedAt: 'x', okrs: [{ id: 'o1', objective: 'o', keyResults: ['k'] }] },
        },
      ],
      mintId: sequence(),
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const projects = plan.departments[0].projects as Array<Record<string, unknown>>;
    expect(projects[0]).toEqual(official()[0].projects[0]);
    expect(projects[1]).toMatchObject({ id: 'p-test-1', title: '新しい案', reason: '理由', sourceCandidateId: 'np-00000001' });
    expect(projects[1]).not.toHaveProperty('approvedAt');
    expect((projects[1].okrs as Array<Record<string, unknown>>)[0]).not.toHaveProperty('id');
    expect(plan.adoptedProjectIds).toEqual(['p-test-1']);
  });

  it('採用するプロジェクトに題名が無い場合は、全体を止める', () => {
    const plan = planConfirm({
      departments: official(),
      changes: [],
      adoptions: [{ departmentKey: 'id:d-sales', departmentName: '営業部', candidateId: 'np-00000002', project: { id: 'c', title: '  ' } }],
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

  it('計画から外すと、削除はせず無効化する。他の施策は変えない', () => {
    const plan = run({ projectRemovals: [removal] });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const projects = plan.departments[0].projects as Array<{ id: string; lifecycle?: unknown }>;
    expect(projects.map((p) => p.id)).toEqual(['p-1', 'p-2']);
    expect(projects[1].lifecycle).toEqual({ status: 'EXCLUDED', changedAt: NOW, changedBy: 'u-admin' });
    expect(projects[0].lifecycle).toBeUndefined();
    expect(plan.excludedProjectIds).toEqual(['p-2']);
  });

  it('承認済みの計画は、確定の計画から外さず止める', () => {
    const approved = [{ id: 'd-sales', name: '営業部', projects: [{ ...baseProject, planStatus: 'approved' }] }];
    const plan = planConfirm({ departments: approved, changes: [], projectRemovals: [{ ...removal, projectId: 'p-1', base: { title: baseProject.title } }], mintId: () => 'p-new' });
    expect(plan).toEqual({ ok: false, error: 'project_approved', departmentName: '営業部', item: 'project' });
  });

  it('参照のある計画は、外さずに止める', () => {
    const plan = run({ projectRemovals: [removal], referencedProjectKeys: new Set(['id:d-sales p-2']) });
    expect(plan).toEqual({ ok: false, error: 'project_referenced', departmentName: '営業部', item: 'project' });
  });

  it('編集と外すを同じプロジェクトに入れた時は、外すを優先し、編集は捨てる', () => {
    const plan = run({ projectEdits: [{ ...edit, projectId: 'p-2', base: { ...baseText, title: '別の施策', reason: null, hypothesis: null, description: null }, fields: { ...baseText, title: '別の施策', reason: null, hypothesis: null, description: null } }], projectRemovals: [removal] });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const projects = plan.departments[0].projects as Array<{ id: string; title: string; lifecycle?: { status: string } }>;
    expect(projects.map((p) => p.id)).toEqual(['p-1', 'p-2']);
    expect(projects[1]).toMatchObject({ title: '別の施策', lifecycle: { status: 'EXCLUDED' } });
  });

  it('存在しないプロジェクトの編集・削除は、全体を止める', () => {
    expect(run({ projectRemovals: [{ ...removal, projectId: 'p-x' }] })).toEqual({ ok: false, error: 'project_missing', departmentName: '営業部', item: 'project' });
    expect(run({ projectEdits: [{ ...edit, projectId: 'p-x' }] })).toEqual({ ok: false, error: 'project_missing', departmentName: '営業部', item: 'project' });
  });
});

describe('planConfirm（以前の確定で反映済みの変更）', () => {
  const home = (mission: string) => [{ id: 'd-home', name: '宅配事業', mission, projects: [] }];
  const missionChange = (base: string, proposed: string): ConfirmChange => ({
    departmentKey: 'id:d-home',
    departmentName: '宅配事業',
    item: 'mission',
    proposed: { mission: proposed },
    base: { mission: base },
  });

  it('正式データが採用値と一致していれば、競合にせず反映件数にも数えない', () => {
    const plan = planConfirm({
      departments: home('新しい使命'),
      changes: [missionChange('', '新しい使命')],
      mintId: sequence(),
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.appliedCount).toBe(0);
    expect(plan.departments[0].mission).toBe('新しい使命');
  });

  it('基準値と現在値が違い、採用値とも違う場合は、従来どおり止める', () => {
    const plan = planConfirm({
      departments: home('別の人が書いた使命'),
      changes: [missionChange('', '新しい使命')],
      mintId: sequence(),
    });
    expect(plan).toMatchObject({ ok: false, error: 'current_value_changed', departmentName: '宅配事業', item: 'mission' });
  });
});

describe('採用したKPIの変更の確定（A-03）', () => {
  const text = { title: '既存顧客の再受注施策', reason: null, hypothesis: '手間が減る', description: null };
  const departments = (statement = '再受注率 40%') => [
    {
      id: 'd-sales',
      name: '営業部',
      projects: [
        {
          id: 'p-1',
          title: '既存顧客の再受注施策',
          hypothesis: '手間が減る',
          okrs: [{ objective: '再受注を増やす', keyResults: [{ id: 'kr-1', statement }] }],
        },
      ],
    },
  ];
  const kpiEdit = {
    departmentKey: 'id:d-sales',
    departmentName: '営業部',
    projectId: 'p-1',
    fields: text,
    base: text,
    kpis: { base: ['再受注率 40%'], next: ['再受注率 45%'] },
  };

  it('KPIの文言だけを差し替え、目標や識別子は変えない', () => {
    const plan = planConfirm({ departments: departments(), changes: [], projectEdits: [kpiEdit], mintId: () => 'p-new' });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.editedProjectCount).toBe(1);
    const kr = ((plan.departments[0].projects as Array<Record<string, any>>)[0].okrs[0] as Record<string, any>).keyResults[0];
    expect(kr).toEqual({ id: 'kr-1', statement: '再受注率 45%' });
  });

  it('KPIの基準が編集時点から変わっていれば確定しない', () => {
    const plan = planConfirm({
      departments: departments('別の人が直したKPI'),
      changes: [],
      projectEdits: [kpiEdit],
      mintId: () => 'p-new',
    });
    expect(plan).toEqual({ ok: false, error: 'project_changed', departmentName: '営業部', item: 'project' });
  });
});

describe('新規プロジェクトの採用で構造化KPI（okrsV2）を作る', () => {
  it('採用した計画のKPIごとに、IDつきのKRを作り、KPIの文言は計画のKPIと一致させる', () => {
    const plan = planConfirm({
      departments: [{ id: 'd-news', name: '新聞販売・配達事業', projects: [] }],
      changes: [],
      adoptions: [
        {
          departmentKey: 'id:d-news',
          departmentName: '新聞販売・配達事業',
          candidateId: 'np-0000aaaa',
          project: {
            title: '購読価値改善',
            okrs: [{ objective: '購読を続けてもらう', keyResults: ['購読継続率（％）', '課題解決世帯率（％）'] }],
          },
        },
      ],
      mintId: sequence(),
      mintKrId: () => `kr-${Math.random().toString(36).slice(2, 8)}`,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const project = (plan.departments[0].projects as Array<Record<string, any>>)[0];
    expect(project.okrsV2.map((k: { label: string }) => k.label)).toEqual(['購読継続率（％）', '課題解決世帯率（％）']);
    expect(new Set(project.okrsV2.map((k: { id: string }) => k.id)).size).toBe(2);
    expect(project.okrs[0].keyResults).toEqual(['購読継続率（％）', '課題解決世帯率（％）']);
  });
});

describe('既存の計画のKPI変更：ID・目標値・実績を保ち、STAGE4で重複しない（モックデータ）', () => {
  const text = { title: '購読価値改善', reason: null, hypothesis: null, description: null };
  const existing = () => [
    {
      id: 'd-news',
      name: '新聞販売・配達事業',
      projects: [
        {
          id: 'p-1',
          title: '購読価値改善',
          okrsV2: [
            { id: 'kr-keep', label: '購読継続率（％）', target: 0.9, unit: '%', scope: 'DEPT', baseKey: 'NONE', actual: { value: 0.82, at: '2026-10' } },
            { id: 'kr-2', label: '課題解決世帯率（％）', target: 0.5, unit: '%', scope: 'DEPT', baseKey: 'NONE' },
          ],
          okrs: [{ objective: '購読を続けてもらう', keyResults: ['購読継続率（％）', '課題解決世帯率（％）'] }],
        },
      ],
    },
  ];
  const edit = {
    departmentKey: 'id:d-news',
    departmentName: '新聞販売・配達事業',
    projectId: 'p-1',
    fields: text,
    base: text,
    kpis: { base: ['購読継続率（％）', '課題解決世帯率（％）'], next: ['購読継続率（％）見直し後', '課題解決世帯率（％）'] },
  };

  it('文言だけが変わり、KPIのID・目標値・単位・実績は残る', () => {
    const plan = planConfirm({ departments: existing(), changes: [], projectEdits: [edit], mintId: () => 'p-x' });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const project = (plan.departments[0].projects as Array<Record<string, any>>)[0];
    const before = existing()[0].projects[0].okrsV2;
    expect(project.okrsV2[0]).toEqual({ ...before[0], label: '購読継続率（％）見直し後' });
    expect(project.okrsV2[1]).toEqual(before[1]);
    expect(project.okrs[0].keyResults).toEqual(['購読継続率（％）見直し後', '課題解決世帯率（％）']);
  });

  it('STAGE4の読み取りで、変更後のKPIは1件ずつだけ読まれ、旧い文言は残らない', async () => {
    const { readKpisOf } = await import('@/lib/stage4/plan/readModel');
    const plan = planConfirm({ departments: existing(), changes: [], projectEdits: [edit], mintId: () => 'p-x' });
    if (!plan.ok) throw new Error('plan');
    const project = (plan.departments[0].projects as Array<Record<string, unknown>>)[0];
    const kpis = readKpisOf(project);
    expect(kpis.map((k) => k.label)).toEqual(['購読継続率（％）見直し後', '課題解決世帯率（％）']);
    expect(kpis.every((k) => k.origin === 'OKRS_V2')).toBe(true);
    expect(kpis[0].target).toBe(0.9);
  });
});
