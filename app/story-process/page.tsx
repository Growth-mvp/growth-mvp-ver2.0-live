// /app/story-process/page.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QuestionStepper, { type AnswerStep as StepperAnswerStep } from '@/components/guide/QuestionStepper';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { saveStrategyData } from '@/utils/supabase';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAccess } from '@/utils/access';

import type { AnswerStep as StrategyAnswerStep } from '@/types/strategy';

/* ===== 型 ===== */
type ChapterStory = { title: string; body: string };
type Depth = 'board' | 'exec' | 'ops';
type ChapterAnswers = { chapterIndex: number; chapterTitle: string; steps: StepperAnswerStep[] };

/* ===== 表示用定数 ===== */
const REFERENCE_TITLES = [
  '第1章：なぜ今（現状）',
  '第2章：どう戦う（戦略）',
  '第3章：どんな未来像（会社の未来像）',
  '第4章：どう行動する（行動）',
] as const;

const FINAL_TITLES = ['なぜ今', 'どう戦う', 'どんな未来像', 'どう行動する'] as const;

const CHAPTER_COLORS = [
  { badge: 'bg-sky-50 text-sky-700 border-sky-200', ring: 'ring-sky-300', border: 'border-sky-200' },
  { badge: 'bg-violet-50 text-violet-700 border-violet-200', ring: 'ring-violet-300', border: 'border-violet-200' },
  { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', ring: 'ring-emerald-300', border: 'border-emerald-200' },
  { badge: 'bg-amber-50 text-amber-700 border-amber-200', ring: 'ring-amber-300', border: 'border-amber-200' },
];

/** 章×Stepの既定粒度（1: board / それ以外: exec、ただし Ch4 Step3 は ops） */
function getDepthFor(chapterIndex: number, stepNumber: number): Depth {
  if (stepNumber === 1) return 'board';
  if (chapterIndex === 3 && stepNumber === 3) return 'ops';
  return 'exec';
}

/* ===== Utils ===== */
function tryParseJson<T = any>(text: string): T | null { try { return JSON.parse(text); } catch { return null; } }
function safeJsonFromText<T = any>(text: string): T | null {
  const direct = tryParseJson<T>(text);
  if (direct && typeof direct === 'object') return direct as T;
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { const obj = tryParseJson<T>(m[0]); if (obj && typeof obj === 'object') return obj as T; }
  if (typeof direct === 'string') {
    const nested = tryParseJson<T>(direct as unknown as string);
    if (nested && typeof nested === 'object') return nested as T;
  }
  return null;
}
function uniqChapters(chs: ChapterStory[]): ChapterStory[] {
  const s = new Set<string>(); const out: ChapterStory[] = [];
  for (const c of chs || []) {
    const key = `${(c?.title || '').trim()}::${(c?.body || '').trim()}`;
    if (!s.has(key)) { s.add(key); out.push(c); }
  }
  return out;
}
function normalizeNewlines(s: string = '') {
  let out = String(s);
  for (let i = 0; i < 3; i++) {
    if (out.includes('\\n')) out = out.replace(/\\n/g, '\n');
    if (out.includes('\\r')) out = out.replace(/\\r/g, '\r');
  }
  out = out.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return out;
}
function ForceMultiline({ text, className }: { text?: string; className?: string }) {
  const normalized = normalizeNewlines(text ?? '');
  return (
    <>
      <div className={`force-multiline ${className || ''}`}>{normalized}</div>
      <style jsx>{`
        .force-multiline {
          white-space: pre-wrap !important;
          word-break: break-word;
          overflow-wrap: anywhere;
          overflow: hidden;
          text-overflow: clip !important;
          display: block;
        }
      `}</style>
    </>
  );
}

/** 文字列のストーリー（長文）→ 4章配列へ近似整形 */
function longformToChapters(s: string): ChapterStory[] {
  const text = normalizeNewlines((s || '').trim());
  if (!text) return [];
  // 「第1章/第2章…」が含まれていれば見出しで分割
  const markerRegex = /(第\s*[1-4]\s*章[^\\n]*)(?:\n+|$)/g;
  const markers = [...text.matchAll(markerRegex)];
  if (markers.length >= 2) {
    const parts: ChapterStory[] = [];
    for (let i = 0; i < markers.length; i++) {
      const start = markers[i].index ?? 0;
      const end = i + 1 < markers.length ? (markers[i + 1].index ?? text.length) : text.length;
      const chunk = text.slice(start, end).trim();
      const title = (markers[i][1] || '').trim();
      const body = chunk.replace(markers[i][1], '').trim();
      parts.push({ title, body });
    }
    return parts.slice(0, 4);
  }
  // なければ段落で等分
  const paras = text.split(/\n{2,}/).map(x => x.trim()).filter(Boolean);
  const chunks = [[], [], [], []] as string[][];
  paras.forEach((p, i) => chunks[i % 4].push(p));
  return chunks.map((arr, i) => ({ title: REFERENCE_TITLES[i], body: arr.join('\n\n') }));
}

function alignToGrowthOrder(chs: ChapterStory[], titlesOverride: readonly string[] = REFERENCE_TITLES): ChapterStory[] {
  const buckets = [
    { keys: ['現状', '危機', '背景', 'なぜ今'] },
    { keys: ['SWOT', '戦略', 'クロス', 'どう戦う', '選択', '非選択'] },
    { keys: ['未来像', '未来', '顧客の風景', 'ビジョン', 'どんな未来像'] },
    { keys: ['社員', '行動', '期待', 'どう行動する', '当事者', '主役'] },
  ];
  const used = new Set<number>();
  const pickByBucket = (b: { keys: string[] }) => {
    let bestIdx = -1; let bestScore = -1;
    chs.forEach((c, idx) => {
      if (used.has(idx)) return;
      const title = (c?.title || '') + (c?.body || '');
      const score = b.keys.reduce((acc, k) => acc + (title.includes(k) ? 1 : 0), 0);
      if (score > bestScore) { bestScore = score; bestIdx = idx; }
    });
    if (bestIdx >= 0) { used.add(bestIdx); return chs[bestIdx]; }
    return null;
  };
  const ordered: ChapterStory[] = [];
  for (let i = 0; i < buckets.length; i++) {
    const m = pickByBucket(buckets[i]); if (m) ordered.push(m);
  }
  chs.forEach((c, i) => { if (!used.has(i)) ordered.push(c); });
  return ordered.slice(0, 4).map((c, i) => ({ ...c, title: titlesOverride[i] ?? c.title }));
}

/** 比較用：ステップ配列を正規化（番号のクランプ禁止） */
const normalizeForCompare = (steps: StepperAnswerStep[]) =>
  [...(steps ?? [])].map(s => ({
    stepNumber: Number(s.stepNumber),
    question: s.question ?? '',
    reason: s.reason ?? '',
    answer: s.answer ?? '',
    depth: (s as any).depth ?? undefined,
  })).sort((a, b) => a.stepNumber - b.stepNumber);

const isStepsEqual = (a: StepperAnswerStep[] = [], b: StepperAnswerStep[] = []) => {
  const A = normalizeForCompare(a), B = normalizeForCompare(b);
  if (A.length !== B.length) return false;
  for (let i = 0; i < A.length; i++) {
    const x = A[i], y = B[i];
    if (x.stepNumber !== y.stepNumber || x.question !== y.question || x.reason !== y.reason || x.answer !== y.answer || (x as any).depth !== (y as any).depth) return false;
  }
  return true;
};

/* ===== StrategyStep ↔ StepperStep 変換 ===== */
const STABLE_TS = '1970-01-01T00:00:00.000Z';

function inflateToStepper(steps: StrategyAnswerStep[] | undefined, chapterIndex: number): StepperAnswerStep[] {
  if (!Array.isArray(steps)) return [];
  return steps
    .filter((s) => s && s.stepNumber != null)
    .map((s) => {
      const sn = Number(s.stepNumber);
      const depth: Depth = (s as any).depth ?? getDepthFor(chapterIndex, sn);
      return {
        stepNumber: sn,
        question: s.question ?? '',
        reason: s.reason ?? '',
        answer: s.answer ?? '',
        depth,
        createdAt: (s as any).createdAt ?? STABLE_TS,
      } as StepperAnswerStep;
    })
    .sort((a, b) => a.stepNumber - b.stepNumber);
}

function deflateToStrategy(steps: StepperAnswerStep[]): StrategyAnswerStep[] {
  return (steps ?? [])
    .map((s) => ({
      stepNumber: Number(s.stepNumber),
      question: s.question ?? '',
      reason: s.reason ?? '',
      answer: s.answer ?? '',
      ...(s as any).depth ? { depth: (s as any).depth } : {},
    } as any as StrategyAnswerStep))
    .sort((a, b) => Number(a.stepNumber) - Number(b.stepNumber));
}

/* ===== ページ ===== */
export default function StoryProcessPage() {
  const { user } = useUserStore();
  const companyId = useUserStore((s) => s.companyId);
  const store = useStrategyStore() as any;

  const { canView, canEditCompany } = useAccess();
  const canEdit = canEditCompany();

  /* ----- 初期スクロール補正：下から始まるのを防ぐ ----- */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const prev = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }));
    return () => { window.history.scrollRestoration = prev; };
  }, []);

  /* ----- 初回リフェッチ（競合に注意） ----- */
  useEffect(() => {
    if (!companyId) return;
    const st: any = useStrategyStore.getState();
    const fn: any = st?.refetchFromServer;
    if (typeof fn === 'function') {
      try {
        if (fn.length >= 1) {
          if (user?.id) fn(user.id);
        } else {
          fn();
        }
      } catch (e) {
        console.warn('refetchFromServer call failed', e);
      }
    }
  }, [companyId, user?.id]);

  const strategyId: string | undefined = store?.strategyId;
  const autoKey = `storyProcess.autoFinal.${strategyId || 'default'}`;

  /* ----- ドラフト参照（storyDraft / story / finalStory の順にフェイルセーフ） ----- */
  const storyDraftMaybe = store?.storyDraft; // 文字列 or 配列の可能性
  const storyRawFromDraft: ChapterStory[] =
    Array.isArray(storyDraftMaybe)
      ? (storyDraftMaybe as ChapterStory[])
      : (typeof storyDraftMaybe === 'string' ? longformToChapters(storyDraftMaybe) : []);

  const storyRawFromStore: ChapterStory[] =
    Array.isArray(store?.story) ? store.story :
    (typeof store?.story === 'string' ? (tryParseJson<ChapterStory[]>(store.story) ?? []) : []);

  const finalRawFromStore: ChapterStory[] =
    Array.isArray(store?.finalStory) ? store.finalStory :
    (typeof store?.finalStory === 'string' ? (tryParseJson<ChapterStory[]>(store.finalStory) ?? []) : []);

  const storyRawArr: ChapterStory[] =
    (storyRawFromDraft.length ? storyRawFromDraft :
     (storyRawFromStore.length ? storyRawFromStore : finalRawFromStore));

  /* ----- 初回だけ sessionStorage から復旧（Step5側フェイルセーフの受け口） ----- */
  const [restoredOnce, setRestoredOnce] = useState(false);
  useEffect(() => {
    if (restoredOnce) return;
    if (storyRawArr.length > 0) { setRestoredOnce(true); return; }

    try {
      const ssDraft = sessionStorage.getItem('growth.storyDraft');
      if (ssDraft && !store?.storyDraft && typeof store?.setStoryDraft === 'function') {
        store.setStoryDraft(ssDraft); // 文字列として保存
      } else if (ssDraft && !store?.story && typeof store?.setStory === 'function') {
        const chs = longformToChapters(ssDraft);
        if (chs.length) store.setStory(chs);
      }
      const ssSummary = sessionStorage.getItem('growth.strategySummary');
      if (ssSummary && typeof store?.setStrategySummary === 'function') {
        store.setStrategySummary(ssSummary);
      }
    } catch {}
    setRestoredOnce(true);
  }, [restoredOnce, storyRawArr.length, store?.setStory, store?.setStoryDraft, store?.setStrategySummary, store?.story, store?.storyDraft]);

  const answers2: ChapterAnswers[] = useMemo(() => {
    const raw = Array.isArray(store?.answers2) ? store.answers2 : [];
    return raw.map((c: any) => ({
      chapterIndex: c?.chapterIndex ?? 0,
      chapterTitle: c?.chapterTitle ?? '',
      steps: inflateToStepper(c?.steps as StrategyAnswerStep[] | undefined, Number(c?.chapterIndex ?? 0)),
    })) as ChapterAnswers[];
  }, [store?.answers2]);

  const {
    mission, vision, value,
    industry, revenue, employees,
    thought, strength, weakness, opportunity, threat,
    csvFinanceData,
    portfolio,
    enhanceEmotion = true, // ★ 追加：魂の補正（デフォルトON）
  } = store ?? {};

  const setStorySafe = (chs: ChapterStory[]) => {
    if (!canEdit) return;
    if (typeof store?.setStory === 'function') store.setStory(chs);
    else (useStrategyStore as any).setState({ story: chs });
  };
  const setFinalStorySafe = (chs: ChapterStory[]) => {
    if (!canEdit) return;
    if (typeof store?.setFinalStory === 'function') store.setFinalStory(chs);
    else (useStrategyStore as any).setState({ finalStory: chs });
  };
  const setAnswers2Safe = (a2: ChapterAnswers[]) => {
    if (!canEdit) return;
    const payload = a2.map((c) => ({
      chapterIndex: c.chapterIndex,
      chapterTitle: c.chapterTitle,
      steps: deflateToStrategy(c.steps),
    }));
    if (typeof store?.setAnswers2 === 'function') store.setAnswers2(payload);
    else (useStrategyStore as any).setState({ answers2: payload });
  };

  const draftArr: ChapterStory[] = useMemo(() => {
    const base = storyRawArr ?? [];
    return alignToGrowthOrder(uniqChapters(base), REFERENCE_TITLES);
  }, [storyRawArr]);

  const finalArrOrderedFromStore: ChapterStory[] = useMemo(() => {
    const base = finalRawFromStore ?? [];
    return alignToGrowthOrder(uniqChapters(base), FINAL_TITLES);
  }, [finalRawFromStore]);

  const referenceArr: ChapterStory[] = draftArr.length ? draftArr : finalArrOrderedFromStore;

  /* ------- 章ごとの上限（子からの通知で拡大反映） ------- */
  const [maxStepsByChapter, setMaxStepsByChapter] = useState<Record<number, number>>({ 0: 2, 1: 6, 2: 2, 3: 2 });

  /* ------- 状態 ------- */
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [finalLoading, setFinalLoading] = useState(false);

  const [currentIdx, setCurrentIdx] = useState(0);
  useEffect(() => {
    const saved = Number(window.localStorage.getItem('storyProcess.currentIdx'));
    const total = Math.max(1, referenceArr.length);
    if (Number.isFinite(saved)) setCurrentIdx(Math.min(Math.max(0, saved), total - 1));
  }, [referenceArr.length]);
  useEffect(() => {
    window.localStorage.setItem('storyProcess.currentIdx', String(currentIdx));
  }, [currentIdx]);

  const TOTAL_STEPS = (maxStepsByChapter[0] ?? 2) + (maxStepsByChapter[1] ?? 6) + (maxStepsByChapter[2] ?? 2) + (maxStepsByChapter[3] ?? 2);

  // 章ごとの「必要数に対して回答済み（非空）」のカウント
  const completedSteps = useMemo(() => {
    let sum = 0;
    for (let ch = 0; ch < 4; ch++) {
      const need = maxStepsByChapter[ch] ?? (ch === 1 ? 6 : 2);
      const steps = (answers2.find(a => a.chapterIndex === ch)?.steps ?? []);
      let done = 0;
      for (let s = 1; s <= need; s++) {
        const rec = steps.find(x => Number(x.stepNumber) === s);
        if (rec && String(rec.answer || '').trim()) done++;
      }
      sum += Math.min(done, need);
    }
    return sum;
  }, [answers2, maxStepsByChapter]);
  const progressPct = Math.round((completedSteps / TOTAL_STEPS) * 100);

  /* ------- 自動保存（デバウンス） ------- */
  const persistTimer = useRef<number | null>(null);
  const persistDebounced = useCallback((
      a2: ChapterAnswers[] = answers2,
      draft: ChapterStory[] = storyRawArr,
      fin: ChapterStory[] = finalRawFromStore
    ) => {
      if (!canEdit || !companyId) return;
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
      persistTimer.current = window.setTimeout(async () => {
        if (!user?.id || !companyId) return;
        try {
          await saveStrategyData(
            {
              strategyId: store?.strategyId,
              story: draft,
              finalStory: fin,
              answers2: (a2 ?? []).map((c) => ({
                chapterIndex: c.chapterIndex,
                chapterTitle: c.chapterTitle,
                steps: deflateToStrategy(c.steps),
              })),
              mission, vision, value,
              industry, revenue, employees,
              thought, strength, weakness, opportunity, threat,
              csvFinanceData,
              portfolio,
              enhanceEmotion, // ★ 追加：状態も保存
            } as any,
            user.id
          );
        } catch (e) {
          console.error('Auto save failed', e);
        }
      }, 800) as unknown as number;
    },
    [
      answers2, csvFinanceData, employees, finalRawFromStore, industry, mission,
      opportunity, revenue, storyRawArr, strength, store?.strategyId, thought, threat,
      user?.id, value, vision, weakness, canEdit, companyId, portfolio, enhanceEmotion,
    ]
  );

  /* ------- Stepper → 親へQ/A同期（丸め禁止） ------- */
  const onStepperChange = useCallback((p: { chapterIndex: number; answers: StepperAnswerStep[]; currentStep: number; maxSteps?: number; }) => {
    if (!canEdit) return;
    const { chapterIndex, answers, maxSteps } = p;

    setMaxStepsByChapter(prev => {
      const prevMax = prev[chapterIndex] ?? (chapterIndex === 1 ? 6 : 2);
      const desired = Math.max(prevMax, Number(maxSteps || 0), (chapterIndex === 1 ? 6 : 0));
      return desired !== prevMax ? { ...prev, [chapterIndex]: desired } : prev;
    });

    const prev = (answers2 ?? []).find(c => c.chapterIndex === chapterIndex);
    if (prev && isStepsEqual(prev.steps, answers)) {
      if (typeof store?.setChapterCurrentStep === 'function') {
        store.setChapterCurrentStep(chapterIndex, Number(p.currentStep));
      }
      return;
    }

    const next = [...(answers2 ?? [])];
    const title = referenceArr[chapterIndex]?.title ?? `Chapter ${chapterIndex + 1}`;

    const withDepthFallback: StepperAnswerStep[] = (answers ?? []).map((s) => {
      const sn = Number(s.stepNumber);
      const depth = (s as any).depth ?? getDepthFor(chapterIndex, sn);
      return { ...s, stepNumber: sn, depth, createdAt: (s as any).createdAt ?? STABLE_TS };
    });

    const idx = next.findIndex((c) => c.chapterIndex === chapterIndex);
    if (idx >= 0) {
      next[idx] = { chapterIndex, chapterTitle: title, steps: withDepthFallback };
    } else {
      next.push({ chapterIndex, chapterTitle: title, steps: withDepthFallback });
    }

    setAnswers2Safe(next);
    persistDebounced(next, draftArr, finalRawFromStore);

    if (typeof store?.setChapterCurrentStep === 'function') {
      store.setChapterCurrentStep(chapterIndex, Number(p.currentStep));
    }
  }, [answers2, persistDebounced, referenceArr, store, canEdit, draftArr, finalRawFromStore]);

  /* ------- Stepper用 共通コンテキスト ------- */
  const stepperBaseContext = useMemo(
    () => ({
      story: referenceArr,
      mission, vision, value,
      strength, weakness, opportunity, threat,
      csvFinanceData,
      portfolio,
    }),
    [referenceArr, mission, vision, value, strength, weakness, opportunity, threat, csvFinanceData, portfolio]
  );

  /* ------- 参考ストーリー生成 ------- */
  const onGenerateDraft = useCallback(async () => {
    if (!canEdit) return;
    setLoadingDraft(true);
    try {
      const res = await fetch('/api/generate-story-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thought, mission, vision, value,
          industry, revenue, employees,
          strength, weakness, opportunity, threat,
          csvFinanceData,
          story: storyRawArr,
          enhanceEmotion, // ★ 追加：魂の補正フラグをAPIへ
        }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`draft api error (${res.status}) ${t}`);
      }

      const text = await res.text();
      const data = safeJsonFromText<any>(text) ?? {};
      const draft: ChapterStory[] = Array.isArray(data?.story)
        ? data.story
        : (typeof data?.story === 'string' ? longformToChapters(data.story) : []);

      const uniq = alignToGrowthOrder(uniqChapters(draft), REFERENCE_TITLES);
      setStorySafe(uniq);
      try { sessionStorage.setItem('growth.storyDraft', JSON.stringify(uniq)); } catch {}
      persistDebounced(answers2, uniq, finalRawFromStore);
    } catch (e) {
      console.error('draft generate failed', e);
      alert('参考ストーリーの生成に失敗しました。');
    } finally {
      setLoadingDraft(false);
    }
  }, [
    answers2, csvFinanceData, employees, finalRawFromStore, industry, mission,
    opportunity, persistDebounced, revenue, setStorySafe, storyRawArr,
    strength, thought, threat, value, vision, weakness, canEdit, enhanceEmotion,
  ]);

  /* ------- 最終ストーリー ------- */
  const finalAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { try { finalAbortRef.current?.abort(); } catch {} }, []);

  const callFinalApi = useCallback(async () => {
    finalAbortRef.current?.abort();
    finalAbortRef.current = new AbortController();
    const signal = finalAbortRef.current.signal;

    const res = await fetch('/api/generate-final-story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        strategyId: store?.strategyId,
        answers2: (answers2 ?? []).map((c) => ({
          chapterIndex: c.chapterIndex,
          chapterTitle: c.chapterTitle,
          steps: deflateToStrategy(c.steps),
        })),
        mission, vision, value,
        industry, revenue, employees,
        thought, strength, weakness, opportunity, threat,
        csvFinanceData,
        portfolio,
        userId: user?.id,
        budgets: { longform: [1600, 2400] },
        enhanceEmotion, // ★ 追加：最終ストーリーも魂の補正をAPIへ
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || 'final story api failed');
    return safeJsonFromText<any>(text) ?? {};
  }, [
    answers2, csvFinanceData, employees, industry, mission, revenue,
    store?.strategyId, thought, threat, user?.id, value, vision, weakness, portfolio, enhanceEmotion,
  ]);

  const onGenerateFinal = useCallback(async () => {
    if (!canEdit) return;
    setFinalLoading(true);
    try {
      const data = await callFinalApi();

      let nextFinalRaw: ChapterStory[] = [];
      if (Array.isArray(data?.finalStory)) {
        nextFinalRaw = data.finalStory;
      } else if (Array.isArray(data?.story)) {
        nextFinalRaw = data.story;
      } else if (Array.isArray(data?.story?.sections)) {
        const secs: Array<{ heading?: string; body?: string }> = data.story.sections;
        nextFinalRaw = secs.slice(0, 4).map((s: any, i: number) => ({
          title: FINAL_TITLES[i] ?? (s?.heading || ''),
          body: String(s?.body || ''),
        }));
      } else if (typeof data?.story === 'string') {
        nextFinalRaw = longformToChapters(data.story).map((c, i) => ({ ...c, title: FINAL_TITLES[i] ?? c.title }));
      }

      const ordered = alignToGrowthOrder(uniqChapters(nextFinalRaw), FINAL_TITLES);
      setFinalStorySafe(ordered);
      try { sessionStorage.setItem('growth.finalStory', JSON.stringify(ordered)); } catch {}
      persistDebounced(answers2, draftArr, ordered);
    } catch (e: any) {
      if (String(e?.message || '').includes('AbortError')) return;
      console.error('final-story error:', e);
      try {
        const parsed = safeJsonFromText<any>(String(e?.message || '')) || {};
        const detail = parsed?.detail?.message || parsed?.error || String(e);
        alert(`最終ストーリー生成に失敗しました。\n${detail}`);
      } catch {
        alert('最終ストーリー生成に失敗しました。');
      }
    } finally {
      setFinalLoading(false);
    }
  }, [answers2, callFinalApi, persistDebounced, setFinalStorySafe, draftArr, canEdit]);

  /* 自動生成トリガ（全12問完了時・一度だけ） */
  const hasAutoTriggeredRef = useRef(false);
  useEffect(() => {
    hasAutoTriggeredRef.current = window.localStorage.getItem(autoKey) === '1';
  }, [autoKey]);
  useEffect(() => {
    const alreadyFinal = finalRawFromStore.length > 0;
    const alreadyAuto = hasAutoTriggeredRef.current;
    const ready = completedSteps >= TOTAL_STEPS;
    if (canEdit && ready && !alreadyFinal && !finalLoading && !alreadyAuto) {
      hasAutoTriggeredRef.current = true;
      try { window.localStorage.setItem(autoKey, '1'); } catch {}
      onGenerateFinal();
    }
  }, [completedSteps, finalRawFromStore.length, finalLoading, autoKey, canEdit, onGenerateFinal, TOTAL_STEPS]);

  /* ===================== 下：質問スライダー ===================== */
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const scrollToIndex = useCallback((idx: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const child = el.querySelector<HTMLElement>(`[data-slide="${idx}"]`);
    if (child) child.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  }, []);
  useEffect(() => { scrollToIndex(currentIdx); }, [currentIdx, scrollToIndex]);

  const Slides = useMemo(() => {
    return referenceArr.slice(0, 4).map((ch: ChapterStory, i: number) => {
      const chapterAns =
        answers2.find((c) => c.chapterIndex === i) ??
        ({ chapterIndex: i, chapterTitle: ch?.title ?? `Chapter ${i + 1}`, steps: [] } as ChapterAnswers);

      const steps: StepperAnswerStep[] = (chapterAns.steps ?? []).map((s) => {
        const sn = Number(s.stepNumber);
        const depth = (s as any).depth ?? getDepthFor(i, sn);
        return { ...s, stepNumber: sn, depth, createdAt: (s as any).createdAt ?? STABLE_TS };
      });

      const color = CHAPTER_COLORS[i % CHAPTER_COLORS.length];

      return (
        <div
          key={`${(ch?.title || '').slice(0,50)}-${i}`}
          data-slide={i}
          className="min-w-full max-w-full shrink-0 snap-start px-2 relative"
        >
          <div
            className="absolute inset-0 z-10 bg-transparent"
            data-locked={!canEdit}
            style={{ pointerEvents: canEdit ? 'none' : 'auto' }}
            title={canEdit ? undefined : '閲覧モード（編集は管理者のみ）'}
            aria-hidden={canEdit ? 'true' : undefined}
          />

          <div className={`space-y-4 rounded-2xl border ${color.border} bg-white/90 p-4 shadow-sm min-w-0 overflow-hidden`}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-zinc-900 break-words">{ch?.title ?? `Chapter ${i + 1}`}</h3>
                <p className="text-[12px] text-zinc-500">{canEdit ? 'この章の質問に回答して、最終ストーリーの精度を高めます。' : '閲覧モード：この章の内容を確認できます。'}</p>
              </div>
            </div>

            <div className="min-w-0 w-full">
              <QuestionStepper
                chapterIndex={i}
                chapterTitle={chapterAns.chapterTitle}
                chapterBody={ch?.body ?? ''}
                initialStep={1}
                initialAnswers={steps}
                context={stepperBaseContext}
                onChange={onStepperChange}
              />
            </div>
          </div>
        </div>
      );
    });
  }, [answers2, onStepperChange, referenceArr, stepperBaseContext, canEdit]);

  /* ===================== Render ===================== */
  if (!canView()) {
    return (
      <div className="mx-auto max-w-5xl px-4 md:px-0 pt-10">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-900">
          閲覧権限がありません。
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl w-full min-w-0 space-y-6 px-4 md:px-0 overflow-x-hidden">
      {/* ヘッダ */}
      <header className="space-y-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="text-[28px] font-semibold tracking-tight text-zinc-900 break-words">STAGE２ 経営戦略策定</h1>
            <p className="text-[13px] text-zinc-500">
              参考ストーリーをたたき台として、各章ごとの質問に回答してください（全12問：第2章は6問）。
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={[
                'inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900',
                canEdit ? 'invisible' : '',
              ].join(' ')}
              title={canEdit ? undefined : 'このページの編集は管理者（Admin）のみ可能です。今は閲覧モードです。'}
              aria-hidden={canEdit ? 'true' : undefined}
            >
              観覧モード（Adminのみ編集可）
            </span>

            <Button
              onClick={onGenerateDraft}
              disabled={loadingDraft || !canEdit}
              className="h-9 rounded-full px-5 text-[13px]"
              title={canEdit ? '' : '管理者のみ実行できます'}
            >
              {loadingDraft ? '生成中…' : storyRawArr.length ? '参考を再生成' : '参考を生成'}
            </Button>

            <Button
              onClick={onGenerateFinal}
              disabled={finalLoading || !canEdit}
              className="h-9 rounded-full px-5 text-[13px]"
              title={canEdit ? '' : '管理者のみ実行できます'}
            >
              {finalLoading ? '最終生成中…' : '最終ストーリーを生成'}
            </Button>
          </div>
        </div>
      </header>

      {/* 参考ストーリー */}
      <section className="rounded-2xl border border-zinc-200 bg-white/80 backdrop-blur-sm p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] min-w-0 overflow-hidden">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold tracking-tight text-zinc-900">参考ストーリー</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 min-w-0">
          {referenceArr.slice(0, 4).map((ch, i) => {
            const chapterAns = answers2.find(a => a.chapterIndex === i);
            const need = maxStepsByChapter[i] ?? (i === 1 ? 6 : 2);
            const steps = chapterAns?.steps ?? [];
            let done = 0;
            for (let s = 1; s <= need; s++) {
              const rec = steps.find(x => Number(x.stepNumber) === s);
              if (rec && String(rec.answer || '').trim()) done++;
            }
            const color = CHAPTER_COLORS[i % CHAPTER_COLORS.length];
            return (
              <article
                key={`${(ch?.title || '').slice(0,50)}-${i}`}
                className={`rounded-2xl p-4 transition shadow-sm border ${color.border} bg-white/90 hover:bg-white ${currentIdx === i ? `ring-2 ${color.ring}` : ''} cursor-pointer min-w-0 overflow-hidden`}
                onClick={() => {
                  setCurrentIdx(i);
                  const el = document.getElementById('question-slider');
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                title="クリックでこの章の質問に移動"
              >
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[15px] font-semibold text-zinc-900">{ch?.title ?? `Chapter ${i + 1}`}</h3>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border ${color.badge}`}>
                    進捗 {done}/{need}
                  </span>
                </div>
                <ForceMultiline text={ch?.body} className="text-[13px] text-zinc-700" />
              </article>
            );
          })}
        </div>
      </section>

      {/* 質問スライダー */}
      <section
        id="question-slider"
        className="rounded-2xl border border-zinc-200 bg-white/80 backdrop-blur-sm p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] min-w-0 overflow-hidden"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold tracking-tight text-zinc-900">章ごとの質問</h2>
          <div className="flex gap-1.5">
            <button
              onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
              className="rounded-full border border-zinc-200 bg-white/90 p-2 shadow-sm hover:bg-white"
              aria-label="前へ"
              type="button"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => setCurrentIdx(Math.min(referenceArr.length - 1, currentIdx + 1))}
              className="rounded-full border border-zinc-200 bg-white/90 p-2 shadow-sm hover:bg-white"
              aria-label="次へ"
              type="button"
            >
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div
          ref={scrollerRef}
          className="x-scroll flex snap-x snap-mandatory overflow-x-auto scroll-smooth w-full min-w-0"
        >
          {Slides}
        </div>

        <style jsx>{`
          .x-scroll { -ms-overflow-style: none; scrollbar-width: none; }
          .x-scroll::-webkit-scrollbar { display: none; }
        `}</style>

        <div className="mt-5">
          <div className="h-1.5 w-full rounded-full bg-zinc-200 overflow-hidden">
            <div className="h-1.5 bg-zinc-400 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="mt-1 text-[12px] text-zinc-600">
            全体進捗：{completedSteps}/{TOTAL_STEPS}
          </p>
        </div>
      </section>

      {/* 最終ストーリー */}
      <FinalStorySection
        canEdit={canEdit}
        finalLoading={finalLoading}
        onGenerateFinal={onGenerateFinal}
        finalRawArrFromStore={finalArrOrderedFromStore}
        draftArr={draftArr}
        persistDebounced={persistDebounced}
        setFinalStorySafe={setFinalStorySafe}
      />
    </div>
  );
}

/* ------- 別コンポーネント化（見通し優先） ------- */
function FinalStorySection({
  canEdit,
  finalLoading,
  onGenerateFinal,
  finalRawArrFromStore,
  draftArr,
  persistDebounced,
  setFinalStorySafe,
}: {
  canEdit: boolean;
  finalLoading: boolean;
  onGenerateFinal: () => void;
  finalRawArrFromStore: ChapterStory[];
  draftArr: ChapterStory[];
  persistDebounced: (a2?: ChapterAnswers[], draft?: ChapterStory[], fin?: ChapterStory[]) => void;
  setFinalStorySafe: (chs: ChapterStory[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftEdit, setDraftEdit] = useState<ChapterStory[]>([]);

  const baseArr = finalRawArrFromStore.length ? finalRawArrFromStore : draftArr;

  useEffect(() => {
    if (!editing) return;
    setDraftEdit(baseArr.map(c => ({ ...c })));
  }, [editing, baseArr]);

  const totalChars = (draftEdit || []).reduce((sum, c) => sum + (c?.body?.length || 0), 0);
  const withinBudget = totalChars >= 1600 && totalChars <= 2400;

  const applySaveEdits = async () => {
    const clean = draftEdit.map((c, i) => ({ title: FINAL_TITLES[i] ?? c.title, body: c.body || '' }));
    setFinalStorySafe(clean);
    try { sessionStorage.setItem('growth.finalStory', JSON.stringify(clean)); } catch {}
    persistDebounced(undefined, undefined, clean);
    setEditing(false);
  };

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white/80 backdrop-blur-sm p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] min-w-0 overflow-hidden">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-semibold tracking-tight text-zinc-900">最終ストーリー</h2>
        <div className="flex items-center gap-2">
          {baseArr.length > 0 && (
            <Button
              onClick={() => canEdit && setEditing(e => !e)}
              disabled={!canEdit}
              className="h-9 rounded-full px-5 text-[13px]"
              variant={editing ? 'secondary' : ('default' as any)}
              title={canEdit ? '' : '管理者のみ編集できます'}
            >
              {editing ? '編集をやめる' : '編集'}
            </Button>
          )}
          <Button
            onClick={onGenerateFinal}
            disabled={finalLoading || !canEdit}
            className="h-9 rounded-full px-5 text-[13px]"
            title={canEdit ? '' : '管理者のみ実行できます'}
          >
            {finalLoading ? '再生成中…' : '最終ストーリーを再生成'}
          </Button>
        </div>
      </div>

      {baseArr.length === 0 ? (
        <p className="mt-2 text-[13px] text-zinc-600">全12問（第2章は6問）を回答すると、自動で一度だけ生成されます。</p>
      ) : !editing ? (
        <div className="mt-3 grid grid-cols-1 gap-4">
          {baseArr.map((c: ChapterStory, idx: number) => (
            <article
              key={`${(c.title || '').slice(0,50)}-${idx}`}
              className="rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm min-w-0 overflow-hidden"
            >
              <h4 className="mb-2 text-[15px] font-semibold text-zinc-900 break-words">{c.title}</h4>
              <ForceMultiline text={c.body} className="text-[13px] text-zinc-700" />
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-4">
          {draftEdit.map((c, idx) => (
            <div key={`edit-${idx}`} className="rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm">
              <h4 className="mb-2 text-[15px] font-semibold text-zinc-900">{FINAL_TITLES[idx] ?? c.title}</h4>
              <textarea
                value={c.body}
                onChange={(e) => {
                  const next = [...draftEdit];
                  next[idx] = { ...next[idx], body: e.target.value };
                  setDraftEdit(next);
                }}
                placeholder="この章の本文を編集…"
                className="w-full min-h-[180px] rounded-lg border border-zinc-300 p-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-zinc-400"
                disabled={!canEdit}
              />
              <div className="mt-1 text-[11px] text-zinc-600">文字数：{c.body.length}（各章の目安 300〜650 字）</div>
            </div>
          ))}

          <div className="flex items-center justify-between">
            <div className={`text-[12px] ${withinBudget ? 'text-emerald-600' : 'text-amber-600'}`}>
              合計文字数：{totalChars}（推奨 1600〜2400）
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => setEditing(false)} variant="secondary" className="h-9 rounded-full px-5 text-[13px]">
                取消
              </Button>
              <Button onClick={applySaveEdits} disabled={!withinBudget || !canEdit} className="h-9 rounded-full px-5 text-[13px]">
                保存
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
