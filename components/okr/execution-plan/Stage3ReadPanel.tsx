'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  startWithAdoption,
  unadopt,
  unstart,
  type ProjectPlanState,
} from '@/lib/stage4/planView/planState';
import { PLAN_DOC_CSS } from './planDocStyles';
import PlanDocument from './PlanDocument';
import StartConfirmation, { type StartInput } from './StartConfirmation';
import { useSetStartMode } from './startMode';
import { currentPlanStoreKind, identityApiFor, planStoreFor, remotePlanOps } from './planStores';
import { estimateProjectImpact, hypothesisOf, IMPACT_EDIT_PREFIX, type ImpactEstimate } from '@/lib/stage4/planView/impactEstimate';
import {
  buildFinanceEffectDrafts,
  financeSaveSteps,
  financeWriteReason,
  periodOfLabel,
  type FinanceAnswersByKind,
} from '@/lib/stage4/planView/financeBridge';
import { findProjectPositionById, writeFinanceEffectToProject } from '@/lib/stage4/planView/financeBridgeStore';
import { findFinanceEffectOverlapCandidates } from '@/lib/financeEffect';
import type { FinanceEffect } from '@/types/strategy';
import { Stage4FinanceConfirm } from './Stage4FinanceConfirm';
import { RegenPanel, type RegenState } from './RegenPanel';
import { KPI_STATE_LABEL } from '@/lib/stage4/planView/kpiLabels';
import { resolveProjectByKey } from '@/lib/stage4/plan/projectResolver';
import { editsAfterReplace, type DroppedEdit } from '@/lib/stage4/plan/draftEdits';
import { buildDocModel, type Edits } from '@/lib/stage4/planView/documentModel';
import { downloadProjectPlanPdf } from '@/lib/stage4/plan/projectPlanPdf';
import {
  conflictRows,
  entryAfterPersist,
  saveWillReset,
  entryAfterTransition,
  entryFromDraft,
  entryFromRecord,
  isBodyDirty,
  isDirty,
  responsibleOf,
  toEdits,
  type PlanDocEntry,
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

/* 差し替えで引き継がれない修正を、項目名と前の修正で示す（外れるものが無ければ null） */
function droppedNotice(dropped: DroppedEdit[], lead: string): string | null {
  if (dropped.length === 0) return null;
  const shown = (v: unknown) => {
    const s = String(v ?? '');
    return s.length > 40 ? `${s.slice(0, 40)}…` : s;
  };
  const items = dropped
    .map((d) => `「${d.label}」（${d.reason === 'CHANGED' ? '内容が変わった' : 'なくなった'}・前の修正：${shown(d.before)}）`)
    .join('、');
  return `${lead}次の修正は引き継がれません（操作の履歴には残ります）：${items}。必要なら計画書で書き直してください。`;
}

/* 現在の会社の戦略（ストア）を、文書型に並べる。保存は草案の記録だけで、STAGE3の戦略・KPI・okrsV2は変えない。
 * 会社・戦略が変わると、表示の状態ごと作り直す（前の選択や作成・保存の状態を残さない）。 */
/* STAGE3の戦略書から移動してきた時の対象（URLの from=stage3 と dept・projectId）。対象が無ければ何もしない */
export type Stage3Handoff = { departmentName: string | null; projectId: string | null };

export default function Stage3ReadPanel({ handoff }: { handoff?: Stage3Handoff } = {}) {
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
  return <Stage3ProjectBrowser key={`${storeCompanyId}|${storeStrategyId}`} source={source} userId={userId} handoff={handoff} />;
}

function Stage3ProjectBrowser({
  source,
  userId,
  handoff,
}: {
  source: Extract<Stage3Source, { status: 'READY' }>;
  userId: string;
  handoff?: Stage3Handoff;
}) {
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
  const handoffProjectKey = handoff?.projectId ? `id:${handoff.projectId}` : null;
  useEffect(() => {
    if (selected || !handoffProjectKey) return;
    const row = tree.flatMap((s) => s.departments.flatMap((d) => d.projects)).find((p) => p.projectKey === handoffProjectKey);
    if (row) setSelected({ companyId: row.companyId, strategyId: row.strategyId, projectKey: row.projectKey });
  }, [handoffProjectKey, selected, tree]);
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
  const selectedEntry = selected ? entries[selectionKey(selected)] : undefined;
  const impactEstimate = useMemo(() => {
    if (!selected) return null;
    const resolved = resolveProjectByKey({
      memberships: source.memberships,
      strategies: source.strategies,
      companyId: selected.companyId,
      strategyId: selected.strategyId,
      projectKey: selected.projectKey,
    });
    if (!resolved.ok) return null;
    const draft = selectedEntry?.aiDraft as { plan?: { section4?: { financeItems?: unknown } } } | undefined;
    return estimateProjectImpact(resolved.project.project, {
      edits: (selectedEntry?.plan.committed ?? {}) as Record<string, unknown>,
      hypothesis: hypothesisOf(draft?.plan?.section4?.financeItems),
    });
  }, [selected, source, selectedEntry]);

  const storeDepartmentsNow = useStrategyStore((s: any) => s.departments as unknown);
  const storeFiscalYearEnd = useStrategyStore((s: any) => (s.fiscalYearEnd ?? undefined) as string | undefined);
  const storeCompanyNow = useStrategyStore((s: any) => (s.companyId ?? null) as string | null);
  const storeStrategyNow = useStrategyStore((s: any) => (s.strategyId ?? null) as string | null);
  const financeProjectId = selected && selected.projectKey.startsWith('id:') ? selected.projectKey.slice(3) : null;
  const financePos = financeProjectId ? findProjectPositionById(storeDepartmentsNow, financeProjectId) : null;
  const financeDrafts = impactEstimate ? buildFinanceEffectDrafts({ estimate: impactEstimate, fiscalYearEnd: storeFiscalYearEnd }) : [];
  const financeSaved: FinanceEffect[] = financePos
    ? [financePos.project.financeEffect, ...(financePos.project.financeEffects ?? [])].filter((e): e is FinanceEffect => !!e)
    : [];
  const financeOverlap = financePos ? findFinanceEffectOverlapCandidates(storeDepartmentsNow, financePos.dIdx, financePos.pIdx).length : 0;
  const financeScopeMatches = !!selected && storeCompanyNow === selected.companyId && storeStrategyNow === selected.strategyId;
  const financeReason = financeWriteReason({ scopeMatches: financeScopeMatches, planLoaded: !!selectedEntry });

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
    if (out.status === 'DISABLED') return failWith(targetId, 'この環境では実行計画書の作成機能が有効になっていません。管理者に確認してください。');
    if (out.status === 'UNAVAILABLE') return failWith(targetId, out.message);
    if (out.status === 'DENIED') return failWith(targetId, 'この計画を作成する権限がありません。');
    return failWith(targetId, '草案を作れませんでした。もう一度お試しください。');
  };

  /* 採用・規制の記録・開始・取り消し（API）：保存されていない修正があれば、先に保存してもらう。成功したら、新しい版番号を返す */
  const runTransition = async (
    sel: Stage3Selection,
    version: number,
    action: 'ADOPT' | 'UNADOPT' | 'RECORD_REGULATORY' | 'START' | 'UNSTART',
    regulatory?: unknown,
    checkDirty = true
  ): Promise<{ ok: true; version: number } | { ok: false }> => {
    const id = selectionKey(sel);
    const entry = entries[id];
    const key = keyOf(sel);
    if (!ops || !entry || !key || !entry.stored) return { ok: false };
    const note = (message: string) => updateEntry(id, (e) => ({ ...e, notice: message }));
    if (checkDirty && isDirty(entry) && (action === 'ADOPT' || action === 'START' || action === 'RECORD_REGULATORY')) {
      note('修正を「計画を保存」で保存してから、操作してください。');
      return { ok: false };
    }
    const out = await ops.transition(key, version, action, regulatory);
    if (out.status === 'OK') {
      setEntries((p) => (p[id] ? { ...p, [id]: entryAfterTransition(p[id], out.record) } : p));
      return { ok: true, version: out.record.version };
    }
    if (out.status === 'CONFLICT') {
      setEntries((p) => (p[id] ? { ...p, [id]: { ...entryFromRecord(out.current), notice: '他の人が先に変更しました。最新の内容を表示しています。' } } : p));
      return { ok: false };
    }
    if (out.status === 'BLOCKED') note(`まだ実行できません：${out.blockers.join('、')}`);
    else if (out.status === 'INVALID') note(out.message);
    else note('操作を記録できませんでした。画面を読み直してから、もう一度お試しください。');
    return { ok: false };
  };

  const transitionRemote = (sel: Stage3Selection, action: 'ADOPT' | 'UNADOPT' | 'RECORD_REGULATORY' | 'START' | 'UNSTART', regulatory?: unknown) => {
    const entry = entries[selectionKey(sel)];
    if (!entry?.stored) return;
    return runTransition(sel, entry.stored.version, action, regulatory).then(() => undefined);
  };

  /* 実行責任者を保存する（計画書の本文は変えない）。保存の窓口は、「計画を保存」と同じ */
  const saveResponsible = async (sel: Stage3Selection, version: number, responsible: string): Promise<{ ok: true; version: number } | { ok: false }> => {
    const id = selectionKey(sel);
    const entry = entries[id];
    const key = keyOf(sel);
    if (!entry || !key) return { ok: false };
    const edits: Record<string, unknown> = { ...entry.plan.committed };
    if (responsible) edits.responsible = responsible;
    else delete edits.responsible;
    const out = await store.update(actor, key, version, { userEdits: edits, adopted: entry.plan.adopted });
    if (out.status === 'SAVED') {
      setEntries((p) => (p[id] ? { ...p, [id]: entryAfterTransition(p[id], out.record) } : p));
      return { ok: true, version: out.record.version };
    }
    if (out.status === 'CONFLICT') {
      setEntries((p) => (p[id] ? { ...p, [id]: { ...entryFromRecord(out.current), notice: '他の人が先に変更しました。最新の内容を表示しています。' } } : p));
      return { ok: false };
    }
    updateEntry(id, (e) => ({ ...e, notice: '実行責任者を保存できませんでした。もう一度お試しください。' }));
    return { ok: false };
  };

  /* 「実行を開始する」：実行責任者を保存 → （採用していなければ）採用 → 開始。
   * 途中で止まったら、そこまでの状態が残り、理由を表示する。押し直すと、残りだけを行う。
   * 本文に未保存の修正がある時は、開始せず、計画書で保存してもらう（本文を黙って上書きしない）。 */
  const startPlanRemote = async (sel: Stage3Selection, input: StartInput) => {
    const id = selectionKey(sel);
    const entry = entries[id];
    if (!entry?.stored) return;
    if (isBodyDirty(entry)) {
      updateEntry(id, (e) => ({ ...e, notice: '計画書の本文に未保存の修正があります。計画書に戻り、「計画を保存」してから開始してください。' }));
      return;
    }
    let version = entry.stored.version;
    let adopted = entry.stored.adopted;
    if (input.responsible !== responsibleOf(entry)) {
      if (adopted) {
        const unadopted = await runTransition(sel, version, 'UNADOPT');
        if (!unadopted.ok) return;
        version = unadopted.version;
        adopted = false;
      }
      const saved = await saveResponsible(sel, version, input.responsible);
      if (!saved.ok) return;
      version = saved.version;
    }
    if (!adopted) {
      const done = await runTransition(sel, version, 'ADOPT', undefined, false);
      if (!done.ok) return;
      version = done.version;
    }
    await runTransition(sel, version, 'START', undefined, false);
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

  /* AIでもう一度作る：新しい案は保存せず、文書として見せる。「この案を使う」を押した時だけ、現在の計画書になる */
  const [regen, setRegen] = useState<Record<string, RegenState>>({});
  const regenStart = async (sel: Stage3Selection) => {
    const id = selectionKey(sel);
    const entry = entries[id];
    const key = keyOf(sel);
    if (!ops || !entry || !key || !entry.stored) return;
    setRegen((p) => ({ ...p, [id]: { status: 'BUSY' } }));
    const out = await ops.preview(key);
    if (out.status === 'PREVIEW') {
      const report = editsAfterReplace(entry.plan.committed, entry.aiDraft, out.draft);
      return setRegen((p) => ({
        ...p,
        [id]: { status: 'READY', draft: out.draft, previewToken: out.previewToken, notice: droppedNotice(report.dropped, 'この案にすると、') },
      }));
    }
    const message =
      out.status === 'INVALID'
        ? `新しい案を作れませんでした：${out.messages.join('、')}`
        : out.status === 'MODEL_FAILED'
          ? out.message
          : out.status === 'DISABLED'
            ? '新しい案の作成は現在利用できません。'
            : out.status === 'DENIED'
              ? 'この計画を作り直す権限がありません。'
              : '新しい案を作れませんでした。現在の計画書はそのままです。';
    setRegen((p) => ({ ...p, [id]: { status: 'FAILED', message } }));
  };
  const regenUse = async (sel: Stage3Selection) => {
    const id = selectionKey(sel);
    const entry = entries[id];
    const key = keyOf(sel);
    const current = regen[id];
    if (!ops || !entry || !key || !entry.stored || !current || current.status !== 'READY') return;
    const note = (text: string) => setRegen((p) => (p[id]?.status === 'READY' ? { ...p, [id]: { ...p[id], notice: text } } : p));
    const clear = () =>
      setRegen((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
    if (isBodyDirty(entry)) return note('計画書の本文に未保存の修正があります。先に「計画を保存」してください。');
    const out = await ops.useDraft(key, entry.stored.version, current.draft, current.previewToken);
    if (out.status === 'OK') {
      const report = editsAfterReplace(entry.plan.committed, entry.aiDraft, current.draft);
      const notice = droppedNotice(report.dropped, '新しい案にしました。採用と開始は解除されています。') ?? '新しい案を現在の計画書にしました。採用と開始は解除されています。';
      setEntries((p) => (p[id] ? { ...p, [id]: entryAfterTransition(p[id], out.record, notice) } : p));
      return clear();
    }
    if (out.status === 'CONFLICT') {
      setEntries((p) => (p[id] ? { ...p, [id]: { ...entryFromRecord(out.current), notice: '他の人が先に変更しました。最新の計画書を表示しています。' } } : p));
      return clear();
    }
    note(
      out.status === 'EXPIRED'
        ? '新しい案の有効期限が切れました。「AIでもう一度作る」からやり直してください。'
        : out.status === 'BLOCKED'
          ? `新しい案を使えませんでした：${out.blockers.join('、')}`
          : out.status === 'NOT_READY'
            ? '開始済みの計画は差し替えられません。現在の計画書はそのままです。'
            : out.status === 'INVALID'
              ? out.message
              : '新しい案を使えませんでした。現在の計画書はそのままです。'
    );
  };
  const regenCancel = (id: string) =>
    setRegen((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });

  /* 計画の保存のあとに、入力された財務効果を書く。必須項目がそろったものだけ確認する。途中で止まったら理由を残す */
  const saveFinance = async (sel: Stage3Selection, projectId: string, targetId: string, answers: FinanceAnswersByKind) => {
    const steps = financeSaveSteps({ drafts: financeDrafts, answers, saved: financeSaved, overlapCount: financeOverlap });
    if (steps.length === 0) return;
    for (const step of steps) {
      const out = await writeFinanceEffectToProject({
        companyId: sel.companyId,
        strategyId: sel.strategyId,
        projectId,
        candidate: step.candidate,
        action: step.action,
      });
      if (!out.ok) {
        updateEntry(targetId, (e) => ({ ...e, notice: `計画は保存しましたが、財務効果は保存できませんでした：${out.message}` }));
        return;
      }
    }
    const written = steps.map((s) => s.kind);
    updateEntry(targetId, (e) => {
      const rest: FinanceAnswersByKind = { ...(e.finance ?? {}) };
      for (const kind of written) delete rest[kind];
      return { ...e, finance: rest };
    });
  };

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
    if (result.status === 'SAVED') await saveFinance(sel, projectId as string, targetId, entry.finance ?? {});
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
  const setStartMode = useSetStartMode();
  const startSelected = entry?.view === 'start' && planView !== null;
  useEffect(() => {
    setStartMode?.(startSelected);
  }, [setStartMode, startSelected]);
  const financeSection: ReactNode = selected ? (
    <Stage4FinanceConfirm
      drafts={financeDrafts}
      saved={financeSaved}
      overlapCount={financeOverlap}
      planPeriod={periodOfLabel(planView?.d.period.label)}
      writable={!financeReason}
      reasonNotWritable={financeReason}
      answers={entry?.finance ?? {}}
      onAnswer={(kind, a) => id && updateEntry(id, (e) => ({ ...e, finance: { ...(e.finance ?? {}), [kind]: a } }))}
    />
  ) : undefined;

  return (
    <div className="space-y-4">
      <style>{PLAN_DOC_CSS}</style>
      {!startSelected && (
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
      )}

      <section className="min-w-0">
        {!startSelected && handoffProjectKey && selected?.projectKey === handoffProjectKey && (
          <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-[13px] text-emerald-900">
            STAGE3で確定したプロジェクトです。事業・部門：{handoff?.departmentName ?? '（未指定）'}／プロジェクト：{titleOf(handoffProjectKey) ?? '（名称なし）'}
          </p>
        )}
        {!view && <p className="rounded-lg bg-zinc-50 p-4 text-[13px] text-zinc-700">上の一覧からプロジェクトを選ぶと、STAGE3の情報を表示します。</p>}
        {view && view.status === 'NO_DATA' && <p className="rounded-lg bg-amber-50 p-4 text-[13px] text-amber-900">{REASON_LABEL[view.reason] ?? '情報を表示できません。'}</p>}
        {view && view.status === 'READY' && sel && (
          <ReadOnlyProject
            key={view.key}
            view={view}
            companyLabel={companyLabel}
            impactEstimate={impactEstimate}
            financeSection={financeSection}
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
            regen={id ? regen[id] : undefined}
            onRegenStart={() => sel && regenStart(sel)}
            onRegenUse={() => sel && regenUse(sel)}
            onRegenCancel={() => id && regenCancel(id)}
            remote={ops !== null}
            onTransition={(action, reg) => sel && transitionRemote(sel, action, reg)}
            onStartPlan={(input) => sel && startPlanRemote(sel, input)}
          />
        )}
      </section>
    </div>
  );
}

function saveStatusText(entry: PlanDocEntry): string {
  const s = entry.save;
  if (s.status === 'SAVING') return '保存しています…';
  if (s.status === 'SAVED') return s.mergedFromRemote ? '保存済み（他の人の修正を取り込みました）' : '保存済み';
  if (s.status === 'FAILED') return s.message;
  if (s.status === 'DENIED') return 'この計画を保存する権限がありません。';
  if (s.status === 'CONFLICT') return '他の人が先に保存しています。下で、項目ごとに選んでください。';
  return entry.stored ? '保存済み' : '未保存';
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
  remote,
  onTransition,
  onStartPlan,
  impactEstimate,
  financeSection,
  regen,
  onRegenStart,
  onRegenUse,
  onRegenCancel,
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
  remote: boolean;
  onTransition: (action: 'ADOPT' | 'UNADOPT' | 'RECORD_REGULATORY' | 'START' | 'UNSTART', regulatory?: unknown) => void;
  onStartPlan: (input: StartInput) => void;
  impactEstimate: ImpactEstimate | null;
  financeSection: ReactNode;
  regen: RegenState | undefined;
  onRegenStart: () => void;
  onRegenUse: () => void;
  onRegenCancel: () => void;
}) {
  const loadPending = stableId && (load === undefined || load.status === 'LOADING');
  const m = view.model;
  if (m.status !== 'READY') return null;
  const dept = m.department;
  const project = m.project;
  const kpiRows = [
    ...m.kpis.confirmed.map((k) => ({ ...k, state: KPI_STATE_LABEL.confirmed })),
    ...m.kpis.unconfirmed.map((k) => ({ ...k, state: KPI_STATE_LABEL.unconfirmed })),
    ...m.kpis.aiProvisional.map((k) => ({ ...k, state: KPI_STATE_LABEL.provisional })),
  ];
  const errors = gen?.status === 'FAILED' ? gen.issues.filter((i) => i.severity === 'error') : [];
  const conflicts = entry && entry.save.status === 'CONFLICT' ? conflictRows(entry) : [];
  const saveView = entry?.save;
  const allPicked = saveView?.status === 'CONFLICT' && saveView.conflicts.every((k) => !!saveView.picks[k]);

  if (entry && planView && entry.view === 'start') {
    return (
      <section className="plan-main" aria-label="実行開始">
        <StartConfirmation
          plan={entry.plan}
          view={planView}
          bodyDirty={isBodyDirty(entry)}
          responsible={responsibleOf(entry)}
          actionNotice={entry.notice}
          stage3Changes={buildDocModel(entry.aiDraft, entry.plan.committed).goals.kpis.filter((k) => k.stage3Changed).length}
          onStart={(input) =>
            remote
              ? onStartPlan(input)
              : onPlan((p) => {
                  const withResponsible = setCommittedValue(p, 'responsible', input.responsible || undefined);
                  return startWithAdoption(withResponsible, entry.aiDraft);
                })
          }
          onBack={() => onView('document')}
        />
      </section>
    );
  }

  return (
    <div className="plan-page">
      <section className="plan-main" aria-label="実行計画書">
        <section className="plan-section">
          <h2 className="plan-h2">実行計画書</h2>
          {entry?.plan.started && (
            <p role="status" className="plan-note">
              現在の状態：実行中（進捗はSTAGE5で管理します）
            </p>
          )}
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
                AIで実行計画書を作成
              </button>
            </>
          )}
          {!entry && gen?.status === 'BUSY' && <p className="plan-p">作成しています…</p>}
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
                もう一度作る
              </button>
            </>
          )}
          {entry && (
            <p className="plan-note" role="status">
              {saveStatusText(entry)}
              {isDirty(entry) && entry.save.status !== 'SAVING' && entry.save.status !== 'CONFLICT' && '（未保存の修正があります）'}
            </p>
          )}
        </section>
      </section>
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
          <div className="plan-toolbar" role="toolbar" aria-label="計画の保存">
            <button
              type="button"
              className="plan-btn-primary"
              onClick={onSave}
              disabled={entry.save.status === 'SAVING' || entry.save.status === 'CONFLICT'}
            >
              計画を保存
            </button>
            {remote && (
              <button
                type="button"
                className="plan-btn-quiet"
                disabled={!entry.stored || isDirty(entry)}
                onClick={() =>
                  void downloadProjectPlanPdf({
                    aiDraft: entry.aiDraft,
                    userEdits: entry.plan.committed as Edits,
                    startInfo: entry.server?.startInfo ? { at: entry.server.startInfo.at, version: entry.server.startInfo.version } : null,
                    companyName: companyLabel,
                    generatedAt: new Date().toISOString(),
                  }).catch(() => window.alert('PDFを作成できませんでした。もう一度お試しください。'))
                }
              >
                実行計画書をPDFで開く
              </button>
            )}
          </div>
          {remote && saveWillReset(entry) && (
            <p role="status" className="plan-note">
              この修正を保存すると、採用・規制の判断・実行開始は解除されます。解除後に、採用し直してください。
            </p>
          )}
          {(
            <>
              {remote && entry.plan.mode === 'read' && !entry.plan.started && !regen && (
                <div className="plan-regen">
                  <button type="button" className="plan-btn-quiet" onClick={onRegenStart}>
                    AIでもう一度作る
                  </button>
                </div>
              )}
              {regen ? (
                <div className="plan-regen">
                  <RegenPanel state={regen} onUse={onRegenUse} onCancel={onRegenCancel} />
                </div>
              ) : (
              <PlanDocument
                key={`doc-${entry.stored?.version ?? 0}`}
                bundle={entry.aiDraft}
                mode={entry.plan.mode}
                committed={entry.plan.committed}
                draft={entry.plan.draft}
                adopted={entry.plan.adopted}
                adoptable={planView.d.adoption.adoptable}
                blockers={planView.d.adoption.blockers}
                notice={entry.plan.notice}
                persisted={remote}
                directEdit={remote}
                onDirectChange={(k, v) => onPlan((p) => setCommittedValue(p, k, v))}
                impactEstimate={impactEstimate}
                financeSection={financeSection}
                onImpactEdit={
                  remote && !entry.plan.started
                    ? (k, v) => onPlan((p) => setCommittedValue(p, `${IMPACT_EDIT_PREFIX}${k}`, v === null ? undefined : v))
                    : undefined
                }
                onEnterEdit={() => onPlan(enterEdit)}
                onApply={() => onPlan(applyEdit)}
                onDiscard={() => onPlan(discardEdit)}
                onDraftChange={(k, v) => onPlan((p) => setDraftValue(p, k, v))}
                onAdopt={() => (remote ? onTransition('ADOPT') : onPlan((p) => adopt(p, planView.d.adoption.adoptable)))}
                onUnadopt={() => (remote ? onTransition('UNADOPT') : onPlan(unadopt))}
                onOpenStart={() => onView('start')}
              />
              )}
              {entry.plan.started && !planView.gate.startable && <Reconcile onPlan={onPlan} />}
            </>
          )}
          {entry.notice && <p role="status" className="plan-note">{entry.notice}</p>}
          {entry.save.status === 'FAILED' && <p role="alert" className="plan-note">{entry.save.message}</p>}
        </div>
      )}
      <details className="plan-ref">
        <summary className="plan-ref-summary">STAGE3の参照情報（目的・背景・KPI）を開く</summary>
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
                  <tr key={`${k.state}-${i}-${k.label}`} className={k.state === KPI_STATE_LABEL.confirmed ? 'plan-kpi-confirmed' : undefined}>
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
          <p className="plan-note">STAGE3に登録されたKPIは、この画面では変更できません。変更はSTAGE3で行います。AIの提案KPIは計画書の中に別に示します。</p>
        </section>
      </article>
      </details>
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

