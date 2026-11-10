'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { ensureStableProjectId, withProjectId } from '@/lib/stage4/plan/planClient';
import { persistDraft } from '@/lib/stage4/plan/persistDraft';
import { resolveUserEdits } from '@/lib/stage4/plan/mergeUserEdits';
import type { PlanDocActor, PlanDocKey } from '@/lib/stage4/plan/planDocumentStore';
import {
  adopt,
  applyEdit,
  computePlanView,
  discardEdit,
  enterEdit,
  reconcileStart,
  setCommittedValue,
  setDraftValue,
  setRegulatory,
  start,
  unadopt,
  unstart,
  type ProjectPlanState,
} from '@/lib/stage4/planView/planState';
import { PLAN_DOC_CSS } from './planDocStyles';
import PlanDocument from './PlanDocument';
import StartConfirmation from './StartConfirmation';
import { currentPlanStoreKind, identityApiFor, planStoreFor, remotePlanOps } from './planStores';
import { REGULATORY_DECISION_LABEL } from '@/lib/stage4/planView/model';
import {
  EVENT_LABEL,
  conflictRows,
  entryAfterPersist,
  entryAfterTransition,
  entryFromDraft,
  entryFromRecord,
  isDirty,
  toEdits,
  type PlanDocEntry,
  type ServerState,
} from './planDocEntry';

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

type GenState = { status: 'BUSY' } | { status: 'FAILED'; issues: PlanIssue[] };
type LoadState =
  | { status: 'LOADING' }
  | { status: 'DONE' }
  | { status: 'FAILED'; message: string }
  | { status: 'UNAVAILABLE'; message: string }
  | { status: 'DENIED' };

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
const newStableId = (): string => {
  const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};
const POSITION = /^d(\d+)-p(\d+)$/;

/* 現在の会社の戦略（ストア）を、文書型に並べる。保存は草案の記録だけで、STAGE3の戦略・KPI・okrsV2は変えない。
 * 会社・戦略が変わると、表示の状態ごと作り直す（前の選択や作成・保存の状態を残さない）。 */
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
  const userId = useUserStore((s) => s.user?.id ?? '');

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
  return <Stage3ProjectBrowser key={`${storeCompanyId}|${storeStrategyId}`} source={source} userId={userId} />;
}

