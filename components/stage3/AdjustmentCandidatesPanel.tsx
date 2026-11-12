'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { authFetchJson, AuthFetchError } from '@/utils/authFetch';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { ADJUSTMENT_KIND_LABEL, type AdjustmentCandidate, type DialogueResult } from '@/lib/cascade/stage3Adjustment';
import {
  DEPT_PROPOSAL_ITEMS,
  displayProposalValue,
  type DeptProposal,
  type DeptProposalItem,
} from '@/lib/cascade/stage3Candidates';
import { emptyWorkspaceState, type WorkspaceState } from '@/lib/cascade/stage3StrategyBook';

type Selection = WorkspaceState['selections'][number];

type LoadResponse = { ok: true; version: number; state: WorkspaceState; revision: number };
type SaveResponse = { ok: true; version: number };
type AnalyzeResponse = {
  ok: true;
  sourceDraft: { draftId: string; version: number } | null;
  candidates: AdjustmentCandidate[];
  rejectedCandidates: number;
  rejectedReferences: number;
};
type RegenerateResponse = {
  ok: true;
  departments: Array<{ departmentKey: string; departmentName: string; proposals: DeptProposal[] }>;
  rejectedDepartments: number;
};

export type AdjustmentApplyArgs = {
  departmentName: string;
  item: DeptProposalItem;
  proposed: Record<string, unknown>;
  base: Record<string, unknown>;
};

interface AdjustmentCandidatesPanelProps {
  canApply: boolean;
  onApply: (args: AdjustmentApplyArgs) => Promise<boolean>;
  departmentNames: string[];
  onExportDepartment: (departmentName: string) => Promise<void>;
}

const ERROR_MESSAGE: Record<string, string> = {
  unauthorized: '認証できませんでした。再ログインしてください。',
  forbidden: '対象の会社・戦略を利用する権限がありません。',
  strategy_mismatch: '対象の戦略を確認できませんでした。画面を再読み込みしてください。',
  stage2_not_confirmed: '全社戦略（STAGE2）の確定版がありません。STAGE2で確定してから分析してください。',
  unverifiable_departments: '部門データを確認できませんでした。',
  insufficient_departments: '行動計画が2つ以上の部門にあると、部門間の調整候補を分析できます。',
  invalid_candidates: '調整候補が古くなっています。分析し直してください。',
  invalid_dialogue: '話し合いの結果の内容を確認してください。',
  invalid_state: '作業内容を保存できる形で確認できませんでした。',
  workspace_mismatch: '保存済みの作業内容が正式データと合わなくなりました。画面を再読み込みしてください。',
  version_conflict: '別の操作で作業内容が更新されました。画面を再読み込みしてください。',
  draft_version_mismatch: '参照した草案の版が古くなりました。画面を再読み込みしてください。',
  insufficient_role: '確定は管理者・管理職のみ行えます。',
  upstream_unparseable: 'AIの出力を読み取れませんでした。もう一度お試しください。',
};

const DEFAULT_ERROR = '処理に失敗しました。時間をおいて再度お試しください。';

function errorMessage(e: unknown): string {
  if (e instanceof AuthFetchError) {
    try {
      const code = JSON.parse(e.bodyText ?? '')?.error;
      if (typeof code === 'string' && ERROR_MESSAGE[code]) return ERROR_MESSAGE[code];
    } catch {
      return DEFAULT_ERROR;
    }
  }
  return DEFAULT_ERROR;
}

const dialogueKey = (candidateId: string, topic: string) => `${candidateId} ${topic}`;

function currentIds(): { companyId: string; strategyId: string } | null {
  const companyId = useUserStore.getState().companyId;
  const strategyId = (useStrategyStore.getState() as unknown as { strategyId?: string | null }).strategyId;
  if (!companyId || !strategyId) return null;
  return { companyId, strategyId };
}

const reopen = (state: WorkspaceState): WorkspaceState => ({ ...state, status: 'draft', confirmed: null });

