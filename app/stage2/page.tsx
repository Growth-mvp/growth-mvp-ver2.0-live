// /app/stage2/page.tsx
'use client';
import StrategyGuard from '@/app/StrategyGuard';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { safeGetSession } from '@/utils/supabase/client';
import { formatMillion, safeNumber, toMillionYen, inferScaleToMillion, safeRatio, formatPct } from '@/utils/unit';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { useAutoSave } from '@/hooks/useAutoSave';
// PDF出力は /report/stage2-strategy プレビュー画面で行う
// PDF出力は /report/stage2-strategy プレビュー画面で行う
import {
  getStage1DataWithFallback,
  loadStage1SnapshotFromLocalStorage,
  loadStage2SnapshotFromLocalStorage,
  saveStage2SnapshotToLocalStorage,
  clearStage2Snapshot,
} from '@/utils/stageSnapshot';
import { getFullStrategyDataByCompany, saveStrategyData as saveStrategyDataApi } from '@/utils/supabase/strategy';
import { saveWithAudit } from '@/utils/persist/saveWithAudit';
import { restoreWithAudit } from '@/utils/persist/restoreWithAudit';
import type { IssueBlock, MetricsSummary, StoryChapter, WinPatternCandidate, Stage2State, Stage2Answer } from '@/types/strategy';
import { authFetchJson, AuthFetchError } from '@/utils/authFetch';
import { AutoResizeTextarea } from '@/components/ui/AutoResizeTextarea';
import { StrategyStoryPreview } from '@/components/stage2/StrategyStoryPreview';

/* ===================================================
 * ★ Zustand selector 参照安定化：無限ループ防止
 * =================================================== */
const EMPTY_ARR: any[] = [];

/* ===================================================
 * 12問テンプレート（固定）
 * - 修正：必須を撤廃（全て required: false）
 * =================================================== */
const TEMPLATE12: { id: string; question: string; reason: string; chapter: number; required: boolean }[] = [
  // 章0（なぜ今）- 2問
  {
    id: 'ch0-q1',
    question: '現在、お客様や業界の変化の中で危機と感じることは何ですか？',
    reason: 'まず「何が危機か」を自分の言葉で特定すると、議論の土台がそろいます。',
    chapter: 0,
    required: false,
  },
  {
    id: 'ch0-q2',
    question: 'その危機を放置しておくことで、今後自社が失うものは何ですか？',
    reason: '放置コスト（機会・信頼・人材・収益）を見える化すると「なぜ今やるか」が腑に落ちます。',
    chapter: 0,
    required: false,
  },

  // 章1（どう戦う）- 6問
  {
    id: 'ch1-q1',
    question: '次の時代、私たちの事業を取り巻く市場や環境はどのような変化や世界が待っているでしょうか？',
    reason: '前提をバックキャスト思考で考えることで、フォアキャスト思考から抜け出せます。',
    chapter: 1,
    required: false,
  },
  {
    id: 'ch1-q2',
    question: 'その変化の中で、顧客が本当に求める「価値」は何であり、自社を選ぶ理由は何になるのでしょうか？',
    reason: '提供価値を再定義すると、意思決定の軸が一本化します。',
    chapter: 1,
    required: false,
  },
  {
    id: 'ch1-q3',
    question: 'その価値を生み出し続けるために、今から投資し磨くべき当社の「強み」は何でしょうか？',
    reason: '限られた資源をどこに集中するかを決めます。',
    chapter: 1,
    required: false,
  },
  {
    id: 'ch1-q4',
    question: 'その強みを発揮するうえで、いま克服すべき「致命的な課題」は何でしょうか？',
    reason: 'ボトルネックを先に外すと、強みが成果に結びやすくなります。',
    chapter: 1,
    required: false,
  },
  {
    id: 'ch1-q5',
    question: 'この変革を全社で実現するうえで、最も大きな「壁」や「抵抗」は何でしょうか？',
    reason: '人と組織の壁を言語化すると、伝わらない理由が解けます。',
    chapter: 1,
    required: false,
  },
  {
    id: 'ch1-q6',
    question: '経営資源を集中させるために、いま「やめること」や「撤退すべきこと」は何でしょうか？',
    reason: 'やめるを決めると、スピードと手応えが上がります。',
    chapter: 1,
    required: false,
  },

  // 章2（どんな未来像）- 2問
  {
    id: 'ch2-q1',
    question: 'この戦略が実現したとき、社会や市場から私たちはどんな「新しい評価」を得たいですか？',
    reason: '外からの評価像をはっきりさせると、目指す価値が具体になります。',
    chapter: 2,
    required: false,
  },
  {
    id: 'ch2-q2',
    question:
      '3年後、この戦略が成功していたとして、会社の「業績の数字」はどのように変わり、社員一人ひとりの「仕事のやりがいや誇り」はどのように変わっているでしょう？',
    reason: '数字（売上・利益など）と手触り（やりがい・誇り）を両輪で描くと、未来の姿が実感を伴います。',
    chapter: 2,
    required: false,
  },

  // 章3（どう行動する）- 2問
  {
    id: 'ch3-q1',
    question: 'この戦略を全社員に伝え、「本気だ」と感じてもらうために、経営層はまず「どんな行動」を起こすべきですか？',
    reason: '最初に動くのは言葉ではなく行動です。小さくても具体的な初動を示すと、信頼が生まれます。',
    chapter: 3,
    required: false,
  },
  {
    id: 'ch3-q2',
    question: 'この戦略を進めるために、全社員に「明日から必ず変えてほしい行動」を挙げるとすれば何ですか？',
    reason: '全員の一歩をそろえると、戦略が自分ごとになります。',
    chapter: 3,
    required: false,
  },
];

const CHAPTER_LABELS = ['第1章：なぜ今', '第2章：どう戦う', '第3章：どんな未来像', '第4章：どう行動する'];

/* ===================================================
 * 安定した空配列参照（Zustand selector でのメモ化バイパス防止）
 * =================================================== */
const EMPTY_STORY_DRAFT = Object.freeze([]) as unknown as StoryChapter[];
const EMPTY_WIN_PATTERNS = Object.freeze([]) as unknown as WinPatternCandidate[];
const EMPTY_ANSWERS12 = Object.freeze([]) as unknown as Stage2Answer[];

/* ===================================================
 * answers12 同一判定（無限同期ループ防止）
 * =================================================== */
function hashAnswers12(a: Stage2Answer[] | undefined | null): string {
  if (!a || a.length === 0) return '';
  const slim = [...a]
    .map((x) => ({ id: x.id, answer: x.answer ?? '' }))
    .sort((p, q) => p.id.localeCompare(q.id));
  return JSON.stringify(slim);
}

/* ===================================================
 * 小物：スクロール付き本文
 * =================================================== */
function ScrollText({
  children,
  maxH = 'max-h-[220px]',
  className = '',
}: {
  children: React.ReactNode;
  maxH?: string;
  className?: string;
}) {
  return <div className={`${maxH} overflow-auto pr-2 whitespace-pre-wrap break-words leading-relaxed ${className}`}>{children}</div>;
}


function ReadOnlyBlock({
  readOnly,
  children,
}: {
  readOnly: boolean;
  children: React.ReactNode;
}) {
  if (!readOnly) return <>{children}</>;

  return (
    <div className="relative">
      <div className="pointer-events-none opacity-80">{children}</div>
      <div className="absolute inset-0 rounded-md" aria-hidden="true" />
    </div>
  );
}

/* ===================================================
 * StepperTabs（再編版）
 * =================================================== */
type TabId = 'input' | 'draft' | 'final';

interface StepperTabsProps {
  activeTab: TabId;
  onChange: (tab: TabId) => void;

  // enable/complete 判定用
  canOpenDraft: boolean;
  hasDraft: boolean;
  hasFinal: boolean;
}

