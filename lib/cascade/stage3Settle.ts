import { departmentKeyOf } from '@/lib/cascade/stage3Adjustment';
import { currentItemValues, isEmptyProposalValue, sameItemValues, type DeptProposalItem } from '@/lib/cascade/stage3Candidates';
import type { Selection, WorkspaceState } from '@/lib/cascade/stage3StrategyBook';

type AnyRecord = Record<string, unknown>;

export type SettleCounts = { applied: number; discarded: number };

/**
 * 旧方式（項目ごとの採否）で残った未判断の変更案を、文書の表示どおりに確定できる形にする。
 * 文書は未判断の案を表示している。表示中の内容があり、保存時点の正式値と一致するものだけ「反映する」にする。
 * それ以外（空の内容・正式値と食い違う・部門が無い）は「反映しない」にし、正式データは変えない。
 */
export function settleLegacySelections(
  state: WorkspaceState,
  officialDepartments: unknown[],
): { state: WorkspaceState; counts: SettleCounts } {
  const counts: SettleCounts = { applied: 0, discarded: 0 };
  if (!state.selections.some((s) => s.decision === 'pending')) return { state, counts };
  const selections = state.selections.map((s): Selection => {
    if (s.decision !== 'pending') return s;
    const dept = officialDepartments.find(
      (d): d is AnyRecord => !!d && typeof d === 'object' && departmentKeyOf(d as AnyRecord) === s.departmentKey,
    );
    const adoptable =
      !!dept &&
      !isEmptyProposalValue(s.proposed) &&
      sameItemValues(s.base, currentItemValues(dept, s.item as DeptProposalItem));
    if (adoptable) counts.applied += 1;
    else counts.discarded += 1;
    return { ...s, decision: adoptable ? 'applied' : 'discarded' };
  });
  return { state: { ...state, selections }, counts };
}
