// /components/guide/QuestionStepper.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccess } from '@/utils/access';

/* ========= types ========= */
type Depth = 'board' | 'exec' | 'ops';
// 粒度プリセット（UIトグル用）
type DepthBias = 'abstract' | 'concrete';

// ★ 可変ステップに対応（1..max）
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
  chapterIndex: number; // 0..3
  chapterTitle?: string;
  chapterBody?: string;
  // ★ 後方互換：初期は1..3もOKだが、内部で章別上限にクランプ
  initialStep?: StepNumber;
  context?: Record<string, any>;
  initialAnswers?: AnswerStep[];
  onChange?: (p: { chapterIndex: number; answers: AnswerStep[]; currentStep: StepNumber; maxSteps: number }) => void;
};

/* ========= labels ========= */
const CHAPTER_META: { label: string; goal: string }[] = [
  { label: 'なぜ今（現状）',   goal: '変化と危機感を共有し、「なぜ今やるのか」を腹落ちさせる。' },
  { label: 'どう戦う（戦略）', goal: '顧客課題×自社の強み×制約×脅威で、勝ち筋を1本に絞る。' },
  { label: 'どんな未来像',     goal: '顧客視点の1シーンで価値を見える化し、希望を共有する。' },
  { label: 'どう行動する',     goal: '最初の一歩と学習リズムを決め、動ける状態を作る。' },
];

// ★ Ver4の章別上限（初期ローカル既定。サーバ応答で上書き）
// 第2章はローカル既定も 6（サーバ縮小の影響を受けにくくする）
const LOCAL_MAX_STEPS: Record<number, number> = { 0: 2, 1: 6, 2: 2, 3: 2 };

function maxStepsForChapterLocal(chapterIndex: number) {
  const idx = Math.max(0, Math.min(3, chapterIndex | 0));
  return LOCAL_MAX_STEPS[idx] ?? 2;
}

