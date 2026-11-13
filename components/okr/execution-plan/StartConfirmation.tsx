'use client';

import Link from 'next/link';
import { useState } from 'react';
import EditableField from './EditableField';
import type { EditValue } from '@/lib/stage4/planView/documentModel';
import { REGULATORY_DECISION_LABEL, regulatoryComplete, type RegulatoryDecision, type RegulatoryRecord } from '@/lib/stage4/planView/model';
import type { ProjectPlanState, PlanView } from '@/lib/stage4/planView/planState';
import type { SectionViews } from '@/lib/stage4/planView/types';

const SECTION_CARD = 'rounded-xl border border-zinc-200 bg-white p-4 shadow-sm space-y-3';
const BUTTON_PRIMARY =
  'rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40';
const INPUT = 'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px]';
const DECISIONS: RegulatoryDecision[] = ['NOT_APPLICABLE', 'APPLICABLE_PROCEDURE_CONFIRMED', 'UNCONFIRMED'];

export type StartConfirmationProps = {
  bundle: unknown;
  plan: ProjectPlanState;
  view: PlanView;
  dirty: boolean;
  actionNotice: string | null;
  onEdit: (key: string, value: EditValue | undefined) => void;
  onRegulatory: (r: RegulatoryRecord) => void;
  onStart: () => void;
  onUnstart: () => void;
  onBack: () => void;
};

/* 実行開始。利用者の操作は「この計画で実行を開始する」の1つ。採用と規制の記録は、その操作の中で行う。 */
export default function StartConfirmation({
  plan,
  view,
  dirty,
  actionNotice,
  onEdit,
  onRegulatory,
  onStart,
  onUnstart,
  onBack,
}: StartConfirmationProps) {
  const [editingOwner, setEditingOwner] = useState(false);
  const { d, responsibleConfirmed, regulatoryTasks, keyTasks } = view;
  const resp = (d.sections as unknown as SectionViews)[4].blocks[0].responsible;
  const reg = plan.regulatory;
  const setReg = (patch: Partial<RegulatoryRecord>) => onRegulatory({ ...reg, ...patch });
  const started = plan.started;
  const required = regulatoryTasks.length > 0;
  const openItems = keyTasks.filter((t) => !t.done).length;

  const blockers: string[] = [];
  if (!responsibleConfirmed) blockers.push('①で実行責任者を確定してください');
  if (!regulatoryComplete(reg, required)) {
    blockers.push(
      reg.decision === 'UNCONFIRMED'
        ? '②で「未確認」以外を選んでください（未確認のままでは開始を保留します）'
        : required
          ? '②で判断内容・判断根拠・確認者・確認日を入力してください'
          : '②で「対象外」にチェックを入れてください',
    );
  }
  if (dirty) blockers.push('修正が未保存です。「草案として保存」を押してから開始してください');
  if (!d.adoption.adoptable) blockers.push(...d.adoption.blockers);
  const ready = blockers.length === 0;

  return (
    <div className="space-y-4">
      <section className={SECTION_CARD}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[15px] font-bold text-zinc-900">この計画で実行を開始する</h3>
          <button type="button" className="text-[13px] text-zinc-600 underline" onClick={onBack}>
            計画書に戻る
          </button>
        </div>
        <p className="text-[12px] text-zinc-600">
          開始の操作で、計画案の採用と規制・安全の記録も行います。主要な実行条件は、開始を妨げません。
        </p>
        {plan.notice && <div className="rounded-lg bg-amber-50 p-3 text-[12px] text-amber-900">{plan.notice}</div>}
      </section>

      <section className={SECTION_CARD}>
        <h4 className="text-[14px] font-bold text-zinc-900">① 実行責任者</h4>
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
        <h4 className="text-[14px] font-bold text-zinc-900">② 法令・規制・安全の確認</h4>
        {required ? (
          <div className="space-y-3">
            <p className="text-[13px] text-zinc-700">計画書に規制・安全に関わる確認事項があります。判断と根拠を記録してください。</p>
            <ul className="list-disc pl-5 text-[13px] text-zinc-800">
              {regulatoryTasks.map((t) => (
                <li key={t.id}>{t.title}</li>
              ))}
            </ul>
            <fieldset className="space-y-2">
              <legend className="text-[13px] font-semibold text-zinc-800">適用の判断</legend>
              {DECISIONS.map((dec) => (
                <label key={dec} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="radio"
                    name="regulatory-decision"
                    className="h-4 w-4 shrink-0"
                    checked={reg.decision === dec}
                    onChange={() => setReg({ decision: dec })}
                  />
                  {REGULATORY_DECISION_LABEL[dec]}
                </label>
              ))}
            </fieldset>
            <label className="block space-y-1 text-[13px]">
              <span className="font-semibold text-zinc-800">判断の内容（適用なしの場合は、その理由）</span>
              <textarea value={reg.judgement} onChange={(e) => setReg({ judgement: e.target.value })} rows={2} className={INPUT} />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-1 text-[13px]">
                <span className="font-semibold text-zinc-800">確認者</span>
                <input type="text" value={reg.confirmer} onChange={(e) => setReg({ confirmer: e.target.value })} className={INPUT} />
              </label>
              <label className="block space-y-1 text-[13px]">
                <span className="font-semibold text-zinc-800">確認日</span>
                <input type="date" value={reg.confirmedOn} onChange={(e) => setReg({ confirmedOn: e.target.value })} className={INPUT} />
              </label>
            </div>
            <label className="block space-y-1 text-[13px]">
              <span className="font-semibold text-zinc-800">判断根拠（何を根拠に判断したか）</span>
              <textarea value={reg.basis} onChange={(e) => setReg({ basis: e.target.value })} rows={2} className={INPUT} />
            </label>
          </div>
        ) : (
          <label className="flex items-start gap-2 text-[13px] text-zinc-800">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0"
              checked={reg.decision === 'NOT_APPLICABLE'}
              onChange={(e) => setReg({ decision: e.target.checked ? 'NOT_APPLICABLE' : null })}
            />
            <span>規制・安全に関わる確認事項はありません（対象外として記録する）</span>
          </label>
        )}
      </section>

      {openItems > 0 && !started && (
        <section className={SECTION_CARD}>
          <p className="text-[13px] text-zinc-700">
            計画書に確認事項が {openItems} 件残っています。開始は妨げません。開始後に計画書で確認してください。
          </p>
        </section>
      )}

      <section className={SECTION_CARD}>
        {started ? (
          <div className="space-y-2">
            <div className="text-[14px] font-semibold text-emerald-700">実行中（開始済み）</div>
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
            <button type="button" className={BUTTON_PRIMARY} disabled={!ready} onClick={onStart}>
              この計画で実行を開始する
            </button>
            {!ready && (
              <ul className="list-disc pl-5 text-[12px] text-amber-800">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
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
    </div>
  );
}
