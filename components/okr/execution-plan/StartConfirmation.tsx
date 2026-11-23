'use client';

import Link from 'next/link';
import { useContext, useEffect, useId, useState } from 'react';
import type { ProjectPlanState, PlanView } from '@/lib/stage4/planView/planState';
import type { SectionViews } from '@/lib/stage4/planView/types';
import { ConsultEditingContext } from './planConsult';

const BUTTON_PRIMARY =
  'rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40';
const BUTTON_QUIET = 'rounded-lg border border-zinc-200 px-4 py-2 text-[13px] text-zinc-700 hover:bg-zinc-50';
const INPUT = 'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px]';

export type StartInput = { responsible: string };

export type StartConfirmationProps = {
  plan: ProjectPlanState;
  view: PlanView;
  /* 計画書の本文に未保存の修正がある（開始せず、計画書で保存してもらう） */
  bodyDirty: boolean;
  /* 保存されている実行責任者（未設定は空文字） */
  responsible: string;
  actionNotice: string | null;
  /* STAGE3の目標・期限・担当から、STAGE4上で変えた件数（開始は止めない。関係者への共有を促す） */
  stage3Changes?: number;
  onStart: (input: StartInput) => void;
  onBack?: () => void;
  /* 開始の処理中（二重押下を防ぐ） */
  busy?: boolean;
};

/* 実行開始の操作。実行責任者・「実行を開始する」（と、必要なら「計画書に戻る」）を出す。
 * 開始は活動の開始であり、法令・安全上の承認の完了ではない。規制・安全の確認フォームは置かない。 */
export default function StartConfirmation({ plan, view, bodyDirty, responsible, actionNotice, stage3Changes = 0, onStart, onBack, busy = false }: StartConfirmationProps) {
  const [name, setName] = useState(responsible);
  const candidates = [...new Set([...((view.d.sections as unknown as SectionViews)[4].blocks[0].responsible.candidates ?? [])])];
  const trimmed = name.trim();

  /* 実行責任者の入力が保存済みと違う間だけ、編集中の文章欄として相談文脈に知らせる（未保存扱い） */
  const reportEditing = useContext(ConsultEditingContext);
  const reportId = useId();
  const nameEdited = trimmed !== responsible.trim();
  useEffect(() => {
    if (plan.started || !nameEdited) return;
    reportEditing(reportId, { label: '実行責任者（実行開始の入力）', text: name, saved: false });
    return () => reportEditing(reportId, null);
  }, [plan.started, nameEdited, name, reportEditing, reportId]);

  const blockers: string[] = [];
  if (!trimmed) blockers.push('実行責任者を入力してください');
  if (bodyDirty) blockers.push('計画書の本文に未保存の修正があります。計画書に戻り、「計画を保存」してから開始してください');
  if (!view.d.adoption.adoptable) blockers.push(...view.d.adoption.blockers);
  const ready = blockers.length === 0;

  if (plan.started) {
    return (
      <div className="space-y-4">
        <h2 className="plan-h2">実行開始</h2>
        <p className="text-[14px] font-semibold text-success">実行を開始しました</p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/execution" className={BUTTON_PRIMARY}>
            STAGE5で進捗を確認する
          </Link>
          {onBack && (
            <button type="button" className={BUTTON_QUIET} onClick={onBack}>
              計画書に戻る
            </button>
          )}
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
        <button type="button" className={BUTTON_PRIMARY} disabled={!ready || busy} onClick={() => onStart({ responsible: trimmed })}>
          {busy ? '開始しています…' : '実行を開始する'}
        </button>
        {onBack && (
          <button type="button" className={BUTTON_QUIET} onClick={onBack}>
            計画書に戻る
          </button>
        )}
      </div>

      {!ready && (
        <ul className="list-disc pl-5 text-[12px] text-caution">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {stage3Changes > 0 && (
        <p className="rounded-lg bg-caution-soft p-3 text-[12px] text-caution">
          STAGE3の目標・期限・担当を{stage3Changes}件変更しています。全社・他部門への影響がある場合は、関係者に共有してから開始してください（STAGE3の正式な戦略は変わりません）。
        </p>
      )}
      {actionNotice && <p className="rounded-lg bg-bluegray-mist p-3 text-[12px] text-bluegray-deep">{actionNotice}</p>}
      {plan.holdNotice && <p className="rounded-lg bg-caution-soft p-3 text-[12px] text-caution">条件が欠けたため、開始を保留しました。</p>}
    </div>
  );
}
