// /components/steps/Step5Confirm.tsx
'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import StepLayout from '@/components/StepLayout';
import { getIndustryLabel } from '@/utils/industryTemplates';
import FinanceSummaryPanel from '@/components/finance/FinanceSummaryPanel';
import { saveStrategyData as saveStrategyDataApi } from '@/utils/supabase/strategy';

/* =========================================================
 * 確認画面（生成→保存→遷移の堅牢化・名前空間つき）
 * ========================================================= */

const ssKey = (base: string, companyId?: string | null, strategyId?: string | null) =>
  `growth.${companyId || 'co'}.${strategyId || 'stg'}.${base}`;

function notifySafe(store: any, msg: string, setLocal: (s: string) => void) {
  if (typeof store?.setNotification === 'function') {
    try {
      store.setNotification(msg);
      return;
    } catch {}
  }
  setLocal(msg);
}

function safeJsonFromText<T = any>(text: string): T | null {
  try {
    const direct = JSON.parse(text);
    if (direct && typeof direct === 'object') return direct as T;
  } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const obj = JSON.parse(m[0]);
      if (obj && typeof obj === 'object') return obj as T;
    } catch {}
  }
  return null;
}

function normalizeNewlines(s: string = '') {
  let out = String(s);
  for (let i = 0; i < 3; i++) {
    if (out.includes('\\n')) out = out.replace(/\\n/g, '\n');
    if (out.includes('\\r')) out = out.replace(/\\r/g, '\r');
  }
  return out.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function longformToChapters(s: string) {
  const text = normalizeNewlines((s || '').trim());
  if (!text) return [] as { title: string; body: string }[];
  const markerRegex = /^(?:#{1,3}\s*)?(第\s*[1-4]\s*章[^\n\r]*)(?:\r?\n+|$)/gim;
  const markers = [...text.matchAll(markerRegex)];
  if (markers.length >= 2) {
    const parts: { title: string; body: string }[] = [];
    for (let i = 0; i < markers.length; i++) {
      const start = markers[i].index ?? 0;
      const end = i + 1 < markers.length ? (markers[i + 1].index ?? text.length) : text.length;
      const chunk = text.slice(start, end).trim();
      const title = (markers[i][1] || '').trim();
      const titleEscaped = markers[i][0];
      const body = chunk.replace(titleEscaped, '').trim();
      parts.push({ title, body });
    }
    return parts.slice(0, 4);
  }
  const REFERENCE_TITLES = [
    '第1章：なぜ今（現状）',
    '第2章：どう戦う（戦略）',
    '第3章：どんな未来像（会社の未来像）',
    '第4章：どう行動する（行動）',
  ] as const;
  const paras = text.split(/\n{2,}/).map(x => x.trim()).filter(Boolean);
  const chunks = [[], [], [], []] as string[][];
  paras.forEach((p, i) => chunks[i % 4].push(p));
  return chunks.map((arr, i) => ({ title: REFERENCE_TITLES[i], body: arr.join('\n\n') }));
}

type Extracted = {
  longform?: string;
  chapters?: Array<{ title: string; body: string }>;
  summary?: unknown;
};

function extractStoryAndSummary(payload: any): Extracted {
  if (!payload || typeof payload !== 'object') return {};
  let storyAny =
    payload.story ??
    payload.draft ??
    payload.finalStory ??
    payload.result ??
    payload.content ??
    undefined;

  if (!storyAny && Array.isArray(payload.choices) && payload.choices[0]?.message?.content) {
    storyAny = payload.choices[0].message.content;
  }
  if (!storyAny && payload?.story?.sections) {
    const secs = payload.story.sections as Array<{ heading?: string; body?: string }>;
    if (Array.isArray(secs)) {
      return {
        chapters: secs.slice(0, 4).map((s, i) => ({
          title: ['なぜ今', 'どう戦う', 'どんな未来像', 'どう行動する'][i] ?? (s?.heading || ''),
          body: String(s?.body || ''),
        })),
        summary: payload.summary ?? payload.strategySummary ?? payload.overview ?? undefined,
      };
    }
  }

  let longform: string | undefined;
  let chapters: Array<{ title: string; body: string }> | undefined;

  if (typeof storyAny === 'string') {
    longform = storyAny;
  } else if (Array.isArray(storyAny)) {
    chapters = storyAny;
  } else if (storyAny && typeof storyAny === 'object' && typeof storyAny.text === 'string') {
    longform = storyAny.text;
  }

  const summary =
    payload.summary ??
    payload.strategySummary ??
    payload.overview ??
    (Array.isArray(payload.choices) ? payload.choices[0]?.message?.summary : undefined);

  return { longform, chapters, summary };
}

function GlassCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white/60 shadow-sm backdrop-blur-md ring-1 ring-black/5">
      <div className="p-4 md:p-5">
        <h3 className="mb-3 text-sm font-semibold text-gray-800">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="min-w-[8rem] shrink-0 text-xs text-gray-500">{label}</span>
      <span className="grow text-sm text-gray-800">
        {value !== undefined && value !== null && String(value) !== '' ? String(value) : '（未入力）'}
      </span>
    </div>
  );
}

