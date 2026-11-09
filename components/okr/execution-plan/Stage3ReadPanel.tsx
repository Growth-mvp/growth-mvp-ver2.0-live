'use client';

import { useMemo, useState } from 'react';
import { buildStage3Tree, readStage3Project, selectionKey, type Stage3ReadView, type Stage3Selection } from '@/lib/stage4/plan/stage3Read';
import {
  STAGE3_SNAPSHOT_COMPANY_LABELS,
  STAGE3_SNAPSHOT_MEMBERSHIPS,
  STAGE3_SNAPSHOT_SAVED_PLANS,
  STAGE3_SNAPSHOT_STRATEGIES,
} from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { PLAN_DOC_CSS } from './planDocStyles';
import PlanDocument from './PlanDocument';

const ROLE_LABEL: Record<string, string> = { REVENUE: '売上を伸ばす', COST: 'ムダを減らす', FUTURE: '将来の成長に備える' };
const REASON_LABEL: Record<string, string> = {
  NO_ACCESS: 'この画面を見る権限のある企業がありません。',
  COMPANY_NOT_ACCESSIBLE: 'この企業の情報は、表示の対象ではありません。',
  STRATEGY_NOT_ACCESSIBLE: 'この戦略の情報は、表示の対象ではありません。',
  PROJECT_NOT_FOUND: '選んだプロジェクトが見つかりません。一覧から選び直してください。',
  PROJECT_AMBIGUOUS: '同じ名前のプロジェクトが複数あるため、対象を特定できません。',
};
const noop = () => {};

const ymJa = (ym: string | null): string => {
  if (!ym) return '未設定';
  const m = /^(\d{4})-(\d{1,2})/.exec(ym);
  return m ? `${m[1]}年${Number(m[2])}月` : ym;
};
const targetText = (t: number | null, unit: string): string => (t === null ? '未設定' : `${t}${unit}`);
const textOrMissing = (t: string | null, missing = '未入力'): string => t ?? missing;

