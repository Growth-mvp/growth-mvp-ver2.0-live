// components/guide/QuestionStepper.dept.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccess } from '@/utils/access'; // ★ 編集ガード

export type StepNumber = 1 | 2 | 3 | 4 | 5 | 6;

export type DeptAnswerStep = {
  stepNumber: StepNumber;
  label?: string;
  question: string;
  reason: string;
  hint?: string;
  answer: string;
  createdAt: string;
};

export type OKR = { objective?: string; keyResults?: string[]; owner?: string };

export type DeptQuestionStepperProps = {
  departmentName: string;
  // 事前たたき台（任意）
  mission?: string;
  projects?: string[];
  okrs?: OKR[];
  /** 会社の業種コード/ラベル（APIへ文脈として渡す） */
  industry?: string;

  /** Ver4 summary（任意：渡せば問いの精度が上がる） */
  direction?: string;
  expectations?: string[];
  focusThemes?: string[];

  /** 初期ステップ（省略時は1） */
  initialStep?: StepNumber;
  /** 復元用：既存のQ/A */
  initialAnswers?: DeptAnswerStep[];
  /** 親へ：Q/Aの変化通知 */
  onChange?: (p: { answers: DeptAnswerStep[]; currentStep: StepNumber }) => void;
  /** 親へ：生成したドラフト（mission/projects/okrs）通知（任意） */
  onDraftGenerated?: (p: { mission?: string; projects?: string[]; okrs?: OKR[] }) => void;
};

function clampStep(n: number): StepNumber {
  return Math.max(1, Math.min(6, Math.round(n))) as StepNumber;
}

function answersEqual(a?: DeptAnswerStep[], b?: DeptAnswerStep[]) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (
      x.stepNumber !== y.stepNumber ||
      (x.label ?? '') !== (y.label ?? '') ||
      (x.question ?? '') !== (y.question ?? '') ||
      (x.reason ?? '') !== (y.reason ?? '') ||
      (x.hint ?? '') !== (y.hint ?? '') ||
      (x.answer ?? '') !== (y.answer ?? '')
    ) return false;
  }
  return true;
}

