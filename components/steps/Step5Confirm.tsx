// /components/steps/Step5Confirm.tsx
'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStrategyStore } from '@/store/strategyStore';
import StepLayout from '@/components/StepLayout';
import { getIndustryLabel } from '@/utils/industryTemplates';
import FinanceSummaryPanel from '@/components/finance/FinanceSummaryPanel';

/* =========================================================
 * 確認画面（生成→保存→遷移の堅牢化）
 * - APIの返却形（文字列/配列/ネスト）を吸収
 * - store更新＋sessionStorage保険 → /story-process 側で確実に表示
 * - 遷移は scroll: true
 * ========================================================= */

// セッターが無ければ setState にフォールバックする安全ラッパー
function setFieldSafe(store: any, key: string, value: any) {
  const fnName = 'set' + key.charAt(0).toUpperCase() + key.slice(1);
  const setter = store?.[fnName];
  if (typeof setter === 'function') {
    setter(value);
  } else if (typeof (useStrategyStore as any)?.setState === 'function') {
    (useStrategyStore as any).setState({ [key]: value });
  }
}

// ストア通知 or ローカル通知を安全に出す
function notifySafe(store: any, msg: string, setLocal: (s: string) => void) {
  if (typeof store?.setNotification === 'function') {
    store.setNotification(msg);
  } else {
    setLocal(msg);
  }
}

// JSONを安全抽出（LLMが前後にテキストを混ぜても拾う）
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

// 文字列のストーリー（長文）→ 4章配列に近似整形（最低限）
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
  // 「第1章/第2章…」で区切れれば優先
  const markerRegex = /(第\s*[1-4]\s*章[^\\n]*)(?:\n+|$)/g;
  const markers = [...text.matchAll(markerRegex)];
  if (markers.length >= 2) {
    const parts: { title: string; body: string }[] = [];
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
  // だめなら段落で等分
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

// APIレスポンスからストーリー＆サマリーを抽出
function extractStoryAndSummary(payload: any): {
  longform?: string;
  chapters?: Array<{ title: string; body: string }>;
  summary?: string;
} {
  if (!payload || typeof payload !== 'object') return {};
  // 代表的なキーを広く吸収
  let storyAny =
    payload.story ??
    payload.draft ??
    payload.finalStory ??
    payload.result ??
    payload.content ??
    undefined;

  // OpenAI style
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
    // すでに [{title, body}] 形式
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

// 情報1行（ラベル:値）
function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="min-w-[8rem] shrink-0 text-xs text-gray-500">{label}</span>
      <span className="grow text-sm text-gray-800">{value ? String(value) : '（未入力）'}</span>
    </div>
  );
}

export default function Step5Confirm() {
  const router = useRouter();
  const st = useStrategyStore() as any;

  const [isGenerating, setIsGenerating] = useState(false);
  const [localNotice, setLocalNotice] = useState('');

  // 値（空文字防止）
  const companyName: string = st?.companyName ?? '';
  const foundationYear: string = st?.foundationYear ?? '';
  const location: string = st?.location ?? '';
  const industry: string = st?.industry ?? '';
  const revenue: string = st?.revenue ?? '';
  const employees: string = st?.employees ?? '';
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

  // 日本語ラベルへ変換（full: 詳細表記）
  const industryJa = industry ? getIndustryLabel(industry, { full: true }) : '';

  const csvCount = csvFinanceData.length;
  const summaryCount = financeSummary.length;

  const summaryYears = useMemo(
    () => Array.from(new Set(financeSummary.map((r: any) => r?.year))).filter(Boolean).sort(),
    [financeSummary]
  );

  // ストーリー生成（ロバスト版）
  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setLocalNotice('');

    try {
      const res = await fetch('/api/generate-story-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thought,
          mission,
          vision,
          value,
          industry,
          revenue,
          employees,
          strength,
          weakness,
          opportunity,
          threat,
          csvFinanceData,
          answers,
          answers2,
          financeSummary,
        }),
      });

      const raw = await res.text();
      if (!res.ok) {
        console.error('❌ 生成API失敗:', res.status, raw);
        notifySafe(st, '❌ ストーリー生成に失敗しました', setLocalNotice);
        return;
      }

      const data = safeJsonFromText<any>(raw) ?? {};
      const { longform, chapters, summary } = extractStoryAndSummary(data);

      // 1) まず store を更新（文字列/配列どちらでも受ける）
      if (typeof longform === 'string' && longform.trim().length > 0) {
        setFieldSafe(st, 'storyDraft', longform);
        try { sessionStorage.setItem('growth.storyDraft', longform); } catch {}
      } else if (Array.isArray(chapters) && chapters.length) {
        setFieldSafe(st, 'story', chapters);
        try { sessionStorage.setItem('growth.story', JSON.stringify(chapters)); } catch {}
      } else {
        // 文字列でも配列でも取れない場合は最後の手段：rawテキストを長文として試す
        const fallback = (raw || '').trim();
        if (fallback) {
          setFieldSafe(st, 'storyDraft', fallback);
          try { sessionStorage.setItem('growth.storyDraft', fallback); } catch {}
        } else {
          console.error('❌ 生成レスポンスに story が見つかりません', data);
          notifySafe(st, '❌ 生成結果の取得に失敗しました', setLocalNotice);
          return;
        }
      }

      if (typeof summary === 'string' && summary.trim()) {
        setFieldSafe(st, 'strategySummary', summary);
        try { sessionStorage.setItem('growth.strategySummary', summary); } catch {}
      }

      // 2) 必要ならDB保存をここで await（任意）
      // await saveStrategyData({ storyDraft: longform, story: chapters, strategySummary: summary });

      // 3) 遷移（トップから始める）
      router.push('/story-process', { scroll: true });
    } catch (err) {
      console.error('❌ 通信エラー:', err);
      notifySafe(st, '❌ 通信エラーが発生しました', setLocalNotice);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
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
              {/* ✅ 業種を日本語で表示 */}
              <InfoRow label="業種" value={industryJa} />
              <InfoRow label="売上" value={revenue ? `${revenue} 百万円` : ''} />
              <InfoRow label="従業員数" value={employees ? `${employees} 人` : ''} />
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
        <GlassCard title="SWOT分析">
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
        <FinanceSummaryPanel className="mt-2" showHeader initialYear={summaryYears.at(-1)} />

        {/* 注意書き */}
        <div className="text-center text-xs text-gray-500">
          「ストーリーを生成」を押すと、AIがたたき台ストーリーを作成します。
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
