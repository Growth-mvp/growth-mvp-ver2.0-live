'use client';

import { useEffect, useMemo, useState } from 'react';
import { SAMPLE_PLANS } from '@/lib/stage4/planView/fixtures';
import {
  INITIAL_PLAN_STATE,
  adopt,
  applyEdit,
  computePlanView,
  discardEdit,
  enterEdit,
  reconcileStart,
  setCommittedValue,
  setDraftValue,
  setRegulatory,
  startWithAdoption,
  unadopt,
  unstart,
  type ProjectPlanState,
} from '@/lib/stage4/planView/planState';
import { useCeoDrawerCloseButton } from '@/components/CeoDrawerCloseContext';
import PlanDocument from './PlanDocument';
import Stage3ReadPanel from './Stage3ReadPanel';
import StartConfirmation from './StartConfirmation';

type View = 'document' | 'start';
type Source = 'SAMPLE' | 'STAGE3';

/* 開発用の文書型実行計画書（開発環境でのみ表示される）。
 * 表示するのは保存済みの架空企業のサンプルだけ。状態はプロジェクトごとに分け、画面内に留める（保存しない）。 */
export default function DevPlanDocument() {
  const [sampleId, setSampleId] = useState<string>(SAMPLE_PLANS[0].id);
  const [states, setStates] = useState<Record<string, ProjectPlanState>>({});
  const [view, setView] = useState<View>('document');
  const [source, setSource] = useState<Source>('SAMPLE');
  useCeoDrawerCloseButton(true);

  const sample = SAMPLE_PLANS.find((s) => s.id === sampleId) ?? SAMPLE_PLANS[0];
  const plan = states[sample.id] ?? INITIAL_PLAN_STATE;
  const pv = useMemo(() => computePlanView(sample.bundle, plan), [sample.bundle, plan]);

  const update = (fn: (p: ProjectPlanState) => ProjectPlanState) =>
    setStates((prev) => ({ ...prev, [sample.id]: fn(prev[sample.id] ?? INITIAL_PLAN_STATE) }));

  useEffect(() => {
    if (!plan.started || pv.gate.startable) return;
    const id = sample.id;
    setStates((prev) => ({ ...prev, [id]: reconcileStart(prev[id] ?? INITIAL_PLAN_STATE, false) }));
  }, [plan.started, pv.gate.startable, sample.id]);

  return (
    <div className="space-y-4">
      <div role="note" className="rounded-lg border border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
        開発用の表示です。架空企業の保存済みデータを使っており、実在の計画ではありません。画面内の操作は保存されません。
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="表示する情報">
        {(
          [
            ['SAMPLE', '計画書のサンプル'],
            ['STAGE3', 'STAGE3の実プロジェクト（読み取り専用）'],
          ] as Array<[Source, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={source === id}
            onClick={() => setSource(id)}
            className={`rounded-full px-4 py-1.5 text-[13px] font-semibold ${source === id ? 'bg-zinc-900 text-white' : 'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {source === 'STAGE3' ? (
        <Stage3ReadPanel />
      ) : (
        <>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] text-zinc-700">
          <span className="whitespace-nowrap">プロジェクト選択</span>
          <select
            aria-label="プロジェクト選択"
            value={sample.id}
            onChange={(e) => setSampleId(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[13px]"
          >
            {SAMPLE_PLANS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex gap-2" role="group" aria-label="表示の切り替え">
          {(
            [
              ['document', '計画書を読む'],
              ['start', '実行開始の確認'],
            ] as Array<[View, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              onClick={() => setView(id)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-semibold ${view === id ? 'bg-zinc-900 text-white' : 'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'start' ? (
        <StartConfirmation
          key={`start-${sample.id}`}
          plan={plan}
          view={pv}
          bodyDirty={false}
          responsible={typeof plan.committed.responsible === 'string' ? plan.committed.responsible : ''}
          actionNotice={null}
          onStart={(input) =>
            update((p) => {
              const withResponsible = setCommittedValue(p, 'responsible', input.responsible || undefined);
              const withRegulatory = input.regulatory ? setRegulatory(withResponsible, input.regulatory) : withResponsible;
              return startWithAdoption(withRegulatory, sample.bundle);
            })
          }
          onBack={() => setView('document')}
        />
      ) : (
        <PlanDocument
          key={sample.id}
          bundle={sample.bundle}
          mode={plan.mode}
          committed={plan.committed}
          draft={plan.draft}
          adopted={plan.adopted}
          adoptable={pv.d.adoption.adoptable}
          blockers={pv.d.adoption.blockers}
          notice={plan.notice}
          onEnterEdit={() => update(enterEdit)}
          onApply={() => update(applyEdit)}
          onDiscard={() => update(discardEdit)}
          onDraftChange={(key, value) => update((p) => setDraftValue(p, key, value))}
          onAdopt={() => update((p) => adopt(p, pv.d.adoption.adoptable))}
          onUnadopt={() => update(unadopt)}
          onOpenStart={() => setView('start')}
        />
      )}
        </>
      )}
    </div>
  );
}
