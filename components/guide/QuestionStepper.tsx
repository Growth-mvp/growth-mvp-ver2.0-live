// /components/guide/QuestionStepper.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccess } from '@/utils/access';

/* ========= types ========= */
type Depth = 'board' | 'exec' | 'ops';
type DepthBias = 'abstract' | 'standard' | 'concrete';
export type StepNumber = 1 | 2 | 3;
type ConsultantLens = 'drucker' | 'porter' | 'christensen' | 'collins' | 'charan' | 'design';

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
  initialStep?: StepNumber;
  context?: Record<string, any>;
  initialAnswers?: AnswerStep[];
  onChange?: (p: { chapterIndex: number; answers: AnswerStep[]; currentStep: StepNumber }) => void;
};

/* ========= labels / default depth plan ========= */
const CHAPTER_META: { label: string; goal: string }[] = [
  { label: 'なぜ今（現状）', goal: '経営が感じる危機を全社員と共有し、「このままではまずい」を自分ごと化させる。' },
  { label: 'どう戦う（戦略）', goal: '何に注力し何を捨てるかを定め、資源配分と優先順位を明確化する。' },
  { label: 'どんな未来像',   goal: '顧客の風景で未来を描写し、希望と判断の物差しを共有する。' },
  { label: 'どう行動する',   goal: '社員が戦略を自分ごと化し、行動に移せるようにする。' },
];

const DEFAULT_DEPTH_PLAN: Depth[][] = [
  ['board', 'exec', 'exec'],
  ['board', 'exec', 'exec'],
  ['board', 'exec', 'exec'],
  ['board', 'exec', 'ops'],
];

function clampStep(n: number): StepNumber {
  return Math.max(1, Math.min(3, Math.round(n))) as StepNumber;
}

