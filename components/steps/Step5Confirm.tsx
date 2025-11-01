// /components/steps/Step5Confirm.tsx
'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import StepLayout from '@/components/StepLayout';
import { getIndustryLabel } from '@/utils/industryTemplates';
import FinanceSummaryPanel from '@/components/finance/FinanceSummaryPanel';
// ✅ 新設計の保存APIを直接インポート
import { saveStrategyData as saveStrategyDataApi } from '@/utils/supabase/strategy';

/* =========================================================
 * 確認画面（生成→保存→遷移の堅牢化・名前空間つき）
 * ========================================================= */

/** 名前空間つき sessionStorage キー */
const ssKey = (base: string, companyId?: string | null, strategyId?: string | null) =>
  `growth.${companyId || 'co'}.${strategyId || 'stg'}.${base}`;

// ストア通知 or ローカル通知を安全に出す
function notifySafe(store: any, msg: string, setLocal: (s: string) => void) {
  if (typeof store?.setNotification === 'function') {
    store.setNotification(msg);
  } else {
    setLocal(msg);
  }
}

// JSON抽出（LLMの前後混入に耐性）
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

// 改行整形
function normalizeNewlines(s: string = '') {
  let out = String(s);
  for (let i = 0; i < 3; i++) {
    if (out.includes('\\n')) out = out.replace(/\\n/g, '\n');
    if (out.includes('\\r')) out = out.replace(/\\r/g, '\r');
  }
  return out.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// 長文→4章配列（見出し/Markdown両対応のマーカー広め）
function longformToChapters(s: string) {
  const text = normalizeNewlines((s || '').trim());
  if (!text) return [] as { title: string; body: string }[];
  // 「第1章」「# 第1章」「## 第1章」などを広めに吸収
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

// APIレスポンスから story/summary を抽出
function extractStoryAndSummary(payload: any): {
  longform?: string;
  chapters?: Array<{ title: string; body: string }>;
  summary?: any;
} {
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

// Glassカード
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

// 情報1行
function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="min-w-[8rem] shrink-0 text-xs text-gray-500">{label}</span>
      <span className="grow text-sm text-gray-800">{value !== undefined && value !== null && String(value) !== '' ? String(value) : '（未入力）'}</span>
    </div>
  );
}

export default function Step5Confirm() {
  const router = useRouter();
  const st = useStrategyStore() as any;

  // ユーザー・会社スコープ
  const userId = useUserStore((s) => s.user?.id ?? null);
  const companyId = useUserStore((s) => s.companyId ?? null);
  const hydrated = useUserStore((s) => s.hydrated ?? false);
  const membershipLoaded = useUserStore((s) => s.membershipLoaded ?? false);
  const canPersist = !!userId && !!companyId && !!hydrated && !!membershipLoaded;

  const strategyId = st?.strategyId ?? null;

  const [isGenerating, setIsGenerating] = useState(false);
  const [localNotice, setLocalNotice] = useState('');

  // 値（数値は number|null に統一）
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

  const csvCount = csvFinanceData.length;
  const summaryCount = financeSummary.length;

  const summaryYears = useMemo(
    () => Array.from(new Set(financeSummary.map((r: any) => r?.year))).filter(Boolean).sort(),
    [financeSummary]
  );

  // ストーリー生成
  const handleGenerate = async () => {
    if (isGenerating) return;

    // 生成は許可、保存だけ条件付き
    if (!canPersist) {
      notifySafe(st, '会社スコープの解決中。生成は実行し、保存はスコープ確立後に再度行ってください。', setLocalNotice);
    }

    setIsGenerating(true);
    setLocalNotice('');

    // エンドポイント候補（存在するものへフォールバック）
    const endpoints = [
      '/api/generate-story-draft-v2',
      '/api/generate-story-draft',
      '/api/final-story',
    ];

    // 送信ペイロード（数値は number|null のまま）
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

    // ユーティリティ
    const pickChapters = (rawText: string, parsed: any) => {
      const { longform, chapters } = extractStoryAndSummary(parsed || {});
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
            if (res.status === 404) continue; // 次の候補へ
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

      // 1) store に保存（互換キーも埋める）
      if (typeof st?.setStory === 'function') st.setStory(finalChapters);
      (useStrategyStore as any).setState({
        story: finalChapters,
        storyChapters: finalChapters,
        chapters: finalChapters,
      });

      // 2) sessionStorage（★名前空間つき）に保存
      try {
        if (companyId && strategyId) {
          sessionStorage.setItem(ssKey('story', companyId, strategyId), JSON.stringify(finalChapters));
          const summaryText = toSummaryText(finalSummary);
          if (summaryText) {
            sessionStorage.setItem(ssKey('strategySummary', companyId, strategyId), summaryText);
          }
        }
      } catch {}

      // 3) DBにも保存（canPersist のときだけ）
      if (canPersist) {
        try {
          const current = useStrategyStore.getState() as any;
          const patch = {
            strategyId,
            story: finalChapters,
            // 最終版ではないので finalStory には入れない
            mission, vision, value,
            industry, revenue, employees,
            thought, strength, weakness, opportunity, threat,
            csvFinanceData,
            answers2, // 使うなら
          };
          await saveStrategyDataApi({ ...current, ...patch }, userId!, companyId!);
        } catch (e) {
          console.warn('saveStrategyData failed (draft story persisted only to session/store):', e);
        }
      } else {
        notifySafe(st, '保存はスコープ確立後に再実行してください（生成内容は画面内/セッションに保持）', setLocalNotice);
      }

      // 4) 状態反映を一拍待つ
      await Promise.resolve();
      if (typeof window !== 'undefined') {
        await new Promise(r => setTimeout(r, 0));
      }

      // 5) 遷移（DB未保存でも閲覧は可能）
      router.push('/story-process', { scroll: true });
    } catch (err) {
      console.error('❌ 通信エラー:', err);
      notifySafe(st, `❌ 通信エラー: ${String((err as any)?.message || err)}`, setLocalNotice);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    // ✅ フローに合わせて 5/5 に統一
    <StepLayout step={6} totalSteps={6} title="入力内容の最終確認">
      <div className="space-y-6">
        {/* 通知 */}
        {localNotice && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            {localNotice}
          </div>
        )}

        {/* 取り込み状況 */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-black/10 bg-white/70 px-2.5 py-1 shadow-sm">
            CSV: {csvCount} 件
          </span>
          <span className="rounded-full border border-black/10 bg-white/70 px-2.5 py-1 shadow-sm">
            サマリー: {summaryCount} 件 {summaryYears.length ? `（${summaryYears.join(', ')}）` : ''}
          </span>
          {!csvCount && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-900 shadow-sm">
              財務CSVが未取り込みです（ステップ4でアップロード）
            </span>
          )}
        </div>

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

        {/* 年度×事業サマリー（可視化） */}
        <FinanceSummaryPanel className="mt-2" showHeader initialYear={summaryYears.at(-1)} />

        {/* 注意書き / ステータス */}
        <div className="text-center text-xs text-gray-500">
          「ストーリーを生成」を押すと、AIがたたき台ストーリーを作成します。
          {!canPersist && (
            <div className="mt-1 text-amber-700">
              現在、会社スコープの解決中（user/company/hydration）。保存はスコープ確立後にもう一度実行してください。
            </div>
          )}
        </div>

        {/* 生成ボタン */}
        <div className="flex justify-center">
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/80 px-6 py-2.5 text-sm font-medium text-gray-800 shadow-sm backdrop-blur hover:bg-white focus:outline-none focus:ring-2 focus:ring-black/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isGenerating ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border border-black/30 border-t-transparent" />
                生成中…
              </>
            ) : (
              <>ストーリーを生成 →</>
            )}
          </button>
        </div>
      </div>
    </StepLayout>
  );
}