function Stage3ProjectBrowser({ source, userId }: { source: Extract<Stage3Source, { status: 'READY' }>; userId: string }) {
  const kind = currentPlanStoreKind();
  const store = planStoreFor(kind);
  const identityApi = identityApiFor(kind);
  const ops = kind === 'remote' ? remotePlanOps() : null;
  const actor: PlanDocActor = useMemo(
    () => ({ userId, memberships: source.memberships.map((m) => ({ companyId: m.company_id, role: m.role })) }),
    [userId, source.memberships]
  );
  const [selected, setSelected] = useState<Stage3Selection | null>(null);
  const [entries, setEntries] = useState<Record<string, PlanDocEntry>>({});
  const [loads, setLoads] = useState<Record<string, LoadState>>({});
  const [gen, setGen] = useState<Record<string, GenState>>({});
  const tree = useMemo(() => buildStage3Tree({ memberships: source.memberships, strategies: source.strategies }), [source]);
  const companyId = source.strategies[0]?.company_id ?? '';
  const strategyId = source.strategies[0]?.id ?? '';
  const companyLabel = source.companyLabels[companyId] ?? '企業名未設定';
  const view: Stage3ReadView | null = selected
    ? readStage3Project({
        memberships: source.memberships,
        strategies: source.strategies,
        savedPlans: NO_SAVED_PLANS,
        selection: selected,
      })
    : null;

  const titleOf = (projectKey: string): string | null => {
    for (const s of tree) for (const d of s.departments) for (const p of d.projects) if (p.projectKey === projectKey) return p.projectTitle;
    return null;
  };
  const keyOf = (sel: Stage3Selection): PlanDocKey | null =>
    sel.projectKey.startsWith('id:') ? { companyId: sel.companyId, strategyId: sel.strategyId, projectId: sel.projectKey.slice(3) } : null;

  const loadKey = selected && selectionKey(selected);
  useEffect(() => {
    if (!selected || !loadKey || loads[loadKey] || entries[loadKey]) return;
    const key = keyOf(selected);
    if (!key) return;
    setLoads((p) => ({ ...p, [loadKey]: { status: 'LOADING' } }));
    store.load(actor, key).then((out) => {
      if (out.status === 'FOUND') {
        setEntries((p) => ({ ...p, [loadKey]: entryFromRecord(out.record) }));
        setLoads((p) => ({ ...p, [loadKey]: { status: 'DONE' } }));
      } else if (out.status === 'NONE' || out.status === 'DISABLED') setLoads((p) => ({ ...p, [loadKey]: { status: 'DONE' } }));
      else if (out.status === 'DENIED') setLoads((p) => ({ ...p, [loadKey]: { status: 'DENIED' } }));
      else if (out.status === 'UNAVAILABLE') setLoads((p) => ({ ...p, [loadKey]: { status: 'UNAVAILABLE', message: out.message } }));
      else setLoads((p) => ({ ...p, [loadKey]: { status: 'FAILED', message: out.message } }));
    });
    // 読み込みは選択が変わったときだけ行う（作成・保存の結果は画面の状態に残す）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey, actor]);

  const remoteIssue = (message: string): PlanIssue => ({ severity: 'error', code: 'REMOTE', path: '$', message });

  /* 作成（API）：作成の記録を置くために、番号が無ければ先に付与する（この操作のあと、サーバーが草案を作る） */
  const createRemote = async (sel: Stage3Selection) => {
    if (!ops) return;
    let targetId = selectionKey(sel);
    setGen((prev) => ({ ...prev, [targetId]: { status: 'BUSY' } }));
    const failWith = (id: string, message: string) => setGen((prev) => ({ ...prev, [id]: { status: 'FAILED', issues: [remoteIssue(message)] } }));
    let projectId = sel.projectKey.startsWith('id:') ? sel.projectKey.slice(3) : null;
    if (!projectId) {
      const pos = POSITION.exec(sel.projectKey);
      const title = titleOf(sel.projectKey);
      if (!pos || title === null) return failWith(targetId, 'プロジェクトを特定できないため、作成できませんでした。一覧を読み直してください。');
      const ensured = await ensureStableProjectId(identityApi, {
        companyId: sel.companyId,
        strategyId: sel.strategyId,
        departmentIndex: Number(pos[1]),
        projectIndex: Number(pos[2]),
        expectedTitle: title,
        newId: newStableId(),
      });
      if (!ensured.ok) return failWith(targetId, ensured.message);
      projectId = ensured.projectId;
      const current = useStrategyStore.getState() as unknown as { departments: unknown };
      useStrategyStore.setState({ departments: withProjectId(current.departments, Number(pos[1]), Number(pos[2]), projectId) } as never);
      const movedSel: Stage3Selection = { ...sel, projectKey: `id:${projectId}` };
      targetId = selectionKey(movedSel);
      setSelected(movedSel);
      setGen((prev) => ({ ...prev, [targetId]: { status: 'BUSY' } }));
    }
    const out = await ops.generate({ companyId: sel.companyId, strategyId: sel.strategyId, projectId });
    if (out.status === 'CREATED' || out.status === 'EXISTS') {
      setEntries((p) => ({ ...p, [targetId]: entryFromRecord(out.record) }));
      setGen((prev) => {
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
      return;
    }
    if (out.status === 'INVALID') {
      return setGen((prev) => ({ ...prev, [targetId]: { status: 'FAILED', issues: out.messages.map(remoteIssue) } }));
    }
    if (out.status === 'MODEL_FAILED') return failWith(targetId, out.message);
    if (out.status === 'IN_PROGRESS') return failWith(targetId, '他の人がこの計画を作成中です。しばらくしてから開いてください。');
    if (out.status === 'DISABLED') return failWith(targetId, '実行計画書の作成は現在利用できません。');
    if (out.status === 'DENIED') return failWith(targetId, 'この計画を作成する権限がありません。');
    return failWith(targetId, '草案を作れませんでした。もう一度お試しください。');
  };

  /* 採用・規制の記録・開始・取り消し（API）：保存されていない修正があれば、先に保存してもらう */
  const transitionRemote = async (sel: Stage3Selection, action: 'ADOPT' | 'UNADOPT' | 'RECORD_REGULATORY' | 'START' | 'UNSTART', regulatory?: unknown) => {
    const id = selectionKey(sel);
    const entry = entries[id];
    const key = keyOf(sel);
    if (!ops || !entry || !key || !entry.stored) return;
    const note = (message: string) => updateEntry(id, (e) => ({ ...e, notice: message }));
    if (isDirty(entry) && (action === 'ADOPT' || action === 'START' || action === 'RECORD_REGULATORY')) {
      return note('修正を草案として保存してから、操作してください。');
    }
    const out = await ops.transition(key, entry.stored.version, action, regulatory);
    if (out.status === 'OK') return setEntries((p) => (p[id] ? { ...p, [id]: entryAfterTransition(p[id], out.record) } : p));
    if (out.status === 'CONFLICT') {
      return setEntries((p) => (p[id] ? { ...p, [id]: { ...entryFromRecord(out.current), notice: '他の人が先に変更しました。最新の内容を表示しています。' } } : p));
    }
    if (out.status === 'BLOCKED') return note(`まだ実行できません：${out.blockers.join('、')}`);
    if (out.status === 'INVALID') return note(out.message);
    return note('操作を記録できませんでした。画面を読み直してから、もう一度お試しください。');
  };

  const createPlan = (sel: Stage3Selection) => {
    if (ops) return void createRemote(sel);
    const id = selectionKey(sel);
    const stableId = sel.projectKey.startsWith('id:');
    const requestedProjectId = stableId ? sel.projectKey.slice(3) : `session:${sel.projectKey}`;
    setGen((prev) => ({ ...prev, [id]: { status: 'BUSY' } }));
    generateMockExecutionPlan({
      strategy: source.planStrategy,
      membershipCompanyId: source.memberships[0]?.company_id ?? '',
      requestedStrategyId: sel.strategyId,
      requestedProjectId,
      currentYm: currentYm(),
      companyName: companyLabel,
      createdAt: new Date().toISOString(),
    }).then((r) => {
      if (r.status === 'READY') {
        setEntries((p) => (p[id] ? p : { ...p, [id]: entryFromDraft(r.bundle) }));
        setGen((p) => {
          const next = { ...p };
          delete next[id];
          return next;
        });
      } else {
        setGen((p) => ({ ...p, [id]: { status: 'FAILED', issues: r.issues } }));
      }
    });
  };

  const updateEntry = (id: string, fn: (e: PlanDocEntry) => PlanDocEntry) =>
    setEntries((p) => (p[id] ? { ...p, [id]: fn(p[id]) } : p));
  const updatePlan = (id: string, fn: (p: ProjectPlanState) => ProjectPlanState) =>
    updateEntry(id, (e) => ({ ...e, plan: fn(e.plan) }));

  /* 保存：IDのないプロジェクトは、ここで一度だけ既存の戦略保存（競合制御つき）で ID を付ける */
  const save = async (sel: Stage3Selection) => {
    const id = selectionKey(sel);
    const entry = entries[id];
    if (!entry) return;
    updateEntry(id, (e) => ({ ...e, save: { status: 'SAVING' } }));
    const fail = (message: string) => updateEntry(id, (e) => ({ ...e, save: { status: 'FAILED', message } }));

    let projectId = sel.projectKey.startsWith('id:') ? sel.projectKey.slice(3) : null;
    let targetId = id;
    if (!projectId) {
      const pos = POSITION.exec(sel.projectKey);
      const title = titleOf(sel.projectKey);
      if (!pos || title === null) return fail('プロジェクトを特定できないため、保存できませんでした。一覧を読み直してください。');
      const ensured = await ensureStableProjectId(identityApi, {
        companyId: sel.companyId,
        strategyId: sel.strategyId,
        departmentIndex: Number(pos[1]),
        projectIndex: Number(pos[2]),
        expectedTitle: title,
        newId: newStableId(),
      });
      if (!ensured.ok) return fail(ensured.message);
      projectId = ensured.projectId;
      const current = useStrategyStore.getState() as unknown as { departments: unknown };
      useStrategyStore.setState({ departments: withProjectId(current.departments, Number(pos[1]), Number(pos[2]), projectId) } as never);
      const movedSel: Stage3Selection = { ...sel, projectKey: `id:${projectId}` };
      targetId = selectionKey(movedSel);
      setSelected(movedSel);
      setEntries((p) => {
        const next = { ...p, [targetId]: { ...entry, save: { status: 'SAVING' as const } } };
        delete next[id];
        return next;
      });
    }

    const result = await persistDraft({
      store,
      actor,
      key: { companyId: sel.companyId, strategyId: sel.strategyId, projectId: projectId as string },
      aiDraft: entry.aiDraft,
      local: entry.plan.committed,
      adopted: entry.plan.adopted,
      stored: entry.stored,
    });
    setEntries((p) => (p[targetId] ? { ...p, [targetId]: entryAfterPersist(p[targetId], result) } : p));
  };

  /* 競合の解決：項目ごとに選んだ内容で、最新の版に保存し直す */
  const saveResolved = async (sel: Stage3Selection) => {
    const id = selectionKey(sel);
    const entry = entries[id];
    if (!entry || entry.save.status !== 'CONFLICT' || !keyOf(sel)) return;
    const c = entry.save;
    const unresolved = c.conflicts.filter((k) => !c.picks[k]);
    if (unresolved.length > 0) return;
    const resolved = resolveUserEdits({ base: entry.stored?.base ?? {}, local: c.local, remote: c.remote.userEdits, picks: c.picks });
    updateEntry(id, (e) => ({ ...e, save: { status: 'SAVING' } }));
    const result = await persistDraft({
      store,
      actor,
      key: keyOf(sel) as PlanDocKey,
      aiDraft: entry.aiDraft,
      local: resolved,
      adopted: entry.plan.adopted,
      stored: { version: c.remote.version, base: c.remote.userEdits, adopted: c.remote.adopted },
    });
    setEntries((p) => {
      const cur = p[id];
      if (!cur) return p;
      const applied = entryAfterPersist(cur, result);
      return { ...p, [id]: result.status === 'SAVED' ? { ...applied, plan: { ...applied.plan, committed: toEdits(result.userEdits) } } : applied };
    });
  };

  const sel = selected;
  const id = sel ? selectionKey(sel) : null;
  const entry = id ? entries[id] ?? null : null;
  const load = id ? loads[id] : undefined;
  const genState = id ? gen[id] : undefined;
  const planView = entry ? computePlanView(entry.aiDraft, entry.plan) : null;

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
                    const key: Stage3Selection = { companyId: p.companyId, strategyId: p.strategyId, projectKey: p.projectKey };
                    const isSelected = selected !== null && selectionKey(selected) === selectionKey(key);
                    return (
                      <button
                        key={`${p.projectKey}|${p.departmentIndex}`}
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
              </div>
            ))
          )}
        </nav>
      </section>

      <section className="min-w-0">
        {!view && <p className="rounded-lg bg-zinc-50 p-4 text-[13px] text-zinc-700">上の一覧からプロジェクトを選ぶと、STAGE3の情報を表示します。</p>}
        {view && view.status === 'NO_DATA' && <p className="rounded-lg bg-amber-50 p-4 text-[13px] text-amber-900">{REASON_LABEL[view.reason] ?? '情報を表示できません。'}</p>}
        {view && view.status === 'READY' && sel && (
          <ReadOnlyProject
            key={view.key}
            view={view}
            companyLabel={companyLabel}
            stableId={sel.projectKey.startsWith('id:')}
            entry={entry}
            planView={planView}
            load={load}
            gen={genState}
            onCreate={() => createPlan(sel)}
            onRetryLoad={() => setLoads((p) => {
              const next = { ...p };
              if (id) delete next[id];
              return next;
            })}
            onSave={() => save(sel)}
            onPick={(key, side) => id && updateEntry(id, (e) => (e.save.status === 'CONFLICT' ? { ...e, save: { ...e.save, picks: { ...e.save.picks, [key]: side } } } : e))}
            onResolve={() => saveResolved(sel)}
            onPlan={(fn) => id && updatePlan(id, fn)}
            onView={(v) => id && updateEntry(id, (e) => ({ ...e, view: v }))}
            remote={ops !== null}
            onTransition={(action, reg) => sel && transitionRemote(sel, action, reg)}
            version={entry?.stored && entry.save.status !== 'CONFLICT' ? entry.stored.version : null}
          />
        )}
      </section>
    </div>
  );
}

