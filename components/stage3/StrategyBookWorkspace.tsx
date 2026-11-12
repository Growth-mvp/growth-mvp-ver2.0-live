'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { authFetchJson, AuthFetchError } from '@/utils/authFetch';
import { ADJUSTMENT_KIND_LABEL, departmentKeyOf, type AdjustmentCandidate, type DialogueResult } from '@/lib/cascade/stage3Adjustment';
import { DEPT_PROPOSAL_ITEMS, type DeptProposal, type DeptProposalItem } from '@/lib/cascade/stage3Candidates';
import { draftDepartmentsFrom, newProjectCandidatesFrom, projectSelectionsFrom, selectionsFrom } from '@/lib/cascade/stage3Draft';
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

type AnyRecord = Record<string, unknown>;

export type StrategyBookGenerateResult = { projects: AnyRecord[]; proposals: DeptProposal[] };

export type StrategyBookGate =
  | { ok: true; companyId: string; strategyId: string; revision: number }
  | { ok: false; reason: string };

interface StrategyBookWorkspaceProps {
  departments: Department[];
  canEdit: boolean;
  getWriteGate: () => StrategyBookGate;
  generateDepartment: (index: number, mode: 'draft' | 'regen') => Promise<StrategyBookGenerateResult | null | undefined | void>;
  renderSixQuestions: (index: number) => ReactNode;
  onConfirmed: (message: string) => Promise<void> | void;
  onExportDepartment: (name: string) => Promise<void>;
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
    '作業データの保存先（stage3_strategy_books）がこの環境に準備されていません。STAGE2の確定状態とは関係ありません。管理者に確認してください。',
  workspace_unavailable: '作業データを読み込めませんでした（保存先に接続できません）。時間をおいて再度お試しください。',
  stage2_not_confirmed: '全社戦略（STAGE2）が確定されていません。STAGE2で確定してから進めてください。',
  stage2_story_missing:
    'STAGE2は確定されていますが、確定版の本文が保存されていません。STAGE2で確定し直してください。',
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
const PROJECT_DECISION_LABEL = { applied: '採用', deferred: '保留', discarded: '不採用', pending: '未判断' } as const;

/** 変更案のうち、利用者が文章として編集できる項目（文字列、または文字列の配列）。 */
function editableFields(proposed: AnyRecord): Array<{ key: string; lines: boolean }> {
  const out: Array<{ key: string; lines: boolean }> = [];
  for (const [key, value] of Object.entries(proposed)) {
    if (typeof value === 'string') out.push({ key, lines: false });
    else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) out.push({ key, lines: true });
  }
  return out;
}

function displayValue(item: DeptProposalItem, values: AnyRecord): string {
  const parts = DEPT_PROPOSAL_ITEMS[item].keys.map((k) => {
    const v = values[k];
    if (Array.isArray(v)) return v.map((x) => `・${String(x)}`).join('\n');
    if (typeof v === 'string') return v;
    return '';
  });
  return parts.filter(Boolean).join('\n');
}

function projectSummaryOf(state: WorkspaceState, candidateId: string): string {
  for (const draft of state.drafts) {
    const hit = draft.newProjects.find((np) => np.candidateId === candidateId);
    if (!hit) continue;
    const text = ['reason', 'description', 'hypothesis']
      .map((k) => hit.project[k])
      .find((v): v is string => typeof v === 'string' && v.trim() !== '');
    return text ?? '';
  }
  return '';
}

/** 再生成したとき、他の部門の候補は残し、作り直す部門の候補だけを置き換えるための材料。 */
function candidateProjectsOf(draft: StrategyDraft | null): Record<string, AnyRecord[]> {
  const out: Record<string, AnyRecord[]> = {};
  for (const np of draft?.newProjects ?? []) (out[np.departmentKey] ??= []).push(np.project);
  return out;
}

type Tab = 'overview' | 'compare' | `dept:${number}`;

