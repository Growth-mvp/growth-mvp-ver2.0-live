'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  EMPTY_REGULATORY,
  REGULATORY_DECISION_LABEL,
  regulatoryComplete,
  type RegulatoryDecision,
  type RegulatoryRecord,
} from '@/lib/stage4/planView/model';
import type { ProjectPlanState, PlanView } from '@/lib/stage4/planView/planState';
import type { SectionViews } from '@/lib/stage4/planView/types';

const BUTTON_PRIMARY =
  'rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40';
const BUTTON_QUIET = 'rounded-lg border border-zinc-200 px-4 py-2 text-[13px] text-zinc-700 hover:bg-zinc-50';
const INPUT = 'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px]';
const DECISIONS: RegulatoryDecision[] = ['NOT_APPLICABLE', 'APPLICABLE_PROCEDURE_CONFIRMED'];

export type StartInput = { responsible: string; regulatory?: RegulatoryRecord };

export type StartConfirmationProps = {
  plan: ProjectPlanState;
  view: PlanView;
  /* 計画書の本文に未保存の修正がある（開始せず、計画書で保存してもらう） */
  bodyDirty: boolean;
  /* 保存されている実行責任者（未設定は空文字） */
  responsible: string;
  actionNotice: string | null;
  onStart: (input: StartInput) => void;
  onBack: () => void;
};

/* 実行開始の画面。見出し・実行責任者・「実行を開始する」・「計画書に戻る」だけを出す。
 * 法令・安全の確認は、確認が必要と明示された案件だけ、開始の前に確認ダイアログで求める。 */
export default function StartConfirmation({ plan, view, bodyDirty, responsible, actionNotice, onStart, onBack }: StartConfirmationProps) {
  const [name, setName] = useState(responsible);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<RegulatoryRecord>(EMPTY_REGULATORY);
  const { d, regulatoryTasks } = view;
  const candidates = [...new Set([...((d.sections as unknown as SectionViews)[4].blocks[0].responsible.candidates ?? [])])];
  const required = regulatoryTasks.length > 0;
  const reg = plan.regulatory;
  const trimmed = name.trim();

  const blockers: string[] = [];
  if (!trimmed) blockers.push('実行責任者を入力してください');
  if (bodyDirty) blockers.push('計画書の本文に未保存の修正があります。計画書に戻り、「草案として保存」してから開始してください');
  if (!d.adoption.adoptable) blockers.push(...d.adoption.blockers);
  const ready = blockers.length === 0;

  const requestStart = () => {
    if (regulatoryComplete(reg, required)) return onStart({ responsible: trimmed });
    setDraft({ ...reg });
    setDialogOpen(true);
  };
  const canConfirm = !required && draft.decision === 'NOT_APPLICABLE' ? true : regulatoryComplete(draft, true);
  const setDraftField = (patch: Partial<RegulatoryRecord>) => setDraft((prev) => ({ ...prev, ...patch }));

  if (plan.started) {
    return (
      <div className="space-y-4">
        <h2 className="plan-h2">実行開始</h2>
        <p className="text-[14px] font-semibold text-emerald-700">実行を開始しました</p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/execution" className={BUTTON_PRIMARY}>
            STAGE5で進捗を確認する
          </Link>
          <button type="button" className={BUTTON_QUIET} onClick={onBack}>
            計画書に戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="plan-h2">実行開始</h2>

      <label className="block space-y-1 text-[13px]">
        <span className="font-semibold text-zinc-800">実行責任者</span>
        <input
          type="text"
          list="start-responsible-candidates"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="実行責任者の名前"
          className={INPUT}
        />
        <datalist id="start-responsible-candidates">
          {candidates.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={BUTTON_PRIMARY} disabled={!ready} onClick={requestStart}>
          実行を開始する
        </button>
        <button type="button" className={BUTTON_QUIET} onClick={onBack}>
          計画書に戻る
        </button>
      </div>

      {!ready && (
        <ul className="list-disc pl-5 text-[12px] text-amber-800">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {actionNotice && <p className="rounded-lg bg-amber-50 p-3 text-[12px] text-amber-900">{actionNotice}</p>}
      {plan.holdNotice && <p className="rounded-lg bg-amber-50 p-3 text-[12px] text-amber-900">条件が欠けたため、開始を保留しました。</p>}

      {dialogOpen && (
        <section role="dialog" aria-modal="true" aria-label="法令・規制・安全の確認" className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h3 className="text-[14px] font-bold text-zinc-900">法令・規制・安全の確認</h3>
          {required ? (
            <>
              <p className="text-[13px] text-zinc-700">この計画には、開始の前に確認が必要な事項があります。</p>
              <ul className="list-disc pl-5 text-[13px] text-zinc-800">
                {regulatoryTasks.map((t) => (
                  <li key={t.id}>{t.title}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[13px] text-zinc-700">法令・安全の判断が「未確認」のままです。判断を記録してから開始してください。</p>
          )}
          <fieldset className="space-y-2">
            <legend className="text-[13px] font-semibold text-zinc-800">適用の判断</legend>
            {DECISIONS.map((dec) => (
              <label key={dec} className="flex items-center gap-2 text-[13px]">
                <input
                  type="radio"
                  name="regulatory-decision-dialog"
                  className="h-4 w-4 shrink-0"
                  checked={draft.decision === dec}
                  onChange={() => setDraftField({ decision: dec })}
                />
                {REGULATORY_DECISION_LABEL[dec]}
              </label>
            ))}
          </fieldset>
          <label className="block space-y-1 text-[13px]">
            <span className="font-semibold text-zinc-800">判断の内容（適用なしの場合は、その理由）</span>
            <textarea value={draft.judgement} onChange={(e) => setDraftField({ judgement: e.target.value })} rows={2} className={INPUT} />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1 text-[13px]">
              <span className="font-semibold text-zinc-800">確認者</span>
              <input type="text" value={draft.confirmer} onChange={(e) => setDraftField({ confirmer: e.target.value })} className={INPUT} />
            </label>
            <label className="block space-y-1 text-[13px]">
              <span className="font-semibold text-zinc-800">確認日</span>
              <input type="date" value={draft.confirmedOn} onChange={(e) => setDraftField({ confirmedOn: e.target.value })} className={INPUT} />
            </label>
          </div>
          <label className="block space-y-1 text-[13px]">
            <span className="font-semibold text-zinc-800">判断根拠（何を根拠に判断したか）</span>
            <textarea value={draft.basis} onChange={(e) => setDraftField({ basis: e.target.value })} rows={2} className={INPUT} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={BUTTON_PRIMARY}
              disabled={!canConfirm}
              onClick={() => {
                setDialogOpen(false);
                onStart({ responsible: trimmed, regulatory: draft });
              }}
            >
              確認して開始する
            </button>
            <button type="button" className={BUTTON_QUIET} onClick={() => setDialogOpen(false)}>
              戻る
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
