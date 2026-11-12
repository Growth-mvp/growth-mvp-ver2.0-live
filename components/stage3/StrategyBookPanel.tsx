'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { authFetchJson, AuthFetchError } from '@/utils/authFetch';
import { ADJUSTMENT_KIND_LABEL, departmentKeyOf, type AdjustmentCandidate, type DialogueResult } from '@/lib/cascade/stage3Adjustment';
import { DEPT_PROPOSAL_ITEMS, type DeptProposal, type DeptProposalItem } from '@/lib/cascade/stage3Candidates';
import { draftDepartmentsFrom, newProjectCandidatesFrom, projectSelectionsFrom, selectionsFrom } from '@/lib/cascade/stage3Draft';
import {
  emptyWorkspaceState,
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

interface StrategyBookPanelProps {
  departments: Department[];
  canEdit: boolean;
  getWriteGate: () => StrategyBookGate;
  generateDepartment: (index: number, mode: 'draft' | 'regen') => Promise<StrategyBookGenerateResult | null | undefined | void>;
  renderSixQuestions: (index: number) => ReactNode;
  onConfirmed: (message: string) => Promise<void> | void;
  onExportDepartment: (name: string) => Promise<void>;
}

type LoadResponse = {
  ok: true;
  version: number;
  state: WorkspaceState;
  revision: number;
  companyStrategy: string | null;
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
};
type ConfirmResponse = { ok: true; revision: number; version: number; appliedCount: number; adoptedProjectIds: string[] };

const ERROR_MESSAGE: Record<string, string> = {
  unauthorized: '認証できませんでした。再ログインしてください。',
  forbidden: '対象の会社・戦略を利用する権限がありません。',
  insufficient_role: '確定は管理者・管理職のみ行えます。',
  strategy_mismatch: '対象の戦略を確認できませんでした。画面を再読み込みしてください。',
  stage2_not_confirmed: '全社戦略（STAGE2）の確定版がありません。STAGE2で確定してから進めてください。',
  unverifiable_departments: '部門データを確認できませんでした。',
  invalid_candidates: '調整候補が古くなっています。分析し直してください。',
  invalid_dialogue: '話し合いの結果の内容を確認してください。',
  invalid_state: '作業内容を保存できる形で確認できませんでした。',
  workspace_mismatch: '保存済みの作業内容が正式データと合わなくなりました。画面を再読み込みしてください。',
  version_conflict: '別の操作で作業内容が更新されました。画面を再読み込みしてください。',
  revision_changed: '他の利用者が計画を更新しました。画面を再読み込みしてから、もう一度お試しください。',
  draft_version_mismatch: '参照した草案の版が古くなりました。画面を再読み込みしてください。',
  upstream_unparseable: 'AIの出力を読み取れませんでした。もう一度お試しください。',
  confirmed_with_pending: '未判断の変更案が残っています。反映するか、保留・不採用を選んでください。',
  confirmed_with_undecided_candidate: '未判断の調整候補が残っています。採用・保留・不採用のいずれかを選んでください。',
  already_confirmed: 'この内容はすでに確定済みです。',
  confirm_rolled_back: '確定できませんでした。正式データは変更されていません（途中で元に戻しました）。',
  confirm_rollback_failed: '確定の途中で問題が起きました。正式データの状態を管理者が確認してください。',
  save_failed: '保存できませんでした。時間をおいて再度お試しください。',
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

function errorMessage(e: unknown): string {
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

/** 変更案のうち、利用者が文字として編集できる項目（文字列、または文字列の配列）。 */
function editableFields(proposed: AnyRecord): Array<{ key: string; lines: boolean }> {
  const out: Array<{ key: string; lines: boolean }> = [];
  for (const [key, value] of Object.entries(proposed)) {
    if (typeof value === 'string') out.push({ key, lines: false });
    else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) out.push({ key, lines: true });
  }
  return out;
}

export function StrategyBookPanel({
  departments,
  canEdit,
  getWriteGate,
  generateDepartment,
  renderSixQuestions,
  onConfirmed,
  onExportDepartment,
}: StrategyBookPanelProps) {
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const versionRef = useRef<number | null>(null);
  const [state, setState] = useState<WorkspaceState>(emptyWorkspaceState());
  const [companyStrategy, setCompanyStrategy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

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

  const load = async () => {
    const g = getWriteGate();
    if (!g.ok) {
      setNotice(g.reason);
      setLoaded(true);
      return;
    }
    try {
      const res = await authFetchJson<LoadResponse>(
        `/api/stage3/strategy-book?companyId=${encodeURIComponent(g.companyId)}&strategyId=${encodeURIComponent(g.strategyId)}`,
        { method: 'GET' },
      );
      versionRef.current = res.version;
      setVersion(res.version);
      setState(res.state);
      setCompanyStrategy(res.companyStrategy);
      setResults(Object.fromEntries(res.state.dialogue.map((d) => [dialogueKey(d.candidateId, d.topic), d.result])));
    } catch (e) {
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

  /* ② たたき台（初回）・⑤ 6問の反映後の再生成：既存の生成を部門ごとに実行し、結果を草案として保存する */
  const generate = async (kind: 'initial' | 'regenerated') => {
    if (!companyStrategy) {
      setNotice('全社戦略（STAGE2）の確定版がありません。STAGE2で確定してから進めてください。');
      return;
    }
    if (!gate()) return;
    setBusy(kind);
    setNotice('');
    try {
      const generated: Record<string, StrategyBookGenerateResult> = {};
      const failed: string[] = [];
      for (let i = 0; i < departments.length; i += 1) {
        const dept = departments[i];
        const result = await generateDepartment(i, kind === 'initial' ? 'draft' : 'regen');
        if (result) generated[departmentKeyOf(dept as unknown as AnyRecord)] = result;
        else failed.push(dept.name);
      }
      if (Object.keys(generated).length === 0) {
        setNotice('たたき台を作れませんでした。時間をおいて再度お試しください。');
        return;
      }
      const official = departments as unknown as AnyRecord[];
      const candidateProjects = Object.fromEntries(Object.entries(generated).map(([k, r]) => [k, r.projects]));
      const draft: StrategyDraft = {
        draftId: newDraftId(),
        kind,
        version: nextDraftVersion(state),
        createdAt: new Date().toISOString(),
        departments: draftDepartmentsFrom(official, candidateProjects),
        newProjects: newProjectCandidatesFrom(official, candidateProjects),
      };
      const proposals = Object.fromEntries(Object.entries(generated).map(([k, r]) => [k, r.proposals]));
      const next = reopen({
        ...state,
        drafts: [...state.drafts, draft].slice(-MAX_DRAFTS),
        analysis: null,
        candidateDecisions: {},
        dialogue: [],
        selections: selectionsFrom(official, proposals, state.selections),
        projectSelections: projectSelectionsFrom(official, draft.newProjects, state.projectSelections),
      });
      if (!(await save(next))) return;
      setNotice(
        failed.length > 0
          ? `${kind === 'initial' ? 'たたき台' : '再生成案'}を保存しました。作れなかった部門：${failed.join('・')}`
          : `${kind === 'initial' ? 'たたき台' : '再生成案'}を保存しました。未確定の案です。正式な部門戦略は変わっていません。`,
      );
      if (kind === 'regenerated') await analyze({ draftId: draft.draftId, version: draft.version }, next);
    } finally {
      setBusy(null);
    }
  };

  /* ④ 最新の計画案をAIが横断分析する */
  const analyze = async (draftRef: { draftId: string; version: number } | null, base: WorkspaceState = state) => {
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
      }
    } catch (e) {
      if (errorCode(e) === 'insufficient_departments') {
        await save(reopen({ ...base, analysis: null, candidateDecisions: {}, dialogue: [] }));
        setNotice('部門間調整の対象はありません（計画が2つ以上の部門にありません）。戦略書の作成は続けられます。');
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

  /* ⑤ 対話結果を反映して変更案を作り直す（未確定。正式データは変えない） */
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
      const saved = await save({
        ...withDialogue,
        selections: selectionsFrom(departments as unknown as AnyRecord[], proposals, withDialogue.selections),
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

  const decideProject = async (target: ProjectSelection, decision: ProjectSelection['decision']) => {
    await save(
      reopen({
        ...state,
        projectSelections: state.projectSelections.map((p) =>
          p.candidateId === target.candidateId ? { ...p, decision } : p,
        ),
      }),
    );
  };

  const decideSelection = async (target: Selection, decision: Selection['decision']) => {
    const key = selectionKey(target);
    await save(
      reopen({
        ...state,
        selections: state.selections.map((s) => (selectionKey(s) === key ? { ...s, decision } : s)),
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
    await save(
      reopen({
        ...state,
        selections: state.selections.map((s) => (selectionKey(s) === key ? { ...s, proposed } : s)),
      }),
    );
    setEditing((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${key} `))));
  };

  /* ⑥ 一括確定：全件検証は保存先（サーバー）で行う。途中で失敗しても正式データは変わらない */
  const confirm = async () => {
    const undecided = (state.analysis?.candidates ?? []).filter((c) => !state.candidateDecisions[c.id]).length;
    const pending = state.selections.filter((s) => s.decision === 'pending').length;
    if (pending > 0) {
      setNotice(`未判断の変更案が${pending}件あります。反映・保留・反映しないのいずれかを選んでください。`);
      return;
    }
    const pendingProjects = state.projectSelections.filter((p) => p.decision === 'pending').length;
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
      if (code === 'current_value_changed') {
        setNotice('反映予定の値が、案を作った後に変わっていました。正式データは変更していません。もう一度「再生成」から進めてください。');
      } else {
        setNotice(errorMessage(e));
      }
      if (code === 'revision_changed' || code === 'version_conflict') await load();
    } finally {
      setBusy(null);
    }
  };

  const latest = state.drafts.reduce<StrategyDraft | null>((best, d) => (!best || d.version > best.version ? d : best), null);
  const confirmed = state.status === 'confirmed';
  const decidedCount = (decision: Selection['decision']) => state.selections.filter((s) => s.decision === decision).length;
  const isBusy = busy !== null;
  const canOperate = canEdit && loaded && !isBusy;
  const analysis = state.analysis;

  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-6 md:p-8 space-y-8 text-slate-900">
      <header className="space-y-1 border-b pb-4">
        <h2 className="text-xl font-bold">事業・部門戦略書</h2>
        <p className="text-xs text-gray-600">
          作業中の内容は未確定です。確定するまで、正式な部門戦略・KPI・STAGE4〜6のデータは変わりません。
          {version !== null && <span className="ml-2 text-gray-500">作業版 {version}</span>}
        </p>
        {confirmed && state.confirmed && (
          <p className="text-xs text-emerald-800">
            確定済み（{new Date(state.confirmed.confirmedAt).toLocaleString('ja-JP')}・反映{state.confirmed.appliedCount}件）
          </p>
        )}
      </header>

      {notice && <p className="rounded-lg bg-gray-50 px-4 py-2 text-sm text-gray-800">{notice}</p>}

      {/* 1. 全社戦略 */}
      <section className="space-y-2">
        <h3 className="text-base font-semibold">1. 全社戦略（STAGE2の確定版）</h3>
        {companyStrategy ? (
          <p className="whitespace-pre-wrap rounded-lg bg-zinc-50 p-4 text-sm leading-6">{companyStrategy}</p>
        ) : (
          <p className="text-sm text-amber-800">全社戦略の確定版がありません。STAGE2で確定してから戦略書を作成してください。</p>
        )}
      </section>

      {/* 2. 初回のたたき台 */}
      <section className="space-y-3">
        <h3 className="text-base font-semibold">2. 事業・部門戦略のたたき台（初回）</h3>
        <p className="text-xs text-gray-600">AIが作ったたたき台は未確定の案として保存されます。読んでから、次の6問に進んでください。</p>
        <Button onClick={() => generate('initial')} disabled={!canOperate || !companyStrategy} className="rounded-full h-9 px-4">
          {busy === 'initial' ? '作成しています…' : 'たたき台を作る（全部門）'}
        </Button>
        {latest && <DraftView draft={latest} />}
      </section>

      {/* 3. 6問 */}
      <section className="space-y-3">
        <h3 className="text-base font-semibold">3. 既存の6問への回答（空欄でも可）</h3>
        <p className="text-xs text-gray-600">回答は部門ごとに保存されます。空欄のままでも再生成できます。</p>
        <div className="space-y-6">
          {departments.map((dept, i) => (
            <div key={`${dept.name}-${i}`} className="space-y-2">
              <div className="text-sm font-semibold">{dept.name}</div>
              {renderSixQuestions(i)}
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          onClick={() => generate('regenerated')}
          disabled={!canOperate || !companyStrategy || !latest}
          className="rounded-full h-9 px-4"
        >
          {busy === 'regenerated' ? '再生成しています…' : '6問を反映して再生成し、部門間の調整を分析する'}
        </Button>
      </section>

      {/* 4. 再生成版と部門間の調整候補 */}
      <section className="space-y-4">
        <h3 className="text-base font-semibold">4. 再生成版と部門間の調整候補</h3>
        {!analysis && <p className="text-sm text-gray-600">再生成すると、最新の計画案をもとに部門間の調整候補が表示されます。</p>}
        {analysis && analysis.candidates.length === 0 && (
          <p className="text-sm text-gray-600">部門間の調整候補は見つかりませんでした。</p>
        )}
        {analysis && analysis.candidates.length > 0 && (
          <div className="space-y-4">
            {analysis.candidates.map((c) => {
              const decision = state.candidateDecisions[c.id];
              return (
                <div key={c.id} className="rounded-xl border border-gray-200 p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                      {ADJUSTMENT_KIND_LABEL[c.kind]}
                    </span>
                    <span className="text-gray-600">対象：{c.departments.map((d) => d.name).join('・')}</span>
                    <span className="ml-auto font-semibold text-gray-700">
                      {decision ? `判断：${CANDIDATE_LABEL[decision]}` : '未判断'}
                    </span>
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

        {state.selections.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-700">
              部門戦略の変更案（既存の値と比べて、採否を選ぶ）— 未判断 {decidedCount('pending')}・反映 {decidedCount('applied')}・保留{' '}
              {decidedCount('deferred')}・反映しない {decidedCount('discarded')}
            </p>
            {state.selections.map((s) => {
              const meta = DEPT_PROPOSAL_ITEMS[s.item as DeptProposalItem];
              const key = selectionKey(s);
              const fields = editableFields(s.proposed);
              return (
                <div key={key} className="rounded-2xl border border-zinc-200 px-4 py-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">
                      {s.departmentName}：{meta.label}
                    </span>
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
                      <div className="text-[11px] font-semibold text-amber-800">AIの案（1行に1項目。編集できます）</div>
                      {fields.length === 0 && <div className="text-xs">（編集できない形式の案です）</div>}
                      {fields.map((f) => {
                        const value = s.proposed[f.key];
                        const initial = f.lines ? (value as string[]).join('\n') : String(value ?? '');
                        const edit = editing[`${key} ${f.key}`];
                        return (
                          <textarea
                            key={f.key}
                            value={edit ?? initial}
                            onChange={(e) => setEditing((prev) => ({ ...prev, [`${key} ${f.key}`]: e.target.value }))}
                            disabled={!canOperate}
                            rows={Math.min(6, Math.max(2, (f.lines ? (value as string[]).length : 1) + 1))}
                            className="w-full rounded-lg border border-amber-200 bg-white px-2 py-1 text-xs"
                          />
                        );
                      })}
                      {fields.length > 0 && Object.keys(editing).some((k) => k.startsWith(`${key} `)) && (
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
        )}
      </section>

      {/* 4b. 新規プロジェクトの採否（採用されたものだけ、確定時に正式な部門へ追加される） */}
      {state.projectSelections.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-base font-semibold">新規プロジェクトの採否</h3>
          <p className="text-xs text-gray-600">
            再生成で出た新しいプロジェクトです。採用したものだけ、確定時に正式な部門戦略へ追加されます。未採用の案は正式データに入りません。
          </p>
          {state.projectSelections.map((p) => {
            const summary = projectSummaryOf(state, p.candidateId);
            return (
              <div key={p.candidateId} className="rounded-2xl border border-zinc-200 px-4 py-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">
                    {p.departmentName}：{p.title}
                  </span>
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
        </section>
      )}

      {/* 5. 確定 */}
      <section className="space-y-3 border-t pt-6">
        <h3 className="text-base font-semibold">5. 確定</h3>
        <p className="text-xs text-gray-600">
          「反映する」と選んだ変更案だけを、すべて一度に正式データへ反映します。1件でも反映できなければ、正式データは何も変わりません。
        </p>
        <Button onClick={confirm} disabled={!canOperate || !companyStrategy || state.drafts.length === 0} className="rounded-full h-9 px-4">
          {busy === 'confirm' ? '確定しています…' : confirmed ? '再確定する' : 'この内容で確定する'}
        </Button>
        {!canEdit && <p className="text-xs text-gray-600">確定・反映は管理者・管理職のみ行えます。</p>}
      </section>

      {/* 6. PDF */}
      <section className="space-y-3 border-t pt-6">
        <h3 className="text-base font-semibold">6. 確定版の戦略書（部門別PDF）</h3>
        {confirmed ? (
          <div className="flex flex-wrap gap-2">
            {departments.map((dept) => (
              <Button
                key={dept.name}
                variant="outline"
                onClick={() => onExportDepartment(dept.name)}
                disabled={isBusy}
                className="rounded-full h-8 px-3"
              >
                {dept.name}のPDF
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-600">確定すると、部門ごとにPDFを出力できます。</p>
        )}
      </section>
    </article>
  );
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

function DraftView({ draft }: { draft: StrategyDraft }) {
  return (
    <div className="space-y-2 rounded-lg bg-zinc-50 p-4">
      <p className="text-xs text-gray-600">
        版 {draft.version}（{draft.kind === 'initial' ? '初回のたたき台' : '6問を反映した再生成案'}・未確定）
      </p>
      {draft.departments.map((d) => (
        <div key={`${d.name}`} className="text-sm">
          <div className="font-semibold">{d.name}</div>
          <ul className="list-disc pl-5 text-xs">
            {d.projects.map((p, i) => (
              <li key={`${p.title}-${i}`}>{p.title}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
