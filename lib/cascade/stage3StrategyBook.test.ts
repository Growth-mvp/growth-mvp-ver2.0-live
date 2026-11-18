import { collectPlanUnits, resolveCandidates } from './stage3Adjustment';
import {
  emptyWorkspaceState,
  planBasisKey,
  WorkspaceStateSchema,
  sourceDepartments,
  verifyWorkspaceState,
  type WorkspaceState,
} from './stage3StrategyBook';

const official = [
  {
    id: 'd-sales',
    name: '営業部',
    finalized: true,
    projects: [{ id: 'p-1', title: '既存顧客の再受注施策', kpis: ['再受注率 40%'] }],
  },
  {
    id: 'd-mkt',
    name: 'マーケティング部',
    finalized: true,
    projects: [{ id: 'p-2', title: '既存顧客向けセミナー' }],
  },
];

const draftDepartments = [
  { id: 'd-sales', name: '営業部', projects: [{ id: 'p-1', title: '既存顧客の再受注施策' }, { id: 'p-3', title: '新しい案' }] },
  { id: 'd-mkt', name: 'マーケティング部', projects: [{ id: 'p-2', title: '既存顧客向けセミナー' }] },
];

const draft = {
  draftId: 'draft-r1',
  kind: 'regenerated' as const,
  version: 2,
  createdAt: '2026-11-12T00:00:00.000Z',
  departments: draftDepartments,
  newProjects: [],
};

const units = collectPlanUnits(official);
const [candidate] = resolveCandidates(
  {
    candidates: [
      {
        kind: 'duplicate',
        title: '既存顧客への重複施策',
        summary: '重なっている。',
        departmentKeys: ['id:d-sales', 'id:d-mkt'],
        planRefs: [
          { departmentKey: 'id:d-sales', projectId: 'id:p-1' },
          { departmentKey: 'id:d-mkt', projectId: 'id:p-2' },
        ],
        dialogueTopics: ['担当をどちらが持つか'],
      },
    ],
  },
  units,
).candidates;

const withAnalysis = (patch: Partial<WorkspaceState> = {}): WorkspaceState => ({
  ...emptyWorkspaceState(),
  drafts: [draft],
  analysis: {
    draftId: 'draft-r1',
    draftVersion: 2,
    createdAt: '2026-11-12T00:00:00.000Z',
    candidates: [candidate],
    rejectedCandidates: 0,
    rejectedReferences: 0,
  },
  ...patch,
});

describe('verifyWorkspaceState', () => {
  it('空の作業状態は保存できる', () => {
    expect(verifyWorkspaceState(emptyWorkspaceState(), official).ok).toBe(true);
  });

  it('草案が保存済みにない部門IDを指していれば拒否する（草案で部門を増やせない）', () => {
    const forged = { ...draft, departments: [...draftDepartments, { id: 'd-new', name: '新設部門', projects: [] }] };
    expect(verifyWorkspaceState({ ...emptyWorkspaceState(), drafts: [forged] }, official)).toEqual({
      ok: false,
      error: 'draft_department_unknown',
    });
  });

  it('同じ計画IDが草案内で重なれば拒否する', () => {
    const dup = { ...draft, departments: [{ id: 'd-sales', name: '営業部', projects: [{ id: 'p-1', title: 'a' }, { id: 'p-1', title: 'b' }] }] };
    expect(verifyWorkspaceState({ ...emptyWorkspaceState(), drafts: [dup] }, official)).toEqual({
      ok: false,
      error: 'draft_project_duplicated',
    });
  });

  it('分析に使った草案の版が変わっていれば拒否する', () => {
    const state = withAnalysis({ analysis: { ...withAnalysis().analysis!, draftVersion: 1 } });
    expect(verifyWorkspaceState(state, official)).toEqual({ ok: false, error: 'analysis_draft_unknown' });
  });

  it('候補が、分析に使った草案に無い計画を指していれば拒否する', () => {
    const state = withAnalysis({
      drafts: [{ ...draft, departments: [{ id: 'd-sales', name: '営業部', projects: [] }, { id: 'd-mkt', name: 'マーケティング部', projects: [{ id: 'p-2', title: '既存顧客向けセミナー' }] }] }],
    });
    expect(verifyWorkspaceState(state, official)).toEqual({ ok: false, error: 'analysis_candidates_invalid' });
  });

  it('対話結果が候補の話題と合わなければ拒否する', () => {
    const state = withAnalysis({ dialogue: [{ candidateId: 'adj-1', topic: '関係ない話題', result: 'x' }] });
    expect(verifyWorkspaceState(state, official)).toEqual({ ok: false, error: 'dialogue_invalid' });
  });

  it('選択が保存済みにない部門を指していれば拒否する', () => {
    const state = withAnalysis({
      selections: [
        {
          departmentKey: 'id:d-none',
          departmentName: '存在しない部門',
          item: 'collab',
          proposed: { interDeptCollab: ['a'] },
          base: { intraDeptCollab: null, interDeptCollab: null },
          decision: 'pending',
        },
      ],
    });
    expect(verifyWorkspaceState(state, official)).toEqual({ ok: false, error: 'selection_department_unknown' });
  });

  it('確定と書いても確定の記録が無ければ拒否する', () => {
    expect(verifyWorkspaceState({ ...emptyWorkspaceState(), status: 'confirmed' }, official)).toEqual({
      ok: false,
      error: 'confirmed_without_record',
    });
  });

  it('検証は入力を変えない（正式データも草案も変わらない）', () => {
    const before = JSON.stringify({ official, state: withAnalysis() });
    verifyWorkspaceState(withAnalysis(), official);
    expect(JSON.stringify({ official, state: withAnalysis() })).toBe(before);
  });
});

