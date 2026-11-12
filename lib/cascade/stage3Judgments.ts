import type { WorkspaceState } from './stage3StrategyBook';

export type JudgmentCounts = {
  total: number;
  adopted: number;
  deferred: number;
  rejected: number;
  undecided: number;
};

export type JudgmentSummary = {
  appliedItems: number;
  projects: JudgmentCounts;
  adjustments: JudgmentCounts;
  /** 確定の前に判断が必要な件数（新規プロジェクトの未判断と、部門間調整の未判断の合計） */
  blockers: number;
};

/**
 * 新規プロジェクト候補と部門間調整候補を、それぞれ1回ずつ数える。
 * 同じ候補は1つの判断（採用・保留・不採用・未判断）にだけ入る。項目の数（反映）は別に数える。
 */
export function judgmentSummaryOf(state: WorkspaceState): JudgmentSummary {
  const projects = countOf(
    state.projectSelections.map((p) => p.decision),
    { applied: 'adopted', deferred: 'deferred', discarded: 'rejected', pending: 'undecided' },
  );
  const adjustmentIds = (state.analysis?.candidates ?? []).map((c) => c.id);
  const adjustments = countOf(
    adjustmentIds.map((id) => state.candidateDecisions[id] ?? 'pending'),
    { adopted: 'adopted', deferred: 'deferred', rejected: 'rejected', pending: 'undecided' },
  );
  return {
    appliedItems: state.selections.filter((s) => s.decision === 'applied').length,
    projects,
    adjustments,
    blockers: projects.undecided + adjustments.undecided,
  };
}

function countOf(values: string[], names: Record<string, keyof Omit<JudgmentCounts, 'total'>>): JudgmentCounts {
  const counts: JudgmentCounts = { total: values.length, adopted: 0, deferred: 0, rejected: 0, undecided: 0 };
  for (const v of values) {
    const key = names[v];
    if (key) counts[key] += 1;
  }
  return counts;
}

/** 確定ボタンを押せない理由（押せるなら null）。件数は judgmentSummaryOf と同じ数を使う。 */
export function judgmentBlockerOf(summary: JudgmentSummary): string | null {
  if (summary.blockers === 0) return null;
  return `あと${summary.blockers}件の判断が必要です（新規プロジェクト${summary.projects.undecided}件・部門間調整${summary.adjustments.undecided}件）`;
}
