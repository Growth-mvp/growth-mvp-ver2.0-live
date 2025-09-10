// /app/story-process/page.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QuestionStepper, { type AnswerStep as StepperAnswerStep } from '@/components/guide/QuestionStepper';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { saveStrategyData } from '@/utils/supabase';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAccess } from '@/utils/access'; // Cookie/Store ベースの権限

// ストア/永続化側で使う公式型（createdAt/depth が無い想定）
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

/** 章×Stepの既定粒度（QuestionStepper側と同期） */
const DEFAULT_DEPTH_PLAN: Depth[][] = [
  ['board', 'exec', 'exec'],
  ['board', 'exec', 'exec'],
  ['board', 'exec', 'exec'],
  ['board', 'exec', 'ops'],
];

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

const clampStepNumber = (n: any): 1|2|3 => {
  const x = Number(n); if (!Number.isFinite(x)) return 1; if (x <= 1) return 1; if (x >= 3) return 3; return 2;
};

const normalizeForCompare = (steps: StepperAnswerStep[]) =>
  [...(steps ?? [])].map(s => ({
    stepNumber: clampStepNumber(s.stepNumber),
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

// Stepper で必須の createdAt/depth を補完
const STABLE_TS = '1970-01-01T00:00:00.000Z';
function inflateToStepper(steps: StrategyAnswerStep[] | undefined, chapterIndex: number): StepperAnswerStep[] {
  if (!Array.isArray(steps)) return [];
  const plan = DEFAULT_DEPTH_PLAN[chapterIndex] || ['board', 'exec', 'exec'];
  return steps
    .filter((s) => s && s.stepNumber != null)
    .map((s) => {
      const sn = clampStepNumber(s.stepNumber as any);
      const depth: Depth = (s as any).depth ?? plan[(sn - 1) as 0|1|2];
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

// 保存用に不要な createdAt を落とす（depth は保持）
function deflateToStrategy(steps: StepperAnswerStep[]): StrategyAnswerStep[] {
  return (steps ?? [])
    .map((s) => ({
      stepNumber: clampStepNumber(s.stepNumber),
      question: s.question ?? '',
      reason: s.reason ?? '',
      answer: s.answer ?? '',
      // depth は types/strategy 側に存在しない場合もあるが JSON 保存時に付いていても問題ないため as any
      ...(s as any).depth ? { depth: (s as any).depth } : {},
    } as any as StrategyAnswerStep))
    .sort((a, b) => Number(a.stepNumber) - Number(b.stepNumber));
}

/* ===== ページ ===== */
export default function StoryProcessPage() {
  const { user } = useUserStore();
  const companyId = useUserStore((s) => s.companyId); // ← companyId確定トリガ
  const store = useStrategyStore() as any;

  // アクセス（閲覧はOK、編集は会社レベルAdminのみ）
  const { canView, canEditCompany } = useAccess();
  const canEdit = canEditCompany();

  // companyId 確定時にサーバ再取得（strategy-store 新旧API両対応）
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

  const storyRawArr: ChapterStory[] =
    Array.isArray(store?.story) ? store.story :
    (typeof store?.story === 'string' ? (tryParseJson<ChapterStory[]>(store.story) ?? []) : []);

  const finalRawArr: ChapterStory[] =
    Array.isArray(store?.finalStory) ? store.finalStory :
    (typeof store?.finalStory === 'string' ? (tryParseJson<ChapterStory[]>(store.finalStory) ?? []) : []);

  // ★ ストア answers2 は StrategyAnswerStep[] の可能性があるため、内部型は StepperAnswerStep[] に統一
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
  } = store ?? {};

  const setStorySafe = (chs: ChapterStory[]) => {
    if (!canEdit) return; // 非Adminはローカルstore変更による保存を抑止
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
    // 永続化は StrategyAnswerStep[] 互換の形に変換して保存
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

  const finalArr: ChapterStory[] = useMemo(() => {
    const base = finalRawArr ?? [];
    return alignToGrowthOrder(uniqChapters(base), FINAL_TITLES);
  }, [finalRawArr]);

  const referenceArr: ChapterStory[] = draftArr.length ? draftArr : finalArr;

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

  const TOTAL_STEPS = 12;
  const completedSteps = useMemo(
    () => (answers2 ?? []).reduce((sum, c) => sum + Math.min((c?.steps?.length ?? 0), 3), 0),
    [answers2]
  );
  const progressPct = Math.round((completedSteps / TOTAL_STEPS) * 100);

  /* ------- 自動保存（デバウンス） ------- */
  const persistTimer = useRef<number | null>(null);
  const persistDebounced = useCallback((
      a2: ChapterAnswers[] = answers2,
      draft: ChapterStory[] = storyRawArr,
      fin: ChapterStory[] = finalRawArr
    ) => {
      // 非Admin または companyId 未確定は保存しない（company 起点に統一）
      if (!canEdit || !companyId) return;
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
      persistTimer.current = window.setTimeout(async () => {
        if (!user?.id || !companyId) return;
        try {
          await saveStrategyData(
            {
              strategyId,
              story: draft,
              finalStory: fin,
              // StrategyAnswerStep 互換ペイロードに整形
              answers2: (a2 ?? []).map((c) => ({
                chapterIndex: c.chapterIndex,
                chapterTitle: c.chapterTitle,
                steps: deflateToStrategy(c.steps),
              })),
              mission, vision, value,
              industry, revenue, employees,
              thought, strength, weakness, opportunity, threat,
              csvFinanceData,
            } as any,
            user.id
          );
        } catch (e) {
          console.error('Auto save failed', e);
        }
      }, 800) as unknown as number;
    },
    [
      answers2, csvFinanceData, employees, finalRawArr, industry, mission,
      opportunity, revenue, storyRawArr, strength, strategyId, thought, threat,
      user?.id, value, vision, weakness, canEdit, companyId,
    ]
  );

  /* ------- Stepper → 親へQ/A同期 ------- */
  const onStepperChange = useCallback((p: { chapterIndex: number; answers: StepperAnswerStep[]; currentStep: 1|2|3; }) => {
    if (!canEdit) return; // 非Adminは編集イベントを無視
    const { chapterIndex, answers, currentStep } = p;

    const prev = (answers2 ?? []).find(c => c.chapterIndex === chapterIndex);
    if (prev && isStepsEqual(prev.steps, answers)) {
      if (typeof store?.setChapterCurrentStep === 'function') {
        store.setChapterCurrentStep(chapterIndex, currentStep);
      }
      return;
    }

    // depth/createdAt を含む StepperAnswerStep[] をそのまま内部状態として持つ
    const next = [...(answers2 ?? [])];
    const title = referenceArr[chapterIndex]?.title ?? `Chapter ${chapterIndex + 1}`;

    const withDepthFallback: StepperAnswerStep[] = (answers ?? []).map((s) => {
      const sn = clampStepNumber(s.stepNumber);
      if ((s as any).depth) {
        // createdAt が未定義なら固定付与
        return (s.stepNumber === sn) ? { ...s, createdAt: (s as any).createdAt ?? STABLE_TS } :
          { ...s, stepNumber: sn, createdAt: (s as any).createdAt ?? STABLE_TS };
      }
      const plan = DEFAULT_DEPTH_PLAN[chapterIndex] || ['board','exec','exec'];
      const fallbackDepth = plan[(sn - 1) as 0|1|2];
      return { ...s, stepNumber: sn, depth: fallbackDepth, createdAt: (s as any).createdAt ?? STABLE_TS };
    });

    const idx = next.findIndex((c) => c.chapterIndex === chapterIndex);
    if (idx >= 0) {
      next[idx] = { chapterIndex, chapterTitle: title, steps: withDepthFallback };
    } else {
      next.push({ chapterIndex, chapterTitle: title, steps: withDepthFallback });
    }

    setAnswers2Safe(next);            // ← 永続化向けに deflate 済みで保存
    persistDebounced(next, draftArr, finalArr); // 最新を保存

    if (typeof store?.setChapterCurrentStep === 'function') {
      store.setChapterCurrentStep(chapterIndex, currentStep);
    }
  }, [answers2, persistDebounced, referenceArr, store, canEdit, draftArr, finalArr]);

  /* ------- Stepper用 共通コンテキスト ------- */
  const stepperBaseContext = useMemo(
    () => ({
      story: referenceArr,
      mission, vision, value,
      strength, weakness, opportunity, threat,
      csvFinanceData,
    }),
    [referenceArr, mission, vision, value, strength, weakness, opportunity, threat, csvFinanceData]
  );

  /* ------- 参考ストーリー生成 ------- */
  const onGenerateDraft = useCallback(async () => {
    if (!canEdit) return; // 非Adminは実行不可
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
        }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`draft api error (${res.status}) ${t}`);
      }

      const text = await res.text();
      const data = safeJsonFromText<any>(text) ?? {};
      const draft: ChapterStory[] = Array.isArray(data?.story) ? data.story : [];

      const uniq = alignToGrowthOrder(uniqChapters(draft), REFERENCE_TITLES);
      setStorySafe(uniq);
      // 最新の uniq / finalArr で保存
      persistDebounced(answers2, uniq, finalArr);
    } catch (e) {
      console.error('draft generate failed', e);
      alert('参考ストーリーの生成に失敗しました。');
    } finally {
      setLoadingDraft(false);
    }
  }, [
    answers2, csvFinanceData, employees, finalArr, industry, mission,
    opportunity, persistDebounced, revenue, setStorySafe, storyRawArr,
    strength, thought, threat, value, vision, weakness, canEdit,
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
        strategyId,
        answers2: (answers2 ?? []).map((c) => ({
          chapterIndex: c.chapterIndex,
          chapterTitle: c.chapterTitle,
          steps: deflateToStrategy(c.steps),
        })),
        mission, vision, value,
        industry, revenue, employees,
        thought, strength, weakness, opportunity, threat,
        csvFinanceData,
        userId: user?.id,
        budgets: { longform: [1600, 2400] },
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || 'final story api failed');
    return safeJsonFromText<any>(text) ?? {};
  }, [
    answers2, csvFinanceData, employees, industry, mission, revenue,
    strategyId, thought, threat, user?.id, value, vision, weakness,
  ]);

  const onGenerateFinal = useCallback(async () => {
    if (!canEdit) return; // 非Adminは実行不可
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
      }

      const ordered = alignToGrowthOrder(uniqChapters(nextFinalRaw), FINAL_TITLES);
      setFinalStorySafe(ordered);
      // 最新の ordered / draftArr で保存
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

  // 自動生成は Admin のみ
  const hasAutoTriggeredRef = useRef(false);
  useEffect(() => {
    hasAutoTriggeredRef.current = window.localStorage.getItem(autoKey) === '1';
  }, [autoKey]);
  useEffect(() => {
    const ready = referenceArr.length >= 4 && completedSteps >= 12;
    const alreadyFinal = finalRawArr.length > 0;
    const alreadyAuto = hasAutoTriggeredRef.current;
    if (canEdit && ready && !alreadyFinal && !finalLoading && !alreadyAuto) {
      hasAutoTriggeredRef.current = true;
      try { window.localStorage.setItem(autoKey, '1'); } catch {}
      onGenerateFinal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedSteps, referenceArr.length, finalRawArr.length, finalLoading, autoKey, canEdit]);

  /* ===== 編集UI（最終ストーリー） ===== */
  const [editing, setEditing] = useState(false);
  const [draftEdit, setDraftEdit] = useState<ChapterStory[]>([]);
  useEffect(() => {
    if (!editing) return;
    setDraftEdit(finalArr.map(c => ({ ...c })));
  }, [editing, finalArr]);

  const totalChars = (draftEdit || []).reduce((sum, c) => sum + (c?.body?.length || 0), 0);
  const withinBudget = totalChars >= 1600 && totalChars <= 2400;

  const applySaveEdits = async () => {
    if (!canEdit) return; // 非Adminは保存不可
    const clean = draftEdit.map((c, i) => ({ title: FINAL_TITLES[i] ?? c.title, body: c.body || '' }));
    setFinalStorySafe(clean);
    persistDebounced(answers2, draftArr, clean);
    setEditing(false);
  };

  /* ===== UI ===== */
  const ReferenceMatrix = () => (
    <section className="rounded-2xl border border-zinc-200 bg-white/80 backdrop-blur-sm p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] min-w-0 overflow-hidden">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[17px] font-semibold tracking-tight text-zinc-900">参考ストーリー</h2>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 min-w-0">
        {referenceArr.slice(0, 4).map((ch, i) => {
          const chapterAns = answers2.find(a => a.chapterIndex === i);
          const done = Math.min(chapterAns?.steps?.length ?? 0, 3);
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
                  進捗 {done}/3
                </span>
              </div>
              <ForceMultiline text={ch?.body} className="text-[13px] text-zinc-700" />
            </article>
          );
        })}
      </div>
    </section>
  );

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

      // ここで StepperAnswerStep[] を保証（inflate済みのため OK）
      const steps: StepperAnswerStep[] = (chapterAns.steps ?? []).map((s) => {
        const sn = clampStepNumber(s.stepNumber);
        if ((s as any).depth) {
          return (s.stepNumber === sn) ? s : { ...s, stepNumber: sn };
        }
        const plan = DEFAULT_DEPTH_PLAN[i] || ['board','exec','exec'];
        const depth = plan[(sn - 1) as 0|1|2];
        return { ...s, stepNumber: sn, depth, createdAt: (s as any).createdAt ?? STABLE_TS };
      });

      const color = CHAPTER_COLORS[i % CHAPTER_COLORS.length];

      return (
        <div
          key={`${(ch?.title || '').slice(0,50)}-${i}`}
          data-slide={i}
          className="min-w-full max-w-full shrink-0 snap-start px-2 relative"
        >
          {/* ★ 要素型を固定するため常にオーバーレイを描画し、属性だけ切り替える */}
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

  // 閲覧不可（通常は middleware で弾かれるが保険）
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
              参考ストーリーをたたき台として、各章ごとの質問に回答してください。
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* 閲覧モードバッジ：要素型を固定（常に描画し可視性だけ切替） */}
            <span
              className={[
                'inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900',
                canEdit ? 'invisible' : '',
              ].join(' ')}
              title={canEdit ? undefined : 'このページの編集は管理者（Admin）のみ可能です。今は閲覧モードです。'}
              aria-hidden={canEdit ? 'true' : undefined}
            >
              閲覧モード（Adminのみ編集可）
            </span>

            {/* 参考を生成（Adminのみ有効） */}
            <Button
              onClick={onGenerateDraft}
              disabled={loadingDraft || !canEdit}
              className="h-9 rounded-full px-5 text-[13px]"
              title={canEdit ? '' : '管理者のみ実行できます'}
            >
              {loadingDraft ? '生成中…' : storyRawArr.length ? '参考を再生成' : '参考を生成'}
            </Button>

            {/* 最終ストーリー生成（Adminのみ有効） */}
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

      {/* 参考ストーリー（4章マトリクス） */}
      <ReferenceMatrix />

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

      {/* 最終ストーリー（短い4見出し＆編集対応） */}
      <section className="rounded-2xl border border-zinc-200 bg-white/80 backdrop-blur-sm p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] min-w-0 overflow-hidden">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-semibold tracking-tight text-zinc-900">最終ストーリー</h2>
          <div className="flex items-center gap-2">
            {finalArr.length > 0 && (
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

        {finalArr.length === 0 ? (
          <p className="mt-2 text-[13px] text-zinc-600">4章をすべて3問ずつ回答すると、一度だけ自動で生成されます。</p>
        ) : !editing ? (
          <div className="mt-3 grid grid-cols-1 gap-4">
            {finalArr.map((c: ChapterStory, idx: number) => (
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
    </div>
  );
}
