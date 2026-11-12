import { departmentDeleteBlockers, editCandidateProject, generationBlockerOf, pruneWorkspaceForDepartment, validateDepartmentName } from './departmentManagement';
import { emptyWorkspaceState, type WorkspaceState } from './stage3StrategyBook';
import { candidateProjectId } from './stage3Draft';

describe('departmentDeleteBlockers（部門の削除を拒否する関連データ）', () => {
  it('空の部門・計画だけの部門は削除してよい', () => {
    expect(departmentDeleteBlockers({ name: '新設', projects: [] })).toEqual([]);
    expect(departmentDeleteBlockers({ name: '計画', projects: [{ title: '案', planStatus: 'draft' }] })).toEqual([]);
  });

  it('承認済み・KPI記録・実行計画・進捗があれば拒否する理由を返す', () => {
    const reasons = departmentDeleteBlockers({
      name: '営業部',
      projects: [
        { title: '再受注', planStatus: 'approved', approvedAt: '2026-11-01' },
        { title: 'KPI', okrsV2: [{ id: 'k1' }] },
        { title: '人', humanInvestments: [{ id: 'h' }] },
        { title: '進捗', progressLogs: [{ id: 'l' }] },
      ],
    });
    expect(reasons.join(' ')).toContain('「再受注」は承認・採用済み');
    expect(reasons.join(' ')).toContain('KPI（構造化）');
    expect(reasons.join(' ')).toContain('実行計画');
    expect(reasons.join(' ')).toContain('進捗の記録');
  });
});

describe('validateDepartmentName（部門名の検査）', () => {
  it('空・長すぎ・同名を拒否し、正しい名前は通す', () => {
    expect(validateDepartmentName('  ', [])).toBe('部門名を入力してください');
    expect(validateDepartmentName('あ'.repeat(41), [])).toBe('部門名は40文字以内にしてください');
    expect(validateDepartmentName('営業部 ', ['営業部'])).toBe('同じ名前の部門があります');
    expect(validateDepartmentName('研究開発部', ['営業部'])).toBeNull();
  });
});

describe('generationBlockerOf（生成できない理由を具体的に返す）', () => {
  const base = { loaded: true, canEdit: true, busy: false, stage2Status: 'confirmed' as const };
  it('押せる場合は理由なし', () => {
    expect(generationBlockerOf(base)).toBeNull();
  });
  it('STAGE2未確定・本文欠落・テーブル未適用・通信失敗・権限を、それぞれ区別する', () => {
    const notConfirmed = generationBlockerOf({ ...base, stage2Status: 'not_confirmed' });
    const storyMissing = generationBlockerOf({ ...base, stage2Status: 'story_missing' });
    const table = generationBlockerOf({ ...base, workspaceErrorCode: 'workspace_table_missing' });
    const network = generationBlockerOf({ ...base, workspaceErrorCode: 'workspace_unavailable' });
    const noRole = generationBlockerOf({ ...base, canEdit: false });
    const all = [notConfirmed, storyMissing, table, network, noRole];
    expect(new Set(all).size).toBe(all.length);
    expect(notConfirmed).toContain('未確定');
    expect(table).toContain('未適用');
    expect(noRole).toContain('権限');
  });
});

