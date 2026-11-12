'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { authFetchJson, AuthFetchError } from '@/utils/authFetch';
import { ADJUSTMENT_KIND_LABEL, departmentKeyOf, type AdjustmentCandidate, type DialogueResult } from '@/lib/cascade/stage3Adjustment';
import { DEPT_PROPOSAL_ITEMS, currentItemValues, type DeptProposal, type DeptProposalItem } from '@/lib/cascade/stage3Candidates';
import { draftDepartmentsFrom, newProjectCandidatesFrom, projectSelectionsFrom, selectionsFrom } from '@/lib/cascade/stage3Draft';
import {
  departmentDeleteBlockers,
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
import { judgmentBlockerOf, judgmentSummaryOf } from '@/lib/cascade/stage3Judgments';
import { projectTextOf } from '@/lib/cascade/stage3Confirm';
import { stableIdText, type ProjectTextFields, type ProjectEdit } from '@/lib/cascade/stage3StrategyBook';
import { EditableBlock } from '@/components/okr/execution-plan/PlanDocument';
import { PLAN_DOC_CSS } from '@/components/okr/execution-plan/planDocStyles';

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
  renderSixQuestions: (index: number) => ReactNode;
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
  revision: number;
  stage2Status: 'confirmed' | 'not_confirmed' | 'story_missing';
  companyStrategy: string | null;
};
type FailedStateBody = { ok: false; error: string; stage2Status?: 'confirmed' | 'not_confirmed' | 'story_missing'; companyStrategy?: string | null };
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
  confirmed_with_undecided_candidate: '未判断の調整候補が残っています。採用・保留・不採用のいずれかを選んでください。',
  already_confirmed: 'この内容はすでに確定済みです。',
  current_value_changed: '反映予定の値が、案を作った後に変わっていました。正式データは変わっていません。もう一度生成からやり直してください。',
  confirm_failed: '確定できませんでした。正式データも作業内容も変わっていません。',
  insufficient_role: '確定は管理者・管理職のみ行えます。',
};

const DEFAULT_ERROR = '処理に失敗しました。時間をおいて再度お試しください。';

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

