import {
  candidateProjectId,
  keepRegeneratedCandidates,
  newProjectCandidatesFrom,
  projectSelectionsFrom,
} from '@/lib/cascade/stage3Draft';
import { addManualProject } from '@/lib/cascade/departmentManagement';
import { emptyWorkspaceState, type NewProjectCandidate, type WorkspaceState } from '@/lib/cascade/stage3StrategyBook';

const KEY = 'name:営業部';
const OFFICIAL = [{ name: '営業部', mission: '顧客を広げる', projects: [{ id: 'p-existing', title: '既存の施策' }] }];

function candidate(title: string, extra: Record<string, unknown> = {}): NewProjectCandidate {
  return { departmentKey: KEY, candidateId: candidateProjectId(KEY, title), project: { title, reason: '理由' }, ...extra } as NewProjectCandidate;
}

describe('候補IDの同一性（課題No.9）', () => {
  it('同じ部門・同じ名称の候補は、以前の候補IDを引き継ぐ（空白と大文字小文字の違いは同一視する）', () => {
    const previous = [candidate('New Plan')];
    const next = newProjectCandidatesFrom(OFFICIAL, { [KEY]: [{ title: ' new  plan ', reason: '理由' }] }, previous);
    expect(next).toHaveLength(1);
    expect(next[0].candidateId).toBe(previous[0].candidateId);
  });

  it('名称が違う候補は同一視せず、新しい候補として扱う', () => {
    const previous = [candidate('顧客A向けの提案')];
    const next = newProjectCandidatesFrom(OFFICIAL, { [KEY]: [{ title: '顧客A向けの提案（改）' }] }, previous);
    expect(next[0].candidateId).not.toBe(previous[0].candidateId);
  });

  it('既存の計画と同じ名称の候補は、新規候補にしない（重複生成を防ぐ）', () => {
    const next = newProjectCandidatesFrom(OFFICIAL, { [KEY]: [{ title: '既存の施策' }, { title: '新しい施策' }] });
    expect(next.map((c) => c.project.title)).toEqual(['新しい施策']);
  });
});

describe('再生成で利用者の作業を残す（課題No.9）', () => {
  it('利用者が直した候補は、再生成後も直した内容で残る', () => {
    const previous = [candidate('AI案', { userEdited: true, project: { title: 'AI案', reason: '直した理由' } })];
    const next = [candidate('AI案', { project: { title: 'AI案', reason: '再生成の理由' } })];
    const kept = keepRegeneratedCandidates({ previous, next, regenKeys: new Set([KEY]), decidedIds: new Set() });
    expect(kept).toHaveLength(1);
    expect(kept[0].project.reason).toBe('直した理由');
    expect(kept[0].candidateId).toBe(previous[0].candidateId);
  });

  it('採否を決めた候補は、再生成で同じ計画が出なくても残り、判断も引き継がれる', () => {
    const previous = [candidate('採用した案')];
    const kept = keepRegeneratedCandidates({ previous, next: [candidate('別の案')], regenKeys: new Set([KEY]), decidedIds: new Set([previous[0].candidateId]) });
    expect(kept.map((c) => c.project.title).sort()).toEqual(['別の案', '採用した案']);
    const selections = projectSelectionsFrom(OFFICIAL, kept, [
      { departmentKey: KEY, departmentName: '営業部', candidateId: previous[0].candidateId, title: '採用した案', decision: 'applied' },
    ]);
    expect(selections.find((s) => s.title === '採用した案')?.decision).toBe('applied');
    expect(selections.find((s) => s.title === '別の案')?.decision).toBe('pending');
  });

  it('未判断で直していない候補は、再生成で置き換わる', () => {
    const previous = [candidate('古い案')];
    const kept = keepRegeneratedCandidates({ previous, next: [candidate('新しい案')], regenKeys: new Set([KEY]), decidedIds: new Set() });
    expect(kept.map((c) => c.project.title)).toEqual(['新しい案']);
  });

  it('再生成していない部門の候補は、そのまま残す', () => {
    const other = candidate('他部門の案', { departmentKey: 'name:開発部' });
    const kept = keepRegeneratedCandidates({ previous: [other], next: [], regenKeys: new Set([KEY]), decidedIds: new Set() });
    expect(kept).toEqual([]);
    const notRegenerated = keepRegeneratedCandidates({ previous: [other], next: [], regenKeys: new Set([KEY]), decidedIds: new Set([other.candidateId]) });
    expect(notRegenerated).toEqual([]);
  });

  it('同じIDの候補は1つにまとめる（重複させない）', () => {
    const prev = candidate('同じ案', { userEdited: true });
    const kept = keepRegeneratedCandidates({ previous: [prev], next: [candidate('同じ案'), candidate('同じ案')], regenKeys: new Set([KEY]), decidedIds: new Set() });
    expect(kept).toHaveLength(1);
  });
});

describe('手動で追加したプロジェクト（課題No.13）', () => {
  function withDraft(): WorkspaceState {
    return {
      ...emptyWorkspaceState(),
      drafts: [
        {
          draftId: 'draft-initial1',
          kind: 'initial',
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          departments: [{ name: '営業部', projects: [] }],
          newProjects: [],
          generatedDepartmentKeys: [KEY],
        },
      ],
    } as unknown as WorkspaceState;
  }

  it('名称と目的を入れると、候補と未判断の採否に入り、正式データは変えない', () => {
    const result = addManualProject(withDraft(), {
      departmentKey: KEY,
      departmentName: '営業部',
      officialTitles: ['既存の施策'],
      title: '  新規の顧客開拓  ',
      purpose: '既存顧客以外の売上を伸ばす',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const added = result.state.drafts[0].newProjects[0];
    expect(added.origin).toBe('manual');
    expect(added.userEdited).toBe(true);
    expect(added.project).toMatchObject({ title: '新規の顧客開拓', reason: '既存顧客以外の売上を伸ばす' });
    expect(result.state.projectSelections).toEqual([
      { departmentKey: KEY, departmentName: '営業部', candidateId: result.candidateId, title: '新規の顧客開拓', decision: 'pending' },
    ]);
  });

  it('名称が空なら追加しない', () => {
    const result = addManualProject(withDraft(), { departmentKey: KEY, departmentName: '営業部', officialTitles: [], title: '   ' });
    expect(result).toEqual({ ok: false, error: 'invalid_title' });
  });

  it('同じ部門に同じ名称の計画・候補があれば追加しない', () => {
    const result = addManualProject(withDraft(), { departmentKey: KEY, departmentName: '営業部', officialTitles: ['既存の施策'], title: '既存の施策' });
    expect(result).toEqual({ ok: false, error: 'duplicate_title' });
  });

  it('草案がなければ追加しない', () => {
    const result = addManualProject(emptyWorkspaceState(), { departmentKey: KEY, departmentName: '営業部', officialTitles: [], title: '案' });
    expect(result).toEqual({ ok: false, error: 'no_draft' });
  });

  it('手動で追加した候補は、再生成しても消えない', () => {
    const added = addManualProject(withDraft(), { departmentKey: KEY, departmentName: '営業部', officialTitles: [], title: '手動の案' });
    if (!added.ok) throw new Error('setup failed');
    const manual = added.state.drafts[0].newProjects;
    const kept = keepRegeneratedCandidates({ previous: manual, next: [candidate('AIの案')], regenKeys: new Set([KEY]), decidedIds: new Set() });
    expect(kept.map((c) => c.project.title).sort()).toEqual(['AIの案', '手動の案']);
  });
});