/* ========= helpers ========= */
function depthLabel(d: Depth) {
  return d === 'board' ? '抽象的（役員向け）' : d === 'exec' ? '具体的（実務向け）' : 'より具体的（実行設計）';
}
function biasLabel(b: DepthBias) {
  return b === 'abstract' ? '抽象的' : b === 'concrete' ? 'より具体的' : '具体的（標準）';
}
const LENS_OPTIONS: Array<{ key: ConsultantLens; label: string; hint: string }> = [
  { key: 'drucker',     label: 'ドラッカー',     hint: '顧客・使命・強みの観点で問う' },
  { key: 'porter',      label: 'ポーター',       hint: 'ポジショニング/トレードオフ' },
  { key: 'christensen', label: 'クリステンセン', hint: 'ジョブ理論/非消費/別解' },
  { key: 'collins',     label: 'ジム・コリンズ', hint: '人/規律/経済エンジン' },
  { key: 'charan',      label: 'ラム・チャラン', hint: 'Execution/誰が・いつまでに' },
  { key: 'design',      label: 'デザイン思考',   hint: '体験/一場面/Before→After' },
];
function answersEqual(a?: AnswerStep[], b?: AnswerStep[]) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.stepNumber !== y.stepNumber || x.depth !== y.depth || (x.question ?? '') !== (y.question ?? '')
      || (x.reason ?? '') !== (y.reason ?? '') || (x.answer ?? '') !== (y.answer ?? '')) return false;
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

  /* ===== state ===== */
  const [step, setStep] = useState<StepNumber>(clampStep(initialStep));
  const [tempBias, setTempBias] = useState<DepthBias>('standard');
  const [lensOverride, setLensOverride] = useState<ConsultantLens[]>([]);
  const hasPortfolio = !!context?.portfolio?.businesses?.length;
  const businessNames: string[] = useMemo(
    () => (hasPortfolio ? (context?.portfolio?.businesses ?? []).map((b: any) => String(b?.name ?? '')).filter(Boolean) : []),
    [hasPortfolio, context?.portfolio?.businesses]
  );
  const [portfolioFocus, setPortfolioFocus] = useState<string>(() => String(context?.portfolio?.focus ?? '') || '');

  // ★ 修正1: initialAnswers の変更を**同期**（章の state を壊さない・並びは stepNumber 昇順）
  const sortedInitial = useMemo(
    () => (initialAnswers || [])
      .filter(a => a && a.stepNumber && a.question)
      .slice()
      .sort((a, b) => a.stepNumber - b.stepNumber) as AnswerStep[],
    [initialAnswers]
  );
  const [answers, setAnswers] = useState<AnswerStep[]>(sortedInitial);
  useEffect(() => {
    // サーバ再取得/別タブ保存などで initialAnswers が更新された場合にだけ反映
    if (!answersEqual(answers, sortedInitial)) {
      setAnswers(sortedInitial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedInitial]); // answers は依存に入れない（ユーザー入力の直後反映を邪魔しない）

  const [question, setQuestion] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [depth, setDepth] = useState<Depth>(() => DEFAULT_DEPTH_PLAN[chapterIndex]?.[step - 1] ?? 'exec');
  const [answerText, setAnswerText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // cache & inflight
  const fetchedCacheRef = useRef<Record<string, { question: string; reason: string; depth: Depth }>>({});
  const inflightKeyRef = useRef<string | null>(null);

  const isFirstMountRef = useRef(true);
  const lastNotifiedRef = useRef<AnswerStep[] | null>(null);
  const lastStepNotifiedRef = useRef<StepNumber | null>(null);

  // 章変更時は初期化（自動生成なし）
  useEffect(() => {
    const sorted = [...answers].sort((a, b) => a.stepNumber - b.stepNumber);
    let target: StepNumber = 1;
    for (let s: StepNumber = 1 as StepNumber; s <= 3; s = (s + 1) as StepNumber) {
      const rec = sorted.find(a => a.stepNumber === s);
      if (!rec || !String(rec.answer || '').trim()) { target = s; break; }
      target = s;
    }
    setStep(target);
    setDepth(DEFAULT_DEPTH_PLAN[chapterIndex]?.[target - 1] ?? 'exec');
    setQuestion('');
    setReason('');
    setAnswerText('');
    setErrorMsg('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIndex]);

  const previousAnswer = useMemo(() => answers.find(a => a.stepNumber === (step - 1))?.answer || '', [answers, step]);
  const answersSoFarPayload = useMemo(() => answers.map(a => ({ stepNumber: a.stepNumber, answer: a.answer })), [answers]);

  const baseDepth = useMemo<Depth>(() => {
    const plan = DEFAULT_DEPTH_PLAN[chapterIndex] || ['board', 'exec', 'exec'];
    return (plan[step - 1] ?? 'exec') as Depth;
  }, [chapterIndex, step]);

  const previewDepth: Depth = useMemo(
    () => (tempBias === 'abstract' ? 'board' : tempBias === 'concrete' ? 'ops' : 'exec'),
    [tempBias]
  );

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

  const reqKey = useMemo(() => JSON.stringify({
    c: chapterIndex,
    s: step,
    pa: (previousAnswer || '').slice(0, 300),
    b: tempBias,
    l: (lensOverride || []).join(','),
    pf: (portfolioFocus || ''),
  }), [chapterIndex, step, previousAnswer, tempBias, lensOverride, portfolioFocus]);

  // 親通知
  useEffect(() => {
    if (!onChange) return;
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
    onChange({ chapterIndex, answers, currentStep: step });
  }, [answers, chapterIndex, step, onChange]);

  const handleSaveAnswerLocally = useCallback(() => {
    if (!editable) { alert('編集権限がありません（閲覧のみ）'); return; }
    const trimmed = (answerText || '').trim();
    const existingIndex = answers.findIndex(a => a.stepNumber === step);
    const payload: AnswerStep = { stepNumber: step, depth, question, reason, answer: trimmed, createdAt: new Date().toISOString() };
    const next = [...answers];
    if (existingIndex >= 0) next[existingIndex] = payload; else next.push(payload);
    next.sort((a, b) => a.stepNumber - b.stepNumber);
    setAnswers(next);
  }, [answers, step, depth, question, reason, answerText, editable]);

  const canGoNext = (answerText || '').trim().length > 0;
  const isLastStep = step === 3;

  const onClickNext = useCallback(() => {
    if (!editable) { alert('編集権限がありません（閲覧のみ）'); return; }
    if (!canGoNext || loading) return;
    handleSaveAnswerLocally();
    if (!isLastStep) {
      setStep((s) => clampStep(s + 1));
      setAnswerText('');
      setQuestion('');
      setReason('');
      setErrorMsg('');
    }
  }, [editable, canGoNext, loading, handleSaveAnswerLocally, isLastStep]);

  const onRedoFromHere = useCallback(() => {
    if (!editable) { alert('編集権限がありません（閲覧のみ）'); return; }
    const kept = answers.filter(a => a.stepNumber < step);
    setAnswers(kept);
    setAnswerText('');
    setQuestion('');
    setReason('');
    setErrorMsg('');
    const keys = Object.keys(fetchedCacheRef.current);
    for (const k of keys) {
      try {
        const j = JSON.parse(k) as { c:number; s:number; pa:string; b:DepthBias; l?:string; pf?:string };
        if (j.c === chapterIndex && j.s >= step) delete fetchedCacheRef.current[k];
      } catch {}
    }
  }, [answers, step, chapterIndex, editable]);

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

    setLoading(true);
    setErrorMsg('');
    try {
      const depthBiasToSend: DepthBias = tempBias;
      if (forceRegenerate) {
        const keys = Object.keys(fetchedCacheRef.current);
        for (const k of keys) {
          try {
            const j = JSON.parse(k) as { c:number; s:number; pa:string; b:DepthBias; l?:string; pf?:string };
            if (j.c === chapterIndex && j.s === step) delete fetchedCacheRef.current[k];
          } catch {}
        }
      }
      const doFetch = async () => {
        const res = await fetch('/api/generate-question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({
            chapterIndex,
            chapterTitle,
            chapterBody,
            stepNumber: step,
            previousAnswer,
            answersSoFar: answersSoFarPayload,
            depthBias: depthBiasToSend,
            lensOverride: (lensOverride && lensOverride.length) ? lensOverride : undefined,
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
        return JSON.parse(txt) as { step: GeneratedStep };
      };

      let data: { step: GeneratedStep } | null = null;
      try {
        data = await doFetch();
      } catch (e: any) {
        if (e?.code === 429) {
          await new Promise(r => setTimeout(r, 900 + Math.floor(Math.random()*300)));
          data = await doFetch();
        } else {
          throw e;
        }
      }
      if (!data?.step) throw new Error('Invalid response');

      const g = data.step;
      const q = (g.question ?? '').trim();
      const r = (g.reason ?? '').trim();
      const d: Depth = (g.depth as Depth) || (tempBias === 'abstract' ? 'board' : tempBias === 'concrete' ? 'ops' : 'exec');

      setQuestion(q);
      setReason(r);
      setDepth(d);
      setAnswerText(existing?.answer ?? '');
      fetchedCacheRef.current[reqKey] = { question: q, reason: r, depth: d };
    } catch (e: any) {
      setErrorMsg(e?.message || 'エラーが発生しました');
    } finally {
      setLoading(false);
      if (inflightKeyRef.current === reqKey) inflightKeyRef.current = null;
    }
  }, [
    editable, answers, step, chapterIndex, chapterTitle, chapterBody,
    previousAnswer, answersSoFarPayload, mergedContext, tempBias, reqKey, lensOverride
  ]);

  /* === UI === */
  const depthBadge = depthLabel(depth);
  const previewLine = `次に作成する質問の具体性：${depthLabel(previewDepth)}（選択中）`;
  const showOKRHint = chapterIndex === 1 && step === 2;

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* header */}
      <header className="space-y-1">
        <div className="text-sm text-gray-500">
          {meta.label}（Chapter {chapterIndex + 1} / Step {step}） {editable ? '' : '・閲覧のみ'}
        </div>
        <h1 className="text-xl font-semibold">{chapterTitle || meta.label}</h1>
        {meta.goal && <p className="text-gray-600 text-sm">{meta.goal}</p>}
      </header>

      {/* portfolio focus */}
      {hasPortfolio && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
          <div className="text-sm font-medium text-amber-900">事業ポートフォリオ</div>
          <div className="text-xs text-amber-900/80">複数事業の文脈が検出されました。注力対象を選ぶと、当面の問いがその事業に寄ります（未選択=全社視点）。</div>
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
        {[1, 2, 3].map((n) => {
          const sn = clampStep(n);
          const done = answers.some(a => a.stepNumber === sn && a.answer?.trim());
          const active = step === sn;
          return (
            <button
              key={sn}
              onClick={() => {
                if (editable && (answerText || '').trim() && step !== sn) {
                  const exists = answers.find(a => a.stepNumber === step)?.answer ?? '';
                  if (exists.trim() !== (answerText || '').trim()) {
                    const payload: AnswerStep = { stepNumber: step, depth, question, reason, answer: (answerText || '').trim(), createdAt: new Date().toISOString() };
                    const next = [...answers];
                    const idx = next.findIndex(a => a.stepNumber === step);
                    if (idx >= 0) next[idx] = payload; else next.push(payload);
                    next.sort((a, b) => a.stepNumber - b.stepNumber);
                    setAnswers(next);
                  }
                }
                setStep(sn);
                setAnswerText('');
                setQuestion('');
                setReason('');
                setErrorMsg('');
                setDepth(DEFAULT_DEPTH_PLAN[chapterIndex]?.[sn - 1] ?? 'exec');
              }}
              className={[
                'flex-1 rounded-xl border px-3 py-2 text-sm',
                active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50',
                !editable ? 'opacity-80' : ''
              ].join(' ')}
            >
              Step {sn}{done && <span className="ml-1 text-green-600">✓</span>}
            </button>
          );
        })}
      </div>

      {/* depth bias & lens */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-sm font-medium">質問の具体性（次の1問だけ変更できます）</div>
            <p className="text-xs text-gray-500 mt-0.5">既に回答済みのステップには影響しません。好みは選択状態として保持されます。</p>
          </div>
          <div className="text-xs text-gray-600">現在の表示：<span className="font-medium">{depthBadge}</span></div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {([
            { key: 'abstract' as DepthBias, title: '抽象的',     subtitle: '役員向け',           desc: '上位方針や選択の確認。担当・ツール・頻度は含めません。' },
            { key: 'standard' as DepthBias, title: '具体的',     subtitle: '実務向け（標準）',   desc: 'KPIと期限まで具体化。担当やツールは含めません。' },
            { key: 'concrete' as DepthBias, title: 'より具体的', subtitle: '実行設計',           desc: '担当・頻度・ツールまで踏み込みます。' },
          ]).map((opt) => {
            const active = tempBias === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => editable && setTempBias(opt.key)}
                className={[
                  'text-left rounded-xl border p-3 transition',
                  active ? 'border-gray-900 bg-gray-900 text-white shadow-sm' : 'border-gray-200 bg-white hover:bg-gray-50',
                  !editable ? 'opacity-70 cursor-not-allowed' : ''
                ].join(' ')}
                aria-pressed={active}
                disabled={!editable}
                title={`この具体性（${biasLabel(opt.key)}）で作る`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-base font-semibold">{opt.title}</div>
                  {active && <span className="text-xs">選択中</span>}
                </div>
                <div className={['text-xs mt-0.5', active ? 'text-gray-200' : 'text-gray-600'].join(' ')}>{opt.subtitle}</div>
                <div className={['text-xs mt-2 leading-5', active ? 'text-gray-100' : 'text-gray-600'].join(' ')}>{opt.desc}</div>
              </button>
            );
          })}
        </div>

        {showOKRHint && (
          <div className="text-xs text-blue-800 bg-blue-50 rounded-md px-2 py-1">
            Step2では「目指すゴール（Objective）」と、その達成を測る「Key Results（数値＋期限）」を明確にします。
          </div>
        )}

        <div className="space-y-1">
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-medium">レンズ（問い方の流儀）</div>
            <button
              type="button"
              onClick={() => editable && setLensOverride([])}
              className="text-xs text-gray-600 underline decoration-dashed underline-offset-4 hover:text-gray-900 disabled:text-gray-400"
              title="自動選択に戻す"
              disabled={!editable}
            >
              自動選択に戻す
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {LENS_OPTIONS.map((opt) => {
              const active = lensOverride.includes(opt.key);
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => {
                    if (!editable) return;
                    setLensOverride((prev) => prev.includes(opt.key) ? prev.filter(k => k !== opt.key) : [...prev, opt.key]);
                  }}
                  className={[
                    'text-left rounded-xl border p-3 transition text-sm',
                    active ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200 bg-white hover:bg-gray-50',
                    !editable ? 'opacity-70 cursor-not-allowed' : ''
                  ].join(' ')}
                  aria-pressed={active}
                  disabled={!editable}
                >
                  <div className="font-medium">{opt.label}{active && <span className="ml-1 text-indigo-700">✓</span>}</div>
                  <div className="text-xs text-gray-600 mt-0.5">{opt.hint}</div>
                </button>
              );
            })}
          </div>
          <div className="text-xs text-gray-500">※ 指定が無い場合はサーバ側で章・文脈に応じて自動的に選択されます（複数指定可／優先順はサーバ側ロジック）。</div>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-sm text-blue-800 bg-blue-50 rounded-md px-2 py-1">{previewLine}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => generate(false)}
              disabled={loading || !editable}
              className={[
                'rounded-xl px-3 py-2 text-sm font-medium',
                (loading || !editable) ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'
              ].join(' ')}
              title={`この具体性（${biasLabel(tempBias)}）で質問を作る`}
            >
              この細かさで質問を作る
            </button>
            {!String(answers.find(a=>a.stepNumber===step)?.answer || '').trim() && question && (
              <button
                type="button"
                onClick={() => generate(true)}
                disabled={loading || !editable}
                className="rounded-xl px-3 py-2 text-sm font-medium border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-60"
                title="このステップの質問をもう一度作る"
              >
                この問いをもう一度作る
              </button>
            )}
          </div>
        </div>
      </div>

      {/* question card */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="text-sm font-medium">次の問い</div>
          <div className="flex items-center gap-3">{loading && <div className="text-xs text-gray-500">生成中…</div>}</div>
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
            chapterIndex === 1 && step === 2
              ? '例）Objective: 既存大口の継続率を改善する。Key Results: 解約率3.0%→1.8%（FY25 Q4）/ NPS +10pt（FY25 Q3）…'
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
              title="Step3の回答を保存"
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
          {answers.length === 0 && <div className="p-3 text-sm text-gray-500">まだありません</div>}
          {answers.map((a) => (
            <div key={a.stepNumber} className="p-3 text-sm space-y-1">
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
