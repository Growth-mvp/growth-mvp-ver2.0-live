'use client';

import { useState } from 'react';
import type { ProjectDraftReasoning } from '@/types/strategy';
import { CAUSAL_KEYS, CAUSAL_LABEL } from '@/lib/stage4/draftPromptSections';
import { ASSUMPTION_LABEL, provenanceLabel } from '@/lib/stage4/provenance';
import type { FollowUpQuestion } from '@/lib/stage4/followUpQuestions';

type View = {
  current: FollowUpQuestion | null;
  answered: FollowUpQuestion[];
  skipped: FollowUpQuestion[];
  known: FollowUpQuestion[];
  pending: number;
};

type Props = {
  reasoning?: ProjectDraftReasoning;
  assumptions: Record<string, number | undefined>;
  disabled: boolean;
  onConfirm: (key: string) => void;
  view: View;
  onAnswer: (q: FollowUpQuestion, value: string | number) => void;
  onSkip: (q: FollowUpQuestion) => void;
  onReopen: (q: FollowUpQuestion) => void;
  onConfirmObjective: () => void;
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
};

const btn = 'rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-indigo-900 hover:bg-indigo-50 disabled:opacity-50';
const primary = 'rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50';

function QuestionForm({ q, disabled, hint, onAnswer, onSkip }: { q: FollowUpQuestion; disabled: boolean; hint?: string; onAnswer: (v: string | number) => void; onSkip: () => void }) {
  const [draft, setDraft] = useState('');
  const hasValue = draft.trim() !== '' && (q.answerType === 'text' || Number.isFinite(Number(draft)));
  return (
    <div className="space-y-2">
      <div className="text-[13px] font-semibold text-zinc-900">{q.text}</div>
      <div className="text-[11px] text-indigo-900">理由：{q.reason}</div>
      {hint && <div className="text-[11px] text-zinc-700">{hint}</div>}
      <div className="flex flex-wrap items-end gap-2">
        {q.answerType === 'number' ? (
          <label className="space-y-1">
            <span className="text-[11px] font-semibold text-zinc-700">{q.unit ? `数値（${q.unit}）` : '数値'}</span>
            <input
              type="number"
              step="any"
              value={draft}
              disabled={disabled}
              onChange={(e) => setDraft(e.target.value)}
              className="h-9 w-40 rounded-lg border border-indigo-100 bg-white px-3 text-[13px]"
            />
          </label>
        ) : (
          <label className="min-w-0 flex-1 space-y-1">
            <span className="text-[11px] font-semibold text-zinc-700">回答</span>
            <input
              type="text"
              value={draft}
              disabled={disabled}
              onChange={(e) => setDraft(e.target.value)}
              className="h-9 w-full rounded-lg border border-indigo-100 bg-white px-3 text-[13px]"
            />
          </label>
        )}
        <button
          type="button"
          disabled={disabled || !hasValue}
          onClick={() => onAnswer(q.answerType === 'number' ? Number(draft) : draft.trim())}
          className={primary}
        >
          回答する
        </button>
        <button type="button" disabled={disabled} onClick={onSkip} className={btn}>
          分からない（保留）
        </button>
      </div>
      {q.assumptionKey && (
        <p className="text-[11px] text-zinc-600">回答すると前提の値に反映し、未確認の財務効果を再計算します。回答は確定値ではなく、利用者の回答として保存します。</p>
      )}
      <p className="text-[10px] text-zinc-500">AIの確認事項：{q.source}</p>
    </div>
  );
}