const workspaceWithDrafts = (): WorkspaceState => {
  const candidate = {
    departmentKey: 'id:d-sales',
    candidateId: candidateProjectId('id:d-sales', '6問の新しい案'),
    project: { id: 'cand-1', title: '6問の新しい案', reason: '理由', hypothesis: '仮説' },
  };
  return {
    ...emptyWorkspaceState(),
    drafts: [
      {
        draftId: 'draft-r1',
        kind: 'regenerated',
        version: 1,
        createdAt: '2026-11-12T00:00:00.000Z',
        departments: [
          { id: 'd-sales', name: '営業部', projects: [{ id: 'p-1', title: '既存' }, { id: 'cand-1', title: '6問の新しい案' }] },
          { id: 'd-mkt', name: 'マーケティング部', projects: [{ id: 'p-2', title: 'セミナー' }] },
        ],
        newProjects: [candidate],
      },
    ],
    selections: [
      { departmentKey: 'id:d-sales', departmentName: '営業部', item: 'mission', proposed: { mission: '新' }, base: { mission: null, missionDescription: null }, decision: 'pending' },
      { departmentKey: 'id:d-mkt', departmentName: 'マーケティング部', item: 'mission', proposed: { mission: '新' }, base: { mission: null, missionDescription: null }, decision: 'pending' },
    ],
    projectSelections: [
      { departmentKey: 'id:d-sales', departmentName: '営業部', candidateId: candidate.candidateId, title: '6問の新しい案', decision: 'pending' },
    ],
  };
};

describe('pruneWorkspaceForDepartment（削除した部門の参照を作業状態から外す）', () => {
  it('削除した部門の草案・変更案・新規候補を外し、他の部門は残す', () => {
    const pruned = pruneWorkspaceForDepartment(workspaceWithDrafts(), 'id:d-sales');
    expect(pruned.drafts[0].departments.map((d) => d.name)).toEqual(['マーケティング部']);
    expect(pruned.drafts[0].newProjects).toEqual([]);
    expect(pruned.selections.map((s) => s.departmentKey)).toEqual(['id:d-mkt']);
    expect(pruned.projectSelections).toEqual([]);
  });
});

describe('editCandidateProject（再生成版の新規プロジェクトの文章を直す）', () => {
  it('目的・仮説・取り組み内容を直し、候補IDと計画IDは変えない', () => {
    const state = workspaceWithDrafts();
    const candidateId = state.drafts[0].newProjects[0].candidateId;
    const next = editCandidateProject(state, candidateId, { reason: '新しい目的', hypothesis: '新しい仮説', description: '取り組み内容' });
    const np = next.drafts[0].newProjects[0];
    expect(np.candidateId).toBe(candidateId);
    expect(np.project).toMatchObject({ id: 'cand-1', reason: '新しい目的', hypothesis: '新しい仮説' });
    const draftProject = next.drafts[0].departments[0].projects[1];
    expect(draftProject).toMatchObject({ id: 'cand-1', title: '6問の新しい案', description: '取り組み内容' });
  });

  it('題名を変えたときは、分析の参照が合わなくなるので分析を取り消す', () => {
    const state: WorkspaceState = {
      ...workspaceWithDrafts(),
      analysis: {
        draftId: 'draft-r1',
        draftVersion: 1,
        createdAt: '2026-11-12T00:00:00.000Z',
        candidates: [
          {
            id: 'adj-1',
            kind: 'duplicate',
            title: '重複',
            summary: '要約',
            dialogueTopics: ['話題'],
            departments: [
              { departmentKey: 'id:d-sales', name: '営業部' },
              { departmentKey: 'id:d-mkt', name: 'マーケティング部' },
            ],
            planRefs: [
              { departmentKey: 'id:d-sales', projectId: 'id:cand-1', departmentName: '営業部', projectTitle: '6問の新しい案' },
              { departmentKey: 'id:d-mkt', projectId: 'id:p-2', departmentName: 'マーケティング部', projectTitle: 'セミナー' },
            ],
          },
        ],
        rejectedCandidates: 0,
        rejectedReferences: 0,
      },
      candidateDecisions: { 'adj-1': 'adopted' },
    };
    const candidateId = state.drafts[0].newProjects[0].candidateId;
    const renamed = editCandidateProject(state, candidateId, { title: '題名を変えた案' });
    expect(renamed.analysis).toBeNull();
    expect(renamed.candidateDecisions).toEqual({});
    const sameTitle = editCandidateProject(state, candidateId, { hypothesis: '仮説だけ変更' });
    expect(sameTitle.analysis).not.toBeNull();
  });
});
