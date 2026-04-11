// components/guide/QuestionStepper.dept.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccess } from '@/utils/access'; // ★ 編集ガード
import { authFetchJson, AuthFetchError } from '@/utils/authFetch';

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


  // リクエスト多重防止
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // ★ 自動生成をやめて「ボタンを押したときだけ」生成するためのフラグ
  const [shouldFetchQuestion, setShouldFetchQuestion] = useState(false);

  // 親通知のガード
  const isFirstMountRef = useRef(true);
  const lastNotifiedRef = useRef<DeptAnswerStep[] | null>(null);
  const lastStepNotifiedRef = useRef<StepNumber | null>(null);

  // 直前の内容
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

  const hasQuestionForCurrentStep = useMemo(
    () => !!answers.find(a => a.stepNumber === step) || !!question,
    [answers, step, question]
  );

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
          const msg =
            e instanceof AuthFetchError
              ? e.status === 401
                ? 'セッションが切れています。ログインし直してください。'
                : e.bodyText || e.message
              : e?.message || 'エラーが発生しました';
          setErrorMsg(msg);
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

  const canGoNext = (answerText || '').trim().length > 0 && canEdit;
  const isLastStep = step === 6;

  const onClickNext = useCallback(() => {
    if (!canGoNext) return;
    handleSaveAnswerLocally();
    if (!isLastStep) {
      setStep(s => clampStep(s + 1));
      setAnswerText('');
      setShowHint(false);
      // 次のステップのテーマは、ユーザーが「テーマを生成」を押したときだけ取得
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
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* Ver4 summary（任意表示） */}
      {(direction || expectations.length || focusThemes.length) && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60">
          <div className="p-3 border-b border-amber-100 text-sm font-semibold text-amber-900">AIたたき台（方向性）</div>
          <div className="p-3 space-y-2 text-sm text-amber-900">
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

      {/* ステップインジケータ（進捗バッジ付き） */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-gray-700">戦略議論のための6つのディスカッションテーマ（進捗：{answers.filter(a => a.answer?.trim()).length}/6）</div>
          <div className="flex gap-1 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500"></span>入力済</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500"></span>現在</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300"></span>未入力</span>
          </div>
        </div>
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
                  'rounded-xl border px-3 py-2 text-xs font-medium transition-all',
                  active
                    ? 'border-blue-500 bg-blue-50 shadow-sm scale-105'
                    : done
                      ? 'border-green-400 bg-green-50 hover:bg-green-100'
                      : 'border-gray-200 bg-white hover:bg-gray-50',
                ].join(' ')}
                title={`Q${sn}${done ? '（入力済）' : '（未入力）'}`}
              >
                <div className="flex items-center justify-center gap-1">
                  Q{sn}
                  {done && <span className="text-green-600">✓</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 質問カード */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="text-sm font-medium">
            {label ? `ステップ：${label}` : '次のテーマ'}
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
              <>
                <button
                  type="button"
                  onClick={() => { setShouldFetchQuestion(true); setErrorMsg(''); }}
                  disabled={loading || isCompletedAll6}
                  className={[
                    'rounded-lg px-3 py-1.5 text-xs font-medium border',
                    (loading || isCompletedAll6)
                      ? 'bg-gray-100 text-gray-400 border-gray-200'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
                  ].join(' ')}
                  title={isCompletedAll6 ? '6テーマすべて入力済みです' : 'このステップのテーマを生成します'}
                >
                  テーマを生成
                </button>

                {hasQuestionForCurrentStep && (
                  <button
                    type="button"
                    onClick={onRedoFromHere}
                    disabled={loading || isCompletedAll6}
                    className={[
                      'rounded-lg px-3 py-1.5 text-xs font-medium border',
                      (loading || isCompletedAll6)
                        ? 'bg-gray-100 text-gray-400 border-gray-200'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
                    ].join(' ')}
                    title="このステップのテーマを再生成します（このステップ以降の内容はリセット）"
                  >
                    再生成
                  </button>
                )}
              </>
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
                {question
                  ? question
                  : canEdit
                    ? 'まだテーマは生成されていません。「テーマを生成」を押してください。'
                    : '（閲覧モード：新しいテーマの生成は無効です）'}
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

      {/* 内容欄 */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">ディスカッションの内容</label>
        <textarea
          className="w-full min-h-[140px] rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 p-3 disabled:bg-gray-50"
          placeholder="考えを具体的に書いてください。数値や期限、役割、連携相手などを明記すると次のテーマが鋭くなります。"
          value={answerText}
          onChange={(e) => setAnswerText(e.target.value)}
          disabled={!canEdit}
          title={canEdit ? '' : '閲覧モード（管理者のみ編集可）'}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {previousAnswer ? '直前の内容を踏まえてテーマ設定されています。' : '最初のテーマです。'}
          </span>
          <button
            type="button"
            onClick={onClickNext}
            disabled={!(answerText || '').trim() || loading || !canEdit}
            className={[
              'rounded-xl px-4 py-2 text-sm font-medium',
              (!(answerText || '').trim() || loading || !canEdit)
                ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700',
            ].join(' ')}
            title={canEdit ? (isLastStep ? '内容を保存して完了にします' : '次のテーマへ') : '閲覧モード（管理者のみ編集可）'}
          >
            {isLastStep ? '内容を保存' : '次のテーマへ'}
          </button>
        </div>
      </div>

      {/* 既出Q/Aの簡易ログ */}
      <div className="rounded-2xl border border-gray-200 bg-white">
        <div className="p-3 border-b border-gray-100 text-sm font-medium">これまでの議論の内容（この部門）</div>
        <div className="divide-y">
          {answers.length === 0 && <div className="p-3 text-sm text-gray-500">まだありません</div>}
          {answers.map((a) => (
            <div key={a.stepNumber} className="p-3 text-sm space-y-1">
              <div className="text-gray-500">Step {a.stepNumber}{a.label ? `（${a.label}）` : ''}</div>
              <div className="font-medium">Q: {a.question}</div>
              <div className="text-gray-700 whitespace-pre-wrap">A: {a.answer || '（未入力）'}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