export function SavedReasoningSection({ reasoning, assumptions, disabled, onConfirm, view, onAnswer, onSkip, onReopen, paused, onPause, onResume }: Props) {
  if (!reasoning || typeof reasoning !== 'object') return null;
  const causal = reasoning.causalChain ?? {};
  const causalKeys = CAUSAL_KEYS.filter((k) => typeof causal[k] === 'string' && causal[k]);
  const provenance = reasoning.provenance ?? {};
  const keys = Object.keys(provenance);
  const hasQuestions = view.current || view.answered.length || view.skipped.length;
  if (causalKeys.length === 0 && keys.length === 0 && !hasQuestions) return null;

  return (
    <section aria-label="AIの提案の根拠（保存済み）" className="mt-4 space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 text-[12px] text-zinc-800">
      <div className="text-[13px] font-semibold text-indigo-900">AIの提案の根拠（保存済み）</div>
      <p className="text-[11px] text-indigo-900">AIの仮説は、利用者が確認しても実績にはなりません。確認した事実は「確認済み」として残ります。</p>

      {view.current && paused && (
        <div aria-label="AIからの確認事項（後回し）" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-white p-3 text-[12px] text-indigo-900">
          <span>AIからの確認事項は後回しにしています（残り {view.pending} 件）</span>
          <button type="button" disabled={disabled} onClick={onResume} className={btn}>確認事項に戻る</button>
        </div>
      )}

      {view.current && !paused && (
        <div aria-label="AIからの確認事項" className="space-y-2 rounded-lg border border-indigo-300 bg-white p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold text-indigo-900">
            <span>AIからの確認事項（1問ずつ）</span>
            <span>残り {view.pending} 件 ／ 保留 {view.skipped.length} 件</span>
          </div>
          <QuestionForm
            key={view.current.id}
            q={view.current}
            hint={view.current.assumptionKey && assumptions[view.current.assumptionKey] !== undefined && assumptions[view.current.assumptionKey] !== null ? `AIの仮説の値：${assumptions[view.current.assumptionKey]}${view.current.unit ?? ''}（確認してください）` : undefined}
            disabled={disabled}
            onAnswer={(v) => onAnswer(view.current!, v)}
            onSkip={() => onSkip(view.current!)}
          />
          <div className="border-t border-indigo-100 pt-2">
            <button type="button" disabled={disabled} onClick={onPause} className={btn}>後で確認して、財務の質問へ進む</button>
          </div>
        </div>
      )}

      {!view.current && (view.answered.length > 0 || view.skipped.length > 0) && (
        <p className="text-[11px] text-indigo-900">AIからの確認事項はすべて回答または保留済みです。</p>
      )}

      {view.answered.length > 0 && (
        <details className="rounded-lg border border-indigo-100 bg-white p-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-indigo-900">回答済み（{view.answered.length}件）</summary>
          <ul className="mt-1 space-y-0.5 text-[11px]">
            {view.answered.map((q) => {
              const rec = reasoning.followUps?.[q.id];
              return (
                <li key={q.id}>
                  ・{q.text} → <span className="font-semibold">{rec?.value === undefined ? '（回答）' : `${String(rec.value)}${q.unit ? q.unit : ''}`}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {view.skipped.length > 0 && (
        <div className="space-y-1 text-[11px]">
          <div className="font-semibold text-indigo-900">保留中（{view.skipped.length}件）</div>
          {view.skipped.map((q) => (
            <div key={q.id} className="flex flex-wrap items-center gap-2">
              <span>・{q.text}</span>
              <button type="button" disabled={disabled} onClick={() => onReopen(q)} className="rounded-lg border border-indigo-200 bg-white px-2 py-0.5 font-semibold text-indigo-900 hover:bg-indigo-50 disabled:opacity-50">
                保留を解除
              </button>
            </div>
          ))}
        </div>
      )}

      {causalKeys.length > 0 && (
        <div>
          <div className="font-semibold">因果関係（AIの仮説）</div>
          <ul className="mt-1 space-y-0.5 text-[11px]">
            {causalKeys.map((k) => (
              <li key={k}>・{CAUSAL_LABEL[k]}：{causal[k]}</li>
            ))}
          </ul>
        </div>
      )}

      {keys.length > 0 && (
        <div>
          <div className="font-semibold">重要な前提と出所</div>
          <ul className="mt-1 space-y-1">
            {keys.map((k) => {
              const p = provenance[k];
              const value = assumptions[k];
              return (
                <li key={k} className="flex flex-wrap items-center gap-2">
                  <span>{ASSUMPTION_LABEL[k] ?? k}：{value === undefined ? '未入力' : String(value)}</span>
                  <span className="text-indigo-900">[{provenanceLabel(p)}]</span>
                  {p && !p.userConfirmed && (
                    <button type="button" disabled={disabled} onClick={() => onConfirm(k)} className="rounded-lg border border-indigo-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-indigo-900 hover:bg-indigo-50 disabled:opacity-50">
                      この前提を確認した
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