function clampStep(n: number, maxSteps: number): StepNumber {
  const v = Math.round(Number.isFinite(n as number) ? (n as number) : 1);
  return Math.max(1, Math.min(maxSteps, v));
}
function depthLabel(d: Depth) {
  return d === 'board' ? '抽象的（役員向け）' : d === 'exec' ? '具体的（実務向け）' : 'より具体的（実行設計）';
}
function answersEqual(a?: AnswerStep[], b?: AnswerStep[]) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
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
export default function QuestionStepper(props: QuestionStepperProps) {
  const {
    chapterIndex,
    chapterTitle,
    chapterBody,
    initialStep = 1,
    context,
    initialAnswers = [],
    onChange,
  } = props;

  const { canEditCompany } = useAccess();
  const editable = canEditCompany();

  const meta = CHAPTER_META[chapterIndex] ?? { label: `Chapter ${chapterIndex + 1}`, goal: '' };

  // ★ 章ごとの最大ステップ。初期はローカル既定、サーバ応答(meta.maxSteps)が来たら更新
  const [maxSteps, setMaxSteps] = useState<number>(() => maxStepsForChapterLocal(chapterIndex));

  /* ===== state ===== */
  const [step, setStep] = useState<StepNumber>(() => clampStep(initialStep, maxSteps));

  // Portfolio（注力先）
  const hasPortfolio = !!context?.portfolio?.businesses?.length;
  const businessNames: string[] = useMemo(
    () => (hasPortfolio ? (context?.portfolio?.businesses ?? [])
      .map((b: any) => String(b?.name ?? '')).filter(Boolean) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasPortfolio, context?.portfolio?.businesses]
  );
  const [portfolioFocus, setPortfolioFocus] = useState<string>(() => String(context?.portfolio?.focus ?? '') || '');

  // initialAnswers 同期（昇順）＋ 重複排除
  const sortedInitial = useMemo(() => {
    const valid = (initialAnswers || []).filter(a => a && a.stepNumber && a.question);
    const map = new Map<number, AnswerStep>();
    for (const a of valid) map.set(a.stepNumber, a);
    return Array.from(map.values()).sort((a, b) => a.stepNumber - b.stepNumber) as AnswerStep[];
  }, [initialAnswers]);

  const [answers, setAnswers] = useState<AnswerStep[]>(sortedInitial);
  useEffect(() => {
    if (!answersEqual(answers, sortedInitial)) setAnswers(sortedInitial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedInitial]);

  // 表示用：answers の重複完全排除
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

  const [question, setQuestion] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [depth, setDepth] = useState<Depth>('exec'); // 表示用（サーバ応答で上書き）
  const [answerText, setAnswerText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // ★ 粒度トグル（二択）：抽象的 ↔ 具体的（デフォルト：具体的）
  const [depthBiasPref, setDepthBiasPref] = useState<DepthBias>('concrete');

  // cache & inflight
  const fetchedCacheRef = useRef<Record<string, { question: string; reason: string; depth: Depth }>>({});
  const inflightKeyRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isFirstMountRef = useRef(true);
  const lastNotifiedRef = useRef<AnswerStep[] | null>(null);
  const lastStepNotifiedRef = useRef<StepNumber | null>(null);
  const lastMaxStepsRef = useRef<number | null>(null);

  // 章変更時の初期化
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
    setDepthBiasPref('concrete');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIndex]);

  const previousAnswer = useMemo(
    () => answers.find(a => a.stepNumber === (step - 1))?.answer || '',
    [answers, step]
  );
  const answersSoFarPayload = useMemo(
    () => answers.map(a => ({ stepNumber: a.stepNumber, answer: a.answer })),
    [answers]
  );

  // context 整形
  const mergedContext = useMemo(() => {
    const base = { ...(context || {}) };
    const baseAnswers2: Array<any> = Array.isArray(base.answers2) ? [...base.answers2] : [];
    const filtered = baseAnswers2.filter((c) => c?.chapterIndex !== chapterIndex);
    const myChapter = {
      chapterIndex,
      chapterTitle: chapterTitle || meta.label,
      steps: answers.map((a) => ({
        stepNumber: a.stepNumber,
        question: a.question,
        reason: a.reason,
        answer: a.answer,
        depth: a.depth,
      })),
    };
    let portfolioPatched = base.portfolio;
    if (hasPortfolio) {
      portfolioPatched = { ...(base.portfolio || {}) };
      if ((portfolioFocus || '').trim()) portfolioPatched.focus = portfolioFocus.trim();
    }
    return { ...base, ...(hasPortfolio ? { portfolio: portfolioPatched } : {}), answers2: [...filtered, myChapter] };
  }, [context, answers, chapterIndex, chapterTitle, meta.label, hasPortfolio, portfolioFocus]);

  // キャッシュキー（章/ステップ/直前回答/注力先/上限/粒度）
  const reqKey = useMemo(() => JSON.stringify({
    c: chapterIndex,
    s: step,
    pa: (previousAnswer || '').slice(0, 300),
    pf: (portfolioFocus || ''),
    mx: maxSteps,
    db: depthBiasPref,
  }), [chapterIndex, step, previousAnswer, portfolioFocus, maxSteps, depthBiasPref]);

  // 親通知
  const normalizedForNotify = useMemo(() => {
    const m = new Map<number, AnswerStep>();
    for (const a of answers) m.set(a.stepNumber, a);
    return Array.from(m.values()).sort((x, y) => x.stepNumber - y.stepNumber);
  }, [answers]);

  useEffect(() => {
    if (!onChange) return;
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      lastNotifiedRef.current = normalizedForNotify;
      lastStepNotifiedRef.current = step;
      lastMaxStepsRef.current = maxSteps;
      onChange({ chapterIndex, answers: normalizedForNotify, currentStep: step, maxSteps });
      return;
    }
    const last = lastNotifiedRef.current ?? [];
    const need =
      !answersEqual(last, normalizedForNotify) ||
      lastStepNotifiedRef.current !== step ||
      lastMaxStepsRef.current !== maxSteps;
    if (!need) return;
    lastNotifiedRef.current = normalizedForNotify;
    lastStepNotifiedRef.current = step;
    lastMaxStepsRef.current = maxSteps;
    onChange({ chapterIndex, answers: normalizedForNotify, currentStep: step, maxSteps });
  }, [normalizedForNotify, chapterIndex, step, onChange, maxSteps]);

  const handleSaveAnswerLocally = useCallback(() => {
    if (!editable) { alert('編集権限がありません（閲覧のみ）'); return; }
    const trimmed = (answerText || '').trim();
    const existingIndex = answers.findIndex(a => a.stepNumber === step);
    const payload: AnswerStep = {
      stepNumber: step,
      depth,
      question,
      reason,
      answer: trimmed,
      createdAt: existingIndex >= 0 ? answers[existingIndex].createdAt : new Date().toISOString(),
    };
    const next = [...answers];
    if (existingIndex >= 0) next[existingIndex] = payload; else next.push(payload);
    next.sort((a, b) => a.stepNumber - b.stepNumber);
    setAnswers(next);
  }, [answers, step, depth, question, reason, answerText, editable]);

  const canGoNext = (answerText || '').trim().length > 0;
  const isLastStep = step === maxSteps;

  const onClickNext = useCallback(() => {
    if (!editable) { alert('編集権限がありません（閲覧のみ）'); return; }
    if (!canGoNext || loading) return;
    handleSaveAnswerLocally();
    if (!isLastStep) {
      setStep((s) => clampStep(s + 1, maxSteps));
      setAnswerText('');
      setQuestion('');
      setReason('');
      setErrorMsg('');
    }
  }, [editable, canGoNext, loading, handleSaveAnswerLocally, isLastStep, maxSteps]);

  const onRedoFromHere = useCallback(() => {
    if (!editable) { alert('編集権限がありません（閲覧のみ）'); return; }
    // このステップ以降をリセットし、キャッシュも消去
    const kept = answers.filter(a => a.stepNumber < step);
    setAnswers(kept);
    setAnswerText('');
    setQuestion('');
    setReason('');
    setErrorMsg('');
    const keys = Object.keys(fetchedCacheRef.current);
    for (const k of keys) {
      try {
        const j = JSON.parse(k) as { c:number; s:number; pa:string; pf?:string; mx?:number; db?: string };
        if (j.c === chapterIndex && j.s >= step) delete fetchedCacheRef.current[k];
      } catch {}
    }
  }, [answers, step, chapterIndex, editable]);

  // 質問生成（UI粒度トグルを depthBias としてサーバへ送る）
  const generate = useCallback(async (forceRegenerate: boolean) => {
    if (!editable) { setErrorMsg('編集権限がありません（閲覧のみ）'); return; }
    const existing = answers.find(a => a.stepNumber === step);
    if (existing && String(existing.answer || '').trim()) return;

    if (!forceRegenerate) {
      const cached = fetchedCacheRef.current[reqKey];
      if (cached) {
        setQuestion(cached.question);
        setReason(cached.reason);
        setDepth(cached.depth);
        setAnswerText(existing?.answer ?? '');
        setErrorMsg('');
        return;
      }
    }

    if (inflightKeyRef.current === reqKey) return;
    inflightKeyRef.current = reqKey;

    if (abortRef.current) { try { abortRef.current.abort(); } catch {} }
    const controller = new AbortController();
    // ★★★ 修正ポイント：ref自体を再代入せず、.current に代入
    abortRef.current = controller;

    setLoading(true);
    setErrorMsg('');
    try {
      const doFetch = async () => {
        const res = await fetch('/api/generate-question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
          body: JSON.stringify({
            chapterIndex,
            chapterTitle,
            chapterBody,
            stepNumber: step,
            previousAnswer,
            answersSoFar: answersSoFarPayload,
            depthBias: depthBiasPref, // ★ 二択トグルの指定を反映
            context: mergedContext,
          }),
        });
        const txt = await res.text();
        if (!res.ok) {
          if (res.status === 429) throw Object.assign(new Error('RATE_LIMIT'), { code: 429 });
          let msg = 'Failed to fetch question';
          try { msg = (JSON.parse(txt)?.error) || msg; } catch {}
          throw new Error(msg);
        }
        return JSON.parse(txt) as { step: GeneratedStep; meta?: { chapterIndex: number; maxSteps?: number; depthBias?: string } };
      };

      let data: { step: GeneratedStep; meta?: { chapterIndex: number; maxSteps?: number; depthBias?: string } } | null = null;
      try {
        data = await doFetch();
      } catch (e: any) {
        if (e?.code === 429) {
          await new Promise(r => setTimeout(r, 900 + Math.floor(Math.random()*300)));
          data = await doFetch();
        } else if (e?.name === 'AbortError') {
          return; // 中断
        } else {
          throw e;
        }
      }
      if (!data?.step) throw new Error('Invalid response');

      const g = data.step;
      const q = (g.question ?? '').trim();
      const r = (g.reason ?? '').trim();
      const d: Depth = (g.depth as Depth) || 'exec';

      setQuestion(q);
      setReason(r);
      setDepth(d);
      setAnswerText(existing?.answer ?? '');
      fetchedCacheRef.current[reqKey] = { question: q, reason: r, depth: d };

      // ★ サーバ応答から maxSteps が返ってきたら同期（第2章は最低6、縮小は無視）
      const serverMax = Number(data?.meta?.maxSteps || 0);
      const desired = Math.max(chapterIndex === 1 ? 6 : 0, serverMax || 0);
      if (desired && desired > maxSteps) {
        setMaxSteps(desired);
        setStep((s) => clampStep(s, desired));
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') setErrorMsg(e?.message || 'エラーが発生しました');
    } finally {
      setLoading(false);
      if (inflightKeyRef.current === reqKey) inflightKeyRef.current = null;
      abortRef.current = null;
    }
  }, [
    editable, answers, step, chapterIndex, chapterTitle, chapterBody,
    previousAnswer, answersSoFarPayload, mergedContext, reqKey, maxSteps, depthBiasPref
  ]);

  // ステップボタン群（1..maxSteps）
  const stepButtons = useMemo(() => {
    const arr: number[] = Array.from({ length: maxSteps }, (_, i) => i + 1);
    return arr.map((n) => {
      const done = answers.some(a => a.stepNumber === n && a.answer?.trim());
      const active = step === n;
      return (
        <button
          key={n}
          onClick={() => {
            if (editable && (answerText || '').trim() && step !== n) {
              const exists = answers.find(a => a.stepNumber === step)?.answer ?? '';
              if (exists.trim() !== (answerText || '').trim()) {
                const payload: AnswerStep = {
                  stepNumber: step, depth, question, reason, answer: (answerText || '').trim(),
                  createdAt: new Date().toISOString()
                };
                const next = [...answers];
                const idx = next.findIndex(a => a.stepNumber === step);
                if (idx >= 0) next[idx] = payload; else next.push(payload);
                next.sort((a, b) => a.stepNumber - b.stepNumber);
                setAnswers(next);
              }
            }
            setStep(clampStep(n, maxSteps));
            setAnswerText('');
            setQuestion('');
            setReason('');
            setErrorMsg('');
          }}
          className={[
            'flex-1 rounded-xl border px-3 py-2 text-sm',
            active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50',
            !editable ? 'opacity-80' : ''
          ].join(' ')}
        >
          Step {n}{done && <span className="ml-1 text-green-600">✓</span>}
        </button>
      );
    });
  }, [answers, step, editable, answerText, depth, question, reason, maxSteps]);

  // 二択トグル UI（抽象的 ↔ 具体的）
  const DepthToggle = () => (
    <div className="flex items-center gap-2" title="質問の粒度を切り替え（抽象的／具体的）">
      <span className={`text-xs font-medium ${depthBiasPref === 'abstract' ? 'text-blue-600' : 'text-gray-500'}`}>抽象的</span>
      <button
        type="button"
        aria-label="粒度を切り替え"
        onClick={() => setDepthBiasPref(prev => prev === 'abstract' ? 'concrete' : 'abstract')}
        className={`relative w-11 h-6 rounded-full transition-colors ${depthBiasPref === 'concrete' ? 'bg-blue-600' : 'bg-gray-300'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
            depthBiasPref === 'concrete' ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
      <span className={`text-xs font-medium ${depthBiasPref === 'concrete' ? 'text-blue-600' : 'text-gray-500'}`}>具体的</span>
    </div>
  );

  /* === UI === */
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

      {/* portfolio focus（任意） */}
      {hasPortfolio && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
          <div className="text-sm font-medium text-amber-900">事業ポートフォリオ</div>
          <div className="text-xs text-amber-900/80">注力対象を選ぶと、問いがその事業に寄ります（未選択=全社視点）。</div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-amber-900/90">注力事業</label>
            <select
              className="text-sm rounded-md border border-amber-300 bg-white px-2 py-1"
              value={portfolioFocus}
              onChange={(e) => setPortfolioFocus(e.target.value)}
              disabled={!editable}
            >
              <option value="">（未選択：全社）</option>
              {businessNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* steps */}
      <div className="flex gap-2">
        {stepButtons}
      </div>

      {/* action */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">質問を生成</div>
          <div className="flex items-center gap-3">
            {/* 粒度トグル（二択） */}
            <DepthToggle />
            <button
              type="button"
              onClick={() => generate(false)}
              disabled={loading || !editable}
              className={[
                'rounded-xl px-3 py-2 text-sm font-medium',
                (loading || !editable) ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'
              ].join(' ')}
              title="次の1問を作る（粒度設定を反映）"
            >
              質問を作る
            </button>
            {!String(answers.find(a=>a.stepNumber===step)?.answer || '').trim() && question && (
              <button
                type="button"
                onClick={() => generate(true)}
                disabled={loading || !editable}
                className="rounded-xl px-3 py-2 text-sm font-medium border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-60"
                title="このステップの質問をもう一度作る（粒度設定を反映）"
              >
                もう一度作る
              </button>
            )}
            {loading && <div className="text-xs text-gray-500">生成中…</div>}
          </div>
        </div>
      </div>

      {/* question card */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="text-sm font-medium">次の問い</div>
          {question && (
            <div className="text-xs text-gray-500">
              粒度：{depthLabel(depth)}（指定：{depthBiasPref === 'abstract' ? '抽象的' : '具体的'}）
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
            </>
          ) : (
            <div className="text-sm text-gray-500">まだこのステップの問いは表示されていません。</div>
          )}
        </div>
      </div>

      {/* answer area */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">あなたの回答</label>
        <textarea
          className="w-full min-h-[120px] rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 p-3"
          placeholder={
            chapterIndex === 1 && step === 6
              ? '例）Objective: 既存大口の継続率を改善する。Key Results: 解約率3.0%→1.8%（FY25 Q4）/ NPS +10pt（FY25 Q3）/ KILL: FY25 Q2時点でNPS +3pt未達なら施策A停止'
              : '考えを具体的に書いてください。数値や期限、役割などがあると次の問いが鋭くなります。'
          }
          value={answerText}
          onChange={(e) => setAnswerText(e.target.value)}
          readOnly={!editable}
        />
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="text-sm text-gray-600 underline decoration-dashed underline-offset-4 hover:text-gray-900 disabled:text-gray-400"
            onClick={onRedoFromHere}
            disabled={!editable}
          >
            このステップからやり直す
          </button>
          {isLastStep ? (
            <button
              type="button"
              onClick={() => {
                if (!editable) { alert('編集権限がありません（閲覧のみ）'); return; }
                if ((answerText || '').trim()) {
                  handleSaveAnswerLocally();
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
              onClick={onClickNext}
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
