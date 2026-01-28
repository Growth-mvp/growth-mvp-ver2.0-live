// /app/stage2/page.tsx
'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import {
  getStage1DataWithFallback,
  loadStage1SnapshotFromLocalStorage,
  loadStage2SnapshotFromLocalStorage,
  saveStage2SnapshotToLocalStorage,
} from '@/utils/stageSnapshot';
import { getFullStrategyDataByCompany, saveStrategyData as saveStrategyDataApi } from '@/utils/supabase/strategy';
import type { IssueBlock, MetricsSummary, StoryChapter, WinPatternCandidate, Stage2State, Stage2Answer } from '@/types/strategy';

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
    question: '次の時代、私たちを取り巻く市場や事業環境はどのような世界が待っているでしょうか？',
    reason: '前提をバックキャスト思考で考えることで、フォアキャスト思考から抜け出せます。',
    chapter: 1,
    required: false,
  },
  {
    id: 'ch1-q2',
    question: 'その変化の中で、顧客が本当に求める「価値」は何であり、なぜそれが自社を選ぶ理由になるのでしょうか？',
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

/* ===================================================
 * StepperTabs（再編版）
 * =================================================== */
type TabId = 'input' | 'draft' | 'win' | 'final';

interface StepperTabsProps {
  activeTab: TabId;
  onChange: (tab: TabId) => void;

  // enable/complete 判定用
  canOpenDraft: boolean;
  hasDraft: boolean;
  canOpenWin: boolean;
  hasWinReady: boolean; // 修正：必須回答ではなく「最終生成が可能な状態（=Draft生成済み）」を表す
  hasFinal: boolean;
}

function StepperTabs({ activeTab, onChange, canOpenDraft, hasDraft, canOpenWin, hasWinReady, hasFinal }: StepperTabsProps) {
  const tabs: {
    id: TabId;
    label: string;
    enabled: boolean;
    completed: boolean;
    warning?: boolean;
  }[] = [
    { id: 'input', label: '入力', enabled: true, completed: false },
    { id: 'draft', label: 'DRAFT', enabled: canOpenDraft, completed: hasDraft },
    { id: 'win', label: '勝ち筋', enabled: canOpenWin, completed: hasWinReady },
    { id: 'final', label: '最終', enabled: hasFinal, completed: hasFinal },
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
            <div className="text-sm text-gray-700 dark:text-gray-300">
              <ScrollText maxH="max-h-[360px]">{chapter.body}</ScrollText>
            </div>
          </div>
        ))}
      </div>
    </div>
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
  const setCeoIntent = useStrategyStore((s) => s.setCeoIntent);
  const ceoIntent = useStrategyStore((s) => s.ceoIntent ?? '');

  return (
    <div className="rounded-2xl border border-black/10 bg-white/70 dark:bg-white/5 shadow-sm backdrop-blur-md p-6">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">経営者の思い</h3>

      <GlassCard title="経営者の思い" hint="原点・譲れない価値観・実現したい未来など、企業の根底にある思いを記入してください">
        <textarea
          value={ceoIntent}
          onChange={(e) => setCeoIntent(e.target.value)}
          placeholder="例：なぜこの会社を続けるのか / 何を実現したいのか / 譲れない価値観…"
          className="min-h-[120px] w-full resize-y rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
        />
      </GlassCard>
    </div>
  );
}

/* ===================================================
 * MVVセクション
 * =================================================== */
