import type { StrategyState } from '@/store/strategyStore';
import type { StageOp } from './stage1Input';

export type RemovalOp = Extract<StageOp, { kind: 'segment.remove' | 'issue.remove' }>;

export type RemovalCheck = { ok: true } | { ok: false; reason: string };

/** 削除の判定は、現行のデータ構造の参照（事業ID・事業名・経営課題の題名）に基づく。文章の中の言及は対象外 */
export function removalCheck(op: RemovalOp, st: StrategyState): RemovalCheck {
  return op.kind === 'segment.remove' ? segmentCheck(op, st) : issueCheck(op, st);
}

function unreadable(field: string): RemovalCheck {
  return { ok: false, reason: `${field}の形式を確認できないため、紐づきを安全に判定できず、削除しません。` };
}

function segmentCheck(op: Extract<RemovalOp, { kind: 'segment.remove' }>, st: StrategyState): RemovalCheck {
  const seg = (st.businessSegments ?? []).find((s) => s.id === op.id);
  if (!seg || seg.name !== op.name) return { ok: false, reason: `事業「${op.name}」が見つかりません。` };

  const links: string[] = [];

  const plYears = (st.segmentPL?.[op.name] ?? []).map((r) => r.year);
  const bsCount = (st.segmentBS?.[op.name] ?? []).length;
  if (plYears.length > 0 || bsCount > 0) {
    links.push(plYears.length > 0 ? `事業別の財務データ（${plYears.join('・')}年度）` : '事業別の貸借対照表データ');
  }
  const confirmed = st.financeUnitConfirmed as { segmentPL?: string[]; segmentBS?: string[] } | undefined;
  if (confirmed?.segmentPL?.includes(op.id) || confirmed?.segmentBS?.includes(op.id)) {
    links.push('事業別財務の単位の確定状態');
  }

  for (const issue of (st.stage1Issues ?? []) as Array<{ title?: string; segmentName?: string }>) {
    if (issue.segmentName === op.name) links.push(`経営課題「${issue.title ?? ''}」（この事業に紐づけ）`);
  }

  if (st.departments !== undefined && !Array.isArray(st.departments)) return unreadable('部門（STAGE3）');
  for (const dept of st.departments ?? []) {
    if (dept.segmentName === op.name) links.push(`部門「${dept.name}」（この事業に紐づけ）`);
    else if (dept.name === op.name) links.push(`部門「${dept.name}」（事業名と同じ部門）`);
  }

  const units = st.businessPortfolio?.units;
  if (units !== undefined && !Array.isArray(units)) return unreadable('事業ポートフォリオ');
  for (const unit of units ?? []) {
    if (unit.id === op.id || unit.name === op.name) links.push(`事業ポートフォリオの単位「${unit.name}」`);
  }

  if (links.length > 0) return { ok: false, reason: `${links.join('、')}と紐づいているため、事業「${op.name}」は削除しません。` };
  return { ok: true };
}

function issueCheck(op: Extract<RemovalOp, { kind: 'issue.remove' }>, st: StrategyState): RemovalCheck {
  if (!(st.stage1Issues ?? []).some((i) => i.title === op.title)) {
    return { ok: false, reason: `経営課題「${op.title}」が見つかりません。` };
  }

  const links: string[] = [];

  if (st.companyTargets !== undefined && !Array.isArray(st.companyTargets)) return unreadable('企業の目標');
  for (const target of st.companyTargets ?? []) {
    if (!Array.isArray(target.linkedIssueIds)) return unreadable('企業の目標の経営課題の紐づけ');
    if (target.linkedIssueIds.includes(op.title)) links.push(`企業の目標「${target.label}」`);
  }

  if (st.projectIssueLinks !== undefined && !Array.isArray(st.projectIssueLinks)) return unreadable('プロジェクトと経営課題の紐づけ');
  for (const link of st.projectIssueLinks ?? []) {
    if (link.issueId === op.title) links.push(`プロジェクト（${link.projectId}）`);
  }

  if (links.length > 0) return { ok: false, reason: `${links.join('、')}と紐づいているため、経営課題「${op.title}」は削除しません。` };
  return { ok: true };
}