export default function Step5Confirm() {
  const router = useRouter();
  const st = useStrategyStore() as any;

  const userId = useUserStore((s) => s.user?.id ?? null);
  const companyId = useUserStore((s) => s.companyId ?? null);
  const hydrated = useUserStore((s) => s.hydrated ?? false);
  const membershipLoaded = useUserStore((s) => s.membershipLoaded ?? false);
  const canPersist = !!userId && !!companyId && !!hydrated && !!membershipLoaded;

  const strategyId = st?.strategyId ?? null;

  const [isGenerating, setIsGenerating] = useState(false);
  const [localNotice, setLocalNotice] = useState('');

  const companyName: string = st?.companyName ?? '';
  const foundationYear: number | null = st?.foundationYear ?? null;
  const location: string = st?.location ?? '';
  const industry: string = st?.industry ?? '';
  const revenue: number | null = st?.revenue ?? null;
  const employees: number | null = st?.employees ?? null;
  const businessContent: string = st?.businessContent ?? '';
  const customerSegment: string = st?.customerSegment ?? '';

  const thought: string = st?.thought ?? '';
  const strength: string = st?.strength ?? '';
  const weakness: string = st?.weakness ?? '';
  const opportunity: string = st?.opportunity ?? '';
  const threat: string = st?.threat ?? '';

  const mission: string = st?.mission ?? '';
  const vision: string = st?.vision ?? '';
  const value: string = st?.value ?? '';

  const csvFinanceData: any[] = Array.isArray(st?.csvFinanceData) ? st.csvFinanceData : [];
  const answers: any = st?.answers ?? null;
  const answers2: any = st?.answers2 ?? null;
  const financeSummary: any[] = Array.isArray(st?.financeSummary) ? st.financeSummary : [];

  const industryJa = industry ? getIndustryLabel(industry, { full: true }) : '';

  const summaryYears = useMemo(
    () => Array.from(new Set(financeSummary.map((r: any) => r?.year))).filter(Boolean).sort(),
    [financeSummary]
  );
  const summaryYearsLatest = summaryYears.length ? summaryYears[summaryYears.length - 1] : undefined;

  const handleGenerate = async () => {
    if (isGenerating) return;

    if (!canPersist) {
      notifySafe(
        st,
        '会社スコープの解決中です。生成は実行し、保存はスコープ確立後にもう一度行ってください。',
        setLocalNotice
      );
    }

    setIsGenerating(true);
    setLocalNotice('');

    const endpoints = [
      '/api/generate-story-draft-v2',
      '/api/generate-story-draft',
      '/api/final-story',
    ];

    const payload = {
      thought, mission, vision, value,
      industry, industryLabel: industryJa,
      revenue, employees,
      businessContent, customerSegment,
      strength, weakness, opportunity, threat,
      csvFinanceData, answers, answers2,
      financeSummary, companyName, foundationYear, location,
      strategyId, companyId, userId,
    };

    const pickChapters = (rawText: string, parsed: any) => {
      const extracted = extractStoryAndSummary(parsed || {});
      const { longform, chapters } = extracted;
      if (Array.isArray(chapters) && chapters.length) return chapters.slice(0, 4);
      const text = typeof longform === 'string' && longform.trim().length > 0 ? longform : rawText;
      return longformToChapters(text || '');
    };

    const toSummaryText = (s: any): string => {
      if (!s) return '';
      if (typeof s === 'string') return s.trim();
      if (typeof s === 'object') {
        const head = s.tagline ? String(s.tagline).trim() : '';
        const bullets = Array.isArray(s.bullets) ? s.bullets.map((b: any) => `- ${String(b)}`) : [];
        return [head, ...bullets].filter(Boolean).join('\n');
      }
      return '';
    };

    let lastErrorText = '';
    try {
      let ok = false;
      let finalChapters: Array<{ title: string; body: string }> | null = null;
      let finalSummary: any;

      for (const url of endpoints) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          const raw = await res.text();
          if (!res.ok) {
            lastErrorText = `[${res.status}] ${raw?.slice(0, 500) || '(no body)'}`;
            if (res.status === 404) continue;
            throw new Error(lastErrorText);
          }

          const parsed = safeJsonFromText<any>(raw) ?? {};
          const extracted = extractStoryAndSummary(parsed);
          finalSummary = extracted.summary;

          const chs = pickChapters(raw, parsed);
          if (Array.isArray(chs) && chs.length > 0) {
            finalChapters = chs;
            ok = true;
            break;
          } else {
            lastErrorText = `no-story-in-response (endpoint: ${url}) first500="${(raw || '').slice(0, 500)}"`;
          }
        } catch (e: any) {
          lastErrorText = String(e?.message || e);
        }
      }

      if (!ok || !finalChapters?.length) {
        console.error('❌ 生成に失敗: ', lastErrorText);
        notifySafe(st, `❌ ストーリー生成に失敗しました: ${lastErrorText}`, setLocalNotice);
        return;
      }

      if (typeof st?.setStory === 'function') st.setStory(finalChapters);
      (useStrategyStore as any).setState({
        story: finalChapters,
        storyChapters: finalChapters,
        chapters: finalChapters,
      });

      try {
        if (companyId && strategyId) {
          sessionStorage.setItem(ssKey('story', companyId, strategyId), JSON.stringify(finalChapters));
          const summaryText = toSummaryText(finalSummary);
          if (summaryText) {
            sessionStorage.setItem(ssKey('strategySummary', companyId, strategyId), summaryText);
          }
        }
      } catch {}

      if (canPersist) {
        try {
          const current = useStrategyStore.getState() as any;
          const patch = {
            strategyId,
            story: finalChapters,
            mission, vision, value,
            industry, revenue, employees,
            thought, strength, weakness, opportunity, threat,
            csvFinanceData,
            answers2,
          };
          await saveStrategyDataApi({ ...current, ...patch }, userId!, companyId!);
        } catch (e) {
          console.warn('saveStrategyData failed (draft story persisted only to session/store):', e);
        }
      } else {
        notifySafe(st, '保存はスコープ確立後に再実行してください（生成内容は画面内/セッションに保持）', setLocalNotice);
      }

      router.push('/story-process');
    } catch (err) {
      console.error('❌ 通信エラー:', err);
      notifySafe(st, `❌ 通信エラー: ${String((err as any)?.message || err)}`, setLocalNotice);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <StepLayout step={6} totalSteps={6} title="入力内容の最終確認">
      <div className="space-y-6">
        {localNotice && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {localNotice}
          </div>
        )}

        {/* 概要（会社 & 事業） */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <GlassCard title="会社情報">
            <div className="divide-y divide-black/5">
              <InfoRow label="会社名" value={companyName} />
              <InfoRow label="設立年" value={foundationYear} />
              <InfoRow label="所在地" value={location} />
              <InfoRow label="業種" value={industryJa} />
              <InfoRow label="売上" value={revenue !== null ? `${revenue} 百万円` : ''} />
              <InfoRow label="従業員数" value={employees !== null ? `${employees} 人` : ''} />
            </div>
          </GlassCard>

          <GlassCard title="事業情報">
            <div className="divide-y divide-black/5">
              <InfoRow label="主な事業内容" value={businessContent} />
              <InfoRow label="主要な顧客層" value={customerSegment} />
            </div>
          </GlassCard>
        </div>

        {/* MVV */}
        <GlassCard title="経営者の思いとMVV">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-black/10 bg-white/70 p-3">
              <div className="mb-1 text-xs font-medium text-gray-500">経営者の思い</div>
              <p className="whitespace-pre-wrap text-sm text-gray-800">{thought || '（未入力）'}</p>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div className="rounded-xl border border-black/10 bg-white/70 p-3">
                <div className="mb-1 text-xs font-medium text-gray-500">Mission</div>
                <p className="whitespace-pre-wrap text-sm text-gray-800">{mission || '（未入力）'}</p>
              </div>
              <div className="rounded-xl border border-black/10 bg-white/70 p-3">
                <div className="mb-1 text-xs font-medium text-gray-500">Vision</div>
                <p className="whitespace-pre-wrap text-sm text-gray-800">{vision || '（未入力）'}</p>
              </div>
              <div className="rounded-xl border border-black/10 bg-white/70 p-3">
                <div className="mb-1 text-xs font-medium text-gray-500">Value</div>
                <p className="whitespace-pre-wrap text-sm text-gray-800">{value || '（未入力）'}</p>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* SWOT */}
        <GlassCard title="SWOT">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-black/10 bg-white/70 p-3">
              <div className="mb-1 text-xs font-medium text-gray-500">Strength（強み）</div>
              <p className="whitespace-pre-wrap text-sm text-gray-800">{strength || '（未入力）'}</p>
            </div>
            <div className="rounded-xl border border-black/10 bg-white/70 p-3">
              <div className="mb-1 text-xs font-medium text-gray-500">Weakness（弱み）</div>
              <p className="whitespace-pre-wrap text-sm text-gray-800">{weakness || '（未入力）'}</p>
            </div>
            <div className="rounded-xl border border-black/10 bg-white/70 p-3">
              <div className="mb-1 text-xs font-medium text-gray-500">Opportunity（機会）</div>
              <p className="whitespace-pre-wrap text-sm text-gray-800">{opportunity || '（未入力）'}</p>
            </div>
            <div className="rounded-xl border border-black/10 bg-white/70 p-3">
              <div className="mb-1 text-xs font-medium text-gray-500">Threat（脅威）</div>
              <p className="whitespace-pre-wrap text-sm text-gray-800">{threat || '（未入力）'}</p>
            </div>
          </div>
        </GlassCard>

        {/* 年度×事業サマリー（可視化） */}
        <div className="rounded-2xl border border-black/10 bg-white/60 p-3 overflow-x-auto">
          {/* ▼グラフ縮小＋フォント縮小適用用のラッパ */}
          <div className="origin-top-left scale-[0.90] md:scale-[0.95] fs-compact-chart">
            <FinanceSummaryPanel className="mt-2" showHeader initialYear={summaryYearsLatest as any} />
          </div>

          {/* ▼ここで Recharts の内部クラスを :global で安全に上書き */}
          <style jsx>{`
            /* 目盛りラベル（X/Y軸）の文字サイズを小さく */
            :global(.fs-compact-chart .recharts-cartesian-axis .recharts-text tspan) {
              font-size: 8px; /* お好みで 8〜11 に調整可 */
            }

            /* 凡例（営業利益/売上）の文字サイズを小さく */
            :global(.fs-compact-chart .recharts-default-legend) {
              font-size: 11px;
              line-height: 1.1;
            }

            /* ツールチップ内テキスト（必要なら） */
            :global(.fs-compact-chart .recharts-tooltip-wrapper) {
              font-size: 11px;
            }
          `}</style>
        </div>

        {/* 注意書き / ステータス */}
        <div className="text-center text-xs text-gray-500">
          「ストーリーを生成」を押すと、AIがたたき台ストーリーを作成します。
          {!canPersist && (
            <div className="mt-1 text-amber-700">
              現在、会社スコープの解決中（user/company/hydration）。保存はスコープ確立後にもう一度実行してください。
            </div>
          )}
        </div>

        {/* 生成ボタン（強調） */}
        <div className="flex justify-center">
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 rounded-2xl bg-black px-7 py-3 text-base font-semibold text-white shadow-lg shadow-black/10 ring-1 ring-black/10 hover:bg-black/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isGenerating ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border border-white/60 border-t-transparent" />
                生成中…
              </>
            ) : (
              <>ストーリーを生成</>
            )}
          </button>
        </div>
      </div>
    </StepLayout>
  );
}
