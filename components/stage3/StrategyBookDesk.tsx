'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { authFetchJson, AuthFetchError } from '@/utils/authFetch';
import {
  ADJUSTMENT_KIND_LABEL,
  PROPOSAL_ITEM_LABEL,
  departmentKeyOf,
  displayTextOf,
  internalIdNamesOf,
  withAdjustmentEdit,
  type AdjustmentCandidate,
  type AdjustmentProposal,
  type DialogueResult,
  type ProjectChangeFields,
  type ProjectChangeProposal,
} from '@/lib/cascade/stage3Adjustment';
import { DEPT_PROPOSAL_ITEMS, currentItemValues, type DeptProposal, type DeptProposalItem } from '@/lib/cascade/stage3Candidates';
import {
  draftDepartmentsFrom,
  keepRegeneratedCandidates,
  newProjectCandidatesFrom,
  projectProposalsAfterRegeneration,
  projectSelectionsFrom,
  selectionsFrom,
} from '@/lib/cascade/stage3Draft';
import { isProjectActive } from '@/lib/cascade/projectLifecycle';
import {
  departmentDeleteBlockers,
  addManualProject,
  editCandidateProject,
  generationBlockerOf,
  pruneWorkspaceForDepartment,
  validateDepartmentName,
} from '@/lib/cascade/departmentManagement';
import {
  emptyWorkspaceState,
  latestDraft,
  MAX_DRAFTS,
  type ProjectSelection,
  type Selection,
  type StrategyDraft,
  type WorkspaceState,
} from '@/lib/cascade/stage3StrategyBook';
import type { Department } from '@/types/strategy';
import { StrategyBookDocument, type DocProject, type SectionEdit, type StrategyDocumentProps, type TextItemKey } from '@/components/stage3/StrategyBookDocument';
import { projectDetailOf, type DraftProjectInput } from '@/lib/cascade/stage3ProjectDetail';
import { analysisBlockerOf, judgmentBlockerOf, judgmentSummaryOf } from '@/lib/cascade/stage3Judgments';
import { replayDecisions, settleSentDecisions, type DecisionEntry } from '@/lib/cascade/stage3DecisionQueue';
import type { SettleCounts } from '@/lib/cascade/stage3Settle';
import { projectTextOf } from '@/lib/cascade/stage3Confirm';
import {
  planBasisKey,
  responseStillApplies,
  verificationFor,
  workspaceSignature,
  stableIdText,
  type ProjectProposal,
  type ProjectTextFields,
  type ProjectEdit,
  type Verification,
} from '@/lib/cascade/stage3StrategyBook';
import { EditableBlock } from '@/components/okr/execution-plan/PlanDocument';
import { PLAN_DOC_CSS } from '@/components/okr/execution-plan/planDocStyles';
import { useConsultFocus } from '@/hooks/useConsultFocus';
import type { ConsultFocus } from '@/lib/consult/consultFocus';

type AnyRecord = Record<string, unknown>;
type TextDraft = Partial<Record<TextItemKey, string>>;

const ALL_TEXT_KEYS: TextItemKey[] = [
  'mission',
  'missionDescription',
  'currentPosition',
  'strategicRole',
  'keyIssues',
  'intraCollab',
  'interCollab',
  'alignmentRiskPoints',
  'reviewSummary',
  'stopList',
  'riskNotes',
];

const TEXT_SPECS: Record<TextItemKey, { item: DeptProposalItem; lines: boolean }> = {
  mission: { item: 'mission', lines: false },
  missionDescription: { item: 'missionDescription', lines: false },
  currentPosition: { item: 'currentPosition', lines: false },
  strategicRole: { item: 'strategicRole', lines: false },
  keyIssues: { item: 'keyIssues', lines: true },
  intraCollab: { item: 'collab', lines: true },
  interCollab: { item: 'collab', lines: true },
  alignmentRiskPoints: { item: 'alignmentRiskPoints', lines: true },
  reviewSummary: { item: 'reviewSummary', lines: true },
  stopList: { item: 'stopList', lines: true },
  riskNotes: { item: 'riskNotes', lines: true },
};

const TEXT_LABEL: Record<TextItemKey, string> = {
  mission: '事業・部門の使命',
  missionDescription: '概要・仮説',
  currentPosition: '現在の位置づけ',
  strategicRole: '全社戦略における役割',
  keyIssues: '重点課題と勝ち筋',
  intraCollab: '事業内・部門内の連携',
  interCollab: '他の事業・部門との連携',
  alignmentRiskPoints: '認識のズレが起きやすいポイント',
  reviewSummary: '再考ポイント・部門横断論点',
  stopList: '停止事項',
  riskNotes: 'リスク注記',
};

const textDraftOf = (doc: StrategyDocumentProps | null): TextDraft =>
  Object.fromEntries(ALL_TEXT_KEYS.map((k) => [k, (doc?.texts[k] ?? []).join('\n')]));

type ProjectTextDraft = { title: string; reason: string; hypothesis: string; description: string };

const projectDraftOf = (p: DocProject): ProjectTextDraft => ({
  title: p.title,
  reason: p.purpose ?? '',
  hypothesis: p.hypothesis ?? '',
  description: p.summary ?? '',
});

/** 編集対象になる、正式データのプロジェクト（計画から外す予定のものは除く）の下書き */
const editableProjectDraftsOf = (doc: StrategyDocumentProps | null): Record<string, ProjectTextDraft> =>
  Object.fromEntries(
    (doc?.projects ?? [])
      .filter((p) => p.id && !p.removed && p.origin === 'official')
      .map((p) => [p.id as string, projectDraftOf(p)]),
  );

const sameFields = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export type StrategyBookGenerateResult = { projects: AnyRecord[]; proposals: DeptProposal[] };

export type StrategyBookGate =
  | { ok: true; companyId: string; strategyId: string; revision: number }
  | { ok: false; reason: string };

interface StrategyBookDeskProps {
  departments: Department[];
  canEdit: boolean;
  canManageDepartments: boolean;
  getWriteGate: () => StrategyBookGate;
  /** 読み取り専用の企業・戦略スコープ。store復元完了後に親から渡す。 */
  readCompanyId: string | null;
  readStrategyId: string | null;
  generateDepartment: (index: number, mode: 'draft' | 'regen') => Promise<StrategyBookGenerateResult | null | undefined | void>;
  /** 再生成の前に、未保存の回答を保存する。保存できなければ再生成しない。 */
  prepareRegeneration?: (index: number) => Promise<{ ok: true } | { ok: false; message: string }>;
  renderSixQuestions: (index: number, registerFlush: (flush: (() => void) | null) => void) => ReactNode;
  onConfirmed: (message: string) => Promise<void> | void;
  onExportDepartment: (name: string, options: { confirmedAt?: string; working?: StrategyDocumentProps }) => Promise<void>;
  onAddDepartment: (name: string, mission: string) => Promise<boolean>;
  onRenameDepartment: (index: number, name: string) => Promise<boolean>;
  onDeleteDepartment: (index: number) => Promise<boolean>;
  /** 旧ページからの互換プロパティ。新STAGE3では財務表を表示しない。 */
  financeInfo?: ReactNode;
}

type Stage2View =
  | { status: 'loading' }
  | { status: 'confirmed'; companyStrategy: string }
  | { status: 'not_confirmed' }
  | { status: 'story_missing' }
  | { status: 'error'; message: string };

type StateResponse = {
  ok: true;
  version: number;
  state: WorkspaceState;
  legacySettled: SettleCounts;
  revision: number;
  stage2Status: 'confirmed' | 'not_confirmed' | 'story_missing';
  companyStrategy: string | null;
};
type FailedStateBody = {
  ok: false;
  error: string;
  stage2Status?: 'confirmed' | 'not_confirmed' | 'story_missing';
  companyStrategy?: string | null;
  departmentName?: string;
  item?: string;
};
type SaveResponse = { ok: true; version: number };
type AnalyzeResponse = {
  ok: true;
  revision: number;
  candidates: AdjustmentCandidate[];
  rejectedCandidates: number;
  rejectedReferences: number;
};
type RegenerateResponse = {
  ok: true;
  departments: Array<{ departmentKey: string; departmentName: string; proposals: DeptProposal[] }>;
  rejectedDepartments: number;
  projects: ProjectChangeProposal[];
  rejectedProjects: number;
};
type VerifyResponse = {
  ok: true;
  persisted: boolean;
  workspaceVersion: number;
  state: WorkspaceState | null;
  verification: Verification;
};
type ConfirmResponse = { ok: true; revision: number; version: number; appliedCount: number; adoptedProjectIds: string[] };

const ERROR_MESSAGE: Record<string, string> = {
  unauthorized: '認証できませんでした。再ログインしてください。',
  forbidden: 'この会社・戦略を利用する権限がありません。',
  strategy_mismatch: '対象の戦略を確認できませんでした。画面を再読み込みしてください。',
  workspace_table_missing:
    '作業データの保存先（stage3_strategy_books）が未適用のため、保存できません。STAGE2の確定状態とは無関係です。管理者に確認してください。',
  workspace_unavailable: '作業データを読み込めませんでした（保存先に接続できません）。時間をおいて再度お試しください。',
  stage2_not_confirmed: '全社戦略（STAGE2）が確定されていません。STAGE2で確定してから進めてください。',
  stage2_story_missing: 'STAGE2は確定されていますが、確定版の本文が保存されていません。STAGE2で確定し直してください。',
  unverifiable_departments: '部門データを確認できませんでした。',
  insufficient_departments: '行動計画が2つ以上の部門にないため、部門間の調整対象はありません。',
  invalid_candidates: '調整候補が古くなっています。分析し直してください。',
  invalid_dialogue: '話し合いの結果の内容を確認してください。',
  invalid_state: '作業内容を保存できる形で確認できませんでした。',
  workspace_mismatch: '保存済みの作業内容が正式データと合わなくなりました。画面を再読み込みしてください。',
  version_conflict: '別の操作で作業内容が更新されました。画面を再読み込みしてください。',
  revision_changed: '他の利用者が計画を更新しました。画面を再読み込みしてから、もう一度お試しください。',
  draft_version_mismatch: '参照した草案の版が古くなりました。画面を再読み込みしてください。',
  upstream_unparseable: 'AIの出力を読み取れませんでした。もう一度お試しください。',
  confirmed_with_pending: '未判断の変更案が残っています。反映するか、保留・反映しないを選んでください。',
  project_edit_conflict:
    '同じ計画を戦略書で編集しているか、計画から外す予定のため、変更候補を採用できません。どちらかを取り消してから、もう一度お試しください。',
  project_proposal_duplicated: '同じ計画への変更候補が重複しています。画面を再読み込みしてください。',
  confirmed_with_undecided_candidate: '未判断の調整候補が残っています。採用・保留・不採用のいずれかを選んでください。',
  analysis_required: '部門間の調整がまだ分析されていないため、確定できません。「部門間の調整」で計画案を分析してから、確定してください。',
  already_confirmed: 'この内容はすでに確定済みです。',
  current_value_changed:
    '正式データの値が変更案を作った後に変わっていたため、この変更は反映していません。回答と判断は残っています。該当部門の「6問を反映して戦略書を再生成」で変更案を作り直してから、もう一度確定してください。',
  confirm_failed: '確定できませんでした。正式データも作業内容も変わっていません。',
  insufficient_role: '確定は管理者・管理職のみ行えます。',
  reference_check_failed: '計画からの参照を確認できず、外す処理を止めました。時間をおいて再度お試しください。',
  invalid_request: '送信内容を確認できませんでした。画面を再読み込みしてから、もう一度お試しください。',
  membership_check_unavailable: '権限を確認できませんでした（保存先に接続できません）。時間をおいて再度お試しください。',
  strategy_check_unavailable: '戦略の情報を確認できませんでした（保存先に接続できません）。時間をおいて再度お試しください。',
  stored_state_invalid: '保存済みの作業内容を読み込めませんでした。管理者に確認してください。',
  candidate_missing: '確定の対象の新規プロジェクト案が見つかりません。画面を再読み込みしてください。',
  project_referenced: '計画から外そうとしたプロジェクトが、実行計画などから参照されています。外さずに確定してください。',
  project_missing: '確定の対象のプロジェクトが正式データに見つかりません。画面を再読み込みしてください。',
  project_unknown: '確定の対象のプロジェクトが正式データに見つかりません。画面を再読み込みしてください。',
  project_changed: '対象のプロジェクトが、案を作った後に変わっていました。正式データは変わっていません。画面を再読み込みしてください。',
  project_edit_duplicated: '同じプロジェクトの編集が重複しています。画面を再読み込みしてください。',
  project_removal_duplicated: '同じプロジェクトを外す操作が重複しています。画面を再読み込みしてください。',
  invalid_project: '新規プロジェクトの内容を確認できませんでした。内容を見直してから、もう一度お試しください。',
  invalid_change: '戦略書の変更内容を確認できませんでした。内容を見直してから、もう一度お試しください。',
  duplicate_change: '同じ項目への変更が重複しています。画面を再読み込みしてください。',
  department_missing: '確定の対象の部門が正式データに見つかりません。画面を再読み込みしてください。',
  adoption_department_missing: '採用するプロジェクトの部門が正式データに見つかりません。画面を再読み込みしてください。',
  invalid_departments: '部門の情報を確認できませんでした。画面を再読み込みしてください。',
  draft_id_duplicated: '保存済みの作業内容が正式データと合わなくなりました。画面を再読み込みしてください。',
  draft_department_unknown: '保存済みの作業内容が正式データと合わなくなりました。画面を再読み込みしてください。',
  draft_project_duplicated: '保存済みの作業内容が正式データと合わなくなりました。画面を再読み込みしてください。',
  analysis_draft_unknown: '保存済みの作業内容が正式データと合わなくなりました。画面を再読み込みしてください。',
  analysis_candidates_invalid: '部門間の調整候補が古くなっています。分析し直してから確定してください。',
  selection_department_unknown: '保存済みの作業内容が正式データと合わなくなりました。画面を再読み込みしてください。',
  decision_unknown_candidate: '保存済みの作業内容が正式データと合わなくなりました。画面を再読み込みしてください。',
  dialogue_invalid: '話し合いの結果の内容を確認してください。',
  confirmed_without_record: '確定の記録が不完全です。画面を再読み込みしてください。',
  internal_error: '確定できませんでした（サーバーで処理できませんでした）。正式データも作業内容も変わっていません。',
};

const DEFAULT_ERROR = '処理に失敗しました。時間をおいて再度お試しください。';
const DECISIONS_UNSAVED_MESSAGE = '採否の保存が終わっていません。保存が終わってから操作してください。';
/* 処理中の進行状態。AIの処理は時間がかかるため、何をしているかを利用者に示す */
const BUSY_TEXT: Record<string, string> = {
  initial: '戦略書のたたき台を作っています。1〜2分かかることがあります。',
  regenerated: '6問の回答を反映して、戦略書を作り直しています。',
  analyze: '部門間の調整を分析しています。終わるまで、戦略書は閲覧できます。',
  proposal: 'AI調整案を作っています。',
  regenerate: '採用した調整案から、変更案を作っています。',
  verify: '調整後の計画を再検証しています。',
  confirm: '戦略書を確定しています。',
};

function linkedProjectOf(departments: readonly unknown[], candidateId: string): AnyRecord | undefined {
  for (const dept of departments) {
    const list = (dept as AnyRecord | null)?.projects;
    const hit = Array.isArray(list) ? list.find((p) => (p as AnyRecord | null)?.sourceCandidateId === candidateId) : undefined;
    if (hit) return hit as AnyRecord;
  }
  return undefined;
}

