'use client';

import Link from 'next/link';
import { useState } from 'react';
import EditableField from './EditableField';
import type { EditValue } from '@/lib/stage4/planView/documentModel';
import {
  EMPTY_REGULATORY,
  REGULATORY_DECISION_LABEL,
  regulatoryComplete,
  regulatoryStatusOf,
  type RegulatoryDecision,
  type RegulatoryRecord,
} from '@/lib/stage4/planView/model';
import type { ProjectPlanState, PlanView } from '@/lib/stage4/planView/planState';
import type { SectionViews } from '@/lib/stage4/planView/types';

const SECTION_CARD = 'rounded-xl border border-zinc-200 bg-white p-4 shadow-sm space-y-3';
const BUTTON_PRIMARY =
  'rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40';
const BUTTON_QUIET = 'rounded-lg border border-zinc-200 px-4 py-2 text-[13px] text-zinc-700 hover:bg-zinc-50';
const INPUT = 'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px]';
const DECISIONS: RegulatoryDecision[] = ['NOT_APPLICABLE', 'APPLICABLE_PROCEDURE_CONFIRMED'];

export type StartConfirmationProps = {
  plan: ProjectPlanState;
  view: PlanView;
  dirty: boolean;
  actionNotice: string | null;
  onEdit: (key: string, value: EditValue | undefined) => void;
  /* 規制・安全の判断を画面で記録した時は、その内容を渡す（確認が不要な案件では渡さない） */
  onStart: (regulatory?: RegulatoryRecord) => void;
  onUnstart: () => void;
  onBack: () => void;
};

/* 実行開始。通常画面は、実行責任者と「この計画で実行を開始する」だけ。法令・安全の確認が必要な案件だけ、開始の前に確認を求める。 */
export default function StartConfirmation({ plan, view, dirty, actionNotice, onEdit, onStart, onUnstart, onBack }: StartConfirmationProps) {
  const [editingOwner, setEditingOwner] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<RegulatoryRecord>(EMPTY_REGULATORY);
  const { d, responsibleConfirmed, regulatoryTasks } = view;
  const resp = (d.sections as unknown as SectionViews)[4].blocks[0].responsible;
  const started = plan.started;
  const required = regulatoryTasks.length > 0;
  const reg = plan.regulatory;
  const status = regulatoryStatusOf(required, reg);

  const blockers: string[] = [];
  if (!responsibleConfirmed) blockers.push('実行責任者を確定してください');
  if (dirty) blockers.push('修正が未保存です。「草案として保存」を押してから開始してください');
  if (!d.adoption.adoptable) blockers.push(...d.adoption.blockers);
  const ready = blockers.length === 0;

  const requestStart = () => {
    if (regulatoryComplete(reg, required)) return onStart();
    setDraft({ ...reg });
    setDialogOpen(true);
  };
  const canConfirm = !required && draft.decision === 'NOT_APPLICABLE' ? true : regulatoryComplete(draft, true);
  const setDraftField = (patch: Partial<RegulatoryRecord>) => setDraft((prev) => ({ ...prev, ...patch }));

  return (
    <div className="space-y-4">
      <section className={SECTION_CARD}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[15px] font-bold text-zinc-900">この計画で実行を開始する</h3>
          <button type="button" className="text-[13px] text-zinc-600 underline" onClick={onBack}>
            計画書に戻る
          </button>
        </div>
        <p className="text-[12px] text-zinc-600">開始に必要なのは、実行責任者の確定と、保存済みの計画です。</p>
        {plan.notice && <div className="rounded-lg bg-amber-50 p-3 text-[12px] text-amber-900">{plan.notice}</div>}
      </section>

      <section className={SECTION_CARD}>
        <h4 className="text-[14px] font-bold text-zinc-900">実行責任者</h4>
        {responsibleConfirmed ? (
          <div className="text-[13px] text-emerald-700">確定済み：{resp.value}</div>
        ) : (
          <div className="space-y-2">
            <div className="text-[13px] text-zinc-700">{resp.value ? `候補：${resp.value}（確定ではありません）` : '責任者は未設定です。'}</div>
            {resp.suggestion && (
              <button type="button" className={BUTTON_PRIMARY} onClick={() => onEdit('responsible', resp.suggestion)}>
                「{resp.suggestion}」を実行責任者として確定する
              </button>
            )}
          </div>
        )}
        <EditableField
          label="別の人を入れる"
          type="owner"
          candidates={resp.candidates}
          value={responsibleConfirmed ? resp.value : null}
          original={resp.original}
          edited={resp.edited}
          editing={editingOwner}
          onStartEdit={() => setEditingOwner(true)}
          onCancel={() => setEditingOwner(false)}
          onSave={(v) => {
            onEdit('responsible', v ?? undefined);
            setEditingOwner(false);
          }}
          onRevert={() => {
            onEdit('responsible', undefined);
            setEditingOwner(false);
          }}
        />
      </section>

      <section className={SECTION_CARD}>
        {started ? (
          <div className="space-y-2">
            <div className="text-[14px] font-semibold text-emerald-700">実行中</div>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/execution" className={BUTTON_PRIMARY}>
                STAGE5で進捗を確認する
              </Link>
              <button type="button" className="text-[12px] text-zinc-600 underline" onClick={onUnstart}>
                開始を取り消す
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <button type="button" className={BUTTON_PRIMARY} disabled={!ready} onClick={requestStart}>
              この計画で実行を開始する
            </button>
            {!ready && (
              <ul className="list-disc pl-5 text-[12px] text-amber-800">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            {ready && status === 'UNDECIDED' && (
              <p className="text-[12px] text-amber-800">
                {required
                  ? '法令・規制・安全の確認が必要です。開始のボタンで、確認の内容を記録してください。'
                  : '「未確認」と記録されているため、開始を保留しています。開始のボタンで判断を記録してください。'}
              </p>
            )}
          </div>
        )}
        {actionNotice && !started && <div className="rounded-lg bg-amber-50 p-3 text-[12px] text-amber-900">{actionNotice}</div>}
        {plan.holdNotice && !started && (
          <div className="rounded-lg bg-amber-50 p-3 text-[12px] text-amber-900">
            実行開始を保留しました。条件が欠けたため、開始の状態を解除しています。条件がそろったら、改めて開始してください。
          </div>
        )}
      </section>

      {dialogOpen && !started && (
        <section role="dialog" aria-modal="true" aria-label="法令・規制・安全の確認" className={SECTION_CARD}>
          <h4 className="text-[14px] font-bold text-zinc-900">法令・規制・安全の確認</h4>
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
            <p className="text-[13px] text-zinc-700">この計画には、確認が必要な事項は見当たりません。判断を選んで記録してください。</p>
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
                onStart(draft);
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