describe('sourceDepartments', () => {
  it('草案の指定が無ければ正式データを使う（草案は混ざらない）', () => {
    const result = sourceDepartments(withAnalysis(), null, official);
    expect(result).toEqual({ ok: true, departments: official });
  });

  it('草案の版が一致した時だけ、その草案を分析の対象にする', () => {
    const ok = sourceDepartments(withAnalysis(), { draftId: 'draft-r1', version: 2 }, official);
    expect(ok).toEqual({ ok: true, departments: draftDepartments });
    expect(sourceDepartments(withAnalysis(), { draftId: 'draft-r1', version: 1 }, official)).toEqual({
      ok: false,
      error: 'draft_version_mismatch',
    });
  });
});

describe('verifyWorkspaceState（既存プロジェクトの編集・計画から外す）', () => {
  const official = [{ id: 'd-sales', name: '営業部', projects: [{ id: 'p-1', title: '既存顧客の再受注施策' }] }];
  const text = { title: '既存顧客の再受注施策', reason: null, hypothesis: null, description: null };
  const edit = { departmentKey: 'id:d-sales', projectId: 'p-1', fields: text, base: text };
  const removal = { departmentKey: 'id:d-sales', projectId: 'p-1', base: { title: '既存顧客の再受注施策' } };

  it('正式データに無いプロジェクトの編集・削除は拒否する', () => {
    expect(verifyWorkspaceState({ ...emptyWorkspaceState(), projectEdits: [{ ...edit, projectId: 'p-x' }] }, official)).toEqual({ ok: false, error: 'project_unknown' });
    expect(verifyWorkspaceState({ ...emptyWorkspaceState(), projectRemovals: [{ ...removal, projectId: 'p-x' }] }, official)).toEqual({ ok: false, error: 'project_unknown' });
  });

  it('同じプロジェクトの編集・削除の重複は拒否する', () => {
    expect(verifyWorkspaceState({ ...emptyWorkspaceState(), projectEdits: [edit, edit] }, official)).toEqual({ ok: false, error: 'project_edit_duplicated' });
    expect(verifyWorkspaceState({ ...emptyWorkspaceState(), projectRemovals: [removal, removal] }, official)).toEqual({ ok: false, error: 'project_removal_duplicated' });
  });

  it('編集と削除が同じプロジェクトにあっても保存できる（外すを優先し、戻すと編集を使える）', () => {
    const result = verifyWorkspaceState({ ...emptyWorkspaceState(), projectEdits: [edit], projectRemovals: [removal] }, official);
    expect(result.ok).toBe(true);
  });

  it('古い作業データには既定値（空の編集・削除）が入る', () => {
    const { projectEdits, projectRemovals, ...legacy } = emptyWorkspaceState();
    void projectEdits;
    void projectRemovals;
    const result = verifyWorkspaceState(legacy, official);
    expect(result.ok && result.state.projectEdits).toEqual([]);
    expect(result.ok && result.state.projectRemovals).toEqual([]);
  });
});