function StepperTabs({ activeTab, onChange, canOpenDraft, hasDraft, hasFinal }: StepperTabsProps) {
  const tabs: {
    id: TabId;
    label: string;
    enabled: boolean;
    completed: boolean;
    warning?: boolean;
  }[] = [
    { id: 'input', label: '入力', enabled: true, completed: false },
    { id: 'draft', label: '戦略議論', enabled: canOpenDraft, completed: hasDraft },
    { id: 'final', label: '最終確定', enabled: hasFinal, completed: hasFinal },
  ];

  return (
    <div className="flex items-center gap-3 bg-white/60 dark:bg-white/5 rounded-2xl border border-black/10 shadow-sm backdrop-blur-md p-3">
      {tabs.map((tab, index) => {
        const isActive = activeTab === tab.id;
        const isDisabled = !tab.enabled;

        return (
          <React.Fragment key={tab.id}>
            <button
              onClick={() => !isDisabled && onChange(tab.id)}
              disabled={isDisabled}
              className={`relative px-5 py-3 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                isActive
                  ? 'bg-blue-600 text-white shadow-lg ring-2 ring-blue-300 dark:ring-blue-800'
                  : isDisabled
                  ? 'bg-gray-100 dark:bg-gray-800/50 text-gray-400 dark:text-gray-600 cursor-not-allowed'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'
              }`}
            >
              {tab.completed && (
                <span className="w-5 h-5 rounded-full bg-green-500 text-white flex items-center justify-center text-xs">✓</span>
              )}
              {!tab.completed && isDisabled && (
                <span className="w-5 h-5 rounded-full bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-600 flex items-center justify-center text-xs">
                  🔒
                </span>
              )}
              <span>{tab.label}</span>
              {tab.warning && <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" />}
            </button>
            {index < tabs.length - 1 && <div className="w-8 h-0.5 bg-gray-200 dark:bg-gray-700" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ===================================================
 * 勝ち筋一覧（選択なし・全文表示版）
 * =================================================== */
function WinPatternList({ candidates }: { candidates: WinPatternCandidate[] }) {
  if (!candidates || candidates.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-800/50 p-8 text-center">
        <h4 className="text-base font-medium text-gray-600 dark:text-gray-400 mb-2">勝ち筋（未生成）</h4>
        <p className="text-sm text-gray-400 dark:text-gray-500">先に「たたき台を生成」を実行してください</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-black/10 bg-white/70 dark:bg-white/5 shadow-sm backdrop-blur-md p-6">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">勝ち筋（候補一覧）</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        勝ち筋は“選択必須”にはせず、経営の議論材料として一覧提示します（最終生成時は内部的に先頭候補を参照します）。
      </p>

      <div className="max-h-[520px] overflow-auto pr-2 space-y-3">
        {candidates.map((wp) => (
          <div key={wp.id} className="w-full text-left p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-white/5">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-800 dark:text-gray-200">{wp.name}</span>
            </div>

            {wp.valueDrivers?.length > 0 && (
              <div className="flex gap-1 mt-2 flex-wrap">
                {wp.valueDrivers.map((vd, i) => (
                  <span key={i} className="text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 px-2 py-0.5 rounded">
                    {vd}
                  </span>
                ))}
              </div>
            )}

            {wp.rationale && (
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                <ScrollText maxH="max-h-[140px]">{wp.rationale}</ScrollText>
              </div>
            )}

            {wp.tradeoffs && (
              <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                <ScrollText maxH="max-h-[100px]">⚠ {wp.tradeoffs}</ScrollText>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===================================================
 * 最終ストーリープレビュー（全文表示）
 * =================================================== */
function FinalStoryPreview({ finalStory }: { finalStory: StoryChapter[] }) {
  if (!finalStory || finalStory.length === 0) return null;

  return (
    <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/20 p-6">
      <h3 className="text-lg font-semibold text-emerald-800 dark:text-emerald-200 mb-4">最終ストーリー</h3>
      <div className="space-y-4">
        {finalStory.map((chapter, i) => (
          <div key={i} className="border-l-2 border-emerald-400 pl-4">
            <h4 className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 mb-1">{chapter.title}</h4>
            <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words leading-relaxed">
              {stripIssueSummaryFromDisplay(chapter.body)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===================================================
 * ★ 経営層向けドキュメント表示（最終ストーリー）
 * - 4章の構成・本文は一切変更せず、「見せ方」のみ戦略書品質で表示
 * - 表紙ヘッダー（タイトル・会社名・ステータス）→ 構成（目次）→ 各章本文
 * - 本文は段落単位で組版（明朝系・字間/行間を文書向けに調整）
 * =================================================== */
function ExecutiveStoryDocument({
  story,
  finalized,
}: {
  story: StoryChapter[];
  finalized: boolean;
}) {
  const companyName = useStrategyStore((s: StrategyState) => (s as any).companyName as string | undefined);

  if (!story || story.length === 0) return null;

  const renderBody = (body: string) => {
    const cleaned = stripIssueSummaryFromDisplay(body ?? '');
    const paragraphs = cleaned
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (paragraphs.length === 0) {
      return <p className="text-sm text-gray-400 dark:text-gray-500">（本文未入力）</p>;
    }
    return paragraphs.map((p, i) => (
      <p
        key={i}
        className="whitespace-pre-wrap break-words text-justify leading-[2.05] tracking-[0.015em] text-[15px] text-gray-800 dark:text-gray-200"
      >
        {p}
      </p>
    ));
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
      {/* 表紙ヘッダー */}
      <div className="border-b border-slate-800 bg-slate-900 px-8 py-10 sm:px-12">
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-400">
          Mid-Term Management Plan
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-wide text-white sm:text-3xl">
          全社戦略ストーリー
        </h2>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {companyName && <span className="text-sm font-medium text-slate-300">{companyName}</span>}
          <span
            className={[
              'rounded-full border px-3 py-1 text-[11px] font-semibold',
              finalized
                ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                : 'border-amber-400/40 bg-amber-500/15 text-amber-300',
            ].join(' ')}
          >
            {finalized ? '確定版' : 'ドラフト（確定前）'}
          </span>
        </div>
      </div>

      {/* 構成（目次） */}
      <div className="border-b border-gray-200 px-8 py-6 dark:border-gray-700 sm:px-12">
        <p className="text-[11px] font-semibold tracking-[0.3em] text-gray-400 dark:text-gray-500">構成</p>
        <div className="mt-3 grid gap-x-10 gap-y-2 sm:grid-cols-2">
          {story.map((ch, i) => (
            <div key={i} className="flex items-baseline gap-3">
              <span className="shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">
                第{i + 1}章
              </span>
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{ch.title}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 各章本文 */}
      <div className="space-y-12 px-8 py-10 sm:px-12">
        {story.map((ch, i) => (
          <section key={i}>
            <div className="flex items-center gap-4">
              <span className="shrink-0 text-xs font-semibold tracking-[0.25em] text-slate-500 dark:text-slate-400">
                第{i + 1}章
              </span>
              <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
            </div>
            <h3 className="mt-3 font-serif text-xl font-semibold leading-snug text-gray-900 dark:text-gray-50 sm:text-[22px]">
              {ch.title}
            </h3>
            <div className="mt-5 space-y-5 font-serif">{renderBody(ch.body)}</div>
          </section>
        ))}
      </div>
    </div>
  );
}

/* ===================================================
 * ★STEP11: 中計設計パネル削除
 * - StrategyStoryPreview 内の MidtermDesignBox に統合済み
 * - 重複表示を回避するため削除
 * =================================================== */

/* ===================================================
 * 現状→目標 KPIブリッジ（Apple風UI）
 * ★ TASK A: 売上・営業利益の現状→目標を可視化（百万円表示）
 * =================================================== */
type KPIBridgeData = {
  current: number | null;
  target: number | null;
};

interface CurrentToTargetPanelProps {
  revenue: KPIBridgeData;
  operatingProfit: KPIBridgeData;
}

// ★ TASK A-1: 単位変換（兆円/円/百万円を自動判定）
// 入力値の大きさに応じて、百万円スケールに統一する純関数
function toMillion(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const a = Math.abs(v);

  // 兆円っぽい（0.0xx, 0.x, 数十まで）→ x * 1_000_000
  if (a > 0 && a < 100) return v * 1_000_000;

  // 円っぽい（百万を超える生値） → x / 1_000_000
  if (a >= 1_000_000) return v / 1_000_000;

  // 百万円っぽい → そのまま
  return v;
}

// fmtMillion は utils/unit.ts の formatMillion に統一
function fmtMillion(yen: number | null | undefined): string {
  return formatMillion(yen, 0);
}

// ★ fmtDelta - 値は既に百万円スケール（toMillionYen で統一済み）
function fmtDelta(current: number | null | undefined, target: number | null | undefined): { delta: string; rate: string } {
  if (current === null || current === undefined || target === null || target === undefined) {
    return { delta: '—', rate: '—' };
  }
  const d = target - current;
  // ★ 値は既に百万円スケールなので、そのまま四捨五入して表示
  const deltaStr = d >= 0 ? `+${Math.round(d).toLocaleString('ja-JP')}` : `${Math.round(d).toLocaleString('ja-JP')}`;
  if (current === 0) {
    return { delta: deltaStr, rate: '—' };
  }
  const rate = ((d / current) * 100).toFixed(1);
  return { delta: deltaStr, rate: `${rate}%` };
}

/**
 * PositiveOnlyBarCard - 売上用（常に正の値）
 * 2本の太い縦棒（現状/目標）を表示
 */
function PositiveOnlyBarCard({
  title,
  current,
  target,
}: {
  title: string;
  current: number | null;
  target: number | null;
}) {
  // ★ 高さ計算（相対値）
  const safeMax = Math.max(current ?? 0, target ?? 0, 1);
  const currentHeightPct = current !== null ? (current / safeMax) * 100 : 0;
  const targetHeightPct = target !== null ? (target / safeMax) * 100 : 0;

  // ★ 達成率計算（utils/unit.ts の safeRatio を使用）
  const achievementRate = safeRatio(current, target);

  // ★ 差分計算
  const delta = current !== null && target !== null ? target - current : null;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-white/5 backdrop-blur-sm p-5">
      {/* タイトル */}
      <div className="flex items-center justify-between mb-4">
        <h5 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</h5>
        <span className="text-xs text-gray-500 dark:text-gray-400">百万円</span>
      </div>

      {/* 棒グラフ（太い縦棒） - 親に固定高さを付与して % が成立するようにする */}
      <div className="relative h-48 flex items-end justify-center gap-6 mb-4">
        {/* 現状 */}
        <div className="flex flex-col items-center gap-2 h-full">
          <div className="flex-1 flex items-end justify-center">
            <div
              className="bg-slate-600 dark:bg-slate-400 rounded-t transition-all shadow-md"
              style={{
                width: '22px',
                height: `${Math.max(currentHeightPct, 2)}%`,
              }}
            />
          </div>
          {current !== null && (
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 text-center whitespace-nowrap">
              {formatMillion(current)}
            </div>
          )}
          <div className="text-xs text-gray-500 dark:text-gray-500">現状</div>
        </div>

        {/* 目標 */}
        <div className="flex flex-col items-center gap-2 h-full">
          <div className="flex-1 flex items-end justify-center">
            <div
              className="bg-blue-500 dark:bg-blue-400 rounded-t transition-all shadow-md"
              style={{
                width: '22px',
                height: `${Math.max(targetHeightPct, 2)}%`,
              }}
            />
          </div>
          {target !== null && (
            <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 text-center whitespace-nowrap">
              {formatMillion(target)}
            </div>
          )}
          <div className="text-xs text-gray-500 dark:text-gray-500">目標</div>
        </div>
      </div>

      {/* 下段：差分・達成率 */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-3 flex justify-between text-xs text-gray-600 dark:text-gray-400">
        <span>
          差分: {delta !== null ? formatMillion(delta) : '—'}
        </span>
        <span>
          達成率: {achievementRate !== null ? formatPct(achievementRate) : '—'}
        </span>
      </div>
    </div>
  );
}

/**
 * DivergingBarCard - 営業利益用（正負両対応、0ライン表示）
 * 0ラインを中心に、上下に棒が伸びる
 */
function DivergingBarCard({
  title,
  current,
  target,
}: {
  title: string;
  current: number | null;
  target: number | null;
}) {
  // ★ 高さ計算（0ラインを基準）
  const absMax = Math.max(Math.abs(current ?? 0), Math.abs(target ?? 0), 1);
  const currentHeightPct = current !== null ? Math.abs(current) / absMax * 100 : 0;
  const targetHeightPct = target !== null ? Math.abs(target) / absMax * 100 : 0;

  // ★ 達成率（targetが正の場合のみ計算）
  const achievementRate = target !== null && target > 0 ? safeRatio(current, target) : null;

  // ★ 差分計算
  const delta = current !== null && target !== null ? target - current : null;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-white/5 backdrop-blur-sm p-5">
      {/* タイトル */}
      <div className="flex items-center justify-between mb-4">
        <h5 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</h5>
        <span className="text-xs text-gray-500 dark:text-gray-400">百万円</span>
      </div>

      {/* 0ラインを含む棒グラフ（上下 50% の "確定高さ" を用意して % を成立させる） */}
      <div className="relative h-48 flex justify-center gap-8 mb-4">
        {/* 0ライン */}
        <div
          className="absolute left-0 right-0 h-px bg-gray-400 dark:bg-gray-600"
          style={{ top: '50%' }}
        />

        {/* 現状 */}
        <div className="relative w-12 flex flex-col items-center">
          {/* +（上側 50%） */}
          {current !== null && current > 0 && (
            <div
              className="absolute bottom-1/2 left-1/2 -translate-x-1/2 flex flex-col items-center justify-end"
              style={{ height: '50%' }}
            >
              <div
                className="bg-emerald-600 dark:bg-emerald-400 rounded-t transition-all shadow-md"
                style={{
                  width: '22px',
                  height: `${Math.max(currentHeightPct, 2)}%`,
                }}
              />
              <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mt-1 text-center whitespace-nowrap">
                {formatMillion(current)}
              </div>
            </div>
          )}

          {/* -（下側 50%） */}
          {current !== null && current < 0 && (
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 flex flex-col items-center justify-start"
              style={{ height: '50%' }}
            >
              <div
                className="bg-red-500 dark:bg-red-400 rounded-b transition-all shadow-md"
                style={{
                  width: '22px',
                  height: `${Math.max(currentHeightPct, 2)}%`,
                }}
              />
              <div className="text-xs font-semibold text-red-700 dark:text-red-300 mt-1 text-center whitespace-nowrap">
                {formatMillion(current)}
              </div>
            </div>
          )}

          <div className="absolute -bottom-6 text-xs text-gray-500 dark:text-gray-500 whitespace-nowrap">
            現状
          </div>
        </div>

        {/* 目標 */}
        <div className="relative w-12 flex flex-col items-center">
          {/* +（上側 50%） */}
          {target !== null && target > 0 && (
            <div
              className="absolute bottom-1/2 left-1/2 -translate-x-1/2 flex flex-col items-center justify-end"
              style={{ height: '50%' }}
            >
              <div
                className="bg-emerald-500 dark:bg-emerald-400 rounded-t transition-all shadow-md"
                style={{
                  width: '22px',
                  height: `${Math.max(targetHeightPct, 2)}%`,
                }}
              />
              <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mt-1 text-center whitespace-nowrap">
                {formatMillion(target)}
              </div>
            </div>
          )}

          {/* -（下側 50%） */}
          {target !== null && target < 0 && (
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 flex flex-col items-center justify-start"
              style={{ height: '50%' }}
            >
              <div
                className="bg-red-500 dark:bg-red-400 rounded-b transition-all shadow-md"
                style={{
                  width: '22px',
                  height: `${Math.max(targetHeightPct, 2)}%`,
                }}
              />
              <div className="text-xs font-semibold text-red-700 dark:text-red-300 mt-1 text-center whitespace-nowrap">
                {formatMillion(target)}
              </div>
            </div>
          )}

          <div className="absolute -bottom-6 text-xs text-gray-500 dark:text-gray-500 whitespace-nowrap">
            目標
          </div>
        </div>
      </div>

      <div className="h-6" />

      {/* 下段：差分・達成率 */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-3 flex justify-between text-xs text-gray-600 dark:text-gray-400">
        <span>
          差分: {delta !== null ? formatMillion(delta) : '—'}
        </span>
        <span>
          達成率: {achievementRate !== null ? formatPct(achievementRate) : '—'}
        </span>
      </div>
    </div>
  );
}

/**
 * FinancialTargetGapPanel - 経営層向けの数値目標サマリー
 * - 戦略書上部で「何をどこまで伸ばすのか」を一目で示す
 * - 内部値は百万円、画面表示は億円中心
 */
function formatOkuFromMillion(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const oku = value / 100;
  return `${Math.round(oku).toLocaleString('ja-JP')}億円`;
}

function FinancialTargetMetricCard({
  title,
  current,
  target,
}: {
  title: string;
  current: number | null;
  target: number | null;
}) {
  const delta = current != null && target != null ? target - current : null;
  const achievementRate = target != null && target !== 0 && current != null ? current / target : null;
  const progressPct = achievementRate != null ? Math.max(0, Math.min(100, achievementRate * 100)) : 0;
  const deltaIsPositive = delta == null || delta >= 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Target KPI</p>
          <h5 className="mt-1 text-base font-bold text-slate-950 dark:text-slate-50">{title}</h5>
        </div>
        <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          達成率 {achievementRate != null ? formatPct(achievementRate) : '—'}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/80">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">現状</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-slate-950 dark:text-white">{formatOkuFromMillion(current)}</p>
          <p className="mt-1 text-[11px] text-slate-400">{current != null ? `${Math.round(current).toLocaleString('ja-JP')}百万円` : '—'}</p>
        </div>
        <div className="rounded-xl bg-blue-50 p-4 dark:bg-blue-950/30">
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">目標</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-blue-800 dark:text-blue-200">{formatOkuFromMillion(target)}</p>
          <p className="mt-1 text-[11px] text-blue-500/80">{target != null ? `${Math.round(target).toLocaleString('ja-JP')}百万円` : '—'}</p>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>現状から目標への進捗</span>
          <span>{achievementRate != null ? formatPct(achievementRate) : '—'}</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            className="h-full rounded-full bg-slate-900 transition-all dark:bg-blue-400"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
        <span className="font-medium text-slate-500 dark:text-slate-400">必要な上積み</span>
        <span className={`font-bold ${deltaIsPositive ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}`}>
          {delta != null ? `${delta >= 0 ? '+' : ''}${formatOkuFromMillion(delta)}` : '—'}
        </span>
      </div>
    </div>
  );
}

function CurrentToTargetPanel({ revenue, operatingProfit }: CurrentToTargetPanelProps) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-950/60 md:p-8">
      <div className="mb-6 flex flex-col gap-2 border-b border-slate-100 pb-5 dark:border-slate-800">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-blue-700 dark:text-blue-300">Financial Target</p>
        <h3 className="text-xl font-bold text-slate-950 dark:text-slate-50">数値目標と達成ギャップ</h3>
        <p className="max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          この戦略により、売上・営業利益の成長目標を実現し、持続的な収益基盤への転換を目指します。
          現在値と目標値の差分を明確にし、STAGE3以降の部門戦略・KPI設計に接続します。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <FinancialTargetMetricCard title="売上" current={revenue.current} target={revenue.target} />
        <FinancialTargetMetricCard title="営業利益" current={operatingProfit.current} target={operatingProfit.target} />
      </div>
    </section>
  );
}

/* ===================================================
 * GlassCard（再利用）
 * =================================================== */
function GlassCard({
  title,
  accentClass,
  children,
  hint,
}: {
  title: string;
  accentClass?: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="relative rounded-2xl border border-black/10 bg-white/70 dark:bg-white/5 shadow-sm backdrop-blur-md ring-1 ring-black/5">
      {accentClass && <div className={`absolute inset-x-0 top-0 h-1 rounded-t-2xl ${accentClass}`} />}
      <div className="p-4 md:p-5">
        <div className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</div>
        {hint && <p className="mb-3 text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">{hint}</p>}
        {children}
      </div>
    </div>
  );
}

/* ===================================================
 * IssueBlockプレビュー（全文＋スクロール）
 * =================================================== */
function IssueBlockPreview({
  issueBlocks,
  metricsSummary,
  source,
  collapsed,
  onToggle,
}: {
  issueBlocks: IssueBlock[];
  metricsSummary: MetricsSummary;
  source: 'store' | 'localStorage' | 'supabase' | 'none';
  collapsed: boolean;
  onToggle: () => void;
}) {
  const sourceLabel = {
    store: 'ストア',
    localStorage: 'ローカル保存',
    supabase: 'サーバー',
    none: '未取得',
  }[source];

  return (
    <div className="rounded-2xl border border-black/10 bg-white/60 dark:bg-white/5 shadow-sm backdrop-blur-md">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-4 text-left">
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-gray-200">STAGE1 論点（{issueBlocks.length}件）</h3>
          <span className="text-xs text-gray-500">取得元: {sourceLabel}</span>
        </div>
        <span className="text-gray-400">{collapsed ? '▼' : '▲'}</span>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-3">
          {(metricsSummary?.roic !== undefined ||
            metricsSummary?.wacc !== undefined ||
            metricsSummary?.pbr !== undefined ||
            (metricsSummary as any)?.revenueCagrPct !== undefined) && (
            <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded p-2">
              <div className="grid grid-cols-2 gap-1">
                {metricsSummary?.roic !== undefined && <span>ROIC: {metricsSummary.roic.toFixed(1)}%</span>}
                {metricsSummary?.wacc !== undefined && <span>WACC: {metricsSummary.wacc.toFixed(1)}%</span>}
                {metricsSummary?.pbr !== undefined && <span>PBR: {metricsSummary.pbr.toFixed(2)}倍</span>}
                {(metricsSummary as any)?.revenueCagrPct !== undefined && (
                  <span>売上CAGR: {(metricsSummary as any).revenueCagrPct.toFixed(1)}%</span>
                )}
              </div>
            </div>
          )}

          <div className="max-h-[420px] overflow-auto pr-2 space-y-3">
            {issueBlocks.map((issue, i) => (
              <div key={i} className="border-l-2 border-blue-400 pl-3 py-1">
                <div className="font-medium text-sm text-gray-800 dark:text-gray-200">{issue.title || `論点 ${i + 1}`}</div>

                {issue.description && (
                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    <ScrollText maxH="max-h-[140px]">{issue.description}</ScrollText>
                  </div>
                )}

                {issue.linkedMetrics?.length > 0 && (
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {issue.linkedMetrics.map((m) => (
                      <span key={m} className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                        {m}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================================================
 * CEO Intent セクション
 * =================================================== */
function CEOIntentSection() {
  const setCeoIntent = useStrategyStore((s: StrategyState) => s.setCeoIntent);
  const ceoIntent = useStrategyStore((s: StrategyState) => s.ceoIntent ?? '');

  return (
    <div className="rounded-2xl border border-black/10 bg-white/70 dark:bg-white/5 shadow-sm backdrop-blur-md p-6">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">経営者の思い</h3>

      <GlassCard title="経営者の思い" hint="原点・譲れない価値観・実現したい未来など、企業の根底にある思いを記入してください">
        <AutoResizeTextarea
          value={ceoIntent}
          onChange={(e) => setCeoIntent(e.target.value)}
          placeholder="例：なぜこの会社を続けるのか / 何を実現したいのか / 譲れない価値観…"
          className="min-h-[120px] w-full rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
          minRows={6}
          maxRows={32}
        />
      </GlassCard>
    </div>
  );
}

/* ===================================================
 * MVVセクション
 * =================================================== */
function MVVSection() {
  const setMVV = useStrategyStore((s: StrategyState) => s.setMVV);
  const mission = useStrategyStore((s: StrategyState) => s.mission ?? '');
  const vision = useStrategyStore((s: StrategyState) => s.vision ?? '');
  const value = useStrategyStore((s: StrategyState) => s.value ?? '');

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">MVV（ミッション・ビジョン・バリュー）</h3>

      <GlassCard title="Mission（ミッション）" hint="会社が存在する理由。短く、覚えやすく。">
        <AutoResizeTextarea
          value={mission}
          onChange={(e) => setMVV({ mission: e.target.value })}
          placeholder="例：私たちは〇〇で社会の課題を解決します。"
          className="min-h-[100px] w-full rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
          minRows={4}
          maxRows={24}
        />
      </GlassCard>

      <GlassCard title="Vision（ビジョン）" hint="目指す未来像。5〜10年後に到達したい状態。">
        <AutoResizeTextarea
          value={vision}
          onChange={(e) => setMVV({ vision: e.target.value })}
          placeholder="例：〇〇領域で最も信頼される企業になる。"
          className="min-h-[100px] w-full rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
          minRows={4}
          maxRows={24}
        />
      </GlassCard>

      <GlassCard title="Value（バリュー）" hint="日々の意思決定の拠り所。3〜5語で要点を。">
        <AutoResizeTextarea
          value={value}
          onChange={(e) => setMVV({ value: e.target.value })}
          placeholder="例：挑戦／誠実／共創"
          className="min-h-[100px] w-full rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
          minRows={4}
          maxRows={24}
        />
      </GlassCard>
    </div>
  );
}

/* ===================================================
 * O/T提案セクション（候補表示・追加）
 * =================================================== */
function OTSuggestionsPanel({
  suggestions,
  onAddOpportunity,
  onAddThreat,
}: {
  suggestions?: { opportunity?: string[]; threat?: string[] };
  onAddOpportunity: (text: string) => void;
  onAddThreat: (text: string) => void;
}) {
  if (!suggestions || (!Array.isArray(suggestions.opportunity) && !Array.isArray(suggestions.threat))) {
    return null;
  }

  const opportunities = Array.isArray(suggestions.opportunity) ? suggestions.opportunity : [];
  const threats = Array.isArray(suggestions.threat) ? suggestions.threat : [];

  if (opportunities.length === 0 && threats.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20 p-6">
      <h4 className="text-base font-semibold text-blue-700 dark:text-blue-300 mb-4">提案された機会と脅威</h4>

      {opportunities.length > 0 && (
        <div className="mb-6">
          <h5 className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-3">提案された機会（Opportunity）</h5>
          <div className="space-y-2">
            {opportunities.map((opp, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-white/50 dark:bg-white/5">
                <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{opp}</span>
                <button
                  onClick={() => onAddOpportunity(opp)}
                  className="px-3 py-1 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors whitespace-nowrap"
                >
                  追加
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {threats.length > 0 && (
        <div>
          <h5 className="text-sm font-medium text-amber-600 dark:text-amber-400 mb-3">提案された脅威（Threat）</h5>
          <div className="space-y-2">
            {threats.map((threat, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-white/50 dark:bg-white/5">
                <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{threat}</span>
                <button
                  onClick={() => onAddThreat(threat)}
                  className="px-3 py-1 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 transition-colors whitespace-nowrap"
                >
                  追加
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================================================
 * ★ 業績目標 (companyTargets) セクション
 * =================================================== */
interface CompanyTargetsSectionProps {
  companyTargets: any[];
  issueBlocks: any[];
}

const NS_LABEL_PRESETS = [
  '売上',
  '営業利益',
  '粗利',
  'EBITDA',
  '営業利益率',
  'ROIC',
  'フリーキャッシュフロー',
  '受注高',
  '顧客数',
  '解約率',
] as const;

const NS_UNIT_PRESETS = [
  '円',
  '千円',
  '百万円',
  '%',
  '件',
  '人',
  '回',
] as const;

type PrioritySimple = 'primary' | 'secondary' | 'reference';

function priorityLabel(p?: PrioritySimple) {
  if (p === 'primary') return '主KPI';
  if (p === 'secondary') return '副KPI';
  return '参考';
}

function CompanyTargetsSection({ companyTargets: _unused, issueBlocks }: CompanyTargetsSectionProps) {
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    labelPreset: '売上',
    labelOther: '',
    unit: '百万円',
    base: '',
    dueYear: '',
    prioritySimple: 'primary' as PrioritySimple, // 任意
    rationale: '',
    linkedIssueIds: [] as string[],
  });

  // ★ store から直接読み取り（props に依存しない）
  const companyTargets = useStrategyStore((s: StrategyState) => (s as any).companyTargets || EMPTY_ARR);
  const addCompanyTarget = useStrategyStore((s: StrategyState) => (s as any).addCompanyTarget);
  const updateCompanyTarget = useStrategyStore((s: StrategyState) => (s as any).updateCompanyTarget);
  const removeCompanyTarget = useStrategyStore((s: StrategyState) => (s as any).removeCompanyTarget);

  const resolvedLabel =
    formData.labelPreset === 'その他' ? formData.labelOther.trim() : formData.labelPreset;

  const resetForm = () => {
    setFormData({
      labelPreset: '売上',
      labelOther: '',
      unit: '百万円',
      base: '',
      dueYear: '',
      prioritySimple: 'primary',
      rationale: '',
      linkedIssueIds: [],
    });
    setIsAddingNew(false);
    setEditingId(null);
  };

  const handleAdd = () => {
    if (!resolvedLabel || !formData.base) {
      alert('ラベル と 目標値 は必須です');
      return;
    }

    const newId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `target_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // ★ A版：数値本体は base のみ（low/high はUIから除外）
    const newTarget = {
      id: newId,
      label: resolvedLabel,
      unit: formData.unit || '',
      base: Number(formData.base) || 0,
      dueYear: formData.dueYear ? Number(formData.dueYear) : undefined,
      // 互換：既存 priority:number を壊さないため、prioritySimple を主に使い、priority は表示用にマップ
      prioritySimple: formData.prioritySimple,
      priority:
        formData.prioritySimple === 'primary'
          ? 4
          : formData.prioritySimple === 'secondary'
            ? 3
            : 2,
      rationale: formData.rationale || '',
      linkedIssueIds: formData.linkedIssueIds,
    };

    addCompanyTarget?.(newTarget);
    resetForm();
  };

  const handleUpdate = () => {
    if (!resolvedLabel || !formData.base || !editingId) return;

    updateCompanyTarget?.(editingId, {
      label: resolvedLabel,
      unit: formData.unit || '',
      base: Number(formData.base) || 0,
      dueYear: formData.dueYear ? Number(formData.dueYear) : undefined,
      prioritySimple: formData.prioritySimple,
      priority:
        formData.prioritySimple === 'primary'
          ? 4
          : formData.prioritySimple === 'secondary'
            ? 3
            : 2,
      rationale: formData.rationale || '',
      linkedIssueIds: formData.linkedIssueIds,
    });

    resetForm();
  };

  const handleEdit = (ct: any) => {
    const presetHit = (NS_LABEL_PRESETS as readonly string[]).includes((ct.label ?? '') as any);
    const unitHit = (NS_UNIT_PRESETS as readonly string[]).includes((ct.unit ?? '') as any);

    setFormData({
      labelPreset: presetHit ? (ct.label ?? '売上') : 'その他',
      labelOther: presetHit ? '' : String(ct.label ?? ''),
      unit: unitHit ? (ct.unit ?? '百万円') : '百万円',
      base: String(ct.base ?? ''),
      dueYear: ct.dueYear !== undefined ? String(ct.dueYear) : '',
      prioritySimple: (ct.prioritySimple as PrioritySimple) || 'reference',
      rationale: ct.rationale || '',
      linkedIssueIds: ct.linkedIssueIds || [],
    });

    setEditingId(ct.id);
    setIsAddingNew(false);
  };

  const handleDelete = (id: string) => {
    removeCompanyTarget?.(id);
  };

  return (
    <div className="rounded-2xl border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-900/20 p-6">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">🏁 業績目標</h3>

      {/* 既存目標表示 */}
      <div className="space-y-3 max-h-[500px] overflow-auto mb-6">
        {companyTargets.length === 0 && !isAddingNew && !editingId && (
          <p className="text-sm text-gray-600 dark:text-gray-400">業績目標はまだ設定されていません</p>
        )}

        {companyTargets.map((ct: any, idx: number) => {
          const ctId = ct?.id && typeof ct.id === 'string' ? ct.id : `ct-${idx}-${ct?.label ?? 'no-label'}`;
          return (
            <div
              key={ctId}
              className="p-3 bg-white/60 dark:bg-white/5 rounded-lg border border-purple-200 dark:border-purple-700"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="font-medium text-gray-800 dark:text-gray-100">
                    {ct.label}
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-purple-100/70 dark:bg-purple-800/40 text-purple-700 dark:text-purple-200">
                      {priorityLabel(ct.prioritySimple)}
                    </span>
                  </div>

                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    {ct.unit && `単位: ${ct.unit}`}
                    {ct.dueYear && ` | 目標年: ${ct.dueYear}`}
                  </div>

                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">目標値: {ct.base}</div>

                  {ct.rationale && (
                    <div className="text-xs text-purple-700 dark:text-purple-300 mt-2 p-2 bg-purple-100/30 dark:bg-purple-800/30 rounded">
                      {ct.rationale}
                    </div>
                  )}

                  {ct.linkedIssueIds?.length > 0 && (
                    <div className="text-xs text-blue-600 dark:text-blue-400 mt-2">関連論点: {ct.linkedIssueIds.length}件</div>
                  )}
                </div>

                <div className="ml-2 flex gap-1">
                  <button
                    type="button"
                    onClick={() => handleEdit(ct)}
                    className="px-2 py-1 text-xs rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50"
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(ct.id)}
                    className="px-2 py-1 text-xs rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50"
                  >
                    削除
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 追加/編集フォーム */}
      {(isAddingNew || editingId) && (
        <div className="border-t border-purple-200 dark:border-purple-700 pt-6 mb-6">
          <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4">{editingId ? '編集' : '新規追加'}</h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                ラベル <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.labelPreset}
                onChange={(e) => setFormData({ ...formData, labelPreset: e.target.value })}
                className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white/70 dark:bg-white/5"
              >
                {NS_LABEL_PRESETS.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
                <option value="その他">その他（自由入力）</option>
              </select>

              {formData.labelPreset === 'その他' && (
                <input
                  type="text"
                  value={formData.labelOther}
                  onChange={(e) => setFormData({ ...formData, labelOther: e.target.value })}
                  className="w-full mt-2 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white/70 dark:bg-white/5"
                  placeholder="例）受注残、製造原価率 など"
                />
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">単位</label>
              <select
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white/70 dark:bg-white/5"
              >
                {NS_UNIT_PRESETS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                目標値 <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                value={formData.base}
                onChange={(e) => setFormData({ ...formData, base: e.target.value })}
                className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white/70 dark:bg-white/5"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">目標年</label>
              <input
                type="number"
                value={formData.dueYear}
                onChange={(e) => setFormData({ ...formData, dueYear: e.target.value })}
                className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white/70 dark:bg-white/5"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">重要度（任意）</label>
              <select
                value={formData.prioritySimple}
                onChange={(e) => setFormData({ ...formData, prioritySimple: e.target.value as PrioritySimple })}
                className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white/70 dark:bg-white/5"
              >
                <option value="primary">主KPI</option>
                <option value="secondary">副KPI</option>
                <option value="reference">参考</option>
              </select>
            </div>
          </div>

          <div className="mb-4">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">根拠・説明（任意）</label>
            <AutoResizeTextarea
              value={formData.rationale}
              onChange={(e) => setFormData({ ...formData, rationale: e.target.value })}
              className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white/70 dark:bg-white/5"
              placeholder="この業績目標を設定した理由"
              minRows={3}
              maxRows={12}
            />
          </div>

          <div className="mb-4">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">関連論点（複数選択可）</label>
            <div className="grid grid-cols-2 gap-2 mt-2 max-h-[150px] overflow-auto bg-white/30 dark:bg-white/5 p-3 rounded-lg">
              {issueBlocks.map((issue: any, idx: number) => {
                const rawId = issue?.id;
                const issueId =
                  typeof rawId === 'string' && rawId.trim().length > 0
                    ? rawId
                    : `issue-${idx}-${(issue?.title ?? 'no-title').replace(/\s+/g, '-')}`;

                return (
                  <label key={issueId} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={formData.linkedIssueIds.includes(issueId)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFormData((prev) => ({
                          ...prev,
                          linkedIssueIds: checked
                            ? Array.from(new Set([...prev.linkedIssueIds, issueId]))
                            : prev.linkedIssueIds.filter((x) => x !== issueId),
                        }));
                      }}
                      className="rounded"
                    />
                    <span className="text-gray-700 dark:text-gray-300 truncate">{issue?.title || `（無題の論点 ${idx}）`}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 text-sm rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={editingId ? handleUpdate : handleAdd}
              className="px-4 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700"
            >
              {editingId ? '更新' : '追加'}
            </button>
          </div>
        </div>
      )}

      {!isAddingNew && !editingId && (
        <button
          type="button"
          onClick={() => setIsAddingNew(true)}
          className="w-full px-4 py-2 text-sm rounded-lg border border-dashed border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-400 hover:bg-purple-50/50 dark:hover:bg-purple-900/10 transition-colors"
        >
          + 新規メトリクスを追加
        </button>
      )}
    </div>
  );
}
/* ===================================================
 * SWOTセクション
 * =================================================== */
function SWOTSection() {
  const setSWOT = useStrategyStore((s: StrategyState) => s.setSWOT);
  const strength = useStrategyStore((s: StrategyState) => s.strength ?? '');
  const weakness = useStrategyStore((s: StrategyState) => s.weakness ?? '');
  const opportunity = useStrategyStore((s: StrategyState) => s.opportunity ?? '');
  const threat = useStrategyStore((s: StrategyState) => s.threat ?? '');

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">SWOT分析</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GlassCard title="Strength（強み）" accentClass="bg-emerald-400/80" hint="自社の競争優位性">
          <AutoResizeTextarea
            className="min-h-[120px] w-full rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            value={strength}
            onChange={(e) => setSWOT({ strength: e.target.value })}
            placeholder="例：高度な技術力／顧客との信頼関係"
            minRows={4}
            maxRows={30}
          />
        </GlassCard>

        <GlassCard title="Weakness（弱み）" accentClass="bg-rose-400/80" hint="改善が必要な領域">
          <AutoResizeTextarea
            className="min-h-[120px] w-full rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            value={weakness}
            onChange={(e) => setSWOT({ weakness: e.target.value })}
            placeholder="例：人材不足／情報発信の弱さ"
            minRows={4}
            maxRows={30}
          />
        </GlassCard>

        <GlassCard title="Opportunity（機会）" accentClass="bg-sky-400/80" hint="外部環境の追い風">
          <AutoResizeTextarea
            className="min-h-[120px] w-full rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            value={opportunity}
            onChange={(e) => setSWOT({ opportunity: e.target.value })}
            placeholder="例：市場拡大／規制緩和"
            minRows={4}
            maxRows={30}
          />
        </GlassCard>

        <GlassCard title="Threat（脅威）" accentClass="bg-amber-400/80" hint="外部環境のリスク">
          <AutoResizeTextarea
            className="min-h-[120px] w-full rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            value={threat}
            onChange={(e) => setSWOT({ threat: e.target.value })}
            placeholder="例：価格競争の激化／景気悪化"
            minRows={4}
            maxRows={30}
          />
        </GlassCard>
      </div>
    </div>
  );
}

/* ===================================================
 * たたき台（Draft）プレビュー：全文＋スクロール
 * =================================================== */

function stripIssueSummaryFromDisplay(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/論点サマリ[ー]?\s*[:：][\s\S]*?(?=\n\s*(?:これら|現在|私たち|当社|我々|第[二三四2-4]章|$))/g, '')
    .replace(/^\s*(?:論点\s*[（(]STAGE1分析より[）)]|最大5件表示)\s*\n?/gm, '')
    .replace(/^\s*[-・]?\s*論点\d+[:：].*$/gm, '')
    .replace(/^\s*\d+\.\s*[^\n]*(?:論点|成長投資|市場評価|価値創造)[^\n]*\n(?:[^\n]*\n){0,3}/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function DraftStoryPanel({ storyDraft, issueBlocks }: { storyDraft: StoryChapter[]; issueBlocks: IssueBlock[] }) {
  const has = storyDraft && storyDraft.length > 0;
  if (!has) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-800/50 p-6 text-center">
        <h4 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">4章ストーリー（未生成）</h4>
        <p className="text-xs text-gray-400 dark:text-gray-500">「入力」タブで「たたき台を生成」を実行すると結果が表示されます</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-black/10 bg-white/70 dark:bg-white/5 shadow-sm backdrop-blur-md p-4">
      <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-3">4章ストーリー</h4>

      <div className="space-y-3">
        {storyDraft.map((chapter, i) => (
          <div key={i} className="border-l-2 border-blue-400 pl-3">
            <div className="text-xs font-medium text-blue-600 dark:text-blue-400">{chapter.title}</div>

            {i === 0 && issueBlocks && issueBlocks.length > 0 && (
              <div className="mt-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-white/5 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">論点（STAGE1分析より）</div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">最大5件表示</div>
                </div>
                <div className="space-y-2">
                  {issueBlocks.slice(0, 5).map((iss, idx) => (
                    <div key={(iss as any).id ?? idx} className="rounded-lg border border-gray-100 dark:border-gray-800 bg-white/70 dark:bg-gray-900/20 px-3 py-2">
                      <div className="text-xs font-medium text-gray-800 dark:text-gray-200">{idx + 1}. {iss.title}</div>
                      {iss.description && (
                        <div className="mt-1 text-[12px] text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words">
                          {iss.description}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-1 text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words leading-relaxed">
              {stripIssueSummaryFromDisplay(chapter.body)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===================================================
 * 12問回答セクション（原型維持）
 * - 修正：必須表示を撤廃し、入力済み数表示へ
 * =================================================== */
function Questions12Section({
  answers12,
  onUpdateAnswer,
  disabled,
}: {
  answers12: Stage2Answer[];
  onUpdateAnswer: (id: string, answer: string) => void;
  disabled?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string>(TEMPLATE12[0].id);

  /* ★ TASK A-5: answers12 の配列ガード（万一でも .find() で落ちない） */
  const safeAnswers12 = Array.isArray(answers12) ? answers12 : [];

  const selectedQ = TEMPLATE12.find((q) => q.id === selectedId) || TEMPLATE12[0];
  const currentAnswer = safeAnswers12.find((a) => a.id === selectedId)?.answer ?? '';

  const groupedQuestions = useMemo(() => {
    return TEMPLATE12.reduce<Record<number, typeof TEMPLATE12>>((acc, q) => {
      if (!acc[q.chapter]) acc[q.chapter] = [];
      acc[q.chapter].push(q);
      return acc;
    }, {});
  }, []);

  const answeredTotal = safeAnswers12.filter((a) => a.answer?.trim()).length;

  return (
    <div className="rounded-2xl border border-black/10 bg-white/70 dark:bg-white/5 shadow-sm backdrop-blur-md p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">12のディスカッションテーマ</h3>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          入力済み: {answeredTotal}/{TEMPLATE12.length}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* 左: 質問リスト */}
        <div className="lg:col-span-4 space-y-3">
          <div className="max-h-[520px] overflow-auto pr-2 space-y-3">
            {Object.entries(groupedQuestions).map(([chapterIdx, questions]) => (
              <div key={chapterIdx} className="space-y-1">
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 px-2">
                  {CHAPTER_LABELS[Number(chapterIdx)]}
                </div>

                {questions.map((q, idx) => {
                  const isAnswered = !!safeAnswers12.find((a) => a.id === q.id && a.answer?.trim());
                  const isSelected = selectedId === q.id;

                  return (
                    <button
                      key={q.id}
                      onClick={() => setSelectedId(q.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                        isSelected
                          ? 'bg-blue-100 dark:bg-blue-900/40 border border-blue-300 dark:border-blue-700'
                          : 'bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-5 h-5 flex items-center justify-center rounded-full text-xs ${
                            isAnswered ? 'bg-green-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                          }`}
                        >
                          {isAnswered ? '✓' : idx + 1}
                        </span>

                        <span className="flex-1 text-gray-700 dark:text-gray-300 break-words">{q.question}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* 右: 選択中の質問と回答入力 */}
        <div className="lg:col-span-8 space-y-4">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-white/5 p-4">
            <div className="flex items-start gap-2 mb-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">{CHAPTER_LABELS[selectedQ.chapter]}</span>
            </div>
            <h4 className="text-base font-medium text-gray-800 dark:text-gray-200 mb-2">{selectedQ.question}</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">💡 {selectedQ.reason}</p>
          </div>

          <AutoResizeTextarea
            value={currentAnswer}
            onChange={(e) => onUpdateAnswer(selectedId, e.target.value)}
            disabled={disabled}
            placeholder="この質問に対するあなたの考えを記入してください（未回答でも最終ストーリーは生成できます）..."
            className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-white/5 px-4 py-3 text-sm text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            minRows={4}
            maxRows={18}
          />

          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{currentAnswer.length} 文字</span>
            {currentAnswer.trim() && <span className="text-green-600 dark:text-green-400">✓ 入力済み</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===================================================
 * メイン
 * =================================================== */
function Stage2PageContent({ readOnly = false, disabled = false }: { readOnly?: boolean; disabled?: boolean } = {}) {
  const router = useRouter();

  // ★ STAGE2 プレビュー画面への遷移
  const handleOpenStrategy = () => {
    router.push('/report/stage2-strategy');
  };

  // Store / User
  const storeIssues = useStrategyStore((s: StrategyState) => s.stage1Issues);
  const storeValueAnalysis = useStrategyStore((s: StrategyState) => s.valueAnalysis);
  const setStage1Issues = useStrategyStore((s: StrategyState) => s.setStage1Issues);

  const thought = useStrategyStore((s: StrategyState) => s.thought ?? '');
  const mission = useStrategyStore((s: StrategyState) => s.mission ?? '');
  const vision = useStrategyStore((s: StrategyState) => s.vision ?? '');
  const value = useStrategyStore((s: StrategyState) => s.value ?? '');

  // ★ 追加：Stage2Page内でもceoIntentを参照できるようにする（ReferenceError対策）
  const ceoIntent = useStrategyStore((s: StrategyState) => s.ceoIntent ?? '');

  const strength = useStrategyStore((s: StrategyState) => s.strength ?? '');
  const weakness = useStrategyStore((s: StrategyState) => s.weakness ?? '');
  const opportunity = useStrategyStore((s: StrategyState) => s.opportunity ?? '');
  const threat = useStrategyStore((s: StrategyState) => s.threat ?? '');

  const industry = useStrategyStore((s: StrategyState) => s.industry ?? '');
  const revenue = useStrategyStore((s: StrategyState) => s.revenue ?? '');
  const employees = useStrategyStore((s: StrategyState) => s.employees ?? '');
  const businessContent = useStrategyStore((s: StrategyState) => s.businessContent ?? '');
  const businessSegments = useStrategyStore((s: StrategyState) => s.businessSegments ?? []); // ★ STAGE1で定義されたセグメント情報
  const segmentPL = useStrategyStore((s: StrategyState) => (s as any).segmentPL ?? {}); // ★ STAGE1で定義された事業別P/L
  const businessPortfolio = useStrategyStore((s: StrategyState) => (s as any).businessPortfolio ?? null); // ★ 現在の事業ポートフォリオ（型揺れ許容）

  const companyId = useUserStore((s) => s.companyId);
  const userId = useUserStore((s) => s.user?.id);
  const hydrated = useStrategyStore((s: StrategyState) => s.hydrated);

  /* ★ TASK A-1: answers12 をArrayガード付きで統一 */
  // ★ 参照安定化：EMPTY_ARR を使って無限ループ防止
  const answers12 = useStrategyStore((s: StrategyState) => {
    const v = (s as any).answers12;
    return Array.isArray(v) ? v : EMPTY_ARR;
  });
  const setAnswers12 = useStrategyStore(
    (s: StrategyState) => (s as any).setAnswers12 as (a: Stage2Answer[]) => void
  );

  // finalStory store連携
  /* ★ TASK 16: Store 一本化（local state 廃止） */
  // STAGE2 値を store から取得
  // ★ 修正：安定参照を使用してZustandメモ化バイパス防止
  const storyDraft = useStrategyStore((s: StrategyState) => s.storyDraft ?? EMPTY_STORY_DRAFT);
  const setStoryDraft = useStrategyStore((s: StrategyState) => s.setStoryDraft);

  const winPatternsCandidate = useStrategyStore((s: StrategyState) => (s as any).winPatternsCandidate ?? EMPTY_WIN_PATTERNS);
  const setWinPatternsCandidate = useStrategyStore((s: StrategyState) => (s as any).setWinPatternsCandidate as any);

  // ★ 参照安定化：EMPTY_ARR を使って無限ループ防止
  const companyTargets = useStrategyStore((s: StrategyState) => (s as any).companyTargets || EMPTY_ARR);
  const setCompanyTargets = useStrategyStore((s: StrategyState) => (s as any).setCompanyTargets as any);

  // ★ TASK A: 現状値取得（多段フォールバック：metricsSummary → financeSummary → financePL）
  // ★ 参照安定化：EMPTY_ARR を使って無限ループ防止
  const financePL = useStrategyStore((s: StrategyState) => s.financePL || EMPTY_ARR);
  const financeSummary = useStrategyStore((s: StrategyState) => (s as any).financeSummary || EMPTY_ARR);

  const finalStory = useStrategyStore((s: StrategyState) => s.finalStory ?? EMPTY_STORY_DRAFT);

  // finalStory 3状態 setter（北星・最終ストーリー編集用）
  const setFinalStoryDraft = useStrategyStore((s: StrategyState) => (s as any).setFinalStoryDraft);
  const setFinalStoryEdited = useStrategyStore((s: StrategyState) => (s as any).setFinalStoryEdited);
  const commitFinalStory = useStrategyStore((s: StrategyState) => (s as any).commitFinalStory);

  // 互換性維持
  const setStoreFinalStory = useStrategyStore((s: StrategyState) => s.setFinalStory);
  const setLocalFinalStory = setStoreFinalStory;

  /* ★ TASK A-1: answers12 を統一（line 772-773 と重複定義を廃止） */
  // answers12 は line 773 の setAnswers12 を使用
  // 重複定義を廃止（下記は削除したもの）
  // const answers12 = useStrategyStore((s: StrategyState) => (s as any).answers12 ?? EMPTY_ANSWERS12);
  // const setLocalAnswers12 = useStrategyStore((s: StrategyState) => (s as any).setAnswers12 as any);
  // 代わりに line 772 の storeAnswers12 を answers12 として使用する（下記で名前変更）

  // STAGE2：最終ストーリー3段階（読み取り+setter）
  const finalStoryDraftRaw = useStrategyStore((s: StrategyState) => s.finalStoryDraft);
  const finalStoryEditedRaw = useStrategyStore((s: StrategyState) => s.finalStoryEdited);
  const finalStoryFinalRaw = useStrategyStore((s: StrategyState) => s.finalStoryFinal);
  // setFinalStoryDraft, setFinalStoryEdited, commitFinalStory は上記 796-798行で定義済み

  // SWOT suggestions store連携（Hooks Rule: top-level で呼ぶ）
  const swotSuggestions = useStrategyStore((s: StrategyState) => s.swotSuggestions);
  const addSwotOpportunity = useStrategyStore((s: StrategyState) => s.addSwotOpportunity);
  const addSwotThreat = useStrategyStore((s: StrategyState) => s.addSwotThreat);

  // ★ STEP10: 戦略書プレビュー用データ
  const companyName = useStrategyStore((s: StrategyState) => (s as any).companyName as string | undefined);
  const midtermStrategy = useStrategyStore((s: StrategyState) => s.midtermStrategy);

  // Local UI state
  const [loading, setLoading] = useState(true);
  const [issueBlocks, setIssueBlocks] = useState<IssueBlock[]>([]);
  const [metricsSummary, setMetricsSummary] = useState<MetricsSummary>({});
  const [dataSource, setDataSource] = useState<'store' | 'localStorage' | 'supabase' | 'none'>('none');
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generating flags
  const [generating, setGenerating] = useState(false);
  const [generatingOT, setGeneratingOT] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateOTError, setGenerateOTError] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);

  // Final
  const [selectedWinPatternId, setSelectedWinPatternId] = useState<string | null>(null); // UIでは選択させない（内部参照用）
  const [editingStory, setEditingStory] = useState<StoryChapter[]>([]);
  const [generatingFinal, setGeneratingFinal] = useState(false);
  const [generateFinalError, setGenerateFinalError] = useState<string | null>(null);
  // ★ 最終ストーリーの表示モード：デフォルトは経営層向けドキュメント表示。編集はトグルで切替
  const [storyEditMode, setStoryEditMode] = useState(false);

  // ★ TASK A: 現状→目標 KPI ブリッジデータを計算（安全な単位推定＆多段フォールバック）
  const kpiBridgeData = useMemo(() => {
    const DEBUG = true; // Phase 0: Force debug to detect unit mixing

    if (DEBUG) {
      // Step 1: ソースの生データを出力（診断用）
      const financePLSample =
        Array.isArray(financePL) && financePL.length > 0
          ? {
              len: financePL.length,
              latestYear: financePL.reduce((max: any, r: any) => (r.year > max ? r.year : max), 0),
              keys: Object.keys(financePL[0] || {}),
              revenue: (financePL[0] as any)?.revenue,
              sales: (financePL[0] as any)?.sales,
              operatingIncome: (financePL[0] as any)?.operatingIncome,
              op: (financePL[0] as any)?.op,
              営業利益: (financePL[0] as any)?.営業利益,
            }
          : { len: 0 };

      const financeSummarySample =
        Array.isArray(financeSummary) && financeSummary.length > 0
          ? {
              len: financeSummary.length,
              latestYear: financeSummary.reduce((max: any, r: any) => (r.year > max.year ? r.year : max.year), 0),
              keys: Object.keys(financeSummary[0] || {}),
              revenue: (financeSummary[0] as any)?.revenue,
              operating_income: (financeSummary[0] as any)?.operating_income,
            }
          : { len: 0 };

      const metricsSummarySample = metricsSummary
        ? {
            exists: true,
            keys: Object.keys(metricsSummary),
            revenue: (metricsSummary as any)?.revenue,
            sales: (metricsSummary as any)?.sales,
            operatingIncome: (metricsSummary as any)?.operatingIncome,
            op: (metricsSummary as any)?.op,
          }
        : { exists: false };

      const targetsSample =
        Array.isArray(companyTargets) && companyTargets.length > 0
          ? {
              len: companyTargets.length,
              labels: companyTargets.map((t: any) => t.label),
              firstTarget: companyTargets[0],
            }
          : { len: 0 };

      console.log('[diag][kpi][sources]', {
        financePL: financePLSample,
        financeSummary: financeSummarySample,
        metricsSummary: metricsSummarySample,
        companyTargets: targetsSample,
      });
    }

    // ★ 多段フォールバック：metricsSummary → financeSummary → financePL
    let currentRevenue: number | null = null;
    let currentOperatingProfit: number | null = null;
    let revenueSource = '';
    let opSource = '';
    let revenueRaw: number | null = null;  // 元データ（変換前）
    let opIncomeRaw: number | null = null; // 元データ（変換前）

    // 1) metricsSummary（STAGE1 最新の指標）
    if (metricsSummary && typeof metricsSummary === 'object') {
      const ms = metricsSummary as Record<string, any>;
      const revVal = ms.revenue ?? ms.sales ?? (ms as any).売上;
      const opVal = ms.operatingIncome ?? ms.op ?? (ms as any).営業利益;

      const rev = safeNumber(revVal);
      const op = safeNumber(opVal);

      if (rev !== null) {
        revenueRaw = rev;
        currentRevenue = toMillionYen(rev, 'unknown');
        revenueSource = 'metricsSummary';
      }

      if (op !== null) {
        opIncomeRaw = op;
        currentOperatingProfit = toMillionYen(op, 'unknown');
        opSource = 'metricsSummary';
      }
    }

    // 2) financeSummary（ビジネスユニット別集計）- 最新年度の合計
    if (!currentRevenue && Array.isArray(financeSummary) && financeSummary.length > 0) {
      const latest = financeSummary.reduce((max: any, row: any) => (row.year > max.year ? row : max));
      const revVal = latest.revenue;
      const rev = safeNumber(revVal);
      if (rev !== null) {
        revenueRaw = rev;
        currentRevenue = toMillionYen(rev, 'unknown');
        revenueSource = 'financeSummary';
      }
    }

    // 3) financePL（年度別PL）- 最新年度
    if ((!currentRevenue || !currentOperatingProfit) && Array.isArray(financePL) && financePL.length > 0) {
      const latestRow = financePL.reduce((max: any, row: any) => (row.year > max.year ? row : max));

      if (!currentRevenue) {
        const revVal = latestRow.revenue ?? (latestRow as any).sales;
        const rev = safeNumber(revVal);
        if (rev !== null) {
          revenueRaw = rev;
          currentRevenue = toMillionYen(rev, 'unknown');
          revenueSource = 'financePL';
        }
      }

      if (currentOperatingProfit == null) {
        const opVal = latestRow.operatingIncome ?? (latestRow as any).op ?? (latestRow as any).営業利益;
        const op = safeNumber(opVal);
        if (op !== null) {
          opIncomeRaw = op;
          currentOperatingProfit = toMillionYen(op, 'unknown');
          opSource = 'financePL';
        }
      }
    }

    // ★ Phase 1: Normalize Now values (from financePL) using inferScaleToMillion
    const nowRevM = inferScaleToMillion(revenueRaw);
    const nowOpM = inferScaleToMillion(opIncomeRaw);

    // グラフに渡す "Now" は converted を使う（unitLabel=百万円に合わせる）
    const chartRevenueNow = nowRevM?.converted ?? currentRevenue;
    const chartOpNow = nowOpM?.converted ?? currentOperatingProfit;

    // ★ 目標：companyTargets から label マッチで抽出
    // 重要：業績目標の数値本体は UI/Store 上「base」。
    //       priority(1-4) や target/value 等の揺れキーは事故源になるため、ここでは一切参照しない。
    let targetRevenue: number | null = null;
    let targetOperatingProfit: number | null = null;
    let targetRevenueLabel = '';
    let targetOpLabel = '';

    if (Array.isArray(companyTargets) && companyTargets.length > 0) {
      for (const target of companyTargets) {
        const label = (target.label ?? '').trim().toLowerCase();

        // 売上パターン
        if (targetRevenue == null && (label.includes('売上') || label.includes('revenue') || label.includes('sales') || label.includes('top line'))) {
          const valNum = safeNumber((target as any).base);
          if (valNum !== null) {
            const inferred = inferScaleToMillion(valNum);
            targetRevenue = inferred?.converted ?? toMillionYen(valNum, 'unknown');
            targetRevenueLabel = target.label ?? '';
            if (DEBUG) console.log('[KPI] companyTargets revenue:', { label: target.label, raw: valNum, converted: targetRevenue, unit: (target as any).unit, scale: inferred });
          }
        }

        // 営業利益パターン
        if (
          targetOperatingProfit == null &&
          (label.includes('営業利益') || label.includes('operating profit') || label === 'op' || label.includes('operating income'))
        ) {
          const valNum = safeNumber((target as any).base);
          if (valNum !== null) {
            const inferred = inferScaleToMillion(valNum);
            targetOperatingProfit = inferred?.converted ?? toMillionYen(valNum, 'unknown');
            targetOpLabel = target.label ?? '';
            if (DEBUG) console.log('[KPI] companyTargets op:', { label: target.label, raw: valNum, converted: targetOperatingProfit, unit: (target as any).unit, scale: inferred });
          }
        }
      }
    }

    if (DEBUG) {
      // Phase 0: Unit audit logs in specified format
      console.log(
        '[stage2][unit-audit] revenueRaw=' + revenueRaw + ' opIncomeRaw=' + opIncomeRaw + ' source=' + revenueSource + '/' + opSource
      );
      console.log(
        '[stage2][unit-audit] chartRevenueNow=' + chartRevenueNow + ' chartRevenueTarget=' + targetRevenue + ' (unitLabel=百万円)'
      );
      console.log(
        '[stage2][unit-audit] chartOpNow=' + chartOpNow + ' chartOpTarget=' + targetOperatingProfit + ' (unitLabel=百万円)'
      );
      console.log(
        '[stage2][unit-audit] absRevenueRaw=' + (revenueRaw !== null ? Math.abs(revenueRaw) : 'null') +
          ' absOpIncomeRaw=' + (opIncomeRaw !== null ? Math.abs(opIncomeRaw) : 'null')
      );
      console.log(
        '[stage2][unit-audit] typeOfRevenueRaw=' + typeof revenueRaw + ' typeOfOpIncomeRaw=' + typeof opIncomeRaw
      );
    }

    // ★ TASK A-1: 表示用に百万円フォーマット（Now は Phase1で inferScaleToMillion 済み）
    return {
      revenue: {
        current: chartRevenueNow,
        target: targetRevenue,
      },
      operatingProfit: {
        current: chartOpNow,
        target: targetOperatingProfit,
      },
    };
  }, [financePL, financeSummary, metricsSummary, companyTargets]);

  // ★ TASK A-2: Final タブの表示モード（auto / draft / edited / final）
  const [storyViewMode, setStoryViewMode] = useState<'auto' | 'draft' | 'edited' | 'final'>('auto');

  // 表示対象の章を決定する関数
  const pickStory = (): StoryChapter[] => {
    if (storyViewMode === 'draft') return finalStoryDraftRaw || EMPTY_ARR;
    if (storyViewMode === 'edited') return finalStoryEditedRaw || EMPTY_ARR;
    if (storyViewMode === 'final') return finalStoryFinalRaw || EMPTY_ARR;

    // auto：従来通り final > edited > draft の優先順
    if (finalStoryFinalRaw && finalStoryFinalRaw.length > 0) return finalStoryFinalRaw;
    if (finalStoryEditedRaw && finalStoryEditedRaw.length > 0) return finalStoryEditedRaw;
    if (finalStoryDraftRaw && finalStoryDraftRaw.length > 0) return finalStoryDraftRaw;
    return EMPTY_ARR;
  };

  const displayingStory = pickStory();

  // Active tab
  const [activeTab, setActiveTab] = useState<TabId>('input');

  // ★ editingStory の同期（タブ表示時＆store更新時）
  useEffect(() => {
    if (activeTab === 'final' && displayingStory.length > 0) {
      setEditingStory(displayingStory);
    }
  }, [activeTab, displayingStory]);

  // ★ Step 2: Final タブ表示版を診断ログ
  useEffect(() => {
    if (activeTab === 'final' && process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
      const usingVersion = finalStoryFinalRaw && finalStoryFinalRaw.length > 0
        ? 'final'
        : finalStoryEditedRaw && finalStoryEditedRaw.length > 0
          ? 'edited'
          : finalStoryDraftRaw && finalStoryDraftRaw.length > 0
            ? 'draft'
            : 'none';
      console.log('[diag][story][versions]', {
        draftLen: finalStoryDraftRaw?.length ?? 0,
        editedLen: finalStoryEditedRaw?.length ?? 0,
        finalLen: finalStoryFinalRaw?.length ?? 0,
        displayingVersion: usingVersion,
        titles:
          displayingStory.length > 0
            ? displayingStory.map((ch) => ch.title)
            : [],
      });
    }
  }, [activeTab, finalStoryFinalRaw, finalStoryEditedRaw, finalStoryDraftRaw, displayingStory]);

  // 同期ループ防止用
  const lastSyncedAnswersHashRef = useRef<string>('');
  const didInitRef = useRef(false);

  // 診断用 fetch（DEV限定で1回だけ）
  const diagInitRef = useRef(false);

  // Stage1 data fallback loader
  const loadStage1Data = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // 1) Store
      const result = getStage1DataWithFallback({
        stage1Issues: storeIssues,
        valueAnalysis: storeValueAnalysis,
      });

      if (result.source !== 'none' && result.issueBlocks.length > 0) {
        setIssueBlocks(result.issueBlocks);
        setMetricsSummary(result.metricsSummary);
        setDataSource(result.source);
        setLoading(false);
        return;
      }

      // 2) localStorage
      const snapshot = loadStage1SnapshotFromLocalStorage();
      if (snapshot && snapshot.issueBlocks.length > 0) {
        setIssueBlocks(snapshot.issueBlocks);
        setMetricsSummary(snapshot.metricsSummary);
        setDataSource('localStorage');
        setStage1Issues(snapshot.issueBlocks);
        setLoading(false);
        return;
      }

      // 3) Supabase (best effort)
      if (companyId) {
        try {
          const { data, error: supaError } = await getFullStrategyDataByCompany(companyId);
          if (!supaError && data) {
            const serverIssues = (data as any).stage1Issues ?? (data as any).stage1_issues ?? [];
            const serverValueAnalysis = (data as any).valueAnalysis ?? (data as any).value_analysis ?? {};
            if (Array.isArray(serverIssues) && serverIssues.length > 0) {
              setIssueBlocks(serverIssues);
              setMetricsSummary(serverValueAnalysis);
              setDataSource('supabase');
              setStage1Issues(serverIssues);
              setLoading(false);
              return;
            }
          }
        } catch (e) {
          console.warn('[Stage2] Supabase fetch failed:', e);
        }
      }

      setDataSource('none');
      setLoading(false);
    } catch (e) {
      console.error('[Stage2] loadStage1Data error:', e);
      setError('データの読み込みに失敗しました');
      setLoading(false);
    }
  }, [storeIssues, storeValueAnalysis, companyId, setStage1Issues]);

  // Stage2 restore via restoreWithAudit
  const restoreStage2Snapshot = useCallback(async () => {
    // ★ 診断：restore 開始
    console.log('[Stage2][diag] restoreStage2Snapshot START', {
      companyId: companyId?.substring(0, 8),
      timestamp: new Date().toISOString(),
    });

    // ★ Use restoreWithAudit for unified restore decision
    const decision = await restoreWithAudit('stage2', companyId, { allowSnapshot: true });

    // ★ TASK 11.6: after restore ログを常時1回出す（DEBUG 無し）
    console.log('[Stage2] after restoreWithAudit', {
      decisionId: decision.decisionId,
      sourceUsed: decision.sourceUsed,
      reason: decision.reason,
      hasHydratedState: !!decision.hydratedState,
    });

    // ★ If companyId not ready, defer (do NOT set stage2Ready)
    if (decision.sourceUsed === 'none' && decision.reason === 'companyId_not_ready') {
      console.log('[Stage2] restore deferred: companyId not ready');
      return;
    }

    // ★ If snapshot was cleared due to mismatch, return
    if (decision.sourceUsed === 'none' && decision.didClearSnapshot) {
      console.log('[Stage2] snapshot cleared due to mismatch');
      return;
    }

    // ★ TASK 11.6: DB 採用時に hydratedState を即座に store に反映
    if (decision.sourceUsed === 'db' && decision.hydratedState) {

      // ★ STEP 4: Empty-overwrite guard for DB restore
      // Prevent empty arrays from overwriting existing store values
      const guardedHydratedState = { ...decision.hydratedState };
      const storeState = useStrategyStore.getState();

      // Only restore if array has length > 0, otherwise keep existing store value
      if (Array.isArray((guardedHydratedState as any).companyTargets) && (guardedHydratedState as any).companyTargets.length === 0 && Array.isArray((storeState as any).companyTargets) && (storeState as any).companyTargets.length > 0) {
        delete (guardedHydratedState as any).companyTargets;
        if (process.env.NODE_ENV === 'development') {
          console.log('[diag][guard] Blocked empty companyTargets from overwriting store');
        }
      }
      if (Array.isArray((guardedHydratedState as any).finalStoryDraft) && (guardedHydratedState as any).finalStoryDraft.length === 0 && Array.isArray((storeState as any).finalStoryDraft) && (storeState as any).finalStoryDraft.length > 0) {
        delete (guardedHydratedState as any).finalStoryDraft;
        if (process.env.NODE_ENV === 'development') {
          console.log('[diag][guard] Blocked empty finalStoryDraft from overwriting store');
        }
      }
      if (Array.isArray((guardedHydratedState as any).finalStoryEdited) && (guardedHydratedState as any).finalStoryEdited.length === 0 && Array.isArray((storeState as any).finalStoryEdited) && (storeState as any).finalStoryEdited.length > 0) {
        delete (guardedHydratedState as any).finalStoryEdited;
        if (process.env.NODE_ENV === 'development') {
          console.log('[diag][guard] Blocked empty finalStoryEdited from overwriting store');
        }
      }
      if (Array.isArray((guardedHydratedState as any).finalStoryFinal) && (guardedHydratedState as any).finalStoryFinal.length === 0 && Array.isArray((storeState as any).finalStoryFinal) && (storeState as any).finalStoryFinal.length > 0) {
        delete (guardedHydratedState as any).finalStoryFinal;
        if (process.env.NODE_ENV === 'development') {
          console.log('[diag][guard] Blocked empty finalStoryFinal from overwriting store');
        }
      }

      // ★ 修正：swotSuggestions に対しても empty-overwrite guard を追加
      // swotSuggestions は object で、opportunity/threat配列を持つ
      // DB に保存されていない場合（undefined/null/空object）は store 値を保持
      const hasSwotSuggestions = (guardedHydratedState as any).swotSuggestions &&
        typeof (guardedHydratedState as any).swotSuggestions === 'object' &&
        !Array.isArray((guardedHydratedState as any).swotSuggestions) &&
        (Array.isArray((guardedHydratedState as any).swotSuggestions?.opportunity) ||
         Array.isArray((guardedHydratedState as any).swotSuggestions?.threat));

      const storeHasSwotSuggestions = (storeState as any).swotSuggestions &&
        typeof (storeState as any).swotSuggestions === 'object' &&
        !Array.isArray((storeState as any).swotSuggestions) &&
        (Array.isArray((storeState as any).swotSuggestions?.opportunity) ||
         Array.isArray((storeState as any).swotSuggestions?.threat));

      if (!hasSwotSuggestions && storeHasSwotSuggestions) {
        delete (guardedHydratedState as any).swotSuggestions;
        if (process.env.NODE_ENV === 'development') {
          console.log('[diag][guard] Blocked empty swotSuggestions from overwriting store');
        }
      }

      useStrategyStore.getState().hydrateFromFullState?.(guardedHydratedState);

      return;
    }

    // ★ TASK 11-2: DB source (hydratedState なし場合は return)
    if (decision.sourceUsed === 'db') {
      return;
    }

    // ★ If store already has data, no restore needed
    if (decision.sourceUsed === 'store') {
      console.log('[Stage2] using existing store data');
      return;
    }

    // ★ If snapshot is to be used, hydrate from it
    if (decision.sourceUsed === 'snapshot' && decision.snapshotData?.state) {
      const st = decision.snapshotData.state;
      console.log('[Stage2] restoring from snapshot...');

      // ✅ ceoIntent 復元（snapshot → store）
      if (typeof (st as any).ceoIntent === 'string') {
        useStrategyStore.getState().setCeoIntent?.((st as any).ceoIntent);
      }

      // ✅ MVV 復元（snapshot → store）
      if (st.mvv) {
        useStrategyStore.getState().setMVV?.({
          thought: st.mvv.thought ?? '',
          mission: st.mvv.mission ?? '',
          vision: st.mvv.vision ?? '',
          value: st.mvv.value ?? '',
        });
      }

      // ✅ SWOT 復元（snapshot → store）
      if (st.swot) {
        useStrategyStore.getState().setSWOT?.({
          strength: st.swot.strength ?? '',
          weakness: st.swot.weakness ?? '',
          opportunity: st.swot.opportunity ?? '',
          threat: st.swot.threat ?? '',
        });
      }

      // storyDraft
      const sd = st.storyDraft ?? [];
      if (Array.isArray(sd) && sd.length > 0) {
        setStoryDraft(sd);
        if (process.env.NODE_ENV === 'development') {
          console.log(
            '[Stage2] snapshot.storyDraft lengths:',
            sd.map((ch: any, i: number) => `Ch${i}: ${(ch?.body || '').length}`)
          );
        }
      }

      // winPatternsCandidate
      const wp = st.winPatternsCandidate ?? [];
      if (Array.isArray(wp) && wp.length > 0) {
        setWinPatternsCandidate(wp);
        // UIでは選択不要だが、API整合のため内部では先頭を自動参照
        if (wp[0]?.id) setSelectedWinPatternId(wp[0].id);
      }

      /* ★ TASK A-4: answers12 を store 直更新に統一（配列生成して setAnswers12） */
      const a12 = st.answers12 ?? [];
      if (Array.isArray(a12) && a12.length > 0) {
        const base =
          Array.isArray(answers12) && answers12.length > 0
            ? answers12
            : TEMPLATE12.map((q) => ({ id: q.id, answer: '' } as Stage2Answer));

        const next = base.map((a) => {
          const hit = a12.find((s: any) => s?.id === a.id);
          return hit ? { ...a, answer: hit.answer ?? '' } : a;
        });

        setAnswers12(next);
        lastSyncedAnswersHashRef.current = hashAnswers12(next);
      }

      // finalStory
      const fs = st.finalStory ?? [];
      if (Array.isArray(fs) && fs.length > 0) {
        setLocalFinalStory(fs);
        setStoreFinalStory(fs);
        if (process.env.NODE_ENV === 'development') {
          console.log(
            '[Stage2] snapshot.finalStory lengths:',
            fs.map((ch: any, i: number) => `Ch${i}: ${(ch?.body || '').length}`)
          );
        }
      }

      // ✅ finalStoryDraft 復元（3段階編集用）（空上書き防止）
      const fsd = st.finalStoryDraft ?? [];
      if (Array.isArray(fsd) && fsd.length > 0) {
        setFinalStoryDraft(fsd);
        if (process.env.NODE_ENV === 'development') {
          console.log('[Stage2] snapshot.finalStoryDraft restored:', fsd.length);
        }
      } else if (fsd.length === 0) {
        // 空配列が返ってきた場合、既存の store 値を保持（上書きしない）
        if (process.env.NODE_ENV === 'development') {
          console.log('[Stage2] finalStoryDraft is empty in snapshot, keeping existing store value');
        }
      }

      // ✅ finalStoryEdited 復元（3段階編集用）（空上書き防止）
      const fse = st.finalStoryEdited ?? [];
      if (Array.isArray(fse) && fse.length > 0) {
        setFinalStoryEdited(fse);
        if (process.env.NODE_ENV === 'development') {
          console.log('[Stage2] snapshot.finalStoryEdited restored:', fse.length);
        }
      } else if (fse.length === 0) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[Stage2] finalStoryEdited is empty in snapshot, keeping existing store value');
        }
      }

      // ✅ finalStoryFinal 復元（3段階編集用）（空上書き防止）
      const fsf = st.finalStoryFinal ?? [];
      if (Array.isArray(fsf) && fsf.length > 0) {
        commitFinalStory(fsf);
        if (process.env.NODE_ENV === 'development') {
          console.log('[Stage2] snapshot.finalStoryFinal restored:', fsf.length);
        }
      } else if (fsf.length === 0) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[Stage2] finalStoryFinal is empty in snapshot, keeping existing store value');
        }
      }

      // ✅ companyTargets 復元（業績目標メトリクス）（空上書き防止）
      const ct = st.companyTargets ?? [];
      if (Array.isArray(ct) && ct.length > 0) {
        setCompanyTargets(ct);
        if (process.env.NODE_ENV === 'development') {
          console.log('[Stage2] snapshot.companyTargets restored:', ct.length);
        }
      } else if (ct.length === 0) {
        // 空配列が返ってきた場合、既存の store 値を保持（上書きしない）
        if (process.env.NODE_ENV === 'development') {
          console.log('[Stage2] companyTargets is empty in snapshot, keeping existing store value');
        }
      }

      console.log(
        `[audit][restore:done] decisionId=${decision.decisionId} sourceUsed=${decision.sourceUsed} strategyId=${decision.strategyId}`,
      );
      lastSyncedAnswersHashRef.current = hashAnswers12(a12);
    }

    // ★ 診断ログ：restore後のstore状態
    if (process.env.NODE_ENV === 'development') {
      const storeState = useStrategyStore.getState();
      console.log('[Stage2] after restore - store state:', {
        companyTargetsCount: Array.isArray((storeState as any).companyTargets) ? (storeState as any).companyTargets.length : 'missing',
        finalStoryDraftCount: Array.isArray((storeState as any).finalStoryDraft) ? (storeState as any).finalStoryDraft.length : 'missing',
        finalStoryEditedCount: Array.isArray((storeState as any).finalStoryEdited) ? (storeState as any).finalStoryEdited.length : 'missing',
        finalStoryFinalCount: Array.isArray((storeState as any).finalStoryFinal) ? (storeState as any).finalStoryFinal.length : 'missing',
        mvvMission: (storeState as any).mission?.slice(0, 30) ?? 'empty',
      });
    }
  }, [setStoreFinalStory, setCompanyTargets, companyId]);

  // ★ TASK 11-1: restore useEffect を membership 不依存に
  // 初回だけロード＆復元（複数回走ってスナップショット保存が暴発するのを防ぐ）
  // NOTE: membership が未確定でも restore は続行（companyId さえあれば OK）
  useEffect(() => {
    if (companyId && !didInitRef.current) {
      didInitRef.current = true;
      loadStage1Data();
      // restoreStage2Snapshot is now async, call it but don't block
      restoreStage2Snapshot().catch((err) => {
        console.error('[Stage2] restore error:', err);
      });
    }
  }, [companyId, loadStage1Data, restoreStage2Snapshot]);

  // ✅ Stage2 入力の自動スナップショット保存（debounce）
  // - 生成ボタンを押さなくても localStorage に残す
  useEffect(() => {
    const t = window.setTimeout(() => {
      const stage2State: Stage2State = {
        ceoIntent,
        mvv: { thought, mission, vision, value },
        swot: { strength, weakness, opportunity, threat },
        storyDraft,
        winPatternsCandidate,
        answers12,
        finalStory: displayingStory,
        finalStoryDraft: finalStoryDraftRaw,
        finalStoryEdited: finalStoryEditedRaw,
        finalStoryFinal: finalStoryFinalRaw,
        companyTargets,
      };

      saveStage2SnapshotToLocalStorage(stage2State, companyId ?? undefined);
      if (process.env.NODE_ENV === 'development') {
        /* ★ TASK 17: TS7006 - 型注釈を追加（a） */
        console.log('[Stage2] autosave snapshot', {
          ceoIntentLen: ceoIntent?.length ?? 0,
          answered: answers12?.filter((a: Stage2Answer) => a.answer?.trim()).length ?? 0,
          hasDraft: storyDraft?.length ?? 0,
          hasWin: winPatternsCandidate?.length ?? 0,
          hasFinal: displayingStory?.length ?? 0,
          companyTargetsCount: companyTargets?.length ?? 0,
          finalStoryDraftCount: finalStoryDraftRaw?.length ?? 0,
          finalStoryEditedCount: finalStoryEditedRaw?.length ?? 0,
          finalStoryFinalCount: finalStoryFinalRaw?.length ?? 0,
        });
      }
    }, 300);

    return () => window.clearTimeout(t);
  }, [
    companyId,
    ceoIntent,
    thought,
    mission,
    vision,
    value,
    strength,
    weakness,
    opportunity,
    threat,
    answers12,
    storyDraft,
    winPatternsCandidate,
    displayingStory,
    finalStoryDraftRaw,
    finalStoryEditedRaw,
    finalStoryFinalRaw,
    companyTargets,
  ]);

  // ★ 削除：fetch-hook は廃止（authFetchJson に統一）

  // ★ 診断用 fetch（DEV限定で1回だけ）
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DEBUG_DIAG !== '1') return;
    if (diagInitRef.current) return;
    diagInitRef.current = true;

    (async () => {
      try {
        const { ok, data } = await safeGetSession();
        if (!ok) {
          console.log('[diag] safeGetSession failed');
          return;
        }

        const token = data.session?.access_token;
        if (!token) {
          console.log('[diag] no session token');
          return;
        }

        const r = await fetch('/api/diag/whoami', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        console.log('[diag][whoami]', await r.json());
      } catch (e) {
        console.error('[diag] error:', e);
      }
    })();
  }, []);

  /* ★ TASK A-2: local ↔ store 同期 useEffect を削除（answers12 は store 唯一の正に統一） */
  // 削除されたもの：
  // 1. storeAnswers12 -> local sync useEffect（line 1167-1193）
  // 2. local answers12 -> store sync useEffect（line 1196-1223）
  // 理由：答えは store に一本化し、local state では持たないため
  /* ★ TASK A-3 修正版: handleUpdateAnswer を upsert に変更（空配列からも入力可能に） */
  const handleUpdateAnswer = useCallback(
    (id: string, answer: string) => {
      // ★ TASK D: Debug log for input tracking
      console.log('[Stage2] answers12 change', { id, valueLen: answer.length });

      const base = Array.isArray(answers12) ? answers12 : [];
      const idx = base.findIndex((x) => x.id === id);

      if (idx >= 0) {
        // 既存があれば更新
        const next = base.slice();
        next[idx] = { ...next[idx], answer };
        setAnswers12(next);
      } else {
        // 無ければ追加（空配列からでも入力可能に）← ★ 根本修正
        const selectedQ = TEMPLATE12.find((q) => q.id === id);
        setAnswers12([...base, { id, question: selectedQ?.question, answer }]);
      }
    },
    [answers12, setAnswers12]
  );

  /* ★ 修正：12問の"器"を初期化（upsert と組み合わせて安定性UP）*/
  useEffect(() => {
    // 既に何か入っているなら何もしない
    if (Array.isArray(answers12) && answers12.length > 0) return;

    // 12問の器を作る（question も TEMPLATE12 から拾う）
    const seeded: Stage2Answer[] = TEMPLATE12.map((q) => ({
      id: q.id,
      question: q.question,
      answer: '',
    }));
    setAnswers12(seeded);
  }, [answers12, setAnswers12]);

  /* ★ 修正：useAutoSave を Stage2 ページに追加（Stage2 入力の自動保存） */
  useAutoSave({
    enabled: true,
    requireHydrated: true,
    requireSession: true,
    debounceMs: 1200,
    minIntervalMs: 1500,
    mode: 'payload',
  });

  // O/T generation
  const handleGenerateOT = useCallback(async () => {
    if (generatingOT) return;

    setGeneratingOT(true);
    setGenerateOTError(null);

    try {
      const data = await authFetchJson<any>('/api/generate-ot', {
        method: 'POST',
        json: {
          industry: industry || '',
          revenue: revenue || '',
          employees: employees || '',
          businessContent: businessContent || '',
        },
        cache: 'no-store',
      });

      const opportunities = Array.isArray(data.opportunity) ? data.opportunity : [];
      const threats = Array.isArray(data.threat) ? data.threat : [];

      useStrategyStore.getState().setSwotSuggestions({
        opportunity: opportunities,
        threat: threats,
        generatedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      console.error('[Stage2] Generate O/T error:', e);
      if (e instanceof AuthFetchError) {
        if (e.code === 'AUTH_NO_SESSION') {
          setGenerateOTError('セッションが切れています。ログインし直してください。');
        } else if (e.status === 403) {
          setGenerateOTError('権限がありません。');
        } else if (e.status === 401) {
          setGenerateOTError('認証に失敗しました。ログインし直してください。');
        } else {
          setGenerateOTError(e.bodyText || e.message || 'O/Tの提案生成に失敗しました');
        }
      } else {
        setGenerateOTError(e instanceof Error ? e.message : 'O/Tの提案生成に失敗しました');
      }
    } finally {
      setGeneratingOT(false);
    }
  }, [generatingOT, industry, revenue, employees, businessContent]);

  // Draft generation
  const handleGenerate = useCallback(
    async (e?: React.MouseEvent<HTMLButtonElement>) => {
      // ★ (1) 関数到達ログ
      const isPing = !!e?.shiftKey;
      console.log('[Stage2] handleGenerate ENTER', { at: new Date().toISOString(), pingMode: isPing, shiftKey: !!e?.shiftKey });

      // ★ precheck（ここだけ return OK）
      if (generating) {
        console.log('[Stage2] handleGenerate EARLY RETURN: already generating');
        return;
      }

      const issueBlocksCount = issueBlocks?.length ?? 0;
      console.log('[Stage2] precheck', {
        issueBlocksCount,
        hasMetricsSummary: !!metricsSummary,
        hasMVV: !!(mission || vision || value || thought),
        hasSWOT: !!(strength || weakness || opportunity || threat),
      });

      if (issueBlocksCount === 0) {
        console.warn('[Stage2] precheck failed: issueBlocks empty');
        setGenerateError('論点（issueBlocks）が空です。STAGE1を完了してください。');
        return;
      }

      // ★ precheck 成功後、初めて setGenerating(true)
      setGenerateError(null);
      setSaveWarning(null);
      setGenerating(true);
      console.log('[Stage2] after setGenerating(true)');

      // AbortController（55秒タイムアウト）
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | null = null;
      let didTimeout = false;
      let done = false; // ★追加：レース防止（レスポンス受領後は abort しない）

      // ★追加：abort reason を明示 + done フラグでレース防止
      const abortByTimeout = () => {
        if (done) return;
        didTimeout = true;
        try {
          controller.abort(new DOMException('timeout', 'AbortError'));
        } catch {
          // noop
        }
      };

      try {
        // ★ 修正2：120秒にタイムアウト（デバッグ用：サーバ側の速度確認）
        const TIMEOUT_MS = 120_000;
        timer = setTimeout(abortByTimeout, TIMEOUT_MS);

        // ★ payload 生成を try 内に（ここで例外が出ると finally で必ず清掃される）
        const segmentNames = Array.isArray(businessSegments)
          ? businessSegments
              .map((s: any) => (typeof s?.name === 'string' ? s.name.trim() : ''))
              .filter(Boolean)
          : [];

        // ★ ログ：入力内容の確認（整合性チェック用）
        if (process.env.NODE_ENV === 'development') {
          console.log('[Stage2] send businessSegments count:', businessSegments?.length ?? 0);
          console.log('[Stage2] send businessPortfolio exists:', !!businessPortfolio);
          console.log(
            '[Stage2] send ceoIntent_len:',
            ceoIntent?.length ?? 0,
            '(content:',
            ceoIntent?.substring(0, 50) ?? 'empty',
            ')'
          );
          console.log('[Stage2] send mvv:', {
            mission_len: mission?.length ?? 0,
            vision_len: vision?.length ?? 0,
            value_len: value?.length ?? 0,
            thought_len: thought?.length ?? 0,
          });
          console.log('[Stage2] send swot lens:', {
            S: strength?.length ?? 0,
            W: weakness?.length ?? 0,
            O: opportunity?.length ?? 0,
            T: threat?.length ?? 0,
          });
          console.log(
            '[Stage2] send swotSuggestions:',
            swotSuggestions
              ? { opp_count: swotSuggestions.opportunity?.length, thr_count: swotSuggestions.threat?.length }
              : 'none'
          );
        }

        const payload: any = {
          issueBlocks,
          metricsSummary,
          ceoIntent,
          mvv: { thought, mission, vision, value },
          swot: { strength, weakness, opportunity, threat },
          swotSuggestions,
          industry,
          segments: segmentNames,
          businessSegments,
          businessPortfolio,
        };

        // ★ Shift キー押下時は PING モード
        if (isPing) {
          payload.__ping = true;
          console.log('[Stage2] PING MODE ACTIVATED - __ping added to payload');
        }

        // ★ (3) API 呼び出し（Bearer 自動付与）
        const url = '/api/stage2/generate-draft';
        console.log('[Stage2] BEFORE fetch', {
          url,
          issueBlocksCount,
          payloadSize: JSON.stringify(payload).length,
          pingMode: isPing,
        });

        let data: any;
        try {
          data = await authFetchJson<any>(url, {
            method: 'POST',
            signal: controller.signal,
            json: payload,
          });

          // ★★★ 重要：レスポンスが返った時点で timeout を解除する（本文読取/parse 中に abort されるのを防ぐ）
          done = true; // ★追加：これ以上 abort させない（race 防止）
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }

          // ★ (4) fetch 直後ログ
          console.log('[Stage2] AFTER fetch', { status: 200, ok: true });
        } catch (e: any) {
          // ★ authFetchJson からの エラー（401など）
          console.error('[Stage2] ★GENERATE FAILED★', {
            message: e?.message || String(e),
            details_bodyText: e?.details?.bodyText,
            details_stage: e?.details?.stage,
            errorName: e?.name,
            fullError: e,
          });
          done = true;
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          throw e;
        }

        // ★ PING モード レスポンス確認
        if (isPing && data.__pong === true) {
          console.log('[Stage2] PING MODE SUCCESS - API is alive', {
            timestamp: data.timestamp,
            message: data.message,
          });
          // ユーザーに確認メッセージを表示
          const msgText = `✓ API疎通確認成功\n${data.message}\nタイムスタンプ: ${data.timestamp}`;
          alert(msgText);
          // ★ PING 成功時は処理完了（storyDraft 反映は不要）
          throw new Error('PING_MODE_SUCCESS'); // 意図的に throw して finally へ
        }

        const newStoryDraft: StoryChapter[] = Array.isArray(data.storyDraft) ? data.storyDraft : [];
        const newWinPatterns: WinPatternCandidate[] = Array.isArray(data.winPatternsCandidate) ? data.winPatternsCandidate : [];

        if (process.env.NODE_ENV === 'development') {
          console.log(
            '[Stage2] API response storyDraft lengths:',
            newStoryDraft.map((ch, i) => `Ch${i}: ${ch.body.length}`)
          );
          console.log('[Stage2] API response winPatternsCandidate count:', newWinPatterns.length);
        }

        /* ★ TASK 16: store setter を呼び出し（local state ではなく store に保存） */
        setStoryDraft(newStoryDraft);
        setWinPatternsCandidate(newWinPatterns);
        setSelectedWinPatternId(newWinPatterns?.[0]?.id ?? null);

        if (process.env.NODE_ENV === 'development') {
          console.log('[Stage2] Generated data set to store:', {
            storyDraft_len: newStoryDraft.length,
            winPatterns_len: newWinPatterns.length,
            source: 'store setter',
          });
        }

        // Auto navigate to Draft tab
        setActiveTab('draft');

        const stage2State: Stage2State = {
          ceoIntent,
          mvv: { thought, mission, vision, value },
          swot: { strength, weakness, opportunity, threat },
          storyDraft: newStoryDraft,
          winPatternsCandidate: newWinPatterns,
          answers12,
        };
        saveStage2SnapshotToLocalStorage(stage2State, companyId ?? undefined);

        // Supabase best effort
        if (userId && companyId) {
          try {
            const storeState = useStrategyStore.getState() as any;
            const savePayload = {
              ...storeState,
              storyDraft: newStoryDraft,  // ★ 修正：story ではなく storyDraft として保存
            };

            console.log('[Stage2] DB save attempt:', {
              userId,
              companyId,
              hasMVV: !!(savePayload.mission || savePayload.vision),
              payloadKeyCount: Object.keys(savePayload).length,
              // ★ 診断：新フィールドが payload に入ってるか
              companyTargetsInPayload: Array.isArray((savePayload as any).companyTargets) ? (savePayload as any).companyTargets.length : 'missing',
              finalStoryDraftInPayload: Array.isArray((savePayload as any).finalStoryDraft) ? (savePayload as any).finalStoryDraft.length : 'missing',
              finalStoryEditedInPayload: Array.isArray((savePayload as any).finalStoryEdited) ? (savePayload as any).finalStoryEdited.length : 'missing',
              finalStoryFinalInPayload: Array.isArray((savePayload as any).finalStoryFinal) ? (savePayload as any).finalStoryFinal.length : 'missing',
            });

            const saveResult = await saveWithAudit(
              savePayload,
              userId,
              companyId,
              undefined,
              {},
              'stage2:handleGenerate'
            );

            if (saveResult.error === null) {
              console.log('[Stage2] ✅ DB save SUCCESS:', {
                revision: saveResult.data?.revision,
                strategyId: saveResult.data?.strategyId,
              });

              // ★ Sync revision/strategyId to store to prevent REVISION_CONFLICT
              if (saveResult.data?.revision !== undefined) {
                useStrategyStore.getState().setRevision(saveResult.data.revision);
              }
              if (saveResult.data?.strategyId) {
                useStrategyStore.getState().setStrategyId(saveResult.data.strategyId);
              }
            } else {
              console.error('[Stage2] ❌ DB save FAILED:', {
                status: (saveResult.error as any)?.status,
                code: (saveResult.error as any)?.code,
                message: (saveResult.error as any)?.message,
                hint: (saveResult.error as any)?.hint,
              });
              setSaveWarning(
                `DB保存に失敗しましたが、ローカル snapshot に保存済みです。エラー: ${(saveResult.error as any)?.message || '不明なエラー'}`
              );
            }
          } catch (saveError) {
            console.error('[Stage2] ❌ DB save EXCEPTION:', saveError);
            setSaveWarning('サーバー保存に失敗しましたが、ローカルに保存済みです');
          }
        }
      } catch (e: any) {
        // ★ PING モード成功時の特別処理
        if (e?.message === 'PING_MODE_SUCCESS') {
          console.log('[Stage2] PING mode completed successfully');
          setGenerateError(null);
        } else {
          // ★ エラーハンドリング
          let errorMsg = 'たたき台の生成に失敗しました';

          // AbortError / aborted
          if (e?.name === 'AbortError' || e?.message?.includes('aborted')) {
            // ★ timeout 由来かどうかを確定
            if (didTimeout) {
              errorMsg = 'たたき台の生成がタイムアウトしました（55秒以上かかりました）。再度実行してください。';
            } else {
              errorMsg = '通信が中断されました（abort）。ネットワーク/拡張機能/画面遷移などを確認してください。';
            }
          } else if (e?.message) {
            errorMsg = e.message;
          }

          console.error('[Stage2] Generate error:', e);
          setGenerateError(errorMsg);
        }
      } finally {
        // ★ 必ず実行される（return禁止で絶対に到達）
        done = true; // ★追加：timeout abort を確実に防ぐ
        if (timer) clearTimeout(timer);
        setGenerating(false);
        console.log('[Stage2] finally: setGenerating(false) - ALWAYS EXECUTED');
      }
    },
    [
      generating,
      issueBlocks,
      metricsSummary,
      ceoIntent,
      thought,
      mission,
      vision,
      value,
      strength,
      weakness,
      opportunity,
      threat,
      swotSuggestions,
      industry,
      businessSegments,
      businessPortfolio,
      companyId,
      userId,
    ]
  );

  // Final generation（※こちらも timeout が絡むなら同じ問題が出るので対策を入れる）
  const handleGenerateFinal = useCallback(async () => {
    if (generatingFinal) return;

    console.log('[Stage2] generate final story: start');

    setGeneratingFinal(true);
    setGenerateFinalError(null);

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let didTimeout = false;
    let done = false;

    const abortByTimeout = () => {
      if (done) return;
      didTimeout = true;
      try {
        controller.abort(new DOMException('timeout', 'AbortError'));
      } catch {
        // noop
      }
    };

    try {
      const TIMEOUT_MS = 180_000; // 180秒（API maxDuration に合わせ）
      timer = setTimeout(abortByTimeout, TIMEOUT_MS);

      const segmentNames = Array.isArray(businessSegments)
        ? businessSegments
            .map((s: any) => (typeof s?.name === 'string' ? s.name.trim() : ''))
            .filter(Boolean)
        : [];

      const payload = {
        issueBlocks,
        metricsSummary,
        mvv: { thought, mission, vision, value },
        swot: { strength, weakness, opportunity, threat },
        storyDraft,
        winPatternsCandidate,
        selectedWinPatternId: selectedWinPatternId ?? winPatternsCandidate?.[0]?.id ?? null,
        answers12,
        companyTargets,
        industry,
        segments: segmentNames,
        businessSegments,
        businessPortfolio,
        // API側で strategy_data.final_story_draft に保存するため、画面で開いている会社IDを明示的に渡す
        companyId,
      };

      console.log('[Stage2] generate final story: payload size', JSON.stringify(payload).length);
      console.time('[Stage2] generate final story duration');

      let data: any;
      try {
        const res = await authFetchJson<any>('/api/stage2/generate-final', {
          method: 'POST',
          signal: controller.signal,
          json: payload,
        });

        console.log('[Stage2] generate final story: response received');
        data = res;

        done = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      } catch (e: any) {
        done = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        console.error('[Stage2] generate final story: fetch failed', e);

        const msg = didTimeout
          ? '生成処理がタイムアウトしました。入力データ量が多いか、処理に時間がかかっています。少し時間を置いて再度お試しください。'
          : e instanceof AuthFetchError
          ? e.status === 401
            ? 'セッションが切れています。ログインし直してください。'
            : e.bodyText || e.message
          : e?.message || 'API error';
        throw new Error(msg);
      }
      const newFinalStory: StoryChapter[] = Array.isArray(data.finalStory) ? data.finalStory : [];

      // ★ Step 3: APIレスポンス内容ログ
      if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
        console.log('[diag][regenerate][api-response]', {
          chaptersLen: newFinalStory.length,
          chapters: newFinalStory.map((ch) => ({
            title: ch.title,
            bodyStart: ch.body.slice(0, 80) + '...',
            bodyLen: ch.body.length,
          })),
        });
      }

      // ★ STAGE2 最終ストーリー：draft に設定（edited は保持）
      setFinalStoryDraft(newFinalStory);

      // ★中計設計（midtermStrategy）がAPIから返ってきた場合のみ store へ反映
      if (
        data?.midtermStrategy &&
        typeof data.midtermStrategy === 'object' &&
        !Array.isArray(data.midtermStrategy)
      ) {
        try {
          (useStrategyStore.getState() as any).setMidtermStrategy?.(data.midtermStrategy);
        } catch {}
      }

      // ★ TASK A-2: 再生成成功直後は draft を表示
      setStoryViewMode('draft');

      // ★ Step 3: setter 実行直後のログ（即時と setTimeout(0)）
      if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
        // 即時
        console.log('[diag][regenerate][after-setter-sync]', {
          draftLenAfter: finalStoryDraftRaw?.length ?? 0,
          editedLen: finalStoryEditedRaw?.length ?? 0,
          finalLen: finalStoryFinalRaw?.length ?? 0,
        });
        // 非同期（reaction 待ち）
        setTimeout(() => {
          const storeState = (useStrategyStore.getState() as any);
          console.log('[diag][regenerate][after-setter-async]', {
            storeDraftLen: Array.isArray(storeState.finalStoryDraft) ? storeState.finalStoryDraft.length : null,
            storeEditedLen: Array.isArray(storeState.finalStoryEdited) ? storeState.finalStoryEdited.length : null,
            storeFinalLen: Array.isArray(storeState.finalStoryFinal) ? storeState.finalStoryFinal.length : null,
          });
        }, 0);
      }

      // Auto navigate to Final tab
      setActiveTab('final');

      const stage2State: Stage2State = {
        ceoIntent,
        mvv: { thought, mission, vision, value },
        swot: { strength, weakness, opportunity, threat },
        storyDraft,
        winPatternsCandidate,
        answers12,
        finalStory: newFinalStory, // ★ 後方互換性のため保持
      };
      // ★ Stage2State型の後方互換性を保ちつつ、復元用の本命フィールドもlocalStorageに保持
      (stage2State as any).finalStoryDraft = newFinalStory;
      saveStage2SnapshotToLocalStorage(stage2State, companyId ?? undefined);

      // ★ CRITICAL FIX: 生成直後に DB に保存（finalStoryDraft をリロード後も復元するため）
      try {
        console.log('[Stage2][generate-final] DB save start after generation');
        const storeState = useStrategyStore.getState() as any;
        const savePayload = {
          ...storeState,
          finalStoryDraft: newFinalStory, // 生成されたばかりの最新ストーリーを確実に保存
        };

        const saveResult = await saveWithAudit(
          savePayload,
          userId,
          companyId ?? undefined,
          undefined,
          {},
          'stage2:generateFinal'
        );

        if (saveResult.error === null) {
          console.log('[Stage2][generate-final] ✅ DB save SUCCESS - finalStoryDraft saved', {
            finalStoryDraftLen: Array.isArray(newFinalStory) ? newFinalStory.length : 0,
            revision: saveResult.data?.revision,
          });
          if (saveResult.data?.revision !== undefined) {
            useStrategyStore.getState().setRevision(saveResult.data.revision);
          }
        } else {
          console.warn('[Stage2][generate-final] ⚠️ DB save FAILED but generation succeeded', {
            error: (saveResult.error as any)?.message || saveResult.error,
          });
        }
      } catch (saveErr) {
        console.error('[Stage2][generate-final] 🚨 DB save error (non-fatal):', saveErr);
      }
    } catch (e: any) {
      console.error('[Stage2] GenerateFinal error:', e);

      if (e?.name === 'AbortError' || e?.message?.includes('aborted')) {
        setGenerateFinalError(
          didTimeout
            ? '最終ストーリーの生成がタイムアウトしました（55秒以上かかりました）。再度実行してください。'
            : '通信が中断されました（abort）。ネットワーク/拡張機能/画面遷移などを確認してください。'
        );
      } else {
        setGenerateFinalError(e?.message || '最終ストーリーの生成に失敗しました');
      }
    } finally {
      done = true;
      if (timer) clearTimeout(timer);
      console.timeEnd('[Stage2] generate final story duration');
      setGeneratingFinal(false);
    }
  }, [
    generatingFinal,
    issueBlocks,
    metricsSummary,
    thought,
    mission,
    vision,
    value,
    strength,
    weakness,
    opportunity,
    threat,
    storyDraft,
    winPatternsCandidate,
    selectedWinPatternId,
    answers12,
    companyTargets,
    industry,
    businessSegments,
    businessPortfolio,
    companyId,
    setFinalStoryDraft,
  ]);

  // Guard
  if (!loading && issueBlocks.length === 0) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-white to-slate-50/60 px-4 py-6 dark:from-zinc-950 dark:to-zinc-900">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-8 text-center">
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-2">STAGE1で論点を生成してください</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              STAGE2を開始するには、まずSTAGE1で財務分析と論点の整理を行う必要があります。
            </p>
            <button
              onClick={() => router.push('/stage1')}
              className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-3 text-white font-medium hover:bg-blue-700 transition-colors"
            >
              ← STAGE1へ移動
            </button>
          </div>
        </div>
      </main>
    );
  }

  const canOpenDraft = issueBlocks.length > 0; // STAGE1論点は常に見せる
  const hasDraft = storyDraft.length > 0;
  const hasFinal = displayingStory.length > 0;

  // ★ TASK 10-3: UI表示直前に field_check ログ（DEV限定）
  if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
    console.log('[Stage2][ui_check]', {
      ceoIntentLen: ceoIntent?.length ?? 0,
      ceoIntentPreview: ceoIntent?.substring(0, 40) ?? 'empty',
      storyDraftLen: storyDraft?.length ?? 0,
      storyDraftChapters: storyDraft?.map((ch: StoryChapter, i: number) => `Ch${i}:${ch?.body?.length ?? 0}chars`) ?? [],
    });
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-slate-50/60 dark:from-zinc-950 dark:to-zinc-900">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 dark:bg-zinc-900/80 backdrop-blur border-b border-black/5 dark:border-white/5">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between gap-6">
          <div>
            <h1 className="text-xl font-bold text-gray-800 dark:text-gray-200">STAGE2：全社戦略</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              中計全体の方向性、重点テーマ、事業・部門へ展開する判断軸を設計します。
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              入力（MVV・SWOT）→ 戦略のたたき台 → １２のテーマをもとに議論　→ 最終ストーリーを確定
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={handleOpenStrategy}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors shadow-md"
              title="全社戦略書をプレビュー画面で確認・PDF出力できます"
            >
              戦略書プレビュー
            </button>
          </div>
        </div>
      </header>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-gray-500">データを読み込んでいます...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-4">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-700 dark:text-red-400">
            {error}
          </div>
        </div>
      )}

      {!loading && issueBlocks.length > 0 && (
        <>
          {/* Sticky StepperTabs */}
          <div className="sticky top-[56px] z-10 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md border-b border-black/5 dark:border-white/5">
            <div className="max-w-6xl mx-auto px-4 md:px-6 py-4">
              <StepperTabs
                activeTab={activeTab}
                onChange={setActiveTab}
                canOpenDraft={canOpenDraft}
                hasDraft={hasDraft}
                hasFinal={hasFinal}
              />
            </div>
          </div>

          {/* Tab Content */}
          <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-6">
            {/* 入力タグ：CEO意図→MVV＋SWOT→たたき台生成 */}
            {activeTab === 'input' && (
              <ReadOnlyBlock readOnly={readOnly}>
              <div className="space-y-6">
                <CEOIntentSection />

                <div className="rounded-2xl border border-black/10 bg-white/70 dark:bg-white/5 shadow-sm backdrop-blur-md p-6">
                  <MVVSection />
                </div>

                {/* ★ 業績目標セクション - MVV と SWOT の間に配置 */}
                <CompanyTargetsSection
                  companyTargets={companyTargets}
                  issueBlocks={issueBlocks}
                />

                <div className="rounded-2xl border border-black/10 bg-white/70 dark:bg-white/5 shadow-sm backdrop-blur-md p-6">
                  <SWOTSection />
                  <OTSuggestionsPanel suggestions={swotSuggestions} onAddOpportunity={addSwotOpportunity} onAddThreat={addSwotThreat} />
                </div>

                <div className="flex gap-4 justify-center">
                  <button
                    type="button"
                    onClick={handleGenerateOT}
                    disabled={disabled || generatingOT}
                    className="px-6 py-3 rounded-xl bg-amber-600 text-white text-base font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-700 transition-colors shadow-lg"
                  >
                    {generatingOT ? 'AIで提案中...' : 'AIで機会・脅威を提案'}
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      console.log('[Stage2] GENERATE BUTTON CLICK (input tab)', {
                        at: new Date().toISOString(),
                        disabled: (e.currentTarget as HTMLButtonElement)?.disabled,
                        generating: generating,
                        shiftKey: e.shiftKey,
                      });
                      e.preventDefault();
                      e.stopPropagation();
                      void handleGenerate(e);
                    }}
                    disabled={disabled || generating}
                    className="px-8 py-4 rounded-xl bg-blue-600 text-white text-base font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors shadow-lg"
                    title="Shift+クリックで API 疎通テスト（PING モード）"
                  >
                    {generating ? '生成中...' : 'たたき台を生成'}
                  </button>
                </div>

                {generateOTError && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
                    {generateOTError}
                  </div>
                )}
                {generateError && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
                    {generateError}
                  </div>
                )}
                {saveWarning && (
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-700 dark:text-amber-400">
                    {saveWarning}
                  </div>
                )}
              </div>
              </ReadOnlyBlock>
            )}
            {/* DRAFTタグ：STAGE1論点（最大5件を第1章に内包）＋4章ストーリー＋深掘り議論（統合） */}
            {activeTab === 'draft' && (
              <ReadOnlyBlock readOnly={readOnly}>
              <div className="space-y-6">
                <DraftStoryPanel storyDraft={storyDraft} issueBlocks={issueBlocks} />

                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={(e) => {
                      console.log('[Stage2] GENERATE BUTTON CLICK (draft tab)', {
                        at: new Date().toISOString(),
                        disabled: (e.currentTarget as HTMLButtonElement)?.disabled,
                        generating: generating,
                        shiftKey: e.shiftKey,
                      });
                      e.preventDefault();
                      e.stopPropagation();
                      void handleGenerate(e);
                    }}
                    disabled={disabled || generating}
                    className="px-8 py-4 rounded-xl bg-blue-600 text-white text-base font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors shadow-lg"
                    title="Shift+クリックで API 疎通テスト（PING モード）"
                  >
                    {generating ? '生成中...' : hasDraft ? 'たたき台を再生成' : 'たたき台を生成'}
                  </button>
                </div>

                {generateError && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
                    {generateError}
                  </div>
                )}

                {saveWarning && (
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-700 dark:text-amber-400">
                    {saveWarning}
                  </div>
                )}

                {/* 深掘り（12問）を Draft タブに統合 */}
                <div className="my-2 border-t border-gray-200 dark:border-gray-700" />

                <div className="rounded-2xl border border-black/10 bg-white/70 dark:bg-white/5 shadow-sm backdrop-blur-md p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">戦略を掘り下げるための議論のテーマ</h3>
                    <span className="text-sm text-gray-500 dark:text-gray-400">※ 未入力でも最終生成できます</span>
                  </div>

                  <Questions12Section answers12={answers12} onUpdateAnswer={handleUpdateAnswer} disabled={disabled} />

                  <div className="mt-6 flex justify-center">
                    <button
                      onClick={handleGenerateFinal}
                      disabled={disabled || !hasDraft || generatingFinal}
                      className="px-8 py-4 rounded-xl bg-emerald-600 text-white text-base font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors shadow-lg"
                    >
                      {generatingFinal ? '生成中...' : '最終ストーリーを生成'}
                    </button>
                  </div>

                  {hasDraft && (
                    <p className="mt-3 text-sm text-gray-500 text-center">※ 12のディスカッションテーマは未入力でも生成できます（入力があるほど、内容は具体化されます）</p>
                  )}

                  {generateFinalError && (
                    <div className="mt-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
                      {generateFinalError}
                    </div>
                  )}
                </div>
              </div>
              </ReadOnlyBlock>
            )}
{/* 最終タグ：最終ストーリー */}
            {activeTab === 'final' && (
              <ReadOnlyBlock readOnly={readOnly}>
              <div className="space-y-6">
                {displayingStory.length > 0 ? (
                  <>
                    {/* ★ ステータスバッジ + 表示モード切替 */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      {finalStoryFinalRaw && finalStoryFinalRaw.length > 0 ? (
                        <div className="inline-block bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700 rounded-lg px-4 py-2">
                          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">✓ 確定済み</p>
                        </div>
                      ) : (finalStoryDraftRaw && finalStoryDraftRaw.length > 0 && !finalStoryFinalRaw?.length) ? (
                        <div className="inline-block bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg px-4 py-2">
                          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">⚠️ 未確定（「確定」ボタンを押してください）</p>
                        </div>
                      ) : (
                        <span />
                      )}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => setStoryEditMode((v) => !v)}
                          className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm"
                        >
                          {storyEditMode ? 'ドキュメント表示に戻る' : '本文を編集する'}
                        </button>
                      )}
                    </div>

                    {!storyEditMode ? (
                      <div className="space-y-8">
                        {/* ★ STEP12: 戦略書プレビュー内で、結論直後に数値目標を表示 */}
                        <StrategyStoryPreview
                          story={editingStory.length > 0 ? editingStory : displayingStory}
                          finalized={!!(finalStoryFinalRaw && finalStoryFinalRaw.length > 0)}
                          companyName={companyName}
                          midtermStrategy={midtermStrategy}
                          financialTargets={kpiBridgeData}
                          swotSuggestions={swotSuggestions}
                          swotData={{
                            strengths: strength ? [strength] : [],
                            weaknesses: weakness ? [weakness] : [],
                            opportunities: opportunity ? [opportunity] : [],
                            threats: threat ? [threat] : [],
                          }}
                          businessSegments={businessSegments}
                          segmentPL={segmentPL}
                          valueAnalysis={storeValueAnalysis}
                          businessPortfolio={businessPortfolio}
                        />
                      </div>
                    ) : (
                      /* ★ 4章の編集UI（従来どおり） */
                      <div className="space-y-6">
                        {editingStory.map((chapter, chapterIndex) => (
                          <div key={chapterIndex} className="border border-gray-200 dark:border-gray-700 rounded-lg p-6 bg-white dark:bg-gray-800">
                            {/* 章タイトル */}
                            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">{chapter.title}</h3>

                            {/* Textarea */}
                            <AutoResizeTextarea
                              readOnly={readOnly}
                              value={editingStory[chapterIndex]?.body ?? ''}
                              onChange={(e) => {
                                const updated = [...editingStory];
                                if (updated[chapterIndex]) {
                                  updated[chapterIndex].body = e.target.value;
                                }
                                setEditingStory(updated);
                              }}
                              className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder={`${chapter.title}の本文を入力...`}
                              minRows={8}
                              maxRows={36}
                            />

                            {/* 文字数カウンタ */}
                            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                              {(editingStory[chapterIndex]?.body ?? '').length} 文字
                              <span className="ml-2 text-gray-400">（推奨: 700-1200 文字）</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ★ STEP11: Actions エリア */}
                    <div className="mt-12 pt-8 border-t border-slate-200">
                      <h3 className="text-sm font-bold text-slate-700 text-center mb-6 uppercase tracking-wider">
                        Actions
                      </h3>

                      {/* 編集・保存・破棄ボタン */}
                      <div className="flex gap-3 justify-center mb-6">
                        {/* 保存（下書き保存）：編集モード時のみ */}
                        {storyEditMode && (
                        <button
                          disabled={disabled}
                          onClick={() => {
                            if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
                              console.log('[diag][button][save]', {
                                editingStoryLen: editingStory.length,
                                beforeEditedLen: finalStoryEditedRaw?.length ?? 0,
                                action: 'setFinalStoryEdited',
                              });
                            }
                            setFinalStoryEdited(editingStory);
                            setStoryViewMode('edited');
                          }}
                          className="px-6 py-3 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors shadow-md disabled:opacity-50"
                        >
                          保存
                        </button>
                        )}

                        {/* 確定（Final） */}
                        <div className="flex flex-col gap-2">
                          <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 rounded">
                            ℹ️ この内容を最終ストーリーとして確定すると、リロード後も保存されます
                          </p>
                          <button
                            disabled={disabled}
                            onClick={() => {
                              if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
                                console.log('[diag][button][commit]', {
                                  editingStoryLen: editingStory.length,
                                  beforeDraftLen: finalStoryDraftRaw?.length ?? 0,
                                  beforeEditedLen: finalStoryEditedRaw?.length ?? 0,
                                  beforeFinalLen: finalStoryFinalRaw?.length ?? 0,
                                  action: 'setFinalStoryEdited + commitFinalStory + DB save',
                                });
                              }
                              setFinalStoryEdited(editingStory);
                              setTimeout(() => {
                                commitFinalStory();
                                setStoryViewMode('final');

                              // ★ CRITICAL: 確定時に finalStoryFinal を DB に保存（リロード後も確定版が復元されるため）
                              (async () => {
                                try {
                                  console.log('[Stage2][commit] DB save start for finalStoryFinal');
                                  const storeState = useStrategyStore.getState() as any;
                                  const savePayload = {
                                    ...storeState,
                                    finalStoryFinal: editingStory, // 確定版として保存
                                  };

                                  const saveResult = await saveWithAudit(
                                    savePayload,
                                    undefined,
                                    companyId ?? undefined,
                                    undefined,
                                    {},
                                    'stage2:commitFinalStory'
                                  );

                                  if (saveResult.error === null) {
                                    console.log('[Stage2][commit] ✅ DB save SUCCESS - finalStoryFinal saved', {
                                      finalStoryFinalLen: Array.isArray(editingStory) ? editingStory.length : 0,
                                      revision: saveResult.data?.revision,
                                    });
                                    if (saveResult.data?.revision !== undefined) {
                                      useStrategyStore.getState().setRevision(saveResult.data.revision);
                                    }
                                  } else {
                                    console.warn('[Stage2][commit] ⚠️ DB save FAILED', {
                                      error: (saveResult.error as any)?.message || saveResult.error,
                                    });
                                  }
                                } catch (saveErr) {
                                  console.error('[Stage2][commit] 🚨 DB save error:', saveErr);
                                }
                              })();
                            }, 100);
                          }}
                          className="px-6 py-3 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors shadow-md disabled:opacity-50"
                        >
                          確定
                        </button>
                        </div>

                        {/* 破棄（編集を戻す）：編集モード時のみ */}
                        {storyEditMode && (
                        <button
                          disabled={disabled}
                          onClick={() => {
                            if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
                              console.log('[diag][button][discard]', {
                                usingVersion: finalStoryFinalRaw?.length ? 'final' : finalStoryDraftRaw?.length ? 'draft' : 'none',
                                beforeEditingLen: editingStory.length,
                                afterEditingLen: (finalStoryFinalRaw ?? finalStoryDraftRaw ?? []).length,
                                action: 'setEditingStory (reset to draft/final)',
                              });
                            }
                            setEditingStory(finalStoryFinalRaw ?? finalStoryDraftRaw ?? []);
                            setStoryViewMode('auto');
                          }}
                          className="px-6 py-3 rounded-lg bg-slate-400 text-white text-sm font-medium hover:bg-slate-500 transition-colors shadow-md disabled:opacity-50"
                        >
                          破棄
                        </button>
                        )}
                      </div>

                      {/* 再生成ボタン */}
                      <div className="flex justify-center mb-4">
                        <button
                          disabled={disabled || !hasDraft || generatingFinal}
                          onClick={handleGenerateFinal}
                          className="px-8 py-3 rounded-lg bg-slate-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors shadow-md"
                        >
                          {generatingFinal ? '生成中...' : '最終ストーリーを再生成'}
                        </button>
                      </div>

                      <p className="text-xs text-slate-500 text-center leading-relaxed">
                        ※ 再生成すると下書きが更新され、編集版は保持されます
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-800/50 p-8 text-center">
                    <h4 className="text-base font-medium text-gray-600 dark:text-gray-400 mb-2">最終ストーリー（未生成）</h4>
                    <p className="text-sm text-gray-400 dark:text-gray-500">
                      「勝ち筋」タブで「最終ストーリーを生成」を実行してください（12のディスカッションテーマは未回答でもOKです）
                    </p>
                  </div>
                )}

                {/* ★中計設計は StrategyStoryPreview 内に統合済（上部の戦略書プレビューで表示）*/}

                {generateFinalError && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
                    {generateFinalError}
                  </div>
                )}
              </div>
              </ReadOnlyBlock>
            )}
          </div>
        </>
      )}
    </main>
  );
}

export default function Stage2Page() {
  const isAdmin = useUserStore((s) => s.isAdmin);
  // ★ STAGE2 仕様: edit は Admin のみ、Manager は review のみ
  const canEdit = isAdmin;

  return (
    <StrategyGuard mode="view">
      <Stage2PageContent readOnly={!canEdit} disabled={!canEdit} />
    </StrategyGuard>
  );
}
