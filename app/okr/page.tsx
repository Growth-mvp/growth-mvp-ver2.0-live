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
import { useCapabilities } from '@/hooks/useCapabilities';
import SaveStatusIndicator from '@/components/SaveStatusIndicator';
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
 * メイン
 * ========================================================== */
const ROLE_OPTIONS: Array<{ value: ProjectRole; label: string }> = [
  { value: 'revenue', label: 'ロール：収益（売上を伸ばす）' },
  { value: 'cost', label: 'ロール：コスト（費用を抑える）' },
  { value: 'future', label: 'ロール：未来（投資・成功確率）' },
  { value: 'global', label: 'ロール：全社連携（シナジー）' },
];

// ★STAGE4拡張：新しい role フィールド（財務レバー）用オプション
const FINANCIAL_ROLE_OPTIONS: Array<{ value: Project['role']; label: string }> = [
  { value: 'REVENUE', label: '売上' },
  { value: 'COST', label: 'コスト' },
  { value: 'FUTURE', label: '将来投資' },
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

  useAutoSave({
    enabled: !isHydrating,
    requireHydrated: true,
    requireSession: true,
    debounceMs: 1200,
    minIntervalMs: 1500,
    mode: 'payload',
  });

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
  const [showRoleDetail, setShowRoleDetail] = useState<boolean>(false);

  /* STAGE4: 投資・スキルフォームの初期非表示状態管理 */
  const [showInvestmentForm, setShowInvestmentForm] = useState<boolean>(false);
  const [showSkillForm, setShowSkillForm] = useState<boolean>(false);

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


// Milestone フォーム（タスク名＋期限）
const [newMilestoneFormData, setNewMilestoneFormData] = useState<{ title: string; dueYm: string }>({
  title: '',
  dueYm: '',
});
const [editingMilestoneIdx, setEditingMilestoneIdx] = useState<number | null>(null);


  const toggleKrDetail = (key: string) => {
    setKrDetailOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  /* ============================================================
   * STAGE4: planStatus ロジック・permission チェック
   * ========================================================== */
  const capabilities = useCapabilities();

  const getPlanStatus = (): string => selectedProj?.planStatus ?? 'draft';
  const isApproved = (): boolean => getPlanStatus() === 'approved';
  const isReview = (): boolean => getPlanStatus() === 'review';

  const canTransitionToPlanStatus = (targetStatus: string): boolean => {
    if (capabilities.canEditStrategy) return true;  // admin or manager
    return false;
  };

  const canEditContent = (): boolean => {
    if (isApproved()) return false; // approved はロック
    return true;
  };

  const updatePlanStatus = (status: 'draft' | 'review' | 'approved') => {
    if (!selected || !selectedProj || !canTransitionToPlanStatus(status)) return;

    patchDepartments((prev: any) => {
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

  /* Phase1.4: 統合フォームモード（二重表示防止） */
  const INTEGRATED = true;

  /* STAGE4: 3カード統一フォーマット（保存非破壊・旧UI隔離） */
  const SIMPLE_FORM = true;

  /* 参考OKR表示トグル（デフォルト閉） */
  const [showCascadeOkr, setShowCascadeOkr] = useState<boolean>(false);

  const [addingProjectForDept, setAddingProjectForDept] = useState<number | null>(null);
  const [newProjectTitle, setNewProjectTitle] = useState<string>('');

  

// stable id generator (client-safe)
const cryptoRandomId = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = (globalThis as any).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {}
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const keyFor = (dIdx: number, pIdx: number) => `${dIdx}:${pIdx}`;

  // ===== selection stabilization (index drift guard) =====
  const selectedStableRef = useRef<{ deptKey: string; projKey: string } | null>(null);
  const deptKeyOf = (d: any) => String(d?.id ?? d?.name ?? '');
  const projKeyOf = (p: any) => String(p?.id ?? p?.title ?? p?.name ?? '');


  const startAddProject = (deptIdx: number) => {
    if (isHydrating) return;
    setAddingProjectForDept(deptIdx);
    setNewProjectTitle('');
  };

  const cancelAddProject = () => {
    setAddingProjectForDept(null);
    setNewProjectTitle('');
  };

  const addProjectToDepartment = (deptIdx: number) => {
    if (isHydrating) return;
    const title = newProjectTitle.trim();
    if (!title) return;

    let newProjIdx = 0;

    patchDepartments((prev: any) => {
      const next = Array.isArray(prev) ? [...prev] : [];
      const dept = { ...(next[deptIdx] as any) };
      const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];

      newProjIdx = projs.length;

      const newProj: any = {
        title: String(title),
        okrs: [{ objective: '', owner: '', due: '' }],
        okrsV2: [],
        executionHumanInvestments: [],
        skillPlans: [],
        planStatus: 'draft',
      };

      projs.push(newProj);
      dept.projects = projs;
      next[deptIdx] = dept;
      return next;
    });

    // select the newly added project (explicit user action only)
    setSelected({ deptIdx, projIdx: newProjIdx });
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
    updateProjectRoleDetail,
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

    patchDepartments((prev: any) => {
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

    

  /* -------- 選択の安定化（index drift 防止 / 無限ループ対策） -------- */
  useEffect(() => {
    // 初期は「未選択」を維持（右パネルに勝手に出さない）
    if (!selected) return;

    if (!Array.isArray(cascade) || cascade.length === 0) {
      setSelected(null);
      return;
    }

    // ✅ まず「いまの index が有効なら何もしない」
    const dNow = cascade[selected.deptIdx];
    const pNow = dNow ? ensureArray(dNow.projects) : [];
    const nowValid = !!dNow && selected.projIdx >= 0 && selected.projIdx < pNow.length;
    if (nowValid) return;

    // ❗ index が壊れているときだけ stable key で復元を試みる（ここ以外では setSelected しない）
    const stable = selectedStableRef.current;
    if (stable) {
      for (let di = 0; di < cascade.length; di += 1) {
        const d = cascade[di];
        if (deptKeyOf(d) !== stable.deptKey) continue;
        const projs = ensureArray(d.projects);
        for (let pi = 0; pi < projs.length; pi += 1) {
          if (projKeyOf(projs[pi]) === stable.projKey) {
            setSelected({ deptIdx: di, projIdx: pi });
            return;
          }
        }
      }
    }

    // 復元できない場合は未選択に戻す（勝手に別プロジェクトへ飛ばさない）
    setSelected(null);
  }, [cascade, selected]);

  // 選択が確定したタイミングで stable key を更新
  useEffect(() => {
    if (!selectedDept || !selectedProj) return;
    const dk = deptKeyOf(selectedDept);
    const pk = projKeyOf(selectedProj);
    if (!dk || !pk) return;
    selectedStableRef.current = { deptKey: dk, projKey: pk };
  }, [selectedAddKey]);

  /* -------- 選択プロジェクトが変わったら、mode を安全側（committed）に戻す -------- */
  useEffect(() => {
    setEditingMode('committed');
  }, [selectedAddKey]);

  // SIMPLE_FORM では探索案（variant）を使わない：確定（committed）だけを編集対象にする
  const currentKrList: KRStructuredX[] = useMemo(() => {
    if (!selectedProj) return [];
    return committedOkrsV2;
  }, [selectedProj, committedOkrsV2]);

    /* -------- 初期補修：KR id 補完 + label 正規化（committed + variants） -------- */
  useEffect(() => {
    if (!Array.isArray(departments) || departments.length === 0) return;

    // 既存ヘルパ（id補完）＋ label 正規化（[object Object] 根絶）
    const withIds = ensureKrIds(departments as Department[]);

    let changed = false;
    const patched = (withIds as Department[]).map((d) => {
      const projs = ensureArray(d.projects);
      let deptChanged = false;

      const nextProjs = projs.map((p) => {
        let projChanged = false;

        const normalizeList = (list: any[] | undefined) => {
          const src = ensureArray(list);
          let localChanged = false;

          const dst = src.map((kr) => {
            const before = kr ?? {};
            const after = { ...(before as any) };

            if (after.label != null && typeof after.label !== 'string') {
              after.label = String(after.label);
              localChanged = true;
            }
            if (typeof after.label === 'string' && after.label.includes('[object Object]')) {
              after.label = '';
              localChanged = true;
            }
            if (after.label == null) {
              after.label = '';
              localChanged = true;
            }

            return localChanged ? after : before;
          });

          if (localChanged) changed = true;
          return localChanged ? dst : src;
        };

        const okrsV2Fixed = normalizeList((p as any).okrsV2);
        let variantsFixed = (p as any).okrVariants;

        if (Array.isArray((p as any).okrVariants)) {
          const v2 = (p as any).okrVariants.map((v: any) => {
            const fixed = normalizeList(v?.okrsV2);
            if (fixed !== v?.okrsV2) {
              projChanged = true;
              return { ...v, okrsV2: fixed };
            }
            return v;
          });
          variantsFixed = v2;
        }

        if (okrsV2Fixed !== (p as any).okrsV2) projChanged = true;

        if (projChanged) {
          deptChanged = true;
          return { ...(p as any), okrsV2: okrsV2Fixed, okrVariants: variantsFixed };
        }
        return p;
      });

      if (deptChanged) return { ...d, projects: nextProjs };
      return d;
    });

    const finalPatched = changed || withIds !== departments ? patched : (departments as Department[]);
    if (finalPatched !== departments) patchDepartments(() => finalPatched);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments?.length]);

  /* ============================================================
   * プロジェクト切替時：ロール詳細パネルの表示/非表示を自動設定
   * - selectedProj?.roleDetail が存在するなら詳細を開く
   * - role === 'FUTURE' or role未設定なら強制的に閉じる
   * ========================================================== */
  useEffect(() => {
    if (!selectedProj) {
      setShowRoleDetail(false);
      return;
    }

    // FUTURE または role 未設定の場合は強制的に閉じる
    if (!selectedProj.role || selectedProj.role === 'FUTURE') {
      setShowRoleDetail(false);
      return;
    }

    // roleDetail が存在するなら開く、そうでなければ閉じる
    setShowRoleDetail(!!selectedProj.roleDetail);
  }, [selected?.deptIdx, selected?.projIdx]);

  /* -------- 初回自動：カスケードOKR → 構造化KR へ一括変換（committedのみ） -------- */
  useEffect(() => {
    if (!Array.isArray(cascade) || cascade.length === 0) return;

    patchDepartments((prev: any) => {
      const next = [...prev];
      let anyChanged = false;

      next.forEach((d, di) => {
        const projList = ensureArray(d.projects) as any[];
        let deptChanged = false;

        const newProjs = projList.map((p: any) => {
          const okrs = ensureArray(p.okrs as OKR[] | undefined);
          if (!okrs.length) return p;

          const existing: KRStructuredX[] = Array.isArray(p.okrsV2) ? [...(p.okrsV2 as KRStructuredX[])] : [];
          let projChanged = false;

          okrs.forEach((o) => {
            const ownerHint = o.owner;
            const krs = ensureArray(o.keyResults as string[] | undefined);

            krs.forEach((krText) => {
              const label = String(krText ?? '').trim();
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

// KPI（成果指標） 行の編集UI（SIMPLE_FORM：最低限の項目のみ）
const [editingKrId, setEditingKrId] = useState<string | null>(null);
const [editingKrDraft, setEditingKrDraft] = useState<{
  label: string;
  target: string;
  unit: Draft['unit'];
  due: string;
  owner: string;
} | null>(null);

const startEditKr = (kr: any, fallbackId: string) => {
  const id = String(kr?.id ?? fallbackId);
  setEditingKrId(id);
  setEditingKrDraft({
    label: String(kr?.label ?? ''),
    target: String(kr?.target ?? ''),
    unit: (String(kr?.unit ?? '件') as Draft['unit']) ?? '件',
    due: String(kr?.due ?? ''),
    owner: String(kr?.owner ?? ''),
  });
};

const cancelEditKr = () => {
  setEditingKrId(null);
  setEditingKrDraft(null);
};

const saveEditKr = (dIdx: number, pIdx: number, krId: string) => {
  if (!editingKrDraft) return;
  const t = Number(editingKrDraft.target);
  if (!Number.isFinite(t)) {
    alert('目標値は数値で入力してください。');
    return;
  }
  const nextLabel = editingKrDraft.label.trim();
  if (!nextLabel) {
    alert('名称（ラベル）を入力してください。');
    return;
  }

  patchDepartments((prev: any) => {
    const next = [...prev];
    const dept = { ...next[dIdx] };
    const projs = ensureArray(dept.projects);
    const proj = { ...(projs[pIdx] as any) };

    const list: any[] = Array.isArray(proj.okrsV2) ? [...proj.okrsV2] : [];
    const ni = list.findIndex((x) => String(x?.id ?? '') === krId);
    if (ni < 0) return prev;

    const before = list[ni] ?? {};
    list[ni] = {
      ...before,
      label: nextLabel,
      target: t,
      unit: editingKrDraft.unit,
      due: editingKrDraft.due?.trim() || undefined,
      owner: editingKrDraft.owner?.trim() || undefined,
    };

    proj.okrsV2 = list;
    projs[pIdx] = proj;
    dept.projects = projs;
    next[dIdx] = dept;
    return next;
  });

  cancelEditKr();
};

const deleteKr = (dIdx: number, pIdx: number, krId: string) => {
  patchDepartments((prev: any) => {
    const next = [...prev];
    const dept = { ...next[dIdx] };
    const projs = ensureArray(dept.projects);
    const proj = { ...(projs[pIdx] as any) };

    const list: any[] = Array.isArray(proj.okrsV2) ? [...proj.okrsV2] : [];
    const filtered = list.filter((x) => String(x?.id ?? '') !== krId);
    if (filtered.length === list.length) return prev;

    proj.okrsV2 = filtered;
    projs[pIdx] = proj;
    dept.projects = projs;
    next[dIdx] = dept;
    return next;
  });

  if (editingKrId === krId) cancelEditKr();
};


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
    setOpenAdd((m: any) => ({ ...m, [k]: false }));
  };

  const getRoleLabel = (role?: Project['role'] | null) => {
    if (!role) return 'ロール未設定';
    const found = FINANCIAL_ROLE_OPTIONS.find((r) => r.value === role);
    return found ? found.label : 'ロール未設定';
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
   * renderSimpleRight: 右ペイン新UI（3カード＋完了チェック）- section内容のみ
   * ========================================================== */
  const renderSimpleRight = () => {
    if (selected === null || !selectedProj || !selectedDept) return null;

    return (
      <div>

        

        <div className="grid gap-6 grid-cols-[1.2fr_1.2fr_1.2fr]">
          {/* ========== Card 1: 目的（何のため？） ========== */}
          <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-[16px] font-semibold text-zinc-900">目的（何のため？）</h2>

            {/* Objective */}
            <div className="mb-4 space-y-2">
              <label className="text-[11px] font-semibold text-zinc-700">目的（必須）</label>
              <textarea
                className="min-h-[100px] w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[13px]"
                placeholder="例：既存顧客からのアップセルと新規顧客獲得を両立し、売上成長の軸を確立する"
                value={mainOKR?.objective ?? ''}
                onChange={(e) => updateProjectOKR(selected.deptIdx, selected.projIdx, { objective: e.target.value })}
                disabled={isHydrating || isApproved()}
              />
            </div>

            {/* ★STAGE4拡張：ロール（財務レバー） */}
            <div className="mb-4 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-zinc-700">ロール（財務レバー）</label>
                {!selectedProj?.role && (
                  <span className="rounded-full bg-zinc-100 px-2 py-1 text-[10px] font-semibold text-zinc-600">
                    ロール未設定
                  </span>
                )}
              </div>

              {/* ロール3択 */}
              <div className="flex gap-2">
                {[
                  { value: 'REVENUE' as const, label: '売上' },
                  { value: 'COST' as const, label: 'コスト' },
                  { value: 'FUTURE' as const, label: '将来投資' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      if (!selected) return;
                      updateProjectRole(selected.deptIdx, selected.projIdx, selectedProj?.role === opt.value ? '' : opt.value);
                      setShowRoleDetail(false);
                    }}
                    disabled={isHydrating || isApproved()}
                    className={`flex-1 rounded-lg border-2 px-3 py-2 text-[12px] font-semibold transition-colors ${
                      selectedProj?.role === opt.value
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* 詳細設定トグル＆サブカテゴリ（roleがREVENUEまたはCOSTの時のみ） */}
              {selectedProj?.role && selectedProj.role !== 'FUTURE' && (
                <div className="mt-3 space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowRoleDetail(!showRoleDetail)}
                    className="text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                  >
                    {showRoleDetail ? '▼ 詳細設定' : '▶ 詳細設定'}
                  </button>

                  {showRoleDetail && (
                    <div>
                      <label className="text-[11px] font-semibold text-zinc-700">
                        {selectedProj.role === 'REVENUE' ? '売上' : 'コスト'}の詳細（任意）
                      </label>
                      <select
                        value={selectedProj?.roleDetail ?? ''}
                        onChange={(e) => {
                          if (!selected) return;
                          updateProjectRoleDetail(selected.deptIdx, selected.projIdx, e.target.value as Project['roleDetail'] | '');
                        }}
                        disabled={isHydrating || isApproved()}
                        className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                      >
                        <option value="">未選択</option>
                        {selectedProj.role === 'REVENUE' && (
                          <>
                            <option value="ACQ">新規獲得</option>
                            <option value="CHURN">継続率改善</option>
                            <option value="ARPU">単価改善</option>
                          </>
                        )}
                        {selectedProj.role === 'COST' && (
                          <>
                            <option value="PERSONNEL">人件費</option>
                            <option value="FIXED">固定費</option>
                            <option value="VARIABLE">変動費</option>
                          </>
                        )}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Owner */}
            <div className="mb-4 space-y-2">
              <label className="text-[11px] font-semibold text-zinc-700">オーナー（任意）</label>
              <input
                className="h-9 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-[13px]"
                placeholder="氏名や役職など"
                value={mainOKR?.owner ?? ''}
                onChange={(e) => updateProjectOKR(selected.deptIdx, selected.projIdx, { owner: e.target.value })}
                disabled={isHydrating || isApproved()}
              />
            </div>

            {/* Due Date */}
            <div className="mb-4 space-y-2">
              <label className="text-[11px] font-semibold text-zinc-700">期限（任意 / YYYY-MM）</label>
              <input
                className="h-9 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-[13px]"
                placeholder="2026-03"
                value={mainOKR?.due ?? ''}
                onChange={(e) => updateProjectOKR(selected.deptIdx, selected.projIdx, { due: e.target.value })}
                disabled={isHydrating || isApproved()}
              />
            </div>

            {/* Reference OKR - Hidden in SIMPLE_FORM */}
            {false && selectedOkrs.length > 0 && (
              <details className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-3">
                <summary className="cursor-pointer text-[12px] font-semibold text-zinc-700 hover:text-zinc-900">
                  参考：カスケードで生成されたOKR（{selectedOkrs.length}件）
                </summary>
                <div className="mt-3 space-y-2 text-[12px] text-zinc-600">
                  {selectedOkrs.map((o, oi) => (
                    <div key={oi} className="rounded-lg bg-white p-2">
                      <div className="font-semibold text-zinc-800">
                        Objective：<span className="font-normal">{o.objective || '（未設定）'}</span>
                      </div>
                      {o.owner && <div className="mt-1 text-[11px] text-zinc-600">オーナー：{o.owner}</div>}
                      {Array.isArray(o.keyResults) && o.keyResults.length > 0 && (
                        <ul className="mt-1 list-disc pl-4 text-[11px] text-zinc-700">
                          {o.keyResults.map((kr: any, ki: number) => (
                            <li key={ki}>{kr}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          {/* ========== Card 2: 成果指標（KPI） ========== */}
          <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-[16px] font-semibold text-zinc-900">成果指標（KPI）</h2>

            {/* Add Button */}
            <div className="mb-4">
              <button
                onClick={() => setOpenAdd((m: any) => ({ ...m, [selectedAddKey]: !selectedIsOpen }))}
                disabled={isHydrating || !canEditKr}
                className="w-full h-9 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px] font-semibold text-zinc-800 hover:bg-zinc-50 disabled:bg-zinc-200 disabled:text-zinc-500"
              >
                <span className="inline-flex items-center gap-1">
                  <Plus className="h-4 w-4" /> KPI を追加
                </span>
              </button>
            </div>

            {/* KPI Add Form */}
            {selectedIsOpen && (
              <div className="mb-4 rounded-xl border border-dashed border-amber-200 bg-amber-50 p-4">
                <div className="mb-3 text-[12px] font-semibold text-amber-900">新しいKPIを追加</div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-semibold text-zinc-700">KPI名（必須）</label>
                    <input
                      type="text"
                      className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                      placeholder="例：新規顧客獲得数"
                      value={selectedDraft.label}
                      onChange={(e) => setDraft(selectedAddKey, { label: e.target.value })}
                      disabled={isHydrating}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-semibold text-zinc-700">目標値（必須）</label>
                      <input
                        type="text"
                        className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                        placeholder="例：100"
                        value={selectedDraft.target}
                        onChange={(e) => setDraft(selectedAddKey, { target: e.target.value })}
                        disabled={isHydrating}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-zinc-700">単位</label>
                      <input
                        type="text"
                        className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                        placeholder="例：件"
                        value={selectedDraft.unit}
                        onChange={(e) => setDraft(selectedAddKey, { unit: (e.target.value as Draft['unit']) })}
                        disabled={isHydrating}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-semibold text-zinc-700">期限（YYYY-MM）</label>
                      <input
                        type="text"
                        className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                        placeholder="例：2026-06"
                        value={selectedDraft.due}
                        onChange={(e) => setDraft(selectedAddKey, { due: e.target.value })}
                        disabled={isHydrating}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-zinc-700">担当</label>
                      <input
                        type="text"
                        className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                        placeholder="例：氏名"
                        value={selectedDraft.owner}
                        onChange={(e) => setDraft(selectedAddKey, { owner: e.target.value })}
                        disabled={isHydrating}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => addStructuredKRFromDraft(selected.deptIdx, selected.projIdx)}
                      disabled={isHydrating}
                      className="flex-1 h-9 rounded-lg bg-amber-600 px-3 text-[12px] font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      追加
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        resetDraft(selectedAddKey);
                        setOpenAdd((m: any) => ({ ...m, [selectedAddKey]: false }));
                      }}
                      disabled={isHydrating}
                      className="flex-1 h-9 rounded-lg border border-zinc-200 bg-white px-3 text-[12px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* KR List */}
            <div className="space-y-2">
              {currentKrList.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-3 text-center">
                  <p className="text-[12px] text-zinc-600">KPIがまだありません</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {currentKrList.map((kr, idx) => {
  const rowId = String((kr as any)?.id ?? `${idx}`);
  const isEditing = editingKrId === rowId;

  const rawLabel = (kr as any).label;
  const safeLabel =
    rawLabel == null ? '' : typeof rawLabel === 'string' ? rawLabel : String(rawLabel);

  const label = safeLabel.includes('[object Object]') ? '' : safeLabel;
  const target = String((kr as any).target ?? '');
  const unit = String((kr as any).unit ?? '件') as Draft['unit'];
  const due = String((kr as any).due ?? '');
  const owner = String((kr as any).owner ?? '');

  if (safeLabel && safeLabel.includes('[object Object]')) {
    console.debug(`[KRI Bug Guard] KR ${idx} has invalid label:`, kr);
  }

  return (
    <div key={rowId} className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      {isEditing && editingKrDraft ? (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2">
            <div>
              <div className="text-[11px] font-semibold text-zinc-700 mb-1">名称</div>
              <input
                value={editingKrDraft.label}
                onChange={(e) => setEditingKrDraft({ ...editingKrDraft, label: e.target.value })}
                className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[11px] font-semibold text-zinc-700 mb-1">目標値</div>
                <input
                  value={editingKrDraft.target}
                  onChange={(e) => setEditingKrDraft({ ...editingKrDraft, target: e.target.value })}
                  className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                  inputMode="decimal"
                />
              </div>
              <div>
                <div className="text-[11px] font-semibold text-zinc-700 mb-1">単位</div>
                <select
                  value={editingKrDraft.unit}
                  onChange={(e) =>
                    setEditingKrDraft({ ...editingKrDraft, unit: e.target.value as Draft['unit'] })
                  }
                  className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-[13px]"
                >
                  <option value="件">件</option>
                  <option value="%">%</option>
                  <option value="¥">¥</option>
                  <option value="人">人</option>
                  <option value="比率">比率</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[11px] font-semibold text-zinc-700 mb-1">期限（YYYY-MM）</div>
                <input
                  value={editingKrDraft.due}
                  onChange={(e) => setEditingKrDraft({ ...editingKrDraft, due: e.target.value })}
                  className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                  placeholder="2026-04"
                />
              </div>
              <div>
                <div className="text-[11px] font-semibold text-zinc-700 mb-1">担当</div>
                <input
                  value={editingKrDraft.owner}
                  onChange={(e) => setEditingKrDraft({ ...editingKrDraft, owner: e.target.value })}
                  className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => saveEditKr(selected!.deptIdx, selected!.projIdx, rowId)}
              disabled={isHydrating}
              className="flex-1 h-9 rounded-lg bg-zinc-900 px-3 text-[12px] font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              保存
            </button>
            <button
              type="button"
              onClick={cancelEditKr}
              disabled={isHydrating}
              className="flex-1 h-9 rounded-lg border border-zinc-200 bg-white px-3 text-[12px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => deleteKr(selected!.deptIdx, selected!.projIdx, rowId)}
              disabled={isHydrating}
              className="h-9 rounded-lg border border-red-200 bg-white px-3 text-[12px] text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              削除
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-start justify-between gap-2">
            <div className="text-[13px] font-semibold text-zinc-800">{label || '（未入力）'}</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => startEditKr(kr as any, rowId)}
                disabled={isHydrating}
                className="h-8 rounded-lg border border-zinc-200 bg-white px-3 text-[12px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                編集
              </button>
              <button
                type="button"
                onClick={() => deleteKr(selected!.deptIdx, selected!.projIdx, rowId)}
                disabled={isHydrating}
                className="h-8 rounded-lg border border-red-200 bg-white px-3 text-[12px] text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                削除
              </button>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] text-zinc-700">
            <div>
              <span className="text-zinc-500">目標:</span> {target} {unit}
            </div>
            <div>
              <span className="text-zinc-500">期限:</span> {due || '-'}
            </div>
            {owner && (
              <div className="col-span-2">
                <span className="text-zinc-500">担当:</span> {owner}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
})}
                </div>
              )}
            </div>

            {/* Admin/Manager Details - Hidden in SIMPLE_FORM */}
            {false && capabilities.canEditStrategy && currentKrList.length > 0 && (
              <details className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-3">
                <summary className="cursor-pointer text-[11px] font-semibold text-zinc-700 hover:text-zinc-900">
                  詳細情報（admin/manager のみ）
                </summary>
                <div className="mt-3 space-y-2 text-[11px] text-zinc-600">
                  {currentKrList.map((kr, idx) => {
                    const label = String((kr as any).label ?? '');
                    const track = String((kr as any).track ?? 'EVOLVE');
                    const metricRole = String((kr as any).metricRole ?? 'LAG');
                    const kind = String((kr as any).kind ?? 'ACQ');

                    return (
                      <div key={idx} className="rounded-lg bg-white p-2">
                        <div className="font-semibold text-zinc-800">{label || '（無名）'}</div>
                        <div className="mt-1 space-y-0.5">
                          <div>進化/探索: {track === 'EVOLVE' ? '改善' : '検証'}</div>
                          <div>役割: {metricRole === 'LEAD' ? '先行' : metricRole === 'LAG' ? '結果' : '北極星'}</div>
                          <div>種別: {kind}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </div>

          {/* ========== Card 3: 実行計画（どうやる？） ========== */}
          <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-[16px] font-semibold text-zinc-900">実行計画（どうやる？）</h2>

            
{/* Milestones */}
<div className="mb-4 space-y-2">
  <div className="flex items-center justify-between">
    <label className="text-[11px] font-semibold text-zinc-700">工程（マイルストーン）</label>
    <div className="text-[11px] text-zinc-500">{(((selectedProj as any).planMilestones || []) as any[]).length}件</div>
  </div>

  {/* List */}
  <div className="space-y-2">
    {((((selectedProj as any).planMilestones || []) as any[]) as any[]).map((mItem: any, idx: number) => {
      const title = String(mItem?.title ?? '');
      const dueYm = String(mItem?.dueYm ?? '');
      return (
        <div key={String(mItem?.id ?? idx)} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold text-zinc-900 truncate">{title || '（タスク名未入力）'}</div>
              <div className="mt-1 text-[11px] text-zinc-600">期限：{dueYm || '—'}</div>
            </div>
            {!isApproved() && (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  className="text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                  onClick={() => {
                    setEditingMilestoneIdx(idx);
                    setNewMilestoneFormData({ title, dueYm });
                  }}
                >
                  編集
                </button>
                <button
                  className="text-[11px] font-semibold text-rose-600 hover:text-rose-700"
                  onClick={() => {
                    if (!selected) return;
                    patchDepartments((prev: any) => {
                      const next = [...prev];
                      const dept = { ...next[selected.deptIdx] };
                      const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
                      const proj = { ...(projs[selected.projIdx] as any) };
                      const list = Array.isArray(proj.planMilestones) ? [...proj.planMilestones] : [];
                      list.splice(idx, 1);
                      proj.planMilestones = list;
                      projs[selected.projIdx] = proj;
                      dept.projects = projs;
                      next[selected.deptIdx] = dept;
                      return next;
                    });
                  }}
                >
                  削除
                </button>
              </div>
            )}
          </div>
        </div>
      );
    })}

    {((((selectedProj as any).planMilestones || []) as any[]) as any[]).length === 0 && (
      <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-3 text-[12px] text-zinc-600">
        まだ工程がありません。まずは「タスク名」と「期限（YYYY-MM）」を追加してください。
        {!isApproved() && (
          <div className="mt-2">
            <button
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100"
              onClick={() => {
                if (!selected) return;
                patchDepartments((prev: any) => {
                  const next = [...prev];
                  const dept = { ...next[selected.deptIdx] };
                  const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
                  const proj = { ...(projs[selected.projIdx] as any) };
                  proj.planMilestones = [
                    { id: cryptoRandomId(), title: '調査・要件整理', dueYm: '' },
                    { id: cryptoRandomId(), title: '設計・準備', dueYm: '' },
                    { id: cryptoRandomId(), title: '実行・展開', dueYm: '' },
                  ];
                  projs[selected.projIdx] = proj;
                  dept.projects = projs;
                  next[selected.deptIdx] = dept;
                  return next;
                });
              }}
            >
              例の3行を入れる
            </button>
          </div>
        )}
      </div>
    )}
  </div>

  {/* Add/Edit form */}
  {!isApproved() && (
    <div className="rounded-xl border border-dashed border-zinc-200 bg-white p-3">
      <div className="mb-2 text-[12px] font-semibold text-zinc-900">
        {editingMilestoneIdx != null ? 'マイルストーンを編集' : 'マイルストーンを追加'}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-[11px] font-semibold text-zinc-700">タスク名</div>
          <input
            className="h-9 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-[13px]"
            placeholder="例：提案書作成、社内説明会、PoC実施"
            value={newMilestoneFormData.title}
            onChange={(e) => setNewMilestoneFormData({ ...newMilestoneFormData, title: e.target.value })}
            disabled={isHydrating}
          />
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold text-zinc-700">期限（YYYY-MM）</div>
          <input
            className="h-9 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-[13px]"
            placeholder="2026-03"
            value={newMilestoneFormData.dueYm}
            onChange={(e) => setNewMilestoneFormData({ ...newMilestoneFormData, dueYm: e.target.value })}
            disabled={isHydrating}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          className="rounded-lg bg-emerald-600 px-4 py-2 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          disabled={isHydrating || newMilestoneFormData.title.trim() === ''}
          onClick={() => {
            if (!selected) return;
            const payload = {
              id: cryptoRandomId(),
              title: newMilestoneFormData.title.trim(),
              dueYm: newMilestoneFormData.dueYm.trim(),
            };

            patchDepartments((prev: any) => {
              const next = [...prev];
              const dept = { ...next[selected.deptIdx] };
              const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
              const proj = { ...(projs[selected.projIdx] as any) };
              const list = Array.isArray(proj.planMilestones) ? [...proj.planMilestones] : [];

              if (editingMilestoneIdx != null) {
                list[editingMilestoneIdx] = { ...list[editingMilestoneIdx], ...payload, id: list[editingMilestoneIdx]?.id ?? payload.id };
              } else {
                list.push(payload);
              }

              proj.planMilestones = list;
              projs[selected.projIdx] = proj;
              dept.projects = projs;
              next[selected.deptIdx] = dept;
              return next;
            });

            setNewMilestoneFormData({ title: '', dueYm: '' });
            setEditingMilestoneIdx(null);
          }}
        >
          {editingMilestoneIdx != null ? '更新' : '追加'}
        </button>

        <button
          className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-[12px] font-semibold text-zinc-700 hover:bg-zinc-100"
          onClick={() => {
            setNewMilestoneFormData({ title: '', dueYm: '' });
            setEditingMilestoneIdx(null);
          }}
        >
          クリア
        </button>
      </div>
    </div>
  )}

            </div>

                {/* ========== Investments ========== */}
                <div className="mb-4 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-zinc-700">投資（金額 or 人数）</label>
                <div className="text-[11px] text-zinc-500">{(selectedProj.executionHumanInvestments || []).length}件</div>
              </div>

              {/* 既存投資の一覧（フォーム表示時も表示） */}
              {(selectedProj.executionHumanInvestments || []).length > 0 && !showInvestmentForm && (
                <div className="rounded-lg bg-zinc-50 p-3 text-[12px] text-zinc-700 mb-2">
                  <div className="space-y-1">
                    {(selectedProj.executionHumanInvestments || []).map((inv: any, idx: number) => (
                      <div key={idx} className="text-zinc-600">
                        {inv.timingYm && `${inv.timingYm}: `}
                        {inv.amount && `¥${Number(inv.amount).toLocaleString()}`}
                        {inv.headcount && `${inv.headcount}人`}
                        {inv.team && ` (${inv.team})`}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* + 投資を追加 ボタン */}
              {!showInvestmentForm && (
                <button
                  type="button"
                  onClick={() => setShowInvestmentForm(true)}
                  disabled={isHydrating || isApproved()}
                  className="w-full rounded-lg border border-dashed border-green-300 bg-green-50 px-3 py-2 text-[12px] font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50"
                >
                  + 投資（金額 or 人数）を追加
                </button>
              )}

              {/* Investment Add Form - showInvestmentForm 時のみ表示 */}
              {showInvestmentForm && (
                <div className="rounded-xl border border-dashed border-green-200 bg-green-50 p-4">
                  <div className="mb-3 text-[12px] font-semibold text-green-900">投資を追加</div>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-semibold text-zinc-700">実行月（YYYY-MM）</label>
                      <input
                        type="text"
                        className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                        placeholder="例：2026-03"
                        value={newInvestFormData.timingYm}
                        onChange={(e) => setNewInvestFormData({ ...newInvestFormData, timingYm: e.target.value })}
                        disabled={isHydrating}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-zinc-700">金額（¥）</label>
                      <input
                        type="text"
                        className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                        placeholder="例：500000"
                        value={newInvestFormData.amount}
                        onChange={(e) => setNewInvestFormData({ ...newInvestFormData, amount: e.target.value })}
                        disabled={isHydrating}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-semibold text-zinc-700">人数</label>
                      <input
                        type="text"
                        className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                        placeholder="例：2"
                        value={newInvestFormData.headcount}
                        onChange={(e) => setNewInvestFormData({ ...newInvestFormData, headcount: e.target.value })}
                        disabled={isHydrating}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-zinc-700">チーム/役割</label>
                      <input
                        type="text"
                        className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                        placeholder="例：営業"
                        value={newInvestFormData.team}
                        onChange={(e) => setNewInvestFormData({ ...newInvestFormData, team: e.target.value })}
                        disabled={isHydrating}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!selected) return;
                        const amount = newInvestFormData.amount.trim() === '' ? undefined : Number(newInvestFormData.amount);
                        const headcount = newInvestFormData.headcount.trim() === '' ? undefined : Number(newInvestFormData.headcount);
                        if (amount === undefined && headcount === undefined) {
                          alert('金額または人数を入力してください。');
                          return;
                        }
                        patchDepartments((prev: any) => {
                          const next = [...prev];
                          const dept = { ...next[selected.deptIdx] };
                          const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
                          const proj = { ...(projs[selected.projIdx] as any) };
                          const investments = Array.isArray(proj.executionHumanInvestments) ? [...proj.executionHumanInvestments] : [];
                          investments.push({
                            id: `inv_${Date.now()}`,
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
                        setShowInvestmentForm(false);
                      }}
                      disabled={isHydrating}
                      className="flex-1 h-9 rounded-lg bg-green-600 px-3 text-[12px] font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      追加
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNewInvestFormData({
                          type: 'HIRE',
                          amount: '',
                          timingYm: '',
                          headcount: '',
                          team: '',
                          note: '',
                        });
                      }}
                      disabled={isHydrating}
                      className="flex-1 h-9 rounded-lg border border-zinc-200 bg-white px-3 text-[12px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                    >
                      クリア
                    </button>
                  </div>
                </div>
              </div>
              )}


              {/* Investment List (edit/delete) */}
              {(selectedProj.executionHumanInvestments || []).length > 0 && (
  <div className="mt-3 space-y-2">
    {(selectedProj.executionHumanInvestments || []).map((invest: any, idx: number) => (
      <div
        key={`${selectedAddKey}:inv:${invest?.id ?? idx}`}
        className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-[12px]"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="font-semibold text-zinc-800">
            {[
              Number.isFinite(invest?.amount) ? `¥${Number(invest.amount).toLocaleString()}` : null,
              invest?.timingYm ? `${invest.timingYm}実行` : null,
              Number.isFinite(invest?.headcount) ? `${invest.headcount}人` : null,
              invest?.team ? `${invest.team}` : null,
            ]
              .filter(Boolean)
              .join(' | ') || '—'}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditingInvestmentIdx(editingInvestmentIdx === idx ? null : idx)}
              disabled={isHydrating || isApproved()}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              {editingInvestmentIdx === idx ? '閉じる' : '編集'}
            </button>
            <button
              type="button"
              onClick={() => {
                patchDepartments((prev: any) => {
                  if (!selected) return prev;
                  const next = [...prev];
                  const dept = { ...next[selected.deptIdx] };
                  const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
                  const proj = { ...(projs[selected.projIdx] as any) };
                  proj.executionHumanInvestments = (proj.executionHumanInvestments || []).filter((_: any, i: number) => i !== idx);
                  projs[selected.projIdx] = proj;
                  dept.projects = projs;
                  next[selected.deptIdx] = dept;
                  return next;
                });
                setEditingInvestmentIdx(null);
              }}
              disabled={isHydrating || isApproved()}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] text-rose-600 hover:bg-rose-50 disabled:opacity-50"
            >
              削除
            </button>
          </div>
        </div>

        {editingInvestmentIdx === idx && (
          <div className="mt-2 grid gap-2 rounded-lg bg-white p-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="mb-1 text-[11px] text-zinc-600">実行月</div>
                <input
                  className="h-9 w-full rounded-lg border border-zinc-200 px-3 text-[13px]"
                  value={String(invest?.timingYm ?? '')}
                  onChange={(e) => {
                    const v = e.target.value;
                    patchDepartments((prev: any) => {
                      if (!selected) return prev;
                      const next = [...prev];
                      const dept = { ...next[selected.deptIdx] };
                      const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
                      const proj = { ...(projs[selected.projIdx] as any) };
                      const list = Array.isArray(proj.executionHumanInvestments) ? [...proj.executionHumanInvestments] : [];
                      list[idx] = { ...list[idx], timingYm: v || undefined };
                      proj.executionHumanInvestments = list;
                      projs[selected.projIdx] = proj;
                      dept.projects = projs;
                      next[selected.deptIdx] = dept;
                      return next;
                    });
                  }}
                  disabled={isHydrating || isApproved()}
                />
              </div>
              <div>
                <div className="mb-1 text-[11px] text-zinc-600">金額(¥)</div>
                <input
                  className="h-9 w-full rounded-lg border border-zinc-200 px-3 text-[13px]"
                  value={invest?.amount == null ? '' : String(invest.amount)}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    const v = raw === '' ? undefined : Number(raw);
                    patchDepartments((prev: any) => {
                      if (!selected) return prev;
                      const next = [...prev];
                      const dept = { ...next[selected.deptIdx] };
                      const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
                      const proj = { ...(projs[selected.projIdx] as any) };
                      const list = Array.isArray(proj.executionHumanInvestments) ? [...proj.executionHumanInvestments] : [];
                      list[idx] = { ...list[idx], amount: v };
                      proj.executionHumanInvestments = list;
                      projs[selected.projIdx] = proj;
                      dept.projects = projs;
                      next[selected.deptIdx] = dept;
                      return next;
                    });
                  }}
                  disabled={isHydrating || isApproved()}
                />
              </div>
              <div>
                <div className="mb-1 text-[11px] text-zinc-600">人数</div>
                <input
                  className="h-9 w-full rounded-lg border border-zinc-200 px-3 text-[13px]"
                  value={invest?.headcount == null ? '' : String(invest.headcount)}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    const v = raw === '' ? undefined : Number(raw);
                    patchDepartments((prev: any) => {
                      if (!selected) return prev;
                      const next = [...prev];
                      const dept = { ...next[selected.deptIdx] };
                      const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
                      const proj = { ...(projs[selected.projIdx] as any) };
                      const list = Array.isArray(proj.executionHumanInvestments) ? [...proj.executionHumanInvestments] : [];
                      list[idx] = { ...list[idx], headcount: v };
                      proj.executionHumanInvestments = list;
                      projs[selected.projIdx] = proj;
                      dept.projects = projs;
                      next[selected.deptIdx] = dept;
                      return next;
                    });
                  }}
                  disabled={isHydrating || isApproved()}
                />
              </div>
              <div>
                <div className="mb-1 text-[11px] text-zinc-600">チーム/役割</div>
                <input
                  className="h-9 w-full rounded-lg border border-zinc-200 px-3 text-[13px]"
                  value={String(invest?.team ?? '')}
                  onChange={(e) => {
                    const v = e.target.value;
                    patchDepartments((prev: any) => {
                      if (!selected) return prev;
                      const next = [...prev];
                      const dept = { ...next[selected.deptIdx] };
                      const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
                      const proj = { ...(projs[selected.projIdx] as any) };
                      const list = Array.isArray(proj.executionHumanInvestments) ? [...proj.executionHumanInvestments] : [];
                      list[idx] = { ...list[idx], team: v || undefined };
                      proj.executionHumanInvestments = list;
                      projs[selected.projIdx] = proj;
                      dept.projects = projs;
                      next[selected.deptIdx] = dept;
                      return next;
                    });
                  }}
                  disabled={isHydrating || isApproved()}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    ))}
  </div>
)}
            </div>


            {/* Skills (CRUD) */}
            <div className="mt-4 space-y-2">
    <div className="flex items-center justify-between">
      <label className="text-[11px] font-semibold text-zinc-700">必要スキル（任意）</label>
      <div className="text-[11px] text-zinc-500">{(((selectedProj as any).skillPlans || []) as any[]).length}件</div>
    </div>

    {/* + スキルを追加 ボタン（フォーム非表示時のみ） */}
    {!showSkillForm && (
      <button
        type="button"
        onClick={() => setShowSkillForm(true)}
        disabled={isHydrating || isApproved()}
        className="w-full rounded-lg border border-dashed border-emerald-300 bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
      >
        + 必要スキル（任意）を追加
      </button>
    )}

    {/* List */}
    <div className="space-y-2">
      {((((selectedProj as any).skillPlans || []) as any[]) as any[]).map((s: any, idx: number) => {
        const skillName = String(s?.skillName ?? '');
        const method = String(s?.method ?? '');
        const dueYm = String(s?.dueYm ?? '');
        const cost = s?.cost;
        const priority = s?.priority;

        return (
          <div key={String(s?.id ?? idx)} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold text-zinc-900 truncate">{skillName || '（スキル名未入力）'}</div>
                <div className="mt-1 text-[11px] text-zinc-600">
                  {method ? `方法：${method}` : '方法：—'} / {dueYm ? `期限：${dueYm}` : '期限：—'}
                  {priority ? ` / 優先度：${priority}` : ''}
                  {Number.isFinite(cost) ? ` / コスト：¥${Number(cost).toLocaleString()}` : ''}
                </div>
              </div>

              {!isApproved() && (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    className="text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                    onClick={() => {
                      setEditingSkillIdx(idx);
                      setNewSkillFormData({
                        skillName,
                        method: (method as any) || 'TRAINING',
                        priority: priority != null ? String(priority) : '',
                        dueYm,
                        hours: s?.hours != null ? String(s.hours) : '',
                        cost: s?.cost != null ? String(s.cost) : '',
                        owner: String(s?.owner ?? ''),
                        note: String(s?.note ?? ''),
                      });
                    }}
                  >
                    編集
                  </button>
                  <button
                    className="text-[11px] font-semibold text-rose-600 hover:text-rose-700"
                    onClick={() => {
                      if (!selected) return;
                      patchDepartments((prev: any) => {
                        const next = [...prev];
                        const dept = { ...next[selected.deptIdx] };
                        const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
                        const proj = { ...(projs[selected.projIdx] as any) };
                        const list = Array.isArray(proj.skillPlans) ? [...proj.skillPlans] : [];
                        list.splice(idx, 1);
                        proj.skillPlans = list;
                        projs[selected.projIdx] = proj;
                        dept.projects = projs;
                        next[selected.deptIdx] = dept;
                        return next;
                      });
                    }}
                  >
                    削除
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {((((selectedProj as any).skillPlans || []) as any[]) as any[]).length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-3 text-[12px] text-zinc-600">
          必須ではありません。必要なスキルがある場合だけ追加してください。
        </div>
      )}
    </div>

    {/* Add/Edit form（showSkillForm 時のみ表示） */}
    {!isApproved() && showSkillForm && (
      <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50 p-4">
        <div className="mb-3 text-[12px] font-semibold text-emerald-900">
          {editingSkillIdx != null ? 'スキルを編集' : 'スキルを追加'}
        </div>

        <div className="space-y-3">
          <div>
            <div className="mb-1 text-[11px] font-semibold text-zinc-700">スキル名</div>
            <input
              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
              placeholder="例：提案書作成、CRM運用、データ分析"
              value={newSkillFormData.skillName}
              onChange={(e) => setNewSkillFormData({ ...newSkillFormData, skillName: e.target.value })}
              disabled={isHydrating}
            />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-[11px] font-semibold text-zinc-700">方法</div>
              <select
                className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                value={newSkillFormData.method}
                onChange={(e) => setNewSkillFormData({ ...newSkillFormData, method: e.target.value as any })}
                disabled={isHydrating}
              >
                <option value="TRAINING">研修</option>
                <option value="OJT">OJT</option>
                <option value="HIRE">採用</option>
                <option value="OUTSOURCE">外注</option>
                <option value="TOOL">ツール導入</option>
                <option value="OTHER">その他</option>
              </select>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold text-zinc-700">期限（YYYY-MM）</div>
              <input
                className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                placeholder="2026-03"
                value={newSkillFormData.dueYm}
                onChange={(e) => setNewSkillFormData({ ...newSkillFormData, dueYm: e.target.value })}
                disabled={isHydrating}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <div className="mb-1 text-[11px] font-semibold text-zinc-700">優先度</div>
              <input
                className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                placeholder="例：高 / 中 / 低"
                value={newSkillFormData.priority}
                onChange={(e) => setNewSkillFormData({ ...newSkillFormData, priority: e.target.value })}
                disabled={isHydrating}
              />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold text-zinc-700">工数（h）</div>
              <input
                className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                placeholder="例：20"
                value={newSkillFormData.hours}
                onChange={(e) => setNewSkillFormData({ ...newSkillFormData, hours: e.target.value })}
                disabled={isHydrating}
              />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold text-zinc-700">コスト（¥）</div>
              <input
                className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                placeholder="例：500000"
                value={newSkillFormData.cost}
                onChange={(e) => setNewSkillFormData({ ...newSkillFormData, cost: e.target.value })}
                disabled={isHydrating}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-[11px] font-semibold text-zinc-700">担当（任意）</div>
              <input
                className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                placeholder="氏名 or チーム"
                value={newSkillFormData.owner}
                onChange={(e) => setNewSkillFormData({ ...newSkillFormData, owner: e.target.value })}
                disabled={isHydrating}
              />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold text-zinc-700">メモ（任意）</div>
              <input
                className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px]"
                placeholder="補足"
                value={newSkillFormData.note}
                onChange={(e) => setNewSkillFormData({ ...newSkillFormData, note: e.target.value })}
                disabled={isHydrating}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="rounded-lg bg-emerald-600 px-4 py-2 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              disabled={isHydrating || newSkillFormData.skillName.trim() === ''}
              onClick={() => {
                if (!selected) return;

                const hours = newSkillFormData.hours.trim() === '' ? undefined : Number(newSkillFormData.hours);
                const costNum = newSkillFormData.cost.trim() === '' ? undefined : Number(newSkillFormData.cost);

                patchDepartments((prev: any) => {
                  const next = [...prev];
                  const dept = { ...next[selected.deptIdx] };
                  const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
                  const proj = { ...(projs[selected.projIdx] as any) };
                  const list = Array.isArray(proj.skillPlans) ? [...proj.skillPlans] : [];

                  const payload = {
                    id: cryptoRandomId(),
                    skillName: newSkillFormData.skillName.trim(),
                    method: newSkillFormData.method,
                    priority: newSkillFormData.priority.trim() || undefined,
                    dueYm: newSkillFormData.dueYm.trim() || undefined,
                    hours: Number.isFinite(hours) ? hours : undefined,
                    cost: Number.isFinite(costNum) ? costNum : undefined,
                    owner: newSkillFormData.owner.trim() || undefined,
                    note: newSkillFormData.note.trim() || undefined,
                  };

                  if (editingSkillIdx != null) {
                    list[editingSkillIdx] = { ...list[editingSkillIdx], ...payload, id: list[editingSkillIdx]?.id ?? payload.id };
                  } else {
                    list.push(payload);
                  }

                  proj.skillPlans = list;
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
                setEditingSkillIdx(null);
                setShowSkillForm(false);
              }}
            >
              {editingSkillIdx != null ? '更新' : '追加'}
            </button>

            <button
              className="rounded-lg border border-emerald-200 bg-white px-4 py-2 text-[12px] font-semibold text-emerald-700 hover:bg-emerald-100"
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
                setEditingSkillIdx(null);
              }}
            >
              クリア
            </button>
          </div>
        </div>
      </div>
    )}
  </div>

        </div>
        </div>
      </div>
    );
  };

  /* ============================================================
   * renderLegacy: 旧UI（タブシステム・詳細フォーム）
   * ========================================================== */
  const renderLegacy = () => {
    const canEditDept = capabilities.canEditStrategy;

  return (
  <main className="min-h-screen bg-zinc-50">
    <div className="w-full px-6 py-6">

      {/* header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold text-zinc-500"></div>
          <h1 className="mt-1 text-[20px] font-bold text-zinc-900">STAGE４　実行計画策定</h1>
          <div className="mt-1 text-[12px] text-zinc-600">
            左でプロジェクトを選び、右で「目的・成果指標・実行計画」を議論の上、入力設定します。
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-2">
          <SaveStatusIndicator />
          <div className="text-right text-[11px] text-zinc-500">{isHydrating ? '読み込み中…' : '準備OK'}</div>
        </div>
      </div>

      {/* STAGE4 作業エリア：ここだけ横スクロール */}
      <div data-debug="okr-scrollwrap" className="overflow-x-auto overscroll-x-contain touch-pan-x pb-2">
        <div className="min-w-[1600px]">
          <div className="grid gap-6 grid-cols-[320px_1fr]">
            {/* Left: project list */}
            <aside className="w-[320px] rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[13px] font-semibold text-zinc-900">プロジェクト一覧</div>
              <div className="text-[11px] text-zinc-500">
                {cascade.reduce((n, d) => n + ensureArray(d.projects).length, 0)}件
              </div>
            </div>

            <div className="space-y-4">
              {cascade.map((dept, di) => {
                const projs = ensureArray(dept.projects);
                return (
                  <div key={deptKeyOf(dept)} className="rounded-2xl bg-zinc-50 p-3">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-semibold text-zinc-900">{dept.name || `部門${di + 1}`}</div>
                        <div className="text-[10px] text-zinc-500">{projs.length}件</div>
                      </div>

                      {canEditDept && (
                        <button
                          type="button"
                          onClick={() => {
                            setAddingProjectForDept((prev) => (prev === di ? null : di));
                            setNewProjectTitle('');
                          }}
                          className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50"
                        >
                          <span className="inline-flex items-center gap-1">
                            <Plus className="h-3.5 w-3.5" />
                            追加
                          </span>
                        </button>
                      )}
                    </div>

                    {addingProjectForDept === di && canEditDept && (
                      <div className="mt-2 rounded-xl border border-dashed border-zinc-200 bg-white p-2">
                        <div className="flex gap-2">
                          <input
                            className="h-9 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                            placeholder="新しいプロジェクト名"
                            value={newProjectTitle}
                            onChange={(e) => setNewProjectTitle(e.target.value)}
                          />
                          <button
                            type="button"
                            className="h-9 rounded-lg bg-zinc-900 px-3 text-[12px] font-semibold text-white disabled:opacity-50"
                            disabled={!newProjectTitle.trim()}
                            onClick={() => addProjectToDepartment(di)}
                          >
                            追加
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="mt-2 space-y-1">
                      {projs.map((p, pi) => {
                        const isSel = selected?.deptIdx === di && selected?.projIdx === pi;
                        return (
                          <button
                            key={projKeyOf(p)}
                            type="button"
                            onClick={() => setSelected({ deptIdx: di, projIdx: pi })}
                            className={[
                              'w-full rounded-xl border px-3 py-2 text-left text-[12px] transition',
                              isSel
                                ? 'border-zinc-900 bg-zinc-900 text-white'
                                : 'border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50',
                            ].join(' ')}
                          >
                            <div className="truncate font-semibold">{(p as any).title || `プロジェクト${pi + 1}`}</div>
                            <div className={['mt-0.5 text-[10px]', isSel ? 'text-zinc-200' : 'text-zinc-500'].join(' ')}>
                              役割: {getRoleLabel((p as any).role)} / KPI: {ensureArray((p as any).okrsV2).length}件 / 投資:{' '}
                              {ensureArray((p as any).executionHumanInvestments).length}件
                            </div>
                          </button>
                        );
                      })}

                      {projs.length === 0 && <div className="py-2 text-center text-[11px] text-zinc-500">まだプロジェクトがありません</div>}
                    </div>
                  </div>
                );
              })}
          </div>
            </aside>

            {/* Right: 3カラム（目的/KPI/実行計画） */}
            <section className="min-h-[420px]">
              {!selected || !selectedProj ? (
                <div className="rounded-3xl border border-dashed border-zinc-300 bg-white p-10 text-center">
                  <div className="text-[14px] font-semibold text-zinc-900">プロジェクトを選択してください</div>
                  <div className="mt-2 text-[12px] text-zinc-600">左の一覧からプロジェクトをクリックすると、入力フォームが開きます。</div>
                </div>
              ) : (
                renderSimpleRight()
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  </main>
);

  };

  /* ============================================================
   * return: SIMPLE_FORM フラグで表示を切り替え
   * ========================================================== */
  return renderLegacy();
}
