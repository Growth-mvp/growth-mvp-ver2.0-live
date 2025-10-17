// /components/guide/QuestionStepper.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccess } from '@/utils/access';

/* ========= types ========= */
type Depth = 'board' | 'exec' | 'ops';
export type StepNumber = number;

type GeneratedStep = {
  stepNumber: StepNumber;
  depth: Depth;
  question: string;
  reason: string;
  answer: string;
};

export type AnswerStep = {
  stepNumber: StepNumber;
  depth: Depth;
  question: string;
  reason: string;
  answer: string;
  createdAt: string;
};

export type QuestionStepperProps = {
  chapterIndex: number;
  chapterTitle?: string;
  chapterBody?: string; // 互換のため残置（未使用）
  initialStep?: StepNumber;
  context?: Record<string, any>; // 互換のため残置（未使用）
  initialAnswers?: AnswerStep[];
  onChange?: (p: { chapterIndex: number; answers: AnswerStep[]; currentStep: StepNumber; maxSteps: number }) => void;
};

/* ========= constants ========= */
const CHAPTER_META = [
  { label: 'なぜ今（現状）', goal: '変化と危機感を共有し、「なぜ今やるのか」を腹落ちさせる。' },
  { label: 'どう戦う（戦略）', goal: '顧客課題×自社の強み×制約×脅威で、勝ち筋を1本に絞る。' },
  { label: 'どんな未来像', goal: '顧客視点の1シーンで価値を見える化し、希望を共有する。' },
  { label: 'どう行動する', goal: '最初の一歩と学習リズムを決め、動ける状態を作る。' },
];

const LOCAL_MAX_STEPS: Record<number, number> = { 0: 2, 1: 6, 2: 2, 3: 2 };

function maxStepsForChapterLocal(chapterIndex: number) {
  return LOCAL_MAX_STEPS[Math.max(0, Math.min(3, chapterIndex | 0))] ?? 2;
}
function clampStep(n: number, maxSteps: number): StepNumber {
  return Math.max(1, Math.min(maxSteps, Math.round(n || 1)));
}
function depthLabel(d: Depth) {
  return d === 'board' ? '抽象的（役員向け）' : d === 'exec' ? '具体的（実務向け）' : '実行レベル';
}
function answersEqual(a: AnswerStep[] = [], b: AnswerStep[] = []) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (
      x.stepNumber !== y.stepNumber ||
      x.depth !== y.depth ||
      (x.question ?? '') !== (y.question ?? '') ||
      (x.reason ?? '') !== (y.reason ?? '') ||
      (x.answer ?? '') !== (y.answer ?? '')
    ) return false;
  }
  return true;
}

