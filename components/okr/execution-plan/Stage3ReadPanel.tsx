'use client';

import { useMemo, useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import {
  buildStage3Tree,
  pickPlanStrategyFields,
  readStage3Project,
  selectionKey,
  stage3SourceFromScope,
  type Stage3ReadView,
  type Stage3Selection,
  type Stage3Source,
} from '@/lib/stage4/plan/stage3Read';
import type { SavedPlanRecord } from '@/lib/stage4/plan/readModel';
import { generateMockExecutionPlan } from '@/lib/stage4/plan/mockGenerate';
import type { PlanIssue } from '@/lib/stage4/plan/types';
import {
  INITIAL_PLAN_STATE,
  applyEdit,
  computePlanView,
  discardEdit,
  enterEdit,
  setDraftValue,
  type ProjectPlanState,
} from '@/lib/stage4/planView/planState';
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
const STATUS_LABEL: Record<Exclude<Stage3Source['status'], 'READY'>, string> = {
  LOADING: 'STAGE3の情報を読み込んでいます。',
  SCOPE_MISMATCH: '表示中の企業と、STAGE3の情報の企業が一致しません。画面を読み込み直してください。',
  NO_STRATEGY: '表示できる戦略がまだありません。',
};
const NO_SAVED_PLANS: SavedPlanRecord[] = [];
const noop = () => {};

type Generated =
  | { status: 'BUSY' }
  | { status: 'FAILED'; issues: PlanIssue[] }
  | { status: 'READY'; bundle: Record<string, unknown>; stableId: boolean };

const ymJa = (ym: string | null): string => {
  if (!ym) return '未設定';
  const m = /^(\d{4})-(\d{1,2})/.exec(ym);
  return m ? `${m[1]}年${Number(m[2])}月` : ym;
};
const targetText = (t: number | null, unit: string): string => (t === null ? '未設定' : `${t}${unit}`);
const textOrMissing = (t: string | null, missing = '未入力'): string => t ?? missing;
const currentYm = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/* 現在の会社の戦略（ストア）を、文書型に並べる。保存はしない。AI作成はモックで、結果は画面の中だけに置く。
 * 会社・戦略が変わると、表示の状態ごと作り直す（前の選択や作成結果を残さない）。 */
export default function Stage3ReadPanel() {
  const storeCompanyId = useStrategyStore((s: any) => (s.companyId ?? null) as string | null);
  const storeStrategyId = useStrategyStore((s: any) => (s.strategyId ?? null) as string | null);
  const storeDepartments = useStrategyStore((s: any) => s.departments as unknown);
  const storeCompanyName = useStrategyStore((s: any) => (s.companyName ?? null) as string | null);
  const storeHydrated = useStrategyStore((s: any) => s.hydrated === true);
  const storeRestoreReady = useStrategyStore((s: any) => s.restoreReady === true);
  const storeIsRestoring = useStrategyStore((s: any) => s.isRestoring === true);
  const storePendingCompanyId = useStrategyStore((s: any) => (s.pendingCompanyId ?? null) as string | null);
  const storeState = useStrategyStore((s: any) => s) as Record<string, unknown>;
  const storeStrategyFields = useMemo(() => pickPlanStrategyFields(storeState), [storeState]);
  const userCompanyId = useUserStore((s) => s.companyId);
  const userRole = useUserStore((s) => s.role);

  const source = useMemo(
    () =>
      stage3SourceFromScope({
        storeCompanyId,
        storeStrategyId,
        storeDepartments,
        storeStrategyFields,
        storeCompanyName,
        storeHydrated,
        storeRestoreReady,
        storeIsRestoring,
        storePendingCompanyId,
        userCompanyId,
        userRole,
      }),
    [
      storeCompanyId,
      storeStrategyId,
      storeDepartments,
      storeStrategyFields,
      storeCompanyName,
      storeHydrated,
      storeRestoreReady,
      storeIsRestoring,
      storePendingCompanyId,
      userCompanyId,
      userRole,
    ]
  );

  if (source.status !== 'READY') {
    return (
      <p role="status" className="rounded-lg bg-zinc-50 p-4 text-[13px] text-zinc-700">
        {STATUS_LABEL[source.status]}
      </p>
    );
  }
  return <Stage3ProjectBrowser key={`${storeCompanyId}|${storeStrategyId}`} source={source} />;
}

function Stage3ProjectBrowser({ source }: { source: Extract<Stage3Source, { status: 'READY' }> }) {
  const [selected, setSelected] = useState<Stage3Selection | null>(null);
  const [generated, setGenerated] = useState<Record<string, Generated>>({});
  const [planStates, setPlanStates] = useState<Record<string, ProjectPlanState>>({});
  const tree = useMemo(() => buildStage3Tree({ memberships: source.memberships, strategies: source.strategies }), [source]);
  const companyId = source.strategies[0]?.company_id ?? '';
  const companyLabel = source.companyLabels[companyId] ?? '企業名未設定';
  const view: Stage3ReadView | null = selected
    ? readStage3Project({
        memberships: source.memberships,
        strategies: source.strategies,
        savedPlans: NO_SAVED_PLANS,
        selection: selected,
      })
    : null;

  const key = selected ? selectionKey(selected) : null;
  const gen = key ? generated[key] : undefined;
  const planState = (key && planStates[key]) || INITIAL_PLAN_STATE;
  const planView = gen?.status === 'READY' ? computePlanView(gen.bundle, planState) : null;

  const createPlan = (sel: Stage3Selection) => {
    const id = selectionKey(sel);
    const stableId = sel.projectKey.startsWith('id:');
    const requestedProjectId = stableId ? sel.projectKey.slice(3) : `session:${sel.projectKey}`;
    setGenerated((prev) => ({ ...prev, [id]: { status: 'BUSY' } }));
    generateMockExecutionPlan({
      strategy: source.planStrategy,
      membershipCompanyId: source.memberships[0]?.company_id ?? '',
      requestedStrategyId: sel.strategyId,
      requestedProjectId,
      currentYm: currentYm(),
      companyName: companyLabel,
      createdAt: new Date().toISOString(),
    }).then((r) => {
      setGenerated((prev) => ({
        ...prev,
        [id]: r.status === 'READY' ? { status: 'READY', bundle: r.bundle, stableId } : { status: 'FAILED', issues: r.issues },
      }));
      setPlanStates((prev) => ({ ...prev, [id]: INITIAL_PLAN_STATE }));
    });
  };

  const updatePlan = (fn: (p: ProjectPlanState) => ProjectPlanState) => {
    if (!key) return;
    setPlanStates((prev) => ({ ...prev, [key]: fn(prev[key] ?? INITIAL_PLAN_STATE) }));
  };

  return (
    <div className="space-y-4">
      <style>{PLAN_DOC_CSS}</style>
      <section aria-label="表示するプロジェクトの選択" className="rounded-xl border border-zinc-200 bg-white p-3">
        <p className="text-[12px] font-semibold text-zinc-500">企業：{companyLabel}</p>
        {tree.length === 0 && <p className="mt-2 text-[13px] text-zinc-600">表示できるプロジェクトがありません。</p>}
        <nav aria-label="STAGE3のプロジェクト一覧" className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tree.flatMap((strategy) =>
            strategy.departments.map((dept) => (
              <div key={`${strategy.strategyId}|${dept.departmentIndex}`} className="rounded-lg border border-zinc-200 p-3 text-[12px]">
                <div className="text-[11px] font-semibold text-zinc-500">部門</div>
                <div className="font-semibold text-zinc-900">{dept.name}</div>
                {dept.mission && <div className="mt-0.5 text-[11px] text-zinc-500">{dept.mission}</div>}
                <div className="mt-2 text-[11px] font-semibold text-zinc-500">プロジェクト</div>
                <div className="mt-1 flex flex-col gap-1.5">
                  {dept.projects.map((p) => {
                    const sel: Stage3Selection = { companyId: p.companyId, strategyId: p.strategyId, projectKey: p.projectKey };
                    const isSelected = selected !== null && selectionKey(selected) === selectionKey(sel);
                    return (
                      <button
                        key={`${p.projectKey}|${p.departmentIndex}`}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setSelected(sel)}
                        className={`block w-full rounded-lg px-2 py-1.5 text-left ${isSelected ? 'bg-zinc-900 text-white' : 'border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50'}`}
                      >
                        <div className="font-semibold">{p.projectTitle}</div>
                        <div className={isSelected ? 'text-zinc-300' : 'text-zinc-500'}>{p.role ? ROLE_LABEL[p.role] ?? p.role : '役割 未設定'}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </nav>
      </section>

      <section className="min-w-0">
        {!view && <p className="rounded-lg bg-zinc-50 p-4 text-[13px] text-zinc-700">上の一覧からプロジェクトを選ぶと、STAGE3の情報を表示します。</p>}
        {view && view.status === 'NO_DATA' && <p className="rounded-lg bg-amber-50 p-4 text-[13px] text-amber-900">{REASON_LABEL[view.reason] ?? '情報を表示できません。'}</p>}
        {view && view.status === 'READY' && (
          <ReadOnlyProject
            key={view.key}
            view={view}
            companyLabel={companyLabel}
            gen={gen}
            onCreate={() => selected && createPlan(selected)}
            planState={planState}
            planView={planView}
            onUpdate={updatePlan}
          />
        )}
      </section>
    </div>
  );
}

function ReadOnlyProject({
  view,
  companyLabel,
  gen,
  onCreate,
  planState,
  planView,
  onUpdate,
}: {
  view: Extract<Stage3ReadView, { status: 'READY' }>;
  companyLabel: string;
  gen: Generated | undefined;
  onCreate: () => void;
  planState: ProjectPlanState;
  planView: ReturnType<typeof computePlanView> | null;
  onUpdate: (fn: (p: ProjectPlanState) => ProjectPlanState) => void;
}) {
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
  const errors = gen?.status === 'FAILED' ? gen.issues.filter((i) => i.severity === 'error') : [];

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
          <p className="plan-company">{companyLabel}</p>
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
          {doc.kind === 'NO_PLAN' && !gen && <p className="plan-p">実行計画書はまだ作成されていません。</p>}
          {doc.kind === 'NO_PLAN' && gen?.status === 'BUSY' && <p className="plan-p">作成しています（モック）…</p>}
          {doc.kind === 'NO_PLAN' && gen?.status === 'FAILED' && (
            <>
              <p className="plan-p">実行計画書を作れませんでした。</p>
              {errors.length > 0 && (
                <ul className="plan-list">
                  {errors.map((e) => (
                    <li key={`${e.code}-${e.message}`}>{e.message}</li>
                  ))}
                </ul>
              )}
            </>
          )}
          {doc.kind === 'NO_PLAN' && (!gen || gen.status === 'FAILED') && (
            <button type="button" className="plan-btn-primary" onClick={onCreate}>
              {gen?.status === 'FAILED' ? 'もう一度作る（モック）' : 'AIで実行計画書を作る（モック）'}
            </button>
          )}
          {doc.kind === 'NO_PLAN' && gen?.status === 'READY' && (
            <p className="plan-note">AIの草案（モック）を、下に表示しています。実際のAIは接続していません。</p>
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

      {doc.kind === 'NO_PLAN' && gen?.status === 'READY' && planView && (
        <div>
          <p className="plan-note">
            この文書は、画面の中でだけ修正できます。保存されません。
            {!gen.stableId && 'このプロジェクトには安定IDがないため、保存できるようになるまで、この文書は画面を閉じると消えます。'}
          </p>
          <PlanDocument
            bundle={gen.bundle}
            mode={planState.mode}
            committed={planState.committed}
            draft={planState.draft}
            adopted={planState.adopted}
            adoptable={planView.d.adoption.adoptable}
            blockers={planView.d.adoption.blockers}
            notice={planState.notice}
            showAdoption={false}
            onEnterEdit={() => onUpdate(enterEdit)}
            onApply={() => onUpdate(applyEdit)}
            onDiscard={() => onUpdate(discardEdit)}
            onDraftChange={(k, v) => onUpdate((p) => setDraftValue(p, k, v))}
            onAdopt={noop}
            onUnadopt={noop}
            onOpenStart={noop}
          />
        </div>
      )}
    </div>
  );
}