const dialogueKey = (candidateId: string, topic: string) => `${candidateId} ${topic}`;
const selectionKey = (s: Selection) => `${s.departmentKey} ${s.item}`;
const reopen = (state: WorkspaceState): WorkspaceState => ({ ...state, status: 'draft', confirmed: null });
const nextDraftVersion = (state: WorkspaceState) => Math.max(0, ...state.drafts.map((d) => d.version)) + 1;
const newDraftId = () => `draft-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const DECISION_LABEL = { applied: '反映する', deferred: '保留', discarded: '反映しない', pending: '未判断' } as const;
const CANDIDATE_LABEL = { adopted: '採用', deferred: '保留', rejected: '不採用' } as const;
const PROJECT_DECISION_LABEL = { applied: '採用する', deferred: '保留する', discarded: '採用しない', pending: '未判断' } as const;

const linesOf = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : typeof v === 'string' && v ? [v] : []);

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
  const [version, setVersion] = useState<number | null>(null);
  const versionRef = useRef<number | null>(null);
  // 複数スコープの読み込みが競合しても、古い会社の応答は反映しない。
  const loadSequenceRef = useRef(0);
  const [state, setState] = useState<WorkspaceState>(emptyWorkspaceState());
  const [stage2, setStage2] = useState<Stage2View>({ status: 'loading' });
  const [workspaceErrorCode, setWorkspaceErrorCode] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [docDraft, setDocDraft] = useState<{ deptKey: string; texts: TextDraft; projects: Record<string, ProjectTextDraft> } | null>(null);
  const [candEdit, setCandEdit] = useState<{ candidateId: string; title: string; reason: string; hypothesis: string; description: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<Tab>('dept:0');
  const [questionsOpen, setQuestionsOpen] = useState(true);
  const [mgmtOpen, setMgmtOpen] = useState(false);
  // 部門ごとの閲覧位置のみを管理。草案・採否・回答は従来どおりサーバーへ保存する。
  const [viewByDept, setViewByDept] = useState<Record<string, Phase>>({});
  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptMission, setNewDeptMission] = useState('');
  const [renaming, setRenaming] = useState<{ index: number; name: string } | null>(null);
  const [pendingTabName, setPendingTabName] = useState<string | null>(null);

  useEffect(() => {
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
      setVersion(res.version);
      setState(res.state);
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

  const save = async (next: WorkspaceState): Promise<boolean> => {
    const g = gate();
    const expected = versionRef.current;
    if (!g || expected === null) return false;
    try {
      const res = await authFetchJson<SaveResponse>('/api/stage3/strategy-book', {
        method: 'PUT',
        json: { companyId: g.companyId, strategyId: g.strategyId, expectedVersion: expected, state: next },
      });
      versionRef.current = res.version;
      setVersion(res.version);
      setState(next);
      return true;
    } catch (e) {
      setNotice(errorMessage(e));
      return false;
    }
  };

  const stage2Ready = stage2.status === 'confirmed';
  const stage2Message = (): string | undefined => (stage2.status === 'error' ? stage2.message : undefined);
  const blockerFor = (busyNow: boolean) =>
    generationBlockerOf({
      loaded,
      canEdit,
      busy: busyNow,
      stage2Status: stage2.status,
      stage2Message: stage2Message(),
      workspaceErrorCode,
    });

  /* 生成（初回たたき台・6問反映後の再生成）。対象の部門だけ作り直し、他の部門の草案・候補・判断は残す */
  const generateFor = async (indices: number[], kind: 'initial' | 'regenerated') => {
    const blocker = blockerFor(false);
    if (blocker) {
      setNotice(blocker);
      return;
    }
    if (!gate()) return;
    setBusy(kind);
    setNotice('');
    try {
      if (kind === 'regenerated' && prepareRegeneration) {
        for (const i of indices) {
          const prepared = await prepareRegeneration(i);
          if (!prepared.ok) {
            setNotice(prepared.message);
            return;
          }
        }
      }
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
      const official = departments as unknown as AnyRecord[];
      const previous = latestDraft(state);
      const regenKeys = new Set(Object.keys(generated));
      const candidateMap: Record<string, AnyRecord[]> = { ...candidateProjectsOf(previous) };
      for (const [k, r] of Object.entries(generated)) candidateMap[k] = r.projects;
      const draft: StrategyDraft = {
        draftId: newDraftId(),
        kind,
        version: nextDraftVersion(state),
        createdAt: new Date().toISOString(),
        departments: draftDepartmentsFrom(official, candidateMap),
        newProjects: newProjectCandidatesFrom(official, candidateMap),
        generatedDepartmentKeys: Object.keys(generated),
      };
      const proposals = Object.fromEntries(Object.entries(generated).map(([k, r]) => [k, r.proposals]));
      const previousSelections = state.selections;
      const next = reopen({
        ...state,
        drafts: [...state.drafts, draft].slice(-MAX_DRAFTS),
        analysis: null,
        candidateDecisions: {},
        dialogue: [],
        selections: [
          ...selectionsFrom(official, proposals, previousSelections.filter((s) => regenKeys.has(s.departmentKey))),
          ...previousSelections.filter((s) => !regenKeys.has(s.departmentKey)),
        ],
        projectSelections: projectSelectionsFrom(official, draft.newProjects, state.projectSelections),
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
      if (kind === 'regenerated' && departments.length >= 2) await analyze({ draftId: draft.draftId, version: draft.version }, next);
    } finally {
      setBusy(null);
    }
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
    setBusy('analyze');
    try {
      const res = await authFetchJson<AnalyzeResponse>('/api/stage3/adjustment/analyze', {
        method: 'POST',
        json: { companyId: g.companyId, strategyId: g.strategyId, draft: draftRef },
      });
      const saved = await save(
        reopen({
          ...base,
          analysis: {
            draftId: draftRef?.draftId ?? null,
            draftVersion: draftRef?.version ?? null,
            createdAt: new Date().toISOString(),
            candidates: res.candidates,
            rejectedCandidates: res.rejectedCandidates,
            rejectedReferences: res.rejectedReferences,
          },
          candidateDecisions: {},
          dialogue: [],
        }),
      );
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
        // 部門内の文書確認を中断しない。調整結果は共通タブから確認できる。
      }
    } catch (e) {
      if (errorCode(e) === 'insufficient_departments') {
        await save(reopen({ ...base, analysis: null, candidateDecisions: {}, dialogue: [] }));
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

  const saveDialogue = async () => {
    setBusy('dialogue');
    const ok = await save(reopen({ ...state, dialogue: filledDialogue() }));
    setBusy(null);
    if (ok) setNotice('話し合いの結果を保存しました。');
  };

  /* 対話結果を反映して変更案を作り直す（未確定。正式データは変えない） */
  const regenerateFromDialogue = async () => {
    const analysis = state.analysis;
    const g = gate();
    if (!g || !analysis || analysis.candidates.length === 0) return;
    const filled = filledDialogue();
    if (filled.length === 0) {
      setNotice('話し合いの結果を1件以上入力してから反映してください。');
      return;
    }
    setBusy('regenerate');
    setNotice('');
    try {
      const withDialogue = reopen({ ...state, dialogue: filled });
      if (!(await save(withDialogue))) return;
      const res = await authFetchJson<RegenerateResponse>('/api/stage3/adjustment/regenerate', {
        method: 'POST',
        json: {
          companyId: g.companyId,
          strategyId: g.strategyId,
          draft: analysis.draftId && analysis.draftVersion ? { draftId: analysis.draftId, version: analysis.draftVersion } : null,
          candidates: analysis.candidates,
          dialogue: filled,
        },
      });
      const proposals = Object.fromEntries(res.departments.map((d) => [d.departmentKey, d.proposals]));
      const responded = new Set(res.departments.map((d) => d.departmentKey));
      const official = departments as unknown as AnyRecord[];
      const saved = await save({
        ...withDialogue,
        selections: [
          ...selectionsFrom(official, proposals, withDialogue.selections.filter((s) => responded.has(s.departmentKey))),
          ...withDialogue.selections.filter((s) => !responded.has(s.departmentKey)),
        ],
      });
      if (saved) {
        const count = res.departments.reduce((n, d) => n + d.proposals.length, 0);
        setNotice(
          [
            count === 0 ? '話し合いの結果を反映すると変わる項目はありませんでした。' : `変更案を${count}件作りました。採否を選んでから確定してください。`,
            res.rejectedDepartments > 0 ? `保存済みにない部門IDを含んだため、${res.rejectedDepartments}件を採用しませんでした。` : '',
          ]
            .filter(Boolean)
            .join(' '),
        );
      }
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const decideCandidate = async (id: string, decision: 'adopted' | 'deferred' | 'rejected') => {
    await save(reopen({ ...state, candidateDecisions: { ...state.candidateDecisions, [id]: decision } }));
  };

  const decideSelection = async (target: Selection, decision: Selection['decision']) => {
    const key = selectionKey(target);
    await save(reopen({ ...state, selections: state.selections.map((s) => (selectionKey(s) === key ? { ...s, decision } : s)) }));
  };

  const decideProject = async (target: ProjectSelection, decision: ProjectSelection['decision']) => {
    await save(
      reopen({
        ...state,
        projectSelections: state.projectSelections.map((p) => (p.candidateId === target.candidateId ? { ...p, decision } : p)),
      }),
    );
  };

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

  /* 既存プロジェクトを「計画から外す」。参照されている計画は外さず、理由を出す。確定するまで正式データは変わらない。 */
  const removeProject = async (key: string, projectId: string, title: string) => {
    const g = gate();
    if (!g) return;
    let references: Record<string, string[]>;
    try {
      const res = await authFetchJson<{ ok: true; references: Record<string, string[]> }>('/api/stage3/strategy-book/project-references', {
        method: 'POST',
        json: { companyId: g.companyId, strategyId: g.strategyId, projectIds: [projectId] },
      });
      references = res.references;
    } catch {
      setNotice('参照を確認できなかったため、計画から外せません。時間をおいて再度お試しください。');
      return;
    }
    const reasons = references[projectId] ?? [];
    if (reasons.length > 0) {
      setNotice(`「${title}」は${reasons.join('、')}ため、計画から外せません。計画は残したまま、取り組み内容や仮説を直すことはできます。`);
      return;
    }
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
      setNotice(`「${title}」を計画から外す予定にしました（作業版・未確定）。確定すると、正式データから外れます。`);
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
    const blocker = blockerFor(false);
    if (blocker) {
      setNotice(blocker);
      return;
    }
    const undecided = (state.analysis?.candidates ?? []).filter((c) => !state.candidateDecisions[c.id]).length;
    const pending = state.selections.filter((s) => s.decision === 'pending').length;
    const pendingProjects = state.projectSelections.filter((p) => p.decision === 'pending').length;
    if (pending > 0) {
      setNotice(`未判断の変更案が${pending}件あります。反映・保留・反映しないのいずれかを選んでください。`);
      return;
    }
    if (pendingProjects > 0) {
      setNotice(`未判断の新規プロジェクトが${pendingProjects}件あります。採用・保留・不採用のいずれかを選んでください。`);
      return;
    }
    if (undecided > 0) {
      setNotice(`未判断の調整候補が${undecided}件あります。採用・保留・不採用のいずれかを選んでください。`);
      return;
    }
    const g = gate();
    if (!g || versionRef.current === null) return;
    setBusy('confirm');
    setNotice('');
    try {
      const res = await authFetchJson<ConfirmResponse>('/api/stage3/strategy-book/confirm', {
        method: 'POST',
        json: { companyId: g.companyId, strategyId: g.strategyId, expectedRevision: g.revision, expectedVersion: versionRef.current },
      });
      await load();
      setViewByDept({}); // 確定後は対象部門でPDFが主操作となる
      await onConfirmed(`✅ 戦略書を確定しました（変更案の反映${res.appliedCount}件・新規プロジェクトの追加${res.adoptedProjectIds.length}件）。`);
    } catch (e) {
      const code = errorCode(e);
      setNotice(errorMessage(e));
      if (code === 'revision_changed' || code === 'version_conflict') await load();
    } finally {
      setBusy(null);
    }
  };

  /* ---- 表示 ---- */
  const latest = latestDraft(state);
  const confirmed = state.status === 'confirmed';
  const isBusy = busy !== null;
  const canOperate = canEdit && loaded && !isBusy;
  const analysis = state.analysis;
  const staleAnalysis = !!analysis && (!latest || analysis.draftVersion !== latest.version);
  const pendingSelectionCount = state.selections.filter((s) => s.decision === 'pending').length;
  const pendingProjectCount = state.projectSelections.filter((p) => p.decision === 'pending').length;
  const undecidedCandidateCount = (analysis?.candidates ?? []).filter((c) => !state.candidateDecisions[c.id]).length;
  const genBlocker = blockerFor(isBusy);

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

  const judgments = judgmentSummaryOf(state);
  const confirmBlocker = !canEdit
    ? '確定・反映は管理者・管理職のみ行えます'
    : !stage2Ready
      ? (stage2.status === 'loading' ? '読み込み中です' : 'STAGE2の確定後に確定できます')
      : state.drafts.length === 0
        ? '先に、部門の戦略書のたたき台を作成してください'
        : judgmentBlockerOf(judgments);

  const renderConfirm = () => (
    <div className="space-y-2 rounded-xl border border-zinc-200 p-4">
      <div className="space-y-1 text-xs text-gray-700">
        <p>確定すると、編集した戦略書・採用した新規プロジェクト・採用した部門間調整を、まとめて正式データへ反映します。1件でも反映できなければ、何も変わりません。</p>
        <p>戦略書の項目：反映 {judgments.appliedItems}件</p>
        <p>
          新規プロジェクト候補：全{judgments.projects.total}件（採用 {judgments.projects.adopted}・保留 {judgments.projects.deferred}・不採用 {judgments.projects.rejected}・未判断 {judgments.projects.undecided}）
        </p>
        <p>
          部門間調整候補：全{judgments.adjustments.total}件（採用 {judgments.adjustments.adopted}・保留 {judgments.adjustments.deferred}・不採用 {judgments.adjustments.rejected}・未判断 {judgments.adjustments.undecided}）
        </p>
        <p>各候補は、採用・保留・不採用・未判断のどれか1つにだけ数えます。</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={confirm} disabled={!canOperate || confirmBlocker !== null} className="rounded-full h-9 px-4">
          {busy === 'confirm' ? '確定しています…' : confirmed ? '変更内容を再確定する' : '戦略書を確定する'}
        </Button>
        {reasonLine(confirmBlocker)}
      </div>
    </div>
  );

  const renderDepartment = (i: number) => {
    const dept = departments[i];
    if (!dept) return <p className="text-sm text-gray-600">部門が見つかりません。</p>;
    const key = departmentKeyOf(dept as unknown as AnyRecord);
    const progress = progressOf(key);
    const requested = viewByDept[key];
    const allowed = requested === 1 ||
      (requested === 2 && progress.hasInitial) ||
      ((requested === 4 || requested === 5) && progress.hasRegen) ||
      (requested === 6 && progress.deptConfirmed);
    const effective: Phase = requested !== undefined && allowed ? requested : progress.current;
    const showPhase = (phase: Phase) => setViewByDept((prev) => ({ ...prev, [key]: phase }));
    const latestInitial = [...state.drafts].reverse().find((d) => d.kind === 'initial' && (d.generatedDepartmentKeys ?? []).includes(key));
    const latestRegen = progress.hasRegen ? [...state.drafts].reverse().find((d) => d.kind === 'regenerated' && (d.generatedDepartmentKeys ?? []).includes(key)) : undefined;
    const initialDept = latestInitial?.departments.find((x) => departmentKeyOf(x as unknown as AnyRecord) === key);
    const sels = state.selections.filter((s) => s.departmentKey === key);
    const projs = state.projectSelections.filter((p) => p.departmentKey === key);
    const cands = (analysis?.candidates ?? []).filter((c) => c.departments.some((d) => d.departmentKey === key));
    const officialProjects = (dept.projects ?? []) as unknown as AnyRecord[];
    const selOf = (item: DeptProposalItem) => sels.find((s) => s.item === item);
    const baseOf = (item: DeptProposalItem) => currentItemValues(dept as unknown as AnyRecord, item);
    const collabInter = linesOf(selOf('collab')?.proposed.interDeptCollab ?? baseOf('collab').interDeptCollab);
    const collabIntra = linesOf(selOf('collab')?.proposed.intraDeptCollab ?? baseOf('collab').intraDeptCollab);
    const docFor = (draft: StrategyDraft | undefined): StrategyDocumentProps | null => {
      if (!draft) return null;
      const draftDept = draft.departments.find((x) => departmentKeyOf(x as unknown as AnyRecord) === key);
      const docText = (item: DeptProposalItem) => linesOf(sels.find((s) => s.item === item)?.proposed[DEPT_PROPOSAL_ITEMS[item].keys[0]]);
      const candidateProjects = draft.newProjects.map((n) => n.project as AnyRecord);
      /* 確定後は正式データのプロジェクトを表示する（確定で外れた計画を残さないため）。確定前は草案の内容に、作業版の編集を重ねる。 */
      const sourceProjects = (state.status === 'confirmed' ? officialProjects : (draftDept?.projects ?? [])) as unknown as DraftProjectInput[];
      const projects: DocProject[] = sourceProjects.map((p) => {
        const d = projectDetailOf(p, { official: officialProjects, candidates: candidateProjects });
        const id = stableIdText((p as unknown as AnyRecord).id);
        const edit = id === null ? undefined : state.projectEdits.find((e) => e.departmentKey === key && e.projectId === id);
        const removed = id !== null && state.projectRemovals.some((r) => r.departmentKey === key && r.projectId === id);
        const doc: DocProject = {
          title: edit ? edit.fields.title : d.title,
          origin: d.origin,
          group: d.group,
          objective: d.okrs[0]?.objective || null,
          purpose: edit ? edit.fields.reason : d.purpose,
          hypothesis: edit ? edit.fields.hypothesis : d.hypothesis,
          summary: edit ? edit.fields.description : d.summary,
          partner: d.partnerDepartment,
          goals: [...new Set([...d.okrs.flatMap((o) => o.keyResults), ...d.kpis])],
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
    const previousViews: Array<{ phase: Phase; label: string }> = [
      ...(progress.hasInitial ? [{ phase: 1 as Phase, label: 'たたき台を読み直す' }] : []),
      ...(progress.hasInitial ? [{ phase: 2 as Phase, label: '6つの問いを見直す' }] : []),
      ...(progress.hasRegen ? [{ phase: 4 as Phase, label: '戦略書を編集する' }] : []),
      ...(progress.hasRegen ? [{ phase: 5 as Phase, label: '部門間調整・確定を確認する' }] : []),
      ...(progress.deptConfirmed ? [{ phase: 6 as Phase, label: '確定した戦略書' }] : []),
    ].filter((view) => view.phase !== effective);

    return (
      <section className="space-y-4">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-bold">{dept.name}の戦略書</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={progress.deptConfirmed ? 'ok' : progress.hasRegen ? 'neutral' : 'warn'}>
                {progress.deptConfirmed ? '確定済み' : progress.hasRegen ? '再生成版・未確定' : progress.hasInitial ? 'たたき台作成済み' : '未作成'}
              </Chip>
              {progress.hasInitial && (
                <>
                  <Button
                    variant="outline"
                    onClick={exportDeptPdf}
                    disabled={isBusy || editingHere}
                    className="rounded-full h-8 px-3 text-xs"
                  >
                    PDF出力
                  </Button>
                  <span className="text-xs text-zinc-600">
                    {progress.deptConfirmed ? '確定版を出力します' : '作業版（未確定）を出力します'}
                  </span>
                </>
              )}
            </div>
          </div>
          {editingHere && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              編集中のためPDFは出力できません。「編集を保存」か「編集をやめる」を押してから、出力してください。
            </p>
          )}
          <p className="text-sm leading-6 text-zinc-700">
            {effective === 1
              ? progress.hasInitial ? 'AIのたたき台を読んで、部門として考えたい点を確認しましょう。' : 'まず、全社戦略をもとにAIがこの部門の戦略書のたたき台を作ります。'
              : effective === 2 ? 'たたき台を踏まえて、6つの問いを考えます。回答は空欄でも進められます。'
              : effective === 4 ? '再生成された戦略書を読み、必要な部分を編集して、プロジェクトの採否を決めます。'
              : effective === 5 ? '部門間の調整事項を確認し、関係部門の判断が揃ったら戦略書を確定します。'
              : '確定した戦略書です。PDFは上部の「PDF出力」から出せます。'}
          </p>
          <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm font-medium text-sky-900">
            次の操作：
            {!progress.hasInitial
              ? '「AIで戦略書のたたき台を作成」を押してください。'
              : !progress.hasRegen
                ? 'たたき台を読み、必要なら6問の回答を反映して戦略書を再生成してください。'
                : judgments.blockers > 0
                  ? `${judgmentBlockerOf(judgments)}（「部門間調整・確定」で判断してください）`
                  : progress.deptConfirmed
                    ? '確定済みです。下の「STAGE4で実行計画書を作る」から、プロジェクトを選んで作成できます。'
                    : '「部門間調整・確定」を開き、「戦略書を確定する」を押してください。'}
          </p>
          {previousViews.length > 0 && (
            <details className="text-xs text-zinc-600">
              <summary className="cursor-pointer py-1 font-medium">以前の内容を見る・修正する</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {previousViews.map((view) => (
                  <button
                    key={view.phase}
                    type="button"
                    onClick={() => showPhase(view.phase)}
                    className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 hover:border-zinc-400 hover:bg-zinc-50"
                  >
                    {view.label}
                  </button>
                ))}
              </div>
            </details>
          )}
        </header>

        {/* ① 初回のたたき台 */}
        {isOpen(1) && (
        <section className={sectionClass}>
          <h4 className={summaryClass}>{progress.hasInitial ? 'AIによる戦略書のたたき台' : 'AIで戦略書のたたき台を作成'}</h4>
          <div className="space-y-3 border-t px-4 py-4">
            {progress.hasInitial && initialDept ? (
              <>
                <p className="text-xs text-gray-600">
                  版 {latestInitial?.version}（初回のたたき台・未確定）。読んでから、6問に進んでください。
                </p>
                {!progress.hasRegen && initialDoc ? (
                  <div className="rounded-xl border border-zinc-200 bg-white px-5 py-6 md:px-8">
                    <StrategyBookDocument {...initialDoc} />
                  </div>
                ) : (
                  <p className="text-sm text-zinc-700">再生成版があります。④で文書を確認し、編集できます。</p>
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
              {renderSixQuestions(i)}
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
                      <p className="text-xs text-gray-600">
                        版 {latestRegen?.version}（再生成・未確定）。内容を直すときは「戦略書を編集」を押してください。
                      </p>
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
                <div className="flex justify-end">
                  <details className="w-full rounded-lg bg-zinc-50 px-3 py-2 text-xs">
                    <summary className="cursor-pointer font-semibold">旧版（現在の戦略）と比べる</summary>
                    <div className="mt-2 space-y-2">
                      {DOC_FIELDS.map((f) => (
                        <div key={f.item}>
                          <div className="font-semibold text-gray-700">{f.label}</div>
                          <div className="whitespace-pre-wrap text-gray-700">
                            {linesOf(baseOf(f.item)[DEPT_PROPOSAL_ITEMS[f.item].keys[0]]).join(f.lines ? '\n' : '') || '（未設定）'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>

                {/* プロジェクト：既存（保護）と新規候補。まず一覧、詳細は展開して確認 */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">既存の計画（変更しません）</h4>
                  {officialProjects.length === 0 && <p className="text-xs text-gray-600">この部門の既存の計画はまだありません。</p>}
                  {officialProjects.map((p, idx) => (
                    <div key={`official-${idx}`} className="rounded-xl bg-zinc-50 p-4 space-y-1">
                      <div className="text-sm font-semibold">{String(p.title ?? '')}</div>
                      {Boolean(p.reason || p.hypothesis) && <p className="text-xs text-gray-700">目的：{String(p.reason ?? p.hypothesis)}</p>}
                      <details className="text-xs text-gray-700">
                        <summary className="cursor-pointer">仮説・KPIを見る</summary>
                        <p className="mt-1">仮説：{String(p.hypothesis ?? '（未設定）')}</p>
                        <p>KPI：{kpisOf(p).length > 0 ? kpisOf(p).join(' / ') : '（未設定）'}</p>
                        <p className="mt-1 text-[11px] text-gray-500">既存の計画のため、ここでは変更できません（KPIは保護されています）。</p>
                      </details>
                    </div>
                  ))}

                  <h4 className="pt-2 text-sm font-semibold">新規の候補</h4>
                  {projs.length === 0 && <p className="text-xs text-gray-600">新規の候補プロジェクトはまだありません。</p>}
                  {projs.map((p) => {
                    const c = latest?.newProjects.find((np) => np.candidateId === p.candidateId);
                    const summary = projectSummaryOf(state, p.candidateId);
                    const editing = candEdit?.candidateId === p.candidateId;
                    return (
                      <div key={p.candidateId} className="rounded-xl border border-zinc-200 p-4 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{p.title}</span>
                          <Chip tone={p.decision === 'applied' ? 'ok' : 'neutral'}>新規の候補・{PROJECT_DECISION_LABEL[p.decision]}</Chip>
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
                              className="mt-2 rounded-full h-7 px-3 text-xs"
                            >
                              内容を編集
                            </Button>
                          </details>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {(['applied', 'deferred', 'discarded'] as const).map((d) => (
                            <Button
                              key={d}
                              variant={p.decision === d ? 'primary' : 'outline'}
                              onClick={() => decideProject(p, d)}
                              disabled={!canOperate}
                              className="rounded-full h-7 px-3 text-xs"
                            >
                              {PROJECT_DECISION_LABEL[d]}
                            </Button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="space-y-2 border-t pt-4">
                  {sels.filter((s) => s.decision === 'pending').length + projs.filter((p) => p.decision === 'pending').length > 0 && (
                    <p className="text-xs text-amber-800">
                      未判断の変更案・プロジェクトがあります。各項目の「反映する・保留・反映しない」または「採用・保留・不採用」を選んでください。
                    </p>
                  )}
                  <div className="flex justify-end">
                    <Button onClick={() => showPhase(5)} className="rounded-full h-9 px-5">
                      部門間調整・確定へ進む
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
        )}

        {/* ⑤ 部門間調整の反映・確定 */}
        {isOpen(5) && (
        <section className={sectionClass}>
          <h4 className={summaryClass}>部門間調整と戦略書の確定</h4>
          <div className="space-y-4 border-t px-4 py-4">
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">関係する部門間の調整</h4>
              {cands.length === 0 && (
                <p className="text-xs text-gray-600">
                  {analysis ? 'この部門が関係する調整候補はありません。' : '部門間の調整はまだ分析されていません（③の後に自動で分析されます）。'}
                </p>
              )}
              {cands.map((c) => (
                <div key={c.id} className="rounded-lg border border-gray-200 p-3 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Chip tone="neutral">{ADJUSTMENT_KIND_LABEL[c.kind]}</Chip>
                    <span className="ml-auto font-semibold text-gray-700">
                      {state.candidateDecisions[c.id] ? `判断：${CANDIDATE_LABEL[state.candidateDecisions[c.id]]}` : '未判断'}
                    </span>
                  </div>
                  <p className="text-sm font-semibold">{c.title}</p>
                  <p className="text-xs text-gray-700">{c.summary}</p>
                </div>
              ))}
              {(cands.length > 0 || undecidedCandidateCount > 0) && (
                <Button variant="outline" onClick={() => setTab('compare')} className="rounded-full h-8 px-3">
                  部門間調整で判断する
                </Button>
              )}
            </div>
            <Button variant="outline" onClick={() => showPhase(4)} className="rounded-full h-8 px-3">
              戦略書の編集に戻る
            </Button>
            {renderConfirm()}
          </div>
        </section>
        )}

        {/* ⑥ 確定済みの戦略書（PDFは上部の「PDF出力」から） */}
        {isOpen(6) && (
        <section className={sectionClass}>
          <h4 className={summaryClass}>確定した戦略書</h4>
          <div className="space-y-2 border-t px-4 py-4">
            <p className="text-xs text-gray-600">この部門の戦略書は確定済みです。PDFは、画面上部の「PDF出力」から確定版を出力できます。</p>
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
      <section className="space-y-2 rounded-xl bg-zinc-50 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">全社戦略（STAGE2）{stage2.status === 'confirmed' && '｜確定済み'}</span>
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
        </div>
        <p className="text-xs text-gray-600">
          作業内容は、確定するまで未確定です。確定するまで、正式な部門戦略・KPI・STAGE4〜6のデータは変わりません。
          {version !== null && `（作業版 ${version}）`}
          {confirmed && state.confirmed && (
            <span className="ml-2 font-semibold text-emerald-800">
              確定済み（{new Date(state.confirmed.confirmedAt).toLocaleString('ja-JP')}・反映{state.confirmed.appliedCount}件）
            </span>
          )}
        </p>
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

      {notice && <p className="rounded-lg bg-gray-50 px-4 py-2 text-sm text-gray-800">{notice}</p>}

      {departments.length === 0 && tab !== 'compare' && (
        <section className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-5">
          <h3 className="font-semibold">最初に事業・部門を登録します</h3>
          <p className="text-sm text-zinc-700">戦略書を作る部門がありません。上の「事業・部門の追加・管理」から追加してください。</p>
          {canManageDepartments && (
            <Button onClick={() => setMgmtOpen(true)} className="rounded-full h-9 px-4">事業・部門を追加する</Button>
          )}
        </section>
      )}

      {/* 各部門：①たたき台 → ②6問 → ③再生成 → ④文書の編集 → ⑤確定 → ⑥PDF */}
      {tab.startsWith('dept:') && departments.length > 0 && renderDepartment(Number(tab.slice(5)))}

      {/* 部門間調整：複数部門の最新案を比べ、候補ごとに採否と話し合いを記録する */}
      {tab === 'compare' && (
        <section className="space-y-6">
          <div className="space-y-2">
            <h3 className="text-base font-semibold">最新の計画案の比較</h3>
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

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => latest && analyze({ draftId: latest.draftId, version: latest.version })}
              disabled={!!genBlocker || !latest || departments.length < 2}
              className="rounded-full h-9 px-4"
            >
              {busy === 'analyze' ? '分析しています…' : analysis ? '最新の計画案をもう一度分析する' : '最新の計画案を分析する'}
            </Button>
            {departments.length < 2 && <span className="text-xs text-gray-600">部門が2つ以上あると分析できます（部門間の調整対象はありません）。</span>}
            {!latest && departments.length >= 2 && <span className="text-xs text-gray-600">先に、部門のたたき台を作成してください。</span>}
            {staleAnalysis && <span className="text-xs text-amber-800">分析の後に再生成されています。もう一度分析してください。</span>}
          </div>

          {analysis && analysis.candidates.length > 0 && (
            <div className="space-y-4">
              {analysis.candidates.map((c) => {
                const decision = state.candidateDecisions[c.id];
                return (
                  <div key={c.id} className="rounded-xl border border-gray-200 p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Chip tone="neutral">{ADJUSTMENT_KIND_LABEL[c.kind]}</Chip>
                      <span className="text-gray-600">対象：{c.departments.map((d) => d.name).join('・')}</span>
                      <span className="ml-auto font-semibold text-gray-700">{decision ? `判断：${CANDIDATE_LABEL[decision]}` : '未判断'}</span>
                    </div>
                    <p className="font-semibold">{c.title}</p>
                    <p className="text-sm text-gray-700">{c.summary}</p>
                    <ul className="list-disc pl-5 text-xs text-gray-700">
                      {c.planRefs.map((r) => (
                        <li key={`${r.departmentKey}-${r.projectId}`}>
                          {r.departmentName}：{r.projectTitle}
                        </li>
                      ))}
                    </ul>
                    <div className="space-y-2">
                      {c.dialogueTopics.map((topic) => {
                        const key = dialogueKey(c.id, topic);
                        return (
                          <div key={key} className="space-y-1">
                            <label className="text-sm">{topic}</label>
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
                    <div className="flex flex-wrap gap-2">
                      {(['adopted', 'deferred', 'rejected'] as const).map((d) => (
                        <Button
                          key={d}
                          variant={decision === d ? 'primary' : 'outline'}
                          onClick={() => decideCandidate(c.id, d)}
                          disabled={!canOperate}
                          className="rounded-full h-8 px-3"
                        >
                          {CANDIDATE_LABEL[d]}
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={saveDialogue} disabled={!canOperate} className="rounded-full h-9 px-4">
                  話し合いの結果を保存
                </Button>
                <Button onClick={regenerateFromDialogue} disabled={!canOperate} className="rounded-full h-9 px-4">
                  {busy === 'regenerate' ? '反映しています…' : '話し合いの結果を反映して変更案を作る'}
                </Button>
              </div>
            </div>
          )}

          {renderConfirm()}
        </section>
      )}
    </article>
  );
}