export function StrategyBookWorkspace({
  departments,
  canEdit,
  getWriteGate,
  generateDepartment,
  renderSixQuestions,
  onConfirmed,
  onExportDepartment,
}: StrategyBookWorkspaceProps) {
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const versionRef = useRef<number | null>(null);
  const [state, setState] = useState<WorkspaceState>(emptyWorkspaceState());
  const [stage2, setStage2] = useState<Stage2View>({ status: 'loading' });
  const [results, setResults] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<Tab>('overview');

  useEffect(() => {
    void load();
    // 初回だけ読む。以後の状態は操作ごとに保存して持つ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const g = getWriteGate();
    if (!g.ok) {
      setNotice(g.reason);
      setStage2({ status: 'error', message: g.reason });
      setLoaded(true);
      return;
    }
    try {
      const res = await authFetchJson<StateResponse>(
        `/api/stage3/strategy-book?companyId=${encodeURIComponent(g.companyId)}&strategyId=${encodeURIComponent(g.strategyId)}`,
        { method: 'GET' },
      );
      versionRef.current = res.version;
      setVersion(res.version);
      setState(res.state);
      applyStage2(res.stage2Status, res.companyStrategy);
      setResults(Object.fromEntries(res.state.dialogue.map((d) => [dialogueKey(d.candidateId, d.topic), d.result])));
    } catch (e) {
      // 作業データの読み込みに失敗しても、STAGE2の判定はサーバーの応答から表示する（未確定と誤表示しない）
      const body = errorBody(e);
      if (body?.stage2Status) applyStage2(body.stage2Status, body.companyStrategy ?? null);
      else setStage2({ status: 'error', message: errorMessage(e) });
      setNotice(errorMessage(e));
    } finally {
      setLoaded(true);
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
  const stage2Blocker = (): string | null => {
    if (stage2.status === 'confirmed') return null;
    if (stage2.status === 'loading') return '読み込み中です。少し待ってから操作してください。';
    if (stage2.status === 'not_confirmed') return ERROR_MESSAGE.stage2_not_confirmed;
    if (stage2.status === 'story_missing') return ERROR_MESSAGE.stage2_story_missing;
    return stage2.message;
  };

  /**
   * 生成（初回たたき台・6問反映後の再生成）。対象の部門だけ作り直し、他の部門の草案・候補・判断は残す。
   * 結果は未確定の草案として保存する。正式な部門データは変えない。
   */
  const generateFor = async (indices: number[], kind: 'initial' | 'regenerated') => {
    const blocker = stage2Blocker();
    if (blocker) {
      setNotice(blocker);
      return;
    }
    if (!gate()) return;
    setBusy(kind);
    setNotice('');
    try {
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
          ...selectionsFrom(
            official,
            proposals,
            previousSelections.filter((s) => regenKeys.has(s.departmentKey)),
          ),
          ...previousSelections.filter((s) => !regenKeys.has(s.departmentKey)),
        ],
        projectSelections: projectSelectionsFrom(official, draft.newProjects, state.projectSelections),
      });
      if (!(await save(next))) return;
      const label = kind === 'initial' ? 'たたき台' : '再生成案';
      setNotice(
        [
          `${label}を保存しました（版 ${draft.version}・未確定）。正式な部門戦略は変わっていません。`,
          failed.length > 0 ? `作れなかった部門：${failed.join('・')}` : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
      const deptCount = departments.length;
      if (kind === 'regenerated' && deptCount >= 2) await analyze({ draftId: draft.draftId, version: draft.version }, next);
    } finally {
      setBusy(null);
    }
  };

  /* 最新の計画案を、部門間で分析する */
  const analyze = async (draftRef: { draftId: string; version: number } | null, base: WorkspaceState = state) => {
    const blocker = stage2Blocker();
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
        setTab('compare');
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
          ...selectionsFrom(
            official,
            proposals,
            withDialogue.selections.filter((s) => responded.has(s.departmentKey)),
          ),
          ...withDialogue.selections.filter((s) => !responded.has(s.departmentKey)),
        ],
      });
      if (saved) {
        const count = res.departments.reduce((n, d) => n + d.proposals.length, 0);
        setNotice(
          [
            count === 0
              ? '話し合いの結果を反映すると変わる項目はありませんでした。'
              : `変更案を${count}件作りました。採否を選んでから確定してください。`,
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
    await save(
      reopen({ ...state, selections: state.selections.map((s) => (selectionKey(s) === key ? { ...s, decision } : s)) }),
    );
  };

  const decideProject = async (target: ProjectSelection, decision: ProjectSelection['decision']) => {
    await save(
      reopen({
        ...state,
        projectSelections: state.projectSelections.map((p) => (p.candidateId === target.candidateId ? { ...p, decision } : p)),
      }),
    );
  };

  const saveSelectionEdit = async (target: Selection) => {
    const key = selectionKey(target);
    const proposed = { ...target.proposed };
    for (const field of editableFields(target.proposed)) {
      const text = editing[`${key} ${field.key}`];
      if (text === undefined) continue;
      proposed[field.key] = field.lines ? text.split('\n').map((l) => l.trim()).filter(Boolean) : text.trim();
    }
    await save(reopen({ ...state, selections: state.selections.map((s) => (selectionKey(s) === key ? { ...s, proposed } : s)) }));
    setEditing((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${key} `))));
  };

  /* 一括確定：全件の検証は保存先（サーバー）で行い、正式データと作業状態は1回の処理で更新する */
  const confirm = async () => {
    const blocker = stage2Blocker();
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
        json: {
          companyId: g.companyId,
          strategyId: g.strategyId,
          expectedRevision: g.revision,
          expectedVersion: versionRef.current,
        },
      });
      await load();
      await onConfirmed(
        `✅ 戦略書を確定しました（変更案の反映${res.appliedCount}件・新規プロジェクトの追加${res.adoptedProjectIds.length}件）。`,
      );
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

  const deptTitle = (i: number) => departments[i]?.name ?? '';
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: '概要' },
    ...departments.map((d, i) => ({ id: `dept:${i}` as Tab, label: d.name })),
    { id: 'compare', label: '部門間調整' },
  ];

  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-6 md:p-8 space-y-6 text-slate-900">
      <header className="space-y-2 border-b pb-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-xl font-bold">事業・部門戦略書</h2>
          {version !== null && <span className="text-xs text-gray-500">作業版 {version}</span>}
          {confirmed && state.confirmed && (
            <span className="text-xs font-semibold text-emerald-800">
              確定済み（{new Date(state.confirmed.confirmedAt).toLocaleString('ja-JP')}・反映{state.confirmed.appliedCount}件）
            </span>
          )}
        </div>
        <p className="text-xs text-gray-600">
          作業中の内容は未確定です。確定するまで、正式な部門戦略・KPI・STAGE4〜6のデータは変わりません。
        </p>
        {stage2.status !== 'confirmed' && stage2.status !== 'loading' && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{stage2Blocker()}</p>
        )}
      </header>

      <nav className="flex flex-wrap gap-2 border-b pb-3" aria-label="事業・部門ごとのタブ">
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

      {notice && <p className="rounded-lg bg-gray-50 px-4 py-2 text-sm text-gray-800">{notice}</p>}

      {/* 概要：全社戦略（STAGE2確定版）と、部門ごとの状況 */}
      {tab === 'overview' && (
        <section className="space-y-5">
          <div className="space-y-2">
            <h3 className="text-base font-semibold">全社戦略（STAGE2の確定版）</h3>
            {stage2.status === 'loading' && <p className="text-sm text-gray-600">読み込み中…</p>}
            {stage2.status === 'confirmed' && (
              <p className="whitespace-pre-wrap rounded-lg bg-zinc-50 p-4 text-sm leading-6">{stage2.companyStrategy}</p>
            )}
            {stage2.status !== 'confirmed' && stage2.status !== 'loading' && (
              <p className="text-sm text-amber-800">{stage2Blocker()}</p>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-base font-semibold">部門の状況</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-gray-600">
                  <th className="py-2">部門</th>
                  <th className="py-2">計画（既存）</th>
                  <th className="py-2">新規候補</th>
                  <th className="py-2">未判断の変更案</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {departments.map((d, i) => {
                  const key = departmentKeyOf(d as unknown as AnyRecord);
                  const existing = (d.projects ?? []).length;
                  const fresh = (state.projectSelections ?? []).filter((p) => p.departmentKey === key).length;
                  const pending = state.selections.filter((s) => s.departmentKey === key && s.decision === 'pending').length;
                  return (
                    <tr key={key} className="border-b">
                      <td className="py-2 font-semibold">{d.name}</td>
                      <td className="py-2">{existing}件</td>
                      <td className="py-2">{fresh}件</td>
                      <td className="py-2">{pending}件</td>
                      <td className="py-2 text-right">
                        <Button variant="outline" onClick={() => setTab(`dept:${i}`)} className="rounded-full h-8 px-3">
                          タブを開く
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => generateFor(departments.map((_, i) => i), 'initial')}
              disabled={!canOperate || !stage2Ready}
              className="rounded-full h-9 px-4"
            >
              {busy === 'initial' ? '作成しています…' : '全部門の初回たたき台を作る'}
            </Button>
            <span className="text-xs text-gray-600">部門ごとに作る場合は、各部門のタブで行えます。</span>
          </div>

          {state.drafts.length > 0 && (
            <div className="space-y-1 text-xs text-gray-600">
              <p className="font-semibold">保存された草案（未確定）</p>
              {state.drafts.map((d) => (
                <p key={d.draftId}>
                  版 {d.version}：{d.kind === 'initial' ? '初回のたたき台' : '6問を反映した再生成案'}（
                  {new Date(d.createdAt).toLocaleString('ja-JP')}）
                </p>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 部門のタブ：たたき台、6問、再生成版の編集、プロジェクトの採否、関係する調整候補、PDF */}
      {tab.startsWith('dept:') && (() => {
        const i = Number(tab.slice(5));
        const dept = departments[i];
        if (!dept) return <p className="text-sm text-gray-600">部門が見つかりません。</p>;
        const key = departmentKeyOf(dept as unknown as AnyRecord);
        const deptDraft = latest?.departments.find((d) => departmentKeyOf(d as unknown as AnyRecord) === key);
        const sels = state.selections.filter((s) => s.departmentKey === key);
        const projs = state.projectSelections.filter((p) => p.departmentKey === key);
        const cands = (analysis?.candidates ?? []).filter((c) => c.departments.some((d) => d.departmentKey === key));
        const officialIds = new Set((dept.projects ?? []).map((p) => String((p as AnyRecord).id ?? '')));
        return (
          <section className="space-y-8">
            <div className="space-y-3">
              <h3 className="text-base font-semibold">1. {dept.name}：たたき台と再生成</h3>
              <p className="text-xs text-gray-600">
                初回のたたき台は未確定の案として保存されます。6問に答えたあと、この部門だけ再生成できます。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => generateFor([i], 'initial')}
                  disabled={!canOperate || !stage2Ready}
                  className="rounded-full h-9 px-4"
                >
                  {busy === 'initial' ? '作成しています…' : 'この部門の初回たたき台を作る'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => generateFor([i], 'regenerated')}
                  disabled={!canOperate || !stage2Ready || !deptDraft}
                  className="rounded-full h-9 px-4"
                >
                  {busy === 'regenerated' ? '再生成しています…' : '6問を反映して、この部門を再生成する'}
                </Button>
              </div>
              {deptDraft ? (
                <div className="rounded-lg bg-zinc-50 p-4 text-sm">
                  <p className="text-xs text-gray-600">
                    版 {latest?.version}（{latest?.kind === 'initial' ? '初回のたたき台' : '6問を反映した再生成案'}・未確定）
                  </p>
                  <ul className="mt-2 list-disc pl-5">
                    {deptDraft.projects.map((p, idx) => (
                      <li key={`${p.title}-${idx}`}>
                        {p.title}
                        {!officialIds.has(String(p.id ?? '')) && <span className="ml-2 text-xs text-amber-800">（新規の案）</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-gray-600">まだこの部門の草案はありません。</p>
              )}
            </div>

            <div className="space-y-3">
              <h3 className="text-base font-semibold">2. 既存の6問への回答（空欄でも可）</h3>
              {renderSixQuestions(i)}
            </div>

            <div className="space-y-3">
              <h3 className="text-base font-semibold">3. 再生成版を読み、必要な箇所だけ編集する</h3>
              {sels.length === 0 && <p className="text-xs text-gray-600">この部門の変更案はまだありません。</p>}
              {sels.map((s) => {
                const meta = DEPT_PROPOSAL_ITEMS[s.item as DeptProposalItem];
                const k = selectionKey(s);
                const fields = editableFields(s.proposed);
                return (
                  <div key={k} className="rounded-2xl border border-zinc-200 px-4 py-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{meta.label}</span>
                      <span className="ml-auto text-xs font-semibold text-gray-700">{DECISION_LABEL[s.decision]}</span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl bg-zinc-50 px-3 py-2">
                        <div className="text-[11px] font-semibold text-zinc-600">現在の値</div>
                        <div className="mt-1 whitespace-pre-wrap text-xs leading-5">
                          {displayValue(s.item as DeptProposalItem, s.base) || '（未設定）'}
                        </div>
                      </div>
                      <div className="rounded-xl bg-amber-50 px-3 py-2 space-y-2">
                        <div className="text-[11px] font-semibold text-amber-800">再生成版（1行に1項目。編集できます）</div>
                        {fields.length === 0 && <div className="text-xs">（この形式の案は画面で編集できません）</div>}
                        {fields.map((f) => {
                          const value = s.proposed[f.key];
                          const initial = f.lines ? (value as string[]).join('\n') : String(value ?? '');
                          return (
                            <textarea
                              key={f.key}
                              value={editing[`${k} ${f.key}`] ?? initial}
                              onChange={(e) => setEditing((prev) => ({ ...prev, [`${k} ${f.key}`]: e.target.value }))}
                              disabled={!canOperate}
                              rows={Math.min(6, Math.max(2, (f.lines ? (value as string[]).length : 1) + 1))}
                              className="w-full rounded-lg border border-amber-200 bg-white px-2 py-1 text-xs"
                            />
                          );
                        })}
                        {fields.length > 0 && Object.keys(editing).some((x) => x.startsWith(`${k} `)) && (
                          <Button variant="outline" onClick={() => saveSelectionEdit(s)} disabled={!canOperate} className="rounded-full h-7 px-3 text-xs">
                            編集を保存
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(['applied', 'deferred', 'discarded'] as const).map((d) => (
                        <Button
                          key={d}
                          variant={s.decision === d ? 'primary' : 'outline'}
                          onClick={() => decideSelection(s, d)}
                          disabled={!canOperate}
                          className="rounded-full h-8 px-3"
                        >
                          {DECISION_LABEL[d]}
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-3">
              <h3 className="text-base font-semibold">4. 新規プロジェクトの採否</h3>
              <p className="text-xs text-gray-600">採用したものだけ、確定時にこの部門の戦略に追加されます。</p>
              {projs.length === 0 && <p className="text-xs text-gray-600">新規の候補はまだありません。</p>}
              {projs.map((p) => {
                const summary = projectSummaryOf(state, p.candidateId);
                return (
                  <div key={p.candidateId} className="rounded-2xl border border-zinc-200 px-4 py-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{p.title}</span>
                      <span className="ml-auto text-xs font-semibold text-gray-700">{PROJECT_DECISION_LABEL[p.decision]}</span>
                    </div>
                    {summary && <p className="text-xs leading-5 text-gray-700">{summary}</p>}
                    <div className="flex flex-wrap gap-2">
                      {(['applied', 'deferred', 'discarded'] as const).map((d) => (
                        <Button
                          key={d}
                          variant={p.decision === d ? 'primary' : 'outline'}
                          onClick={() => decideProject(p, d)}
                          disabled={!canOperate}
                          className="rounded-full h-8 px-3"
                        >
                          {PROJECT_DECISION_LABEL[d]}
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-3">
              <h3 className="text-base font-semibold">5. 関係する部門間の調整候補</h3>
              {cands.length === 0 && (
                <p className="text-xs text-gray-600">
                  {analysis ? 'この部門が関係する調整候補はありません。' : '部門間の調整はまだ分析されていません（「部門間調整」タブで分析できます）。'}
                </p>
              )}
              {cands.map((c) => (
                <div key={c.id} className="rounded-xl border border-gray-200 p-4 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">{ADJUSTMENT_KIND_LABEL[c.kind]}</span>
                    <span className="ml-auto font-semibold text-gray-700">
                      {state.candidateDecisions[c.id] ? `判断：${CANDIDATE_LABEL[state.candidateDecisions[c.id]]}` : '未判断'}
                    </span>
                  </div>
                  <p className="text-sm font-semibold">{c.title}</p>
                  <p className="text-xs text-gray-700">{c.summary}</p>
                </div>
              ))}
              {cands.length > 0 && (
                <Button variant="outline" onClick={() => setTab('compare')} className="rounded-full h-8 px-3">
                  部門間調整で判断する
                </Button>
              )}
            </div>

            <div className="space-y-2 border-t pt-4">
              <h3 className="text-base font-semibold">6. 確定版の戦略書（部門別PDF）</h3>
              {confirmed ? (
                <Button variant="outline" onClick={() => onExportDepartment(deptTitle(i))} disabled={isBusy} className="rounded-full h-8 px-3">
                  {deptTitle(i)}のPDFを出力
                </Button>
              ) : (
                <p className="text-xs text-gray-600">確定すると、この部門のPDFを出力できます。</p>
              )}
            </div>
          </section>
        );
      })()}

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
              disabled={!canOperate || !stage2Ready || !latest || departments.length < 2}
              className="rounded-full h-9 px-4"
            >
              {busy === 'analyze' ? '分析しています…' : analysis ? '最新の計画案をもう一度分析する' : '最新の計画案を分析する'}
            </Button>
            {departments.length < 2 && <span className="text-xs text-gray-600">部門が2つ以上ある場合に分析できます。</span>}
            {staleAnalysis && <span className="text-xs text-amber-800">分析の後に再生成されています。もう一度分析してください。</span>}
          </div>

          {analysis && analysis.candidates.length > 0 && (
            <div className="space-y-4">
              {analysis.candidates.map((c) => {
                const decision = state.candidateDecisions[c.id];
                return (
                  <div key={c.id} className="rounded-xl border border-gray-200 p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">{ADJUSTMENT_KIND_LABEL[c.kind]}</span>
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
        </section>
      )}

      {/* 確定：常に表示。未判断が残っていれば確定しない */}
      <section className="space-y-3 border-t pt-5">
        <h3 className="text-base font-semibold">確定</h3>
        <p className="text-xs text-gray-600">
          「反映する」と選んだ変更案と、採用した新規プロジェクトだけを、すべて一度に正式データへ反映します。1件でも反映できなければ、何も変わりません。
        </p>
        <p className="text-xs text-gray-700">
          未判断：変更案 {pendingSelectionCount}件・新規プロジェクト {pendingProjectCount}件
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={confirm} disabled={!canOperate || !stage2Ready || state.drafts.length === 0} className="rounded-full h-9 px-4">
            {busy === 'confirm' ? '確定しています…' : confirmed ? '再確定する' : 'この内容で確定する'}
          </Button>
          {!canEdit && <span className="text-xs text-gray-600">確定・反映は管理者・管理職のみ行えます。</span>}
        </div>
      </section>
    </article>
  );
}
