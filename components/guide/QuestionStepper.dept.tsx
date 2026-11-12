// components/guide/QuestionStepper.dept.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccess } from '@/utils/access'; // ★ 編集ガード
import { authFetchJson, AuthFetchError } from '@/utils/authFetch';
import { AutoResizeTextarea } from '@/components/ui/AutoResizeTextarea';
import { QUESTION_FAILURE_MESSAGE } from '@/lib/cascade/deptQuestionOutput';

/** 利用者に見せるエラーの文言。内部のエラー文字列（生の応答など）は見せない。 */
function questionErrorMessage(e: unknown): string {
  if (e instanceof AuthFetchError && e.status === 401) return 'セッションが切れています。ログインし直してください。';
  if (e instanceof AuthFetchError && e.bodyText) {
    try {
      const body = JSON.parse(e.bodyText) as { message?: unknown };
      if (typeof body?.message === 'string' && body.message.trim() !== '') return body.message;
    } catch {
      /* 本文が JSON でなければ、既定の案内を使う */
    }
  }
  return QUESTION_FAILURE_MESSAGE;
}

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
  /** 親へ：未保存の回答を親へ渡す関数を登録する（外れるときは null）。再生成の前に呼ばれる */
  onRegisterFlush?: (flush: (() => void) | null) => void;
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
    onRegisterFlush,
  } = props;

  // ★ 閲覧はOK、編集は部門レベル（Admin/Manager）
  const { canEditDepartment } = useAccess();
  const canEdit = canEditDepartment();

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


  // 表示中のテーマを、どのステップについて読み込んだか（ステップが変わったときだけ初期化する）
  const resetForStepRef = useRef<StepNumber | null>(null);

  // リクエスト多重防止
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // ★ 自動生成をやめて「ボタンを押したときだけ」生成するためのフラグ
  const [shouldFetchQuestion, setShouldFetchQuestion] = useState(false);

  // 親通知のガード
  const isFirstMountRef = useRef(true);
  const lastNotifiedRef = useRef<DeptAnswerStep[] | null>(null);
  const lastStepNotifiedRef = useRef<StepNumber | null>(null);

  const answersSoFarPayload = useMemo(
    () => answers.map(a => ({ stepNumber: a.stepNumber, answer: a.answer })),
    [answers]
  );

  const isCompletedAll6 = useMemo(() => {
    const has = (n: StepNumber) => answers.some(a => a.stepNumber === n && a.answer?.trim());
    return has(1) && has(2) && has(3) && has(4) && has(5) && has(6);
  }, [answers]);

  // ★ 安定キー化：参照が変わっても JSON文字列が同じなら effect 再実行を避ける
  const projectsKey = useMemo(() => JSON.stringify(projects ?? []), [projects]);
  const okrsKey = useMemo(() => JSON.stringify(okrs ?? []), [okrs]);
  const expectationsKey = useMemo(() => JSON.stringify(expectations ?? []), [expectations]);
  const focusThemesKey = useMemo(() => JSON.stringify(focusThemes ?? []), [focusThemes]);
  const answersKey = useMemo(
    () => JSON.stringify((answers ?? []).map(a => ({ n: a.stepNumber, a: a.answer ?? '' }))),
    [answers]
  );

  // ★ initialAnswers を安定化（props 経由で毎回新しい参照が来るのを防ぐ）
  const initialAnswersKey = useMemo(
    () => JSON.stringify((initialAnswers ?? []).map(a => ({ n: a.stepNumber, q: a.question, a: a.answer }))),
    // 実質的な内容が変わったかだけで判定（参照ではなく値で）
    [initialAnswers?.length, initialAnswers?.map(a => `${a?.stepNumber}:${a?.question}:${a?.answer}`).join('|')]
  );

  /* =========================================
   * props → state 同期（差分発火のみ）
   * ========================================= */
  const lastInitialAnswersKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const next = (initialAnswers ?? [])
      .filter(a => a && a.stepNumber && a.question != null)
      .sort((a, b) => a.stepNumber - b.stepNumber) as DeptAnswerStep[];

    // ★ 同値判定：lastInitialAnswersKeyRef と比較
    if (lastInitialAnswersKeyRef.current === initialAnswersKey) {
      // 内容は変わっていないので何もしない
      return;
    }

    // 内容が変わったので state を同期
    if (!answersEqual(answers, next)) {
      console.log('[STAGE3-stepper:initialAnswers-sync]', {
        changed: true,
        deptName: departmentName,
        answersLen: next?.length,
        initialAnswersKey,
      });
      setAnswers(next);
      const exist = next.find(a => a.stepNumber === step);
      if (exist) {
        setLabel(exist.label);
        setQuestion(exist.question);
        setReason(exist.reason);
        setHint(exist.hint);
        setAnswerText(exist.answer ?? '');
        setShowHint(false);
      } else {
        // 当該ステップのデータがなければ編集欄を初期化
        setLabel(undefined);
        setQuestion('');
        setReason('');
        setHint(undefined);
        setAnswerText('');
        setShowHint(false);
      }
    }

    lastInitialAnswersKeyRef.current = initialAnswersKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAnswersKey]);

  // initialStep が変わったら反映（親が明示的にステップ指示する場合）
  useEffect(() => {
    setStep(clampStep(initialStep));
  }, [initialStep]);

  /* =========================================
   * テーマの取得
   *  - 既にある場合はそれを表示
   *  - ない場合、「shouldFetchQuestion=true」のときだけAPI呼び出し
   *  - 6テーマ完了後は新規生成しない
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
      setErrorMsg('');
      setLoading(false);
      // 既存があるならAPIは呼ばない
      return;
    }

    // 非Adminは新規生成しない
    if (!canEdit) {
      setLabel(undefined);
      setQuestion('');
      setReason('');
      setHint(undefined);
      setAnswerText('');
      setShowHint(false);
      setErrorMsg('');
      setLoading(false);
      return;
    }

    if (resetForStepRef.current !== step) {
      resetForStepRef.current = step;
      setLabel(undefined);
      setQuestion('');
      setReason('');
      setHint(undefined);
      setShowHint(false);
      setAnswerText('');
    }

    // 6問すべて入力済みなら、それ以上はテーマを生成しない
    if (isCompletedAll6) {
      // ★ ここで setState しない（deps が揺れた時に無限ループになるので何もしない）
      return;
    }

    // ボタンを押していないならAPIは呼ばない（手動トリガ）
    if (!shouldFetchQuestion) {
      // ★重要：ここで setState すると deps が揺れた時に無限ループになるので何もしない
      return;
    }

    if (inFlightRef.current) return; // 二重抑止

    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      // shouldFetchQuestion が true の時だけ true にする（不要な更新を避ける）
      setLoading((prev) => (prev ? prev : true));
      setErrorMsg('');
      inFlightRef.current = true;
      try {
        const data = await authFetchJson<any>('/api/generate-department-question', {
          method: 'POST',
          signal: controller.signal,
          json: {
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
          },
        });

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
          setErrorMsg(questionErrorMessage(e));
        }
      } finally {
        inFlightRef.current = false;
        setLoading(false);
        setShouldFetchQuestion(false); // 一度のボタンクリックごとに1回だけ生成
      }
    })();

    return () => {
      controller.abort();
      inFlightRef.current = false;
    };
    // 依存配列：参照依存ではなく「安定キー依存」に（effect 再実行を最小化）
  }, [
    step,
    departmentName,
    mission,
    industry,
    direction,
    projectsKey,
    okrsKey,
    expectationsKey,
    focusThemesKey,
    answersKey,
    canEdit,
    shouldFetchQuestion,
    isCompletedAll6,
  ]);

  /* =========================================
   * 親へ進捗通知（onChange の参照を安定化して無限ループを防止）
   * ========================================= */
  // ★ FIX: onChange を useCallback でメモ化し、参照が安定するようにする
  const notifyParent = useCallback((currentAnswers: DeptAnswerStep[], currentStep: StepNumber) => {
    if (!onChange) return;
    try {
      onChange({ answers: currentAnswers, currentStep });
    } catch (e) {
      console.error('[STAGE3-stepper] notifyParent error:', e);
    }
  }, [onChange]);

  useEffect(() => {
    if (!notifyParent || !canEdit) return;
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      lastNotifiedRef.current = answers;
      lastStepNotifiedRef.current = step;
      return;
    }
    const last = lastNotifiedRef.current ?? [];
    if (answersEqual(last, answers) && lastStepNotifiedRef.current === step) {
      console.log('[STAGE3-stepper:onChange-skip]', {
        same: true,
        deptName: departmentName,
      });
      return;
    }
    console.log('[STAGE3-stepper:onChange]', {
      changed: true,
      deptName: departmentName,
      answersLen: answers?.length,
    });
    lastNotifiedRef.current = answers;
    lastStepNotifiedRef.current = step;
    notifyParent(answers, step);
  }, [answers, step, notifyParent, canEdit, departmentName]);

  /* =========================================
   * アンマウント直前にフラッシュ通知（編集可のみ）
   * ========================================= */
  useEffect(() => {
    return () => {
      if (!onChange || !canEdit) return;
      try {
        onChange({ answers, currentStep: step });
      } catch {
        /* noop */
      }
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

    // 即時で親にも反映（setState待ちによる取りこぼし防止）
    if (onChange) {
      try {
        onChange({ answers: next, currentStep: step });
      } catch {}
    }
  }, [answers, step, label, question, reason, hint, answerText, canEdit, onChange]);

  // 入力中の回答があれば、親へ渡す（再生成の前に呼ばれる）
  const flushPendingAnswer = useCallback((): void => {
    if (!canEdit || !question) return;
    const existing = answers.find(a => a.stepNumber === step);
    if (answerText.trim() === (existing?.answer ?? '').trim()) return;
    handleSaveAnswerLocally();
  }, [canEdit, question, answers, step, answerText, handleSaveAnswerLocally]);

  useEffect(() => {
    if (!onRegisterFlush) return;
    onRegisterFlush(flushPendingAnswer);
    return () => onRegisterFlush(null);
  }, [onRegisterFlush, flushPendingAnswer]);

  // 回答は任意。空欄でも次のテーマへ進める（回答はそのまま保存する）
  const canGoNext = canEdit;
  const isLastStep = step === 6;

  const onClickNext = useCallback(() => {
    if (!canGoNext) return;
    handleSaveAnswerLocally();
    if (!isLastStep) {
      setStep(s => clampStep(s + 1));
      setAnswerText('');
      setShowHint(false);
      setShouldFetchQuestion(true);
    }
  }, [canGoNext, isLastStep, handleSaveAnswerLocally]);

  // このステップからやり直す（テーマの再生成）
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
    // 次のレンダリングで、このステップの問いを再生成（ボタン押しと同じ扱い）
    setShouldFetchQuestion(true);
  }, [answers, step, canEdit]);


  return (
    <div className="w-full space-y-6">
      {/* Ver4 summary（任意表示） */}
      {(direction || expectations.length > 0 || focusThemes.length > 0) && (
        <div className="rounded-2xl border border-gray-300 bg-white shadow-sm">
          <div className="p-4 border-b border-gray-200 text-sm font-semibold tracking-[0.02em] text-gray-900">AIたたき台（方向性）</div>
          <div className="p-4 space-y-3 text-sm leading-6 text-gray-700">
            {direction && <div><span className="font-medium">方向性：</span>{direction}</div>}
            {expectations.length > 0 && (
              <div>
                <div className="font-medium">経営からの期待：</div>
                <ul className="list-disc pl-5">
                  {expectations.slice(0, 4).map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              </div>
            )}
            {focusThemes.length > 0 && (
              <div>
                <div className="font-medium">注力テーマ：</div>
                <ul className="list-disc pl-5">
                  {focusThemes.slice(0, 4).map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6つのテーマの一覧。テーマ名が見え、現在の問いだけを開いて回答する */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-base font-semibold text-gray-900">6つのディスカッションテーマ</h3>
          <span className="text-xs text-gray-500">回答 {answers.filter(a => a.answer?.trim()).length}/6</span>
        </div>
        <div className="divide-y divide-gray-200 rounded-2xl border border-gray-300 bg-white">
          {[1, 2, 3, 4, 5, 6].map(n => {
            const sn = n as StepNumber;
            const item = answers.find(a => a.stepNumber === sn);
            const active = step === sn;
            const answered = !!item?.answer?.trim();
            const title = (active && question) || item?.question || '';
            const dirty = active && answerText.trim() !== (item?.answer ?? '').trim();
            return (
              <div key={sn}>
                <button
                  type="button"
                  onClick={() => setStep(sn)}
                  aria-expanded={active}
                  className={active ? 'flex w-full items-start gap-3 bg-gray-50 px-5 py-4 text-left' : 'flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-gray-50'}
                >
                  <span className="w-8 shrink-0 pt-0.5 text-xs font-semibold text-gray-500">Q{sn}</span>
                  <span className={title ? 'flex-1 text-sm leading-6 text-gray-900' : 'flex-1 text-sm leading-6 text-gray-400'}>
                    {title || '未生成'}
                  </span>
                  <span className="shrink-0 pt-0.5 text-xs text-gray-500">{answered ? '回答済み' : item ? '空欄' : ''}</span>
                </button>

                {active && (
                  <div className="space-y-4 px-5 pb-5">
                    {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
                    {loading && <p className="text-sm text-gray-500">テーマを生成しています…</p>}

                    {question ? (
                      <>
                        {reason && <p className="text-sm leading-7 text-gray-700">{reason}</p>}
                        {showHint && hint && (
                          <p className="rounded-lg bg-gray-50 px-4 py-3 text-sm leading-7 text-gray-800">{hint}</p>
                        )}
                        {canEdit ? (
                          <div className="space-y-2">
                            <label className="text-xs font-semibold text-gray-600">回答（任意）</label>
                            <AutoResizeTextarea
                              minRows={4}
                              maxRows={20}
                              className="rounded-xl border-gray-300 bg-white text-[15px] leading-7 text-gray-900 focus:ring-gray-400"
                              placeholder="数値や期限、役割、連携相手などを書くと、次のテーマが具体的になります（空欄でも進めます）。"
                              value={answerText}
                              onChange={(e) => setAnswerText(e.target.value)}
                            />
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap text-sm leading-7 text-gray-700">{item?.answer?.trim() || '（回答なし）'}</p>
                        )}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex gap-2">
                            {hint && (
                              <button
                                type="button"
                                onClick={() => setShowHint(v => !v)}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-100"
                              >
                                ヒント
                              </button>
                            )}
                            {canEdit && (
                              <button
                                type="button"
                                onClick={onRedoFromHere}
                                disabled={loading || isCompletedAll6}
                                title="このテーマを作り直します（以降の回答はリセット）"
                                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:text-gray-400"
                              >
                                このテーマから作り直す
                              </button>
                            )}
                          </div>
                          {canEdit && (
                            <div className="flex flex-wrap items-center gap-3">
                              {dirty && <span className="text-xs text-amber-700">未保存の変更があります</span>}
                              {!isLastStep && (
                                <button
                                  type="button"
                                  onClick={handleSaveAnswerLocally}
                                  disabled={!dirty || loading}
                                  className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:text-gray-400"
                                >
                                  回答を保存
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={onClickNext}
                                disabled={!canGoNext || loading}
                                className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:bg-gray-200 disabled:text-gray-500"
                                title={isLastStep ? '内容を保存して完了にします' : '回答を保存して、次のテーマを作ります'}
                              >
                                {isLastStep ? '内容を保存' : '次のテーマへ'}
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    ) : canEdit ? (
                      <button
                        type="button"
                        onClick={() => { setShouldFetchQuestion(true); setErrorMsg(''); }}
                        disabled={loading || isCompletedAll6}
                        className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-black disabled:bg-gray-100 disabled:text-gray-400"
                        title={isCompletedAll6 ? '6テーマすべて入力済みです' : 'このテーマを生成します'}
                      >
                        このテーマを生成
                      </button>
                    ) : (
                      <p className="text-sm text-gray-500">閲覧モードです。テーマの生成は管理者のみ行えます。</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