describe('verifyWorkspaceState（計画・KPIの変更候補）', () => {
  const official = [{ id: 'd-sales', name: '営業部', projects: [{ id: 'p-1', title: '既存顧客の再受注施策' }] }];
  const text = { title: '既存顧客の再受注施策', reason: null, hypothesis: null, description: null };
  const proposal = {
    departmentKey: 'id:d-sales',
    departmentName: '営業部',
    projectId: 'p-1',
    projectTitle: '既存顧客の再受注施策',
    reason: '話し合いで再受注の担当を明確にした',
    base: { ...text, kpis: [] },
    proposed: { ...text, title: '再受注の施策（改名）', kpis: [] },
    decision: 'adopted' as const,
  };
  const edit = { departmentKey: 'id:d-sales', projectId: 'p-1', fields: text, base: text };

  it('採用した変更候補と、同じ計画の編集・計画から外すは両立しない', () => {
    expect(verifyWorkspaceState({ ...emptyWorkspaceState(), projectProposals: [proposal], projectEdits: [edit] }, official)).toEqual({
      ok: false,
      error: 'project_edit_conflict',
    });
    expect(
      verifyWorkspaceState({ ...emptyWorkspaceState(), projectProposals: [{ ...proposal, decision: 'rejected' }], projectEdits: [edit] }, official).ok,
    ).toBe(true);
  });

  it('正式データに無い計画の変更候補と、同じ計画への重複を拒否する', () => {
    expect(verifyWorkspaceState({ ...emptyWorkspaceState(), projectProposals: [{ ...proposal, projectId: 'p-x' }] }, official)).toEqual({
      ok: false,
      error: 'project_unknown',
    });
    expect(verifyWorkspaceState({ ...emptyWorkspaceState(), projectProposals: [proposal, proposal] }, official)).toEqual({
      ok: false,
      error: 'project_proposal_duplicated',
    });
  });
});

describe('planBasisKey（検証結果が古くなったかの判定）', () => {
  const sel = {
    departmentKey: 'id:d-sales',
    departmentName: '営業部',
    item: 'collab',
    proposed: { needsCollab: ['連携A'] },
    base: { needsCollab: [] },
    decision: 'applied' as const,
  };

  it('計画の内容が同じなら同じキー。検証結果や対話の記録は含めない', () => {
    const a = { ...emptyWorkspaceState(), selections: [sel] };
    const b = { ...a, dialogue: [{ candidateId: 'adj-1', topic: 't', result: '話した' }], verification: null };
    expect(planBasisKey(a)).toBe(planBasisKey(b));
  });

  it('採用した変更が変わればキーも変わる。未採用の変更は含めない', () => {
    const base = { ...emptyWorkspaceState(), selections: [sel] };
    const changed = { ...base, selections: [{ ...sel, proposed: { needsCollab: ['連携B'] } }] };
    const pending = { ...base, selections: [{ ...sel, decision: 'pending' as const }] };
    expect(planBasisKey(changed)).not.toBe(planBasisKey(base));
    expect(planBasisKey(pending)).not.toBe(planBasisKey(base));
    expect(planBasisKey({ ...emptyWorkspaceState() })).toBe(planBasisKey({ ...base, selections: [{ ...sel, decision: 'rejected' as never }] }));
  });

  it('検証結果を持たない古い保存データも読める（既定値は未検証）', () => {
    const parsed = WorkspaceStateSchema.parse({ ...emptyWorkspaceState(), verification: undefined });
    expect(parsed.verification).toBeNull();
  });
});

describe('planBasisKey（保存の往復で並びが変わっても同じ値）', () => {
  it('キーの並び順と未定義の値が違っても、同じ計画なら同じキー', () => {
    const a = { ...emptyWorkspaceState(), selections: [{ departmentKey: 'id:d', departmentName: '営業部', item: 'collab', proposed: { x: 1, y: 'a' }, base: {}, decision: 'applied' as const }] };
    const b = { ...emptyWorkspaceState(), selections: [{ decision: 'applied' as const, base: {}, proposed: { y: 'a', x: 1, z: undefined }, item: 'collab', departmentName: '営業部', departmentKey: 'id:d' }] };
    expect(planBasisKey(a as WorkspaceState)).toBe(planBasisKey(b as WorkspaceState));
  });
});