function MVVSection() {
  const setMVV = useStrategyStore((s) => s.setMVV);
  const mission = useStrategyStore((s) => s.mission ?? '');
  const vision = useStrategyStore((s) => s.vision ?? '');
  const value = useStrategyStore((s) => s.value ?? '');

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">MVV（ミッション・ビジョン・バリュー）</h3>

      <GlassCard title="Mission（ミッション）" hint="会社が存在する理由。短く、覚えやすく。">
        <textarea
          value={mission}
          onChange={(e) => setMVV({ mission: e.target.value })}
          placeholder="例：私たちは〇〇で社会の課題を解決します。"
          className="min-h-[100px] w-full resize-y rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
        />
      </GlassCard>

      <GlassCard title="Vision（ビジョン）" hint="目指す未来像。5〜10年後に到達したい状態。">
        <textarea
          value={vision}
          onChange={(e) => setMVV({ vision: e.target.value })}
          placeholder="例：〇〇領域で最も信頼される企業になる。"
          className="min-h-[100px] w-full resize-y rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
        />
      </GlassCard>

      <GlassCard title="Value（バリュー）" hint="日々の意思決定の拠り所。3〜5語で要点を。">
        <textarea
          value={value}
          onChange={(e) => setMVV({ value: e.target.value })}
          placeholder="例：挑戦／誠実／共創"
          className="min-h-[100px] w-full resize-y rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
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
 * SWOTセクション
 * =================================================== */
function SWOTSection() {
  const setSWOT = useStrategyStore((s) => s.setSWOT);
  const strength = useStrategyStore((s) => s.strength ?? '');
  const weakness = useStrategyStore((s) => s.weakness ?? '');
  const opportunity = useStrategyStore((s) => s.opportunity ?? '');
  const threat = useStrategyStore((s) => s.threat ?? '');

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">SWOT分析</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GlassCard title="Strength（強み）" accentClass="bg-emerald-400/80" hint="自社の競争優位性">
          <textarea
            className="min-h-[120px] w-full resize-y rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            value={strength}
            onChange={(e) => setSWOT({ strength: e.target.value })}
            placeholder="例：高度な技術力／顧客との信頼関係"
          />
        </GlassCard>

        <GlassCard title="Weakness（弱み）" accentClass="bg-rose-400/80" hint="改善が必要な領域">
          <textarea
            className="min-h-[120px] w-full resize-y rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            value={weakness}
            onChange={(e) => setSWOT({ weakness: e.target.value })}
            placeholder="例：人材不足／情報発信の弱さ"
          />
        </GlassCard>

        <GlassCard title="Opportunity（機会）" accentClass="bg-sky-400/80" hint="外部環境の追い風">
          <textarea
            className="min-h-[120px] w-full resize-y rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            value={opportunity}
            onChange={(e) => setSWOT({ opportunity: e.target.value })}
            placeholder="例：市場拡大／規制緩和"
          />
        </GlassCard>

        <GlassCard title="Threat（脅威）" accentClass="bg-amber-400/80" hint="外部環境のリスク">
          <textarea
            className="min-h-[120px] w-full resize-y rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            value={threat}
            onChange={(e) => setSWOT({ threat: e.target.value })}
            placeholder="例：価格競争の激化／景気悪化"
          />
        </GlassCard>
      </div>
    </div>
  );
}

/* ===================================================
 * たたき台（Draft）プレビュー：全文＋スクロール
 * =================================================== */