function errorCode(e: unknown): string | null {
  if (!(e instanceof AuthFetchError)) return null;
  try {
    const code = JSON.parse(e.bodyText ?? '')?.error;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

function errorBody(e: unknown): FailedStateBody | null {
  if (!(e instanceof AuthFetchError)) return null;
  try {
    return JSON.parse(e.bodyText ?? '') as FailedStateBody;
  } catch {
    return null;
  }
}

/** 通信の失敗（接続できない）と、サーバーが返した理由を区別して表示する。 */
function errorMessage(e: unknown): string {
  if (e instanceof TypeError) return '通信に失敗しました。接続を確認して、もう一度お試しください。';
  const code = errorCode(e);
  return (code && ERROR_MESSAGE[code]) || DEFAULT_ERROR;
}

/** 確定の失敗理由。部門・項目が分かる場合は、どこで止まったかを添える（プロジェクトは項目名を出さない）。 */
function confirmErrorMessage(e: unknown): string {
  const body = errorBody(e);
  const reason = errorMessage(e);
  if (!body?.departmentName) return reason;
  const where = body.item && body.item !== 'project' ? `「${body.departmentName}」の「${body.item}」` : `「${body.departmentName}」`;
  return `${where}で確定を止めました。${reason}`;
}

const dialogueKey = (candidateId: string, topic: string) => `${candidateId} ${topic}`;
type ProposalResponse = {
  ok: true;
  revision: number;
  workspaceVersion: number;
  proposals: AdjustmentProposal[];
  rejectedChanges: number;
};

/* 採否の選択ボタン（部門間の調整・新規プロジェクト候補で共通）。選択中は色と「✓」の両方で示す */
function ChoiceButton({
  selected,
  tone,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  tone: 'adopt' | 'reject';
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const selectedClass =
    tone === 'adopt' ? 'border-[#1e3a8a] bg-[#1e3a8a] text-white' : 'border-slate-500 bg-slate-500 text-white';
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-9 min-w-[7.5rem] items-center justify-center gap-1 rounded-full border-2 px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        selected ? selectedClass : 'border-slate-400 bg-white text-slate-900 hover:bg-slate-50'
      }`}
    >
      {selected && <span aria-hidden="true">✓</span>}
      {children}
    </button>
  );
}

const reopen = (state: WorkspaceState): WorkspaceState => ({ ...state, status: 'draft', confirmed: null });
const nextDraftVersion = (state: WorkspaceState) => Math.max(0, ...state.drafts.map((d) => d.version)) + 1;
const newDraftId = () => `draft-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const CANDIDATE_LABEL = { adopted: '採用', deferred: '保留', rejected: '不採用' } as const;

const PROJECT_PROPOSAL_LABEL = { pending: '未判断', adopted: '採用', rejected: '採用しない' } as const;
const PROJECT_CHANGE_FIELD_LABEL = { title: '計画名', hypothesis: '仮説', reason: '理由', description: '内容' } as const;

/** 変更候補の差分を、表示用の1行ずつの文にする（変わった項目だけ） */
function projectChangeLines(base: ProjectChangeFields, next: ProjectChangeFields): string[] {
  const lines: string[] = [];
  for (const key of ['title', 'hypothesis', 'reason', 'description'] as const) {
    if ((base[key] ?? '') === (next[key] ?? '')) continue;
    lines.push(`${PROJECT_CHANGE_FIELD_LABEL[key]}：${base[key] || '（未設定）'} → ${next[key] || '（未設定）'}`);
  }
  const count = Math.max(base.kpis.length, next.kpis.length);
  for (let i = 0; i < count; i += 1) {
    if (base.kpis[i] === next.kpis[i]) continue;
    lines.push(`KPI${i + 1}：${base.kpis[i] ?? '（なし）'} → ${next.kpis[i] ?? '（なし）'}`);
  }
  return lines;
}
const PROJECT_DECISION_LABEL = { applied: '採用する', deferred: '保留する', discarded: '採用しない', pending: '未判断' } as const;

/* 作業の手順。各STEPは内部の段階（phase）に対応する。STEP2は6問と再生成（phase 2・3）をまとめる */
const STEPS: Array<{ phase: Phase; label: string; title: string }> = [
  { phase: 1, label: 'STEP1', title: 'たたき台' },
  { phase: 2, label: 'STEP2', title: '6つの問い' },
  { phase: 4, label: 'STEP3', title: '戦略書を編集' },
  { phase: 5, label: 'STEP4', title: '重点プロジェクトを選ぶ' },
];

/* 同じ内容の計画か（空白と大文字小文字を無視して題名で比べる） */
const sameTitle = (a: string, b: string): boolean =>
  a.replace(/\s/g, '').toLowerCase() === b.replace(/\s/g, '').toLowerCase();

const linesOf = (v: unknown): string[] =>(Array.isArray(v) ? v.map((x) => String(x)) : typeof v === 'string' && v ? [v] : []);

function projectSummaryOf(state: WorkspaceState, candidateId: string): string {
  for (const draft of state.drafts) {
    const hit = draft.newProjects.find((np) => np.candidateId === candidateId);
    if (!hit) continue;
    const text = ['reason', 'description', 'hypothesis'].map((k) => hit.project[k]).find((v): v is string => typeof v === 'string' && v.trim() !== '');
    return text ?? '';
  }
  return '';
}

function candidateProjectsOf(draft: StrategyDraft | null): Record<string, AnyRecord[]> {
  const out: Record<string, AnyRecord[]> = {};
  for (const np of draft?.newProjects ?? []) (out[np.departmentKey] ??= []).push(np.project);
  return out;
}

const kpisOf = (p: AnyRecord): string[] =>
  [
    ...(((p.okrs as AnyRecord[] | undefined)?.[0]?.keyResults as unknown[] | undefined) ?? []),
    ...((p.kpis as unknown[] | undefined) ?? []),
  ].map(String);

/** 文書の項目（使命・役割・重点課題など）の定義。表示の順序と、対応する提案の項目名。 */
const DOC_FIELDS: Array<{ item: DeptProposalItem; label: string; lines: boolean; hint: string }> = [
  { item: 'mission', label: '事業・部門の使命', lines: false, hint: 'この部門が何のために存在するか' },
  { item: 'strategicRole', label: '全社戦略における役割', lines: false, hint: '全社戦略のどの部分をこの部門が担うか' },
  { item: 'keyIssues', label: '重点課題・勝ち筋', lines: true, hint: '顧客の未解決課題と、自社が選ばれる理由（1行に1項目）' },
];

/** 内部の進行状態。ユーザーには工程の全一覧を常時表示しない。 */
type Phase = 1 | 2 | 3 | 4 | 5 | 6;
type Tab = 'compare' | `dept:${number}`;

function Chip({ tone, children }: { tone: 'ok' | 'warn' | 'neutral'; children: ReactNode }) {
  const cls = {
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warn: 'border-amber-300 bg-amber-50 text-amber-900',
    neutral: 'border-gray-200 bg-white text-gray-700',
  }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

/* ---- CEOチャットの相談文脈（いま見ている画面の内容）。saved は作業版に保存済みかを表す。未保存の編集は saved=false ---- */
type ConsultFocusInput = Omit<ConsultFocus, 'pathname'>;
type ConsultItems = NonNullable<ConsultFocusInput['items']>;

const clipText = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

const CONSULT_DOC_KEYS: TextItemKey[] = ['mission', 'strategicRole', 'keyIssues'];

const DEPT_PHASE_SECTION: Record<Phase, string> = {
  1: 'STEP1 AIによるたたき台',
  2: '6つの問い',
  3: '6つの問い（再生成）',
  4: 'STEP3 戦略書の確認・編集',
  5: 'STEP4 重点プロジェクトを選ぶ',
  6: '確定後の戦略書',
};

/** 画面に出ている文書の項目（採用された変更があればそれ、なければ正式データ）。StrategyBookDesk の docFor と同じ規則 */
function shownTextOf(state: WorkspaceState, dept: Department, k: TextItemKey): string {
  const key = departmentKeyOf(dept as unknown as AnyRecord);
  const applied = (item: DeptProposalItem) =>
    state.selections.find((s) => s.departmentKey === key && s.item === item && s.decision === 'applied');
  if (k === 'intraCollab' || k === 'interCollab') {
    const field = k === 'intraCollab' ? 'intraDeptCollab' : 'interDeptCollab';
    return linesOf(applied('collab')?.proposed[field] ?? currentItemValues(dept as unknown as AnyRecord, 'collab')[field]).join('\n');
  }
  const item = TEXT_SPECS[k].item;
  const key0 = DEPT_PROPOSAL_ITEMS[item].keys[0];
  return linesOf(applied(item)?.proposed[key0] ?? currentItemValues(dept as unknown as AnyRecord, item)[key0]).join('\n');
}

/** 正式データのプロジェクト（確定前の基準）の文章項目。作業版の編集があれば、その内容を優先する */
function savedProjectFieldsOf(state: WorkspaceState, dept: Department, deptKey: string, id: string) {
  const edited = state.projectEdits.find((e) => e.departmentKey === deptKey && e.projectId === id);
  if (edited) return edited.fields;
  const official = dept.projects?.find((p) => stableIdText((p as unknown as AnyRecord).id) === id);
  return official ? projectTextOf(official as unknown as AnyRecord) : undefined;
}

function deptConsultFocus(args: {
  dept: Department;
  deptKey: string;
  phase: Phase;
  state: WorkspaceState;
  docDraft: { deptKey: string; texts: TextDraft; projects: Record<string, ProjectTextDraft> } | null;
  candEdit: { candidateId: string; title: string; reason: string; hypothesis: string; description: string } | null;
}): ConsultFocusInput {
  const { dept, deptKey, phase, state, docDraft, candEdit } = args;
  const items: ConsultItems = [];
  let draft: ConsultFocusInput['draft'];
  if (phase === 5) {
    for (const ps of state.projectSelections.filter((x) => x.departmentKey === deptKey).slice(0, 12)) {
      items.push({ label: clipText(`新規候補：${ps.title}`, 80), value: PROJECT_DECISION_LABEL[ps.decision], saved: true });
    }
    if (candEdit && state.projectSelections.some((x) => x.departmentKey === deptKey && x.candidateId === candEdit.candidateId)) {
      draft = {
        text: clipText(`題名：${candEdit.title}\n目的：${candEdit.reason}\n仮説：${candEdit.hypothesis}\n取り組み内容：${candEdit.description}`, 4000),
        saved: false,
      };
    }
  } else {
    const editing = docDraft !== null && docDraft.deptKey === deptKey ? docDraft : null;
    for (const k of CONSULT_DOC_KEYS) {
      const shown = shownTextOf(state, dept, k);
      const value = editing ? (editing.texts[k] ?? '') : shown;
      items.push({ label: TEXT_LABEL[k], value: clipText(value, 600), saved: value === shown });
    }
    if (editing) {
      const lines: string[] = [];
      for (const k of ALL_TEXT_KEYS) {
        const v = editing.texts[k] ?? '';
        if (v !== shownTextOf(state, dept, k)) lines.push(`${TEXT_LABEL[k]}：${v}`);
      }
      for (const [id, v] of Object.entries(editing.projects)) {
        const base = savedProjectFieldsOf(state, dept, deptKey, id);
        if (!base) continue;
        if (
          v.title !== (base.title ?? '') ||
          v.reason !== (base.reason ?? '') ||
          v.hypothesis !== (base.hypothesis ?? '') ||
          v.description !== (base.description ?? '')
        ) {
          lines.push(`計画「${v.title}」：目的＝${v.reason}／取り組み内容＝${v.description}／仮説＝${v.hypothesis}`);
        }
      }
      if (lines.length > 0) draft = { text: clipText(lines.join('\n'), 4000), saved: false };
    }
  }
  return {
    stage: 3,
    section: clipText(DEPT_PHASE_SECTION[phase], 80),
    departmentName: dept.name,
    items: items.length > 0 ? items : undefined,
    draft,
  };
}

function compareConsultFocus(args: {
  state: WorkspaceState;
  results: Record<string, string>;
  editingProposal: { candidateId: string; text: string } | null;
}): ConsultFocusInput {
  const { state, results, editingProposal } = args;
  const cands = state.analysis?.candidates ?? [];
  const items: ConsultItems = cands.slice(0, 11).map((c, idx) => {
    const decision = state.candidateDecisions[c.id];
    return {
      label: clipText(`調整候補${idx + 1}：${c.title}`, 80),
      value: decision ? CANDIDATE_LABEL[decision] : '未判断',
      saved: true,
    };
  });
  const v = state.verification;
  if (v) {
    const value =
      v.basisKey !== planBasisKey(state)
        ? '作業内容が変わったため古くなっています（確定前に再検証）'
        : v.changeCount === 0
          ? '変更がないため再検証なし'
          : v.candidates.length === 0
            ? '重複・不整合は見つからなかった'
            : `不整合の候補${v.candidates.length}件`;
    items.push({ label: '再検証の結果', value, saved: true });
  }

  // 話し合いの結果の入力欄のうち、作業版に保存していない内容
  const dialogueLines = cands.flatMap((c) =>
    c.dialogueTopics.flatMap((topic) => {
      const typed = (results[dialogueKey(c.id, topic)] ?? '').trim();
      const savedText = (state.dialogue.find((d) => d.candidateId === c.id && d.topic === topic)?.result ?? '').trim();
      return typed !== savedText ? [`${c.title}／${topic}：${typed}`] : [];
    }),
  );
  // 編集中の文章欄は1つだけ渡せる。未保存の調整案 > 未保存の話し合いの結果 > 保存済みの調整案（修正中のみ）の順
  let section = '部門間の調整';
  let draft: ConsultFocusInput['draft'];
  const proposal = editingProposal ? state.adjustmentProposals.find((p) => p.candidateId === editingProposal.candidateId) : undefined;
  const shownProposal = proposal ? (proposal.edited ?? proposal.proposal) : '';
  if (editingProposal) {
    const title = cands.find((c) => c.id === editingProposal.candidateId)?.title ?? '';
    section = clipText(`部門間の調整（調整案を修正中：${title}）`, 80);
  }
  if (editingProposal && editingProposal.text !== shownProposal) {
    draft = { text: clipText(editingProposal.text, 4000), saved: false };
  } else if (dialogueLines.length > 0) {
    draft = { text: clipText(dialogueLines.join('\n'), 4000), saved: false };
  } else if (editingProposal) {
    draft = { text: clipText(editingProposal.text, 4000), saved: true };
  }
  return { stage: 3, section, items: items.length > 0 ? items : undefined, draft };
}

export function StrategyBookDesk({
  departments,
  canEdit,
  canManageDepartments,
  getWriteGate,
  readCompanyId,
  readStrategyId,
  generateDepartment,
  prepareRegeneration,
  renderSixQuestions,
  onConfirmed,
  onExportDepartment,
  onAddDepartment,
  onRenameDepartment,
  onDeleteDepartment,
}: StrategyBookDeskProps) {
  const [loaded, setLoaded] = useState(false);
  const versionRef = useRef<number | null>(null);
  // 複数スコープの読み込みが競合しても、古い会社の応答は反映しない。
  const loadSequenceRef = useRef(0);
  // 今の会社・戦略の組み合わせ。非同期の応答が別の会社・戦略に反映されないよう、送信の前後で比べる
  const scopeKeyRef = useRef('');
  // 6問の未保存の回答を、STEPを移動する前に保存するための関数（部門ごと）
  const sixFlushRef = useRef<Record<string, () => void>>({});
  const [state, setState] = useState<WorkspaceState>(emptyWorkspaceState());
  const [stage2, setStage2] = useState<Stage2View>({ status: 'loading' });
  const [workspaceErrorCode, setWorkspaceErrorCode] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [editingProposal, setEditingProposal] = useState<{ candidateId: string; text: string } | null>(null);
  const [docDraft, setDocDraft] = useState<{ deptKey: string; texts: TextDraft; projects: Record<string, ProjectTextDraft> } | null>(null);
  const [candEdit, setCandEdit] = useState<{ candidateId: string; title: string; reason: string; hypothesis: string; description: string } | null>(null);
  const [manualAdd, setManualAdd] = useState<{ deptKey: string; title: string; purpose: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [confirmResult, setConfirmResult] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);
  const [legacySettled, setLegacySettled] = useState<SettleCounts | null>(null);
  const [tab, setTab] = useState<Tab>('dept:0');
  const [questionsOpen, setQuestionsOpen] = useState(true);
  const [mgmtOpen, setMgmtOpen] = useState(false);
  // 部門ごとの閲覧位置のみを管理。草案・採否・回答は従来どおりサーバーへ保存する。
  const [viewByDept, setViewByDept] = useState<Record<string, Phase>>({});
  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptMission, setNewDeptMission] = useState('');
  const [renaming, setRenaming] = useState<{ index: number; name: string } | null>(null);
  const [pendingTabName, setPendingTabName] = useState<string | null>(null);
  const [pendingChoices, setPendingChoices] = useState<Record<string, string>>({});

  useEffect(() => {
    // 会社・戦略が変わったら、前の会社の未送信の採否と入力中の内容は持ち越さない
    scopeKeyRef.current = `${readCompanyId ?? ''}|${readStrategyId ?? ''}`;
    decisionPatchesRef.current = [];
    decisionDraftRef.current = null;
    setPendingChoices({});
    setDecisionError(null);
    setManualAdd(null);
    setDocDraft(null);
    setCandEdit(null);
    setEditingProposal(null);
    // 親ページは初回表示後に認証・会社・strategyIdを復元する。
    // 初回マウントだけで読みに行くとスコープ未確定のエラーで永久に止まる。
    if (!readCompanyId || !readStrategyId) {
      loadSequenceRef.current += 1;
      setLoaded(false);
      setStage2({ status: 'loading' });
      return;
    }
    void load();
    // 会社または戦略が切り替わった場合も、そのスコープを読み直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readCompanyId, readStrategyId]);

  /* 追加した部門は、一覧に現れた時点でそのタブを開く */
  useEffect(() => {
    if (!pendingTabName) return;
    const idx = departments.findIndex((d) => d.name === pendingTabName);
    if (idx >= 0) {
      setTab(`dept:${idx}`);
      setPendingTabName(null);
    }
  }, [departments, pendingTabName]);

  const gate = (): { companyId: string; strategyId: string; revision: number } | null => {
    const g = getWriteGate();
    if (!g.ok) {
      setNotice(g.reason);
      return null;
    }
    return g;
  };

  const applyStage2 = (status: 'confirmed' | 'not_confirmed' | 'story_missing', companyStrategy: string | null) => {
    if (status === 'confirmed') setStage2({ status, companyStrategy: companyStrategy ?? '' });
    else setStage2({ status });
  };

  const load = async () => {
    // STAGE2の閲覧・作業状態のGETに、未保存変更や編集権限を求める書き込みゲートを使わない。
    // 実際の閲覧権限と会社スコープの検証はAPIが実施する。
    if (!readCompanyId || !readStrategyId) return;
    const requestSeq = ++loadSequenceRef.current;
    setLoaded(false);
    setNotice('');
    setWorkspaceErrorCode(null);
    try {
      const res = await authFetchJson<StateResponse>(
        `/api/stage3/strategy-book?companyId=${encodeURIComponent(readCompanyId)}&strategyId=${encodeURIComponent(readStrategyId)}`,
        { method: 'GET' },
      );
      if (requestSeq !== loadSequenceRef.current) return;
      versionRef.current = res.version;
      setState(res.state);
      setLegacySettled(res.legacySettled);
      setWorkspaceErrorCode(null);
      applyStage2(res.stage2Status, res.companyStrategy);
      setResults(Object.fromEntries(res.state.dialogue.map((d) => [dialogueKey(d.candidateId, d.topic), d.result])));
    } catch (e) {
      if (requestSeq !== loadSequenceRef.current) return;
      // 作業データの読み込みに失敗しても、STAGE2の判定はサーバーの応答から表示する。
      const body = errorBody(e);
      if (body?.stage2Status) applyStage2(body.stage2Status, body.companyStrategy ?? null);
      else setStage2({ status: 'error', message: errorMessage(e) });
      setWorkspaceErrorCode(body?.error ?? (e instanceof TypeError ? 'network' : 'unknown'));
    } finally {
      if (requestSeq === loadSequenceRef.current) setLoaded(true);
    }
  };

  const putWorkspace = (g: { companyId: string; strategyId: string }, state: WorkspaceState, expectedVersion: number) =>
    authFetchJson<SaveResponse>('/api/stage3/strategy-book', {
      method: 'PUT',
      json: { companyId: g.companyId, strategyId: g.strategyId, expectedVersion, state },
    });

  const fetchWorkspace = (g: { companyId: string; strategyId: string }) =>
    authFetchJson<StateResponse>(
      `/api/stage3/strategy-book?companyId=${encodeURIComponent(g.companyId)}&strategyId=${encodeURIComponent(g.strategyId)}`,
      { method: 'GET' },
    ).catch(() => null);

  const save = async (next: WorkspaceState, failureNote = ''): Promise<boolean> => {
    const g = gate();
    const expected = versionRef.current;
    if (!g || expected === null) return false;
    try {
      const res = await putWorkspace(g, next, expected);
      versionRef.current = res.version;
      setState(next);
      return true;
    } catch (e) {
      // 自動の再検証が版を進めただけなら、最新の版に合わせて保存し直す（利用者の編集は上書きしない）
      if (errorCode(e) === 'version_conflict') {
        const latest = await fetchWorkspace(g);
        if (latest && workspaceSignature(latest.state) === workspaceSignature(state)) {
          const merged: WorkspaceState = { ...next, verification: verificationFor(next, latest.state.verification) };
          try {
            const res = await putWorkspace(g, merged, latest.version);
            versionRef.current = res.version;
            setState(merged);
            return true;
          } catch (retryError) {
            setNotice(failureNote + errorMessage(retryError));
            return false;
          }
        }
      }
      setNotice(failureNote + errorMessage(e));
      return false;
    }
  };

  const latestForResponse = async (
    g: { companyId: string; strategyId: string },
    requested: { version: number | null; state: WorkspaceState },
  ): Promise<StateResponse | null> => {
    const latest = await fetchWorkspace(g);
    if (!latest) {
      setNotice('作業内容を読み込めませんでした。時間をおいて再度お試しください。');
      return null;
    }
    if (responseStillApplies(requested, latest)) return latest;
    versionRef.current = latest.version;
    setState(latest.state);
    setNotice('AIの結果を作っている間に作業内容が更新されたため、結果は反映していません。最新の内容を表示しています。もう一度お試しください。');
    return null;
  };

  const stage2Ready = stage2.status === 'confirmed';
  const stage2Message = (): string | undefined => (stage2.status === 'error' ? stage2.message : undefined);
  const decisionsUnsaved = Object.keys(pendingChoices).length > 0;
  const hasUnsavedEdits = decisionsUnsaved || docDraft !== null || candEdit !== null || editingProposal !== null || manualAdd !== null;
  useEffect(() => {
    if (!hasUnsavedEdits) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedEdits]);
  const blockerFor = (busyNow: boolean) =>
    generationBlockerOf({
      loaded,
      canEdit,
      busy: busyNow,
      stage2Status: stage2.status,
      stage2Message: stage2Message(),
      workspaceErrorCode,
    }) ?? (decisionsUnsaved ? DECISIONS_UNSAVED_MESSAGE : null);

  /* 生成（初回たたき台・6問反映後の再生成）。対象の部門だけ作り直し、他の部門の草案・候補・判断は残す */
  const generateFor = async (indices: number[], kind: 'initial' | 'regenerated') => {
    const blocker = blockerFor(false);
    if (blocker) {
      setNotice(blocker);
      return;
    }
    setBusy(kind);
    setNotice('');
    let analyzeAfter: { draftRef: { draftId: string; version: number }; base: WorkspaceState } | null = null;
    try {
      // 未保存の回答は、書き込みゲートの判定より先に保存する（保存後にゲートを確認する）
      if (kind === 'regenerated' && prepareRegeneration) {
        for (const i of indices) {
          const prepared = await prepareRegeneration(i);
          if (!prepared.ok) {
            setNotice(prepared.message);
            return;
          }
        }
      }
      const g = gate();
      if (!g) return;
      const generated: Record<string, StrategyBookGenerateResult> = {};
      const failed: string[] = [];
      for (const i of indices) {
        const dept = departments[i];
        const result = await generateDepartment(i, kind === 'initial' ? 'draft' : 'regen');
        if (result) generated[departmentKeyOf(dept as unknown as AnyRecord)] = result;
        else failed.push(dept.name);
      }
      if (Object.keys(generated).length === 0) {
        setNotice('作れませんでした。時間をおいて再度お試しください。');
        return;
      }
      // 生成には時間がかかるため、結果は開始時の画面の状態ではなく、いま保存されている最新の状態の上に載せる
      const latestWs = await fetchWorkspace(g);
      if (!latestWs) {
        setNotice('作業内容を読み込めませんでした。時間をおいて再度お試しください。');
        return;
      }
      versionRef.current = latestWs.version;
      const base = latestWs.state;
      const official = departments as unknown as AnyRecord[];
      const previous = latestDraft(base);
      const regenKeys = new Set(Object.keys(generated));
      const candidateMap: Record<string, AnyRecord[]> = { ...candidateProjectsOf(previous) };
      for (const [k, r] of Object.entries(generated)) candidateMap[k] = r.projects;
      const draft: StrategyDraft = {
        draftId: newDraftId(),
        kind,
        version: nextDraftVersion(base),
        createdAt: new Date().toISOString(),
        departments: draftDepartmentsFrom(
          official.map((d) => ({ ...d, projects: Array.isArray(d.projects) ? (d.projects as AnyRecord[]).filter((p) => isProjectActive(p)) : d.projects })),
          candidateMap,
        ),
        newProjects: keepRegeneratedCandidates({
          previous: previous?.newProjects ?? [],
          next: newProjectCandidatesFrom(official, candidateMap, previous?.newProjects ?? []),
          regenKeys,
          decidedIds: new Set(base.projectSelections.filter((s) => s.decision !== 'pending').map((s) => s.candidateId)),
        }),
        generatedDepartmentKeys: Object.keys(generated),
      };
      const proposals = Object.fromEntries(Object.entries(generated).map(([k, r]) => [k, r.proposals]));
      const previousSelections = base.selections;
      const next = reopen({
        ...base,
        drafts: [...base.drafts, draft].slice(-MAX_DRAFTS),
        analysis: null,
        candidateDecisions: {},
        adjustmentProposals: [],
        projectProposals: projectProposalsAfterRegeneration(base.projectProposals, regenKeys, official, candidateMap),
        dialogue: [],
        selections: [
          ...selectionsFrom(official, proposals, previousSelections.filter((s) => regenKeys.has(s.departmentKey))),
          ...previousSelections.filter((s) => !regenKeys.has(s.departmentKey)),
        ],
        projectSelections: projectSelectionsFrom(official, draft.newProjects, base.projectSelections),
      });
      if (!(await save(next))) return;
      setViewByDept((prev) => ({
        ...prev,
        ...Object.keys(generated).reduce<Record<string, Phase>>((acc, key) => {
          acc[key] = kind === 'initial' ? 1 : 4;
          return acc;
        }, {}),
      }));
      const label = kind === 'initial' ? '戦略書のたたき台' : '再生成した戦略書';
      setNotice(
        [
          `${label}を保存しました（版 ${draft.version}・未確定）。正式な部門戦略は変わっていません。`,
          failed.length > 0 ? `作れなかった部門：${failed.join('・')}` : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
      // 保存が済んだ戦略書は、部門間の分析を待たずに閲覧できる。分析は保存した内容に対して、後から行う
      if (departments.length >= 2) analyzeAfter = { draftRef: { draftId: draft.draftId, version: draft.version }, base: next };
    } finally {
      setBusy(null);
    }
    if (analyzeAfter) await analyze(analyzeAfter.draftRef, analyzeAfter.base);
  };

  /* 最新の計画案を、部門間で分析する */
  const analyze = async (draftRef: { draftId: string; version: number } | null, base: WorkspaceState = state) => {
    const blocker = blockerFor(false);
    if (blocker) {
      setNotice(blocker);
      return;
    }
    const g = gate();
    if (!g) return;
    const existing = state.analysis;
    if (existing && draftRef && existing.draftId === draftRef.draftId && existing.draftVersion === draftRef.version) {
      setNotice('部門間の調整は、この計画案で分析済みです。');
      return;
    }
    setBusy('analyze');
    try {
      const requestedVersion = versionRef.current;
      const res = await authFetchJson<AnalyzeResponse>('/api/stage3/adjustment/analyze', {
        method: 'POST',
        json: { companyId: g.companyId, strategyId: g.strategyId, draft: draftRef },
      });
      const latest = await latestForResponse(g, { version: requestedVersion, state: base });
      if (!latest) return;
      versionRef.current = latest.version;
      const nextState = reopen({
        ...latest.state,
        analysis: {
          draftId: draftRef?.draftId ?? null,
          draftVersion: draftRef?.version ?? null,
          createdAt: new Date().toISOString(),
          candidates: res.candidates,
          rejectedCandidates: res.rejectedCandidates,
          rejectedReferences: res.rejectedReferences,
        },
        candidateDecisions: {},
        adjustmentProposals: [],
        projectProposals: [],
        dialogue: [],
        verification: null,
      });
      const saved = await save(nextState);
      if (saved) {
        setResults({});
        const rejected =
          res.rejectedCandidates + res.rejectedReferences > 0
            ? `保存済みにない部門・計画IDを含んだため、${res.rejectedCandidates}件の候補と${res.rejectedReferences}件の参照を採用しませんでした。`
            : '';
        setNotice(
          [
            res.candidates.length === 0
              ? '部門間の調整候補は見つかりませんでした。'
              : `部門間の調整候補を${res.candidates.length}件表示しました。採用・保留・不採用は利用者が選びます。`,
            rejected,
          ]
            .filter(Boolean)
            .join(' '),
        );
        if (res.candidates.length > 0) await generateProposalsFor(nextState);
        // 部門内の文書確認を中断しない。調整結果は共通タブから確認できる。
      }
    } catch (e) {
      if (errorCode(e) === 'insufficient_departments') {
        await save(reopen({ ...base, analysis: null, candidateDecisions: {}, adjustmentProposals: [], projectProposals: [], dialogue: [] }));
        setNotice(ERROR_MESSAGE.insufficient_departments + ' 戦略書の作成は続けられます。');
      } else {
        setNotice(errorMessage(e));
      }
    } finally {
      setBusy(null);
    }
  };

  const filledDialogue = (): DialogueResult[] => {
    const candidates = state.analysis?.candidates ?? [];
    return candidates.flatMap((c) =>
      c.dialogueTopics.flatMap((topic) => {
        const result = (results[dialogueKey(c.id, topic)] ?? '').trim();
        return result ? [{ candidateId: c.id, topic, result }] : [];
      }),
    );
  };

  /* 利用者が採用した調整案を、変更案作成の入力として加える（話し合いの記録にはしない） */
  const approvedAdjustmentDialogue = (s: WorkspaceState): DialogueResult[] =>
    (s.analysis?.candidates ?? []).flatMap((c) => {
      if (s.candidateDecisions[c.id] !== 'adopted') return [];
      const p = s.adjustmentProposals.find((x) => x.candidateId === c.id);
      const topic = c.dialogueTopics[0];
      if (!p || !topic) return [];
      const lines = [p.edited ?? p.proposal];
      for (const ch of p.changes) {
        const dept = c.departments.find((d) => d.departmentKey === ch.departmentKey)?.name ?? '';
        const plan = ch.projectId
          ? c.planRefs.find((r) => r.departmentKey === ch.departmentKey && r.projectId === ch.projectId)?.projectTitle
          : undefined;
        lines.push(`・${dept}${plan ? `「${plan}」` : ''}（${PROPOSAL_ITEM_LABEL[ch.item]}）：${ch.change}`);
      }
      return [{ candidateId: c.id, topic, result: lines.join('\n').slice(0, 1000) }];
    });

  /* 調整後の戦略を確認する。判断と修正を保存し、採用した調整案だけで変更案を作る。保存や作成が失敗したら成功扱いにしない */
  const applyAdjustments = async () => {
    const g = gate();
    const current = state.analysis;
    if (!g || !current || current.candidates.length === 0) return;
    const pending = editingProposal;
    const base = reopen({
      ...state,
      dialogue: filledDialogue(),
      adjustmentProposals: pending
        ? withAdjustmentEdit(state.adjustmentProposals, pending.candidateId, pending.text)
        : state.adjustmentProposals,
    });
    setBusy('regenerate');
    setNotice('');
    try {
      if (!(await save(base))) return;
      if (pending) setEditingProposal(null);
      const requestedVersion = versionRef.current;
      const approved = approvedAdjustmentDialogue(base);
      if (base.dialogue.length === 0 && approved.length === 0) {
        setNotice('採用した調整案がないため、変更案は作りませんでした。判断は保存しました。');
        return;
      }
      const res = await authFetchJson<RegenerateResponse>('/api/stage3/adjustment/regenerate', {
        method: 'POST',
        json: {
          companyId: g.companyId,
          strategyId: g.strategyId,
          draft: current.draftId && current.draftVersion ? { draftId: current.draftId, version: current.draftVersion } : null,
          candidates: current.candidates,
          dialogue: [...base.dialogue, ...approved],
        },
      });
      const latest = await latestForResponse(g, { version: requestedVersion, state: base });
      if (!latest) return;
      versionRef.current = latest.version;
      const proposals = Object.fromEntries(res.departments.map((d) => [d.departmentKey, d.proposals]));
      const responded = new Set(res.departments.map((d) => d.departmentKey));
      const official = departments as unknown as AnyRecord[];
      const involvedKeys = new Set(current.candidates.flatMap((c) => c.departments.map((d) => d.departmentKey)));
      const saved = await save({
        ...latest.state,
        selections: [
          ...selectionsFrom(official, proposals, latest.state.selections.filter((s) => responded.has(s.departmentKey))),
          ...latest.state.selections.filter((s) => !responded.has(s.departmentKey)),
        ],
        projectProposals: [
          ...latest.state.projectProposals.filter((p) => !involvedKeys.has(p.departmentKey)),
          ...res.projects.map((p) => ({ ...p, decision: 'pending' as const })),
        ],
      });
      if (!saved) return;
      await verifyPlan();
      const count = res.departments.reduce((n, d) => n + d.proposals.length, 0);
      const projectCount = res.projects.length;
      const firstKey = res.departments[0]?.departmentKey;
      const firstIdx = departments.findIndex((d) => departmentKeyOf(d as unknown as AnyRecord) === firstKey);
      if (firstKey && firstIdx >= 0) {
        setTab(`dept:${firstIdx}`);
        setViewByDept((prev) => ({ ...prev, [firstKey]: 4 }));
      }
      setNotice(
        count + projectCount === 0
          ? '調整後の内容を反映すると変わる項目はありませんでした。'
          : [
              count > 0
                ? `変更案を${count}件作りました。各部門の戦略書で内容を確認し、採用する変更を選んでから確定してください。`
                : '',
              projectCount > 0
                ? `計画・KPIの変更候補を${projectCount}件作りました。採否は調整の画面で選べます（採用した変更だけが確定時に反映されます）。`
                : '',
            ]
              .filter(Boolean)
              .join(' '),
      );
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const decisionPatchesRef = useRef<DecisionEntry<WorkspaceState>[]>([]);
  const decisionDraftRef = useRef<WorkspaceState | null>(null);
  const decisionRunRef = useRef<Promise<void>>(Promise.resolve());
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const releaseDecisionKeys = (keys: string[]) => {
    const still = new Set(decisionPatchesRef.current.map((p) => p.key));
    const done = keys.filter((k) => !still.has(k));
    if (done.length > 0) setPendingChoices((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !done.includes(k))));
  };

  /* 採否の保存は1つずつ順に行う。送信した判断だけを保存済みにし、送信中に追加された判断は次の保存に残す。
     競合したら最新の状態に判断を積み直して書き直す。失敗した判断は画面に残し、再試行できるようにする */
  const flushDecisions = async (failureNote: string) => {
    if (decisionPatchesRef.current.length === 0) return;
    const scope = scopeKeyRef.current;
    const g = gate();
    if (!g || versionRef.current === null) {
      setDecisionError(`${failureNote}作業内容を読み込めませんでした。時間をおいて再度お試しください。`);
      return;
    }
    try {
      let draft = decisionDraftRef.current ?? replayDecisions(state, decisionPatchesRef.current);
      let sent: DecisionEntry<WorkspaceState>[] = [];
      for (let attempt = 0; ; attempt += 1) {
        sent = [...decisionPatchesRef.current];
        try {
          const res = await putWorkspace(g, draft, versionRef.current);
          versionRef.current = res.version;
          break;
        } catch (e) {
          if (errorCode(e) !== 'version_conflict' || attempt >= 2) throw e;
          const latest = await fetchWorkspace(g);
          if (!latest) throw e;
          versionRef.current = latest.version;
          draft = replayDecisions(latest.state, decisionPatchesRef.current);
        }
      }
      if (scopeKeyRef.current !== scope) return;
      const settled = settleSentDecisions(decisionPatchesRef.current, sent, draft);
      decisionPatchesRef.current = settled.rest;
      decisionDraftRef.current = settled.draft;
      setState(draft);
      setDecisionError(null);
      releaseDecisionKeys(settled.done.map((p) => p.key));
      settled.done.forEach((p) => p.after?.());
    } catch (e) {
      if (scopeKeyRef.current === scope) setDecisionError(`${failureNote}${errorMessage(e)} 未保存の採否は画面に残っています。`);
    }
  };

  const retryDecisions = () => {
    decisionRunRef.current = decisionRunRef.current.then(() => flushDecisions('採否を保存できませんでした。'));
  };

  const decide = (
    key: string,
    value: string,
    patch: (s: WorkspaceState) => WorkspaceState,
    failureNote: string,
    afterSaved?: () => void,
  ) => {
    if (!gate() || versionRef.current === null) {
      setNotice('作業内容を読み込めませんでした。時間をおいて再度お試しください。');
      return;
    }
    decisionPatchesRef.current = [...decisionPatchesRef.current, { key, apply: patch, after: afterSaved }];
    decisionDraftRef.current = patch(decisionDraftRef.current ?? state);
    setPendingChoices((prev) => ({ ...prev, [key]: value }));
    decisionRunRef.current = decisionRunRef.current.then(() => flushDecisions(failureNote));
  };

  const choiceOf = <T extends string>(key: string, saved: T | undefined): T | undefined => (pendingChoices[key] as T | undefined) ?? saved;
  const candidateChoice = (id: string) => choiceOf(`cand:${id}`, state.candidateDecisions[id]);
  const projectDecisionOf = (p: ProjectProposal) => choiceOf(projectProposalKey(p), p.decision) ?? p.decision;

  /* 採否の判断。調整案の編集中の文があれば、同じ保存で残す。保留・未判断へ戻す操作は通常画面に置かない（既存の判断は上書きできる） */
  const decideCandidate = (id: string, decision: 'adopted' | 'rejected') => {
    const pending = editingProposal?.candidateId === id ? editingProposal.text : null;
    decide(
      `cand:${id}`,
      decision,
      (s) =>
        reopen({
          ...s,
          candidateDecisions: { ...s.candidateDecisions, [id]: decision },
          adjustmentProposals: pending === null ? s.adjustmentProposals : withAdjustmentEdit(s.adjustmentProposals, id, pending),
        }),
      '採否を保存できませんでした。',
      () => setEditingProposal(null),
    );
  };

  /* 調整案の修正を保存する（判断は変えない）。null なら AI の原文に戻す */
  const saveProposalEdit = async (id: string, text: string | null) => {
    const saved = await save(reopen({ ...state, adjustmentProposals: withAdjustmentEdit(state.adjustmentProposals, id, text) }));
    if (saved) setEditingProposal(null);
  };

  const projectProposalKey = (p: { departmentKey: string; projectId: string }) => `pp:${p.departmentKey}|${p.projectId}`;

  /* 計画・KPIの変更候補の採否。採用した変更は、確定したときだけ正式データに反映される */
  const decideProjectProposal = (target: ProjectProposal, decision: 'adopted' | 'rejected') =>
    decide(
      projectProposalKey(target),
      decision,
      (s) =>
        reopen({
          ...s,
          projectProposals: s.projectProposals.map((p) =>
            p.departmentKey === target.departmentKey && p.projectId === target.projectId ? { ...p, decision } : p,
          ),
        }),
      '採否を保存できませんでした。',
      () =>
        setNotice(
          decision === 'adopted'
            ? `「${target.projectTitle}」の変更を採用しました（作業版・未確定）。確定すると正式な計画に反映されます。`
            : `「${target.projectTitle}」の変更候補を採用しませんでした。`,
        ),
    );

  const proposalOf = (candidateId: string) => state.adjustmentProposals.find((p) => p.candidateId === candidateId);

  /* AIの調整案を、分析済みの候補ごとに作る。分析の直後は自動で作る。内容は保存して、利用者が確認する（採用はしない） */
  const generateProposalsFor = async (base: WorkspaceState) => {
    const g = gate();
    const current = base.analysis;
    if (!g || !current || current.candidates.length === 0) return;
    if (current.candidates.every((c) => base.adjustmentProposals.some((p) => p.candidateId === c.id))) return;
    setBusy('proposal');
    setNotice('');
    setEditingProposal(null);
    try {
      const requestedVersion = versionRef.current;
      const res = await authFetchJson<ProposalResponse>('/api/stage3/adjustment/propose', {
        method: 'POST',
        json: {
          companyId: g.companyId,
          strategyId: g.strategyId,
          draft: current.draftId && current.draftVersion ? { draftId: current.draftId, version: current.draftVersion } : null,
          candidates: current.candidates,
        },
      });
      if (res.proposals.length === 0) {
        setNotice('AI調整案を作れませんでした。時間をおいて、もう一度お試しください。');
        return;
      }
      const latest = await latestForResponse(g, { version: requestedVersion, state: base });
      if (!latest) return;
      versionRef.current = latest.version;
      const replaced = new Set(res.proposals.map((p) => p.candidateId));
      const saved = await save(
        reopen({
          ...latest.state,
          adjustmentProposals: [...latest.state.adjustmentProposals.filter((p) => !replaced.has(p.candidateId)), ...res.proposals],
        }),
      );
      if (saved) {
        setNotice(`AI調整案を${res.proposals.length}件作りました。内容を確認して、採用する・採用しないを選んでください。`);
      }
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  /* 作業版の計画を、保存済みの正式データに当てて部門間で再検証する。結果は作業版に保存する（正式データは変えない） */
  const verifyPlan = async (): Promise<'saved' | 'skipped' | 'failed'> => {
    const g = gate();
    if (!g) return 'failed';
    try {
      const res = await authFetchJson<VerifyResponse>('/api/stage3/adjustment/verify', {
        method: 'POST',
        json: { companyId: g.companyId, strategyId: g.strategyId },
      });
      if (res.persisted && res.state) {
        versionRef.current = res.workspaceVersion;
        setState(res.state);
        return 'saved';
      }
      setState((prev) => ({ ...prev, verification: res.verification }));
      return 'failed';
    } catch (e) {
      setNotice(errorMessage(e));
      return errorCode(e) === 'insufficient_departments' ? 'skipped' : 'failed';
    }
  };

  /* 重点プロジェクトを手で追加する。作業版の候補と採否（未判断）に入れる。正式データは確定時にだけ変わる */
  const addManual = async (dept: Department) => {
    if (!manualAdd) return;
    const blocker = blockerFor(false);
    if (blocker) {
      setNotice(blocker);
      return;
    }
    const result = addManualProject(state, {
      departmentKey: departmentKeyOf(dept as unknown as AnyRecord),
      departmentName: dept.name,
      officialTitles: ((dept.projects ?? []) as unknown as AnyRecord[]).map((p) => String(p.title ?? '')),
      title: manualAdd.title,
      purpose: manualAdd.purpose,
    });
    if (!result.ok) {
      setNotice(
        result.error === 'duplicate_title'
          ? 'この部門に、同じ名前の計画・候補がすでにあります。'
          : result.error === 'invalid_title'
            ? 'プロジェクト名を入力してください。'
            : '戦略書のたたき台を作ってから、プロジェクトを追加してください。',
      );
      return;
    }
    if (await save(reopen(result.state), '重点プロジェクトを追加できませんでした。')) setManualAdd(null);
  };

  const decideProject = (target: ProjectSelection, decision: ProjectSelection['decision']) =>
    decide(
      `proj:${target.candidateId}`,
      decision,
      (s) =>
        reopen({
          ...s,
          projectSelections: s.projectSelections.map((p) => (p.candidateId === target.candidateId ? { ...p, decision } : p)),
        }),
      '採否を保存できませんでした。',
    );

  /* 戦略書の編集を、作業版として一度に保存する。正式データ（部門の現在の値）は変えない。確定時に照合される。 */
  const saveDocEdits = async (
    dept: Department,
    original: TextDraft,
    draft: TextDraft,
    shownProjects: Record<string, ProjectTextDraft>,
    draftProjects: Record<string, ProjectTextDraft>,
  ) => {
    const key = departmentKeyOf(dept as unknown as AnyRecord);
    const changed = ALL_TEXT_KEYS.filter((k) => (draft[k] ?? '') !== (original[k] ?? ''));
    const changedProjects = Object.keys(draftProjects).filter((id) => shownProjects[id] && !sameFields(draftProjects[id], shownProjects[id]));
    if (changed.length === 0 && changedProjects.length === 0) {
      setDocDraft(null);
      setNotice('変更はありません。');
      return;
    }
    const linesOfDraft = (k: TextItemKey): string[] => (draft[k] ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    const valueOf = (k: TextItemKey): string | string[] => (TEXT_SPECS[k].lines ? linesOfDraft(k) : (draft[k] ?? '').trim());
    for (const k of changed) {
      if (valueOf(k).length === 0) {
        setNotice(`「${TEXT_LABEL[k]}」が空です。内容を入力するか、「編集をやめる」を押してください。`);
        return;
      }
    }
    for (const id of changedProjects) {
      if (draftProjects[id].title.trim() === '') {
        setNotice('プロジェクト名が空です。名前を入力するか、「編集をやめる」を押してください。');
        return;
      }
    }
    let projectEdits: ProjectEdit[] = [...state.projectEdits];
    for (const id of changedProjects) {
      const official = dept.projects?.find((p) => stableIdText((p as unknown as AnyRecord).id) === id);
      if (!official) continue;
      const base = projectTextOf(official as unknown as AnyRecord);
      const value = draftProjects[id];
      const shown = shownProjects[id];
      const pick = (field: keyof ProjectTextDraft, officialValue: string | null): string | null =>
        value[field].trim() === shown[field].trim() ? officialValue : value[field].trim() || null;
      const fields: ProjectTextFields = {
        title: value.title.trim() === shown.title.trim() ? base.title : value.title.trim(),
        reason: pick('reason', base.reason),
        hypothesis: pick('hypothesis', base.hypothesis),
        description: pick('description', base.description),
      };
      projectEdits = projectEdits.filter((e) => !(e.departmentKey === key && e.projectId === id));
      if (!sameFields(fields, base)) projectEdits.push({ departmentKey: key, projectId: id, fields, base });
    }
    let selections = state.selections;
    for (const item of [...new Set(changed.map((k) => TEXT_SPECS[k].item))]) {
      const proposed: AnyRecord =
        item === 'collab'
          ? {
              intraDeptCollab: linesOfDraft('intraCollab'),
              interDeptCollab: linesOfDraft('interCollab'),
              needsCollab: [...new Set([...linesOfDraft('intraCollab'), ...linesOfDraft('interCollab')])],
            }
          : { [DEPT_PROPOSAL_ITEMS[item].keys[0]]: valueOf(changed.find((k) => TEXT_SPECS[k].item === item)!) };
      const selection: Selection = {
        departmentKey: key,
        departmentName: dept.name,
        item,
        proposed,
        base: currentItemValues(dept as unknown as AnyRecord, item),
        decision: 'applied',
      };
      const existing = selections.find((s) => s.departmentKey === key && s.item === item);
      selections = existing ? selections.map((s) => (s === existing ? selection : s)) : [...selections, selection];
    }
    const ok = await save(reopen({ ...state, selections, projectEdits }));
    if (ok) {
      setDocDraft(null);
      setNotice('戦略書の編集を保存しました（作業版・未確定）。確定すると、戦略書に反映されます。');
    }
  };

  /* 既存プロジェクトを「計画から外す」。物理削除はせず、確定時に無効化する。実行中・採用済みの計画は、確定時に止めて中止にしてもらう。 */
  const removeProject = async (key: string, projectId: string, title: string) => {
    const g = gate();
    if (!g) return;
    const dept = departments.find((d) => departmentKeyOf(d as unknown as AnyRecord) === key);
    const official = dept?.projects?.find((p) => stableIdText((p as unknown as AnyRecord).id) === projectId);
    if (!official) {
      setNotice('この計画は正式データに見つからないため、計画から外せません。');
      return;
    }
    const ok = await save(
      reopen({
        ...state,
        projectRemovals: [
          ...state.projectRemovals.filter((r) => !(r.departmentKey === key && r.projectId === projectId)),
          { departmentKey: key, projectId, base: { title: projectTextOf(official as unknown as AnyRecord).title } },
        ],
      }),
    );
    if (ok) {
      setDocDraft((prev) => (prev ? { ...prev, projects: Object.fromEntries(Object.entries(prev.projects).filter(([id]) => id !== projectId)) } : prev));
      setNotice(`「${title}」を計画から外す予定にしました（作業版・未確定）。確定すると、正式データから外れます（削除はせず、無効化します）。採用済みや実行中の計画は確定時に外せないため、STAGE4で中止してください。`);
    }
  };

  const restoreProject = async (key: string, projectId: string, title: string) => {
    const ok = await save(
      reopen({
        ...state,
        projectRemovals: state.projectRemovals.filter((r) => !(r.departmentKey === key && r.projectId === projectId)),
      }),
    );
    if (ok) setNotice(`「${title}」を元に戻しました。`);
  };

  const saveCandidateEdit = async () => {
    if (!candEdit) return;
    if (!candEdit.title.trim()) {
      setNotice('題名は空にできません。');
      return;
    }
    const next = editCandidateProject(state, candEdit.candidateId, {
      title: candEdit.title,
      reason: candEdit.reason,
      hypothesis: candEdit.hypothesis,
      description: candEdit.description,
    });
    setCandEdit(null);
    const ok = await save(reopen(next));
    if (ok) setNotice('新規プロジェクトの内容を保存しました（未確定）。');
  };

  /* 部門の追加・名称変更・削除（既存の部門の処理を使い、削除は関連データがあれば拒否する） */
  const addDept = async () => {
    const error = validateDepartmentName(newDeptName, departments.map((d) => d.name));
    if (error) {
      setNotice(error);
      return;
    }
    const name = newDeptName.trim();
    const ok = await onAddDepartment(name, newDeptMission.trim());
    if (ok) {
      setNewDeptName('');
      setNewDeptMission('');
      setPendingTabName(name);
      setNotice(`「${name}」を追加しました。タブから、その部門のたたき台を作れます。`);
    }
  };

  const renameDept = async () => {
    if (!renaming) return;
    const others = departments.filter((_, i) => i !== renaming.index).map((d) => d.name);
    const error = validateDepartmentName(renaming.name, others);
    if (error) {
      setNotice(error);
      return;
    }
    const ok = await onRenameDepartment(renaming.index, renaming.name.trim());
    if (ok) {
      setNotice(`部門名を「${renaming.name.trim()}」に変えました。`);
      setRenaming(null);
    }
  };

  const deleteDept = async (index: number) => {
    const dept = departments[index];
    if (!dept) return;
    const key = departmentKeyOf(dept as unknown as AnyRecord);
    const blockers = departmentDeleteBlockers(dept as unknown as AnyRecord);
    if (blockers.length > 0) {
      setNotice(`「${dept.name}」は削除できません。関連データを守るため、削除を拒否しています。`);
      return;
    }
    const ok = await onDeleteDepartment(index);
    if (!ok) return;
    if (versionRef.current !== null) await save(pruneWorkspaceForDepartment(state, key));
    setNotice(`「${dept.name}」を削除しました。`);
    setTab('dept:0');
  };

  /* 確定：未判断が残っていれば確定しない。確定は全件をサーバーで検証してから、1回の処理で書く */
  const confirm = async () => {
    setConfirmResult(null);
    const blocker = blockerFor(false);
    if (blocker) {
      setConfirmResult({ tone: 'error', message: blocker });
      return;
    }
    const analysisBlock = analysisBlockerOf(departments.length, !!state.analysis);
    if (analysisBlock) {
      setConfirmResult({ tone: 'error', message: analysisBlock });
      return;
    }
    const undecided = (state.analysis?.candidates ?? []).filter((c) => !state.candidateDecisions[c.id]).length;
    const pending = state.selections.filter((s) => s.decision === 'pending').length;
    if (pending > 0) {
      setConfirmResult({ tone: 'error', message: `旧形式の未判断の変更案が${pending}件残っています。画面を再読み込みしてから、もう一度確定してください。` });
      return;
    }
    if (undecided > 0) {
      setConfirmResult({ tone: 'error', message: `部門間調整の判断が${undecided}件残っています。採用する・採用しないのいずれかを選んでください。` });
      return;
    }
    const g = getWriteGate();
    if (!g.ok) {
      setConfirmResult({ tone: 'error', message: g.reason });
      return;
    }
    if (versionRef.current === null) {
      setConfirmResult({ tone: 'error', message: '作業内容を読み込めていません。画面を再読み込みしてください。' });
      return;
    }
    setBusy('confirm');
    setNotice('');
    try {
      if (state.status === 'draft' && state.verification?.basisKey !== planBasisKey(state)) {
        setBusy('verify');
        const verified = await verifyPlan();
        if (verified === 'failed') {
          setConfirmResult({ tone: 'error', message: '調整後の計画を再検証できなかったため、確定しませんでした。時間をおいて、もう一度お試しください。' });
          return;
        }
        setBusy('confirm');
      }
      const res = await authFetchJson<ConfirmResponse>('/api/stage3/strategy-book/confirm', {
        method: 'POST',
        json: { companyId: g.companyId, strategyId: g.strategyId, expectedRevision: g.revision, expectedVersion: versionRef.current },
      });
      await load();
      setViewByDept({}); // 確定後は対象部門でPDFが主操作となる
      const message = `事業・部門戦略書が確定しました。正式データに反映済みです（文章の反映${res.appliedCount}件・新規プロジェクトの追加${res.adoptedProjectIds.length}件）。`;
      setConfirmResult({ tone: 'ok', message });
      await onConfirmed(`✅ ${message}`);
    } catch (e) {
      const code = errorCode(e);
      setConfirmResult({ tone: 'error', message: confirmErrorMessage(e) });
      if (code === 'revision_changed' || code === 'version_conflict' || code === 'current_value_changed') await load();
    } finally {
      setBusy(null);
    }
  };

  /* ---- 表示 ---- */
  const latest = latestDraft(state);
  const confirmed = state.status === 'confirmed';
  const isBusy = busy !== null;
  const writeGate = getWriteGate();
  const writeBlocker = writeGate.ok ? null : writeGate.reason;
  const canOperate = canEdit && loaded && !isBusy && writeBlocker === null;
  const operateBlocker = !canEdit
    ? '編集は管理者・管理職のみ行えます。'
    : !loaded
      ? '作業内容を読み込んでいます。'
      : isBusy
        ? '処理が終わるまでお待ちください。'
        : writeBlocker;
  const analysis = state.analysis;
  const staleAnalysis = !!analysis && (!latest || analysis.draftVersion !== latest.version);
  const undecidedCandidateCount = (analysis?.candidates ?? []).filter((c) => !state.candidateDecisions[c.id]).length;
  const genBlocker = blockerFor(isBusy);
  const idNames = internalIdNamesOf(departments, state.drafts.flatMap((d) => d.newProjects));
  const showText = (text: string) => displayTextOf(text, idNames);

  /* 画面の上部に1か所だけ出す、操作を止める重大な問題（STAGE2の状態・作業データの保存先） */
  const blockingError: string | null = !loaded
    ? null
    : stage2.status === 'not_confirmed'
      ? ERROR_MESSAGE.stage2_not_confirmed
      : stage2.status === 'story_missing'
        ? ERROR_MESSAGE.stage2_story_missing
        : stage2.status === 'error'
          ? stage2.message
          : workspaceErrorCode === 'workspace_table_missing'
            ? ERROR_MESSAGE.workspace_table_missing
            : workspaceErrorCode
              ? ERROR_MESSAGE.workspace_unavailable
              : null;

  const reasonLine = (reason: string | null) =>
    reason && !blockingError ? <p className="text-xs text-amber-800">※ {reason}</p> : null;

  const tabs: Array<{ id: Tab; label: string }> = [
    ...departments.map((d, i) => ({ id: `dept:${i}` as Tab, label: d.name })),
    { id: 'compare', label: '部門間調整' },
  ];

  const latestGeneratedVersion = (key: string, kind: StrategyDraft['kind']) =>
    Math.max(0, ...state.drafts
      .filter((d) => d.kind === kind && (d.generatedDepartmentKeys ?? []).includes(key))
      .map((d) => d.version));
  /* 初回たたき台を作り直した場合、以前の再生成版を「最新」と誤表示しない。 */
  const progressOf = (key: string) => {
    const initialVersion = latestGeneratedVersion(key, 'initial');
    const regenVersion = latestGeneratedVersion(key, 'regenerated');
    const hasInitial = initialVersion > 0;
    const hasRegen = hasInitial && regenVersion > initialVersion;
    // 全社一括確定でも、再生成案のない部門を『PDF出力可』と誤表示しない。
    const deptConfirmed = confirmed && hasInitial && hasRegen;
    const current: Phase = !hasInitial ? 1 : deptConfirmed ? 6 : !hasRegen ? 1 : 4;
    return { hasInitial, hasRegen, deptConfirmed, current };
  };

  /* 表示中の段階。閲覧できる段階だけを、利用者の選択として採る（それ以外は作業の進み具合の段階） */
  const phaseOf = (key: string, progress: ReturnType<typeof progressOf>): Phase => {
    const requested = viewByDept[key];
    const allowed =
      requested === 1 ||
      (requested === 2 && progress.hasInitial) ||
      ((requested === 4 || requested === 5) && progress.hasRegen) ||
      (requested === 6 && progress.deptConfirmed);
    return requested !== undefined && allowed ? requested : progress.current;
  };

  /* 段階の移動。編集中の内容が残る場合は、保存せずに移動するかを確認する */
  const goToPhase = (key: string, phase: Phase) => {
    const hasUnsaved = (docDraft !== null && docDraft.deptKey === key) || candEdit !== null;
    if (hasUnsaved && !window.confirm('保存していない編集があります。移動すると、この編集内容は破棄されます。移動しますか？')) return;
    sixFlushRef.current[key]?.();
    if (docDraft?.deptKey === key) setDocDraft(null);
    setCandEdit(null);
    setViewByDept((prev) => ({ ...prev, [key]: phase }));
  };

  /* CEOチャットの相談文脈。6問の画面（STEP2・3）は QuestionStepper が登録するため、ここでは外す（同じ画面で2件登録すると一方が隠れるため）。 */
  const focusDeptIndex = tab.startsWith('dept:') ? Number(tab.slice(5)) : -1;
  const focusDept = focusDeptIndex >= 0 ? departments[focusDeptIndex] : undefined;
  const focusDeptKey = focusDept ? departmentKeyOf(focusDept as unknown as AnyRecord) : null;
  const focusPhase = focusDeptKey ? phaseOf(focusDeptKey, progressOf(focusDeptKey)) : null;
  useConsultFocus(
    'stage3-strategy-book',
    focusDept && focusDeptKey && focusPhase !== null && focusPhase !== 2 && focusPhase !== 3
      ? deptConsultFocus({ dept: focusDept, deptKey: focusDeptKey, phase: focusPhase, state, docDraft, candEdit })
      : null,
  );
  useConsultFocus(
    'stage3-strategy-book-compare',
    tab === 'compare' ? compareConsultFocus({ state, results, editingProposal }) : null,
  );

  const judgments = judgmentSummaryOf(state);
  const confirmBlocker = !canEdit
    ? '確定・反映は管理者・管理職のみ行えます'
    : !stage2Ready
      ? (stage2.status === 'loading' ? '読み込み中です' : 'STAGE2の確定後に確定できます')
      : state.drafts.length === 0
        ? '先に、部門の戦略書のたたき台を作成してください'
        : analysisBlockerOf(departments.length, !!state.analysis) ??
          (decisionsUnsaved ? DECISIONS_UNSAVED_MESSAGE : judgmentBlockerOf(judgments));

  const confirmResultNote = confirmResult && (
    <p
      role={confirmResult.tone === 'ok' ? 'status' : 'alert'}
      className={`rounded-lg px-3 py-2 text-sm font-semibold ${
        confirmResult.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'
      }`}
    >
      {confirmResult.message}
    </p>
  );

  /* 確定の内容（全社の件数）。確定処理は全社を対象にするため、件数も全社で数える */
  const renderConfirmSummary = () => (
    <div className="space-y-1 text-xs text-gray-700">
      {departments.map((d) => {
        const k = departmentKeyOf(d as unknown as AnyRecord);
        const items = state.selections.filter((s) => s.departmentKey === k && s.decision === 'applied').length;
        const adopted = state.projectSelections.filter((p) => p.departmentKey === k && p.decision === 'applied').length;
        const edits = state.projectEdits.filter((e) => e.departmentKey === k).length;
        const removals = state.projectRemovals.filter((r) => r.departmentKey === k).length;
        const itemNames = [
          ...new Set(
            state.selections
              .filter((s) => s.departmentKey === k && s.decision === 'applied')
              .map((s) => (DEPT_PROPOSAL_ITEMS as Record<string, { label: string }>)[s.item]?.label ?? s.item),
          ),
        ];
        return (
          <p key={k}>
            <span className="font-semibold text-zinc-900">{d.name}</span>：文章の変更 {items}項目{itemNames.length > 0 ? `（${itemNames.join('・')}）` : ''}・新規プロジェクトの採用 {adopted}件・既存プロジェクトの編集 {edits}件・計画から外す {removals}件
          </p>
        );
      })}
      <p>
        新規候補：採用 {judgments.projects.adopted}件・保留 {judgments.projects.deferred + judgments.projects.undecided}件（選ばなかった候補は保留として残ります）
      </p>
      <p>
        部門間調整：採用 {judgments.adjustments.adopted}件・保留 {judgments.adjustments.deferred}件・不採用 {judgments.adjustments.rejected}件・未判断 {judgments.adjustments.undecided}件
      </p>
      {legacySettled && legacySettled.applied + legacySettled.discarded > 0 && (
        <p className="rounded bg-zinc-50 px-2 py-1 text-zinc-700">
          以前の方式で残っていた未判断の変更案を整理しました：戦略書の表示どおりに反映 {legacySettled.applied}件・正式データと合わないため反映しない {legacySettled.discarded}件
        </p>
      )}
    </div>
  );

  const renderConfirm = () => (
    <div className="space-y-2 rounded-xl border border-zinc-200 p-4">
      <p className="text-xs text-gray-700">
        確定すると、全社（{departments.length}事業・部門）の編集内容・採用した新規プロジェクト・採用した部門間調整を、まとめて正式データへ反映します。1件でも反映できなければ、何も変わりません。
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={confirm} disabled={!canOperate || confirmBlocker !== null} className="rounded-full h-9 px-4">
          {busy === 'confirm' ? '確定しています…' : confirmed ? '変更内容を再確定する' : '戦略書を確定する'}
        </Button>
        {reasonLine(confirmBlocker)}
      </div>
      {confirmResultNote}
    </div>
  );

  const renderDepartment = (i: number) => {
    const dept = departments[i];
    if (!dept) return <p className="text-sm text-gray-600">部門が見つかりません。</p>;
    const key = departmentKeyOf(dept as unknown as AnyRecord);
    const progress = progressOf(key);
    const effective = phaseOf(key, progress);
    const showPhase = (phase: Phase) => goToPhase(key, phase);
    const latestInitial = [...state.drafts].reverse().find((d) => d.kind === 'initial' && (d.generatedDepartmentKeys ?? []).includes(key));
    const latestRegen = progress.hasRegen ? [...state.drafts].reverse().find((d) => d.kind === 'regenerated' && (d.generatedDepartmentKeys ?? []).includes(key)) : undefined;
    const initialDept = latestInitial?.departments.find((x) => departmentKeyOf(x as unknown as AnyRecord) === key);
    const projs = state.projectSelections.filter((p) => p.departmentKey === key);
    const officialProjects = ((dept.projects ?? []) as unknown as AnyRecord[]).filter((p) => isProjectActive(p));
    /* 文書に出るのは採用（反映）された変更だけ。それ以外の項目は、正式データの現在の値を表示する */
    const selOf = (item: DeptProposalItem) => state.selections.find((s) => s.departmentKey === key && s.item === item && s.decision === 'applied');
    const baseOf = (item: DeptProposalItem) => currentItemValues(dept as unknown as AnyRecord, item);
    const collabInter = linesOf(selOf('collab')?.proposed.interDeptCollab ?? baseOf('collab').interDeptCollab).map(showText);
    const collabIntra = linesOf(selOf('collab')?.proposed.intraDeptCollab ?? baseOf('collab').intraDeptCollab).map(showText);
    const docFor = (draft: StrategyDraft | undefined): StrategyDocumentProps | null => {
      if (!draft) return null;
      const draftDept = draft.departments.find((x) => departmentKeyOf(x as unknown as AnyRecord) === key);
      const docText = (item: DeptProposalItem) => {
        const key0 = DEPT_PROPOSAL_ITEMS[item].keys[0];
        return linesOf(selOf(item)?.proposed[key0] ?? baseOf(item)[key0]).map(showText);
      };
      const candidateProjects = draft.newProjects.map((n) => n.project as AnyRecord);
      /* 確定後は正式データのプロジェクトを表示する（確定で外れた計画を残さないため）。確定前は草案の内容に、作業版の編集を重ねる。 */
      const sourceProjects = (state.status === 'confirmed' ? officialProjects : (draftDept?.projects ?? [])) as unknown as DraftProjectInput[];
      const projects: DocProject[] = sourceProjects.map((p) => {
        const d = projectDetailOf(p, { official: officialProjects, candidates: candidateProjects });
        const id = stableIdText((p as unknown as AnyRecord).id);
        const edit = id === null ? undefined : state.projectEdits.find((e) => e.departmentKey === key && e.projectId === id);
        const removed = id !== null && state.projectRemovals.some((r) => r.departmentKey === key && r.projectId === id);
        const shownOrNull = (v: string | null | undefined) => (v == null ? null : showText(v));
        const doc: DocProject = {
          title: showText(edit ? edit.fields.title : d.title),
          origin: d.origin,
          group: d.group,
          objective: d.okrs[0]?.objective ? showText(d.okrs[0].objective) : null,
          purpose: shownOrNull(edit ? edit.fields.reason : d.purpose),
          hypothesis: shownOrNull(edit ? edit.fields.hypothesis : d.hypothesis),
          summary: shownOrNull(edit ? edit.fields.description : d.summary),
          partner: d.partnerDepartment,
          goals: [...new Set([...d.okrs.flatMap((o) => o.keyResults), ...d.kpis])].map(showText),
          id: id ?? undefined,
          removed,
        };
        if (id !== null && removed) {
          doc.action = (
            <Button variant="outline" onClick={() => void restoreProject(key, id, d.title)} disabled={!canOperate} className="rounded-full h-7 px-3 text-xs">
              元に戻す
            </Button>
          );
        }
        return doc;
      });
      return {
        departmentName: dept.name,
        versionLabel: draft.kind === 'initial' ? `版 ${draft.version}・AIたたき台・未確定` : `版 ${draft.version}・6問反映後の再生成版・未確定`,
        texts: {
          mission: docText('mission'),
          missionDescription: docText('missionDescription'),
          currentPosition: docText('currentPosition'),
          strategicRole: docText('strategicRole'),
          keyIssues: docText('keyIssues'),
          intraCollab: collabIntra,
          interCollab: collabInter,
          alignmentRiskPoints: docText('alignmentRiskPoints'),
          reviewSummary: docText('reviewSummary'),
          stopList: docText('stopList'),
          riskNotes: docText('riskNotes'),
        },
        projects,
      };
    };
    const initialDoc = docFor(latestInitial);
    const regenDoc = docFor(latestRegen);
    const currentDoc = docFor(latestRegen ?? latestInitial);
    const oldVersionRows = DOC_FIELDS.map((f) => ({
      f,
      text: linesOf(baseOf(f.item)[DEPT_PROPOSAL_ITEMS[f.item].keys[0]]).join(f.lines ? '\n' : ''),
    })).filter((r) => r.text.trim() !== '');
    /* 編集中は、項目を押すとその場で直せる（STAGE4の計画書と同じ操作）。通常表示では編集欄を出さない。 */
    const editingHere = docDraft !== null && docDraft.deptKey === key;
    const draftHere = editingHere ? docDraft.texts : null;
    const draftProjects = editingHere ? docDraft.projects : null;
    const startDocEdit = () => setDocDraft({ deptKey: key, texts: textDraftOf(regenDoc), projects: editableProjectDraftsOf(regenDoc) });
    const regenShown: StrategyDocumentProps | null =
      regenDoc && draftProjects
        ? {
            ...regenDoc,
            projects: regenDoc.projects.map((p) => {
              if (!p.id || p.removed || !draftProjects[p.id]) return p;
              const id = p.id;
              const value = draftProjects[id];
              const setField = (field: keyof ProjectTextDraft, v: string) =>
                setDocDraft((prev) =>
                  prev && prev.deptKey === key ? { ...prev, projects: { ...prev.projects, [id]: { ...prev.projects[id], [field]: v } } } : prev,
                );
              return {
                ...p,
                editor: (
                  <div className="space-y-3">
                    <EditableBlock label="プロジェクト名" value={value.title} mode="edit" multiline={false} className="text-sm font-semibold text-zinc-900" onChange={(v) => setField('title', v)} />
                    <EditableBlock label="目的・選定理由" value={value.reason} mode="edit" className="whitespace-pre-wrap text-[15px] leading-7 text-zinc-800" onChange={(v) => setField('reason', v)} />
                    <EditableBlock label="取り組み内容" value={value.description} mode="edit" className="whitespace-pre-wrap text-[15px] leading-7 text-zinc-800" onChange={(v) => setField('description', v)} />
                    <EditableBlock label="成果仮説" value={value.hypothesis} mode="edit" className="whitespace-pre-wrap text-[15px] leading-7 text-zinc-800" onChange={(v) => setField('hypothesis', v)} />
                    <p className="text-xs text-zinc-500">KPI・目標（この画面では変わりません）：{p.goals.length > 0 ? p.goals.join('、') : 'なし'}</p>
                  </div>
                ),
                action: (
                  <Button variant="outline" onClick={() => void removeProject(key, id, p.title)} disabled={isBusy} className="rounded-full h-7 px-3 text-xs">
                    計画から外す
                  </Button>
                ),
              };
            }),
          }
        : regenDoc;
    const regenEdit: Partial<Record<TextItemKey, SectionEdit>> | undefined = draftHere
      ? (Object.fromEntries(
          ALL_TEXT_KEYS.map((k) => [
            k,
            {
              action: null,
              editor: (
                <EditableBlock
                  label={TEXT_LABEL[k]}
                  value={draftHere[k] ?? ''}
                  mode="edit"
                  multiline
                  className="whitespace-pre-wrap text-[15px] leading-7 text-zinc-800"
                  onChange={(v) => setDocDraft((prev) => (prev && prev.deptKey === key ? { ...prev, texts: { ...prev.texts, [k]: v } } : prev))}
                />
              ),
            },
          ]),
        ) as Partial<Record<TextItemKey, SectionEdit>>)
      : undefined;
    const exportDeptPdf = () => {
      const task = progress.deptConfirmed
        ? onExportDepartment(dept.name, { confirmedAt: state.confirmed?.confirmedAt })
        : currentDoc
          ? onExportDepartment(dept.name, { working: currentDoc })
          : null;
      void task?.catch(() => setNotice('PDFを出力できませんでした。時間をおいて再度お試しください。'));
    };
    const isOpen = (...phases: Phase[]) => phases.includes(effective);
    const sectionClass = 'rounded-xl border border-zinc-200 bg-white';
    const summaryClass = 'border-b border-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-900';
    return (
      <section className="space-y-4">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-bold">{dept.name}の戦略書</h3>
            <div className="flex flex-wrap items-center gap-2">
              {!progress.deptConfirmed && (
                <Chip tone={progress.hasRegen ? 'neutral' : 'warn'}>
                  {progress.hasRegen ? '再生成版・未確定' : progress.hasInitial ? 'たたき台作成済み' : '未作成'}
                </Chip>
              )}
              {progress.hasInitial && (
                <Button
                  variant="outline"
                  onClick={exportDeptPdf}
                  disabled={isBusy || editingHere}
                  className="rounded-full h-8 px-3 text-xs"
                >
                  {progress.deptConfirmed ? 'PDF出力（確定版）' : 'PDF出力（未確定版）'}
                </Button>
              )}
            </div>
          </div>
          {editingHere && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              編集中のためPDFは出力できません。「編集を保存」か「編集をやめる」を押してから、出力してください。
            </p>
          )}
          <nav className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="戦略書の作業手順">
            {STEPS.map((s) => {
              const enabled =
                s.phase === 1 ||
                (s.phase === 2 && progress.hasInitial) ||
                ((s.phase === 4 || s.phase === 5) && progress.hasRegen) ||
                (s.phase === 5 && progress.deptConfirmed);
              const active = s.phase === (effective === 6 ? 5 : effective);
              return (
                <button
                  key={s.phase}
                  type="button"
                  disabled={!enabled}
                  aria-current={active ? 'step' : undefined}
                  onClick={() => showPhase(s.phase)}
                  className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                    active
                      ? 'border-zinc-900 bg-zinc-900 text-white'
                      : enabled
                        ? 'border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50'
                        : 'cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400'
                  }`}
                >
                  <span className="block font-semibold">{s.label}</span>
                  <span className="block">{s.title}</span>
                </button>
              );
            })}
          </nav>
          <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm font-medium text-sky-900">
            次の操作：
            {!progress.hasInitial
              ? '「AIで戦略書のたたき台を作成」を押してください。'
              : !progress.hasRegen
                ? 'たたき台を読み、必要なら6問の回答を反映して戦略書を再生成してください。'
                : judgments.blockers > 0
                  ? `${judgmentBlockerOf(judgments)}（STEP4で判断してください）`
                  : progress.deptConfirmed
                    ? '確定済みです。下の「確定版PDFを出力」と、確定した計画からのSTAGE4への移動を使えます。'
                    : 'STEP3で内容を確認・編集してから、「部門間の調整」タブの④で全体を確定してください。'}
          </p>
          {state.verification && state.verification.basisKey === planBasisKey(state) && state.verification.changeCount > 0 && (
            <p className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-800">
              調整後の再検証：
              {state.verification.candidates.length === 0
                ? '採用した変更による重複・不整合は見つかりませんでした。'
                : `重複・不整合の候補が${state.verification.candidates.length}件あります（「部門間の調整」タブで確認できます）。`}
            </p>
          )}
        </header>

        {/* ① 初回のたたき台 */}
        {isOpen(1) && (
        <section className={sectionClass}>
          <h4 className={summaryClass}>{progress.hasInitial ? 'AIによる戦略書のたたき台' : 'AIで戦略書のたたき台を作成'}</h4>
          <div className="space-y-3 border-t px-4 py-4">
            {progress.hasInitial && initialDept ? (
              <>
                {progress.hasRegen ? (
                  <p className="rounded-lg bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-800">
                    これは最初のたたき台（過去の版）です。現在の戦略書はSTEP3で確認・編集できます。
                  </p>
                ) : (
                  <p className="text-xs text-gray-600">読んでから、STEP2の6つの問いに進んでください。</p>
                )}
                {initialDoc && (
                  <div className="rounded-xl border border-zinc-200 bg-white px-5 py-6 md:px-8">
                    <StrategyBookDocument {...initialDoc} />
                  </div>
                )}
                <Button
                  onClick={() => showPhase(2)}
                  className="rounded-full h-9 px-4"
                >
                  6つの問いへ進む
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-800">まず、AIがこの部門の戦略書のたたき台を作成します（未確定）。</p>
                <Button
                  onClick={() => generateFor([i], 'initial')}
                  disabled={!!genBlocker}
                  className="rounded-full h-9 px-4"
                >
                  {busy === 'initial' ? '作成しています…' : 'AIで戦略書のたたき台を作成'}
                </Button>
                {reasonLine(genBlocker)}
              </>
            )}
          </div>
        </section>
        )}

        {/* ② 戦略書を読みながら6つの問いに答える → ③ 再生成 */}
        {isOpen(2, 3) && (
        <section className={sectionClass}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
            <h4 className="text-sm font-semibold text-zinc-900">戦略書を読みながら、6つの問いに答える</h4>
            <button
              type="button"
              onClick={() => setQuestionsOpen((v) => !v)}
              aria-expanded={questionsOpen}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 lg:hidden"
            >
              {questionsOpen ? '6つの問いを閉じて戦略書を読む' : '6つの問いを開く'}
            </button>
          </div>
          <div className="grid gap-6 p-4 lg:grid-cols-2 lg:items-start">
            <div className="min-w-0 lg:sticky lg:top-4 lg:max-h-[80vh] lg:overflow-y-auto lg:pr-2">
              {currentDoc && (
                <div className="rounded-xl border border-zinc-200 bg-white px-5 py-6">
                  <StrategyBookDocument {...currentDoc} />
                </div>
              )}
            </div>
            <div className={`min-w-0 space-y-6 ${questionsOpen ? 'block' : 'hidden'} lg:block`}>
              {renderSixQuestions(i, (flush) => {
                if (flush) sixFlushRef.current[key] = flush;
                else delete sixFlushRef.current[key];
              })}
              <div className="space-y-3 border-t pt-4">
                <p className="text-xs text-gray-600">
                  {progress.hasRegen
                    ? '再生成済みです。④で文書を確認できます。回答を直したら、もう一度再生成できます。'
                    : '6問の回答を反映した戦略書を作ります（未確定）。作成後は、部門間の調整が自動で分析されます。'}
                </p>
                <Button
                  onClick={() => generateFor([i], 'regenerated')}
                  disabled={!!genBlocker || !progress.hasInitial}
                  className="rounded-full h-9 px-4"
                >
                  {busy === 'regenerated' ? '再生成しています…' : '6問を反映して戦略書を再生成'}
                </Button>
                {reasonLine(genBlocker ?? (!progress.hasInitial ? '先に①の初回のたたき台を作成してください' : null))}
              </div>
            </div>
          </div>
        </section>
        )}

        {/* ④ 文書の編集・採否 */}
        {isOpen(4) && (
        <section className={sectionClass}>
          <h4 className={summaryClass}>再生成された戦略書を確認・編集する</h4>
          <div className="space-y-6 border-t px-4 py-4">
            {regenDoc && (
              <>
                {editingHere && <style>{PLAN_DOC_CSS}</style>}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {editingHere ? (
                    <>
                      <p className="text-xs text-amber-800">
                        修正中です。文章やプロジェクトの内容をクリックすると直せます。KPIは変わりません。「編集を保存」を押すまで、作業版には反映されません。
                      </p>
                      <div className="flex gap-2">
                        <Button
                          onClick={() => docDraft && void saveDocEdits(dept, textDraftOf(regenDoc), docDraft.texts, editableProjectDraftsOf(regenDoc), docDraft.projects)}
                          disabled={isBusy}
                          className="rounded-full h-9 px-4"
                        >
                          編集を保存
                        </Button>
                        <Button variant="outline" onClick={() => setDocDraft(null)} disabled={isBusy} className="rounded-full h-9 px-4">
                          編集をやめる
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        onClick={startDocEdit}
                        disabled={!canOperate || docDraft !== null}
                        className="rounded-full h-9 px-4"
                      >
                        戦略書を編集
                      </Button>
                    </>
                  )}
                </div>
                <div className="rounded-xl border border-zinc-200 bg-white px-5 py-6 md:px-8">
                  <StrategyBookDocument {...(regenShown as StrategyDocumentProps)} edit={regenEdit} />
                </div>
              </>
            )}
            {!progress.hasRegen ? (
              <p className="text-sm text-gray-600">③で再生成すると、ここに戦略書の変更案が表示されます。</p>
            ) : (
              <>
                {oldVersionRows.length > 0 && (
                  <div className="flex justify-end">
                    <details className="w-full rounded-lg bg-zinc-50 px-3 py-2 text-xs">
                      <summary className="cursor-pointer font-semibold">旧版（現在の戦略）と比べる</summary>
                      <div className="mt-2 space-y-2">
                        {oldVersionRows.map(({ f, text }) => (
                          <div key={f.item}>
                            <div className="font-semibold text-gray-700">{f.label}</div>
                            <div className="whitespace-pre-wrap text-gray-700">{text}</div>
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                )}

                <div className="flex justify-end border-t pt-4">
                  <Button onClick={() => showPhase(5)} className="rounded-full h-9 px-5">
                    重点プロジェクトを選ぶ（STEP4）へ進む
                  </Button>
                </div>
              </>
            )}
          </div>
        </section>
        )}

        {/* STEP4：重点プロジェクトを選ぶ（正式確定は「部門間の調整」タブの最後で行う） */}
        {isOpen(5) && (
        <section className={sectionClass}>
          <h4 className={summaryClass}>STEP4：重点プロジェクトを選ぶ</h4>
          {reasonLine(operateBlocker)}
          <div className="space-y-6 border-t px-4 py-4">
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">AIが提案した新規プロジェクト候補（{dept.name}）</h4>
              <p className="text-xs text-gray-600">
                これはAIの候補です。すべて採用する必要はありません。重要な2〜3件を選んでください。選ばなかった候補は消えず、保留として残ります。
              </p>
              <p className="text-xs text-gray-700">
                採用 {projs.filter((p) => p.decision === 'applied').length}件 ／ 候補 {projs.length}件
              </p>
              {projs.length > 0 && !projs.some((p) => p.decision === 'applied') && (
                <p className="text-xs text-amber-800">
                  採用するプロジェクトが0件です。このまま確定すると、STAGE4の実行計画が作成されない可能性があります。
                </p>
              )}
              {projs.length === 0 && <p className="text-xs text-gray-600">この部門の新規の候補プロジェクトはまだありません。</p>}
              {manualAdd && manualAdd.deptKey === key ? (
                <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                  <label className="block text-xs text-gray-700">
                    プロジェクト名（必須）
                    <input
                      value={manualAdd.title}
                      maxLength={300}
                      onChange={(e) => setManualAdd({ ...manualAdd, title: e.target.value })}
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="block text-xs text-gray-700">
                    目的・背景（任意）
                    <textarea
                      value={manualAdd.purpose}
                      maxLength={2000}
                      rows={2}
                      onChange={(e) => setManualAdd({ ...manualAdd, purpose: e.target.value })}
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => void addManual(dept)}
                      disabled={!canOperate || manualAdd.title.trim() === ''}
                      className="rounded-full h-8 px-3 text-xs"
                    >
                      追加する
                    </Button>
                    <Button variant="outline" onClick={() => setManualAdd(null)} className="rounded-full h-8 px-3 text-xs">
                      やめる
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    onClick={() => setManualAdd({ deptKey: key, title: '', purpose: '' })}
                    disabled={!canOperate || !latest}
                    className="rounded-full h-8 px-3 text-xs"
                  >
                    ＋ プロジェクトを追加
                  </Button>
                  {reasonLine(!latest ? '先に、部門の戦略書のたたき台を作成してください。' : null)}
                </div>
              )}
              {projs.map((p) => {
                const c = latest?.newProjects.find((np) => np.candidateId === p.candidateId);
                const summary = showText(projectSummaryOf(state, p.candidateId));
                const editing = candEdit?.candidateId === p.candidateId;
                const linked = linkedProjectOf(departments, p.candidateId);
                const linkedActive = !!linked && isProjectActive(linked);
                const linkedExcluded = !!linked && !linkedActive;
                const shownDecision = choiceOf(`proj:${p.candidateId}`, p.decision) ?? p.decision;
                return (
                  <div key={p.candidateId} className="space-y-2 rounded-xl border border-zinc-200 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{showText(p.title)}</span>
                      <Chip tone={linkedActive || shownDecision === 'applied' ? 'ok' : 'neutral'}>
                        {linkedActive
                          ? '採用中（正式データに入っています）'
                          : linkedExcluded
                            ? '計画から外した施策（採用し直せます）'
                            : shownDecision === 'pending'
                              ? '未選択（確定時は保留として残ります）'
                              : shownDecision === 'deferred'
                                ? '保留（以前の判断）'
                                : `新規の候補・${PROJECT_DECISION_LABEL[shownDecision]}`}
                      </Chip>
                      {shownDecision === 'applied' &&
                        state.projectSelections.some(
                          (o) => o.departmentKey !== key && o.decision === 'applied' && sameTitle(o.title, p.title),
                        ) && <Chip tone="warn">他の事業でも同じ内容を採用しています</Chip>}
                    </div>
                    {summary && !editing && <p className="text-xs leading-5 text-gray-700">目的：{summary}</p>}
                    {editing && candEdit ? (
                      <div className="grid gap-2 md:grid-cols-2">
                        <label className="text-xs text-gray-600">
                          題名
                          <input value={candEdit.title} onChange={(e) => setCandEdit({ ...candEdit, title: e.target.value })} className="mt-1 w-full rounded border px-2 py-1 text-sm" />
                        </label>
                        <label className="text-xs text-gray-600">
                          目的
                          <textarea value={candEdit.reason} onChange={(e) => setCandEdit({ ...candEdit, reason: e.target.value })} rows={2} className="mt-1 w-full rounded border px-2 py-1 text-sm" />
                        </label>
                        <label className="text-xs text-gray-600">
                          仮説（まだ検証していないこと）
                          <textarea value={candEdit.hypothesis} onChange={(e) => setCandEdit({ ...candEdit, hypothesis: e.target.value })} rows={2} className="mt-1 w-full rounded border px-2 py-1 text-sm" />
                        </label>
                        <label className="text-xs text-gray-600">
                          取り組み内容
                          <textarea value={candEdit.description} onChange={(e) => setCandEdit({ ...candEdit, description: e.target.value })} rows={2} className="mt-1 w-full rounded border px-2 py-1 text-sm" />
                        </label>
                        <div className="flex gap-2 md:col-span-2">
                          <Button onClick={saveCandidateEdit} className="rounded-full h-8 px-3 text-xs">
                            保存
                          </Button>
                          <Button variant="outline" onClick={() => setCandEdit(null)} className="rounded-full h-8 px-3 text-xs">
                            取り消す
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <details className="text-xs text-gray-700">
                        <summary className="cursor-pointer">仮説・取り組み内容・KPIを見る</summary>
                        <p className="mt-1">仮説：{String(c?.project.hypothesis ?? '（未設定）')}</p>
                        <p>取り組み内容：{String(c?.project.description ?? '（未設定）')}</p>
                        <p>KPI：{c && kpisOf(c.project).length > 0 ? kpisOf(c.project).join(' / ') : '（未設定）'}</p>
                        <Button
                          variant="outline"
                          disabled={!canOperate || !c}
                          onClick={() =>
                            c &&
                            setCandEdit({
                              candidateId: p.candidateId,
                              title: String(c.project.title ?? ''),
                              reason: String(c.project.reason ?? ''),
                              hypothesis: String(c.project.hypothesis ?? ''),
                              description: String(c.project.description ?? ''),
                            })
                          }
                          className="mt-2 h-7 rounded-full px-3 text-xs"
                        >
                          内容を編集
                        </Button>
                      </details>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {(['applied', 'discarded'] as const).map((d) => (
                        <ChoiceButton
                          key={d}
                          selected={shownDecision === d}
                          tone={d === 'applied' ? 'adopt' : 'reject'}
                          onClick={() => decideProject(p, d)}
                          disabled={!canOperate}
                        >
                          {d === 'applied' ? '採用する' : '採用しない'}
                        </ChoiceButton>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-3 border-t pt-4">
              <h4 className="text-sm font-semibold">他の事業・部門との調整候補（全社）</h4>
              {!analysis && <p className="text-xs text-gray-600">部門間の調整はまだ分析されていません（STEP2で6問を反映して再生成すると、自動で分析されます）。</p>}
              {analysis && analysis.candidates.length === 0 && <p className="text-xs text-gray-600">部門間の調整候補はありません。</p>}
              {(analysis?.candidates ?? []).map((c) => {
                const decision = candidateChoice(c.id);
                return (
                  <div key={c.id} className="space-y-2 rounded-xl border border-gray-200 p-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Chip tone="neutral">{ADJUSTMENT_KIND_LABEL[c.kind]}</Chip>
                      <span className="text-gray-600">対象：{c.departments.map((d) => d.name).join('・')}</span>
                      <span className="ml-auto font-semibold text-gray-700">{decision ? `判断：${CANDIDATE_LABEL[decision]}` : '未判断'}</span>
                    </div>
                    <p className="font-semibold">{showText(c.title)}</p>
                    <p className="text-sm text-gray-700">{showText(c.summary)}</p>
                    <div className="flex flex-wrap gap-2">
                      {(['adopted', 'rejected'] as const).map((d) => (
                        <ChoiceButton
                          key={d}
                          selected={decision === d}
                          tone={d === 'adopted' ? 'adopt' : 'reject'}
                          onClick={() => decideCandidate(c.id, d)}
                          disabled={!canOperate}
                        >
                          {d === 'adopted' ? '採用する' : '採用しない'}
                        </ChoiceButton>
                      ))}
                    </div>
                  </div>
                );
              })}
              {analysis && analysis.candidates.length > 0 && (
                <p className="text-xs text-gray-600">話し合いの結果を入力するには「部門間調整」タブを開いてください。</p>
              )}
            </div>

            <div className="space-y-2 border-t pt-4">
              <p className="text-xs text-gray-700">
                次の操作：重点プロジェクトを選んだら、「部門間の調整」へ進んでください。全部門をまとめた正式確定は、そのタブの最後（④）で1回だけ行います。
              </p>
              <Button onClick={() => setTab('compare')} className="rounded-full h-9 px-4">
                部門間の調整へ進む
              </Button>
            </div>
            <div>
              <Button variant="outline" onClick={() => showPhase(4)} className="rounded-full h-8 px-3 text-xs">
                STEP3に戻って戦略書を編集する
              </Button>
            </div>
          </div>
        </section>
        )}

        {/* 確定後：PDF出力とSTAGE4への移動（STEP4の代わりに表示する） */}
        {isOpen(6) && (
        <section className={sectionClass}>
          <h4 className={summaryClass}>事業・部門戦略書が確定しました</h4>
          <div className="space-y-4 border-t px-4 py-4">
            {confirmResultNote}
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={exportDeptPdf} disabled={isBusy} className="rounded-full h-9 px-4">
                確定版PDFを出力
              </Button>
              <span className="text-xs text-zinc-600">確定した内容だけを出力します（未確定の内容は含みません）</span>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-800">
                次の操作：確定した計画から実行計画書を作成するか、STAGE4の実行計画画面へ進めます。
              </p>
              <Link href="/okr" className="inline-flex rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-semibold text-zinc-900 hover:bg-zinc-50">
                STAGE4（実行計画）へ進む
              </Link>
              {officialProjects.filter((p) => stableIdText(p.id) !== null).map((p) => {
                const projectId = stableIdText(p.id) as string;
                const href = `/okr?from=stage3&dept=${encodeURIComponent(dept.name)}&projectId=${encodeURIComponent(projectId)}`;
                return (
                  <div key={projectId} className="flex flex-wrap items-center gap-3 border-t pt-2 text-sm">
                    <span className="font-semibold text-zinc-900">{String(p.title ?? '')}</span>
                    <a href={href} className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-semibold text-zinc-900 hover:bg-zinc-50">
                      STAGE4で実行計画書を作る
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
        )}
      </section>
    );
  };

  return (
    <article className="space-y-5 rounded-2xl border border-gray-200 bg-white p-6 text-slate-900 md:p-8">
      {blockingError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>{blockingError}</span>
          {readCompanyId && readStrategyId && workspaceErrorCode !== 'workspace_table_missing' && (
            <Button variant="outline" onClick={() => void load()} disabled={!loaded} className="h-8 rounded-full px-3 text-xs">
              読み込みをやり直す
            </Button>
          )}
        </div>
      )}

      {/* 全社戦略（STAGE2）の状態と、作業の状態 */}
      <section className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-50 px-4 py-3 text-sm">
        <span className="font-semibold">全社戦略（STAGE2）</span>
        {stage2.status === 'confirmed' && <Chip tone="ok">確定済み</Chip>}
        {stage2.status === 'loading' && <Chip tone="neutral">読み込み中</Chip>}
        {(stage2.status === 'not_confirmed' || stage2.status === 'story_missing') && <Chip tone="warn">未確定</Chip>}
        {stage2.status === 'error' && <Chip tone="warn">確認できません</Chip>}
        {stage2.status === 'confirmed' && (
          <Link
            href="/report/stage2-strategy"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-zinc-700"
          >
            全社戦略書を読む
          </Link>
        )}
      </section>

      {/* 事業・部門別タブ（各部門・部門間調整） */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <nav className="flex flex-wrap gap-2" aria-label="事業・部門ごとのタブ">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                tab === t.id ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-800 hover:bg-zinc-200'
              }`}
            >
              {t.label}
              {t.id === 'compare' && analysis && analysis.candidates.length > 0 && (
                <span className="ml-1 text-[11px] opacity-80">({analysis.candidates.length})</span>
              )}
            </button>
          ))}
        </nav>
        {canManageDepartments ? (
          <Button variant="outline" onClick={() => setMgmtOpen((o) => !o)} className="rounded-full h-8 px-3 text-xs">
            {mgmtOpen ? '事業・部門の管理を閉じる' : '事業・部門の追加・管理'}
          </Button>
        ) : (
          <span className="text-xs text-gray-500">部門の追加・名称変更は管理者のみ行えます</span>
        )}
      </div>

      {/* 事業・部門の追加・名称変更・削除（開いたときだけ表示） */}
      {mgmtOpen && canManageDepartments && (
        <section className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <ul className="space-y-2">
            {departments.map((d, i) => {
              const blockers = departmentDeleteBlockers(d as unknown as AnyRecord);
              return (
                <li key={`${d.id ?? d.name}-${i}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2">
                  {renaming?.index === i ? (
                    <>
                      <input
                        value={renaming.name}
                        onChange={(e) => setRenaming({ index: i, name: e.target.value })}
                        className="rounded border px-2 py-1 text-sm"
                        aria-label="新しい部門名"
                      />
                      <Button onClick={renameDept} disabled={isBusy} className="rounded-full h-7 px-3 text-xs">
                        名称を保存
                      </Button>
                      <Button variant="outline" onClick={() => setRenaming(null)} className="rounded-full h-7 px-3 text-xs">
                        取り消す
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-semibold">{d.name}</span>
                      <span className="text-xs text-gray-500">計画 {(d.projects ?? []).length}件</span>
                      <Button variant="outline" onClick={() => setRenaming({ index: i, name: d.name })} className="rounded-full h-7 px-3 text-xs">
                        名称を変更
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => deleteDept(i)}
                        disabled={isBusy || blockers.length > 0}
                        className="rounded-full h-7 px-3 text-xs"
                      >
                        削除
                      </Button>
                      {blockers.length > 0 && (
                        <details className="text-xs text-amber-800">
                          <summary className="cursor-pointer">関連データがあるため削除できません</summary>
                          <ul className="mt-1 list-disc pl-5 text-gray-700">
                            {blockers.map((b) => (
                              <li key={b}>{b}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-end gap-2 border-t pt-3">
            <label className="text-xs text-gray-600">
              新しい部門名
              <input
                value={newDeptName}
                onChange={(e) => setNewDeptName(e.target.value)}
                className="ml-2 rounded border px-2 py-1 text-sm"
                placeholder="例：研究開発部"
              />
            </label>
            <label className="text-xs text-gray-600">
              使命（任意）
              <input
                value={newDeptMission}
                onChange={(e) => setNewDeptMission(e.target.value)}
                className="ml-2 w-64 rounded border px-2 py-1 text-sm"
              />
            </label>
            <Button onClick={addDept} disabled={isBusy || !newDeptName.trim()} className="rounded-full h-8 px-4 text-xs">
              部門を追加
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            削除は、承認・採用済みの計画、KPIや実行計画、進捗の記録がない部門だけ行えます。
          </p>
        </section>
      )}

      {busy && BUSY_TEXT[busy] && (
        <p role="status" className="rounded-lg bg-sky-50 px-4 py-2 text-sm text-sky-900">
          {BUSY_TEXT[busy]}
        </p>
      )}
      {notice && <p className="rounded-lg bg-gray-50 px-4 py-2 text-sm text-gray-800">{notice}</p>}
      {decisionError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span>{decisionError}</span>
          <Button variant="outline" onClick={retryDecisions} className="h-8 rounded-full px-3 text-xs">
            もう一度保存する
          </Button>
        </div>
      )}

      {departments.length === 0 && tab !== 'compare' && (
        <section className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-5">
          <h3 className="font-semibold">最初に事業・部門を登録します</h3>
          <p className="text-sm text-zinc-700">戦略書を作る部門がありません。上の「事業・部門の追加・管理」から追加してください。</p>
        </section>
      )}

      {/* 各部門：①たたき台 → ②6問 → ③再生成 → ④文書の編集 → ⑤確定 → ⑥PDF */}
      {tab.startsWith('dept:') && departments.length > 0 && renderDepartment(Number(tab.slice(5)))}

      {/* 部門間の調整：AIの調整案を読み、候補ごとに採用するかを判断する。詳細と話し合いの記録は折りたたむ */}
      {tab === 'compare' && (
        <section className="space-y-6">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-zinc-900">部門間の調整</h3>
            <p className="text-sm text-zinc-700">
              AIが各事業・部門の戦略を比較し、調整が必要な項目を見つけました。提案を確認して判断してください。
            </p>
            {departments.length < 2 && <p className="text-xs text-zinc-600">部門が2つ以上あると分析できます（部門間の調整対象はありません）。</p>}
            {!latest && departments.length >= 2 && <p className="text-xs text-zinc-600">先に、部門のたたき台を作成してください。</p>}
            {staleAnalysis && <p className="text-xs text-amber-800">分析の後に計画が変わっています。補助操作から分析し直してください。</p>}
            {reasonLine(operateBlocker)}
          </div>

          {!loaded && <p className="text-sm text-zinc-700">作業内容を読み込んでいます…</p>}

          {loaded && !analysis && (
            <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-sm text-zinc-800">部門間の調整はまだ分析されていません。</p>
              <Button
                onClick={() => latest && analyze({ draftId: latest.draftId, version: latest.version })}
                disabled={!!genBlocker || !latest || departments.length < 2}
                className="rounded-full h-9 px-4"
              >
                {busy === 'analyze' ? '分析しています…' : '計画案を分析する'}
              </Button>
              {reasonLine(genBlocker)}
            </div>
          )}

          {analysis && analysis.candidates.length === 0 && (
            <p className="text-sm text-zinc-700">部門間の調整候補は見つかりませんでした。</p>
          )}

          {analysis && analysis.candidates.length > 0 && (
            <>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-700">
                <span>候補 {analysis.candidates.length}件</span>
                <span>採用する {analysis.candidates.filter((c) => candidateChoice(c.id) === 'adopted').length}件</span>
                <span>採用しない {analysis.candidates.filter((c) => candidateChoice(c.id) === 'rejected').length}件</span>
                <span className="font-semibold">
                  未判断 {analysis.candidates.filter((c) => !candidateChoice(c.id)).length}件
                </span>
              </div>

              {state.adjustmentProposals.length === 0 && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-800">
                  <span>まだAI調整案がありません。</span>
                  {canEdit && (
                    <>
                      <Button
                        onClick={() => generateProposalsFor(state)}
                        disabled={!!genBlocker || busy === 'proposal'}
                        className="rounded-full h-8 px-3 text-xs"
                      >
                        {busy === 'proposal' ? 'AI調整案を作っています…' : 'AI調整案を作る'}
                      </Button>
                      {reasonLine(genBlocker)}
                    </>
                  )}
                </div>
              )}

              <ol className="space-y-3">
                {analysis.candidates.map((c, idx) => {
                  const decision = candidateChoice(c.id);
                  const proposal = proposalOf(c.id);
                  const shown = proposal ? showText(proposal.edited ?? proposal.proposal) : '';
                  const isEditing = editingProposal?.candidateId === c.id;
                  const filledCount = c.dialogueTopics.filter((t) => (results[dialogueKey(c.id, t)] ?? '').trim() !== '').length;
                  return (
                    <li key={c.id} className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1">
                          <p className="text-xs text-zinc-500">
                            {idx + 1}. {ADJUSTMENT_KIND_LABEL[c.kind]}・{c.departments.map((d) => d.name).join('・')}
                          </p>
                          <p className="font-semibold text-zinc-900">{showText(c.title)}</p>
                        </div>
                        <Chip tone={decision === 'adopted' ? 'ok' : 'neutral'}>{decision ? CANDIDATE_LABEL[decision] : '未判断'}</Chip>
                      </div>

                      {proposal ? (
                        <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-900">{shown}</p>
                      ) : (
                        <p className="text-sm text-zinc-600">AI調整案はまだありません。</p>
                      )}

                      {isEditing ? (
                        <div className="space-y-2">
                          <p className="text-xs text-zinc-600">
                            調整案を修正します。採用すると、この内容で変更案を作ります。
                          </p>
                          <textarea
                            value={(editingProposal?.text ?? '')}
                            onChange={(e) => setEditingProposal({ candidateId: c.id, text: e.target.value })}
                            maxLength={600}
                            rows={5}
                            disabled={!canOperate}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button
                              onClick={() => saveProposalEdit(c.id, (editingProposal?.text ?? ''))}
                              disabled={!canOperate || (editingProposal?.text ?? '').trim() === ''}
                              className="rounded-full h-8 px-3 text-xs"
                            >
                              修正を保存
                            </Button>
                            {proposal?.edited && (
                              <Button
                                variant="outline"
                                onClick={() => saveProposalEdit(c.id, null)}
                                disabled={!canOperate}
                                className="rounded-full h-8 px-3 text-xs"
                              >
                                AIの案に戻す
                              </Button>
                            )}
                            <Button variant="outline" onClick={() => setEditingProposal(null)} className="rounded-full h-8 px-3 text-xs">
                              やめる
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <ChoiceButton
                            selected={decision === 'adopted'}
                            tone="adopt"
                            onClick={() => decideCandidate(c.id, 'adopted')}
                            disabled={!canOperate || !proposal}
                          >
                            採用する
                          </ChoiceButton>
                          <ChoiceButton
                            selected={decision === 'rejected'}
                            tone="reject"
                            onClick={() => decideCandidate(c.id, 'rejected')}
                            disabled={!canOperate}
                          >
                            採用しない
                          </ChoiceButton>
                          {proposal && canOperate && (
                            <button
                              type="button"
                              onClick={() => setEditingProposal({ candidateId: c.id, text: shown })}
                              className="px-1 text-xs text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
                            >
                              調整案を修正する
                            </button>
                          )}
                        </div>
                      )}

                      <details className="rounded-lg bg-zinc-50 px-3 py-2 text-sm">
                        <summary className="cursor-pointer font-semibold text-zinc-700">詳細を見る</summary>
                        <div className="mt-3 space-y-4">
                          <div className="space-y-1">
                            <p className="text-xs font-semibold text-zinc-500">AIが見つけた問題（事実・仮説を含む）</p>
                            <p className="whitespace-pre-wrap text-zinc-800">{showText(c.summary)}</p>
                          </div>
                          {proposal && (
                            <div className="space-y-1">
                              <p className="text-xs font-semibold text-zinc-500">AI調整案（全文）</p>
                              <p className="whitespace-pre-wrap text-zinc-800">{shown}</p>
                            </div>
                          )}
                          {proposal && proposal.changes.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-xs font-semibold text-zinc-500">具体的な変更対象と変更内容（確定前の案）</p>
                              <ul className="list-disc pl-5 text-xs text-zinc-700">
                                {proposal.changes.map((ch, i) => {
                                  const dept = c.departments.find((d) => d.departmentKey === ch.departmentKey)?.name ?? '';
                                  const plan = ch.projectId
                                    ? c.planRefs.find((r) => r.departmentKey === ch.departmentKey && r.projectId === ch.projectId)?.projectTitle
                                    : undefined;
                                  return (
                                    <li key={i}>
                                      {dept}
                                      {plan ? `「${plan}」` : ''}（{PROPOSAL_ITEM_LABEL[ch.item]}）：{showText(ch.change)}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}
                          <div className="space-y-1">
                            <p className="text-xs font-semibold text-zinc-500">関係する部門と計画</p>
                            <ul className="list-disc pl-5 text-xs text-zinc-700">
                              {c.planRefs.map((r) => (
                                <li key={`${r.departmentKey}-${r.projectId}`}>
                                  {r.departmentName}：{r.projectTitle}
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-zinc-500">
                              関係部門の話し合い結果（任意の記録・{filledCount}/{c.dialogueTopics.length}件入力済み）
                            </p>
                            {c.dialogueTopics.map((topic) => {
                              const key = dialogueKey(c.id, topic);
                              return (
                                <div key={key} className="space-y-1">
                                  <label className="text-sm">{showText(topic)}</label>
                                  <textarea
                                    value={results[key] ?? ''}
                                    onChange={(e) => setResults((prev) => ({ ...prev, [key]: e.target.value }))}
                                    placeholder="関係部門の話し合いの結果（空欄のままでも構いません）"
                                    rows={2}
                                    maxLength={1000}
                                    disabled={!canEdit}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ol>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p className="text-sm text-zinc-700">
                  未判断 {analysis.candidates.filter((c) => !candidateChoice(c.id)).length}件
                  （未判断のままでも保存できます。確定するまでに採否を選んでください）
                </p>
                <div className="flex flex-col items-end gap-1">
                  <Button onClick={applyAdjustments} disabled={!canOperate || !!genBlocker} className="rounded-full h-10 px-5">
                    {busy === 'regenerate' ? '調整後の戦略を作っています…' : '調整後の戦略を確認する'}
                  </Button>
                  {reasonLine(genBlocker)}
                </div>
              </div>

              {state.projectProposals.length > 0 && (
                <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
                  <div className="space-y-1">
                    <h4 className="font-semibold text-zinc-900">計画・KPIの変更候補</h4>
                    <p className="text-xs text-zinc-600">
                      関係部門の話し合いから出た提案です。採用した変更だけが、確定したときに正式な計画へ反映されます。
                    </p>
                  </div>
                  <ul className="space-y-3">
                    {state.projectProposals.map((p) => (
                      <li key={`${p.departmentKey}-${p.projectId}`} className="space-y-2 rounded-lg bg-zinc-50 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-zinc-900">
                            {p.departmentName}「{p.projectTitle}」
                          </p>
                          <Chip tone={projectDecisionOf(p) === 'adopted' ? 'ok' : 'neutral'}>{PROJECT_PROPOSAL_LABEL[projectDecisionOf(p)]}</Chip>
                        </div>
                        <p className="text-xs text-zinc-600">根拠：{showText(p.reason)}</p>
                        <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-800">
                          {projectChangeLines(p.base, p.proposed).map((line) => (
                            <li key={line}>{showText(line)}</li>
                          ))}
                        </ul>
                        <div className="flex flex-wrap gap-2">
                          <ChoiceButton
                            selected={projectDecisionOf(p) === 'adopted'}
                            tone="adopt"
                            onClick={() => decideProjectProposal(p, 'adopted')}
                            disabled={!canOperate}
                          >
                            採用する
                          </ChoiceButton>
                          <ChoiceButton
                            selected={projectDecisionOf(p) === 'rejected'}
                            tone="reject"
                            onClick={() => decideProjectProposal(p, 'rejected')}
                            disabled={!canOperate}
                          >
                            採用しない
                          </ChoiceButton>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {state.verification && (
                <section className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                  <h4 className="font-semibold text-zinc-900">調整後の計画の再検証（戦略書の結果）</h4>
                  {state.verification.basisKey !== planBasisKey(state) ? (
                    <p className="text-sm text-zinc-800">
                      採用・編集の内容が変わったため、この検証結果は古くなりました。確定するときに再検証します。
                    </p>
                  ) : state.verification.changeCount === 0 ? (
                    <p className="text-sm text-zinc-800">採用・編集した変更がないため、再検証はしていません。</p>
                  ) : state.verification.candidates.length === 0 ? (
                    <p className="text-sm text-zinc-800">採用・編集した変更を当てた計画に、重複・不整合は見つかりませんでした。</p>
                  ) : (
                    <ol className="space-y-2">
                      {state.verification.candidates.map((c, idx) => (
                        <li key={c.id} className="space-y-1 rounded-lg bg-white p-3">
                          <p className="text-xs text-zinc-500">
                            {idx + 1}. {ADJUSTMENT_KIND_LABEL[c.kind]}・{c.departments.map((d) => d.name).join('・')}
                          </p>
                          <p className="font-semibold text-zinc-900">{showText(c.title)}</p>
                          <p className="whitespace-pre-wrap text-sm text-zinc-800">{showText(c.summary)}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              )}
            </>
          )}

          <details className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm">
            <summary className="cursor-pointer font-semibold text-zinc-700">補助操作と計画案の比較</summary>
            <div className="mt-3 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {analysis && (
                  <Button
                    variant="outline"
                    onClick={() => latest && analyze({ draftId: latest.draftId, version: latest.version })}
                    disabled={!!genBlocker || !latest || departments.length < 2}
                    className="rounded-full h-9 px-4"
                  >
                    {busy === 'analyze' ? '分析しています…' : '最新の計画案をもう一度分析する'}
                  </Button>
                )}
                {analysis && analysis.candidates.length > 0 && canEdit && state.adjustmentProposals.length > 0 && (
                  <Button variant="outline" onClick={() => generateProposalsFor(state)} disabled={!!genBlocker || busy === 'proposal'} className="rounded-full h-9 px-4">
                    {busy === 'proposal' ? 'AI調整案を作っています…' : 'AI調整案をもう一度作る'}
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold text-zinc-800">最新の計画案の比較</h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-gray-600">
                      <th className="py-2">部門</th>
                      <th className="py-2">最新案の計画（既存・新規）</th>
                      <th className="py-2">変更案（未判断・採用）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {departments.map((d) => {
                      const key = departmentKeyOf(d as unknown as AnyRecord);
                      const draftDept = latest?.departments.find((x) => departmentKeyOf(x as unknown as AnyRecord) === key);
                      const titles = draftDept?.projects.map((p) => p.title) ?? (d.projects ?? []).map((p) => String((p as AnyRecord).title ?? ''));
                      const pending = state.selections.filter((s) => s.departmentKey === key && s.decision === 'pending').length;
                      const applied = state.selections.filter((s) => s.departmentKey === key && s.decision === 'applied').length;
                      return (
                        <tr key={key} className="border-b align-top">
                          <td className="py-2 font-semibold">{d.name}</td>
                          <td className="py-2 text-xs">{titles.length > 0 ? titles.join(' / ') : '（計画なし）'}</td>
                          <td className="py-2 text-xs">
                            未判断 {pending}・採用 {applied}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </details>

          <div className="space-y-3">
            <h3 className="text-base font-semibold text-zinc-900">④ 全体を確認して正式に確定する</h3>
            <p className="text-xs text-zinc-700">
              確定する内容（事業別の戦略の変更、採用した部門間調整、採用したプロジェクト）を確認してから確定してください。
            </p>
            {loaded ? (
              renderConfirmSummary()
            ) : (
              <p className="text-xs text-gray-700">作業内容を読み込んでいます。確定する内容は読み込み後に表示されます。</p>
            )}
            {renderConfirm()}
          </div>
        </section>
      )}
    </article>
  );
}
