import type { ConfirmedJudgment, ProjectProposal, ProjectSelection } from './stage3StrategyBook';

export type JudgmentItem = {
  kind: ConfirmedJudgment['kind'];
  departmentKey: string;
  departmentName: string;
  itemId: string;
  title: string;
  /** 今回の作業で利用者が明示的に選んだ判断。未判断・保留のままなら null */
  explicit: 'adopted' | 'rejected' | null;
};

const keyOf = (e: Pick<ConfirmedJudgment, 'kind' | 'departmentKey' | 'itemId'>) => `${e.kind}|${e.departmentKey}|${e.itemId}`;

const projectExplicit = (decision: ProjectSelection['decision']): JudgmentItem['explicit'] =>
  decision === 'applied' ? 'adopted' : decision === 'discarded' ? 'rejected' : null;

const proposalExplicit = (decision: ProjectProposal['decision']): JudgmentItem['explicit'] =>
  decision === 'adopted' ? 'adopted' : decision === 'rejected' ? 'rejected' : null;

export function judgmentItemsOf(state: {
  projectSelections: ProjectSelection[];
  projectProposals: ProjectProposal[];
}): JudgmentItem[] {
  return [
    ...state.projectSelections.map((p) => ({
      kind: 'project' as const,
      departmentKey: p.departmentKey,
      departmentName: p.departmentName,
      itemId: p.candidateId,
      title: p.title,
      explicit: projectExplicit(p.decision),
    })),
    ...state.projectProposals.map((p) => ({
      kind: 'proposal' as const,
      departmentKey: p.departmentKey,
      departmentName: p.departmentName,
      itemId: p.projectId,
      title: p.projectTitle,
      explicit: proposalExplicit(p.decision),
    })),
  ];
}

/**
 * 確定時の判断の記録を作り直す。利用者が今回明示的に選んだ判断だけを新しく書き、
 * 未判断・保留の候補は、以前の記録があればそのまま残す（deferredで上書きしない）。
 * 記録にない候補は保留として残す。過去の版の記録は、その版の判断として残す。
 */
export function mergeConfirmedJudgments(input: {
  previous: ConfirmedJudgment[];
  items: JudgmentItem[];
  draftVersion: number | null;
  confirmedAt: string;
}): ConfirmedJudgment[] {
  const byKey = new Map(input.previous.map((e) => [keyOf(e), e] as const));
  for (const item of input.items) {
    const key = keyOf(item);
    if (item.explicit) {
      byKey.set(key, recordOf(item, item.explicit, input));
    } else if (!byKey.has(key)) {
      byKey.set(key, recordOf(item, 'deferred', input));
    }
  }
  return [...byKey.values()];
}

export function confirmedJudgmentOf(
  judgments: ConfirmedJudgment[] | undefined,
  kind: ConfirmedJudgment['kind'],
  departmentKey: string,
  itemId: string,
): ConfirmedJudgment | undefined {
  return judgments?.find((e) => e.kind === kind && e.departmentKey === departmentKey && e.itemId === itemId);
}

function recordOf(
  item: JudgmentItem,
  decision: ConfirmedJudgment['decision'],
  input: { draftVersion: number | null; confirmedAt: string },
): ConfirmedJudgment {
  return {
    kind: item.kind,
    departmentKey: item.departmentKey,
    departmentName: item.departmentName,
    itemId: item.itemId,
    title: item.title,
    decision,
    draftVersion: input.draftVersion,
    confirmedAt: input.confirmedAt,
  };
}