function DraftStoryPanel({ storyDraft }: { storyDraft: StoryChapter[] }) {
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
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              <ScrollText maxH="max-h-[280px]">{chapter.body}</ScrollText>
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

  const selectedQ = TEMPLATE12.find((q) => q.id === selectedId) || TEMPLATE12[0];
  const currentAnswer = answers12.find((a) => a.id === selectedId)?.answer ?? '';

  const groupedQuestions = useMemo(() => {
    return TEMPLATE12.reduce<Record<number, typeof TEMPLATE12>>((acc, q) => {
      if (!acc[q.chapter]) acc[q.chapter] = [];
      acc[q.chapter].push(q);
      return acc;
    }, {});
  }, []);

  const answeredTotal = answers12.filter((a) => a.answer?.trim()).length;

  return (
    <div className="rounded-2xl border border-black/10 bg-white/70 dark:bg-white/5 shadow-sm backdrop-blur-md p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">12の質問</h3>
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
                  const isAnswered = !!answers12.find((a) => a.id === q.id && a.answer?.trim());
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

          <textarea
            value={currentAnswer}
            onChange={(e) => onUpdateAnswer(selectedId, e.target.value)}
            disabled={disabled}
            placeholder="この質問に対するあなたの考えを記入してください（未回答でも最終ストーリーは生成できます）..."
            className="w-full min-h-[220px] resize-y rounded-xl border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-white/5 px-4 py-3 text-sm text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
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
export default function Stage2Page() {
  const router = useRouter();

  // Store / User
  const storeIssues = useStrategyStore((s) => s.stage1Issues);
  const storeValueAnalysis = useStrategyStore((s) => s.valueAnalysis);
  const setStage1Issues = useStrategyStore((s) => s.setStage1Issues);

  const thought = useStrategyStore((s) => s.thought ?? '');
  const mission = useStrategyStore((s) => s.mission ?? '');
  const vision = useStrategyStore((s) => s.vision ?? '');
  const value = useStrategyStore((s) => s.value ?? '');

  // ★ 追加：Stage2Page内でもceoIntentを参照できるようにする（ReferenceError対策）
  const ceoIntent = useStrategyStore((s) => s.ceoIntent ?? '');

  const strength = useStrategyStore((s) => s.strength ?? '');
  const weakness = useStrategyStore((s) => s.weakness ?? '');
  const opportunity = useStrategyStore((s) => s.opportunity ?? '');
  const threat = useStrategyStore((s) => s.threat ?? '');

  const industry = useStrategyStore((s) => s.industry ?? '');
  const revenue = useStrategyStore((s) => s.revenue ?? '');
  const employees = useStrategyStore((s) => s.employees ?? '');
  const businessContent = useStrategyStore((s) => s.businessContent ?? '');
  const businessSegments = useStrategyStore((s) => s.businessSegments ?? []); // ★ STAGE1で定義されたセグメント情報
  const businessPortfolio = useStrategyStore((s) => (s as any).businessPortfolio ?? null); // ★ 現在の事業ポートフォリオ（型揺れ許容）
  const companyId = useUserStore((s) => s.companyId);
  const userId = useUserStore((s) => s.user?.id);
  const hydrated = useStrategyStore((s) => s.hydrated);

  // answers12 store連携
  const storeAnswers12 = useStrategyStore((s) => s.answers12);
  const setAnswers12 = useStrategyStore((s) => s.setAnswers12);

  // finalStory store連携
  const setStoreFinalStory = useStrategyStore((s) => s.setFinalStory);

  // SWOT suggestions store連携（Hooks Rule: top-level で呼ぶ）
  const swotSuggestions = useStrategyStore((s) => s.swotSuggestions);
  const addSwotOpportunity = useStrategyStore((s) => s.addSwotOpportunity);
  const addSwotThreat = useStrategyStore((s) => s.addSwotThreat);

  // Local UI state
  const [loading, setLoading] = useState(true);
  const [issueBlocks, setIssueBlocks] = useState<IssueBlock[]>([]);
  const [metricsSummary, setMetricsSummary] = useState<MetricsSummary>({});
  const [dataSource, setDataSource] = useState<'store' | 'localStorage' | 'supabase' | 'none'>('none');
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Draft & candidates
  const [storyDraft, setStoryDraft] = useState<StoryChapter[]>([]);
  const [winPatternsCandidate, setWinPatternsCandidate] = useState<WinPatternCandidate[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generatingOT, setGeneratingOT] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateOTError, setGenerateOTError] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);

  // Final
  const [selectedWinPatternId, setSelectedWinPatternId] = useState<string | null>(null); // UIでは選択させない（内部参照用）
  const [finalStory, setLocalFinalStory] = useState<StoryChapter[]>([]);
  const [generatingFinal, setGeneratingFinal] = useState(false);
  const [generateFinalError, setGenerateFinalError] = useState<string | null>(null);

  // 12 answers local
  const [answers12, setLocalAnswers12] = useState<Stage2Answer[]>(() =>
    TEMPLATE12.map((q) => ({ id: q.id, question: q.question, answer: '', required: q.required }))
  );

  // Active tab
  const [activeTab, setActiveTab] = useState<TabId>('input');

  // 初期復元が完了したか（復元前に local->store が走って store を空で上書きするのを防ぐ）
  const [stage2Ready, setStage2Ready] = useState(false);

  // 同期ループ防止用
  const lastSyncedAnswersHashRef = useRef<string>('');
  const didInitRef = useRef(false);

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

  // Stage2 snapshot restore
  const restoreStage2Snapshot = useCallback(() => {
    const snapshot = loadStage2SnapshotFromLocalStorage();
    if (!snapshot || !snapshot.state) {
      setStage2Ready(true);
      return;
    }

    const st = snapshot.state;

    // ✅ ceoIntent 復元（snapshot → store）
    if (typeof (st as any).ceoIntent === 'string') {
      useStrategyStore.getState().setCeoIntent((st as any).ceoIntent);
    }

    // ✅ MVV 復元（snapshot → store）
    if (st.mvv) {
      useStrategyStore.getState().setMVV({
        thought: st.mvv.thought ?? '',
        mission: st.mvv.mission ?? '',
        vision: st.mvv.vision ?? '',
        value: st.mvv.value ?? '',
      });
    }

    // ✅ SWOT 復元（snapshot → store）
    if (st.swot) {
      useStrategyStore.getState().setSWOT({
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

    // answers12（localのみ復元。store同期は stage2Ready 後の debounce で1回だけ行う）
    const a12 = st.answers12 ?? [];
    if (Array.isArray(a12) && a12.length > 0) {
      setLocalAnswers12((prev) =>
        prev.map((a) => {
          const fromSnapshot = a12.find((s: any) => s.id === a.id);
          return fromSnapshot ? { ...a, answer: fromSnapshot.answer ?? '' } : a;
        })
      );
      lastSyncedAnswersHashRef.current = hashAnswers12(a12);
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

    setStage2Ready(true);
  }, [setStoreFinalStory]);

  // 初回だけロード＆復元（複数回走ってスナップショット保存が暴発するのを防ぐ）
  useEffect(() => {
    if (hydrated && !didInitRef.current) {
      didInitRef.current = true;
      loadStage1Data();
      restoreStage2Snapshot();
    }
  }, [hydrated, loadStage1Data, restoreStage2Snapshot]);

  // ✅ Stage2 入力の自動スナップショット保存（debounce）
  // - 生成ボタンを押さなくても localStorage に残す
  useEffect(() => {
    if (!stage2Ready) return;

    const t = window.setTimeout(() => {
      const stage2State: Stage2State = {
        ceoIntent,
        mvv: { thought, mission, vision, value },
        swot: { strength, weakness, opportunity, threat },
        storyDraft,
        winPatternsCandidate,
        answers12,
        finalStory,
      };

      saveStage2SnapshotToLocalStorage(stage2State, companyId ?? undefined);
      if (process.env.NODE_ENV === 'development') {
        console.log('[Stage2] autosave snapshot', {
          ceoIntentLen: ceoIntent?.length ?? 0,
          answered: answers12?.filter((a) => a.answer?.trim()).length ?? 0,
          hasDraft: storyDraft?.length ?? 0,
          hasWin: winPatternsCandidate?.length ?? 0,
          hasFinal: finalStory?.length ?? 0,
        });
      }
    }, 300);

    return () => window.clearTimeout(t);
  }, [
    stage2Ready,
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
    finalStory,
  ]);

  // ★ Development環境での fetch フック（限定版：/api/stage2/ は素通し）
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;

    const w = window as any;
    if (w.__stage2FetchHooked) return;
    w.__stage2FetchHooked = true;

    const origFetch = window.fetch.bind(window);

    // ★ 修正：input/init を関数シグネチャで明示的に宣言
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        // ★ URL を文字列化（Request オブジェクト対応）
        const urlStr: string = typeof input === 'string'
          ? input
          : (input instanceof Request ? input.url : String(input));

        // ★ /api/stage2/ 配下は必ず素通し（hook を一切適用しない）
        if (urlStr.includes('/api/stage2/')) {
          console.log('[Stage2][fetch-hook] BYPASS /api/stage2/', { url: urlStr });
          return (origFetch as any)(input as any, init as any);
        }

        const method = init?.method ?? 'GET';

        // ★ 全 fetch を記録（stage2以外のみ）
        console.log('[Stage2][fetch-hook] called', {
          url: urlStr,
          method,
          at: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('[Stage2][fetch-hook] error in hook:', e);
      }

      // ★ 必ず return する（どの分岐からでも）
      return (origFetch as any)(input as any, init as any);
    };

    console.log('[Stage2][fetch-hook] installed (limited scope: stage2 bypass)');
  }, []);

  // storeAnswers12 -> local sync（サーバから復元/他画面更新時）
  useEffect(() => {
    if (!stage2Ready) return;

    const storeHash = hashAnswers12(storeAnswers12);
    const localHash = hashAnswers12(answers12);

    // 既に一致しているなら何もしない（同期ループ防止）
    if (storeHash && storeHash === localHash) {
      lastSyncedAnswersHashRef.current = storeHash;
      return;
    }

    // storeが空で localに値があるなら localを優先（ここでは何もしない）
    if (!storeHash && localHash) return;

    if (storeAnswers12 && storeAnswers12.length > 0) {
      setLocalAnswers12((prev) =>
        prev.map((a) => {
          const fromStore = storeAnswers12.find((s) => s.id === a.id);
          return fromStore ? { ...a, answer: fromStore.answer ?? '' } : a;
        })
      );
      lastSyncedAnswersHashRef.current = storeHash;
    }
  }, [stage2Ready, storeAnswers12, answers12]);

  // local answers12 -> store sync（debounce + 同一スキップ）
  useEffect(() => {
    if (!stage2Ready) return;

    const localHash = hashAnswers12(answers12);
    const storeHash = hashAnswers12(storeAnswers12);

    // 既に一致しているなら同期不要
    if (localHash === storeHash) {
      lastSyncedAnswersHashRef.current = localHash;
      return;
    }

    // 直近で同じ内容を同期済みなら不要（ループ抑止）
    if (localHash && localHash === lastSyncedAnswersHashRef.current) return;

    const timer = window.setTimeout(() => {
      const nowStoreHash = hashAnswers12(useStrategyStore.getState().answers12);
      if (localHash === nowStoreHash) {
        lastSyncedAnswersHashRef.current = localHash;
        return;
      }

      setAnswers12(answers12);
      lastSyncedAnswersHashRef.current = localHash;
    }, 300);

    return () => window.clearTimeout(timer);
  }, [stage2Ready, answers12, storeAnswers12, setAnswers12]);

  // ★ 修正：state updater 内からのsetState呼び出しを廃止
  // 代わりに、この関数はローカル状態のみ更新し、
  // 上記の useEffect で自動的にストアに同期されます
  const handleUpdateAnswer = useCallback((id: string, answer: string) => {
    setLocalAnswers12((prev) => prev.map((a) => (a.id === id ? { ...a, answer } : a)));
  }, []);

  // O/T generation
  const handleGenerateOT = useCallback(async () => {
    if (generatingOT) return;

    setGeneratingOT(true);
    setGenerateOTError(null);

    try {
      const response = await fetch('/api/generate-ot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industry: industry || '',
          revenue: revenue || '',
          employees: employees || '',
          businessContent: businessContent || '',
        }),
        cache: 'no-store',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API error: ${response.status}`);
      }

      const data = await response.json();
      const opportunities = Array.isArray(data.opportunity) ? data.opportunity : [];
      const threats = Array.isArray(data.threat) ? data.threat : [];

      useStrategyStore.getState().setSwotSuggestions({
        opportunity: opportunities,
        threat: threats,
        generatedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      console.error('[Stage2] Generate O/T error:', e);
      setGenerateOTError(e?.message || 'O/Tの提案生成に失敗しました');
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

        // ★ (3) fetch 直前ログ
        const url = '/api/stage2/generate-draft';
        console.log('[Stage2] BEFORE fetch', {
          url,
          issueBlocksCount,
          payloadSize: JSON.stringify(payload).length,
          pingMode: isPing,
        });

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
          cache: 'no-store',
        });

        // ★★★ 重要：レスポンスが返った時点で timeout を解除する（本文読取/parse 中に abort されるのを防ぐ）
        done = true; // ★追加：これ以上 abort させない（race 防止）
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }

        // ★ レスポンス本文を先に読む（ok チェック前に）
        const contentType = response.headers.get('content-type') || '';
        const responseText = await response.text();

        // ★ (4) fetch 直後ログ
        console.log('[Stage2] AFTER fetch', { status: response.status, ok: response.ok, ct: contentType });

        // ★ res.ok チェック
        if (!response.ok) {
          console.error('[Stage2] generate failed body:', responseText.substring(0, 400));
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        // ★ Content-Type チェック
        if (!contentType.includes('application/json')) {
          console.error('[Stage2] non-json response:', responseText.substring(0, 400));
          throw new Error(`Unexpected Content-Type: ${contentType}`);
        }

        // ★ JSON パース
        const data = JSON.parse(responseText);

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

        setStoryDraft(newStoryDraft);
        setWinPatternsCandidate(newWinPatterns);
        setSelectedWinPatternId(newWinPatterns?.[0]?.id ?? null);

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
            await saveStrategyDataApi(
              {
                ...storeState,
                story: newStoryDraft,
              },
              userId,
              companyId
            );
          } catch (saveError) {
            console.warn('[Stage2] Supabase save failed:', saveError);
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

    setGeneratingFinal(true);
    setGenerateFinalError(null);

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

      const segmentNames = Array.isArray(businessSegments)
        ? businessSegments
            .map((s: any) => (typeof s?.name === 'string' ? s.name.trim() : ''))
            .filter(Boolean)
        : [];

      const response = await fetch('/api/stage2/generate-final', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueBlocks,
          metricsSummary,
          mvv: { thought, mission, vision, value },
          swot: { strength, weakness, opportunity, threat },
          storyDraft,
          winPatternsCandidate,
          // UIでは選択させないが、API整合のため内部で先頭候補を参照（無い場合は null）
          selectedWinPatternId: selectedWinPatternId ?? winPatternsCandidate?.[0]?.id ?? null,
          answers12, // 未回答でもOK（空文字が混ざっていても許容）
          industry,
          segments: segmentNames,
          businessSegments,
          businessPortfolio,
        }),
        signal: controller.signal,
        cache: 'no-store',
      });

      // ★★★ 重要：レスポンスが返ったら timeout を解除（本文 parse 中に abort されるのを防ぐ）
      done = true; // ★追加：これ以上 abort させない（race 防止）
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const errorData = (() => {
          try {
            return JSON.parse(errorText || '{}');
          } catch {
            return {};
          }
        })();
        throw new Error(errorData.error || `API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const newFinalStory: StoryChapter[] = Array.isArray(data.finalStory) ? data.finalStory : [];

      setLocalFinalStory(newFinalStory);
      setStoreFinalStory(newFinalStory);

      // Auto navigate to Final tab
      setActiveTab('final');

      const stage2State: Stage2State = {
        ceoIntent,
        mvv: { thought, mission, vision, value },
        swot: { strength, weakness, opportunity, threat },
        storyDraft,
        winPatternsCandidate,
        answers12,
        finalStory: newFinalStory,
      };
      saveStage2SnapshotToLocalStorage(stage2State, companyId ?? undefined);
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
      done = true; // ★追加：timeout abort を確実に防ぐ
      if (timer) clearTimeout(timer);
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
    industry,
    businessSegments,
    businessPortfolio,
    companyId,
    setStoreFinalStory,
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
  const canOpenWin = hasDraft; // たたき台生成後に進める
  const hasWinReady = hasDraft; // Draft生成済みなら最終生成が可能
  const hasFinal = finalStory.length > 0;

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-slate-50/60 dark:from-zinc-950 dark:to-zinc-900">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 dark:bg-zinc-900/80 backdrop-blur border-b border-black/5 dark:border-white/5">
        <div className="max-w-[1100px] mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-800 dark:text-gray-200">STAGE2：経営戦略ストーリー</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              入力（MVV・SWOT）→ DRAFT（STAGE1論点＋4章たたき台）→ 勝ち筋（一覧＋12問）→ 最終
            </p>
          </div>
          <button
            onClick={() => router.push('/stage1')}
            className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            ← STAGE1に戻る
          </button>
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
        <div className="max-w-[1100px] mx-auto px-6 py-4">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-700 dark:text-red-400">
            {error}
          </div>
        </div>
      )}

      {!loading && issueBlocks.length > 0 && (
        <>
          {/* Sticky StepperTabs */}
          <div className="sticky top-[56px] z-10 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md border-b border-black/5 dark:border-white/5">
            <div className="max-w-[1100px] mx-auto px-6 py-4">
              <StepperTabs
                activeTab={activeTab}
                onChange={setActiveTab}
                canOpenDraft={canOpenDraft}
                hasDraft={hasDraft}
                canOpenWin={canOpenWin}
                hasWinReady={hasWinReady}
                hasFinal={hasFinal}
              />
            </div>
          </div>

          {/* Tab Content */}
          <div className="max-w-[1100px] mx-auto px-6 py-6 space-y-6">
            {/* 入力タグ：CEO意図→MVV＋SWOT→たたき台生成 */}
            {activeTab === 'input' && (
              <div className="space-y-6">
                <CEOIntentSection />

                <div className="rounded-2xl border border-black/10 bg-white/70 dark:bg-white/5 shadow-sm backdrop-blur-md p-6">
                  <MVVSection />
                </div>

                <div className="rounded-2xl border border-black/10 bg-white/70 dark:bg-white/5 shadow-sm backdrop-blur-md p-6">
                  <SWOTSection />
                  <OTSuggestionsPanel suggestions={swotSuggestions} onAddOpportunity={addSwotOpportunity} onAddThreat={addSwotThreat} />
                </div>

                <div className="flex gap-4 justify-center">
                  <button
                    type="button"
                    onClick={handleGenerateOT}
                    disabled={generatingOT}
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
                    disabled={generating}
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
            )}

            {/* DRAFTタグ：STAGE1論点（3件）＋4章ストーリー */}
            {activeTab === 'draft' && (
              <div className="space-y-6">
                <IssueBlockPreview
                  issueBlocks={issueBlocks}
                  metricsSummary={metricsSummary}
                  source={dataSource}
                  collapsed={collapsed}
                  onToggle={() => setCollapsed(!collapsed)}
                />

                <DraftStoryPanel storyDraft={storyDraft} />

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
                    disabled={generating}
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
              </div>
            )}

            {/* 勝ち筋タグ：勝ち筋一覧（選択不要）＋12の質問→最終生成 */}
            {activeTab === 'win' && (
              <div className="space-y-6">
                <WinPatternList candidates={winPatternsCandidate} />

                <Questions12Section answers12={answers12} onUpdateAnswer={handleUpdateAnswer} disabled={!hasDraft} />

                {!hasDraft && (
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 text-sm text-amber-700 dark:text-amber-400">
                    先に「入力」タブでたたき台を生成してください（勝ち筋候補・ストーリーが揃うと議論が進みます）。
                  </div>
                )}

                <div className="flex justify-center">
                  <button
                    onClick={handleGenerateFinal}
                    disabled={!hasDraft || generatingFinal}
                    className="px-8 py-4 rounded-xl bg-emerald-600 text-white text-base font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors shadow-lg"
                  >
                    {generatingFinal ? '生成中...' : '最終ストーリーを生成'}
                  </button>
                </div>

                {hasDraft && (
                  <p className="text-sm text-gray-500 text-center">※ 12の質問は未回答でも生成できます（回答があるほど、内容は具体化されます）</p>
                )}

                {generateFinalError && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
                    {generateFinalError}
                  </div>
                )}
              </div>
            )}

            {/* 最終タグ：最終ストーリー */}
            {activeTab === 'final' && (
              <div className="space-y-6">
                {finalStory.length > 0 ? (
                  <>
                    <FinalStoryPreview finalStory={finalStory} />

                    <div className="flex justify-center">
                      <button
                        onClick={handleGenerateFinal}
                        disabled={!hasDraft || generatingFinal}
                        className="px-8 py-4 rounded-xl bg-emerald-600 text-white text-base font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors shadow-lg"
                      >
                        {generatingFinal ? '生成中...' : '最終ストーリーを再生成'}
                      </button>
                    </div>

                    <p className="text-sm text-gray-500 text-center">※ 12の質問は未回答でも再生成できます（回答があるほど、内容は具体化されます）</p>
                  </>
                ) : (
                  <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-800/50 p-8 text-center">
                    <h4 className="text-base font-medium text-gray-600 dark:text-gray-400 mb-2">最終ストーリー（未生成）</h4>
                    <p className="text-sm text-gray-400 dark:text-gray-500">
                      「勝ち筋」タブで「最終ストーリーを生成」を実行してください（12の質問は未回答でもOKです）
                    </p>
                  </div>
                )}

                {generateFinalError && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
                    {generateFinalError}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}
