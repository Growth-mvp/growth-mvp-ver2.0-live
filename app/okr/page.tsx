// /app/okr/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import {
  ChevronDown,
  HelpCircle,
  Copy,
  CheckCircle2,
  Trash2,
  Plus,
  GitCompare,
} from 'lucide-react';

import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { useAccess } from '@/utils/access';
import { hardResetForCompanySwitch } from '@/utils/resetAll';
import { loadAndHydrate } from '@/utils/loader';
import { useAutoSave } from '@/hooks/useAutoSave';
import type { KRKind } from '@/types/strategy';

import {
  ensureArray,
  ensureKrIds,
  mkKRStructured,
  buildKRFromText,
  diffKrSets,
  type Department,
  type Project,
  type OKR,
  type KRStructuredX,
  type OkrVariant,
  type OkrVariantStatus,
  type ProjectRole,
  type DiffItem,
  type DraftBaseKey,
} from './_lib/okrModels';

import { useOkrEditor, type EditingMode } from './_hooks/useOkrEditor';

/* ============================================================
 * 軽量ツールチップ（依存を増やさず同ファイルで実装）
 * ========================================================== */
function Tooltip({
  text,
  children,
  side = 'top',
}: {
  text: string;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  const pos =
    side === 'top'
      ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
      : side === 'bottom'
      ? 'top-full left-1/2 -translate-x-1/2 mt-2'
      : side === 'left'
      ? 'right-full top-1/2 -translate-y-1/2 mr-2'
      : 'left-full top-1/2 -translate-y-1/2 ml-2';

  return (
    <div
      ref={ref}
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((v) => !v)}
    >
      {children}
      {open && (
        <div
          role="tooltip"
          className={`pointer-events-none absolute z-[60] max-w-[340px] rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[12px] leading-5 text-zinc-800 shadow ${pos}`}
        >
          {text}
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * ユーティリティ（pageに残す：store全体保存の判定まわり）
 * ========================================================== */
function makeSaveSnapshot(s: any) {
  const snap: any = {
    strategyId: s?.strategyId ?? undefined,
    story: Array.isArray(s?.story) ? s.story : [],
    finalStory: Array.isArray(s?.finalStory) ? s.finalStory : [],
    answers2: Array.isArray(s?.answers2) ? s.answers2 : [],
    departments: Array.isArray(s?.departments) ? s.departments : [],
    companyName: s?.companyName,
    mission: s?.mission,
    vision: s?.vision,
    value: s?.value,
    thought: s?.thought,
  };
  if (Array.isArray(s?.csvFinanceData)) snap.csvFinanceData = s.csvFinanceData;
  if (Array.isArray(s?.financeSummary)) snap.financeSummary = s.financeSummary;
  if (typeof s?.businessPortfolio !== 'undefined') snap.businessPortfolio = s.businessPortfolio;
  if (typeof s?.simulationResult !== 'undefined') snap.simulationResult = s.simulationResult;
  return snap;
}

function hashSnapshot(obj: any) {
  const s = JSON.stringify(obj ?? {});
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

/* ============================================================
 * 保存ステータス・ドック（日本語UI）
 * ========================================================== */
function SaveDock() {
  const { user } = useUserStore();
  const state = useStrategyStore() as any;
  const departments = state?.departments ?? [];

  const [hydratedUI, setHydratedUI] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [formattedSavedAt, setFormattedSavedAt] = useState('');
  const [error, setError] = useState('');
  const savedHashRef = useRef<string>('');

  useEffect(() => setHydratedUI(true), []);
  const currentHash = useMemo(() => JSON.stringify(departments), [departments]);

  useEffect(() => {
    if (!savedHashRef.current) savedHashRef.current = currentHash;
    setDirty(savedHashRef.current !== currentHash);
  }, [currentHash]);

  useEffect(() => {
    setOnline(typeof navigator !== 'undefined' ? navigator.onLine : null);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (!lastSavedAt) return setFormattedSavedAt('');
    const fmt = new Intl.DateTimeFormat('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Asia/Tokyo',
    }).format(lastSavedAt);
    setFormattedSavedAt(fmt);
  }, [lastSavedAt]);

  const saveNow = useCallback(async () => {
    if (!user?.id) return;
    setSaving(true);
    setError('');
    try {
      useStrategyStore.setState((st: any) => ({ ...st, dirty: true }));
      await useStrategyStore.getState().saveStrategyData();
      savedHashRef.current = JSON.stringify((useStrategyStore.getState() as any).departments ?? []);
      setLastSavedAt(Date.now());
      setDirty(false);
    } catch (e: any) {
      setError('保存に失敗しました。少し時間をおいて再度お試しください。');
      // eslint-disable-next-line no-console
      console.warn('SaveDock error:', e);
    } finally {
      setSaving(false);
    }
  }, [user?.id]);

  if (!hydratedUI)
    return (
      <div className="fixed bottom-5 right-5 z-50">
        <div className="rounded-2xl border border-zinc-200 bg-white/95 px-3 py-2 shadow">
          <span className="text-xs text-zinc-600">状態を確認しています…</span>
        </div>
      </div>
    );

  const canSave = !saving && online && dirty && !!user?.id;

  return (
    <div className="fixed bottom-5 right-5 z-50">
      <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/95 px-3 py-2 shadow">
        <span
          className={`inline-flex h-2 w-2 rounded-full ${
            online ? 'bg-emerald-500' : online === false ? 'bg-amber-500' : 'bg-zinc-300'
          }`}
        />
        <span className="text-xs text-zinc-800">
          {saving ? '保存中…' : dirty ? '未保存の変更があります' : `保存済み ${formattedSavedAt || ''}`}
        </span>
        <button
          onClick={saveNow}
          disabled={!canSave}
          className={`ml-2 h-7 rounded-full px-3 text-xs font-semibold ${
            canSave ? 'bg-black text-white' : 'cursor-not-allowed bg-zinc-200 text-zinc-500'
          }`}
        >
          今すぐ保存
        </button>
      </div>
      {error && <div className="mt-1 text-[11px] text-rose-600">{error}</div>}
    </div>
  );
}

/* ============================================================
 * メイン
 * ========================================================== */
const ROLE_OPTIONS: Array<{ value: ProjectRole; label: string }> = [
  { value: 'revenue', label: 'ロール：収益（売上を伸ばす）' },
  { value: 'cost', label: 'ロール：コスト（費用を抑える）' },
  { value: 'future', label: 'ロール：未来（投資・成功確率）' },
  { value: 'global', label: 'ロール：全社連携（シナジー）' },
];

// 戦略OKR：track / metricRole / validation は okrModels の拡張を前提。
// ここでは page.tsx 側を「壊れにくい」実装にするため、UIは文字列で扱い any キャストで保存します。
type StrategyTrackUI = 'EVOLVE' | 'EXPLORE';
type MetricRoleUI = 'LAG' | 'LEAD' | 'NORTHSTAR' | 'OTHER';
type ValidationStatusUI = 'not_started' | 'running' | 'passed' | 'failed' | 'paused';

type Draft = {
  kind: KRKind;
  label: string;
  target: string; // 入力は文字列、保存時に数値化
  unit: '%' | '¥' | '件' | '人' | '比率';
  scope: 'company' | 'department' | 'project';
  baseKey: DraftBaseKey;
  owner?: string;
  due?: string;

  // 戦略OKR
  track?: StrategyTrackUI;
  metricRole?: MetricRoleUI;

  // 係数（財務ブリッジ用）
  weight?: string;
  elasticity?: string;
  lagMonths?: string;
  startYm?: string;

  notes?: string;

  overrideMode?: 'APPORTION' | 'OVERRIDE';
  baseOverride?: string;

  // 探索（validation plan）
  vStatus?: ValidationStatusUI;
  vHypothesis?: string;
  vTestMethod?: string;
  vEvidence?: string;
  vNextAction?: string;
};

function krBadge(track?: StrategyTrackUI) {
  if (track === 'EXPLORE') return 'bg-indigo-100 text-indigo-700';
  return 'bg-emerald-100 text-emerald-700';
}
function metricBadge(role?: MetricRoleUI) {
  if (role === 'LEAD') return 'bg-sky-100 text-sky-700';
  if (role === 'LAG') return 'bg-amber-100 text-amber-800';
  if (role === 'NORTHSTAR') return 'bg-violet-100 text-violet-700';
  return 'bg-zinc-100 text-zinc-700';
}

export default function OKRPage() {
  const s = useStrategyStore() as any;
  const {
    companyId: scopeCompanyId,
    hydrated,
    setCompanyScope,
    setHydrated,
    refetchFromServer,
    boot,
    lastServerSnapshot,
  } = useStrategyStore();

  const departments = useStrategyStore((st) => ((st.departments as Department[] | undefined) ?? []) as Department[]);

  const access = useAccess();
  const accessCompanyId: string | undefined = useMemo(
    () => ((access as any)?.companyId ?? (s?.companyId as string | undefined)) as string | undefined,
    [(access as any)?.companyId, s?.companyId],
  );

  /* -------- 会社スコープ確立（cascade と同じパターン） -------- */
  const lastAppliedCompanyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accessCompanyId) return;
    if (lastAppliedCompanyRef.current === accessCompanyId && scopeCompanyId === accessCompanyId) return;

    if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
      setHydrated?.(false);
      hardResetForCompanySwitch(accessCompanyId);
      setCompanyScope(accessCompanyId);
    } else if (!scopeCompanyId) {
      setCompanyScope(accessCompanyId);
    }
    lastAppliedCompanyRef.current = accessCompanyId;
  }, [accessCompanyId, scopeCompanyId, setCompanyScope, setHydrated]);

  /* -------- 初期ロード（Dirty 回避付き） -------- */
  const loadGuardRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accessCompanyId) return;
    if (!scopeCompanyId) setCompanyScope(accessCompanyId);
    if (loadGuardRef.current === accessCompanyId && hydrated && scopeCompanyId === accessCompanyId) return;

    let cancelled = false;
    const run = async () => {
      if (hydrated && scopeCompanyId === accessCompanyId) {
        loadGuardRef.current = accessCompanyId;
        return;
      }

      const currentSnap = makeSaveSnapshot(useStrategyStore.getState());
      const currentHash = hashSnapshot(currentSnap);
      const isDirty = !!(lastServerSnapshot && lastServerSnapshot !== currentHash);

      const timer = setTimeout(() => {
        if (!cancelled) setHydrated?.(true);
      }, 7000);

      try {
        if (!isDirty) {
          await loadAndHydrate(accessCompanyId);
          try {
            await refetchFromServer?.();
          } catch {
            // ignore
          }
          setHydrated?.(true);
        } else {
          setHydrated?.(true);
        }
        loadGuardRef.current = accessCompanyId;
      } finally {
        clearTimeout(timer);
      }
      if (cancelled) return;
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [
    accessCompanyId,
    hydrated,
    scopeCompanyId,
    refetchFromServer,
    setHydrated,
    lastServerSnapshot,
    setCompanyScope,
  ]);

  /* -------- 自動保存：cascade と同じ条件でガード -------- */
  const mismatch = !!(accessCompanyId && scopeCompanyId && scopeCompanyId !== accessCompanyId);
  const isHydrating = ((Boolean(boot?.isHydrating) && !hydrated) || mismatch || !hydrated) ?? false;

  useAutoSave(!isHydrating ? [accessCompanyId, departments] : []);

  /* -------- STAGE4 Baseline 作成ガード（hydrate 完了時に1回だけ、companyId単位） -------- */
  const baselineCreatedRef = useRef<boolean>(false);
  const {
    executionPlanBaseline,
    setExecutionPlanBaseline,
  } = useStrategyStore();

  useEffect(() => {
    if (!hydrated || isHydrating || !accessCompanyId || baselineCreatedRef.current) return;
    // 既に baseline があり、かつ same companyId なら スキップ
    if (executionPlanBaseline?.snapshot && executionPlanBaseline.companyId === accessCompanyId) {
      baselineCreatedRef.current = true;
      return;
    }

    // baseline 作成：departments 全体を deep copy
    const baseline = {
      companyId: accessCompanyId,
      createdAt: Date.now(),
      snapshot: JSON.parse(JSON.stringify(departments)),
    };

    setExecutionPlanBaseline?.(baseline);
    baselineCreatedRef.current = true;
  }, [hydrated, isHydrating, accessCompanyId, executionPlanBaseline, departments, setExecutionPlanBaseline]);

  /* -------- 表示/編集ユーティリティ -------- */
  const cascade: Department[] = useMemo(() => (Array.isArray(departments) ? departments : []), [departments]);

  /* ============================================================
   * ロールの“影”を保持してリフェッチ上書きを回避（UI都合なので page に残す）
   * ========================================================== */
  const [roleShadow, setRoleShadow] = useState<Record<string, Project['role'] | undefined>>({});

  useEffect(() => {
    const next: Record<string, Project['role'] | undefined> = {};
    cascade.forEach((d, di) =>
      ensureArray(d.projects).forEach((p, pi) => {
        const k = `${di}:${pi}`;
        if (p.role != null) next[k] = p.role;
      }),
    );
    setRoleShadow((prev) => ({ ...next, ...prev }));
  }, [cascade]);

  /* ============================================================
   * UI state
   * ========================================================== */
  const [krDetailOpen, setKrDetailOpen] = useState<Record<string, boolean>>({});
  const [helpMode, setHelpMode] = useState<boolean>(false);

  /* STAGE4: planStatus, skillPlans/humanInvestments CRUD UI */
  const [addingSkillPlan, setAddingSkillPlan] = useState<{ deptIdx: number; projIdx: number } | null>(null);
  const [addingHumanInvestment, setAddingHumanInvestment] = useState<{ deptIdx: number; projIdx: number } | null>(null);
  const [editingSkillIdx, setEditingSkillIdx] = useState<number | null>(null);
  const [editingInvestmentIdx, setEditingInvestmentIdx] = useState<number | null>(null);

  // SkillPlan フォーム
  const [newSkillFormData, setNewSkillFormData] = useState<{
    skillName: string;
    method: 'TRAINING' | 'OJT' | 'HIRE' | 'OUTSOURCE' | 'TOOL' | 'OTHER';
    priority: string;
    dueYm: string;
    hours: string;
    cost: string;
    owner: string;
    note: string;
  }>({
    skillName: '',
    method: 'TRAINING',
    priority: '',
    dueYm: '',
    hours: '',
    cost: '',
    owner: '',
    note: '',
  });

  // ExecutionHumanInvestment フォーム
  const [newInvestFormData, setNewInvestFormData] = useState<{
    type: 'HIRE' | 'TRAINING' | 'OUTSOURCE' | 'SYSTEM' | 'TOOL' | 'OTHER';
    amount: string;
    timingYm: string;
    headcount: string;
    team: string;
    note: string;
  }>({
    type: 'HIRE',
    amount: '',
    timingYm: '',
    headcount: '',
    team: '',
    note: '',
  });

  const toggleKrDetail = (key: string) => {
    setKrDetailOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  /* ============================================================
   * STAGE4: planStatus ロジック・permission チェック
   * ========================================================== */
  const userRole = (access as any)?.role ?? 'member';

  const getPlanStatus = (): string => selectedProj?.planStatus ?? 'draft';
  const isApproved = (): boolean => getPlanStatus() === 'approved';
  const isReview = (): boolean => getPlanStatus() === 'review';

  const canTransitionToPlanStatus = (targetStatus: string): boolean => {
    if (userRole === 'admin') return true;
    if (userRole === 'manager' && targetStatus === 'review') return true;
    return false;
  };

  const canEditContent = (): boolean => {
    if (isApproved()) return false; // approved はロック
    return true;
  };

  const updatePlanStatus = (status: 'draft' | 'review' | 'approved') => {
    if (!selected || !selectedProj || !canTransitionToPlanStatus(status)) return;

    patchDepartments((prev) => {
      const next = [...prev];
      const dept = next[selected.deptIdx];
      if (!dept) return prev;
      const deptCopy = { ...dept };
      const projs = Array.isArray(deptCopy.projects) ? [...deptCopy.projects] : [];
      const proj = { ...projs[selected.projIdx] };

      proj.planStatus = status;
      if (status === 'approved') {
        proj.approvedAt = new Date().toISOString();
        proj.approvedBy = (access as any)?.user?.id ?? 'admin';
      }

      projs[selected.projIdx] = proj;
      deptCopy.projects = projs;
      next[selected.deptIdx] = deptCopy;
      return next;
    });
  };

  /* ============================================================
   * プロジェクト選択（左→右）
   * ========================================================== */
  const [selected, setSelected] = useState<{ deptIdx: number; projIdx: number } | null>(null);
  const [activeTab, setActiveTab] = useState<'objective' | 'kr' | 'plan'>('kr');

  const [addingProjectForDept, setAddingProjectForDept] = useState<number | null>(null);
  const [newProjectTitle, setNewProjectTitle] = useState<string>('');

  const keyFor = (dIdx: number, pIdx: number) => `${dIdx}:${pIdx}`;

  const startAddProject = (deptIdx: number) => {
    if (isHydrating) return;
    setAddingProjectForDept(deptIdx);
    setNewProjectTitle('');
  };

  const cancelAddProject = () => {
    setAddingProjectForDept(null);
    setNewProjectTitle('');
  };

  /* ============================================================
   * 進化/探索：編集モード
   * ========================================================== */
  const [editingMode, setEditingMode] = useState<EditingMode>('committed');
  const [showDiff, setShowDiff] = useState<boolean>(true);

  const selectedDept = selected ? cascade[selected.deptIdx] : undefined;
  const selectedProjects = selectedDept ? ensureArray(selectedDept.projects) : [];
  const selectedProj = selected && selectedDept ? selectedProjects[selected.projIdx] : undefined;

  const selectedAddKey = selected && selectedProj ? keyFor(selected.deptIdx, selected.projIdx) : '';

  const selectedOkrs = selectedProj ? (ensureArray(selectedProj.okrs as OKR[] | undefined) as OKR[]) : [];
  const mainOKR = selectedOkrs[0];
  const hasCascadeOkrs = selectedOkrs.length > 0;

  const committedOkrsV2: KRStructuredX[] = selectedProj
    ? (ensureArray(selectedProj.okrsV2 as KRStructuredX[] | undefined) as KRStructuredX[])
    : [];

  const variants: OkrVariant[] = selectedProj ? ensureArray(selectedProj.okrVariants) : [];
  const activeVariantId = selectedProj?.activeVariantId;

  const activeVariant: OkrVariant | undefined = useMemo(() => {
    if (!selectedProj) return undefined;
    const list = ensureArray(selectedProj.okrVariants);
    if (!list.length) return undefined;
    const v = list.find((x) => x.id === selectedProj.activeVariantId);
    return v ?? list[0];
  }, [selectedProj]);

  /* ============================================================
   * 更新ロジック：hookへ集約
   * ========================================================== */
  const {
    patchDepartments,
    updateProjectRole,
    updateProjectOKR,
    setActiveVariant,
    createVariantFromCommitted,
    deleteVariant,
    renameVariant,
    setVariantStatus,
    adoptVariantToCommitted,
    updateStructuredKR,
    deleteStructuredKR,
    generateKRFromCascade,
    addStructuredKR,
  } = useOkrEditor({
    editingMode,
    selected,
    selectedProj,
    setEditingMode,
    setRoleShadow: (updater) => setRoleShadow(updater),
  });

  /* -------- プロジェクト追加（page側に残す：UI状態と密結合） -------- */
  const confirmAddProject = (deptIdx: number) => {
    const title = newProjectTitle.trim();
    if (!title) {
      alert('プロジェクト名を入力してください。');
      return;
    }

    const baseDept = cascade[deptIdx];
    const currentProjs = baseDept ? ensureArray(baseDept.projects) : [];
    const newProjIdx = currentProjs.length;

    patchDepartments((prev) => {
      const next = [...prev];
      const deptPrev = next[deptIdx];
      if (!deptPrev) return prev;

      const dept = { ...deptPrev };
      const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
      const newProj: Project = {
        title,
        okrs: [],
        okrsV2: [],
        okrVariants: [],
        okrRevision: 0,
      };
      projs.push(newProj);
      dept.projects = projs;
      next[deptIdx] = dept;
      return next;
    });

    setSelected({ deptIdx, projIdx: newProjIdx });
    setAddingProjectForDept(null);
    setNewProjectTitle('');
  };

  /* -------- 選択の安定化 -------- */
  useEffect(() => {
    if (!Array.isArray(cascade) || cascade.length === 0) {
      if (selected) setSelected(null);
      return;
    }

    if (selected) {
      const d = cascade[selected.deptIdx];
      const projs = d ? ensureArray(d.projects) : [];
      if (d && projs.length > 0 && selected.projIdx < projs.length) return;
    }

    for (let di = 0; di < cascade.length; di += 1) {
      const projs = ensureArray(cascade[di].projects);
      if (projs.length > 0) {
        setSelected({ deptIdx: di, projIdx: 0 });
        return;
      }
    }

    setSelected(null);
  }, [cascade, selected]);

  /* -------- 選択プロジェクトが変わったら、mode を安全側（committed）に戻す -------- */
  useEffect(() => {
    setEditingMode('committed');
  }, [selectedAddKey]);

  /* -------- activeVariantId が未設定で variants がある場合、初期化 -------- */
  useEffect(() => {
    if (!selected) return;
    if (!selectedProj) return;
    const list = ensureArray(selectedProj.okrVariants);
    if (!list.length) return;
    if (selectedProj.activeVariantId) return;

    patchDepartments((prev) => {
      const next = [...prev];
      const deptPrev = next[selected.deptIdx];
      if (!deptPrev) return prev;
      const dept = { ...deptPrev };
      const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
      const projPrev = projs[selected.projIdx];
      if (!projPrev) return prev;

      const proj = { ...projPrev, activeVariantId: list[0].id };
      projs[selected.projIdx] = proj;
      dept.projects = projs;
      next[selected.deptIdx] = dept;
      return next;
    });
  }, [selected, selectedProj, patchDepartments]);

  const currentKrList: KRStructuredX[] = useMemo(() => {
    if (!selectedProj) return [];
    if (editingMode === 'committed') return committedOkrsV2;
    return activeVariant ? ensureArray(activeVariant.okrsV2) : [];
  }, [selectedProj, editingMode, committedOkrsV2, activeVariant]);

  const diffItems: DiffItem[] = useMemo(() => {
    if (!selectedProj) return [];
    if (editingMode !== 'variant') return [];
    if (!activeVariant) return [];
    return diffKrSets(committedOkrsV2, ensureArray(activeVariant.okrsV2));
  }, [selectedProj, editingMode, activeVariant, committedOkrsV2]);

  /* -------- 初期補修：KR id を一括補完（committed + variants） -------- */
  useEffect(() => {
    if (!Array.isArray(departments) || departments.length === 0) return;
    const patched = ensureKrIds(departments as Department[]);
    if (patched !== departments) patchDepartments(() => patched);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments?.length]);

  /* -------- 初回自動：カスケードOKR → 構造化KR へ一括変換（committedのみ） -------- */
  useEffect(() => {
    if (!Array.isArray(cascade) || cascade.length === 0) return;

    patchDepartments((prev) => {
      const next = [...prev];
      let anyChanged = false;

      next.forEach((d, di) => {
        const projList = ensureArray(d.projects);
        let deptChanged = false;

        const newProjs = projList.map((p) => {
          const okrs = ensureArray(p.okrs as OKR[] | undefined);
          if (!okrs.length) return p;

          const existing: KRStructuredX[] = Array.isArray(p.okrsV2) ? [...(p.okrsV2 as KRStructuredX[])] : [];
          let projChanged = false;

          okrs.forEach((o) => {
            const ownerHint = o.owner;
            const krs = ensureArray(o.keyResults as string[] | undefined);

            krs.forEach((krText) => {
              const label = (krText ?? '').trim();
              if (!label) return;

              const already = existing.some((x) => String((x as any).label ?? '').trim() === label);
              if (already) return;

              const kr = buildKRFromText(label, ownerHint);
              existing.push(kr);
              projChanged = true;
            });
          });

          if (projChanged) {
            deptChanged = true;
            return { ...p, okrsV2: existing };
          }
          return p;
        });

        if (deptChanged) {
          anyChanged = true;
          next[di] = { ...d, projects: newProjs };
        }
      });

      return anyChanged ? next : prev;
    });
  }, [cascade, patchDepartments]);

  /* ============================================================
   * KR 追加フォーム（pageに残す：UI state）
   * ========================================================== */
  const emptyDraft: Draft = {
    kind: 'ACQ',
    label: '',
    target: '',
    unit: '件',
    scope: 'project',
    baseKey: 'acq',
    owner: '',
    due: '',
    track: 'EVOLVE',
    metricRole: 'LAG',
    weight: '1',
    elasticity: '',
    lagMonths: '0',
    startYm: '',
    notes: '',
    overrideMode: 'APPORTION',
    baseOverride: '',
    vStatus: 'not_started',
    vHypothesis: '',
    vTestMethod: '',
    vEvidence: '',
    vNextAction: '',
  };

  const [draftMap, setDraftMap] = useState<Record<string, Draft>>({});
  const [openAdd, setOpenAdd] = useState<Record<string, boolean>>({});

  const setDraft = (k: string, patch: Partial<Draft>) =>
    setDraftMap((m) => ({
      ...m,
      [k]: { ...(m[k] ?? emptyDraft), ...patch },
    }));

  const resetDraft = (k: string) => setDraftMap((m) => ({ ...m, [k]: { ...emptyDraft } }));

  const selectedIsOpen = selectedAddKey && openAdd[selectedAddKey] ? true : false;
  const selectedDraft: Draft = selectedAddKey && draftMap[selectedAddKey] ? (draftMap[selectedAddKey] as Draft) : emptyDraft;

  const addStructuredKRFromDraft = (dIdx: number, pIdx: number) => {
    const k = keyFor(dIdx, pIdx);
    const draft = draftMap[k] ?? emptyDraft;

    const t = Number(draft.target);
    if (!Number.isFinite(t)) {
      alert('目標値は数値で入力してください。');
      return;
    }
    if (!draft.label.trim()) {
      alert('名称（ラベル）を入力してください。');
      return;
    }

    const weightNum = draft.weight ? Number(draft.weight) : 1;
    const elasticityNum = draft.elasticity ? Number(draft.elasticity) : undefined;
    const lagNum = draft.lagMonths ? Number(draft.lagMonths) : 0;
    const baseOverrideNum =
      draft.overrideMode === 'OVERRIDE' && draft.baseOverride ? Number(draft.baseOverride) : undefined;

    const track = (draft.track ?? 'EVOLVE') as any;
    const metricRole = (draft.metricRole ?? 'LAG') as any;

    const validation =
      track === 'EXPLORE'
        ? ({
            status: draft.vStatus ?? 'not_started',
            hypothesis: draft.vHypothesis ?? '',
            testMethod: draft.vTestMethod ?? '',
            evidence: draft.vEvidence ?? '',
            nextAction: draft.vNextAction ?? '',
          } as any)
        : undefined;

    const kr: KRStructuredX = mkKRStructured({
      kind: draft.kind,
      label: draft.label.trim(),
      target: t,
      unit: draft.unit,
      scope: draft.scope,
      baseKey: draft.baseKey,
      owner: draft.owner?.trim() || undefined,
      due: draft.due?.trim() || undefined,
      weight: weightNum,
      elasticity: elasticityNum,
      lagMonths: lagNum,
      startYm: draft.startYm?.trim() || undefined,
      notes: draft.notes?.trim() || undefined,
      overrideMode: draft.overrideMode,
      baseOverride: baseOverrideNum,

      // 戦略OKRメタ
      track,
      metricRole,
      validation,
    } as any);

    addStructuredKR(dIdx, pIdx, kr);

    resetDraft(k);
    setOpenAdd((m) => ({ ...m, [k]: false }));
  };

  const getRoleLabel = (role?: Project['role'] | null) => {
    if (!role) return 'ロール未設定';
    const found = ROLE_OPTIONS.find((r) => r.value === role);
    return found ? found.label.replace(/^ロール：/, '') : 'ロール未設定';
  };

  const kindLabel = (k: KRKind) => {
    // 表示だけ。種類が増えても崩れないようにそのまま出す。
    return String(k);
  };

  const copyKrToDraft = (k: string, kr: KRStructuredX) => {
    const track = ((kr as any).track ?? 'EVOLVE') as StrategyTrackUI;
    const metricRole = ((kr as any).metricRole ?? 'LAG') as MetricRoleUI;
    const v = (kr as any).validation ?? undefined;

    setDraftMap((m) => ({
      ...m,
      [k]: {
        ...emptyDraft,
        kind: (kr as any).kind ?? 'ACQ',
        label: String((kr as any).label ?? ''),
        target: String((kr as any).target ?? ''),
        unit: ((kr as any).unit ?? '件') as any,
        scope: ((kr as any).scope ?? 'project') as any,
        baseKey: ((kr as any).baseKey ?? 'acq') as any,
        owner: (kr as any).owner ?? '',
        due: (kr as any).due ?? '',
        weight: String((kr as any).weight ?? '1'),
        elasticity: (kr as any).elasticity != null ? String((kr as any).elasticity) : '',
        lagMonths: (kr as any).lagMonths != null ? String((kr as any).lagMonths) : '0',
        startYm: (kr as any).startYm ?? '',
        notes: (kr as any).notes ?? '',
        overrideMode: ((kr as any).overrideMode ?? 'APPORTION') as any,
        baseOverride: (kr as any).baseOverride != null ? String((kr as any).baseOverride) : '',
        track,
        metricRole,
        vStatus: (v?.status ?? 'not_started') as any,
        vHypothesis: v?.hypothesis ?? '',
        vTestMethod: v?.testMethod ?? '',
        vEvidence: v?.evidence ?? '',
        vNextAction: v?.nextAction ?? '',
      },
    }));
    setOpenAdd((om) => ({ ...om, [k]: true }));
  };

  // approved の場合は KR/plan 編集ロック
  const canEditKr = !(editingMode === 'variant' && !activeVariant) && !isApproved();

  /* ============================================================
   * Render
   * ========================================================== */
  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-8">
      <header className="mb-8">
        <h1 className="text-[28px] font-semibold tracking-tight text-zinc-900">
          STAGE4 実行計画策定（KPI設定確定）
        </h1>
        <p className="text-[14px] text-zinc-600">
          <span className="text-[13px] text-zinc-500">承認・確定されたOKRから、プロジェクト単位で実行計画（スキル・人的投資）を策定します。</span>
        </p>

        <div className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-200 bg-white/90 px-3 py-2">
          <label className="inline-flex items-center gap-2 text-[13px] text-zinc-800">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-zinc-300"
              checked={helpMode}
              onChange={(e) => setHelpMode(e.target.checked)}
            />
            入力のガイドを表示
          </label>
          <span className="text-[12px] text-zinc-500">（オンにすると各項目の補足が常時見えます）</span>
        </div>

        {isHydrating && (
          <div className="mt-3 rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm text-zinc-600">
            サーバーのデータを読み込み中です…
          </div>
        )}
        <div className="mt-6 h-px w-full bg-zinc-200" />
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(260px,320px),1fr]">
        {/* 左：プロジェクト一覧 */}
        <aside className="h-full rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[16px] font-semibold text-zinc-900">プロジェクト一覧</h2>
          </div>

          {cascade.length === 0 ? (
            <p className="text-[13px] text-zinc-600">
              部門・プロジェクトがまだ登録されていません。カスケード画面から部門戦略・プロジェクトを作成してください。
            </p>
          ) : (
            <div className="space-y-4">
              {cascade.map((dept, di) => {
                const projs = ensureArray(dept.projects);

                return (
                  <div key={di}>
                    <div className="mb-1 flex items-center justify-between">
                      <div className="text-[12px] font-semibold text-zinc-700">{dept.name || '部門'}</div>
                      <button
                        type="button"
                        onClick={() => startAddProject(di)}
                        disabled={isHydrating}
                        className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
                      >
                        ＋ プロジェクトを追加
                      </button>
                    </div>

                    {addingProjectForDept === di && (
                      <div className="mb-2 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-2">
                        <div className="mb-1 text-[11px] font-semibold text-zinc-700">新しいプロジェクト</div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            className="h-9 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                            placeholder="例：既存顧客向けアップセル強化プロジェクト"
                            value={newProjectTitle}
                            onChange={(e) => setNewProjectTitle(e.target.value)}
                            disabled={isHydrating}
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => confirmAddProject(di)}
                              disabled={isHydrating}
                              className="h-9 rounded-xl bg-black px-3 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
                            >
                              作成
                            </button>
                            <button
                              type="button"
                              onClick={cancelAddProject}
                              disabled={isHydrating}
                              className="h-9 rounded-xl border border-zinc-200 bg-white px-3 text-[12px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                            >
                              やめる
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {projs.length > 0 && (
                      <ul className="space-y-1">
                        {projs.map((proj, pi) => {
                          const k = keyFor(di, pi);
                          const committedCount = ensureArray(proj.okrsV2 as KRStructuredX[] | undefined).length;
                          const variantCount = ensureArray(proj.okrVariants).length;
                          const isSelected = selected?.deptIdx === di && selected?.projIdx === pi;
                          const role = roleShadow[k] != null ? roleShadow[k] : proj.role ?? undefined;

                          return (
                            <li key={pi}>
                              <button
                                type="button"
                                onClick={() => setSelected({ deptIdx: di, projIdx: pi })}
                                className={`flex w-full flex-col rounded-2xl border px-3 py-2 text-left transition ${
                                  isSelected
                                    ? 'border-zinc-900 bg-zinc-900 text-white'
                                    : 'border-zinc-200 bg-zinc-50 text-zinc-800 hover:bg-zinc-100'
                                }`}
                              >
                                <span className="flex items-center justify-between gap-2">
                                  <span className="text-[13px] font-semibold">{proj.title || proj.name || 'プロジェクト'}</span>
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                                      isSelected ? 'bg-white/10 text-zinc-50' : 'bg-white text-zinc-600'
                                    }`}
                                  >
                                    確定 KR x{committedCount}
                                  </span>
                                </span>
                                <span className={`mt-1 text-[11px] ${isSelected ? 'text-zinc-100' : 'text-zinc-500'}`}>
                                  {getRoleLabel(role)} ・探索案 {variantCount}件
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        {/* 右：選択中プロジェクトの OKR 編集パネル */}
        <section className="min-h-[420px] rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
          {!selected || !selectedProj || !selectedDept ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-[14px] font-medium text-zinc-700">左の一覧から、編集したいプロジェクトを選んでください。</p>
              <p className="text-[12px] text-zinc-500">プロジェクト単位で Objective と Key Results を設定できます。</p>
            </div>
          ) : (
            <>
              {/* プロジェクトヘッダー */}
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[12px] text-zinc-500">{selectedDept.name || '部門'}</div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <button
                      className="rounded-full border border-zinc-200 bg-zinc-50 p-1.5 text-zinc-700"
                      title="折りたたみ（今後拡張予定）"
                      type="button"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <h2 className="text-[18px] font-semibold text-zinc-900">{selectedProj.title || selectedProj.name || 'プロジェクト'}</h2>
                  </div>
                  <div className="mt-1 text-[12px] text-zinc-500">「確定版（財務に反映）」と「探索案（候補）」を分けて編集できます。</div>
                </div>

                {/* ロール + 進化/探索コントロール */}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {/* ロール */}
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-zinc-600">プロジェクトの役割</span>
                      <Tooltip text="このプロジェクトが主にどこに効くかを選びます。収益＝売上、コスト＝費用削減、未来＝投資や成功確率、全社連携＝相乗。">
                        <HelpCircle className="h-4 w-4 text-zinc-500" />
                      </Tooltip>
                    </div>
                    <select
                      className="h-9 rounded-xl border border-zinc-200 bg-white px-2 text-[13px]"
                      value={roleShadow[selectedAddKey] ?? selectedProj.role ?? ''}
                      onChange={(e) =>
                        updateProjectRole(selected.deptIdx, selected.projIdx, e.target.value as Project['role'] | '')
                      }
                      disabled={isHydrating}
                    >
                      <option value="">未選択</option>
                      {ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 編集対象（確定 / 探索） */}
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-zinc-600">編集対象</span>
                      <Tooltip text="確定版：財務シミュレーションに反映されるKR。探索案：候補を複数作って比較し、採用したものだけを確定版に反映します。">
                        <HelpCircle className="h-4 w-4 text-zinc-500" />
                      </Tooltip>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingMode('committed')}
                        disabled={isHydrating}
                        className={`h-9 rounded-xl px-3 text-[12px] font-semibold ${
                          editingMode === 'committed'
                            ? 'bg-black text-white'
                            : 'border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50'
                        }`}
                      >
                        確定版
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingMode('variant')}
                        disabled={isHydrating}
                        className={`h-9 rounded-xl px-3 text-[12px] font-semibold ${
                          editingMode === 'variant'
                            ? 'bg-black text-white'
                            : 'border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50'
                        }`}
                      >
                        探索案
                      </button>
                    </div>
                  </div>

                  {/* 探索案コントロール */}
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-zinc-600">探索案</span>
                      <Tooltip text="探索案を選んで編集し、採用（確定版へ反映）できます。探索案は財務には直接反映されません。">
                        <HelpCircle className="h-4 w-4 text-zinc-500" />
                      </Tooltip>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        className="h-9 rounded-xl border border-zinc-200 bg-white px-2 text-[13px]"
                        value={activeVariantId ?? activeVariant?.id ?? ''}
                        onChange={(e) => {
                          const id = e.target.value;
                          if (!id) return;
                          setActiveVariant(selected.deptIdx, selected.projIdx, id);
                          setEditingMode('variant');
                        }}
                        disabled={isHydrating || !variants.length}
                      >
                        {!variants.length ? (
                          <option value="">探索案なし</option>
                        ) : (
                          variants.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.title}（{v.status}）
                            </option>
                          ))
                        )}
                      </select>

                      <button
                        type="button"
                        onClick={() => createVariantFromCommitted(selected.deptIdx, selected.projIdx)}
                        disabled={isHydrating}
                        className={`h-9 rounded-xl border px-3 text-[12px] font-semibold ${
                          isHydrating ? 'border-zinc-200 bg-zinc-200 text-zinc-500' : 'border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50'
                        }`}
                        title="確定版をコピーして探索案を作成"
                      >
                        <span className="inline-flex items-center gap-1">
                          <Copy className="h-4 w-4" /> 新規
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowDiff((v) => !v)}
                        disabled={isHydrating || editingMode !== 'variant' || !activeVariant}
                        className={`h-9 rounded-xl border px-3 text-[12px] font-semibold ${
                          isHydrating || editingMode !== 'variant' || !activeVariant
                            ? 'border-zinc-200 bg-zinc-200 text-zinc-500'
                            : 'border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50'
                        }`}
                        title="確定版との差分"
                      >
                        <span className="inline-flex items-center gap-1">
                          <GitCompare className="h-4 w-4" /> 差分
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* 探索案の採用/削除 */}
                  {editingMode === 'variant' && activeVariant && (
                    <div className="flex flex-col items-end gap-1">
                      <div className="text-[11px] text-zinc-600">操作</div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => adoptVariantToCommitted(selected.deptIdx, selected.projIdx, activeVariant.id)}
                          disabled={isHydrating}
                          className={`h-9 rounded-xl px-3 text-[12px] font-semibold ${
                            isHydrating ? 'bg-zinc-200 text-zinc-500' : 'bg-black text-white hover:opacity-90'
                          }`}
                          title="探索案を確定版へ反映"
                        >
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle2 className="h-4 w-4" /> 採用
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteVariant(selected.deptIdx, selected.projIdx, activeVariant.id)}
                          disabled={isHydrating}
                          className={`h-9 rounded-xl border px-3 text-[12px] font-semibold ${
                            isHydrating
                              ? 'border-zinc-200 bg-zinc-200 text-zinc-500'
                              : 'border-zinc-200 bg-white text-rose-600 hover:bg-rose-50'
                          }`}
                          title="探索案を削除"
                        >
                          <span className="inline-flex items-center gap-1">
                            <Trash2 className="h-4 w-4" /> 削除
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 探索案メタ（編集） */}
              {editingMode === 'variant' && activeVariant && (
                <div className="mb-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-col gap-1">
                      <div className="text-[12px] font-semibold text-zinc-800">探索案のメタ情報</div>
                      <div className="text-[11px] text-zinc-500">探索案は候補です。採用すると確定版へ反映され、財務に接続されます。</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        className="h-9 rounded-xl border border-zinc-200 bg-white px-2 text-[13px]"
                        value={activeVariant.status}
                        onChange={(e) =>
                          setVariantStatus(
                            selected.deptIdx,
                            selected.projIdx,
                            activeVariant.id,
                            e.target.value as OkrVariantStatus,
                          )
                        }
                        disabled={isHydrating}
                        title="探索案のステータス"
                      >
                        <option value="draft">draft（作成中）</option>
                        <option value="candidate">candidate（候補）</option>
                        <option value="rejected">rejected（却下）</option>
                        <option value="adopted">adopted（採用済）</option>
                      </select>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <div className="md:col-span-2">
                      <div className="mb-1 text-[11px] text-zinc-600">タイトル</div>
                      <input
                        className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                        value={activeVariant.title}
                        onChange={(e) => renameVariant(selected.deptIdx, selected.projIdx, activeVariant.id, e.target.value)}
                        disabled={isHydrating}
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] text-zinc-600">作成日時</div>
                      <div className="h-9 rounded-xl border border-zinc-200 bg-white px-3 text-[12px] leading-9 text-zinc-700">
                        {new Intl.DateTimeFormat('ja-JP', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                          timeZone: 'Asia/Tokyo',
                        }).format(activeVariant.createdAt)}
                      </div>
                    </div>

                    <div className="md:col-span-3">
                      <div className="mb-1 text-[11px] text-zinc-600">メモ（任意）</div>
                      <textarea
                        className="min-h-[64px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px]"
                        value={(activeVariant as any).notes ?? ''}
                        onChange={(e) => {
                          const notes = e.target.value;
                          patchDepartments((prev) => {
                            if (!selected) return prev;
                            const next = [...prev];
                            const deptPrev = next[selected.deptIdx];
                            if (!deptPrev) return prev;
                            const dept = { ...deptPrev };
                            const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
                            const projPrev = projs[selected.projIdx];
                            if (!projPrev) return prev;

                            const variants2 = ensureArray(projPrev.okrVariants).map((v) =>
                              v.id === activeVariant.id ? ({ ...(v as any), notes } as any) : v,
                            );

                            projs[selected.projIdx] = { ...projPrev, okrVariants: variants2 };
                            dept.projects = projs;
                            next[selected.deptIdx] = dept;
                            return next;
                          });
                        }}
                        disabled={isHydrating}
                        placeholder="この案の狙い／前提／却下理由など"
                      />
                    </div>
                  </div>

                  {showDiff && (
                    <div className="mt-3 rounded-xl border border-dashed border-zinc-200 bg-white px-3 py-2">
                      <div className="mb-1 flex items-center justify-between">
                        <div className="text-[12px] font-semibold text-zinc-800">確定版との差分（簡易）</div>
                        <label className="inline-flex items-center gap-2 text-[11px] text-zinc-600">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-zinc-300"
                            checked={showDiff}
                            onChange={(e) => setShowDiff(e.target.checked)}
                          />
                          表示
                        </label>
                      </div>

                      {diffItems.length === 0 ? (
                        <div className="text-[12px] text-zinc-600">大きな差分はありません（同一ラベル基準）。</div>
                      ) : (
                        <ul className="space-y-1 text-[12px]">
                          {diffItems.map((it, i) => (
                            <li key={`${it.type}_${i}`} className="flex items-start justify-between gap-3">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  it.type === 'added'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : it.type === 'removed'
                                    ? 'bg-rose-100 text-rose-700'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {it.type === 'added' ? '追加' : it.type === 'removed' ? '削除' : '変更'}
                              </span>
                              <span className="flex-1 text-zinc-800">{it.label}</span>
                              {it.type === 'changed' && (
                                <span className="text-[11px] text-zinc-500">
                                  {it.fields.slice(0, 4).join(',')}
                                  {it.fields.length > 4 ? '…' : ''}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* タブ切り替え */}
              <div className="mb-3 flex border-b border-zinc-200 text-[13px]">
                <button
                  type="button"
                  onClick={() => setActiveTab('objective')}
                  className={`mr-4 border-b-2 px-1 pb-2 ${
                    activeTab === 'objective' ? 'border-zinc-900 font-semibold text-zinc-900' : 'border-transparent text-zinc-500'
                  }`}
                >
                  Objective &amp; 概要
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('kr')}
                  className={`mr-4 border-b-2 px-1 pb-2 ${
                    activeTab === 'kr' ? 'border-zinc-900 font-semibold text-zinc-900' : 'border-transparent text-zinc-500'
                  }`}
                >
                  Key Results
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('plan')}
                  className={`border-b-2 px-1 pb-2 ${
                    activeTab === 'plan' ? 'border-zinc-900 font-semibold text-zinc-900' : 'border-transparent text-zinc-500'
                  }`}
                >
                  実行計画
                </button>

                <div className="ml-auto flex items-center gap-2 pb-2 text-[11px] text-zinc-500">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${
                    getPlanStatus() === 'approved' ? 'border border-emerald-300 bg-emerald-50 text-emerald-700' :
                    getPlanStatus() === 'review' ? 'border border-amber-300 bg-amber-50 text-amber-700' :
                    'border border-zinc-200 bg-zinc-50 text-zinc-600'
                  }`}>
                    {getPlanStatus() === 'approved' ? '✓確定' : getPlanStatus() === 'review' ? '○レビュー中' : '●下書き'}
                  </span>
                  {editingMode === 'committed' && (
                    <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5">
                      revision: {Number(selectedProj.okrRevision ?? 0)}
                    </span>
                  )}
                </div>
              </div>

              {/* Objectiveタブ（従来通り：project.okrs[0] を編集） */}
              {activeTab === 'objective' && (
                <div className="space-y-4">
                  <div>
                    <div className="mb-1 flex items-center gap-1">
                      <div className="text-[12px] font-semibold text-zinc-700">Objective（このプロジェクトのゴール）</div>
                      <Tooltip text="ここはプロジェクトの目的（OKRのObjective）です。探索案ではなく、プロジェクト自体のゴールとして扱います。">
                        <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                      </Tooltip>
                    </div>
                    <textarea
                      className="min-h-[80px] w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[14px]"
                      placeholder="例：既存顧客からのアップセルと新規顧客獲得を両立し、売上成長の軸を確立する"
                      value={mainOKR?.objective ?? ''}
                      onChange={(e) =>
                        updateProjectOKR(selected.deptIdx, selected.projIdx, {
                          objective: e.target.value,
                        })
                      }
                      disabled={isHydrating || isApproved()}
                    />
                    {helpMode && (
                      <p className="mt-1 text-[11px] text-zinc-500">
                        後から見ても「このプロジェクトは何のためか」が一言で分かる文章にしてください。
                      </p>
                    )}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="mb-1 text-[12px] font-semibold text-zinc-700">オーナー（任意）</div>
                      <input
                        className="h-9 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-[14px]"
                        placeholder="氏名や役職など"
                        value={mainOKR?.owner ?? ''}
                        onChange={(e) => updateProjectOKR(selected.deptIdx, selected.projIdx, { owner: e.target.value })}
                        disabled={isHydrating || isApproved()}
                      />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-1">
                        <div className="text-[12px] font-semibold text-zinc-700">期限（任意 / YYYY-MM）</div>
                        <Tooltip text="このプロジェクトの完了目安。例：2026-03">
                          <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                        </Tooltip>
                      </div>
                      <input
                        className="h-9 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-[14px]"
                        placeholder="2026-03"
                        value={mainOKR?.due ?? ''}
                        onChange={(e) => updateProjectOKR(selected.deptIdx, selected.projIdx, { due: e.target.value })}
                        disabled={isHydrating || isApproved()}
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-2 text-[12px] text-zinc-600">
                    <div className="mb-1 font-semibold text-zinc-800">参考：カスケードで生成されたOKR</div>
                    {selectedOkrs.length === 0 ? (
                      <p className="text-[12px] text-zinc-500">カスケード側でOKRがまだ生成されていません。</p>
                    ) : (
                      selectedOkrs.map((o, oi) => (
                        <div key={oi} className="mt-1 rounded-xl bg-white px-3 py-2">
                          <div className="text-[12px] font-semibold text-zinc-800">
                            Objective：<span className="font-normal text-zinc-900">{o.objective || '（未設定）'}</span>
                          </div>
                          {o.owner && <div className="mt-0.5 text-[11px] text-zinc-600">オーナー：{o.owner}</div>}
                          {Array.isArray(o.keyResults) && o.keyResults.length > 0 && (
                            <ul className="mt-1 list-disc pl-4 text-[12px] text-zinc-800">
                              {o.keyResults.map((kr, ki) => (
                                <li key={ki}>{kr}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* KRタブ */}
              {activeTab === 'kr' && (
                <div className="space-y-4">
                  {selectedOkrs.length > 0 && (
                    <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-[13px] text-zinc-700">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
                        <span className="font-semibold text-zinc-900">カスケードで生成されたOKR（参考）</span>
                        <span className="text-[11px] text-zinc-500">※「OKRからKRたたき台」で、編集対象へ自動変換します</span>
                      </div>
                      {selectedOkrs.map((o, oi) => (
                        <div key={oi} className="mt-1 rounded-xl bg-white px-3 py-2">
                          <div className="text-[12px] font-semibold text-zinc-800">
                            Objective：<span className="font-normal text-zinc-900">{o.objective || '（未設定）'}</span>
                          </div>
                          {o.owner && <div className="mt-0.5 text-[11px] text-zinc-600">オーナー：{o.owner}</div>}
                          {Array.isArray(o.keyResults) && o.keyResults.length > 0 && (
                            <ul className="mt-1 list-disc pl-4 text-[12px] text-zinc-800">
                              {o.keyResults.map((kr, ki) => (
                                <li key={ki}>{kr}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[12px] text-zinc-600">
                      編集対象：
                      <span className="font-semibold text-zinc-900">
                        {editingMode === 'committed' ? '確定版（財務に反映）' : '探索案（候補）'}
                      </span>
                      {editingMode === 'variant' && !activeVariant && (
                        <span className="ml-2 text-rose-600">探索案がありません（新規作成してください）</span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => generateKRFromCascade(selected.deptIdx, selected.projIdx, selectedOkrs)}
                        disabled={isHydrating || !hasCascadeOkrs || !canEditKr}
                        className={`rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                          isHydrating || !hasCascadeOkrs || !canEditKr
                            ? 'border-zinc-200 bg-zinc-200 text-zinc-500'
                            : 'border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50'
                        }`}
                      >
                        OKRからKRたたき台
                      </button>

                      <button
                        onClick={() =>
                          alert(
                            'AIで探索案（KRセット）を生成するAPIを次に実装します。現状は「新規（コピー）」で探索案を作り、手で編集してください。',
                          )
                        }
                        disabled={isHydrating}
                        className={`rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                          isHydrating ? 'border-zinc-200 bg-zinc-200 text-zinc-500' : 'border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50'
                        }`}
                      >
                        AIで探索案を生成
                      </button>

                      <button
                        onClick={() =>
                          setOpenAdd((m) => ({
                            ...m,
                            [selectedAddKey]: !selectedIsOpen,
                          }))
                        }
                        disabled={isHydrating || !canEditKr}
                        className={`rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                          isHydrating || !canEditKr
                            ? 'border-zinc-200 bg-zinc-200 text-zinc-500'
                            : 'border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50'
                        }`}
                      >
                        <span className="inline-flex items-center gap-1">
                          <Plus className="h-4 w-4" /> 指標（KR）を追加
                        </span>
                      </button>
                    </div>
                  </div>

                  {selectedIsOpen && (
                    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                      <div className="mb-2 text-[12px] font-semibold text-zinc-800">
                        指標（KR）の追加
                        <span className="ml-1 text-[11px] font-normal text-zinc-500">（まずは「ラベル」「目標値」「track」だけでもOK）</span>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="md:col-span-2">
                          <div className="mb-1 text-[11px] text-zinc-600">名称（ラベル）</div>
                          <input
                            className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                            placeholder="例：アップセル率を 8%→12% に改善"
                            value={selectedDraft.label}
                            onChange={(e) => setDraft(selectedAddKey, { label: e.target.value })}
                            disabled={isHydrating}
                          />
                          {helpMode && (
                            <div className="mt-1 text-[11px] text-zinc-500">
                              人が読んで「何をどこまで」やるか分かる文にします（数式っぽくてもOK）。
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="mb-1 text-[11px] text-zinc-600">目標値（数値）</div>
                          <input
                            className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                            placeholder="例：12"
                            value={selectedDraft.target}
                            onChange={(e) => setDraft(selectedAddKey, { target: e.target.value })}
                            disabled={isHydrating}
                          />
                        </div>
                        <div>
                          <div className="mb-1 text-[11px] text-zinc-600">単位</div>
                          <select
                            className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[13px]"
                            value={selectedDraft.unit}
                            onChange={(e) => setDraft(selectedAddKey, { unit: e.target.value as any })}
                            disabled={isHydrating}
                          >
                            <option value="%">%</option>
                            <option value="¥">¥</option>
                            <option value="件">件</option>
                            <option value="人">人</option>
                            <option value="比率">比率</option>
                          </select>
                        </div>

                        <div>
                          <div className="mb-1 flex items-center gap-1 text-[11px] text-zinc-600">
                            track（進化/探索）
                            <Tooltip text="EVOLVE＝確実に伸ばす/改善する（ラグ指標寄り）。EXPLORE＝仮説検証（リード指標＋検証計画を伴う）。">
                              <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                            </Tooltip>
                          </div>
                          <select
                            className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[13px]"
                            value={selectedDraft.track ?? 'EVOLVE'}
                            onChange={(e) => setDraft(selectedAddKey, { track: e.target.value as StrategyTrackUI })}
                            disabled={isHydrating}
                          >
                            <option value="EVOLVE">EVOLVE（進化/確実）</option>
                            <option value="EXPLORE">EXPLORE（探索/仮説検証）</option>
                          </select>
                        </div>

                        <div>
                          <div className="mb-1 flex items-center gap-1 text-[11px] text-zinc-600">
                            指標の役割（任意）
                            <Tooltip text="LEAD＝先行指標、LAG＝結果指標、NORTHSTAR＝北極星。財務ブリッジや優先順位付けに使います。">
                              <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                            </Tooltip>
                          </div>
                          <select
                            className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[13px]"
                            value={selectedDraft.metricRole ?? 'LAG'}
                            onChange={(e) => setDraft(selectedAddKey, { metricRole: e.target.value as MetricRoleUI })}
                            disabled={isHydrating}
                          >
                            <option value="LAG">LAG（結果）</option>
                            <option value="LEAD">LEAD（先行）</option>
                            <option value="NORTHSTAR">NORTHSTAR（北極星）</option>
                            <option value="OTHER">OTHER（その他）</option>
                          </select>
                        </div>

                        <div>
                          <div className="mb-1 text-[11px] text-zinc-600">kind（財務レバー種別）</div>
                          <input
                            className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                            value={String(selectedDraft.kind ?? 'ACQ')}
                            onChange={(e) => setDraft(selectedAddKey, { kind: e.target.value as any })}
                            disabled={isHydrating}
                            placeholder="例：ACQ / ARPU / CHURN / PERSONNEL ..."
                          />
                          {helpMode && (
                            <div className="mt-1 text-[11px] text-zinc-500">
                              既存の finance bridge に合わせる場合は、既定の kind を使ってください。
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="mb-1 text-[11px] text-zinc-600">baseKey（母数キー）</div>
                          <input
                            className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                            value={String(selectedDraft.baseKey ?? 'acq')}
                            onChange={(e) => setDraft(selectedAddKey, { baseKey: e.target.value as any })}
                            disabled={isHydrating}
                            placeholder="例：acq / arpu / churn ..."
                          />
                        </div>

                        <div>
                          <div className="mb-1 text-[11px] text-zinc-600">オーナー（任意）</div>
                          <input
                            className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                            value={selectedDraft.owner ?? ''}
                            onChange={(e) => setDraft(selectedAddKey, { owner: e.target.value })}
                            disabled={isHydrating}
                            placeholder="例：営業部長 田中"
                          />
                        </div>
                        <div>
                          <div className="mb-1 text-[11px] text-zinc-600">期限（任意 / YYYY-MM）</div>
                          <input
                            className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                            value={selectedDraft.due ?? ''}
                            onChange={(e) => setDraft(selectedAddKey, { due: e.target.value })}
                            disabled={isHydrating}
                            placeholder="例：2026-03"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <div className="mb-1 text-[11px] text-zinc-600">メモ（任意）</div>
                          <textarea
                            className="min-h-[60px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px]"
                            value={selectedDraft.notes ?? ''}
                            onChange={(e) => setDraft(selectedAddKey, { notes: e.target.value })}
                            disabled={isHydrating}
                            placeholder="前提・制約・狙いなど"
                          />
                        </div>

                        {/* EXPLORE のときだけ検証計画 */}
                        {(selectedDraft.track ?? 'EVOLVE') === 'EXPLORE' && (
                          <div className="md:col-span-2 rounded-2xl border border-dashed border-zinc-200 bg-white p-3">
                            <div className="mb-2 text-[12px] font-semibold text-zinc-800">探索（検証計画）</div>

                            <div className="grid gap-3 md:grid-cols-2">
                              <div>
                                <div className="mb-1 text-[11px] text-zinc-600">ステータス</div>
                                <select
                                  className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[13px]"
                                  value={selectedDraft.vStatus ?? 'not_started'}
                                  onChange={(e) => setDraft(selectedAddKey, { vStatus: e.target.value as ValidationStatusUI })}
                                  disabled={isHydrating}
                                >
                                  <option value="not_started">not_started（未開始）</option>
                                  <option value="running">running（検証中）</option>
                                  <option value="passed">passed（成立）</option>
                                  <option value="failed">failed（不成立）</option>
                                  <option value="paused">paused（一時停止）</option>
                                </select>
                              </div>
                              <div>
                                <div className="mb-1 text-[11px] text-zinc-600">次アクション（短く）</div>
                                <input
                                  className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                                  value={selectedDraft.vNextAction ?? ''}
                                  onChange={(e) => setDraft(selectedAddKey, { vNextAction: e.target.value })}
                                  disabled={isHydrating}
                                  placeholder="例：A/Bテストの設計を確定"
                                />
                              </div>
                              <div className="md:col-span-2">
                                <div className="mb-1 text-[11px] text-zinc-600">仮説</div>
                                <textarea
                                  className="min-h-[52px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px]"
                                  value={selectedDraft.vHypothesis ?? ''}
                                  onChange={(e) => setDraft(selectedAddKey, { vHypothesis: e.target.value })}
                                  disabled={isHydrating}
                                  placeholder="例：料金プランを2段階にすると離脱が減りARPUが上がる"
                                />
                              </div>
                              <div className="md:col-span-2">
                                <div className="mb-1 text-[11px] text-zinc-600">検証方法</div>
                                <textarea
                                  className="min-h-[52px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px]"
                                  value={selectedDraft.vTestMethod ?? ''}
                                  onChange={(e) => setDraft(selectedAddKey, { vTestMethod: e.target.value })}
                                  disabled={isHydrating}
                                  placeholder="例：2週間のA/Bテスト、N=200、主要KPI=CVR/解約率"
                                />
                              </div>
                              <div className="md:col-span-2">
                                <div className="mb-1 text-[11px] text-zinc-600">エビデンス（結果）</div>
                                <textarea
                                  className="min-h-[52px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px]"
                                  value={selectedDraft.vEvidence ?? ''}
                                  onChange={(e) => setDraft(selectedAddKey, { vEvidence: e.target.value })}
                                  disabled={isHydrating}
                                  placeholder="例：CVR +1.2pt、離脱 -0.4pt（p&lt;0.05）"
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="mt-3 flex justify-end gap-2">
                        <button
                          className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-[13px] text-zinc-800 hover:bg-zinc-50"
                          onClick={() => {
                            resetDraft(selectedAddKey);
                            setOpenAdd((m) => ({ ...m, [selectedAddKey]: false }));
                          }}
                          disabled={isHydrating}
                        >
                          やめる
                        </button>
                        <button
                          className="rounded-xl bg-black px-3 py-1.5 text-[13px] font-semibold text-white hover:opacity-90 active:opacity-85 disabled:opacity-40"
                          onClick={() => addStructuredKRFromDraft(selected.deptIdx, selected.projIdx)}
                          disabled={isHydrating || !canEditKr}
                        >
                          追加する
                        </button>
                      </div>
                    </div>
                  )}

                  {/* KR リスト */}
                  <div className="rounded-2xl border border-zinc-200 bg-white">
                    <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2">
                      <div className="text-[12px] font-semibold text-zinc-800">
                        {editingMode === 'committed' ? '確定版（財務に反映）' : '探索案（候補）'} の KR
                      </div>
                      <div className="text-[11px] text-zinc-500">合計 {currentKrList.length} 件</div>
                    </div>

                    {currentKrList.length === 0 ? (
                      <div className="px-3 py-3 text-[13px] text-zinc-600">
                        KRがまだありません。「OKRからKRたたき台」または「指標（KR）を追加」を押してください。
                      </div>
                    ) : (
                      <ul className="divide-y divide-zinc-100">
                        {currentKrList.map((kr, idx) => {
                          const id = String((kr as any).id ?? idx);
                          const rowKey = `${selectedAddKey}:${editingMode}:${id}:${idx}`;
                          const open = !!krDetailOpen[rowKey];

                          const track = (((kr as any).track ?? 'EVOLVE') as StrategyTrackUI) || 'EVOLVE';
                          const mRole = (((kr as any).metricRole ?? 'LAG') as MetricRoleUI) || 'LAG';
                          const validation = (kr as any).validation ?? undefined;

                          return (
                            <li key={rowKey} className="px-3 py-3">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${krBadge(track)}`}>
                                      {track === 'EXPLORE' ? 'EXPLORE' : 'EVOLVE'}
                                    </span>
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${metricBadge(mRole)}`}>
                                      {mRole}
                                    </span>
                                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-700">
                                      {kindLabel((kr as any).kind ?? 'KR')}
                                    </span>
                                    <span className="text-[13px] font-semibold text-zinc-900">
                                      {String((kr as any).label ?? '') || '（ラベル未設定）'}
                                    </span>
                                  </div>

                                  <div className="mt-1 text-[12px] text-zinc-600">
                                    目標：<span className="font-semibold text-zinc-900">{String((kr as any).target ?? '')}</span>
                                    <span className="ml-1">{String((kr as any).unit ?? '')}</span>
                                    <span className="mx-2 text-zinc-300">|</span>
                                    owner：{String((kr as any).owner ?? '—')}
                                    <span className="mx-2 text-zinc-300">|</span>
                                    due：{String((kr as any).due ?? '—')}
                                  </div>

                                  {track === 'EXPLORE' && validation && (
                                    <div className="mt-1 text-[11px] text-zinc-500">
                                      検証：{String(validation.status ?? 'not_started')} / 次：{String(validation.nextAction ?? '—')}
                                    </div>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[12px] text-zinc-700 hover:bg-zinc-50"
                                    onClick={() => toggleKrDetail(rowKey)}
                                  >
                                    {open ? '閉じる' : '編集'}
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[12px] text-zinc-700 hover:bg-zinc-50"
                                    onClick={() => copyKrToDraft(selectedAddKey, kr)}
                                    disabled={isHydrating || !canEditKr}
                                    title="このKRをひな型にして追加フォームを開く"
                                  >
                                    <span className="inline-flex items-center gap-1">
                                      <Copy className="h-4 w-4" /> 複製
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[12px] text-rose-600 hover:bg-rose-50"
                                    onClick={() => deleteStructuredKR(selected.deptIdx, selected.projIdx, idx)}
                                    disabled={isHydrating || !canEditKr}
                                  >
                                    <span className="inline-flex items-center gap-1">
                                      <Trash2 className="h-4 w-4" /> 削除
                                    </span>
                                  </button>
                                </div>
                              </div>

                              {open && (
                                <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <div className="md:col-span-2">
                                      <div className="mb-1 text-[11px] text-zinc-600">ラベル</div>
                                      <input
                                        className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                                        value={String((kr as any).label ?? '')}
                                        onChange={(e) =>
                                          updateStructuredKR(selected.deptIdx, selected.projIdx, idx, { label: e.target.value } as any)
                                        }
                                        disabled={isHydrating || !canEditKr}
                                      />
                                    </div>

                                    <div>
                                      <div className="mb-1 text-[11px] text-zinc-600">目標値</div>
                                      <input
                                        className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                                        value={String((kr as any).target ?? '')}
                                        onChange={(e) => {
                                          const v = Number(e.target.value);
                                          updateStructuredKR(selected.deptIdx, selected.projIdx, idx, { target: v } as any);
                                        }}
                                        disabled={isHydrating || !canEditKr}
                                      />
                                    </div>

                                    <div>
                                      <div className="mb-1 text-[11px] text-zinc-600">単位</div>
                                      <input
                                        className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                                        value={String((kr as any).unit ?? '')}
                                        onChange={(e) =>
                                          updateStructuredKR(selected.deptIdx, selected.projIdx, idx, { unit: e.target.value } as any)
                                        }
                                        disabled={isHydrating || !canEditKr}
                                      />
                                    </div>

                                    <div>
                                      <div className="mb-1 text-[11px] text-zinc-600">track</div>
                                      <select
                                        className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[13px]"
                                        value={track}
                                        onChange={(e) =>
                                          updateStructuredKR(selected.deptIdx, selected.projIdx, idx, { track: e.target.value } as any)
                                        }
                                        disabled={isHydrating || !canEditKr}
                                      >
                                        <option value="EVOLVE">EVOLVE</option>
                                        <option value="EXPLORE">EXPLORE</option>
                                      </select>
                                    </div>

                                    <div>
                                      <div className="mb-1 text-[11px] text-zinc-600">指標の役割（metricRole）</div>
                                      <select
                                        className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[13px]"
                                        value={mRole}
                                        onChange={(e) =>
                                          updateStructuredKR(selected.deptIdx, selected.projIdx, idx, {
                                            metricRole: e.target.value,
                                          } as any)
                                        }
                                        disabled={isHydrating || !canEditKr}
                                      >
                                        <option value="LAG">LAG</option>
                                        <option value="LEAD">LEAD</option>
                                        <option value="NORTHSTAR">NORTHSTAR</option>
                                        <option value="OTHER">OTHER</option>
                                      </select>
                                    </div>

                                    <div>
                                      <div className="mb-1 text-[11px] text-zinc-600">owner</div>
                                      <input
                                        className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                                        value={String((kr as any).owner ?? '')}
                                        onChange={(e) =>
                                          updateStructuredKR(selected.deptIdx, selected.projIdx, idx, { owner: e.target.value } as any)
                                        }
                                        disabled={isHydrating || !canEditKr}
                                      />
                                    </div>

                                    <div>
                                      <div className="mb-1 text-[11px] text-zinc-600">due（YYYY-MM）</div>
                                      <input
                                        className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                                        value={String((kr as any).due ?? '')}
                                        onChange={(e) =>
                                          updateStructuredKR(selected.deptIdx, selected.projIdx, idx, { due: e.target.value } as any)
                                        }
                                        disabled={isHydrating || !canEditKr}
                                      />
                                    </div>

                                    <div>
                                      <div className="mb-1 text-[11px] text-zinc-600">weight（係数）</div>
                                      <input
                                        className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                                        value={String((kr as any).weight ?? 1)}
                                        onChange={(e) =>
                                          updateStructuredKR(selected.deptIdx, selected.projIdx, idx, {
                                            weight: Number(e.target.value),
                                          } as any)
                                        }
                                        disabled={isHydrating || !canEditKr}
                                      />
                                    </div>

                                    <div>
                                      <div className="mb-1 text-[11px] text-zinc-600">elasticity（弾性）</div>
                                      <input
                                        className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                                        value={(kr as any).elasticity != null ? String((kr as any).elasticity) : ''}
                                        onChange={(e) =>
                                          updateStructuredKR(selected.deptIdx, selected.projIdx, idx, {
                                            elasticity: e.target.value === '' ? undefined : Number(e.target.value),
                                          } as any)
                                        }
                                        disabled={isHydrating || !canEditKr}
                                      />
                                    </div>

                                    <div>
                                      <div className="mb-1 text-[11px] text-zinc-600">lagMonths</div>
                                      <input
                                        className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                                        value={(kr as any).lagMonths != null ? String((kr as any).lagMonths) : '0'}
                                        onChange={(e) =>
                                          updateStructuredKR(selected.deptIdx, selected.projIdx, idx, {
                                            lagMonths: Number(e.target.value),
                                          } as any)
                                        }
                                        disabled={isHydrating || !canEditKr}
                                      />
                                    </div>

                                    <div>
                                      <div className="mb-1 text-[11px] text-zinc-600">startYm（任意）</div>
                                      <input
                                        className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                                        value={String((kr as any).startYm ?? '')}
                                        onChange={(e) =>
                                          updateStructuredKR(selected.deptIdx, selected.projIdx, idx, { startYm: e.target.value } as any)
                                        }
                                        disabled={isHydrating || !canEditKr}
                                      />
                                    </div>

                                    <div className="md:col-span-2">
                                      <div className="mb-1 text-[11px] text-zinc-600">notes</div>
                                      <textarea
                                        className="min-h-[60px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px]"
                                        value={String((kr as any).notes ?? '')}
                                        onChange={(e) =>
                                          updateStructuredKR(selected.deptIdx, selected.projIdx, idx, { notes: e.target.value } as any)
                                        }
                                        disabled={isHydrating || !canEditKr}
                                      />
                                    </div>

                                    {track === 'EXPLORE' && (
                                      <div className="md:col-span-2 rounded-2xl border border-dashed border-zinc-200 bg-white p-3">
                                        <div className="mb-2 text-[12px] font-semibold text-zinc-800">探索（検証計画）</div>

                                        <div className="grid gap-3 md:grid-cols-2">
                                          <div>
                                            <div className="mb-1 text-[11px] text-zinc-600">ステータス</div>
                                            <select
                                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[13px]"
                                              value={String(validation?.status ?? 'not_started')}
                                              onChange={(e) =>
                                                updateStructuredKR(selected.deptIdx, selected.projIdx, idx, {
                                                  validation: { ...(validation ?? {}), status: e.target.value },
                                                } as any)
                                              }
                                              disabled={isHydrating || !canEditKr}
                                            >
                                              <option value="not_started">not_started</option>
                                              <option value="running">running</option>
                                              <option value="passed">passed</option>
                                              <option value="failed">failed</option>
                                              <option value="paused">paused</option>
                                            </select>
                                          </div>

                                          <div>
                                            <div className="mb-1 text-[11px] text-zinc-600">次アクション</div>
                                            <input
                                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                                              value={String(validation?.nextAction ?? '')}
                                              onChange={(e) =>
                                                updateStructuredKR(selected.deptIdx, selected.projIdx, idx, {
                                                  validation: { ...(validation ?? {}), nextAction: e.target.value },
                                                } as any)
                                              }
                                              disabled={isHydrating || !canEditKr}
                                            />
                                          </div>

                                          <div className="md:col-span-2">
                                            <div className="mb-1 text-[11px] text-zinc-600">仮説</div>
                                            <textarea
                                              className="min-h-[52px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px]"
                                              value={String(validation?.hypothesis ?? '')}
                                              onChange={(e) =>
                                                updateStructuredKR(selected.deptIdx, selected.projIdx, idx, {
                                                  validation: { ...(validation ?? {}), hypothesis: e.target.value },
                                                } as any)
                                              }
                                              disabled={isHydrating || !canEditKr}
                                            />
                                          </div>

                                          <div className="md:col-span-2">
                                            <div className="mb-1 text-[11px] text-zinc-600">検証方法</div>
                                            <textarea
                                              className="min-h-[52px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px]"
                                              value={String(validation?.testMethod ?? '')}
                                              onChange={(e) =>
                                                updateStructuredKR(selected.deptIdx, selected.projIdx, idx, {
                                                  validation: { ...(validation ?? {}), testMethod: e.target.value },
                                                } as any)
                                              }
                                              disabled={isHydrating || !canEditKr}
                                            />
                                          </div>

                                          <div className="md:col-span-2">
                                            <div className="mb-1 text-[11px] text-zinc-600">エビデンス</div>
                                            <textarea
                                              className="min-h-[52px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px]"
                                              value={String(validation?.evidence ?? '')}
                                              onChange={(e) =>
                                                updateStructuredKR(selected.deptIdx, selected.projIdx, idx, {
                                                  validation: { ...(validation ?? {}), evidence: e.target.value },
                                                } as any)
                                              }
                                              disabled={isHydrating || !canEditKr}
                                            />
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              {/* STAGE4 実行計画タブ */}
              {activeTab === 'plan' && selectedProj && (
                <div className="space-y-4">
                  {/* planStatus 遷移 + Approved 解除（new revision） */}
                  <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                    <div className="mb-2 text-[12px] font-semibold text-zinc-700">計画ステータス</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => updatePlanStatus('draft')}
                        disabled={!canTransitionToPlanStatus('draft')}
                        className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition ${
                          getPlanStatus() === 'draft'
                            ? 'bg-zinc-900 text-white'
                            : 'border border-zinc-300 text-zinc-600 hover:bg-zinc-50'
                        }`}
                      >
                        下書き
                      </button>
                      <button
                        onClick={() => updatePlanStatus('review')}
                        disabled={!canTransitionToPlanStatus('review')}
                        className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition ${
                          getPlanStatus() === 'review'
                            ? 'bg-amber-500 text-white'
                            : 'border border-zinc-300 text-zinc-600 hover:bg-amber-50'
                        }`}
                      >
                        レビュー待ち
                      </button>
                      <button
                        onClick={() => updatePlanStatus('approved')}
                        disabled={!canTransitionToPlanStatus('approved')}
                        className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition ${
                          getPlanStatus() === 'approved'
                            ? 'bg-emerald-600 text-white'
                            : 'border border-zinc-300 text-zinc-600 hover:bg-emerald-50'
                        }`}
                      >
                        確定
                      </button>
                      {isApproved() && userRole === 'admin' && (
                        <button
                          onClick={() => {
                            // Approved 解除：新 revision 作成 → draft に戻す
                            if (!selected || !selectedProj) return;
                            patchDepartments((prev) => {
                              const next = [...prev];
                              const dept = next[selected.deptIdx];
                              if (!dept) return prev;
                              const deptCopy = { ...dept };
                              const projs = Array.isArray(deptCopy.projects) ? [...deptCopy.projects] : [];
                              const proj = { ...projs[selected.projIdx] };
                              proj.okrRevision = ((proj.okrRevision ?? 0) as number) + 1;
                              proj.planStatus = 'draft';
                              proj.approvedAt = undefined;
                              proj.approvedBy = undefined;
                              projs[selected.projIdx] = proj;
                              deptCopy.projects = projs;
                              next[selected.deptIdx] = deptCopy;
                              return next;
                            });
                          }}
                          className="ml-auto rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100"
                        >
                          新revision作成（解除）
                        </button>
                      )}
                      <span className="ml-auto text-[11px] text-zinc-500">
                        {userRole === 'admin' ? 'Admin' : userRole === 'manager' ? 'Manager' : 'Member'} ロール
                      </span>
                    </div>
                    {isApproved() && (
                      <div className="mt-2 rounded-lg bg-emerald-50 p-2 text-[11px] text-emerald-700">
                        ✓ このプロジェクトは確定済みです。編集はロックされています。
                      </div>
                    )}
                  </div>

                  {/* スキルプラン CRUD */}
                  <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-[12px] font-semibold text-zinc-700">スキルプラン</div>
                      {!isApproved() && (
                        <button
                          onClick={() => setAddingSkillPlan({ deptIdx: selected.deptIdx, projIdx: selected.projIdx })}
                          className="text-[11px] text-blue-600 hover:underline"
                        >
                          + 追加
                        </button>
                      )}
                    </div>
                    {addingSkillPlan?.deptIdx === selected.deptIdx && addingSkillPlan?.projIdx === selected.projIdx && !isApproved() && (
                      <div className="mb-3 rounded-lg bg-blue-50 p-3 space-y-2">
                        <div className="grid gap-2 md:grid-cols-3">
                          <input
                            autoFocus
                            type="text"
                            placeholder="スキル名（必須）"
                            value={newSkillFormData.skillName}
                            onChange={(e) => setNewSkillFormData({ ...newSkillFormData, skillName: e.target.value })}
                            className="h-9 rounded-lg border border-blue-200 px-3 text-[12px]"
                          />
                          <select
                            value={newSkillFormData.method}
                            onChange={(e) => setNewSkillFormData({ ...newSkillFormData, method: e.target.value as any })}
                            className="h-9 rounded-lg border border-blue-200 px-2 text-[12px]"
                          >
                            <option value="TRAINING">研修</option>
                            <option value="OJT">OJT</option>
                            <option value="HIRE">採用</option>
                            <option value="OUTSOURCE">外部委託</option>
                            <option value="TOOL">ツール/システム</option>
                            <option value="OTHER">その他</option>
                          </select>
                          <input
                            type="number"
                            placeholder="優先度(1-5)"
                            min="1"
                            max="5"
                            value={newSkillFormData.priority}
                            onChange={(e) => setNewSkillFormData({ ...newSkillFormData, priority: e.target.value })}
                            className="h-9 rounded-lg border border-blue-200 px-3 text-[12px]"
                          />
                        </div>
                        <div className="grid gap-2 md:grid-cols-3">
                          <input
                            type="text"
                            placeholder="期限(YYYY-MM)"
                            value={newSkillFormData.dueYm}
                            onChange={(e) => setNewSkillFormData({ ...newSkillFormData, dueYm: e.target.value })}
                            className="h-9 rounded-lg border border-blue-200 px-3 text-[12px]"
                          />
                          <input
                            type="number"
                            placeholder="必要時間(h)"
                            value={newSkillFormData.hours}
                            onChange={(e) => setNewSkillFormData({ ...newSkillFormData, hours: e.target.value })}
                            className="h-9 rounded-lg border border-blue-200 px-3 text-[12px]"
                          />
                          <input
                            type="number"
                            placeholder="予想コスト(¥)"
                            value={newSkillFormData.cost}
                            onChange={(e) => setNewSkillFormData({ ...newSkillFormData, cost: e.target.value })}
                            className="h-9 rounded-lg border border-blue-200 px-3 text-[12px]"
                          />
                        </div>
                        <div className="grid gap-2 md:grid-cols-2">
                          <input
                            type="text"
                            placeholder="担当者"
                            value={newSkillFormData.owner}
                            onChange={(e) => setNewSkillFormData({ ...newSkillFormData, owner: e.target.value })}
                            className="h-9 rounded-lg border border-blue-200 px-3 text-[12px]"
                          />
                          <textarea
                            placeholder="備考"
                            value={newSkillFormData.note}
                            onChange={(e) => setNewSkillFormData({ ...newSkillFormData, note: e.target.value })}
                            className="rounded-lg border border-blue-200 px-3 py-1.5 text-[12px]"
                            rows={2}
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              if (!newSkillFormData.skillName.trim()) {
                                alert('スキル名を入力してください。');
                                return;
                              }
                              patchDepartments((prev) => {
                                const next = [...prev];
                                const dept = { ...next[selected.deptIdx] };
                                const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
                                const proj = { ...projs[selected.projIdx] };
                                const skillPlans = Array.isArray(proj.skillPlans) ? [...proj.skillPlans] : [];
                                const id = (() => {
                                  try { return (crypto as any).randomUUID(); } catch { return `skill-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
                                })();
                                skillPlans.push({
                                  id,
                                  skillName: newSkillFormData.skillName.trim(),
                                  method: newSkillFormData.method,
                                  priority: newSkillFormData.priority ? parseInt(newSkillFormData.priority) : undefined,
                                  dueYm: newSkillFormData.dueYm || undefined,
                                  hours: newSkillFormData.hours ? parseInt(newSkillFormData.hours) : undefined,
                                  cost: newSkillFormData.cost ? parseInt(newSkillFormData.cost) : undefined,
                                  owner: newSkillFormData.owner || undefined,
                                  note: newSkillFormData.note || undefined,
                                });
                                proj.skillPlans = skillPlans;
                                projs[selected.projIdx] = proj;
                                dept.projects = projs;
                                next[selected.deptIdx] = dept;
                                return next;
                              });
                              setNewSkillFormData({
                                skillName: '',
                                method: 'TRAINING',
                                priority: '',
                                dueYm: '',
                                hours: '',
                                cost: '',
                                owner: '',
                                note: '',
                              });
                              setAddingSkillPlan(null);
                            }}
                            className="flex-1 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700"
                          >
                            追加
                          </button>
                          <button
                            onClick={() => {
                              setNewSkillFormData({
                                skillName: '',
                                method: 'TRAINING',
                                priority: '',
                                dueYm: '',
                                hours: '',
                                cost: '',
                                owner: '',
                                note: '',
                              });
                              setAddingSkillPlan(null);
                            }}
                            className="rounded-lg bg-zinc-300 px-3 py-1.5 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-400"
                          >
                            キャンセル
                          </button>
                        </div>
                      </div>
                    )}
                    <ul className="space-y-1.5">
                      {(selectedProj.skillPlans || []).map((skill, idx) => (
                        <li key={skill.id} className="flex items-center gap-2 rounded-lg bg-zinc-50 p-2">
                          <div className="flex-1 text-[12px]">
                            <div className="font-semibold">{skill.skillName}</div>
                            <div className="text-[10px] text-zinc-600">
                              {[skill.priority && `優先度:${skill.priority}`, skill.method, skill.dueYm && `期限:${skill.dueYm}`, skill.cost && `¥${skill.cost.toLocaleString()}`].filter(Boolean).join(' | ')}
                            </div>
                          </div>
                          {!isApproved() && (
                            <button
                              onClick={() => {
                                patchDepartments((prev) => {
                                  const next = [...prev];
                                  const dept = { ...next[selected.deptIdx] };
                                  const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
                                  const proj = { ...projs[selected.projIdx] };
                                  proj.skillPlans = (proj.skillPlans || []).filter((_, i) => i !== idx);
                                  projs[selected.projIdx] = proj;
                                  dept.projects = projs;
                                  next[selected.deptIdx] = dept;
                                  return next;
                                });
                              }}
                              className="text-[11px] text-rose-600 hover:text-rose-700"
                            >
                              削除
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>

                    {/* 人的投資計画（ExecutionHumanInvestment） */}
                    <div className="mt-6 rounded-lg border border-purple-200 bg-purple-50 p-3">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-[12px] font-semibold text-purple-900">人的投資計画</div>
                        {!isApproved() && (
                          <button
                            onClick={() => setAddingHumanInvestment({ deptIdx: selected.deptIdx, projIdx: selected.projIdx })}
                            className="text-[11px] text-purple-600 hover:underline"
                          >
                            + 追加
                          </button>
                        )}
                      </div>
                      {addingHumanInvestment?.deptIdx === selected.deptIdx && addingHumanInvestment?.projIdx === selected.projIdx && !isApproved() && (
                        <div className="mb-3 rounded-lg bg-white p-3 space-y-2">
                          <div className="grid gap-2 md:grid-cols-3">
                            <select
                              value={newInvestFormData.type}
                              onChange={(e) => setNewInvestFormData({ ...newInvestFormData, type: e.target.value as any })}
                              className="h-9 rounded-lg border border-purple-200 px-2 text-[12px]"
                            >
                              <option value="HIRE">採用</option>
                              <option value="TRAINING">研修</option>
                              <option value="OUTSOURCE">外部委託</option>
                              <option value="SYSTEM">システム</option>
                              <option value="TOOL">ツール</option>
                              <option value="OTHER">その他</option>
                            </select>
                            <input
                              type="number"
                              placeholder="金額(¥)"
                              value={newInvestFormData.amount}
                              onChange={(e) => setNewInvestFormData({ ...newInvestFormData, amount: e.target.value })}
                              className="h-9 rounded-lg border border-purple-200 px-3 text-[12px]"
                            />
                            <input
                              type="text"
                              placeholder="実行時期(YYYY-MM)"
                              value={newInvestFormData.timingYm}
                              onChange={(e) => setNewInvestFormData({ ...newInvestFormData, timingYm: e.target.value })}
                              className="h-9 rounded-lg border border-purple-200 px-3 text-[12px]"
                            />
                          </div>
                          <div className="grid gap-2 md:grid-cols-2">
                            <input
                              type="number"
                              placeholder="人数"
                              value={newInvestFormData.headcount}
                              onChange={(e) => setNewInvestFormData({ ...newInvestFormData, headcount: e.target.value })}
                              className="h-9 rounded-lg border border-purple-200 px-3 text-[12px]"
                            />
                            <input
                              type="text"
                              placeholder="チーム/部署"
                              value={newInvestFormData.team}
                              onChange={(e) => setNewInvestFormData({ ...newInvestFormData, team: e.target.value })}
                              className="h-9 rounded-lg border border-purple-200 px-3 text-[12px]"
                            />
                          </div>
                          <textarea
                            placeholder="備考"
                            value={newInvestFormData.note}
                            onChange={(e) => setNewInvestFormData({ ...newInvestFormData, note: e.target.value })}
                            className="rounded-lg border border-purple-200 px-3 py-1.5 text-[12px]"
                            rows={2}
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                const amount = newInvestFormData.amount ? parseInt(newInvestFormData.amount) : undefined;
                                const headcount = newInvestFormData.headcount ? parseInt(newInvestFormData.headcount) : undefined;
                                if (!Number.isFinite(amount) && !Number.isFinite(headcount)) {
                                  alert('金額または人数を入力してください。');
                                  return;
                                }
                                patchDepartments((prev) => {
                                  const next = [...prev];
                                  const dept = { ...next[selected.deptIdx] };
                                  const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
                                  const proj = { ...projs[selected.projIdx] };
                                  const investments = Array.isArray(proj.executionHumanInvestments) ? [...proj.executionHumanInvestments] : [];
                                  const id = (() => {
                                    try { return (crypto as any).randomUUID(); } catch { return `invest-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
                                  })();
                                  investments.push({
                                    id,
                                    type: newInvestFormData.type,
                                    amount,
                                    timingYm: newInvestFormData.timingYm || undefined,
                                    headcount,
                                    team: newInvestFormData.team || undefined,
                                    note: newInvestFormData.note || undefined,
                                  });
                                  proj.executionHumanInvestments = investments;
                                  projs[selected.projIdx] = proj;
                                  dept.projects = projs;
                                  next[selected.deptIdx] = dept;
                                  return next;
                                });
                                setNewInvestFormData({
                                  type: 'HIRE',
                                  amount: '',
                                  timingYm: '',
                                  headcount: '',
                                  team: '',
                                  note: '',
                                });
                                setAddingHumanInvestment(null);
                              }}
                              className="flex-1 rounded-lg bg-purple-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-purple-700"
                            >
                              追加
                            </button>
                            <button
                              onClick={() => {
                                setNewInvestFormData({
                                  type: 'HIRE',
                                  amount: '',
                                  timingYm: '',
                                  headcount: '',
                                  team: '',
                                  note: '',
                                });
                                setAddingHumanInvestment(null);
                              }}
                              className="rounded-lg bg-zinc-300 px-3 py-1.5 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-400"
                            >
                              キャンセル
                            </button>
                          </div>
                        </div>
                      )}
                      <ul className="space-y-1.5">
                        {(selectedProj.executionHumanInvestments || []).map((invest, idx) => (
                          <li key={invest.id} className="flex items-center gap-2 rounded-lg bg-white p-2">
                            <div className="flex-1 text-[12px]">
                              <div className="font-semibold">{invest.type}</div>
                              <div className="text-[10px] text-zinc-600">
                                {[invest.amount && `¥${invest.amount.toLocaleString()}`, invest.timingYm && `${invest.timingYm}実行`, invest.headcount && `${invest.headcount}人`, invest.team && `${invest.team}`].filter(Boolean).join(' | ')}
                              </div>
                              {invest.note && <div className="text-[10px] text-zinc-600 mt-1">{invest.note}</div>}
                            </div>
                            {!isApproved() && (
                              <button
                                onClick={() => {
                                  patchDepartments((prev) => {
                                    const next = [...prev];
                                    const dept = { ...next[selected.deptIdx] };
                                    const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
                                    const proj = { ...projs[selected.projIdx] };
                                    proj.executionHumanInvestments = (proj.executionHumanInvestments || []).filter((_, i) => i !== idx);
                                    projs[selected.projIdx] = proj;
                                    dept.projects = projs;
                                    next[selected.deptIdx] = dept;
                                    return next;
                                  });
                                }}
                                className="text-[11px] text-rose-600 hover:text-rose-700"
                              >
                                削除
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Baseline 差分パネル */}
                  {executionPlanBaseline?.snapshot && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <GitCompare className="h-4 w-4 text-amber-700" />
                        <div className="text-[12px] font-semibold text-amber-900">Baseline との差分</div>
                      </div>
                      {(() => {
                        if (!Array.isArray(executionPlanBaseline.snapshot)) return <div className="text-[11px] text-amber-700">差分なし</div>;
                        const baselineDepts = executionPlanBaseline.snapshot;
                        const baseDept = baselineDepts?.[selected?.deptIdx];
                        const baseProj: Project | undefined = baseDept?.projects?.[selected?.projIdx];
                        if (!baseProj) return <div className="text-[11px] text-amber-700">差分なし</div>;

                        const baselineKrs = ensureArray(baseProj.okrsV2) as typeof committedOkrsV2;
                        const currentKrs = committedOkrsV2;
                        const krDiffItems = diffKrSets(baselineKrs, currentKrs);
                        const krAdded = krDiffItems.filter((d: any) => d.type === 'added').length;
                        const krRemoved = krDiffItems.filter((d: any) => d.type === 'removed').length;
                        const krChanged = krDiffItems.filter((d: any) => d.type === 'changed').length;

                        // スキルプラン：id 優先で added/removed/changed 判定
                        const baselineSkills = (baseProj.skillPlans || []) as Array<{ id: string; skillName: string; priority?: number; method?: string; cost?: number }>;
                        const currentSkills = (selectedProj.skillPlans || []) as Array<{ id: string; skillName: string; priority?: number; method?: string; cost?: number }>;
                        const baselineSkillIds = new Set(baselineSkills.map(s => s.id));
                        const currentSkillIds = new Set(currentSkills.map(s => s.id));
                        const skillAdded = currentSkills.filter(s => !baselineSkillIds.has(s.id)).length;
                        const skillRemoved = baselineSkills.filter(s => !currentSkillIds.has(s.id)).length;
                        const skillChanged = baselineSkills.filter((s): boolean => {
                          const curr = currentSkills.find(c => c.id === s.id);
                          return !!(curr && (s.skillName !== curr.skillName || s.priority !== curr.priority || s.method !== curr.method || s.cost !== curr.cost));
                        }).length;

                        // 人的投資：id 優先で added/removed/changed 判定
                        const baselineInvests = (baseProj.executionHumanInvestments || []) as Array<{ id: string; type: string; amount?: number; timingYm?: string }>;
                        const currentInvests = (selectedProj.executionHumanInvestments || []) as Array<{ id: string; type: string; amount?: number; timingYm?: string }>;
                        const baselineInvestIds = new Set(baselineInvests.map(i => i.id));
                        const currentInvestIds = new Set(currentInvests.map(i => i.id));
                        const investAdded = currentInvests.filter(i => !baselineInvestIds.has(i.id)).length;
                        const investRemoved = baselineInvests.filter(i => !currentInvestIds.has(i.id)).length;
                        const investChanged = baselineInvests.filter((i): boolean => {
                          const curr = currentInvests.find(c => c.id === i.id);
                          return !!(curr && (i.type !== curr.type || i.amount !== curr.amount || i.timingYm !== curr.timingYm));
                        }).length;

                        return (
                          <div className="space-y-1 text-[11px] text-amber-800">
                            <div>
                              <strong>KR:</strong> 追加{krAdded} / 削除{krRemoved} / 変更{krChanged}
                            </div>
                            <div>
                              <strong>スキル:</strong> 追加{skillAdded} / 削除{skillRemoved} / 変更{skillChanged}
                            </div>
                            <div>
                              <strong>投資:</strong> 追加{investAdded} / 削除{investRemoved} / 変更{investChanged}
                            </div>
                            <div>
                              <strong>ステータス:</strong> {baseProj.planStatus ?? 'draft'} → {getPlanStatus()}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* 再計算プレビュー（approved 時のみ） */}
                  {isApproved() && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                      <div className="mb-3 text-[12px] font-semibold text-emerald-900">実行計画プレビュー</div>
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="rounded-lg bg-white p-3">
                          <div className="text-[11px] text-zinc-600">投資合計</div>
                          <div className="mt-2 text-[16px] font-semibold text-emerald-600">
                            {(() => {
                              const total = (selectedProj.executionHumanInvestments || []).reduce((sum, inv) => sum + (inv.amount || 0), 0) +
                                            (selectedProj.skillPlans || []).reduce((sum, sk) => sum + (sk.cost || 0), 0);
                              return total > 0 ? `¥${total.toLocaleString()}` : '未設定';
                            })()}
                          </div>
                        </div>
                        <div className="rounded-lg bg-white p-3">
                          <div className="text-[11px] text-zinc-600">月別集計（上位3件）</div>
                          <div className="mt-2 space-y-0.5 text-[10px] text-zinc-700">
                            {(() => {
                              const monthly: Record<string, number> = {};
                              ((selectedProj.executionHumanInvestments || []) as Array<{ timingYm?: string; amount?: number }>).forEach((inv: any) => {
                                if (inv.timingYm) monthly[inv.timingYm] = (monthly[inv.timingYm] || 0) + (inv.amount || 0);
                              });
                              const entries = Object.entries(monthly) as Array<[string, number]>;
                              return entries.length > 0
                                ? entries.sort(([, a], [, b]) => b - a).slice(0, 3).map(([ym, amount]) => <div key={ym}>{ym}: ¥{amount.toLocaleString()}</div>)
                                : <div>-</div>;
                            })()}
                          </div>
                        </div>
                        <div className="rounded-lg bg-white p-3">
                          <div className="text-[11px] text-zinc-600">確定KR数</div>
                          <div className="mt-2 text-[16px] font-semibold text-emerald-600">{committedOkrsV2.length}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <SaveDock />
    </main>
  );
}