/* ========= component ========= */
export default function QuestionStepper({
  chapterIndex,
  chapterTitle,
  chapterBody, // 互換のため未使用
  initialStep = 1,
  context, // 互換のため未使用
  initialAnswers = [],
  onChange,
}: QuestionStepperProps) {
  const { canEditCompany } = useAccess();
  const editable = canEditCompany();
  const meta = CHAPTER_META[chapterIndex] ?? { label: `Chapter ${chapterIndex + 1}`, goal: '' };

  /* 最大ステップ＆現在ステップ */
  const [maxSteps, setMaxSteps] = useState(() => maxStepsForChapterLocal(chapterIndex));
  const [step, setStep] = useState<StepNumber>(() => clampStep(initialStep, maxSteps));

  /* 回答（重複排除しつつ初期昇順） */
  const sortedInitial = useMemo(() => {
    const valid = (initialAnswers || []).filter(a => a && a.stepNumber && (a.question ?? '').trim() !== '');
    const map = new Map<number, AnswerStep>();
    for (const a of valid) map.set(a.stepNumber, a);
    return Array.from(map.values()).sort((a, b) => a.stepNumber - b.stepNumber);
  }, [initialAnswers]);
  const [answers, setAnswers] = useState<AnswerStep[]>(sortedInitial);

  useEffect(() => {
    if (!answersEqual(answers, sortedInitial)) setAnswers(sortedInitial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedInitial]);

  /* 表示用（完全重複排除） */
  const dedupedAnswersForView = useMemo(() => {
    const seen = new Set<string>();
    const out: AnswerStep[] = [];
    for (const a of answers ?? []) {
      const k = `${a.stepNumber}::${(a.question || '').trim()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(a);
    }
    return out;
  }, [answers]);

  /* 質問状態 */
  const [question, setQuestion] = useState('');
  const [reason, setReason] = useState('');
  const [depth, setDepth] = useState<Depth>('exec');
  const [answerText, setAnswerText] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  /* ヒント／事例 */
  const [hints, setHints] = useState<string[]>([]);
  const [examples, setExamples] = useState<string[]>([]);

  /* 直前回答（UIヒントの文脈用に使用） */
  const previousAnswer = useMemo(
    () => answers.find(a => a.stepNumber === (step - 1))?.answer || '',
    [answers, step]
  );

  /* 章変更時の初期化（未回答の最小ステップへ） */
  useEffect(() => {
    const localMax = maxStepsForChapterLocal(chapterIndex);
    setMaxSteps(localMax);

    const sorted = [...answers].sort((a, b) => a.stepNumber - b.stepNumber);
    let target: StepNumber = 1;
    for (let s = 1; s <= localMax; s++) {
      const rec = sorted.find(a => a.stepNumber === s);
      if (!rec || !String(rec.answer || '').trim()) { target = s; break; }
      target = s;
    }
    setStep(target);
    setQuestion('');
    setReason('');
    setAnswerText('');
    setErrorMsg('');
    setHints([]);
    setExamples([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIndex]);

  /* 親へ同期 */
  const lastNotifiedRef = useRef<AnswerStep[] | null>(null);
  const lastStepNotifiedRef = useRef<StepNumber | null>(null);
  const lastMaxStepsRef = useRef<number | null>(null);
  useEffect(() => {
    if (!onChange) return;
    const normalized = [...answers].sort((a, b) => a.stepNumber - b.stepNumber);
    const need =
      !answersEqual(lastNotifiedRef.current || [], normalized) ||
      lastStepNotifiedRef.current !== step ||
      lastMaxStepsRef.current !== maxSteps;
    if (!need) return;
    lastNotifiedRef.current = normalized;
    lastStepNotifiedRef.current = step;
    lastMaxStepsRef.current = maxSteps;
    onChange({ chapterIndex, answers: normalized, currentStep: step, maxSteps });
  }, [answers, chapterIndex, step, onChange, maxSteps]);

  /* ======= テンプレ質問の取得（固定12問API） ======= */
  useEffect(() => {
    let aborted = false;
    (async () => {
      setLoading(true); setErrorMsg(''); setHints([]); setExamples([]);
      try {
        const res = await fetch('/api/generate-question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chapterIndex, stepNumber: step }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'API error');
        if (aborted) return;
        setQuestion(data?.step?.question ?? '');
        setReason(data?.step?.reason ?? '');
        setDepth(data?.step?.depth ?? 'exec');
      } catch (e: any) {
        if (!aborted) setErrorMsg(e?.message || '読み込みエラー');
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => { aborted = true; };
  }, [chapterIndex, step]);

  /* ======= ヒント／事例の取得 ======= */
  const fetchHints = useCallback(async () => {
    if (!question) return;
    setHints([]); setLoading(true); setErrorMsg('');
    try {
      const res = await fetch('/api/generate-hint', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, answer: answerText || previousAnswer }),
      });
      const data = await res.json();
      setHints(Array.isArray(data?.hints) ? data.hints : []);
    } catch (e: any) {
      setErrorMsg(e?.message || 'ヒント取得エラー');
    } finally { setLoading(false); }
  }, [question, answerText, previousAnswer]);

  const fetchExamples = useCallback(async () => {
    if (!question) return;
    setExamples([]); setLoading(true); setErrorMsg('');
    try {
      const res = await fetch('/api/generate-example', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      setExamples(Array.isArray(data?.examples) ? data.examples : []);
    } catch (e: any) {
      setErrorMsg(e?.message || '事例取得エラー');
    } finally { setLoading(false); }
  }, [question]);

  /* ======= 回答保存 ======= */
  const handleSaveAnswer = useCallback(() => {
    const trimmed = (answerText || '').trim();
    if (!trimmed) return;
    const existing = answers.findIndex((a) => a.stepNumber === step);
    const updated: AnswerStep = {
      stepNumber: step,
      depth,
      question,
      reason,
      answer: trimmed,
      createdAt: existing >= 0 ? answers[existing].createdAt : new Date().toISOString(),
    };
    const next = [...answers];
    if (existing >= 0) next[existing] = updated; else next.push(updated);
    next.sort((a, b) => a.stepNumber - b.stepNumber);
    setAnswers(next);
    onChange?.({ chapterIndex, answers: next, currentStep: step, maxSteps });
  }, [answers, answerText, question, reason, depth, step, chapterIndex, maxSteps, onChange]);

  /* ======= 次の問いへ ======= */
  const isLastStep = step === maxSteps;
  const canGoNext = (answerText || '').trim().length > 0;

  const goNext = useCallback(() => {
    handleSaveAnswer();
    if (!isLastStep) {
      setStep((s) => clampStep(s + 1, maxSteps));
      setQuestion('');
      setReason('');
      setAnswerText('');
      setHints([]);
      setExamples([]);
    }
  }, [handleSaveAnswer, isLastStep, maxSteps]);

  /* ======= やり直し（このステップ以降をリセット） ======= */
  const redoFromHere = useCallback(() => {
    setAnswers((prev) => prev.filter((a) => a.stepNumber < step));
    setQuestion('');
    setReason('');
    setAnswerText('');
    setHints([]);
    setExamples([]);
  }, [step]);

  /* ======= ステップボタン（1..max） ======= */
  const stepButtons = useMemo(() => {
    const arr: number[] = Array.from({ length: maxSteps }, (_, i) => i + 1);
    return arr.map((n) => {
      const done = answers.some(a => a.stepNumber === n && (a.answer ?? '').trim());
      const active = step === n;
      return (
        <button
          key={n}
          type="button"
          onClick={() => {
            // 現在の入力があり、保存されていなければ保存してから移動
            const typed = (answerText || '').trim();
            if (editable && typed && step !== n) {
              const exists = answers.find(a => a.stepNumber === step)?.answer ?? '';
              if (exists.trim() !== typed) {
                const payload: AnswerStep = {
                  stepNumber: step, depth, question, reason, answer: typed,
                  createdAt: new Date().toISOString(),
                };
                const next = [...answers];
                const idx = next.findIndex(a => a.stepNumber === step);
                if (idx >= 0) next[idx] = payload; else next.push(payload);
                next.sort((a, b) => a.stepNumber - b.stepNumber);
                setAnswers(next);
                onChange?.({ chapterIndex, answers: next, currentStep: n as StepNumber, maxSteps });
              }
            }
            setStep(clampStep(n, maxSteps));
            setAnswerText('');
            setHints([]);
            setExamples([]);
            setErrorMsg('');
          }}
          className={[
            'flex-1 rounded-xl border px-3 py-2 text-sm transition-colors',
            active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50',
            !editable ? 'opacity-80' : ''
          ].join(' ')}
          aria-pressed={active}
          aria-label={`Step ${n} ${done ? '（回答済）' : ''}`}
          title={done ? '回答済' : '未回答'}
        >
          Step {n}{done && <span className="ml-1 text-green-600">✓</span>}
        </button>
      );
    });
  }, [answers, step, editable, answerText, depth, question, reason, maxSteps, onChange, chapterIndex]);

  /* ======= UI ======= */
  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* header */}
      <header className="space-y-1">
        <div className="text-sm text-gray-500">
          {meta.label}（Chapter {chapterIndex + 1} / Step {step} / Max {maxSteps}） {editable ? '' : '・閲覧のみ'}
        </div>
        <h1 className="text-xl font-semibold">{chapterTitle || meta.label}</h1>
        {meta.goal && <p className="text-gray-600 text-sm">{meta.goal}</p>}
      </header>

      {/* steps */}
      <div className="flex gap-2">{stepButtons}</div>

      {/* question card */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="text-sm font-medium">次の問い</div>
          {question && (
            <div className="text-xs text-gray-500">
              粒度：{depthLabel(depth)}
            </div>
          )}
        </div>
        <div className="p-4 space-y-3">
          {errorMsg ? (
            <div className="text-sm text-red-600">{errorMsg}</div>
          ) : question ? (
            <>
              <p className="text-base leading-relaxed">{question}</p>
              {reason && <p className="text-sm text-gray-500">狙い：{reason}</p>}

              {/* ヒント／事例ボタン */}
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={fetchHints}
                  disabled={loading || !editable}
                  className="rounded-xl border border-blue-300 text-blue-700 px-3 py-1 text-sm hover:bg-blue-50 disabled:opacity-60"
                  title="考え方の観点ヒントを表示"
                >
                  💡 ヒントを表示
                </button>
                <button
                  type="button"
                  onClick={fetchExamples}
                  disabled={loading || !editable}
                  className="rounded-xl border border-emerald-300 text-emerald-700 px-3 py-1 text-sm hover:bg-emerald-50 disabled:opacity-60"
                  title="抽象化した事例を表示（固有名詞なし）"
                >
                  📚 事例を表示
                </button>
                {loading && <div className="text-xs text-gray-500">読み込み中…</div>}
              </div>

              {/* ヒント表示 */}
              {hints.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm text-blue-700 bg-blue-50 rounded-xl p-3">
                  {hints.map((h, i) => <li key={i}>{h}</li>)}
                </ul>
              )}

              {/* 事例表示 */}
              {examples.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm text-emerald-700 bg-emerald-50 rounded-xl p-3">
                  {examples.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </>
          ) : (
            <div className="text-sm text-gray-500">このステップの問いは未取得です。</div>
          )}
        </div>
      </div>

      {/* answer area */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">あなたの回答</label>
        <textarea
          className="w-full min-h-[120px] rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 p-3"
          value={answerText}
          onChange={(e) => setAnswerText(e.target.value)}
          readOnly={!editable}
          placeholder={
            chapterIndex === 1 && step === 6
              ? '例）やめること／撤退：●●領域の新規開発をFY25は凍結し、営業・導入の人員を重点アカウントへ再配置 など'
              : '考えを具体的に書いてください。数値や期限、役割などがあると次の問いが鋭くなります。'
          }
        />
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="text-sm text-gray-600 underline decoration-dashed underline-offset-4 hover:text-gray-900 disabled:text-gray-400"
            onClick={redoFromHere}
            disabled={!editable}
            title="このステップ以降の回答を削除してやり直す"
          >
            このステップからやり直す
          </button>
          {isLastStep ? (
            <button
              type="button"
              onClick={() => {
                if (!editable) return;
                const trimmed = (answerText || '').trim();
                if (trimmed) {
                  const existing = answers.findIndex(a => a.stepNumber === step);
                  const updated: AnswerStep = {
                    stepNumber: step, depth, question, reason, answer: trimmed,
                    createdAt: existing >= 0 ? answers[existing].createdAt : new Date().toISOString(),
                  };
                  const next = [...answers];
                  if (existing >= 0) next[existing] = updated; else next.push(updated);
                  next.sort((a, b) => a.stepNumber - b.stepNumber);
                  setAnswers(next);
                  onChange?.({ chapterIndex, answers: next, currentStep: step, maxSteps });
                  setAnswerText('');
                }
              }}
              disabled={loading || !(answerText || '').trim() || !editable}
              className={[
                'rounded-xl px-4 py-2 text-sm font-medium',
                (loading || !(answerText || '').trim() || !editable) ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'
              ].join(' ')}
              title="この章の最終ステップの回答を保存"
            >
              回答を保存（完了）
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              disabled={!canGoNext || loading || !editable}
              className={[
                'rounded-xl px-4 py-2 text-sm font-medium',
                (!canGoNext || loading || !editable) ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'
              ].join(' ')}
              title="次の問いへ"
            >
              次の問いへ
            </button>
          )}
        </div>
      </div>

      {/* log */}
      <div className="rounded-2xl border border-gray-200 bg-white">
        <div className="p-3 border-b border-gray-100 text-sm font-medium">これまでのQ/A（この章）</div>
        <div className="divide-y">
          {dedupedAnswersForView.length === 0 && <div className="p-3 text-sm text-gray-500">まだありません</div>}
          {dedupedAnswersForView.map((a, i) => (
            <div key={`${a.stepNumber}-${i}`} className="p-3 text-sm space-y-1">
              <div className="text-gray-500">Step {a.stepNumber}・{depthLabel(a.depth)}</div>
              <div className="font-medium">Q: {a.question}</div>
              <div className="text-gray-700 whitespace-pre-wrap">A: {a.answer || '（未入力）'}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