const STEPS: Array<{ title: string; status: string }> = [
  { title: '全社戦略（STAGE2の確定版）を読む', status: '分析のときに確認します' },
  { title: '初回のたたき台を作る', status: 'この画面からは未接続（部門画面の生成を利用）' },
  { title: '既存の6問に回答する', status: '各部門の6問（既存の入力）を使います' },
  { title: '6問を反映して再生成し、部門間の調整候補を見る', status: '調整候補の分析は可能。6問後の再生成案は未接続' },
  { title: '再生成版を編集し、対話結果を反映して確定する', status: 'この画面で確認・反映・確定できます' },
  { title: '事業・部門ごとに確定版をPDF出力する', status: '未接続' },
];

export function AdjustmentCandidatesPanel({
  canApply,
  onApply,
  departmentNames,
  onExportDepartment,
}: AdjustmentCandidatesPanelProps) {
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const versionRef = useRef<number | null>(null);
  const [state, setState] = useState<WorkspaceState>(emptyWorkspaceState());
  const [results, setResults] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void load();
    // 初回だけ読む。以後の状態は操作ごとに保存して持つ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    const ids = currentIds();
    if (!ids) {
      setNotice('会社・戦略を確認できません。画面を再読み込みしてください。');
      setLoaded(true);
      return;
    }
    try {
      const res = await authFetchJson<LoadResponse>(
        `/api/stage3/strategy-book?companyId=${encodeURIComponent(ids.companyId)}&strategyId=${encodeURIComponent(ids.strategyId)}`,
        { method: 'GET' },
      );
      versionRef.current = res.version;
      setVersion(res.version);
      setState(res.state);
      setResults(Object.fromEntries(res.state.dialogue.map((d) => [dialogueKey(d.candidateId, d.topic), d.result])));
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setLoaded(true);
    }
  };

  const save = async (next: WorkspaceState): Promise<boolean> => {
    const ids = currentIds();
    const expected = versionRef.current;
    if (!ids || expected === null) {
      setNotice('作業内容を保存できません。画面を再読み込みしてください。');
      return false;
    }
    try {
      const res = await authFetchJson<SaveResponse>('/api/stage3/strategy-book', {
        method: 'PUT',
        json: { ...ids, expectedVersion: expected, state: next },
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

  const analyze = async () => {
    const ids = currentIds();
    if (!ids) return;
    setBusy('analyze');
    setNotice('');
    try {
      const res = await authFetchJson<AnalyzeResponse>('/api/stage3/adjustment/analyze', {
        method: 'POST',
        json: ids,
      });
      const next = reopen({
        ...state,
        analysis: {
          draftId: res.sourceDraft?.draftId ?? null,
          draftVersion: res.sourceDraft?.version ?? null,
          createdAt: new Date().toISOString(),
          candidates: res.candidates,
          rejectedCandidates: res.rejectedCandidates,
          rejectedReferences: res.rejectedReferences,
        },
        dialogue: [],
        selections: state.selections.filter((s) => s.decision !== 'pending'),
      });
      if (await save(next)) {
        setResults({});
        const rejected =
          res.rejectedCandidates + res.rejectedReferences > 0
            ? `保存済みにない部門・計画IDを含んだため、${res.rejectedCandidates}件の候補と${res.rejectedReferences}件の参照を採用しませんでした。`
            : '';
        setNotice(
          [
            res.candidates.length === 0
              ? '部門間の調整候補は見つかりませんでした。'
              : `調整候補を${res.candidates.length}件表示しました。採用するかどうかはご判断ください。`,
            rejected,
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
    const filled = filledDialogue();
    if (filled.length === 0) {
      setNotice('話し合いの結果を入力してから保存してください。');
      return;
    }
    setBusy('dialogue');
    await save(reopen({ ...state, dialogue: filled }));
    setBusy(null);
    setNotice('話し合いの結果を保存しました。');
  };

  const regenerate = async () => {
    const analysis = state.analysis;
    const ids = currentIds();
    if (!ids || !analysis || analysis.candidates.length === 0) return;
    const filled = filledDialogue();
    if (filled.length === 0) {
      setNotice('話し合いの結果を1件以上入力してから再生成してください。');
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
          ...ids,
          draft: analysis.draftId && analysis.draftVersion ? { draftId: analysis.draftId, version: analysis.draftVersion } : null,
          candidates: analysis.candidates,
          dialogue: filled,
        },
      });
      const pending: Selection[] = res.departments.flatMap((d) =>
        d.proposals.map((p) => ({
          departmentKey: d.departmentKey,
          departmentName: d.departmentName,
          item: p.item,
          proposed: p.proposed,
          base: p.base,
          decision: 'pending' as const,
        })),
      );
      const kept = withDialogue.selections.filter((s) => s.decision !== 'pending');
      const saved = await save({ ...withDialogue, selections: [...kept, ...pending] });
      if (saved) {
        setNotice(
          [
            pending.length === 0
              ? '話し合いの結果を反映すると変わる項目はありませんでした。'
              : `部門の変更案を${pending.length}件作りました。反映する項目だけ選んでください。案はまだ正式データに入っていません。`,
            res.rejectedDepartments > 0
              ? `保存済みにない部門IDを含んだため、${res.rejectedDepartments}件を採用しませんでした。`
              : '',
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

  const decide = async (target: Selection, decision: 'applied' | 'discarded') => {
    setBusy('decide');
    try {
      if (decision === 'applied') {
        const ok = await onApply({
          departmentName: target.departmentName,
          item: target.item as DeptProposalItem,
          proposed: target.proposed,
          base: target.base,
        });
        if (!ok) return;
      }
      const same = (s: Selection) =>
        s.departmentKey === target.departmentKey && s.item === target.item && s.decision === 'pending';
      await save(reopen({ ...state, selections: state.selections.map((s) => (same(s) ? { ...s, decision } : s)) }));
    } finally {
      setBusy(null);
    }
  };

  const confirm = async () => {
    const pending = state.selections.filter((s) => s.decision === 'pending').length;
    if (pending > 0) {
      setNotice(`未判断の変更案が${pending}件あります。反映するかしないかを選んでから確定してください。`);
      return;
    }
    setBusy('confirm');
    const appliedCount = state.selections.filter((s) => s.decision === 'applied').length;
    const saved = await save({
      ...state,
      status: 'confirmed',
      confirmed: { confirmedAt: new Date().toISOString(), appliedCount },
    });
    setBusy(null);
    if (saved) setNotice('確定しました。確定した内容は正式データに反映済みです（反映したもののみ）。');
  };

  const exportDepartment = async (name: string) => {
    setBusy('pdf');
    try {
      await onExportDepartment(name);
    } catch {
      setNotice(`${name}のPDFを出力できませんでした。時間をおいて再度お試しください。`);
    } finally {
      setBusy(null);
    }
  };

  const pendingSelections = state.selections.filter((s) => s.decision === 'pending');
  const decidedSelections = state.selections.filter((s) => s.decision !== 'pending');
  const analysis = state.analysis;
  const isBusy = busy !== null;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6 space-y-5">
      <div>
        <h3 className="text-base font-semibold text-slate-950">事業・部門戦略書：部門間の調整</h3>
        <p className="mt-1 text-xs text-gray-600">
          保存されるのは作業中の内容だけです。反映・確定まで、STAGE4〜6の正式データは変わりません。
        </p>
      </div>

      <ol className="space-y-1 text-xs text-gray-700">
        {STEPS.map((step, i) => (
          <li key={step.title}>
            {i + 1}. {step.title}
            <span className="ml-2 text-gray-500">（{step.status}）</span>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={analyze} disabled={isBusy || !loaded} className="rounded-full h-9 px-4">
          {busy === 'analyze' ? '分析しています…' : analysis ? '最新の計画案をもう一度分析する' : '最新の計画案を分析する'}
        </Button>
        {version !== null && <span className="text-xs text-gray-500">作業版 {version}</span>}
      </div>

      {notice && <p className="text-sm text-gray-700">{notice}</p>}

      {analysis && analysis.candidates.length > 0 && (
        <div className="space-y-4">
          {analysis.candidates.map((c) => (
            <div key={c.id} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                  {ADJUSTMENT_KIND_LABEL[c.kind]}
                </span>
                <span className="text-xs text-gray-600">対象：{c.departments.map((d) => d.name).join('・')}</span>
              </div>
              <p className="font-semibold text-slate-950">{c.title}</p>
              <p className="text-sm text-gray-700">{c.summary}</p>
              <ul className="list-disc pl-5 text-xs text-gray-700">
                {c.planRefs.map((r) => (
                  <li key={`${r.departmentKey}-${r.projectId}`}>
                    {r.departmentName}：{r.projectTitle}
                  </li>
                ))}
              </ul>
              <div className="space-y-3">
                {c.dialogueTopics.map((topic) => {
                  const key = dialogueKey(c.id, topic);
                  return (
                    <div key={key} className="space-y-1">
                      <label className="text-sm text-slate-900">{topic}</label>
                      <textarea
                        value={results[key] ?? ''}
                        onChange={(e) => setResults((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder="話し合いの結果を入力（空欄のままでも構いません）"
                        rows={2}
                        maxLength={1000}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={saveDialogue} disabled={isBusy} className="rounded-full h-9 px-4">
              対話結果を保存
            </Button>
            <Button onClick={regenerate} disabled={isBusy || !canApply} className="rounded-full h-9 px-4">
              {busy === 'regenerate' ? '再生成しています…' : '対話結果を反映して再生成'}
            </Button>
            {!canApply && <span className="self-center text-xs text-gray-600">反映・再生成は管理者・管理職のみ行えます。</span>}
          </div>
        </div>
      )}

      {pendingSelections.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-700">部門戦略の変更案（既存の値と比べて、反映する項目だけ選ぶ）</p>
          {pendingSelections.map((s) => {
            const meta = DEPT_PROPOSAL_ITEMS[s.item as DeptProposalItem];
            return (
              <div key={`${s.departmentKey}-${s.item}`} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
                <div className="text-sm font-semibold text-zinc-900">
                  {s.departmentName}：{meta.label}
                </div>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl bg-zinc-50 px-3 py-2">
                    <div className="text-[11px] font-semibold text-zinc-600">現在の値</div>
                    <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-zinc-800">
                      {displayProposalValue(s.item as DeptProposalItem, s.base) || '（未設定）'}
                    </div>
                  </div>
                  <div className="rounded-xl bg-amber-50 px-3 py-2">
                    <div className="text-[11px] font-semibold text-amber-800">AIの案</div>
                    <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-zinc-800">
                      {displayProposalValue(s.item as DeptProposalItem, s.proposed) || '（なし）'}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => decide(s, 'applied')}
                    disabled={isBusy || !canApply}
                    className="rounded-full h-8 px-3"
                  >
                    この変更を反映する
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => decide(s, 'discarded')}
                    disabled={isBusy}
                    className="rounded-full h-8 px-3"
                  >
                    反映しない
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {decidedSelections.length > 0 && (
        <p className="text-xs text-gray-600">
          判断済み：反映 {decidedSelections.filter((s) => s.decision === 'applied').length}件・反映しない{' '}
          {decidedSelections.filter((s) => s.decision === 'discarded').length}件
        </p>
      )}

      {analysis && (
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button onClick={confirm} disabled={isBusy || !canApply || state.status === 'confirmed'} className="rounded-full h-9 px-4">
            {state.status === 'confirmed' ? '確定済み' : 'この内容で確定する'}
          </Button>
          {state.status === 'confirmed' && state.confirmed && (
            <span className="text-xs text-gray-600">
              確定日時 {new Date(state.confirmed.confirmedAt).toLocaleString('ja-JP')}（反映 {state.confirmed.appliedCount}件）
            </span>
          )}
        </div>
      )}

      {state.status === 'confirmed' && departmentNames.length > 0 && (
        <div className="space-y-2 border-t pt-4">
          <p className="text-xs font-semibold text-gray-700">確定版を部門別にPDF出力</p>
          <div className="flex flex-wrap gap-2">
            {departmentNames.map((name) => (
              <Button
                key={name}
                variant="outline"
                onClick={() => exportDepartment(name)}
                disabled={isBusy}
                className="rounded-full h-8 px-3"
              >
                {name}のPDF
              </Button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