function saveStatusText(entry: PlanDocEntry): string {
  const s = entry.save;
  if (s.status === 'SAVING') return '保存しています…';
  if (s.status === 'SAVED') return `保存済み（版 ${s.version}${s.mergedFromRemote ? '。他の人の修正を取り込みました' : ''}）`;
  if (s.status === 'FAILED') return s.message;
  if (s.status === 'DENIED') return 'この計画を保存する権限がありません。';
  if (s.status === 'CONFLICT') return '他の人が先に保存しています。下で、項目ごとに選んでください。';
  return entry.stored ? '保存済み' : '未保存の草案（AIの草案に、利用者の修正を重ねています）';
}

function ReadOnlyProject({
  view,
  companyLabel,
  stableId,
  entry,
  planView,
  load,
  gen,
  onCreate,
  onRetryLoad,
  onSave,
  onPick,
  onResolve,
  onPlan,
  onView,
  version,
  remote,
  onTransition,
}: {
  view: Extract<Stage3ReadView, { status: 'READY' }>;
  companyLabel: string;
  stableId: boolean;
  entry: PlanDocEntry | null;
  planView: ReturnType<typeof computePlanView> | null;
  load: LoadState | undefined;
  gen: GenState | undefined;
  onCreate: () => void;
  onRetryLoad: () => void;
  onSave: () => void;
  onPick: (key: string, side: 'local' | 'remote') => void;
  onResolve: () => void;
  onPlan: (fn: (p: ProjectPlanState) => ProjectPlanState) => void;
  onView: (v: 'document' | 'start') => void;
  version: number | null;
  remote: boolean;
  onTransition: (action: 'ADOPT' | 'UNADOPT' | 'RECORD_REGULATORY' | 'START' | 'UNSTART', regulatory?: unknown) => void;
}) {
  const loadPending = stableId && (load === undefined || load.status === 'LOADING');
  const m = view.model;
  if (m.status !== 'READY') return null;
  const dept = m.department;
  const project = m.project;
  const kpiRows = [
    ...m.kpis.confirmed.map((k) => ({ ...k, state: '確定' })),
    ...m.kpis.unconfirmed.map((k) => ({ ...k, state: '入力済み（確定の印なし）' })),
    ...m.kpis.aiProvisional.map((k) => ({ ...k, state: 'AIの仮の目標（確定ではない）' })),
  ];
  const errors = gen?.status === 'FAILED' ? gen.issues.filter((i) => i.severity === 'error') : [];
  const conflicts = entry && entry.save.status === 'CONFLICT' ? conflictRows(entry) : [];
  const saveView = entry?.save;
  const allPicked = saveView?.status === 'CONFLICT' && saveView.conflicts.every((k) => !!saveView.picks[k]);

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
          {!entry && loadPending && <p className="plan-p">保存された草案を読み込んでいます…</p>}
          {!entry && !loadPending && load?.status === 'FAILED' && (
            <>
              <p className="plan-p">{load.message}</p>
              <button type="button" className="plan-btn-quiet" onClick={onRetryLoad}>
                もう一度開く
              </button>
            </>
          )}
          {!entry && !loadPending && load?.status === 'DENIED' && <p className="plan-p">この計画を見る権限がありません。</p>}
          {!entry && !loadPending && load?.status === 'UNAVAILABLE' && (
            <p role="alert" className="plan-p rounded-lg bg-amber-50 p-3 text-amber-900">
              {load.message}
            </p>
          )}
          {!entry && !loadPending && !gen && load?.status !== 'FAILED' && load?.status !== 'DENIED' && load?.status !== 'UNAVAILABLE' && (
            <>
              <p className="plan-p">実行計画書はまだ作成されていません。</p>
              <button type="button" className="plan-btn-primary" onClick={onCreate}>
                AIで実行計画書を作る（モック）
              </button>
            </>
          )}
          {!entry && gen?.status === 'BUSY' && <p className="plan-p">作成しています（モック）…</p>}
          {!entry && gen?.status === 'FAILED' && (
            <>
              <p className="plan-p">実行計画書を作れませんでした。</p>
              {errors.length > 0 && (
                <ul className="plan-list">
                  {errors.map((e) => (
                    <li key={`${e.code}-${e.message}`}>{e.message}</li>
                  ))}
                </ul>
              )}
              <button type="button" className="plan-btn-primary" onClick={onCreate}>
                もう一度作る（モック）
              </button>
            </>
          )}
          {entry && (
            <p className="plan-note">
              {saveStatusText(entry)}
              {version !== null && ` ／ 版 ${version}`}
              {isDirty(entry) && entry.save.status !== 'SAVING' && entry.save.status !== 'CONFLICT' && '（未保存の修正があります）'}
            </p>
          )}
          {entry && (entry.aiDraft as { mock?: unknown }).mock === true && (
            <p className="plan-note">AIの草案（モック）です。実際のAIは接続していません。</p>
          )}
          {entry && !stableId && (
            <p className="plan-note">このプロジェクトにはまだ番号（安定ID）がありません。保存するときに、番号を一度だけ付けます。</p>
          )}
        </section>
      </article>

      {entry && planView && (
        <div>
          {entry.save.status === 'CONFLICT' && (
            <section className="plan-next" aria-label="保存の競合">
              <h2 className="plan-h3">他の人が先に保存しました（最新は版 {entry.save.remote.version}）</h2>
              <p className="plan-note">項目ごとに、どちらの修正を残すか選んでから、保存し直してください。どちらも失われません。</p>
              <ul className="plan-list">
                {conflicts.map((c) => (
                  <li key={c.key}>
                    <div>{c.label}</div>
                    <div>あなたの修正：{c.yours}</div>
                    <div>他の人の修正：{c.theirs}</div>
                    <button
                      type="button"
                      className="plan-btn-quiet"
                      aria-pressed={entry.save.status === 'CONFLICT' && entry.save.picks[c.key] === 'local'}
                      onClick={() => onPick(c.key, 'local')}
                    >
                      あなたの修正を残す
                    </button>
                    <button
                      type="button"
                      className="plan-btn-quiet"
                      aria-pressed={entry.save.status === 'CONFLICT' && entry.save.picks[c.key] === 'remote'}
                      onClick={() => onPick(c.key, 'remote')}
                    >
                      他の人の修正を残す
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="plan-btn-primary" onClick={onResolve} disabled={!allPicked}>
                選んだ内容で保存し直す
              </button>
            </section>
          )}
          {entry.view === 'start' ? (
            <StartConfirmation
              bundle={entry.aiDraft}
              plan={entry.plan}
              view={planView}
              onEdit={(key, value) => onPlan((p) => setCommittedValue(p, key, value))}
              onRegulatory={(r) => onPlan((p) => setRegulatory(p, r))}
              onStart={() => (remote ? onTransition('START') : onPlan((p) => start(p, planView.gate.startable)))}
              onUnstart={() => (remote ? onTransition('UNSTART') : onPlan(unstart))}
              onBack={() => onView('document')}
            />
          ) : (
            <>
              <div className="plan-toolbar" role="toolbar" aria-label="草案の保存">
                <button
                  type="button"
                  className="plan-btn-primary"
                  onClick={onSave}
                  disabled={entry.save.status === 'SAVING' || entry.save.status === 'CONFLICT'}
                >
                  草案として保存
                </button>
              </div>
              <PlanDocument
                bundle={entry.aiDraft}
                mode={entry.plan.mode}
                committed={entry.plan.committed}
                draft={entry.plan.draft}
                adopted={entry.plan.adopted}
                adoptable={planView.d.adoption.adoptable}
                blockers={planView.d.adoption.blockers}
                notice={entry.plan.notice}
                persisted={remote}
                onEnterEdit={() => onPlan(enterEdit)}
                onApply={() => onPlan(applyEdit)}
                onDiscard={() => onPlan(discardEdit)}
                onDraftChange={(k, v) => onPlan((p) => setDraftValue(p, k, v))}
                onAdopt={() => (remote ? onTransition('ADOPT') : onPlan((p) => adopt(p, planView.d.adoption.adoptable)))}
                onUnadopt={() => (remote ? onTransition('UNADOPT') : onPlan(unadopt))}
                onOpenStart={() => onView('start')}
              />
              {entry.plan.started && !planView.gate.startable && <Reconcile onPlan={onPlan} />}
            </>
          )}
          {remote && entry.view === 'start' && (
            <button type="button" className="plan-btn-primary" onClick={() => onTransition('RECORD_REGULATORY', entry.plan.regulatory)}>
              規制・安全の判断を記録する
            </button>
          )}
          {entry.notice && <p role="status" className="plan-note">{entry.notice}</p>}
          {remote && entry.server && <ServerRecords server={entry.server} />}
          {entry.save.status === 'FAILED' && <p role="alert" className="plan-note">{entry.save.message}</p>}
        </div>
      )}
    </div>
  );
}

/* 実行開始の条件が崩れたら、開始の状態を解除する（既存の画面の挙動） */
function Reconcile({ onPlan }: { onPlan: (fn: (p: ProjectPlanState) => ProjectPlanState) => void }) {
  useEffect(() => {
    onPlan((p) => reconcileStart(p, false));
  }, [onPlan]);
  return null;
}

const dateText = (at: string): string => (at ? at.slice(0, 16).replace('T', ' ') : '');
const shortUser = (id: string): string => (id ? `…${id.slice(-4)}` : '不明');

/* 採用・実行開始・規制の記録と、操作の履歴（サーバーが保存した内容を、そのまま表示する） */
function ServerRecords({ server }: { server: ServerState }) {
  const reg = server.regulatory;
  return (
    <section className="plan-section" aria-label="採用・実行開始の記録">
      <h2 className="plan-h3">採用・実行開始の記録</h2>
      <ul className="plan-list">
        <li>
          {server.adoption
            ? `採用：版 ${server.adoption.version}（採用者 ${shortUser(server.adoption.byUserId)}、${dateText(server.adoption.at)}）`
            : '採用：まだ採用していません'}
        </li>
        <li>
          {server.startInfo
            ? `実行開始：版 ${server.startInfo.version}（開始者 ${shortUser(server.startInfo.byUserId)}、${dateText(server.startInfo.at)}）`
            : '実行開始：まだ開始していません'}
        </li>
        <li>
          {reg.decision
            ? `規制・安全：${REGULATORY_DECISION_LABEL[reg.decision]}（確認者 ${reg.confirmer || '未入力'}、確認日 ${reg.confirmedOn || '未入力'}）`
            : '規制・安全：未記録'}
        </li>
      </ul>
      <h3 className="plan-h3">操作の記録</h3>
      {server.events.length === 0 ? (
        <p className="plan-note">まだ記録はありません。</p>
      ) : (
        <ol className="plan-list">
          {server.events.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              {dateText(e.at)}　{EVENT_LABEL[e.action] ?? e.action}（版 {e.version}）
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
