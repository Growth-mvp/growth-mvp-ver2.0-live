import { judgmentBlockerOf, judgmentSummaryOf } from './stage3Judgments';
import { emptyWorkspaceState, type WorkspaceState } from './stage3StrategyBook';

const project = (candidateId: string, decision: 'pending' | 'applied' | 'discarded' | 'deferred') => ({
  departmentKey: 'id:d-sales',
  departmentName: '営業部',
  candidateId,
  title: `候補${candidateId}`,
  decision,
});

const adjustment = (id: string) => ({ id }) as unknown as NonNullable<WorkspaceState['analysis']>['candidates'][number];

describe('judgmentSummaryOf（判断件数の集計）', () => {
  it('新規プロジェクトの不採用と未判断は、別々の候補として1回ずつ数える（二重に数えない）', () => {
    const state: WorkspaceState = {
      ...emptyWorkspaceState(),
      projectSelections: [
        ...Array.from({ length: 5 }, (_, i) => project(`np-0000000${i}`, 'discarded')),
        ...Array.from({ length: 5 }, (_, i) => project(`np-1111111${i}`, 'pending')),
      ],
    };
    const summary = judgmentSummaryOf(state);
    expect(summary.projects).toEqual({ total: 10, adopted: 0, deferred: 0, rejected: 5, undecided: 5 });
    expect(summary.projects.adopted + summary.projects.deferred + summary.projects.rejected + summary.projects.undecided).toBe(summary.projects.total);
  });

  it('確定を止めるのは部門間調整の未判断だけで、新規プロジェクトの未選択は保留として確定できる', () => {
    const state: WorkspaceState = {
      ...emptyWorkspaceState(),
      projectSelections: [project('np-00000001', 'pending'), project('np-00000002', 'applied')],
      analysis: {
        draftId: null,
        draftVersion: null,
        createdAt: '2026-11-12T00:00:00.000Z',
        candidates: [adjustment('adj-1'), adjustment('adj-2')],
        rejectedCandidates: 0,
        rejectedReferences: 0,
      },
      candidateDecisions: { 'adj-1': 'adopted' },
    };
    const summary = judgmentSummaryOf(state);
    expect(summary.adjustments).toEqual({ total: 2, adopted: 1, deferred: 0, rejected: 0, undecided: 1 });
    expect(summary.blockers).toBe(1);
    expect(judgmentBlockerOf(summary)).toBe('部門間調整の判断が1件残っています。採用・保留・不採用のいずれかを選んでください。');
  });

  it('未判断が無ければ、確定を止める理由は無い', () => {
    const state: WorkspaceState = {
      ...emptyWorkspaceState(),
      projectSelections: [project('np-00000001', 'applied')],
      selections: [
        { departmentKey: 'id:d-sales', departmentName: '営業部', item: 'mission', proposed: { mission: 'x' }, base: { mission: 'y' }, decision: 'applied' },
      ],
    };
    const summary = judgmentSummaryOf(state);
    expect(summary.appliedItems).toBe(1);
    expect(summary.blockers).toBe(0);
    expect(judgmentBlockerOf(summary)).toBeNull();
  });
});
