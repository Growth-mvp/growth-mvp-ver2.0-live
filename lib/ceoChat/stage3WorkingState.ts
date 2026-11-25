/* STAGE3の作業版（採否・部門間調整・草案・確定状態）を、保存済みの値から要約する（読み取りのみ。採否は変えない）。 */
import type { WorkspaceState } from '@/lib/cascade/stage3StrategyBook';

const HEAD = '# STAGE3の作業版・採否・確定状態（保存済み。読み取りのみ）';
const APPLIED = '採用';
const DEFERRED = '保留';
const REJECTED = '不採用';
const UNDECIDED = '未判断';

type Tally = { applied: number; deferred: number; rejected: number; pending: number };

function tally(decisions: Array<string | undefined>): Tally {
  const t: Tally = { applied: 0, deferred: 0, rejected: 0, pending: 0 };
  for (const d of decisions) {
    if (d === 'applied' || d === 'adopted') t.applied += 1;
    else if (d === 'deferred') t.deferred += 1;
    else if (d === 'discarded' || d === 'rejected') t.rejected += 1;
    else t.pending += 1;
  }
  return t;
}

const tallyText = (t: Tally): string =>
  `${APPLIED} ${t.applied}件・${DEFERRED} ${t.deferred}件・${REJECTED} ${t.rejected}件・${UNDECIDED} ${t.pending}件`;

export function buildStage3WorkingStateBlock(input: { state: WorkspaceState | null; failed: boolean }): string {
  if (input.failed) return `${HEAD}\n【概要】取得失敗（作業版を読めなかったため、採否・確定状態は判断しない）`;
  const state = input.state;
  if (!state) return `${HEAD}\n【概要】作業版なし（STAGE3で作業版を作っていない）`;

  const confirmed = state.confirmed;
  const isConfirmed = state.status === 'confirmed' && !!confirmed;
  const drafts = Array.isArray(state.drafts) ? state.drafts : [];
  const latest = drafts.length > 0 ? drafts[drafts.length - 1] : null;
  const candidateIds = Array.from(new Set(state.adjustmentProposals.map((p) => p.candidateId)));
  const adjustment = tally(candidateIds.map((id) => state.candidateDecisions[id]));
  const projects = tally(state.projectSelections.map((p) => p.decision));
  const items = tally(state.selections.map((s) => s.decision));
  const undecided = projects.pending + items.pending + adjustment.pending;

  const draftNewer = !!(isConfirmed && latest && confirmed && String(latest.createdAt) > String(confirmed.confirmedAt));
  let reconfirm: string;
  if (undecided > 0) reconfirm = '未判断の候補が残っているため、確定できない（先に採否を決める）';
  else if (isConfirmed && state.status === 'draft') reconfirm = '確定版の後に作業版が変わっている。内容を反映するには、STAGE3で再確定が必要';
  else if (draftNewer) reconfirm = '確定版より新しい草案がある。内容を反映するには、再生成と再確定が必要';
  else if (!isConfirmed && drafts.length > 0) reconfirm = '確定版はまだない。STAGE3で確定すると、戦略として有効になる';
  else if (isConfirmed) reconfirm = '確定版と作業版は同じ状態';
  else reconfirm = '作業版に草案がない';

  return [
    HEAD,
    `【概要】${isConfirmed ? `確定済み（確定日時 ${String(confirmed?.confirmedAt ?? '不明')}）` : '未確定（作業版のみ。確定版はまだない）'}`,
    `- 作業版の状態：${state.status === 'confirmed' ? '確定' : '草案中'}。草案：${drafts.length}件${latest ? `（最新 ${String(latest.createdAt ?? '日時不明')}、部門${Array.isArray(latest.departments) ? latest.departments.length : 0}件、新規プロジェクト${Array.isArray(latest.newProjects) ? latest.newProjects.length : 0}件）` : ''}。草案は作業版の案で、確定した戦略ではない`,
    `- 基本方針の項目（採否）：${tallyText(items)}`,
    `- プロジェクト候補（採否）：${tallyText(projects)}`,
    `- 部門間調整の候補（採否）：${candidateIds.length}件（${tallyText(adjustment)}）`,
    `- 再生成・再確定の要否：${reconfirm}`,
  ].join('\n');
}
