'use client';

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
  onEdit: (key: string, value: EditValue | undefined) => void;
  onRegulatory: (r: RegulatoryRecord) => void;
  onStart: () => void;
  onUnstart: () => void;
  onBack: () => void;
};

/* 実行開始の確認。採用とは別の画面で、責任者・規制と安全・主要な実行条件を確かめる。画面内の状態のみ。 */
export default function StartConfirmation({ plan, view, onEdit, onRegulatory, onStart, onUnstart, onBack }: StartConfirmationProps) {
  const [editingOwner, setEditingOwner] = useState(false);
  const { d, gate, responsibleConfirmed, regulatoryTasks, keyTasks } = view;
  const resp = (d.sections as unknown as SectionViews)[4].blocks[0].responsible;
  const reg = plan.regulatory;
  const setReg = (patch: Partial<RegulatoryRecord>) => onRegulatory({ ...reg, ...patch });
  const started = plan.started;

  return (
    <div className="space-y-4">
      <section className={SECTION_CARD}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[15px] font-bold text-zinc-900">実行開始前の確認事項</h3>
          <button type="button" className="text-[13px] text-zinc-600 underline" onClick={onBack}>
            計画書に戻る
          </button>
        </div>
        <p className="text-[12px] text-zinc-600">
          採用とは別に、次の条件を確認します。規制・安全は、確認済みのチェックだけでは完了しません。判断内容・確認者・確認日を記録します。
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-[13px] text-zinc-700">
          <li>実行責任者と主要な実行条件を確定し、上の「草案として保存」で保存する</li>
          <li>計画書を採用する（「計画書に戻る」から行います）</li>
          <li>規制・安全の判断を記録する（保存済みの内容について行います）</li>
          <li>実行を開始する</li>
        </ol>
        {!plan.adopted && <div className="rounded-lg bg-amber-50 p-3 text-[13px] text-amber-900">まだ採用されていません。確定と保存を済ませてから、採用してください。</div>}
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
        <h4 className="text-[14px] font-bold text-zinc-900">② 法令・規制・安全の確認（必要か、適用なしか）</h4>
        <div className="space-y-3">
          {regulatoryTasks.length === 0 ? (
            <p className="text-[13px] text-zinc-700">計画書に規制・安全に関わる項目は見当たりません。該当するかを判断し、記録してください。</p>
          ) : (
            <ul className="list-disc pl-5 text-[13px] text-zinc-800">
              {regulatoryTasks.map((t) => (
                <li key={t.id}>{t.title}</li>
              ))}
            </ul>
          )}
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
            <div className={`text-[12px] ${regulatoryComplete(reg) ? 'text-emerald-700' : 'text-amber-800'}`}>
              {regulatoryComplete(reg)
                ? '規制・安全の記録が揃っています。'
                : '判断内容・判断根拠・確認者・確認日を記録すると、この項目は完了します。「未確認」の場合は開始を保留します。'}
            </div>
        </div>
      </section>

      <section className={SECTION_CARD}>
        <h4 className="text-[14px] font-bold text-zinc-900">③ 主要な実行条件</h4>
        {keyTasks.length === 0 ? (
          <div className="text-[13px] text-zinc-700">確認すべき主要な実行条件はありません。</div>
        ) : (
          <ul className="space-y-2">
            {keyTasks.map((t) => (
              <li key={t.id}>
                <label className="flex items-start gap-2 text-[13px] text-zinc-800">
                  <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={t.done} onChange={(e) => onEdit(`task:${t.id}`, e.target.checked)} />
                  <span>{t.title}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={SECTION_CARD}>
        <h4 className="text-[14px] font-bold text-zinc-900">確認の状況</h4>
        <ul className="space-y-1 text-[13px]">
          {d.start.handover.map((h) => (
            <li key={h.label} className={h.ok ? 'text-emerald-700' : 'text-zinc-600'}>
              {h.ok ? '✔' : '□'} {h.label}
            </li>
          ))}
        </ul>
        <div className="rounded-lg bg-zinc-50 p-3 text-[12px] text-zinc-600">
          実行開始は採用とは別に記録されます。この画面からSTAGE5へは引き継ぎません。
        </div>
      </section>

      <section className={SECTION_CARD}>
        <div className="flex flex-wrap items-center gap-3">
          {started && gate.startable ? (
            <span className="text-[13px] font-semibold text-emerald-700">
              実行開始済み
              <button type="button" className="ml-3 text-[12px] font-normal text-zinc-600 underline" onClick={onUnstart}>
                開始を取り消す
              </button>
            </span>
          ) : (
            <button type="button" className={BUTTON_PRIMARY} disabled={!gate.startable} onClick={onStart}>
              実行を開始する
            </button>
          )}
        </div>
        {plan.holdNotice && !started && (
          <div className="rounded-lg bg-amber-50 p-3 text-[12px] text-amber-900">
            実行開始を保留しました。条件が欠けたため、開始の状態を解除しています。条件がそろったら、改めて開始してください。
          </div>
        )}
        {!gate.startable && gate.blockers.length > 0 && (
          <ul className="list-disc pl-5 text-[12px] text-amber-800">
            {gate.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