/* STAGE3の部門・プロジェクトを、読み取り専用で文書型に並べる。保存・生成・修正の操作は持たない。 */
export default function Stage3ReadPanel() {
  const [selected, setSelected] = useState<Stage3Selection | null>(null);
  const tree = useMemo(
    () => buildStage3Tree({ memberships: STAGE3_SNAPSHOT_MEMBERSHIPS, strategies: STAGE3_SNAPSHOT_STRATEGIES }),
    []
  );
  const view: Stage3ReadView | null = selected
    ? readStage3Project({
        memberships: STAGE3_SNAPSHOT_MEMBERSHIPS,
        strategies: STAGE3_SNAPSHOT_STRATEGIES,
        savedPlans: STAGE3_SNAPSHOT_SAVED_PLANS,
        selection: selected,
      })
    : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <style>{PLAN_DOC_CSS}</style>
      <nav aria-label="STAGE3のプロジェクト一覧" className="space-y-3 rounded-xl border border-zinc-200 bg-white p-3 text-[12px]">
        {tree.length === 0 && <p className="text-zinc-600">表示できるプロジェクトがありません。</p>}
        {tree.map((strategy) => (
          <div key={`${strategy.companyId}|${strategy.strategyId}`} className="space-y-2">
            <div className="text-[11px] font-semibold text-zinc-500">{STAGE3_SNAPSHOT_COMPANY_LABELS[strategy.companyId] ?? strategy.companyId}</div>
            {strategy.departments.map((dept) => (
              <div key={dept.departmentIndex} className="space-y-1">
                <div className="font-semibold text-zinc-800">{dept.name}</div>
                {dept.mission && <div className="text-[11px] text-zinc-500">{dept.mission}</div>}
                {dept.projects.map((p) => {
                  const key: Stage3Selection = { companyId: p.companyId, strategyId: p.strategyId, projectKey: p.projectKey };
                  const isSelected = selected !== null && selectionKey(selected) === selectionKey(key);
                  return (
                    <button
                      key={selectionKey(key)}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelected(key)}
                      className={`block w-full rounded-lg px-2 py-1.5 text-left ${isSelected ? 'bg-zinc-900 text-white' : 'border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50'}`}
                    >
                      <div className="font-semibold">{p.projectTitle}</div>
                      <div className={isSelected ? 'text-zinc-300' : 'text-zinc-500'}>{p.role ? ROLE_LABEL[p.role] ?? p.role : '役割 未設定'}</div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </nav>

      <section className="min-w-0">
        {!view && <p className="rounded-lg bg-zinc-50 p-4 text-[13px] text-zinc-700">一覧からプロジェクトを選ぶと、STAGE3の情報を表示します。</p>}
        {view && view.status === 'NO_DATA' && <p className="rounded-lg bg-amber-50 p-4 text-[13px] text-amber-900">{REASON_LABEL[view.reason] ?? '情報を表示できません。'}</p>}
        {view && view.status === 'READY' && <ReadOnlyProject key={view.key} view={view} />}
      </section>
    </div>
  );
}

function ReadOnlyProject({ view }: { view: Extract<Stage3ReadView, { status: 'READY' }> }) {
  const m = view.model;
  if (m.status !== 'READY') return null;
  const dept = m.department;
  const project = m.project;
  const kpiRows = [
    ...m.kpis.confirmed.map((k) => ({ ...k, state: '確定' })),
    ...m.kpis.unconfirmed.map((k) => ({ ...k, state: '入力済み（確定の印なし）' })),
    ...m.kpis.aiProvisional.map((k) => ({ ...k, state: 'AIの仮の目標（確定ではない）' })),
  ];
  const doc = view.document;

  return (
    <div className="plan-page">
      <article className="plan-paper" aria-label="STAGE3の情報（読み取り専用）">
        <header className="plan-paper-head">
          <div className="plan-kicker">STAGE3の情報（読み取り専用）</div>
          <h1 className="plan-title">{project.title}</h1>
          <table className="plan-basics">
            <tbody>
              <tr>
                <th>対象部門</th>
                <td>{dept.name}</td>
                <th>役割</th>
                <td>{project.role ? ROLE_LABEL[project.role] ?? project.role : '未設定'}</td>
              </tr>
              <tr>
                <th>部門のミッション</th>
                <td colSpan={3}>{textOrMissing(dept.mission)}</td>
              </tr>
            </tbody>
          </table>
          <p className="plan-company">{STAGE3_SNAPSHOT_COMPANY_LABELS[m.scope.companyId] ?? m.scope.companyId}</p>
        </header>

        <section className="plan-section">
          <h2 className="plan-h2">
            <span className="plan-no">1</span> 目的・背景
          </h2>
          <h3 className="plan-h3">目的</h3>
          <p className="plan-p">{textOrMissing(project.objective, '未入力（STAGE3で目的が入力されていません）')}</p>
          <h3 className="plan-h3">取り組む理由</h3>
          <p className="plan-p">{textOrMissing(project.rationale)}</p>
          <h3 className="plan-h3">仮説</h3>
          <p className="plan-p">{textOrMissing(project.hypothesis)}</p>
          <h3 className="plan-h3">部門の戦略</h3>
          <p className="plan-p">{textOrMissing(dept.strategy)}</p>
          {dept.missionDescription && (
            <>
              <h3 className="plan-h3">ミッションの説明</h3>
              <p className="plan-p">{dept.missionDescription}</p>
            </>
          )}
        </section>

        <section className="plan-section">
          <h2 className="plan-h2">
            <span className="plan-no">2</span> 目標・KPI
          </h2>
          {kpiRows.length === 0 ? (
            <p className="plan-p">このプロジェクトの既存のKPIはありません。</p>
          ) : (
            <table className="plan-table plan-kpi-table">
              <thead>
                <tr>
                  <th>指標</th>
                  <th>目標</th>
                  <th>期限</th>
                  <th>担当</th>
                  <th>状態</th>
                </tr>
              </thead>
              <tbody>
                {kpiRows.map((k, i) => (
                  <tr key={`${k.state}-${i}-${k.label}`} className={k.state === '確定' ? 'plan-kpi-confirmed' : undefined}>
                    <td>{k.label}</td>
                    <td>{targetText(k.target, k.unit)}</td>
                    <td>{ymJa(k.due)}</td>
                    <td>{textOrMissing(k.owner, '未設定')}</td>
                    <td>
                      <span className="plan-tag">{k.state}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="plan-note">確定したKPIは、この画面からは変更できません（STAGE3で変更します）。</p>
        </section>

        <section className="plan-section">
          <h2 className="plan-h2">
            <span className="plan-no">3</span> 実行計画
          </h2>
          {doc.kind === 'NO_PLAN' && (
            <p className="plan-p">このプロジェクトの実行計画はまだありません。STAGE3の情報だけを表示しています。</p>
          )}
          {doc.kind === 'SAVED_PLAN' && (
            <p className="plan-note">保存された計画（{ymJa(doc.savedAt.slice(0, 7))}に保存）を、読み取り専用で表示しています。</p>
          )}
          {doc.kind === 'SAVED_PLAN' && doc.kpiChanged && (
            <p className="plan-note">保存後に、KPIの目標が変わっています。計画は自動では作り直しません。</p>
          )}
        </section>
      </article>

      {doc.kind === 'SAVED_PLAN' && (
        <PlanDocument
          bundle={doc.plan}
          readOnly
          mode="read"
          committed={{}}
          draft={{}}
          adopted={false}
          adoptable={false}
          blockers={[]}
          notice={null}
          onEnterEdit={noop}
          onApply={noop}
          onDiscard={noop}
          onDraftChange={noop}
          onAdopt={noop}
          onUnadopt={noop}
          onOpenStart={noop}
        />
      )}
    </div>
  );
}