export default function DepartmentQuestionStepper(props: DeptQuestionStepperProps) {
  const {
    departmentName,
    mission,
    projects = [],
    okrs = [],
    industry = '',

    // Ver4 summary
    direction,
    expectations = [],
    focusThemes = [],

    initialStep = 1,
    initialAnswers = [],
    onChange,
    onDraftGenerated,
  } = props;

  // ★ 閲覧はOK、編集は会社レベルAdminのみ
  const { canEditCompany } = useAccess();
  const canEdit = canEditCompany();

  const [step, setStep] = useState<StepNumber>(clampStep(initialStep));
  const [answers, setAnswers] = useState<DeptAnswerStep[]>(
    (initialAnswers ?? [])
      .filter(a => a && a.stepNumber && a.question != null)
      .sort((a, b) => a.stepNumber - b.stepNumber) as DeptAnswerStep[]
  );
  const [label, setLabel] = useState<string | undefined>(undefined);
  const [question, setQuestion] = useState('');
  const [reason, setReason] = useState('');
  const [hint, setHint] = useState<string | undefined>(undefined);
  const [showHint, setShowHint] = useState(false);
  const [answerText, setAnswerText] = useState('');

  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // 生成（ドラフト）
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState('');
  const [missionDraft, setMissionDraft] = useState<string | undefined>(undefined);
  const [projectsDraft, setProjectsDraft] = useState<string[] | undefined>(undefined);
  const [okrsDraft, setOkrsDraft] = useState<OKR[] | undefined>(undefined);

  // リクエスト多重防止
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // 再生成トリガ
  const [reloadTick, setReloadTick] = useState(0);

  // 親通知のガード
  const isFirstMountRef = useRef(true);
  const lastNotifiedRef = useRef<DeptAnswerStep[] | null>(null);
  const lastStepNotifiedRef = useRef<StepNumber | null>(null);

  // 直前の回答
  const previousAnswer = useMemo(() => {
    const prev = answers.find(a => a.stepNumber === (step - 1));
    return prev?.answer || '';
  }, [answers, step]);

  const answersSoFarPayload = useMemo(
    () => answers.map(a => ({ stepNumber: a.stepNumber, answer: a.answer })),
    [answers]
  );

  const isCompletedAll6 = useMemo(() => {
    const has = (n: StepNumber) => answers.some(a => a.stepNumber === n && a.answer?.trim());
    return has(1) && has(2) && has(3) && has(4) && has(5) && has(6);
  }, [answers]);

  /* =========================================
   * 追加１：props → state 同期
   *  - 戻ってきた時に initialAnswers / initialStep が更新されたら反映
   * ========================================= */
  // initialAnswers が変わったら取り込み（同値なら何もしない）
  useEffect(() => {
    const next = (initialAnswers ?? [])
      .filter(a => a && a.stepNumber && a.question != null)
      .sort((a, b) => a.stepNumber - b.stepNumber) as DeptAnswerStep[];
    if (!answersEqual(answers, next)) {
      setAnswers(next);
      // 現ステップのUIフィールドも同期
      const exist = next.find(a => a.stepNumber === step);
      if (exist) {
        setLabel(exist.label);
        setQuestion(exist.question);
        setReason(exist.reason);
        setHint(exist.hint);
        setAnswerText(exist.answer ?? '');
        setShowHint(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initialAnswers)]);

  // initialStep が変わったら反映（親が明示的にステップ指示する場合）
  useEffect(() => {
    setStep(clampStep(initialStep));
  }, [initialStep]);

  /* =========================================
   * 問いの取得（★ 非Adminは新規生成しない：既存あれば表示のみ）
   * ========================================= */
  useEffect(() => {
    const existing = answers.find(a => a.stepNumber === step);
    if (existing) {
      setLabel(existing.label);
      setQuestion(existing.question);
      setReason(existing.reason);
      setHint(existing.hint);
      setAnswerText(existing.answer ?? '');
      setShowHint(false);
      return;
    }

    if (!canEdit) {
      // 閲覧モード：新規生成は行わない
      setLabel(undefined);
      setQuestion('');
      setReason('');
      setHint(undefined);
      setAnswerText('');
      setLoading(false);
      setShowHint(false);
      return;
    }

    if (inFlightRef.current) return; // 二重抑止

    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      setLoading(true);
      setErrorMsg('');
      inFlightRef.current = true;
      try {
        const res = await fetch('/api/generate-department-question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
          body: JSON.stringify({
            departmentName,
            mission,
            projects,
            okrs,
            industry,
            // Ver4 summary を渡す（問いのブレ抑制）
            direction,
            expectations,
            focusThemes,
            answersSoFar: answersSoFarPayload,
            afterStepIndex: step - 2, // 現在stepの1つ前（初回は -1）
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const msg = data?.error || `Failed to fetch question (${res.status})`;
          throw new Error(msg);
        }
        const data = await res.json();
        const g = data?.step;
        const q = (g?.question ?? '').trim();
        const r = (g?.reason ?? '').trim();
        if (!q || !r) throw new Error('Invalid response');

        setLabel((g?.label ?? '').trim() || undefined);
        setQuestion(q);
        setReason(r);
        setHint(((g?.hint ?? '') as string).trim() || undefined);
        setShowHint(false);
      } catch (e: any) {
        if (e?.name !== 'AbortError') {
          setErrorMsg(e?.message || 'エラーが発生しました');
        }
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
    })();

    return () => {
      controller.abort();
      inFlightRef.current = false;
    };
    // 依存
  }, [
    step,
    departmentName,
    mission,
    projects,
    okrs,
    industry,
    direction,
    expectations?.length,
    focusThemes?.length,
    answersSoFarPayload.length,
    reloadTick,
    answers,
    canEdit,
  ]);

  /* =========================================
   * 親へ進捗通知
   *  - 初回マウントはスキップ
   *  - 同値/同ステップはスキップ
   *  - 非Adminは通知しない
   * ========================================= */
  useEffect(() => {
    if (!onChange || !canEdit) return;
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      lastNotifiedRef.current = answers;
      lastStepNotifiedRef.current = step;
      return;
    }
    const last = lastNotifiedRef.current ?? [];
    if (answersEqual(last, answers) && lastStepNotifiedRef.current === step) return;
    lastNotifiedRef.current = answers;
    lastStepNotifiedRef.current = step;
    onChange({ answers, currentStep: step });
  }, [answers, step, onChange, canEdit]);

  /* =========================================
   * 追加２：アンマウント直前にフラッシュ通知
   *  - デバウンス待たず、最後の state を親へ渡す
   * ========================================= */
  useEffect(() => {
    return () => {
      if (!onChange || !canEdit) return;
      try {
        onChange({ answers, currentStep: step });
      } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange, canEdit]); // answers/step はクリーンアップ時点のクロージャで十分

  const handleSaveAnswerLocally = useCallback(() => {
    if (!canEdit) return;
    const trimmed = (answerText || '').trim();
    const existingIndex = answers.findIndex(a => a.stepNumber === step);
    const payload: DeptAnswerStep = {
      stepNumber: step,
      label,
      question,
      reason,
      hint,
      answer: trimmed,
      createdAt: existingIndex >= 0 ? answers[existingIndex].createdAt : new Date().toISOString(),
    };

    const next = [...answers];
    if (existingIndex >= 0) next[existingIndex] = payload;
    else next.push(payload);
    next.sort((a, b) => a.stepNumber - b.stepNumber);
    setAnswers(next);

    // ★ 追加３：即時で親にも反映（setState待ちによる取りこぼし防止）
    if (onChange) {
      try { onChange({ answers: next, currentStep: step }); } catch {}
    }
  }, [answers, step, label, question, reason, hint, answerText, canEdit, onChange]);

  const canGoNext = (answerText || '').trim().length > 0 && canEdit;
  const isLastStep = step === 6;

  const onClickNext = useCallback(() => {
    if (!canGoNext) return;
    handleSaveAnswerLocally();
    if (!isLastStep) {
      setStep(s => clampStep(s + 1));
      setAnswerText('');
      setShowHint(false);
    }
  }, [canGoNext, isLastStep, handleSaveAnswerLocally]);

  // このステップからやり直す（質問の再生成）
  const onRedoFromHere = useCallback(() => {
    if (!canEdit) return;
    const kept = answers.filter(a => a.stepNumber < step);
    setAnswers(kept);
    setAnswerText('');
    setLabel(undefined);
    setQuestion('');
    setReason('');
    setHint(undefined);
    setShowHint(false);
    setErrorMsg('');
    setReloadTick(t => t + 1); // useEffectを起動
    // 生成結果は一旦リセット（再考のため）
    setMissionDraft(undefined);
    setProjectsDraft(undefined);
    setOkrsDraft(undefined);
    setGenError('');
  }, [answers, step, canEdit]);

  // ---- 部門ミッション生成 ----（★ 非Adminは実行不可／6問完了後）
  const handleGenerateDepartmentDraft = useCallback(async () => {
    if (!isCompletedAll6 || !canEdit) return;
    setGenLoading(true);
    setGenError('');
    try {
      const res = await fetch('/api/generate-department-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          departmentName,
          mission,
          projects,
          okrs,
          // 参照用に回答を渡す（6問）
          answers: answers
            .sort((a, b) => a.stepNumber - b.stepNumber)
            .map(a => ({
              stepNumber: a.stepNumber,
              label: a.label,
              question: a.question,
              answer: a.answer,
            })),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `部門ミッション生成に失敗しました（${res.status}）`);
      }

      const nextMission: string | undefined = (data?.mission ?? '').trim() || undefined;
      const nextProjects: string[] | undefined = Array.isArray(data?.projects) ? data.projects : undefined;
      const nextOkrs: OKR[] | undefined = Array.isArray(data?.okrs) ? data.okrs : undefined;

      setMissionDraft(nextMission);
      setProjectsDraft(nextProjects);
      setOkrsDraft(nextOkrs);

      onDraftGenerated?.({
        mission: nextMission,
        projects: nextProjects,
        okrs: nextOkrs,
      });
    } catch (e: any) {
      setGenError(e?.message || '部門ミッション生成でエラーが発生しました');
    } finally {
      setGenLoading(false);
    }
  }, [answers, departmentName, mission, projects, okrs, isCompletedAll6, onDraftGenerated, canEdit]);

  const disabledTip = canEdit ? '' : '閲覧モード（管理者のみ編集可）';

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* Ver4 summary（任意表示） */}
      {(direction || expectations.length || focusThemes.length) && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60">
          <div className="p-3 border-b border-amber-100 text-sm font-semibold text-amber-900">
            AIたたき台（方向性）
          </div>
          <div className="p-3 space-y-2 text-sm text-amber-900">
            {direction && <div><span className="font-medium">方向性：</span>{direction}</div>}
            {expectations.length > 0 && (
              <div>
                <div className="font-medium">経営からの期待：</div>
                <ul className="list-disc pl-5">
                  {expectations.slice(0,4).map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              </div>
            )}
            {focusThemes.length > 0 && (
              <div>
                <div className="font-medium">注力テーマ：</div>
                <ul className="list-disc pl-5">
                  {focusThemes.slice(0,4).map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ステップインジケータ */}
      <div className="grid grid-cols-6 gap-2">
        {[1, 2, 3, 4, 5, 6].map(n => {
          const sn = n as StepNumber;
          const done = answers.some(a => a.stepNumber === sn && a.answer?.trim());
          const active = step === sn;
          return (
            <button
              key={sn}
              onClick={() => setStep(sn)}
              className={[
                'rounded-xl border px-3 py-2 text-xs transition-colors',
                active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50',
              ].join(' ')}
              title={`Step ${sn}`}
            >
              Step {sn}{done && <span className="ml-1 text-green-600">✓</span>}
            </button>
          );
        })}
      </div>

      {/* 質問カード */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="text-sm font-medium">
            {label ? `ステップ：${label}` : '次の問い'}
          </div>
          <div className="flex items-center gap-3">
            {hint && (
              <button
                type="button"
                onClick={() => setShowHint(v => !v)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium border bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              >
                💡 ヒントを見る
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={onRedoFromHere}
                disabled={loading}
                className={[
                  'rounded-lg px-3 py-1.5 text-xs font-medium border',
                  loading ? 'bg-gray-100 text-gray-400 border-gray-200' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                ].join(' ')}
                title="このステップの問いを再生成します（このステップ以降の回答はリセット）"
              >
                再生成
              </button>
            )}
            {loading && <div className="text-xs text-gray-500">生成中…</div>}
          </div>
        </div>
        <div className="p-4 space-y-3">
          {errorMsg ? (
            <div className="text-sm text-red-600">{errorMsg}</div>
          ) : (
            <>
              <p className="text-base leading-relaxed">
                {question || (canEdit ? '...' : '（閲覧モード：新しい問いの生成は無効です）')}
              </p>
              {reason && <p className="text-sm text-gray-500">狙い：{reason}</p>}
              {showHint && hint && (
                <div className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg p-3">
                  {hint}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 回答欄 */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">あなたの回答</label>
        <textarea
          className="w-full min-h-[140px] rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 p-3 disabled:bg-gray-50"
          placeholder="考えを具体的に書いてください。数値や期限、役割、連携相手などを明記すると次の問いが鋭くなります。"
          value={answerText}
          onChange={(e) => setAnswerText(e.target.value)}
          disabled={!canEdit}
          title={canEdit ? '' : '閲覧モード（管理者のみ編集可）'}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {previousAnswer ? '直前の回答を踏まえて出題されています。' : '最初の問いです。'}
          </span>
          <button
            type="button"
            onClick={onClickNext}
            disabled={!(answerText || '').trim() || loading || !canEdit}
            className={[
              'rounded-xl px-4 py-2 text-sm font-medium',
              (!(answerText || '').trim() || loading || !canEdit)
                ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            ].join(' ')}
            title={canEdit ? (isLastStep ? '回答を保存して完了にします' : '次の問いへ') : '閲覧モード（管理者のみ編集可）'}
          >
            {isLastStep ? '回答を保存' : '次の問いへ'}
          </button>
        </div>
      </div>

      {/* 既出Q/Aの簡易ログ */}
      <div className="rounded-2xl border border-gray-200 bg-white">
        <div className="p-3 border-b border-gray-100 text-sm font-medium">これまでのQ/A（この部門）</div>
        <div className="divide-y">
          {answers.length === 0 && (
            <div className="p-3 text-sm text-gray-500">まだありません</div>
          )}
          {answers.map((a) => (
            <div key={a.stepNumber} className="p-3 text-sm space-y-1">
              <div className="text-gray-500">Step {a.stepNumber}{a.label ? `（${a.label}）` : ''}</div>
              <div className="font-medium">Q: {a.question}</div>
              <div className="text-gray-700 whitespace-pre-wrap">A: {a.answer || '（未入力）'}</div>
            </div>
          ))}
        </div>
      </div>

      {/* === 6問完了後：部門ミッション生成 === */}
      {isCompletedAll6 && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50/60">
          <div className="p-4 border-b border-blue-100 flex items-center justify-between">
            <div className="text-sm font-medium text-blue-900">部門ミッション生成</div>
            {genLoading && <div className="text-xs text-blue-700">生成中…</div>}
          </div>
          <div className="p-4 space-y-3">
            <p className="text-sm text-blue-900">
              6つの回答をもとに、この部門の「ミッション（仮）」「プロジェクト案」「OKR（初期案）」を生成します。
            </p>
            {genError && <div className="text-sm text-red-600">{genError}</div>}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleGenerateDepartmentDraft}
                disabled={genLoading || !canEdit}
                className={[
                  'rounded-xl px-4 py-2 text-sm font十分',
                  (genLoading || !canEdit) ? 'bg-gray-300 text-gray-600 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'
                ].join(' ')}
                title={canEdit ? '' : '閲覧モード（管理者のみ編集可）'}
              >
                部門ミッションを生成
              </button>
              <span className="text-xs text-blue-900">
                生成後は、親画面で保存・編集できます
              </span>
            </div>

            {(missionDraft || (projectsDraft?.length ?? 0) > 0 || (okrsDraft?.length ?? 0) > 0) && (
              <div className="mt-3 space-y-3">
                {missionDraft && (
                  <div className="rounded-xl border border-blue-200 bg-white p-3">
                    <div className="text-xs font-semibold text-blue-900 mb-1">ミッション（仮）</div>
                    <div className="text-sm whitespace-pre-wrap">{missionDraft}</div>
                  </div>
                )}
                {projectsDraft && projectsDraft.length > 0 && (
                  <div className="rounded-xl border border-blue-200 bg-white p-3">
                    <div className="text-xs font-semibold text-blue-900 mb-1">プロジェクト案</div>
                    <ul className="list-disc pl-5 text-sm space-y-1">
                      {projectsDraft.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                )}
                {okrsDraft && okrsDraft.length > 0 && (
                  <div className="rounded-xl border border-blue-200 bg-white p-3">
                    <div className="text-xs font-semibold text-blue-900 mb-1">OKR（初期案）</div>
                    <div className="space-y-3">
                      {okrsDraft.map((o, i) => (
                        <div key={i} className="text-sm">
                          {o.objective && <div className="font-medium">達成目標：{o.objective}</div>}
                          {o.keyResults && o.keyResults.length > 0 && (
                            <ul className="list-disc pl-5 space-y-1">
                              {o.keyResults.map((kr, k) => <li key={k}>主要な成果：{kr}</li>)}
                            </ul>
                          )}
                          {o.owner && <div className="text-xs text-gray-600 mt-1">Owner: {o.owner}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
