import { departmentKeyOf, projectIdOf } from '@/lib/cascade/stage3Adjustment';
import { currentItemValues } from '@/lib/cascade/stage3Candidates';
import { latestDraft, type WorkspaceState } from '@/lib/cascade/stage3StrategyBook';

type AnyRecord = Record<string, unknown>;

const ACTIVE_PLAN_STATUSES = ['approved', 'adopted', 'started', 'in_progress'];

const hasItems = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v && typeof v === 'object' && Object.keys(v).length > 0);

/**
 * 部門を削除できない理由（関連データ）。空の理由の一覧なら削除してよい。
 * 承認済みの計画、KPIや実行計画、進捗の記録があれば、STAGE4〜6のデータを失うため拒否する。
 */
export function departmentDeleteBlockers(dept: AnyRecord): string[] {
  const reasons: string[] = [];
  const projects = Array.isArray(dept.projects) ? (dept.projects as AnyRecord[]) : [];
  for (const p of projects) {
    const title = String(p.title ?? '（無題）');
    if (typeof p.planStatus === 'string' && ACTIVE_PLAN_STATUSES.includes(p.planStatus)) {
      reasons.push(`「${title}」は承認・採用済みの計画です`);
    } else if (p.approvedAt || p.approvedBy) {
      reasons.push(`「${title}」は承認済みです`);
    }
    if (hasItems(p.okrsV2)) reasons.push(`「${title}」にはKPI（構造化）の記録があります`);
    if (hasItems(p.executionHumanInvestments) || hasItems(p.skillPlans) || hasItems(p.humanInvestments)) {
      reasons.push(`「${title}」には実行計画（人的投資・スキル）があります`);
    }
    if (hasItems(p.progressLogs) || hasItems(p.progress_logs)) reasons.push(`「${title}」には進捗の記録があります`);
  }
  return reasons;
}

/** 部門名の検査。空・長すぎ・同名はエラー（部門の識別は ID で行うため、名称変更で対応は切れない）。 */
export function validateDepartmentName(name: string, otherNames: string[]): string | null {
  const trimmed = name.trim();
  if (!trimmed) return '部門名を入力してください';
  if (trimmed.length > 40) return '部門名は40文字以内にしてください';
  if (otherNames.some((n) => n.trim() === trimmed)) return '同じ名前の部門があります';
  return null;
}

/**
 * 部門を削除したあと、作業状態からその部門の参照を取り除く。
 * 残った草案・分析が、存在しない部門を指さないようにする（保存時の検証を通すため）。
 */
export function pruneWorkspaceForDepartment(state: WorkspaceState, departmentKey: string): WorkspaceState {
  const drafts = state.drafts
    .map((d) => ({
      ...d,
      departments: d.departments.filter((x) => departmentKeyOf(x as AnyRecord) !== departmentKey),
      newProjects: d.newProjects.filter((np) => np.departmentKey !== departmentKey),
    }))
    .filter((d) => d.departments.length > 0);
  const draftIds = new Set(drafts.map((d) => d.draftId));
  const analysisTouched =
    !!state.analysis &&
    (state.analysis.candidates.some((c) => c.departments.some((d) => d.departmentKey === departmentKey)) ||
      (!!state.analysis.draftId && !draftIds.has(state.analysis.draftId)));
  return {
    ...state,
    drafts,
    selections: state.selections.filter((s) => s.departmentKey !== departmentKey),
    projectSelections: state.projectSelections.filter((p) => p.departmentKey !== departmentKey),
    analysis: analysisTouched ? null : state.analysis,
    candidateDecisions: analysisTouched ? {} : state.candidateDecisions,
    dialogue: analysisTouched ? [] : state.dialogue,
  };
}

export type CandidateProjectPatch = { title?: string; reason?: string; hypothesis?: string; description?: string };

/**
 * 再生成版の新規候補プロジェクトの文章（目的・仮説・取り組み内容・題名）を直す。
 * 候補の ID（候補ID・計画ID）は変えない。題名が変わると分析の参照が合わなくなるため、分析は取り消す。
 */
export function editCandidateProject(state: WorkspaceState, candidateId: string, patch: CandidateProjectPatch): WorkspaceState {
  const draft = latestDraft(state);
  if (!draft) return state;
  const target = draft.newProjects.find((np) => np.candidateId === candidateId);
  if (!target) return state;
  const oldTitle = String(target.project.title ?? '');
  const project: AnyRecord = { ...target.project };
  for (const key of ['title', 'reason', 'hypothesis', 'description'] as const) {
    if (patch[key] !== undefined) project[key] = patch[key].trim();
  }
  const newTitle = String(project.title ?? '');
  const planId = projectIdOf(target.project);
  const next: StrategyDraftLike = {
    ...draft,
    newProjects: draft.newProjects.map((np) => (np.candidateId === candidateId ? { ...np, project } : np)),
    departments: draft.departments.map((d) => ({
      ...d,
      projects: d.projects.map((p) =>
        projectIdOf(p as AnyRecord) === planId
          ? { ...p, title: newTitle, ...(patch.description !== undefined ? { description: patch.description.trim() } : {}) }
          : p,
      ),
    })),
  };
  const drafts = state.drafts.map((d) => (d.draftId === draft.draftId ? (next as typeof d) : d));
  const titleChanged = oldTitle !== newTitle;
  const analysisUsesCandidate =
    !!state.analysis && state.analysis.candidates.some((c) => c.planRefs.some((r) => r.projectId === planId));
  const dropAnalysis = titleChanged && analysisUsesCandidate;
  return {
    ...state,
    drafts,
    projectSelections: state.projectSelections.map((p) => (p.candidateId === candidateId ? { ...p, title: newTitle } : p)),
    analysis: dropAnalysis ? null : state.analysis,
    candidateDecisions: dropAnalysis ? {} : state.candidateDecisions,
    dialogue: dropAnalysis ? [] : state.dialogue,
  };
}

type StrategyDraftLike = WorkspaceState['drafts'][number];

/** 生成ボタンを押せない理由（押せる場合は null）。理由は具体的に返す。 */
export function generationBlockerOf(args: {
  loaded: boolean;
  canEdit: boolean;
  busy: boolean;
  stage2Status: 'loading' | 'confirmed' | 'not_confirmed' | 'story_missing' | 'error';
  stage2Message?: string;
  workspaceErrorCode?: string | null;
}): string | null {
  if (!args.canEdit) return '編集権限がないため作成できません（管理者・管理職のみ）';
  if (!args.loaded || args.stage2Status === 'loading') return '読み込み中です。少し待ってから操作してください';
  if (args.stage2Status === 'not_confirmed') return 'STAGE2の全社戦略が未確定のため作成できません（STAGE2で確定してください）';
  if (args.stage2Status === 'story_missing') return 'STAGE2は確定されていますが、確定版の本文がないため作成できません（STAGE2で確定し直してください）';
  if (args.stage2Status === 'error') return args.stage2Message || 'STAGE2の状態を確認できないため作成できません';
  if (args.workspaceErrorCode === 'workspace_table_missing') {
    return '作業データの保存先（stage3_strategy_books）が未適用のため作成できません（STAGE2の確定状態とは無関係です）';
  }
  if (args.workspaceErrorCode) return '作業データの保存先に接続できないため作成できません（時間をおいて再度お試しください）';
  if (args.busy) return '処理中です';
  return null;
}

/** 部門ごとの現在値（文書の「現在の値」欄に使う）。 */
export function currentDeptValues(dept: AnyRecord, item: Parameters<typeof currentItemValues>[1]) {
  return currentItemValues(dept, item);
}
