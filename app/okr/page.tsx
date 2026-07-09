// /app/okr/page.tsx
'use client';

// ★ 診断: 実行中のファイル確認
if (typeof window !== 'undefined') {
  debugLog('OKR_REAL_FILE_LOADED', { file: 'app/okr/page.tsx', timestamp: new Date().toISOString() });
}

import StrategyGuard from '@/app/StrategyGuard';
import { useSearchParams } from 'next/navigation';

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
import { hardResetForCompanySwitch } from '@/utils/resetAll';
import { loadAndHydrate } from '@/utils/loader';
import { debugLog } from '@/utils/debug';
import { safeGetSession } from '@/utils/supabase/client';
import { toNumber } from '@/utils/valueAnalysis';
import { useAutoSave } from '@/hooks/useAutoSave';
import type { KRKind, StrategyData } from '@/types/strategy';
import { okrsV2ToOkrs, okrsToKpis } from '@/utils/supabase/strategy';
import { formatDeadlineLabel, stripProjectPrefix } from '@/utils/dateFormatter';
import { okrService } from '@/services/okrService';
import type { ResolvedOkr, OkrWriteInput } from '@/types/okrs';
import { OKRHeader } from '@/components/stage4/OKRHeader';
import { ProjectListHeader } from '@/components/stage4/ProjectListHeader';
import { ProjectSelectionPrompt } from '@/components/stage4/ProjectSelectionPrompt';
import { DepartmentListItem } from '@/components/stage4/DepartmentListItem';
import { useStage4PdfExport } from '@/hooks/useStage4PdfExport';
import { AutoResizeTextarea } from '@/components/ui/AutoResizeTextarea';
import { ReflectionCandidatesSection, type OKRCandidate } from '@/components/stage4/ReflectionCandidatesSection';

import type { Department as DepartmentStrategy } from '@/types/strategy';
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

type ImpactRole = 'REVENUE' | 'COST' | 'FUTURE';
type ImpactAssumptions = Record<string, number | undefined>;

const toFiniteNumber = (value: any): number | undefined => {
  if (value === '' || value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const roundImpact = (value: number): number => Math.round(value * 10) / 10;

const getImpactResultFromAssumptions = (role: ImpactRole | undefined, assumptions: ImpactAssumptions | undefined) => {
  const a = assumptions ?? {};

  if (role === 'REVENUE') {
    const targetCustomers = toFiniteNumber(a.targetCustomers) ?? 0;
    const conversionRatePct = toFiniteNumber(a.conversionRatePct) ?? 0;
    const averageDealMJPY = toFiniteNumber(a.averageDealMJPY) ?? 0;
    const revenueMJPY = roundImpact(targetCustomers * (conversionRatePct / 100) * averageDealMJPY);
    return {
      resultKey: 'impactRevenueMJPY',
      resultLabel: '売上への見込み効果',
      resultValue: revenueMJPY,
      formula: `${targetCustomers}社 × ${conversionRatePct}% × ${averageDealMJPY}百万円 = ${revenueMJPY}百万円`,
    };
  }

  if (role === 'COST') {
    const currentCostMJPY = toFiniteNumber(a.currentCostMJPY) ?? 0;
    const reductionRatePct = toFiniteNumber(a.reductionRatePct) ?? 0;
    const opIncomeMJPY = roundImpact(currentCostMJPY * (reductionRatePct / 100));
    return {
      resultKey: 'impactOpIncomeMJPY',
      resultLabel: '利益への見込み効果',
      resultValue: opIncomeMJPY,
      formula: `${currentCostMJPY}百万円 × ${reductionRatePct}% = ${opIncomeMJPY}百万円`,
    };
  }

  if (role === 'FUTURE') {
    const peopleCount = toFiniteNumber(a.peopleCount) ?? 0;
    const durationMonths = toFiniteNumber(a.durationMonths) ?? 0;
    const monthlyCostPerPersonMJPY = toFiniteNumber(a.monthlyCostPerPersonMJPY) ?? 0;
    const externalCostMJPY = toFiniteNumber(a.externalCostMJPY) ?? 0;
    const investmentMJPY = roundImpact(peopleCount * durationMonths * monthlyCostPerPersonMJPY + externalCostMJPY);
    return {
      resultKey: 'impactInvestmentMJPY',
      resultLabel: '必要な投資',
      resultValue: investmentMJPY,
      formula: `${peopleCount}人 × ${durationMonths}か月 × ${monthlyCostPerPersonMJPY}百万円 + ${externalCostMJPY}百万円 = ${investmentMJPY}百万円`,
    };
  }

  return null;
};

const getImpactPreset = (role: ImpactRole | undefined, size: 'small' | 'standard' | 'large'): ImpactAssumptions => {
  if (role === 'REVENUE') {
    if (size === 'small') return { targetCustomers: 10, conversionRatePct: 10, averageDealMJPY: 10 };
    if (size === 'large') return { targetCustomers: 50, conversionRatePct: 30, averageDealMJPY: 30 };
    return { targetCustomers: 30, conversionRatePct: 20, averageDealMJPY: 20 };
  }

  if (role === 'COST') {
    if (size === 'small') return { currentCostMJPY: 50, reductionRatePct: 10 };
    if (size === 'large') return { currentCostMJPY: 200, reductionRatePct: 20 };
    return { currentCostMJPY: 120, reductionRatePct: 10 };
  }

  if (role === 'FUTURE') {
    if (size === 'small') return { peopleCount: 2, durationMonths: 3, monthlyCostPerPersonMJPY: 1, externalCostMJPY: 4 };
    if (size === 'large') return { peopleCount: 5, durationMonths: 6, monthlyCostPerPersonMJPY: 1.2, externalCostMJPY: 14 };
    return { peopleCount: 3, durationMonths: 6, monthlyCostPerPersonMJPY: 1, externalCostMJPY: 12 };
  }

  return {};
};

/* ============================================================
 * 【ARCHITECTURE】STAGE4/5/6 データフロー設計と okrs / okrsV2 の独立性
 * ============================================================
 *
 * 【システム構造】
 * - STAGE4: OKR 本体管理（DB: okrs テーブル）
 *   - 責務: 目標・オーナー・期限の保持
 *   - 表示: app/okr/page.tsx（このファイル）
 *   - ViewModel: OkrDisplayModel（DB/snapshot 統一型）
 *
 * - STAGE5: Objective 掲示板（snapshot: proj.okrs）
 *   - 責務: STAGE4 OKR の読取専用表示（キャッシュ更新時に同期）
 *   - 表示: ページの最上部
 *   - 同期メカニズム: invalidateAndRefetchProjectOkrs() が DB→snapshot 自動同期
 *
 * - STAGE6: 財務計画（オプション）（計算入力: proj.okrsV2）
 *   - 責務: 構造化 KR（BridgeKR）から YearlyPL を計算
 *   - 入力: proj.okrsV2[]（Project 配下の全 KR）
 *   - 計算: calcYearlyFromKrs() → YearlyPL
 *
 * 【okrs と okrsV2 の独立性】
 * okrs（STAGE4/5）と okrsV2（STAGE6）は **完全に独立** した構造：
 *
 * ❌ 対応していないもの:
 *   - okrs の各要素と okrsV2 の各要素の間に親子リンク（parentOkrId）が存在しない
 *   - OKR 削除時に自動削除すべき KR が定義されていない
 *   - OKR 追加時に自動作成すべき KR テンプレートが定義されていない
 *
 * ✅ 設計上の分離:
 *   - okrs: 戦略立案用（Objective ベース）
 *   - okrsV2: 財務計画用（KR ベース）
 *   - 両者は異なる責務のため、それぞれ独立して管理
 *
 * 【CRUD 操作と okrsV2】
 * - Delete: OKR を削除→ DB soft delete（is_deleted=true）→ snapshot 同期
 *   ❌ okrsV2 への操作は行わない（対応関係が未定義のため）
 *
 * - Add: 新規 OKR を追加→ DB insert → snapshot 同期
 *   ❌ okrsV2 への操作は行わない
 *
 * - Reorder: OKR 並び替え → DB sort_order 更新 → snapshot 同期
 *   ❌ okrsV2 への操作は行わない
 *
 * 【今後の拡張（Option 1）】
 * okrs と okrsV2 を連携させたい場合:
 *   1. スキーマ: okrs テーブルに parentOkrId カラム追加
 *   2. 設計: OKR:KR の 1:多 マッピング定義
 *   3. 実装: Delete/Add/Reorder 時に okrsV2 も同期
 *   4. 検証: STAGE6 の実装が本当に OKR-KR リンクを必要としているか確認
 *
 * ※ 以上の拡張は、実装者が STAGE6 の本当の要件を検証した上で進めること
 *
 * ============================================================ */

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
 * ★ STAGE4: OKR Source Badge（DB/Snapshot/Legacy/Error 表示）
 * ========================================================== */
function OkrSourceBadge({ source }: { source: 'db' | 'snapshot' | 'legacy' | 'error' }) {
  const config = {
    db: { label: 'DB正本', color: 'bg-green-100 text-green-700' },
    snapshot: { label: 'Snapshot', color: 'bg-yellow-100 text-yellow-700' },
    legacy: { label: 'Legacy (ID未設定)', color: 'bg-amber-100 text-amber-700' },
    error: { label: 'DB接続失敗', color: 'bg-red-100 text-red-700' },
  }[source];

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded ${config.color}`}>
      {config.label}
    </span>
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

/* ============================================================
 * ★STAGE4拡張：仮説＆成長レバー（Kind/MainLever/Horizon）の日本語化
 * STAGE3との整合性を保つ
 * ========================================================== */
const KIND_JA: Record<string, string> = {
  growth: '成長',
  cost: 'コスト',
  efficiency: '生産性',
  future: '未来投資',
};

const LEVER_JA: Record<string, string> = {
  ACQ: '獲得（受注・新規）',
  ARPU: '単価（ARPU）',
  CHURN: '継続（解約率）',
  COST: 'コスト',
  EFFICIENCY: '効率（生産性）',
  FUTURE: '未来（成功率）',
};

const HORIZON_JA: Record<string, string> = {
  short: '短期（〜1年）',
  mid: '中期（1〜3年）',
  long: '長期（3年〜）',
};

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

  // Phase B-2: マイルストーン（任意）
  milestones?: Array<{ id: string; title: string; dueYm?: string; owner?: string; status?: string; dod?: string }>;
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

function OKRPageContent() {
  const s = useStrategyStore() as any;
  const {
    companyId: scopeCompanyId,
    hydrated,
    restoreReady,
    isRestoring,
    setCompanyScope,
    setHydrated,
    refetchFromServer,
    boot,
    lastServerSnapshot,
    setDepartments,
  } = useStrategyStore();

  const departments = useStrategyStore((st: any) => ((st.departments as DepartmentStrategy[] | undefined) ?? [])) as Department[];

  // ★ CRITICAL: Department.id ステータスをログ（backfillOkrs のための診断）
  useEffect(() => {
    if (departments.length > 0 && (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1' || process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1')) {
      const deptIdStatus = departments.map((d: any, idx: number) => ({
        index: idx,
        name: d?.name ?? '[no-name]',
        hasId: !!d?.id,
        rawId: d?.id ?? 'missing',
        projectCount: Array.isArray(d?.projects) ? d.projects.length : 0,
        firstProjectTitle: d?.projects?.[0]?.title ?? '[no-projects]',
        firstProjectId: d?.projects?.[0]?.id ?? 'missing',
      }));
      console.log('[diag][okr-page] departments id-status from store', {
        timestamp: new Date().toISOString(),
        totalDepts: deptIdStatus.length,
        departments: deptIdStatus,
      });
    }
  }, [departments]);

  // ★ STAGE4: Resolved OKRs from DB (DB priority + snapshot fallback)
  const [resolvedOkrsMap, setResolvedOkrsMap] = useState<Record<string, ResolvedOkr[]>>({});
  const [okrLoadingStatus, setOkrLoadingStatus] = useState<Record<string, 'loading' | 'success' | 'error'>>({});
  const [notice, setNotice] = useState<string>("");
  const promotingProjectKeysRef = useRef<Set<string>>(new Set());
  const attemptedPromotionKeysRef = useRef<Set<string>>(new Set());

  const access = useAccess();
  const accessCompanyId: string | undefined = useMemo(
    () => ((access as any)?.companyId ?? (s?.companyId as string | undefined)) as string | undefined,
    [(access as any)?.companyId, s?.companyId],
  );

  /* ===== PDF Export ===== */
  const { exportToPdf: stage4ExportToPdf } = useStage4PdfExport();

  const searchParams = useSearchParams();

  {/* -------- 会社スコープ確立（cascade と同じパターン） -------- */}
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

  {/* -------- 初期ロード：常に refetchFromServer を実行 -------- */}
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
        // ★ FIX: isDirty に関わらず常に refetchFromServer を実行
        // 【背景】
        // - restoreReady フラグは refetchFromServer() 完了時にのみ true に設定される（strategyStore.ts:4060, 4130）
        // - isDirty=true でスキップすると restoreReady=false のまま
        // - persistStage4Snapshot (LINE 543) で save guard によりブロック → 「入力できるが保存されない」
        // 【修正】
        // - isDirty の条件分岐を削除（8 lines 削除）
        // - refetchFromServer を常に実行
        // 【安全性】
        // - refetchFromServer 内で wasDirty チェック（LINE 3939-3947 strategyStore.ts）により
        //   local edits は dirty=true 時に extractServerDecidedPatch で保護される
        // - STAGE3 編集直後 STAGE4 遷移の場合も local state が優先される（merged strategy で）
        try {
          await refetchFromServer?.();
        } catch (err) {
          // Network error, timeout, etc: local state is preserved, refetch retry scheduled
          if (isDirty) {
            console.log('[okr:load-guard] refetchFromServer error with isDirty=true, local state preserved', err);
          }
        }

        // ★ P0-1: STAGE3→STAGE4 transition verification (stop-gap)
        if (!cancelled) {
          try {
            const { saveStrategyData } = useStrategyStore.getState();
            await saveStrategyData?.({
              force: true,
              reason: 'stage3:goStage4'
            });

            // Verify STAGE3 data exists in current state
            const currentState = useStrategyStore.getState() as any;
            const departments = Array.isArray(currentState.departments) ? currentState.departments : [];

            if (departments.length === 0) {
              throw new Error('No departments found in STAGE3');
            }

            // Check if any department has projects with okrs/kpis/okrsV2
            const hasValidData = departments.some((dept: any) => {
              const projects = Array.isArray(dept.projects) ? dept.projects : [];
              if (projects.length === 0) return false;

              return projects.some((proj: any) => {
                const hasOkrsV2 = Array.isArray(proj.okrsV2) && proj.okrsV2.length > 0;
                const hasOkrs = Array.isArray(proj.okrs) && proj.okrs.length > 0;
                const hasKpis = Array.isArray(proj.kpis) && proj.kpis.length > 0;
                return hasOkrsV2 || hasOkrs || hasKpis;
              });
            });

            if (!hasValidData) {
              throw new Error('No projects with okrs/kpis found in STAGE3');
            }
          } catch (err: any) {
            console.error('[okr:load-guard] STAGE3 verification failed', err, {
              errorMessage: err?.message,
              timestamp: new Date().toISOString()
            });
            setNotice('⚠️ STAGE3の保存確認に失敗しました。STAGE3に戻って再度保存してください。');

            // Redirect to cascade after delay
            setTimeout(() => {
              if (!cancelled) {
                window.location.href = '/cascade';
              }
            }, 2000);
            return;
          }
        }

        setHydrated?.(true);
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

  {/* -------- 自動保存：cascade と同じ条件でガード -------- */}
  const mismatch = !!(accessCompanyId && scopeCompanyId && scopeCompanyId !== accessCompanyId);
  const isHydrating = ((Boolean(boot?.isHydrating) && !hydrated) || mismatch || !hydrated) ?? false;

  useAutoSave({
    enabled: false,
    requireHydrated: true,
    requireSession: true,
    debounceMs: 1200,
    minIntervalMs: 1500,
    mode: 'payload',
  });

  // ★ DIAGNOSIS: Log companyTargets for 金額ゴール matching
  useEffect(() => {
    if (!hydrated || isHydrating) return;

    const st = useStrategyStore.getState() as any;
    const companyTargets = Array.isArray(st.companyTargets) ? st.companyTargets : [];

    console.group('[DIAGNOSIS] CompanyTargets for 金額ゴール');
    console.log('Status:', {
      hydrated,
      companyTargetsCount: companyTargets.length,
      companyName: st.companyName,
    });

    if (companyTargets.length === 0) {
      console.warn('⚠️ No companyTargets found! 金額ゴール linking will fail.');
    } else {
      console.table(
        companyTargets.map((t: any) => ({
          id: t?.id,
          label: t?.label,
          unit: t?.unit,
          dueYear: t?.dueYear,
          base: t?.base,
          'matches 売上': String(t?.label ?? '')
            .replace(/[\s　]+/g, '')
            .toLowerCase()
            .includes('売上'),
          'matches 営業利益': ['営業利益', '営業益', 'op', 'operatingincome'].some((keyword) =>
            String(t?.label ?? '')
              .replace(/[\s　]+/g, '')
              .toLowerCase()
              .includes(keyword),
          ),
        })),
      );
    }

    // Matching check
    const norm = (s: any) =>
      String(s ?? '')
        .replace(/[\s　]+/g, '')
        .toLowerCase();
    const revenueTarget = companyTargets.find((t: any) => norm(t?.label).includes('売上') || norm(t?.label).includes('revenue'));
    const opIncomeTarget = companyTargets.find(
      (t: any) =>
        norm(t?.label).includes('営業利益') ||
        norm(t?.label).includes('営業益') ||
        norm(t?.label).includes('op') ||
        norm(t?.label).includes('operatingincome'),
    );

    console.log('Matching Results:', {
      revenueTargetFound: !!revenueTarget,
      revenueTargetId: revenueTarget?.id,
      revenueTargetLabel: revenueTarget?.label,
      opIncomeTargetFound: !!opIncomeTarget,
      opIncomeTargetId: opIncomeTarget?.id,
      opIncomeTargetLabel: opIncomeTarget?.label,
    });

    if (!revenueTarget) {
      console.warn('❌ Revenue target not found! 売上寄与 linking will fail.');
    }
    if (!opIncomeTarget) {
      console.warn('❌ Op income target not found! 営業利益寄与 linking will fail.');
    }

    console.groupEnd();
  }, [hydrated, isHydrating]);

  {/* -------- 目的欄の即保存・debounce保存 -------- */}
  const saveNow = useStrategyStore((st: any) => st.saveStrategyData);

  const objectiveSaveTimerRef = useRef<number | null>(null);

  const scheduleObjectiveSave = useCallback(() => {
    if (!saveNow) return;
    if (objectiveSaveTimerRef.current) window.clearTimeout(objectiveSaveTimerRef.current);
    objectiveSaveTimerRef.current = window.setTimeout(async () => {
      try {
        await saveNow();
      } catch {}
    }, 400); // 400ms推奨
  }, [saveNow]);

  useEffect(() => {
    return () => {
      if (objectiveSaveTimerRef.current) window.clearTimeout(objectiveSaveTimerRef.current);
    };
  }, []);


  const stage4SnapshotSaveTimerRef = useRef<number | null>(null);

  const persistStage4Snapshot = useCallback(
    async (
      mode: 'debounced' | 'immediate' = 'debounced',
      reason: string = 'stage4_snapshot_fields',
    ) => {
      if (!saveNow) return;
      if (!hydrated) return;
      if ((boot as any)?.isHydrating) return;
      if (isRestoring) return;
      if (restoreReady === false) return;

      const run = async () => {
        try {
          await saveNow({ reason, force: true });
        } catch (e) {
          console.warn(`[${reason}] save failed`, e);
        }
      };

      if (mode === 'immediate') {
        if (stage4SnapshotSaveTimerRef.current) window.clearTimeout(stage4SnapshotSaveTimerRef.current);
        await run();
        return;
      }

      if (stage4SnapshotSaveTimerRef.current) window.clearTimeout(stage4SnapshotSaveTimerRef.current);
      stage4SnapshotSaveTimerRef.current = window.setTimeout(() => {
        void run();
      }, 700);
    },
    [saveNow, hydrated, boot, isRestoring, restoreReady],
  );

  const queueStage4SnapshotPersist = useCallback(
    (reason: string = 'stage4_snapshot_fields') => {
      void persistStage4Snapshot('debounced', reason);
    },
    [persistStage4Snapshot],
  );

  useEffect(() => {
    return () => {
      if (stage4SnapshotSaveTimerRef.current) window.clearTimeout(stage4SnapshotSaveTimerRef.current);
    };
  }, []);

  const stage4SnapshotWatchTimerRef = useRef<number | null>(null);
  const stage4SnapshotWatchPrevHashRef = useRef<string>('');
  const stage4SnapshotWatchArmedRef = useRef<boolean>(false);

  const buildStage4SnapshotWatchValue = useCallback((proj: any) => {
    if (!proj) return null;
    return {
      title: proj?.title ?? '',
      role: proj?.role ?? null,
      roleDetail: proj?.roleDetail ?? null,
      planStatus: proj?.planStatus ?? null,
      approvedAt: proj?.approvedAt ?? null,
      approvedBy: proj?.approvedBy ?? null,
      kpis: Array.isArray(proj?.kpis) ? proj.kpis : [],
      okrs: ensureArray(proj?.okrs).map((o: any) => ({
        due: o?.due ?? '',
        keyResults: Array.isArray(o?.keyResults) ? o.keyResults : [],
      })),
      okrsV2: Array.isArray(proj?.okrsV2) ? proj.okrsV2 : [],
      okrVariants: Array.isArray(proj?.okrVariants) ? proj.okrVariants : [],
      skillPlans: Array.isArray(proj?.skillPlans) ? proj.skillPlans : [],
      executionHumanInvestments: Array.isArray(proj?.executionHumanInvestments) ? proj.executionHumanInvestments : [],
      impactRevenueMJPY: proj?.impactRevenueMJPY ?? null,
      impactOpIncomeMJPY: proj?.impactOpIncomeMJPY ?? null,
      impactInvestmentMJPY: proj?.impactInvestmentMJPY ?? null,
      impactAssumptions: proj?.impactAssumptions ?? null,
      impactProfitMJPY: proj?.impactProfitMJPY ?? null,
      impactRevenueProgress: proj?.impactRevenueProgress ?? null,
      impactProfitProgress: proj?.impactProfitProgress ?? null,
      targetLinkedRevenueId: proj?.targetLinkedRevenueId ?? null,
      targetLinkedProfitId: proj?.targetLinkedProfitId ?? null,
      impactCategory: proj?.impactCategory ?? null,
      impactConfidence: proj?.impactConfidence ?? null,
      impactRationale: proj?.impactRationale ?? null,
      ownerUserId: proj?.ownerUserId ?? null,
      ownerName: proj?.ownerName ?? null,
    };
  }, []);

  {/* -------- STAGE4 Baseline 作成ガード（hydrate 完了時に1回だけ、companyId単位） -------- */}
  const baselineCreatedRef = useRef<boolean>(false);

  {/* -------- 初期補修：初回のみ実行フラグ（削除後の KR 再注入防止） -------- */}
  const initialRepairCompletedRef = useRef<boolean>(false);

  {/* -------- 初回自動変換：初回のみ実行フラグ（deleteKr 後の KR 再注入防止） -------- */}
  const autoConvertCompletedRef = useRef<boolean>(false);
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

  // STAGE6連携用：North Star（companyTargets）
  const companyTargets: any[] = useStrategyStore((s: any) =>
    Array.isArray(s?.companyTargets) ? (s.companyTargets as any[]) : [],
  );

  // 期限（North Star目標年）は固定前提：companyTargets の dueYear の最大値を採用
  const northStarDueYear: number | undefined = useMemo(() => {
    const ys = companyTargets
      .map((t: any) => t?.dueYear)
      .filter((y: any) => typeof y === 'number' && Number.isFinite(y)) as number[];
    return ys.length ? Math.max(...ys) : undefined;
  }, [companyTargets]);

  /* ============================================================
   * ロールの“影”を保持してリフェッチ上書きを回避（UI都合なので page に残す）
   * ========================================================== */
  const [roleShadow, setRoleShadow] = useState<Record<string, Project['role'] | undefined>>({});

  useEffect(() => {
    const next: Record<string, Project['role'] | undefined> = {};
    // ★ 修正: cascade ではなく departments を使う
    (Array.isArray(departments) ? departments : []).forEach((d, di) =>
      ensureArray(d.projects).forEach((p, pi) => {
        const k = `${di}:${pi}`;
        if (p.role != null) next[k] = p.role;
      }),
    );
    setRoleShadow((prev) => ({ ...next, ...prev }));
  }, [departments]);

  /* ============================================================
   * UI state
   * ========================================================== */
  const [krDetailOpen, setKrDetailOpen] = useState<Record<string, boolean>>({});
  const [helpMode, setHelpMode] = useState<boolean>(false);
  const [showRoleDetail, setShowRoleDetail] = useState<boolean>(false);

  {/* STAGE4: 投資・スキルフォームの初期非表示状態管理 */}
  const [showInvestmentForm, setShowInvestmentForm] = useState<boolean>(false);
  const [showSkillForm, setShowSkillForm] = useState<boolean>(false);

  {/* STAGE4: planStatus, skillPlans/humanInvestments CRUD UI */}
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

  const autoSelectedProjectRef = useRef<string>('');

  useEffect(() => {
    if (!hydrated || isHydrating) return;
    if (!Array.isArray(departments) || departments.length === 0) return;

    const projectIdParam = String(searchParams?.get('projectId') ?? '').trim();
    const deptIdParam = String(searchParams?.get('deptId') ?? '').trim();
    const projectNameParam = String(searchParams?.get('project') ?? '').trim();
    const deptNameParam = String(searchParams?.get('dept') ?? '').trim();

    if (!projectIdParam && !projectNameParam) return;

    const queryKey = [projectIdParam, deptIdParam, projectNameParam, deptNameParam].join('::');
    if (autoSelectedProjectRef.current === queryKey) return;

    const norm = (value: unknown) =>
      String(value ?? '')
        .replace(/[\s　]+/g, '')
        .toLowerCase();

    let found: { deptIdx: number; projIdx: number } | null = null;

    for (let deptIdx = 0; deptIdx < departments.length; deptIdx += 1) {
      const dept = departments[deptIdx] as any;
      const deptId = String(dept?.id ?? '').trim();
      const deptName = String(dept?.name ?? dept?.departmentName ?? '').trim();

      if (deptIdParam && deptId && deptId !== deptIdParam) continue;
      if (!deptIdParam && deptNameParam && norm(deptName) !== norm(deptNameParam)) continue;

      const projects = Array.isArray(dept?.projects) ? dept.projects : [];
      for (let projIdx = 0; projIdx < projects.length; projIdx += 1) {
        const proj = projects[projIdx] as any;
        const projId = String(proj?.id ?? proj?.projectId ?? '').trim();
        const projTitle = String(proj?.title ?? proj?.name ?? '').trim();

        const matchedById = !!projectIdParam && !!projId && projId === projectIdParam;
        const matchedByName = !projectIdParam && !!projectNameParam && norm(projTitle) === norm(projectNameParam);

        if (matchedById || matchedByName) {
          found = { deptIdx, projIdx };
          break;
        }
      }

      if (found) break;
    }

    if (!found) return;

    const alreadySelected = selected?.deptIdx === found.deptIdx && selected?.projIdx === found.projIdx;
    autoSelectedProjectRef.current = queryKey;

    if (!alreadySelected) {
      setSelected(found);
    }
  }, [hydrated, isHydrating, departments, searchParams, selected]);

  {/* Phase1.4: 統合フォームモード（二重表示防止） */}
  const INTEGRATED = true;

  {/* STAGE4: 3カード統一フォーマット（保存非破壊・旧UI隔離） */}
  const SIMPLE_FORM = true;

  {/* 参考OKR表示トグル（デフォルト閉） */}
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
  // React render key は重複を避けるため index を必ず含める
  const deptRenderKey = (d: any, di: number) => `${deptKeyOf(d) || 'dept'}::${di}`;
  const projRenderKey = (p: any, di: number, pi: number) => `${projKeyOf(p) || 'proj'}::${di}::${pi}`;


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
    if (saveNow) void saveNow();
    setSelected({ deptIdx, projIdx: newProjIdx });
    setAddingProjectForDept(null);
    setNewProjectTitle('');
  };

  /* ============================================================
   * ★STAGE4: OKR 表示用 ViewModel
   * ========================================================== */
  /**
   * OKR 表示統一型
   * - ResolvedOkr (DB) と OKR (snapshot) の差異を吸収
   * - source: 由来の追跡（DB vs snapshot）
   */
  type OkrDisplayModel = {
    id: string;
    source: 'db' | 'snapshot';
    objective: string;
    owner: string;
    due: string;
    keyResults: string[];
  };

  /**
   * OKR | ResolvedOkr → OkrDisplayModel への変換
   */
  function toOkrDisplayModel(okr: OKR | ResolvedOkr): OkrDisplayModel {
    // ResolvedOkr (source フィールドで判定)
    if ('source' in okr) {
      const resolvedOkr = okr as ResolvedOkr;
      return {
        id: resolvedOkr.id ?? '',
        source: resolvedOkr.source,
        objective: resolvedOkr.objective ?? '',
        owner: resolvedOkr.owner_name ?? '',
        due: '',  // DB OKR には due フィールドなし
        keyResults: Array.isArray(resolvedOkr.key_results_json) ? resolvedOkr.key_results_json : [],
      };
    }
    // Snapshot OKR
    const snapshotOkr = okr as OKR;
    return {
      id: String(snapshotOkr.id ?? ''),
      source: 'snapshot',
      objective: snapshotOkr.objective ?? '',
      owner: snapshotOkr.owner ?? '',
      due: snapshotOkr.due ?? '',
      keyResults: Array.isArray(snapshotOkr.keyResults) ? snapshotOkr.keyResults : [],
    };
  }

  /* ============================================================
   * 進化/探索：編集モード
   * ========================================================== */
  const [editingMode, setEditingMode] = useState<EditingMode>('committed');
  const [showDiff, setShowDiff] = useState<boolean>(true);

  // ★ 修正: cascade ではなく departments から直接取得
  // これにより deleteKr の更新が即座に selectedProj に反映される
  const selectedDept = selected && Array.isArray(departments) ? departments[selected.deptIdx] : undefined;
  const selectedProjects = selectedDept ? ensureArray(selectedDept.projects) : [];
  const selectedProj = selected && selectedDept ? selectedProjects[selected.projIdx] : undefined;

  const selectedAddKey = selected && selectedProj ? keyFor(selected.deptIdx, selected.projIdx) : '';

  const stage4SnapshotWatchHash = useMemo(() => {
    if (!selectedProj) return '';
    return hashSnapshot(buildStage4SnapshotWatchValue(selectedProj));
  }, [selectedProj, buildStage4SnapshotWatchValue]);

  useEffect(() => {
    if (stage4SnapshotWatchTimerRef.current) {
      window.clearTimeout(stage4SnapshotWatchTimerRef.current);
      stage4SnapshotWatchTimerRef.current = null;
    }
    stage4SnapshotWatchArmedRef.current = false;
    if (!selectedProj) {
      stage4SnapshotWatchPrevHashRef.current = '';
      return;
    }
    stage4SnapshotWatchPrevHashRef.current = stage4SnapshotWatchHash;
    if (!hydrated || (boot as any)?.isHydrating || isRestoring || restoreReady === false) return;
    stage4SnapshotWatchTimerRef.current = window.setTimeout(() => {
      stage4SnapshotWatchArmedRef.current = true;
    }, 500);
    return () => {
      if (stage4SnapshotWatchTimerRef.current) {
        window.clearTimeout(stage4SnapshotWatchTimerRef.current);
        stage4SnapshotWatchTimerRef.current = null;
      }
    };
  }, [selectedAddKey, hydrated, boot, isRestoring, restoreReady, selectedProj, stage4SnapshotWatchHash]);

  useEffect(() => {
    if (!selectedProj) return;
    if (!hydrated || (boot as any)?.isHydrating || isRestoring || restoreReady === false) return;
    const nextHash = stage4SnapshotWatchHash;
    const prevHash = stage4SnapshotWatchPrevHashRef.current;
    if (!prevHash) {
      stage4SnapshotWatchPrevHashRef.current = nextHash;
      return;
    }
    if (nextHash === prevHash) return;
    stage4SnapshotWatchPrevHashRef.current = nextHash;
    if (!stage4SnapshotWatchArmedRef.current) return;
    queueStage4SnapshotPersist();
  }, [stage4SnapshotWatchHash, selectedProj, hydrated, boot, isRestoring, restoreReady, queueStage4SnapshotPersist]);


  // ★ STAGE4: Resolved OKRs (DB priority + snapshot fallback)
  const projectKey = selected ? `${selected.deptIdx}:${selected.projIdx}` : '';
  const resolvedOkrs = resolvedOkrsMap[projectKey] ?? [];
  const snapshotOkrs = selectedProj ? (ensureArray(selectedProj.okrs as OKR[] | undefined) as OKR[]) : [];

  // Use resolved OKRs if available, otherwise snapshot
  // ★ Phase 2 確定: projectCacheKey で DB 優先を判定（0件 resolve でも DB優先）
  const selectedOkrs = projectKey && projectKey in resolvedOkrsMap ? resolvedOkrs : snapshotOkrs;

  // ★ STAGE4: ViewModel 化（表示用に統一）
  const displayOkrs = selectedOkrs.map(toOkrDisplayModel);
  const mainOKR = displayOkrs[0];
  const hasCascadeOkrs = displayOkrs.length > 0;

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
    updateProjectImpact,
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


  const updateProjectImpactAndSave = useCallback(
    (dIdx: number, pIdx: number, patch: Record<string, any>) => {
      updateProjectImpact(dIdx, pIdx, patch);
      queueStage4SnapshotPersist();
    },
    [updateProjectImpact, queueStage4SnapshotPersist]
  );

  const resolveCurrentStrategyId = useCallback((): string => {
    const st = useStrategyStore.getState() as any;
    return String(st?.strategyId ?? s?.strategyId ?? '');
  }, [s?.strategyId]);

  const buildStrategyDataFallback = useCallback((): StrategyData => {
    const st = useStrategyStore.getState() as any;
    return ((st?.strategiesDataGlobal?.data ?? st?.data) as StrategyData | undefined) ?? ({ departments: departments as any } as StrategyData);
  }, [departments]);

  /* ============================================================
   * ★ Phase 3A: DB OKR キャッシュの invalidate & refresh
   * ========================================================== */
  const invalidateAndRefetchProjectOkrs = useCallback(
    async (dIdx: number, pIdx: number): Promise<ResolvedOkr[] | null> => {
      if (!accessCompanyId) return null;

      const cacheKey = keyFor(dIdx, pIdx);

      // Step 1: invalidate（キャッシュ削除）
      setResolvedOkrsMap((prev) => {
        const next = { ...prev };
        delete next[cacheKey];
        return next;
      });

      // Step 2: loading 状態に
      setOkrLoadingStatus((prev) => ({
        ...prev,
        [cacheKey]: 'loading',
      }));

      try {
        // Step 3: refetch（strategDataを都度取得して refresh）
        const strategyData = buildStrategyDataFallback();

        const dept = departments?.[dIdx];
        const proj = dept?.projects?.[pIdx];
        const projId = proj ? ((proj as any).id ?? proj.title) : null;
        if (!proj || !projId) {
          setOkrLoadingStatus((prev) => ({
            ...prev,
            [cacheKey]: 'error',
          }));
          console.warn('[invalidateAndRefetchProjectOkrs] Invalid project:', { dIdx, pIdx });
          return null;
        }

        // resolveProjectsWithOkrs() で再読込
        const resolved = await okrService.resolveProjectsWithOkrs(
          projId,
          dept ? ((dept as any).id ?? dept.name) : undefined,
          strategyData,
          accessCompanyId
        );

        if (resolved?.resolvedOkrs) {
          // Step 4: キャッシュ更新
          setResolvedOkrsMap((prev) => ({
            ...prev,
            [cacheKey]: resolved.resolvedOkrs,
          }));
          setOkrLoadingStatus((prev) => ({
            ...prev,
            [cacheKey]: 'success',
          }));

          // ★ 修正（2026-04-06）：DB OKR のみを使用、snapshot は完全排除
          // 背景：mergeOkrSources() で business key 重複排除を実装したため、
          // DB OKR は既に business key ごとに1件に絞られているはず
          // snapshot は DB OKR が存在する場合は排除される

          const existingDue = String((proj as any)?.okrs?.[0]?.due ?? '');

          // Step 1: DB OKR のみを抽出
          const dbResolvedOkrs = resolved.resolvedOkrs.filter((ok) => ok?.source === 'db');

          // Step 2: DB OKR のみを snapshot 形式に変換
          const snapshotOkrs: OKR[] = dbResolvedOkrs.map((resolvedOkr, idx) => ({
            id: resolvedOkr.id,  // ★ DB id（snapshot id ではなく DB OKR id）
            objective: resolvedOkr.objective ?? '',
            owner: resolvedOkr.owner_name ?? '',
            due: idx === 0 ? existingDue : '',
            keyResults: Array.isArray(resolvedOkr.key_results_json) ? resolvedOkr.key_results_json : [],
          }));

          // ★ Step 3: 複数 DB OKR がある場合は警告（mergeOkrSources のバグを検出）
          if (dbResolvedOkrs.length > 1) {
            console.warn('[invalidateAndRefetchProjectOkrs] WARNING: multiple DB OKRs found', {
              cacheKey,
              count: dbResolvedOkrs.length,
              okrs: dbResolvedOkrs.map((o) => ({
                id: o.id,
                objective: o.objective,
                updated_at: o.updated_at,
              })),
            });
          }

          // ★ Step 4: snapshot OKR が残っていないことを確認
          const snapshotResolvedOkrs = resolved.resolvedOkrs.filter((ok) => ok?.source === 'snapshot');
          if (snapshotResolvedOkrs.length > 0) {
            console.debug('[invalidateAndRefetchProjectOkrs] snapshot OKRs excluded from result', {
              cacheKey,
              snapshotCount: snapshotResolvedOkrs.length,
              details: snapshotResolvedOkrs.map((o) => ({
                id: o.id,
                objective: o.objective,
              })),
            });
          }

          // STOPGAP:
          // DB OKR refetch 後に departments.snapshot を即同期すると、autosave 経由で
          // strategy_data.departments を再保存し、STAGE3 構造巻き戻りの原因になるため停止。
          // STAGE4/5 表示は resolvedOkrsMap を正本として扱う。

          // ★ 修正：diagnostic log で DB/snapshot の分離を明確に
          console.debug('[invalidateAndRefetchProjectOkrs] SUCCESS', {
            cacheKey,
            resolvedTotal: resolved.resolvedOkrs.length,
            dbCount: dbResolvedOkrs.length,
            snapshotCount: snapshotResolvedOkrs.length,
            snapshotOkrsLength: snapshotOkrs.length,
            returnedOkrs: resolved.resolvedOkrs.map((o) => ({
              id: o.id,
              source: o.source,
              objective: o.objective,
            })),
          });

          return resolved.resolvedOkrs;
        } else {
          setOkrLoadingStatus((prev) => ({
            ...prev,
            [cacheKey]: 'error',
          }));
        }
        return null;
      } catch (error) {
        console.error('[invalidateAndRefetchProjectOkrs] error:', error);
        setOkrLoadingStatus((prev) => ({
          ...prev,
          [cacheKey]: 'error',
        }));
        return null;
      }
    },
    [accessCompanyId, departments, setDepartments, buildStrategyDataFallback]
  );

  const ensureMainOkrIsDbBacked = useCallback(
    async (dIdx: number, pIdx: number): Promise<ResolvedOkr | null> => {
      if (!accessCompanyId) return null;
      const cacheKey = keyFor(dIdx, pIdx);
      const cached = resolvedOkrsMap[cacheKey] ?? [];
      const existingDb = cached.find((o) => o?.source === 'db') ?? null;
      if (existingDb) return existingDb;

      if (promotingProjectKeysRef.current.has(cacheKey)) return null;

      const dept = departments?.[dIdx] as any;
      const proj = dept?.projects?.[pIdx] as any;
      if (!dept || !proj) return null;

      const snapshotOkrs = Array.isArray(proj.okrs) ? proj.okrs : [];
      const first = snapshotOkrs[0] as any;
      const objective = String(first?.objective ?? '').trim();
      const owner = String(first?.owner ?? '').trim();
      if (!objective && !owner) {
        attemptedPromotionKeysRef.current.add(cacheKey);
        return null;
      }

      // ★ Target case detection - 調査用途のみ
      const projectId = String(proj?.id ?? '');
      const isTargetCase =
        objective?.includes('半導体企業向けデータ分析サービス') ||
        objective?.includes('半導体企業向けデータ分析サービスの強化') ||
        projectId?.includes('x45591');

      if (isTargetCase) {
        console.error('[ensureMainOkrIsDbBacked-TARGET] ENTRY', JSON.stringify({ dIdx, pIdx, objective, projectId }, null, 2));
      }

      // ★ Approach A: proj.id is mandatory (generated in cascade/toProjectFromDraft)
      // No fallback to proj.title - if missing, it's a data integrity issue
      const departmentId = String(dept?.id ?? dept?.name ?? '');
      const strategyId = resolveCurrentStrategyId();

      if (!projectId || !departmentId || !strategyId) {
        console.error('[ensureMainOkrIsDbBacked] missing identifiers (proj.id must exist per Approach A)', {
          cacheKey,
          projectId,
          projId: (proj as any)?.id,
          projTitle: proj?.title,
          departmentId,
          strategyId,
        });
        attemptedPromotionKeysRef.current.add(cacheKey);
        return null;
      }

      promotingProjectKeysRef.current.add(cacheKey);
      try {
        if (isTargetCase) {
          console.error('[ensureMainOkrIsDbBacked-TARGET] BEFORE SAVE', JSON.stringify({ projectId, departmentId, strategyId, objective }, null, 2));
        }

        const saved = await okrService.upsertOkr(
          {
            objective,
            owner_name: owner,
            strategy_id: strategyId,
            department_id: departmentId,
            project_id: projectId,
          },
          projectId,
          accessCompanyId
        );

        if (isTargetCase) {
          console.error('[ensureMainOkrIsDbBacked-TARGET] SAVE RESULT', JSON.stringify({ savedId: saved?.id, savedProjectId: saved?.project_id, savedObjective: saved?.objective, savedSource: saved?.source }, null, 2));
        }

        const latest = await invalidateAndRefetchProjectOkrs(dIdx, pIdx);

        if (isTargetCase) {
          console.error('[ensureMainOkrIsDbBacked-TARGET] REFETCH RESULT', JSON.stringify({ count: Array.isArray(latest) ? latest.length : 0, resolvedOkrs: Array.isArray(latest) ? latest.map((o: any) => ({ id: o?.id, objective: o?.objective, project_id: o?.project_id, source: o?.source })) : [] }, null, 2));
        }

        attemptedPromotionKeysRef.current.add(cacheKey);
        return (latest ?? []).find((o) => o?.source === 'db') ?? null;
      } catch (error) {
        console.error('[ensureMainOkrIsDbBacked] promotion failed', error);
        attemptedPromotionKeysRef.current.add(cacheKey);
        return null;
      } finally {
        promotingProjectKeysRef.current.delete(cacheKey);
      }
    },
    [accessCompanyId, departments, resolvedOkrsMap, invalidateAndRefetchProjectOkrs, resolveCurrentStrategyId]
  );

  /* ============================================================
   * ★ Phase 3A: updateProjectOKRDb (DB-first)
   * objective と owner の DB 更新 → キャッシュ refresh
   * ========================================================== */
  const updateProjectOKRDb = useCallback(
    async (dIdx: number, pIdx: number, patch: Partial<{ objective: string; owner: string }>) => {
      if (!accessCompanyId || !mainOKR) return;

      // ★ Target case detection - 調査用途のみ
      const dept = departments?.[dIdx] as any;
      const proj = dept?.projects?.[pIdx] as any;
      const projectId = String(proj?.id ?? '');
      const isTargetCase =
        mainOKR?.objective?.includes('半導体企業向けデータ分析サービス') ||
        mainOKR?.objective?.includes('半導体企業向けデータ分析サービスの強化') ||
        projectId?.includes('x45591');

      if (isTargetCase) {
        console.error('[updateProjectOKRDb-TARGET] ENTRY', JSON.stringify({ dIdx, pIdx, mainOKRObjective: mainOKR?.objective, projectId }, null, 2));
      }

      let targetOkr: OkrDisplayModel = mainOKR;
      if (targetOkr.source !== 'db') {
        const promoted = await ensureMainOkrIsDbBacked(dIdx, pIdx);
        if (!promoted) {
          alert('このOKRの編集準備に失敗しました。画面を再読み込みしてから再度お試しください。');
          return;
        }
        targetOkr = toOkrDisplayModel(promoted);
      }

      try {
        const dbPatch: Partial<OkrWriteInput> = {};
        if ('objective' in patch) dbPatch.objective = patch.objective;
        if ('owner' in patch) dbPatch.owner_name = patch.owner;

        // ★ Approach A: proj.id is mandatory (generated in cascade/toProjectFromDraft)
        const strategyId = resolveCurrentStrategyId();
        const departmentId = String(dept?.id ?? dept?.name ?? '');

        if (!projectId) {
          console.error('[updateProjectOKRDb] proj.id missing (data integrity issue)', {
            dIdx,
            pIdx,
            projId: (proj as any)?.id,
            projTitle: proj?.title,
            targetOkrId: targetOkr?.id,
          });
          return;
        }

        if (isTargetCase) {
          console.error('[updateProjectOKRDb-TARGET] BEFORE SAVE', JSON.stringify({ targetOkrId: targetOkr?.id, projectId, departmentId, strategyId, patchObjective: dbPatch.objective, patchOwner: dbPatch.owner_name }, null, 2));
        }

        // ★ Conservative: targetOkr は OkrDisplayModel で project_id を持たないため、
        // 既存の project_id との比較は不可能。proj.id で上書きするのが目的。

        const updateResult = await okrService.upsertOkr(
          {
            id: targetOkr.id,
            objective: dbPatch.objective ?? targetOkr.objective,
            owner_name: dbPatch.owner_name ?? targetOkr.owner,
            strategy_id: strategyId,
            department_id: departmentId,
            project_id: projectId,
          },
          projectId,
          accessCompanyId
        );

        if (isTargetCase) {
          console.error('[updateProjectOKRDb-TARGET] SAVE RESULT', JSON.stringify({ savedId: updateResult?.id, savedProjectId: updateResult?.project_id, savedObjective: updateResult?.objective, savedSource: updateResult?.source }, null, 2));
        }

        const refetchResult = await invalidateAndRefetchProjectOkrs(dIdx, pIdx);

        if (isTargetCase) {
          console.error('[updateProjectOKRDb-TARGET] REFETCH RESULT', JSON.stringify({ count: Array.isArray(refetchResult) ? refetchResult.length : 0, resolvedOkrs: Array.isArray(refetchResult) ? refetchResult.map((o: any) => ({ id: o?.id, objective: o?.objective, project_id: o?.project_id, source: o?.source })) : [] }, null, 2));
        }
      } catch (error) {
        console.error('[updateProjectOKRDb] error:', error);
        alert('OKRの更新に失敗しました');
      }
    },
    [mainOKR, accessCompanyId, invalidateAndRefetchProjectOkrs, departments, ensureMainOkrIsDbBacked, resolveCurrentStrategyId]
  );

  /* ============================================================
   * ★ STAGE4: AI生成処理（実行計画たたき台）
   * ========================================================== */
  const generateExecutionDraft = useCallback(
    async (dIdx: number, pIdx: number) => {
      if (!selected || selected.deptIdx !== dIdx || selected.projIdx !== pIdx) return;

      const dept = departments?.[dIdx];
      const proj = selectedProj;

      if (!dept || !proj) return;

      setIsGenerating(true);
      setGenerationError(null);

      try {
        // ★ STAGE3 KPI を抽出（固定KPI、変更・追加・削除させない）
        // 優先順位：okrs.keyResults > kpis > okrsV2.labels
        let sourceKpis: string[] = [];

        // 1. OKR keyResults から抽出
        if (Array.isArray(proj.okrs) && proj.okrs.length > 0) {
          const okr = proj.okrs[0];
          if (Array.isArray(okr.keyResults)) {
            sourceKpis.push(...okr.keyResults.filter((kr: any) => typeof kr === 'string' && kr.trim()));
          }
        }

        // 2. kpis から抽出（keyResults がない場合）
        if (sourceKpis.length === 0 && Array.isArray((proj as any)?.kpis)) {
          sourceKpis.push(...(proj as any).kpis.filter((k: any) => typeof k === 'string' && k.trim()));
        }

        // 3. okrsV2.label から抽出（上記がない場合）
        if (sourceKpis.length === 0 && Array.isArray(proj.okrsV2)) {
          const v2Labels = proj.okrsV2
            .filter((kr: any) => kr?.label && typeof kr.label === 'string')
            .map((kr: any) => kr.label);
          sourceKpis.push(...v2Labels);
        }

        // ★ sourceKpisのプレフィックスを削除（STAGE4保存値は整形後にする）
        sourceKpis = sourceKpis.map(stripProjectPrefix);

        // プロジェクト情報を収集
        const projectInfo = {
          departmentName: typeof dept === 'object' ? (dept as any)?.name || '' : String(dept),
          projectTitle: proj.title || '',
          hypothesis: (proj as any)?.hypothesis || '',
          rationale: (proj as any)?.rationale || '',
          reason: (proj as any)?.reason || '',
          kind: (proj as any)?.kind || '',
          mainLever: (proj as any)?.mainLever || '',
          horizon: (proj as any)?.horizon || '',
          role: (proj as any)?.role || 'REVENUE',
          due: (proj as any)?.okrs?.[0]?.due || '',
          ownerName: mainOKR?.owner || '',
          existingOkrs: ensureArray(proj.okrs),
          existingOkrsV2: ensureArray(proj.okrsV2),
          existingKpis: Array.isArray((proj as any)?.kpis) ? (proj as any).kpis : [],
          sourceKpis: sourceKpis,  // ★ STAGE3 固定KPI（AIが変更しない）
          companyStrategy: (() => {
            const st = useStrategyStore.getState() as any;
            const strats = st?.strategiesDataGlobal?.data ?? st?.data;
            if (strats && typeof strats === 'object' && 'summary' in strats) {
              return (strats as any).summary;
            }
            return '';
          })(),
          companyTargets: (() => {
            const st = useStrategyStore.getState() as any;
            const strats = st?.strategiesDataGlobal?.data ?? st?.data;
            if (strats && typeof strats === 'object' && 'targets' in strats) {
              return ensureArray((strats as any).targets);
            }
            return [];
          })(),
        };

        // API 呼び出し
        // Bearer token を取得
        let token = '';
        try {
          const { data } = await safeGetSession();
          token = data.session?.access_token || '';

          if (!token) {
            throw new Error('ログイン情報を確認できませんでした。再ログインしてください。');
          }
        } catch (tokenError: any) {
          console.error('[generateExecutionDraft] Failed to get session', tokenError?.message);
          throw new Error(`認証エラー: ${tokenError?.message || 'セッション取得失敗'}`);
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        };

        let response;
        try {
          response = await fetch('/api/stage4/generate-execution-draft', {
            method: 'POST',
            headers,
            body: JSON.stringify(projectInfo),
          });
        } catch (fetchError: any) {
          console.error('[generateExecutionDraft] fetch failed', fetchError);
          throw new Error(`API接続エラー: ${fetchError?.message || 'Unknown error'}`);
        }

        if (!response) {
          console.error('[generateExecutionDraft] response is undefined');
          throw new Error('APIからの応答が得られませんでした');
        }

        let result;
        try {
          result = await response.json();
        } catch (parseError: any) {
          console.error('[generateExecutionDraft] JSON parse failed', parseError);
          throw new Error(`APIレスポンスの解析に失敗しました: ${parseError?.message}`);
        }

        if (!response.ok) {
          const errorMsg = result?.error || `API Error (Status ${response.status})`;
          throw new Error(errorMsg);
        }

        const draft = result?.draft;

        if (!draft) {
          throw new Error('APIからデータが返されませんでした');
        }

        // 生成結果を画面に反映
        // ★ ポイント：既存データを無条件に上書きしない。追記・補完の方針

        // 1. objective を DB に保存（既存値がない場合のみ）
        if (draft.objective && mainOKR && !mainOKR.objective) {
          await updateProjectOKRDb(dIdx, pIdx, { objective: draft.objective });
        }

        // 2. role を更新（既存値がない場合のみ）
        if (draft.role && (!selectedProj || !(selectedProj as any)?.role)) {
          updateProjectRole(dIdx, pIdx, draft.role);
        }

        // 3. impact を更新（既存値がない場合のみ補完）
        // ★ 修正：売上と営業利益の優先順位を分離して設定
        if (draft.impact) {
          const currentImpact = (selectedProj as any) || {};
          const impactPatch: Record<string, any> = {};
          const impactRole = (draft.role || (selectedProj as any)?.role) as ImpactRole | undefined;
          const assumptions = draft.impact.assumptions as ImpactAssumptions | undefined;
          const calculatedImpact = getImpactResultFromAssumptions(impactRole, assumptions);

          // 売上寄与（impactRevenueMJPY）は REVENUE 役割のみ
          if (!currentImpact.impactRevenueMJPY && impactRole === 'REVENUE') {
            impactPatch.impactRevenueMJPY = calculatedImpact?.resultValue ?? draft.impact.revenueMJPY;
          }

          // 営業利益寄与（impactOpIncomeMJPY）は全役割で設定（既存値がない場合のみ）
          if (!currentImpact.impactOpIncomeMJPY) {
            // ★ 優先順位：draft.opIncomeMJPY > 推定値 > undefined
            const revenueImpactMJPY =
              toNumber(currentImpact.impactRevenueMJPY) ??
              toNumber(impactPatch.impactRevenueMJPY) ??
              toNumber(draft.impact?.revenueMJPY);

            const draftOpIncomeMJPY = toNumber(draft.impact?.opIncomeMJPY);

            // フォールバック営業利益率（10%）
            const estimatedOperatingMargin = 0.1;

            const estimatedOpIncomeMJPY =
              draftOpIncomeMJPY ??
              (typeof revenueImpactMJPY === 'number'
                ? Math.round(revenueImpactMJPY * estimatedOperatingMargin)
                : undefined);

            if (typeof estimatedOpIncomeMJPY === 'number') {
              impactPatch.impactOpIncomeMJPY = estimatedOpIncomeMJPY;
            }
          }

          if (!currentImpact.impactInvestmentMJPY && impactRole === 'FUTURE') {
            impactPatch.impactInvestmentMJPY = calculatedImpact?.resultValue ?? draft.impact.investmentMJPY;
          }
          if (!currentImpact.impactRationale && draft.impact.rationale) {
            impactPatch.impactRationale = draft.impact.rationale;
          }
          if (!currentImpact.impactAssumptions && assumptions) {
            impactPatch.impactAssumptions = assumptions;
          }

          if (Object.keys(impactPatch).length > 0) {
            updateProjectImpactAndSave(dIdx, pIdx, impactPatch);
          }
        }

        // 4. KPI を更新（既存の okrsV2 と統合）
        // 既存 KPI がなければ生成値を使用、既存 KPI があれば既存値を優先
        if (Array.isArray(draft.kpis) && draft.kpis.length > 0) {
          patchDepartments((prev) => {
            const next = [...prev];
            const dept = next[dIdx];
            if (!dept) return prev;

            const projects = Array.isArray(dept.projects) ? [...dept.projects] : [];
            const proj = projects[pIdx];
            if (!proj) return prev;

            const existingOkrsV2 = ensureArray(proj.okrsV2);

            // 既存 KPI が十分ある場合はスキップ（たたき台なので邪魔しない）
            if (existingOkrsV2.length >= draft.kpis.length) {
              return prev;
            }

            // 既存 KPI が不足している場合のみ生成値で補足
            const updatedOkrsV2 = [
              ...existingOkrsV2,
              ...draft.kpis.slice(existingOkrsV2.length).map((kpi: any) => ({
                label: kpi.label,
                target: kpi.target,
                unit: kpi.unit,
                due: kpi.due,
                owner: kpi.owner || '',
                milestones: Array.isArray(kpi.milestones) ? kpi.milestones : [],
              })),
            ];

            proj.okrsV2 = updatedOkrsV2;
            projects[pIdx] = proj;
            dept.projects = projects;
            next[dIdx] = dept;
            return next;
          });
        }

        // 生成結果をプレビューに設定（sourceKpis を含める）
        setGeneratedDraft({ ...draft, sourceKpis });
        setGenerationSuccess(true);
        setGenerationError(null);

        // 成功メッセージ（3秒後に消える）
        setTimeout(() => setGenerationSuccess(false), 3000);
      } catch (error: any) {
        console.error('[generateExecutionDraft] Error:', error);
        const errorMsg = error?.message || '実行計画の生成に失敗しました。もう一度お試しください。';
        setGenerationError(errorMsg);
        setGeneratedDraft(null);
      } finally {
        setIsGenerating(false);
      }
    },
    [
      selected,
      selectedProj,
      departments,
      mainOKR,
      updateProjectOKRDb,
      updateProjectRole,
      updateProjectImpactAndSave,
      patchDepartments,
    ]
  );

  /* ============================================================
   * ★ STAGE4: AI生成結果を画面に反映
   * ========================================================== */
  const applyGeneratedDraft = useCallback(
    async (dIdx: number, pIdx: number, draft: any, sourceKpis: string[] = []) => {
      if (!draft || !selected || selected.deptIdx !== dIdx || selected.projIdx !== pIdx) return;

      try {
        // 1. objective を DB に保存（既存値がない場合のみ）
        if (draft.objective && mainOKR && !mainOKR.objective) {
          await updateProjectOKRDb(dIdx, pIdx, { objective: draft.objective });
        }

        // 2. role を更新（既存値がない場合のみ）
        if (draft.role && (!selectedProj || !(selectedProj as any)?.role)) {
          updateProjectRole(dIdx, pIdx, draft.role);
        }

        // 3. impact を更新（既存値がない場合のみ補完）
        // ★ 修正：売上と営業利益の優先順位を分離して設定
        if (draft.impact) {
          const currentImpact = (selectedProj as any) || {};
          const impactPatch: Record<string, any> = {};
          const impactRole = (draft.role || (selectedProj as any)?.role) as ImpactRole | undefined;
          const assumptions = draft.impact.assumptions as ImpactAssumptions | undefined;
          const calculatedImpact = getImpactResultFromAssumptions(impactRole, assumptions);

          // 売上寄与（impactRevenueMJPY）は REVENUE 役割のみ
          if (!currentImpact.impactRevenueMJPY && impactRole === 'REVENUE') {
            impactPatch.impactRevenueMJPY = calculatedImpact?.resultValue ?? draft.impact.revenueMJPY;
          }

          // 営業利益寄与（impactOpIncomeMJPY）は全役割で設定（既存値がない場合のみ）
          if (!currentImpact.impactOpIncomeMJPY) {
            // ★ 優先順位：draft.opIncomeMJPY > 推定値 > undefined
            const revenueImpactMJPY =
              toNumber(currentImpact.impactRevenueMJPY) ??
              toNumber(impactPatch.impactRevenueMJPY) ??
              toNumber(draft.impact?.revenueMJPY);

            const draftOpIncomeMJPY = toNumber(draft.impact?.opIncomeMJPY);

            // フォールバック営業利益率（10%）
            const estimatedOperatingMargin = 0.1;

            const estimatedOpIncomeMJPY =
              draftOpIncomeMJPY ??
              (typeof revenueImpactMJPY === 'number'
                ? Math.round(revenueImpactMJPY * estimatedOperatingMargin)
                : undefined);

            if (typeof estimatedOpIncomeMJPY === 'number') {
              impactPatch.impactOpIncomeMJPY = estimatedOpIncomeMJPY;
            }
          }

          if (!currentImpact.impactInvestmentMJPY && impactRole === 'FUTURE') {
            impactPatch.impactInvestmentMJPY = calculatedImpact?.resultValue ?? draft.impact.investmentMJPY;
          }
          if (!currentImpact.impactRationale && draft.impact.rationale) {
            impactPatch.impactRationale = draft.impact.rationale;
          }

          // ★ 計算前提（assumptions）も保存
          if (draft.impact.assumptions && !currentImpact.impactAssumptions) {
            impactPatch.impactAssumptions = draft.impact.assumptions;
          }

          if (Object.keys(impactPatch).length > 0) {
            updateProjectImpactAndSave(dIdx, pIdx, impactPatch);
          }
        }

        // 4. KPI を更新（既存の okrsV2 を AI案で補完）
        // ★ ポイント：既存 KPI に AI案の target/unit/due/owner/milestones を補完
        // AI案は追記ではなく、既存 KPI を具体化するために使う
        let updatedKpisCount = 0;
        const mergeResults: Array<{ existingLabel: string; draftLabel?: string; updatedFields: string[] }> = [];

        if (Array.isArray(draft.kpis) && draft.kpis.length > 0) {
          patchDepartments((prev) => {
            const next = [...prev];
            const dept = next[dIdx];
            if (!dept) return prev;

            const projects = Array.isArray(dept.projects) ? [...dept.projects] : [];
            const proj = projects[pIdx];
            if (!proj) return prev;

            const existingOkrsV2 = ensureArray(proj.okrsV2);
            const draftLabels = draft.kpis.map((kpi: any) => kpi.label);

            // ★ STAGE3 KPIがある場合は sourceKpis を基準に構築
            // ない場合は既存 KPI と AI案を index 順でマッチング
            const kpisToProcess = sourceKpis.length > 0 ? sourceKpis : existingOkrsV2.map((kr: any) => kr.label);

            const updatedOkrsV2 = kpisToProcess.map((kpiLabel: string, idx: number) => {
              const existingKr = existingOkrsV2[idx];
              const draftKpi = draft.kpis[idx];

              const updatedFields: string[] = [];
              // ★ sourceKpis がある場合は新規作成、ない場合は既存を保持
              const updatedKr: any = sourceKpis.length > 0
                ? { label: kpiLabel }
                : existingKr ? { ...existingKr } : { label: kpiLabel };

              // ★ sourceKpis がある場合、ラベルは常にsourceKpiで固定
              if (sourceKpis.length > 0) {
                updatedKr.label = sourceKpis[idx];
                updatedFields.push('label (fixed from STAGE3)');
              }

              if (!draftKpi) return updatedKr;

              // target が 0 または未設定なら AI案の target を入れる
              if (!updatedKr.target || updatedKr.target === 0) {
                if (draftKpi.target) {
                  updatedKr.target = Number(draftKpi.target);
                  updatedFields.push('target');
                }
              }

              // unit が未設定なら AI案の unit を入れる
              if (!updatedKr.unit && draftKpi.unit) {
                updatedKr.unit = draftKpi.unit;
                updatedFields.push('unit');
              }

              // due が未設定なら AI案の due を入れる
              if (!updatedKr.due && draftKpi.due) {
                updatedKr.due = draftKpi.due;
                updatedFields.push('due');
              }

              // owner が未設定なら AI案の owner を入れる
              if (!updatedKr.owner && draftKpi.owner) {
                updatedKr.owner = draftKpi.owner;
                updatedFields.push('owner');
              }

              // milestones が未設定なら AI案の milestones を入れる
              if ((!updatedKr.milestones || updatedKr.milestones.length === 0) && Array.isArray(draftKpi.milestones) && draftKpi.milestones.length > 0) {
                updatedKr.milestones = draftKpi.milestones;
                updatedFields.push('milestones');
              }

              if (updatedFields.length > 0) {
                updatedKpisCount++;
                mergeResults.push({
                  existingLabel: existingKr.label,
                  draftLabel: draftKpi.label,
                  updatedFields,
                });
              }

              return updatedKr;
            });

            proj.okrsV2 = updatedOkrsV2;
            projects[pIdx] = proj;
            dept.projects = projects;
            next[dIdx] = dept;

            return next;
          });
        }

        // 反映内容をサマリー
        const summary: string[] = [];
        if (draft.objective && !mainOKR?.objective) summary.push('目的');
        if (draft.role && !selectedProj?.role) summary.push('役割');
        if (draft.impact) {
          const impactCount = [
            draft.impact.revenueMJPY !== null,
            draft.impact.opIncomeMJPY !== null,
            draft.impact.investmentMJPY !== null,
          ].filter(Boolean).length;
          if (impactCount > 0) summary.push(`期待成果(${impactCount}項目)`);
        }
        if (updatedKpisCount > 0) summary.push(`既存KPI ${updatedKpisCount}件に目標値・期限・途中目標を反映`);

        setGeneratedDraft(null);
        queueStage4SnapshotPersist();

        // 成功メッセージ
        const msg = summary.length > 0
          ? `AI案を反映しました：${summary.join('、')}`
          : 'AI案の反映が完了しました。';
        alert(msg);
      } catch (error: any) {
        console.error('[applyGeneratedDraft] Error:', error);
        alert(`AI案の反映に失敗しました: ${error?.message}`);
      }
    },
    [
      selected,
      selectedProj,
      mainOKR,
      updateProjectOKRDb,
      updateProjectRole,
      updateProjectImpactAndSave,
      patchDepartments,
      queueStage4SnapshotPersist,
    ]
  );

  /* ============================================================
   * ★ Phase 3A: updateProjectDue (snapshot-only)
   * due は DB 正本に存在しないため snapshot 専用
   * ========================================================== */
  const updateProjectDue = useCallback(
    (dIdx: number, pIdx: number, due: string) => {
      patchDepartments((prev) => {
        const next = [...prev];
        const dept = next[dIdx];
        if (!dept) return prev;

        const projects = Array.isArray(dept.projects) ? [...dept.projects] : [];
        const proj = projects[pIdx];
        if (!proj) return prev;

        const okrs = ensureArray(proj.okrs as OKR[] | undefined);
        if (okrs[0]) {
          okrs[0] = { ...okrs[0], due };
        } else {
          okrs[0] = { objective: '', owner: '', due, keyResults: [] as any } as any;
        }

        projects[pIdx] = { ...proj, okrs };
        dept.projects = projects;
        next[dIdx] = dept;
        return next;
      });
      queueStage4SnapshotPersist();
    },
    [patchDepartments, queueStage4SnapshotPersist]
  );

  /* ============================================================
   * ★ Phase 3A.5: objective/owner の local draft state
   * （onChange で即 DB 更新でなく、onBlur で DB 更新）
   * ========================================================== */
  const [objDraft, setObjDraft] = useState<string | null>(null);
  const [ownerDraft, setOwnerDraft] = useState<string | null>(null);
  const [isSavingOkr, setIsSavingOkr] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedDraft, setGeneratedDraft] = useState<any>(null);
  const [generationSuccess, setGenerationSuccess] = useState(false);
  const [showDirectImpactInput, setShowDirectImpactInput] = useState(false);

  // 表示値：draft があれば draft、無ければ mainOKR から取得
  const displayObjective = objDraft !== null ? objDraft : (mainOKR?.objective ?? '');
  const displayOwner = ownerDraft !== null ? ownerDraft : (mainOKR?.owner ?? '');

  const selectedImpactRole = ((selectedProj as any)?.role || undefined) as ImpactRole | undefined;
  const selectedImpactAssumptions = ((selectedProj as any)?.impactAssumptions || {}) as ImpactAssumptions;
  const selectedImpactCalculation = useMemo(
    () => getImpactResultFromAssumptions(selectedImpactRole, selectedImpactAssumptions),
    [selectedImpactRole, selectedImpactAssumptions],
  );

  const updateImpactAssumptionsAndSave = useCallback(
    (assumptionPatch: ImpactAssumptions) => {
      if (!selected || !selectedImpactRole) return;

      const nextAssumptions = {
        ...(((selectedProj as any)?.impactAssumptions || {}) as ImpactAssumptions),
        ...assumptionPatch,
      };
      const calculated = getImpactResultFromAssumptions(selectedImpactRole, nextAssumptions);
      const impactPatch: Record<string, any> = {
        impactAssumptions: nextAssumptions,
      };

      if (calculated) {
        impactPatch[calculated.resultKey] = calculated.resultValue;
      }

      updateProjectImpactAndSave(selected.deptIdx, selected.projIdx, impactPatch);
    },
    [selected, selectedProj, selectedImpactRole, updateProjectImpactAndSave],
  );

  useEffect(() => {
    if (!selected || !mainOKR) return;
    if (mainOKR.source === 'db') return;
    const cacheKey = keyFor(selected.deptIdx, selected.projIdx);
    if (promotingProjectKeysRef.current.has(cacheKey)) return;
    if (attemptedPromotionKeysRef.current.has(cacheKey)) return;
    void ensureMainOkrIsDbBacked(selected.deptIdx, selected.projIdx);
  }, [selected, mainOKR?.id, mainOKR?.source, ensureMainOkrIsDbBacked]);

  /* ============================================================
   * ★ Phase 3C: deleteProjectOKR (soft delete)
   * DB に is_deleted=true をセット → reload 後は merge で除外される
   * ========================================================== */
  const deleteProjectOKR = useCallback(
    async (dIdx: number, pIdx: number) => {
      if (!accessCompanyId || !mainOKR || !selected) return;

      // ★ source 判定: DB OKR のときだけ削除
      if (mainOKR.source !== 'db') {
        alert('このOKRは削除できません。DB から読み込まれたOKRのみ削除可能です。');
        return;
      }

      // 確認ダイアログ
      if (!confirm('このOKRを削除します。よろしいですか？\n（データベースに記録は残ります）')) {
        return;
      }

      setIsSavingOkr(true);
      try {
        // プロジェクト情報を departments から取得
        const dept = departments?.[dIdx];
        const proj = dept?.projects?.[pIdx];
        const projectId = proj ? String((proj as any).id ?? proj.title) : String(mainOKR.id ?? '');

        // ★ okrService.deleteOkr() で soft delete（DB に is_deleted=true）
        await okrService.deleteOkr(mainOKR.id, projectId, accessCompanyId);

        // ★ キャッシュ refresh
        await invalidateAndRefetchProjectOkrs(dIdx, pIdx);

        // ★ STAGE6 okrsV2 への同期: **意図的に実装しない**
        //
        // 【理由】ファイル先頭の ARCHITECTURE セクションを参照
        // - okrs（STAGE4/5） と okrsV2（STAGE6） は完全に独立した構造
        // - okrs の各要素と okrsV2 の各要素の間に parentOkrId リンクが存在しない
        // - 対応関係が未定義のため、OKR 削除時に「どの KR を削除するか」が決定不可能
        // - okrsV2 を無闇に削除すると STAGE6 の計算入力を破壊してしまう
        //
        // 【将来の拡張】
        // もし okrs と okrsV2 を連携させたい場合:
        //   1. okrs テーブルに parentOkrId カラムを追加（スキーマ変更）
        //   2. OKR:KR の 1:多 マッピング定義を設計
        //   3. Delete/Add/Reorder 時に okrsV2 も同期するコード実装
        //   4. STAGE6 の本当の要件を検証した上で実装を進める
        //
        // （参考）2025-03-16 検証済み:
        // - STAGE6 は proj.okrsV2 を calcYearlyFromKrs() の入力として使用
        // - okrs から okrsV2 への自動生成メカニズムは存在しない
        // - 両者は別系統で管理されるべき設計

        console.debug('[deleteProjectOKR] SUCCESS:', { okrId: mainOKR.id, projectId });
      } catch (error) {
        console.error('[deleteProjectOKR] error:', error);
        alert('OKRの削除に失敗しました');
      } finally {
        setIsSavingOkr(false);
      }
    },
    [mainOKR, accessCompanyId, selected, invalidateAndRefetchProjectOkrs, departments]
  );

  /* ============================================================
   * ★ Phase 3B: addProjectOKR (新OKR追加)
   * objective を入力して DB に insert → キャッシュ refresh
   * ========================================================== */
  const addProjectOKR = useCallback(
    async (dIdx: number, pIdx: number) => {
      if (!accessCompanyId || !selected) return;

      // Objective を入力させる（簡易版：prompt 使用）
      const objInput = prompt('新しいOKRの目的を入力してください:');
      if (!objInput) {
        return;  // キャンセルまたは空入力
      }
      const objective = objInput.trim();
      if (!objective) {
        return;  // 空白のみの場合
      }

      setIsSavingOkr(true);
      try {
        // プロジェクト情報を departments から取得
        const dept = departments?.[dIdx];
        const proj = dept?.projects?.[pIdx];
        // ★ Approach A: proj.id is mandatory (generated in cascade/toProjectFromDraft)
        const projectId = proj ? String((proj as any).id ?? '') : '';
        const deptId = dept ? String((dept as any).id ?? dept.name) : '';

        // ★ Target case detection - 調査用途のみ
        const isTargetCase =
          objective?.includes('半導体企業向けデータ分析サービス') ||
          objective?.includes('半導体企業向けデータ分析サービスの強化') ||
          projectId?.includes('x45591');

        if (isTargetCase) {
          console.error('[addProjectOKR-TARGET] ENTRY', JSON.stringify({ dIdx, pIdx, objective, projectId }, null, 2));
        }

        if (!projectId) {
          console.error('[addProjectOKR] proj.id missing (data integrity issue)', {
            dIdx,
            pIdx,
            projExists: !!proj,
            projId: proj ? (proj as any).id : undefined,
            projTitle: proj?.title,
          });
          alert('プロジェクト情報が取得できません');
          return;
        }

        if (isTargetCase) {
          console.error('[addProjectOKR-TARGET] BEFORE SAVE', JSON.stringify({ projectId, deptId, strategyId: resolveCurrentStrategyId(), objective }, null, 2));
        }

        // ★ okrService.upsertOkr() で DB に新規 insert
        // （id を指定しないと新規作成）
        const saveResult = await okrService.upsertOkr(
          {
            objective,
            owner_name: '',
            strategy_id: resolveCurrentStrategyId(),
            department_id: deptId,
            project_id: projectId,
          },
          projectId,
          accessCompanyId
        );

        // ★ 診断: SAVE RESULT を出力
        if (isTargetCase) {
          console.error('[addProjectOKR-TARGET] SAVE RESULT', JSON.stringify({ savedId: saveResult?.id, savedProjectId: saveResult?.project_id, savedObjective: saveResult?.objective, savedSource: saveResult?.source }, null, 2));
        }

        // ★ キャッシュ refresh
        const refetchResult = await invalidateAndRefetchProjectOkrs(dIdx, pIdx);

        // ★ 診断: REFETCH RESULT を出力
        if (isTargetCase) {
          console.error('[addProjectOKR-TARGET] REFETCH RESULT', JSON.stringify({ count: Array.isArray(refetchResult) ? refetchResult.length : 0, resolvedOkrs: Array.isArray(refetchResult) ? refetchResult.map((o: any) => ({ id: o?.id, objective: o?.objective, project_id: o?.project_id, source: o?.source })) : [] }, null, 2));
        }

        // ※ okrsV2 への追加は行わない（ファイル先頭の ARCHITECTURE セクション参照）
        // 理由：okrs と okrsV2 の対応関係が未定義のため、新規 KR をどう作成するか不明

        console.debug('[addProjectOKR] SUCCESS:', { objective, projectId });
      } catch (error) {
        console.error('[addProjectOKR] error:', error);
        alert('OKRの追加に失敗しました');
      } finally {
        setIsSavingOkr(false);
      }
    },
    [accessCompanyId, selected, invalidateAndRefetchProjectOkrs, departments]
  );

  /* ============================================================
   * ★ Phase 4: reorderProjectOKRs (並び替え)
   * sort_order を更新して OKR リストの順序を変更
   * ========================================================== */
  const reorderProjectOKRs = useCallback(
    async (dIdx: number, pIdx: number, direction: 'up' | 'down') => {
      if (!accessCompanyId || !displayOkrs || displayOkrs.length <= 1) return;

      // 現在の mainOKR（displayOkrs[0]）の sort_order を変更
      // 実装簡略化：DB の displayOkrs 全体を再ソート
      // （本来は全 OKR の sort_order 一括更新が必要）
      const currentIdx = 0;  // mainOKR の仮インデックス
      const newIdx = direction === 'up' ? currentIdx - 1 : currentIdx + 1;

      if (newIdx < 0 || newIdx >= displayOkrs.length) {
        return;  // 移動不可
      }

      setIsSavingOkr(true);
      try {
        // プロジェクト情報を departments から取得
        const dept = departments?.[dIdx];
        const proj = dept?.projects?.[pIdx];
        const projectId = proj ? String((proj as any).id ?? proj.title) : '';

        if (!projectId) {
          alert('プロジェクト情報が取得できません');
          return;
        }

        // displayOkrs の id リストを並び替え前提で sort_order を更新
        const orderedIds = displayOkrs.map((o) => o.id);
        // swap
        const tmp = orderedIds[currentIdx];
        orderedIds[currentIdx] = orderedIds[newIdx];
        orderedIds[newIdx] = tmp;

        // ★ okrService.reorderOkrs() で DB 更新
        await okrService.reorderOkrs(projectId, orderedIds, accessCompanyId);

        // ★ キャッシュ refresh
        await invalidateAndRefetchProjectOkrs(dIdx, pIdx);

        // ※ okrsV2 の再ソートは行わない（ファイル先頭の ARCHITECTURE セクション参照）
        // 理由：okrs と okrsV2 の対応関係が未定義のため、並び替えの影響が不明

        console.debug('[reorderProjectOKRs] SUCCESS:', { direction, projectId });
      } catch (error) {
        console.error('[reorderProjectOKRs] error:', error);
        alert('OKRの並び替えに失敗しました');
      } finally {
        setIsSavingOkr(false);
      }
    },
    [accessCompanyId, displayOkrs, invalidateAndRefetchProjectOkrs, departments]
  );

  {/* -------- プロジェクト追加（page側に残す：UI状態と密結合） -------- */}
  const confirmAddProject = (deptIdx: number) => {
    const title = newProjectTitle.trim();
    if (!title) {
      alert('プロジェクト名を入力してください。');
      return;
    }

    // ★ 修正: cascade ではなく departments から取得
    const baseDept = Array.isArray(departments) ? departments[deptIdx] : undefined;
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
        okrs: [{ objective: '', owner: '', due: '', keyResults: [] as any }],
        okrsV2: [],
        okrVariants: [],
        okrRevision: 0,
      };
      projs.push(newProj);
      dept.projects = projs;
      next[deptIdx] = dept;
      return next;
    });

    if (saveNow) void saveNow();
    setSelected({ deptIdx, projIdx: newProjIdx });
    setAddingProjectForDept(null);
    setNewProjectTitle('');
  };



  {/* -------- 選択の安定化（index drift 防止 / 無限ループ対策） -------- */}
  useEffect(() => {
    // 初期は「未選択」を維持（右パネルに勝手に出さない）
    if (!selected) return;

    // ★ 修正: cascade ではなく departments を使う
    if (!Array.isArray(departments) || departments.length === 0) {
      setSelected(null);
      return;
    }

    // ✅ まず「いまの index が有効なら何もしない」
    const dNow = departments[selected.deptIdx];
    const pNow = dNow ? ensureArray(dNow.projects) : [];
    const nowValid = !!dNow && selected.projIdx >= 0 && selected.projIdx < pNow.length;
    if (nowValid) return;

    // ❗ index が壊れているときだけ stable key で復元を試みる（ここ以外では setSelected しない）
    const stable = selectedStableRef.current;
    if (stable) {
      for (let di = 0; di < departments.length; di += 1) {
        const d = departments[di];
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
  }, [departments, selected]);

  // 選択が確定したタイミングで stable key を更新
  useEffect(() => {
    if (!selectedDept || !selectedProj) return;
    const dk = deptKeyOf(selectedDept);
    const pk = projKeyOf(selectedProj);
    if (!dk || !pk) return;
    selectedStableRef.current = { deptKey: dk, projKey: pk };
  }, [selectedAddKey]);

  {/* -------- 選択プロジェクトが変わったら、mode を安全側（committed）に戻す -------- */}
  useEffect(() => {
    setEditingMode('committed');
  }, [selectedAddKey]);

  // ★ 修正: currentKrList を廃止して selectedProj.okrsV2 から直接取得
  // これにより deleteKr の更新が即座に反映される（不要な useMemo による delay を排除）
  const renderKrList = selectedProj?.okrsV2 || [];

    {/* -------- 初期補修：KR id 補完 + label 正規化（committed + variants） -------- */}
  useEffect(() => {
    if (!Array.isArray(departments) || departments.length === 0) return;

    // ★ 修正: 初回のみ実行（削除後の KR 再注入防止）
    if (initialRepairCompletedRef.current) {
      console.log('[diag][okr:initial-repair-useeffect-skip]', {
        already: 'completed',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // ★ 診断: 初期補修 useEffect が実行された
    console.log('[diag][okr:initial-repair-useeffect-start]', {
      deptCount: departments.length,
      timestamp: new Date().toISOString(),
      trigger: 'first initialization',
    });

    // 既存ヘルパ（id補完）＋ label 正規化（[object Object] 根絶）
    const withIds = ensureKrIds(departments as Department[]);

    let changed = false;
    const patched = (withIds as Department[]).map((d) => {
      const projs = ensureArray(d.projects);
      let deptChanged = false;

      const nextProjs = projs.map((p) => {
        let projChanged = false;

        // ★ 診断: this project's initial state
        console.log('[diag][okr:normalize-project-start]', {
          projectTitle: (p as any)?.title,
          okrsV2Count: Array.isArray((p as any)?.okrsV2) ? (p as any).okrsV2.length : 0,
          okrsV2Ids: Array.isArray((p as any)?.okrsV2) ? (p as any).okrsV2.map((kr: any) => kr?.id) : [],
        });

        const normalizeList = (list: any[] | undefined) => {
          const src = ensureArray(list);
          let localChanged = false;

          const mapped = src.map((kr) => {
            const before = kr ?? {};
            const after = { ...(before as any) };

            if (after.label != null && typeof after.label !== 'string') {
              after.label = String(after.label);
              localChanged = true;
            }
const isObjectObject =
  typeof after.label === 'string' && after.label.includes('[object Object]');

if (isObjectObject) {
  // 破損KR（labelが[object Object]）は空欄にせず削除対象にする
  localChanged = true;
  return null as any;
}

if (after.label == null) {
  after.label = '';
  localChanged = true;
}

return localChanged ? after : before;
          });

          const dst = mapped.filter(Boolean) as any[];
          if (dst.length !== src.length) localChanged = true;

          if (localChanged) changed = true;

          // ★ 診断: normalizeList processing
          if (src.length > 0 || dst.length > 0) {
            console.log('[diag][okr:normalize-list]', {
              inputCount: src.length,
              outputCount: dst.length,
              changed: localChanged,
              inputIds: src.map((x: any) => x?.id),
              outputIds: dst.map((x: any) => x?.id),
            });
          }

          return localChanged ? dst : src;
        };

const okrsV2Fixed = normalizeList((p as any).okrsV2);

// okrs.keyResults も正規化（label以外が混ざっている/空欄が残る問題を除去）
const okrsSrc = Array.isArray((p as any).okrs) ? ((p as any).okrs as any[]) : [];
const okrsFixed = okrsSrc.map((o) => {
  const krRaw = ensureArray(o?.keyResults);
  const krLabels = krRaw
    .map((kr: any) => {
      if (typeof kr === 'string') return kr.trim();
      if (kr && typeof kr === 'object' && typeof kr.label === 'string') return kr.label.trim();
      return '';
    })
    .filter(Boolean)
    .map((label: string) => ({ label }));

  const changedO = krLabels.length !== krRaw.length;
  return changedO ? { ...o, keyResults: krLabels } : o;
});
if (okrsFixed.some((o, i) => o !== okrsSrc[i])) projChanged = true;

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
          return { ...(p as any), okrs: okrsFixed, okrsV2: okrsV2Fixed, okrVariants: variantsFixed };
        }
        return p;
      });

      if (deptChanged) return { ...d, projects: nextProjs };
      return d;
    });

    const finalPatched = changed || withIds !== departments ? patched : (departments as Department[]);

    // ★ 診断: 初期補修 useEffect の patchDepartments 実行確認
    if (finalPatched !== departments) {
      console.log('[diag][okr:initial-repair-useeffect-patching]', {
        changed,
        withIdsChanged: withIds !== departments,
        willPatch: true,
        timestamp: new Date().toISOString(),
      });
      patchDepartments(() => finalPatched);
    } else {
      console.log('[diag][okr:initial-repair-useeffect-no-patch]', {
        changed,
        withIdsChanged: withIds !== departments,
        willPatch: false,
        timestamp: new Date().toISOString(),
      });
    }

    // ★ 修正: 完了フラグを立てる（次回以降は実行されない）
    initialRepairCompletedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments]);

  /* ============================================================
   * プロジェクト切替時：ロール詳細パネルの表示/非表示を自動設定
   * - (selectedProj as any)?.roleDetail が存在するなら詳細を開く
   * - role === 'FUTURE' or role未設定なら強制的に閉じる
   * ========================================================== */
  useEffect(() => {
    if (!selectedProj) {
      setShowRoleDetail(false);
      return;
    }

    // FUTURE または role 未設定の場合は強制的に閉じる
    if (!(selectedProj as any).role || (selectedProj as any).role === 'FUTURE') {
      setShowRoleDetail(false);
      return;
    }

    // roleDetail が存在するなら開く、そうでなければ閉じる
    setShowRoleDetail(!!(selectedProj as any).roleDetail);
  }, [selected?.deptIdx, selected?.projIdx]);

  {/* -------- 初回自動：カスケードOKR → 構造化KR へ一括変換（committedのみ） -------- */}
  useEffect(() => {
    // ★ 修正: cascade ではなく departments を使う
    if (!Array.isArray(departments) || departments.length === 0) return;

    // ★ 修正: 初回のみ実行（deleteKr 後の KR 再注入防止）
    if (autoConvertCompletedRef.current) {
      console.log('[diag][okr:auto-convert:skip]', {
        reason: 'already-completed',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    console.log('[diag][okr:auto-convert:run]', {
      timestamp: new Date().toISOString(),
      trigger: 'first initialization',
    });

    patchDepartments((prev: any) => {
      const next = [...prev];
      let anyChanged = false;

      next.forEach((d, di) => {
        const projList = ensureArray(d.projects) as any[];
        let deptChanged = false;

        const newProjs = projList.map((p: any) => {
          const okrs = ensureArray(p.okrs as OKR[] | undefined);
          if (!okrs.length) return p;

          // ★ TASK 4: Critical - if okrsV2 already exists, NEVER rescue
          // 既存okrsV2がある場合は、旧okrs/kpisからの再注入を完全禁止
          const hasExistingOkrsV2 = Array.isArray(p.okrsV2) && p.okrsV2.length > 0;
          if (hasExistingOkrsV2) {
            console.log('[diag][okr:auto-convert:skip-rescue]', {
              projectTitle: (p as any)?.title,
              okrsV2Count: p.okrsV2.length,
              reason: 'existing-okrsv2-found-rescue-disabled',
              timestamp: new Date().toISOString(),
            });
            return p; // ★ Complete skip - no rescue at all
          }

          const existing: KRStructuredX[] = Array.isArray(p.okrsV2) ? [...(p.okrsV2 as KRStructuredX[])] : [];
          let projChanged = false;

          okrs.forEach((o) => {
            const ownerHint = o.owner;
            const krsRaw = ensureArray(o.keyResults as any[] | undefined);

krsRaw.forEach((krItem: any) => {
  let label = '';
  if (typeof krItem === 'string') {
    label = krItem.trim();
  } else if (krItem && typeof krItem === 'object') {
    const v = (krItem as any).label;
    if (typeof v === 'string') label = v.trim();
  }

  if (!label) return;

  const already = existing.some((x) => String((x as any).label ?? '').trim() === label);
  if (already) return;

  // ★ 診断: KR 再追加の検出
  console.log('[diag][okr:auto-convert:reinject]', {
    projectTitle: (p as any)?.title,
    krLabel: label,
    existingCount: existing.length,
    timestamp: new Date().toISOString(),
  });

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

    // ★ 修正: 完了フラグを立てる（次回以降は実行されない）
    autoConvertCompletedRef.current = true;
    console.log('[diag][okr:auto-convert:done]', {
      timestamp: new Date().toISOString(),
    });
  }, [departments, patchDepartments]);

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
  milestones?: Array<{ id: string; title: string; dueYm?: string; owner?: string; status?: string; dod?: string }>;
} | null>(null);

// Phase C: Milestones 追加フォーム用ローカル状態
const [mTitle, setMTitle] = useState('');
const [mDue, setMDue] = useState('');

// KPI編集UI 用のマイルストーン追加入力 state
const [editingMilestoneTitle, setEditingMilestoneTitle] = useState('');
const [editingMilestoneDueYm, setEditingMilestoneDueYm] = useState('');
const editingMilestoneTitleInputRef = useRef<HTMLInputElement>(null);

const startEditKr = (kr: any, fallbackId: string) => {
  const id = String(kr?.id ?? fallbackId);
  setEditingKrId(id);
  setEditingKrDraft({
    label: String(kr?.label ?? ''),
    target: String(kr?.target ?? ''),
    unit: (String(kr?.unit ?? '件') as Draft['unit']) ?? '件',
    due: String(kr?.due ?? ''),
    owner: String(kr?.owner ?? ''),
    milestones: kr?.milestones,
  });
};

const cancelEditKr = () => {
  setEditingKrId(null);
  setEditingKrDraft(null);
  setEditingMilestoneTitle('');
  setEditingMilestoneDueYm('');
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

    // Step 1: Update okrsV2
    const before = list[ni] ?? {};
    list[ni] = {
      ...before,
      label: nextLabel,
      target: t,
      unit: editingKrDraft.unit,
      due: editingKrDraft.due?.trim() || undefined,
      owner: editingKrDraft.owner?.trim() || undefined,
      milestones: editingKrDraft.milestones,
    };
    proj.okrsV2 = list;

    // Step 2: Sync all 3 representations (okrsV2 → okrs → kpis)
    // ★ TASK 3: Critical: Must sync BEFORE patchDepartments
    const projWithSync = syncProjectKrRepresentations(proj);

    // Step 3: Update store
    projs[pIdx] = projWithSync;
    dept.projects = projs;
    next[dIdx] = dept;
    return next;
  });

  cancelEditKr();
  queueStage4SnapshotPersist();
};

// ★ TASK 2, 3: Helper functions for KR sync
const normalizeKrLabel = (v: any) => {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object' && typeof v.label === 'string') return v.label.trim();
  return '';
};

// ★ TASK 3: Sync all 3 representations (canonical: okrsV2)
const syncProjectKrRepresentations = (project: any) => {
  const okrsV2 = Array.isArray(project.okrsV2) ? project.okrsV2 : [];
  const fallbackTitle = String(project.title ?? '改善テーマ');
  const okrs = okrsV2ToOkrs(okrsV2, fallbackTitle);
  const kpis = okrsToKpis(okrs);

  return {
    ...project,
    okrsV2,
    okrs,
    kpis,
  };
};

function removeKrEverywhere(project: any, krId?: string, krLabel?: string) {
  const labelKey = String(krLabel ?? '').trim();
  const idKey = String(krId ?? '').trim();

  // Remove from okrsV2
  const nextOkrsV2 = Array.isArray(project.okrsV2)
    ? project.okrsV2.filter((kr: any) => {
        const sameId = idKey && String(kr?.id ?? '').trim() === idKey;
        const sameLabel = labelKey && normalizeKrLabel(kr) === labelKey;
        return !(sameId || sameLabel);
      })
    : [];

  // ★ TASK 3: After removing from okrsV2, sync all 3 representations
  return syncProjectKrRepresentations({
    ...project,
    okrsV2: nextOkrsV2,
  });
}

const deleteKr = (dIdx: number, pIdx: number, krId: string) => {
  // ★ 診断: KR削除クリック確認
  console.log('KR_DELETE_CLICKED', { dIdx, pIdx, krId, timestamp: new Date().toISOString() });

  patchDepartments((prev: any) => {
    const next = [...prev];
    const dept = { ...next[dIdx] };
    const projs = ensureArray(dept.projects);
    const proj = { ...(projs[pIdx] as any) };

    const list: any[] = Array.isArray(proj.okrsV2) ? [...proj.okrsV2] : [];

    // Find KR to get its label
    const targetKr = list.find((x) => String(x?.id ?? '') === krId);
    const krLabel = targetKr ? normalizeKrLabel(targetKr) : '';

    // ★ 診断: 削除前の状態
    console.log('[diag][okr:kr-delete:before]', {
      dIdx,
      pIdx,
      krId,
      krLabel,
      projectTitle: proj.title,
      okrsV2Count: list.length,
      okrsKrCount: Array.isArray(proj.okrs)
        ? proj.okrs.reduce((n: number, o: any) => n + (Array.isArray(o.keyResults) ? o.keyResults.length : 0), 0)
        : 0,
      kpisCount: Array.isArray(proj.kpis) ? proj.kpis.length : 0,
    });

    const filtered = list.filter((x) => String(x?.id ?? '') !== krId);

    if (filtered.length === list.length) {
      // ★ KR が見つからなかった
      console.warn('[diag][okr:kr-delete:not-found]', {
        dIdx,
        pIdx,
        krId,
        availableKrIds: list.map((x: any) => x?.id),
      });
      return prev;
    }

    // ★ TASK 2: Use removeKrEverywhere to sync all 3 representations
    const projWithRemoved = removeKrEverywhere(proj, krId, krLabel);

    // ★ 診断: 削除後の状態
    console.log('[diag][okr:kr-delete:after]', {
      dIdx,
      pIdx,
      krId,
      krLabel,
      projectTitle: proj.title,
      okrsV2Count: Array.isArray(projWithRemoved.okrsV2) ? projWithRemoved.okrsV2.length : 0,
      okrsKrCount: Array.isArray(projWithRemoved.okrs)
        ? (projWithRemoved.okrs as any).reduce((n: number, o: OKR) => n + (Array.isArray(o.keyResults) ? o.keyResults.length : 0), 0)
        : 0,
      kpisCount: Array.isArray(projWithRemoved.kpis) ? projWithRemoved.kpis.length : 0,
    });

    projs[pIdx] = projWithRemoved;
    dept.projects = projs;
    next[dIdx] = dept;
    return next;
  });

  if (editingKrId === krId) cancelEditKr();
  queueStage4SnapshotPersist();

  // ★ 診断: 削除直後に selectedProj 再取得して状態確認
  setTimeout(() => {
    const store = useStrategyStore.getState();
    const depts = store.departments || [];
    const afterDept = depts[dIdx];
    const afterProjs = ensureArray(afterDept?.projects);
    const afterProj = afterProjs[pIdx];
    const afterKrList = Array.isArray(afterProj?.okrsV2) ? afterProj.okrsV2 : [];

    console.log('[diag][okr:kr-delete:state-after-delete]', {
      dIdx,
      pIdx,
      krId,
      projectTitle: afterProj?.title,
      okrsV2Count: afterKrList.length,
      okrsKrCount: Array.isArray(afterProj?.okrs)
        ? (afterProj.okrs as any).reduce((n: number, o: OKR) => n + (Array.isArray(o.keyResults) ? o.keyResults.length : 0), 0)
        : 0,
      kpisCount: Array.isArray(afterProj?.kpis) ? afterProj.kpis.length : 0,
    });
  }, 0);
};

// Helper: KPI マイルストーン状態バッジを生成
const getMilestoneStatusBadge = (milestonesCount: number) => {
  const totalRecommended = 3;

  if (milestonesCount === 0) {
    return {
      type: 'info',
      showAlert: true,
      badge: null,
      alertText: 'まず1つだけ、いつまでに何を達成するかを入れると進捗が見やすくなります。'
    };
  }

  const isComplete = milestonesCount >= totalRecommended;
  const color = isComplete ? 'green' : 'amber';
  const bgClass = color === 'green' ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200';
  const textClass = color === 'green' ? 'text-green-700' : 'text-amber-700';

  return {
    type: color,
    showAlert: false,
    badge: { bgClass, textClass, label: `マイルストーン ${milestonesCount}/${totalRecommended}（推奨）` },
    alertText: null
  };
};

// Helper: プロジェクト内の全マイルストーンを集約・期限順でソート
const aggregateMilestones = (okrsV2: any[] | undefined) => {
  if (!Array.isArray(okrsV2)) return [];

  const all: Array<{
    id: string;
    title: string;
    dueYm?: string;
    krLabel: string;
    status?: string;
  }> = [];

  okrsV2.forEach((kr: any, krIndex: number) => {
    const krLabel = String(kr?.label ?? '（未設定）');
    if (Array.isArray(kr?.milestones)) {
      kr.milestones.forEach((m: any, mIndex: number) => {
        const stableId = (typeof m?.id === 'string' && m.id) ? m.id : `ms_${krIndex}_${mIndex}`;
        all.push({
          id: stableId,
          title: String(m?.title ?? ''),
          dueYm: m?.dueYm,
          krLabel,
          status: m?.status,
        });
      });
    }
  });

  // 期限順（空は最後）
  return all.sort((a: typeof all[0], b: typeof all[0]) => {
    if (!a.dueYm && !b.dueYm) return 0;
    if (!a.dueYm) return 1;
    if (!b.dueYm) return -1;
    return (a.dueYm as string).localeCompare(b.dueYm as string);
  });
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

      // Phase C: マイルストーン
      milestones: draft.milestones,
    } as any);

    addStructuredKR(dIdx, pIdx, kr);
    queueStage4SnapshotPersist();

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
      <div className="mx-auto max-w-2xl">
        {/* ========== なぜこのプロジェクトに取り組むのか（STAGE3由来情報） ========== */}
        <div className="mb-6 rounded-2xl border border-zinc-300 bg-gradient-to-br from-blue-50 to-indigo-50 p-5">
          <h2 className="mb-2 text-[14px] font-semibold text-zinc-900">なぜこのプロジェクトに取り組むのか</h2>
          <p className="mb-4 text-[11px] text-zinc-600">STAGE3で整理した内容をもとに、この実行計画の背景を確認します。</p>

          <div className="space-y-3">
            {/* プロジェクト名・部門 */}
            <div className="flex gap-4">
              <div className="flex-1">
                <div className="text-[11px] font-semibold text-zinc-600">プロジェクト</div>
                <div className="mt-1 text-[13px] font-semibold text-zinc-900">{selectedProj.title || '—'}</div>
              </div>
              <div className="flex-1">
                <div className="text-[11px] font-semibold text-zinc-600">部門</div>
                <div className="mt-1 text-[13px] text-zinc-800">{selectedDept.name || '—'}</div>
              </div>
            </div>

            {/* なぜ取り組むか */}
            {((selectedProj as any)?.hypothesis || (selectedProj as any)?.rationale || (selectedProj as any)?.reason) && (
              <div>
                <div className="text-[11px] font-semibold text-zinc-600">なぜ取り組むか</div>
                <div className="mt-1 text-[12px] text-zinc-700 leading-relaxed">
                  {(selectedProj as any)?.hypothesis || (selectedProj as any)?.rationale || (selectedProj as any)?.reason || '—'}
                </div>
              </div>
            )}

            {/* 成果につながるポイント */}
            {((selectedProj as any)?.kind || (selectedProj as any)?.mainLever || (selectedProj as any)?.horizon) && (
              <div>
                <div className="text-[11px] font-semibold text-zinc-600">成果につながるポイント</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(selectedProj as any)?.kind && (
                    <span className="rounded-full border border-zinc-300 bg-white px-2.5 py-0.5 text-[11px] text-zinc-700">
                      {KIND_JA[(selectedProj as any).kind] || (selectedProj as any).kind}
                    </span>
                  )}
                  {(selectedProj as any)?.mainLever && (
                    <span className="rounded-full border border-zinc-300 bg-white px-2.5 py-0.5 text-[11px] text-zinc-700">
                      {LEVER_JA[(selectedProj as any).mainLever] || (selectedProj as any).mainLever}
                    </span>
                  )}
                  {(selectedProj as any)?.horizon && (
                    <span className="rounded-full border border-zinc-300 bg-white px-2.5 py-0.5 text-[11px] text-zinc-700">
                      {HORIZON_JA[(selectedProj as any).horizon] || (selectedProj as any).horizon}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* 成長KPI件数・どこに効くか */}
            <div className="flex gap-4 pt-2">
              <div className="flex-1">
                <div className="text-[11px] font-semibold text-zinc-600">成長KPI件数</div>
                <div className="mt-1 text-[13px] font-semibold text-zinc-900">
                  {Array.isArray(selectedProj.okrsV2) ? selectedProj.okrsV2.length : 0}件
                </div>
              </div>
              <div className="flex-1">
                <div className="text-[11px] font-semibold text-zinc-600">どこに効くか</div>
                <div className="mt-1 text-[12px] font-semibold text-zinc-800">
                  {(selectedProj as any)?.role === 'REVENUE' && '売上を伸ばす'}
                  {(selectedProj as any)?.role === 'COST' && 'ムダを減らす'}
                  {(selectedProj as any)?.role === 'FUTURE' && '将来の成長に備える'}
                  {!(selectedProj as any)?.role && '—'}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 grid-cols-1">
          {/* ========== Card 1: このプロジェクトで目指すこと ========== */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-[16px] font-semibold text-zinc-900">このプロジェクトで目指すこと</h2>
            <div className="mb-3 text-[12px] text-zinc-600 leading-relaxed">
              上の背景を踏まえて、このプロジェクトで実現したい状態を確認・修正してください。
            </div>

            <div className="mb-4 space-y-1">
              <label className="text-[11px] font-semibold text-zinc-700">目指す状態（必須）</label>
              <AutoResizeTextarea
                className="min-h-[72px] w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[13px] leading-5"
                minRows={2}
                maxRows={8}
                placeholder="例：既存顧客からのアップセルと新規顧客獲得を両立し、売上成長の軸を確立する"
                value={displayObjective}
                onChange={(e) => {
                  // ★ Phase 3A.5: local draft に保存（onChange では DB 更新しない）
                  setObjDraft(e.target.value);
                }}
                onBlur={async () => {
                  // onBlur で DB 更新を実行
                  if (objDraft === null || objDraft === mainOKR?.objective || !selected) {
                    // draft がない、または変更なし → DB 更新スキップ
                    setObjDraft(null);
                    if (!saveNow) return;
                    try {
                      await saveNow();
                    } catch {}
                    return;
                  }

                  setIsSavingOkr(true);
                  try {
                    // ★ Phase 3A: objective を DB 更新
                    await updateProjectOKRDb(selected.deptIdx, selected.projIdx, { objective: objDraft });
                    setObjDraft(null);  // draft をクリア
                    scheduleObjectiveSave();
                  } finally {
                    setIsSavingOkr(false);
                  }
                }}
                disabled={isHydrating || isApproved() || isSavingOkr}
              />
            </div>

            {/* ★Phase 1: Project Owner + KPI Owner + Due Date */}
            <div className="grid grid-cols-3 gap-3">
              {/* Project Owner （プロジェクト責任者） */}
              {/* ★ Phase 1: ownerName中心、ownerUserId は Phase 2 以降の user picker 連携を想定 */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-zinc-700">プロジェクト責任者</label>
                <input
                  className="h-9 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-[13px]"
                  placeholder="責任者名"
                  value={(selectedProj as any)?.ownerName ?? ''}
                  onChange={(e) => {
                    if (!selected) return;
                    const value = e.target.value;
                    patchDepartments((prev) => {
                      const next = Array.isArray(prev) ? [...prev] : [];
                      const dept = next[selected.deptIdx];
                      if (!dept) return prev;
                      const projects = Array.isArray(dept.projects) ? [...dept.projects] : [];
                      const proj = projects[selected.projIdx];
                      if (!proj) return prev;
                      projects[selected.projIdx] = { ...proj, ownerName: value };
                      next[selected.deptIdx] = { ...dept, projects };
                      return next;
                    });
                    queueStage4SnapshotPersist();
                  }}
                  disabled={isHydrating || isApproved()}
                />
              </div>
              {/* KPI Owner/OKR Owner （KPI担当） */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-zinc-700">KPI担当（任意）</label>
                <input
                  className="h-9 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-[13px]"
                  placeholder="氏名や役職など"
                  value={displayOwner}
                  onChange={(e) => {
                    // ★ Phase 3A.5: local draft に保存（onChange では DB 更新しない）
                    setOwnerDraft(e.target.value);
                  }}
                  onBlur={async () => {
                    // onBlur で DB 更新を実行
                    if (ownerDraft === null || ownerDraft === mainOKR?.owner || !selected) {
                      // draft がない、または変更なし → DB 更新スキップ
                      setOwnerDraft(null);
                      return;
                    }

                    setIsSavingOkr(true);
                    try {
                      // ★ Phase 3A: owner を DB 更新
                      await updateProjectOKRDb(selected.deptIdx, selected.projIdx, { owner: ownerDraft });
                      setOwnerDraft(null);  // draft をクリア
                    } finally {
                      setIsSavingOkr(false);
                    }
                  }}
                  disabled={isHydrating || isApproved() || isSavingOkr}
                />
              </div>
              {/* Due Date */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-zinc-700">期限（YYYY-MM）</label>
                <input
                  className="h-9 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-[13px]"
                  placeholder="2026-03"
                  value={(selectedProj as any)?.okrs?.[0]?.due ?? mainOKR?.due ?? ''}
                  onChange={(e) => {
                    // ★ Phase 3A: due は DB 正本に存在しないため snapshot 専用
                    updateProjectDue(selected.deptIdx, selected.projIdx, e.target.value);
                  }}
                  disabled={isHydrating || isApproved()}
                />
              </div>
            </div>

            {/* AI生成ボタン */}
            <div className="mt-6 border-t border-zinc-200 pt-4">
              {generationError && (
                <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[12px] text-red-700">
                  {generationError}
                </div>
              )}
              {generationSuccess && (
                <div className="mb-3 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-[12px] text-green-700">
                  AIがたたき台を作成しました。内容を確認して、必要に応じて反映してください。
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  if (selected) {
                    void generateExecutionDraft(selected.deptIdx, selected.projIdx);
                  }
                }}
                disabled={isHydrating || isApproved() || isGenerating}
                className="w-full rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-[12px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
              >
                {isGenerating ? '生成中...' : '✨ AIで実行計画のたたき台を作る'}
              </button>

              {/* AI生成結果プレビューパネル */}
              {generatedDraft && (
                <div className="mt-4 rounded-lg bg-indigo-50 border border-indigo-200 p-4">
                  <h3 className="text-[13px] font-semibold text-indigo-900 mb-3">📋 AIが作成したたたき台</h3>

                  {/* 目指す状態 */}
                  <div className="mb-3 text-[12px]">
                    <span className="font-medium text-indigo-800">目指す状態：</span>
                    <p className="text-indigo-700 mt-1">{generatedDraft.objective || '—'}</p>
                    {!mainOKR?.objective && (
                      <p className="text-[11px] text-indigo-600 mt-1 italic">💡 既存の目的がないため、このAI案を反映できます。</p>
                    )}
                  </div>

                  {/* 役割 */}
                  {generatedDraft.role && (
                    <div className="mb-3 text-[12px]">
                      <span className="font-medium text-indigo-800">役割：</span>
                      <p className="text-indigo-700 mt-1">{generatedDraft.role}</p>
                    </div>
                  )}

                  {/* 期待する成果 */}
                  {generatedDraft.impact && (
                    <div className="mb-3 text-[12px]">
                      <span className="font-medium text-indigo-800">期待する成果：</span>
                      <div className="text-indigo-700 mt-1 ml-2 text-[11px]">
                        {generatedDraft.impact.revenueMJPY !== null && (
                          <p>• 売上増分: {generatedDraft.impact.revenueMJPY}百万円</p>
                        )}
                        {generatedDraft.impact.opIncomeMJPY !== null && (
                          <p>• 営業利益増分: {generatedDraft.impact.opIncomeMJPY}百万円</p>
                        )}
                        {generatedDraft.impact.investmentMJPY !== null && (
                          <p>• 必要投資: {generatedDraft.impact.investmentMJPY}百万円</p>
                        )}
                        {generatedDraft.impact.rationale && (
                          <p className="mt-1 italic">根拠: {generatedDraft.impact.rationale}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* KPI案 */}
                  {Array.isArray(generatedDraft.kpis) && generatedDraft.kpis.length > 0 && (
                    <div className="mb-3 text-[12px]">
                      <span className="font-medium text-indigo-800">KPI案：</span>
                      <div className="text-indigo-700 mt-1 ml-2 text-[11px] space-y-2">
                        {generatedDraft.kpis.map((kpi: any, idx: number) => (
                          <div key={idx} className="border-l-2 border-indigo-300 pl-2">
                            <p className="font-medium">{stripProjectPrefix(kpi.label)}</p>
                            <p>目標: {kpi.target}{kpi.unit} (期限: {formatDeadlineLabel(kpi.due)})</p>
                            {kpi.owner && <p>担当: {kpi.owner}</p>}
                            {Array.isArray(kpi.milestones) && kpi.milestones.length > 0 && (
                              <p className="text-indigo-600">途中の目安: {kpi.milestones.map((m: any) => `${m.title}(${formatDeadlineLabel(m.dueYm)})`).join(' → ')}</p>
                            )}
                          </div>
                        ))}
                      </div>
                      {(selectedProj as any)?.okrsV2 && Array.isArray((selectedProj as any).okrsV2) && (selectedProj as any).okrsV2.length > 0 && (
                        <p className="text-[11px] text-indigo-600 mt-2 italic">💡 既存KPIがあるため、AIのKPI案は候補として表示しています。</p>
                      )}
                    </div>
                  )}

                  {/* 実行ステップ */}
                  {Array.isArray(generatedDraft.steps) && generatedDraft.steps.length > 0 && (
                    <div className="mb-3 text-[12px]">
                      <span className="font-medium text-indigo-800">実行ステップ：</span>
                      <div className="text-indigo-700 mt-1 ml-2 text-[11px]">
                        {generatedDraft.steps.map((step: any, idx: number) => (
                          <p key={idx}>Step {idx + 1}: {stripProjectPrefix(step.title)} ({formatDeadlineLabel(step.dueYm)})</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 反映ボタン */}
                  <button
                    type="button"
                    onClick={() => {
                      if (selected && generatedDraft) {
                        void applyGeneratedDraft(selected.deptIdx, selected.projIdx, generatedDraft, generatedDraft?.sourceKpis);
                      }
                    }}
                    className="mt-3 w-full rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700"
                  >
                    このAI案を反映する
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ========== Card 2: 成長につながる変化 ========== */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-[16px] font-semibold text-zinc-900">このプロジェクトによる最終成果</h2>
            {(() => {
              const hypothesis =
                typeof (selectedProj as any)?.hypothesis === 'string'
                  ? (selectedProj as any).hypothesis.trim()
                  : '';
              const kind = (selectedProj as any)?.kind as string | undefined;
              const mainLever = (selectedProj as any)?.mainLever as string | undefined;
              const horizon = (selectedProj as any)?.horizon as string | undefined;

              const kindLabel = kind ? (KIND_JA[kind] ?? kind) : '';
              const leverLabel = mainLever ? (LEVER_JA[mainLever] ?? mainLever) : '';
              const horizonLabel = horizon ? (HORIZON_JA[horizon] ?? horizon) : '';

              return (
                <div className="mb-4 rounded-md border bg-slate-50 p-3">
                  <div className="text-xs font-semibold text-slate-600">この取り組みで変えるポイント</div>
                  <div className="mt-1 text-[11px] text-slate-500">例：既存顧客への提案内容を変える／重点顧客を絞る／作業のムダを減らす／新しい市場への接点を作る</div>

                  <div className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">
                    <span className="font-medium">仮説：</span>{hypothesis || '—'}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-700">成長のポイント：</span>

                    {kindLabel && (
                      <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700">
                        {kindLabel}
                      </span>
                    )}
                    {leverLabel && (
                      <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700">
                        {leverLabel}
                      </span>
                    )}
                    {horizonLabel && (
                      <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700">
                        {horizonLabel}
                      </span>
                    )}

                    {!kindLabel && !leverLabel && !horizonLabel && (
                      <span className="text-xs text-slate-500">—</span>
                    )}
                  </div>
                </div>
              );
            })()}
            {/* ★STAGE4拡張：ロール（財務レバー） - 現場向けに言い換え */}
            <div className="mb-4 space-y-2">
              <label className="text-[11px] font-semibold text-zinc-700">どこに効く取り組みか</label>

              {/* ロール3択 */}
              <div className="flex gap-2">
                {[
                  { value: 'REVENUE' as const, label: '売上を伸ばす' },
                  { value: 'COST' as const, label: 'ムダを減らす' },
                  { value: 'FUTURE' as const, label: '将来の成長に備える' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      if (!selected) return;
                      updateProjectRole(selected.deptIdx, selected.projIdx, (selectedProj as any)?.role === opt.value ? '' : opt.value);
                      setShowRoleDetail(false);
                      queueStage4SnapshotPersist('stage4_role_change');
                    }}
                    disabled={isHydrating || isApproved()}
                    className={`flex-1 rounded-lg border-2 px-3 py-2 text-[12px] font-semibold transition-colors ${
                      (selectedProj as any)?.role === opt.value
                        ? 'border-zinc-900 bg-zinc-900 text-white shadow-sm'
                        : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* 詳細設定トグル＆サブカテゴリ（roleがREVENUEまたはCOSTの時のみ） */}
              {selectedProj?.role && (selectedProj as any).role !== 'FUTURE' && (
                <div className="mt-3 space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowRoleDetail(!showRoleDetail)}
                    className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-700"
                  >
                    {showRoleDetail ? '▼ 詳細設定' : '▶ 詳細設定'}
                  </button>

                  {showRoleDetail && (
                    <div>
                      <label className="text-[11px] font-semibold text-zinc-700">
                        {(selectedProj as any).role === 'REVENUE' ? '売上' : 'コスト'}の詳細（任意）
                      </label>
                      <select
                        value={(selectedProj as any)?.roleDetail ?? ''}
                        onChange={(e) => {
                          if (!selected) return;
                          updateProjectRoleDetail(selected.deptIdx, selected.projIdx, e.target.value as Project['roleDetail'] | '');
                          queueStage4SnapshotPersist('stage4_role_detail_change');
                        }}
                        disabled={isHydrating || isApproved()}
                        className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                      >
                        <option value="">未選択</option>
                        {(selectedProj as any).role === 'REVENUE' && (
                          <>
                            <option value="ACQ">新規獲得</option>
                            <option value="CHURN">継続率改善</option>
                            <option value="ARPU">単価改善</option>
                          </>
                        )}
                        {(selectedProj as any).role === 'COST' && (
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

            {/* ★ 期待する成果（金額ゴール統合）- 前提入力 + 自動計算 */}
            {(selectedProj as any)?.role && (
              <div className="mt-4 border-t border-zinc-200 pt-4">
                <h3 className="mb-2 text-[13px] font-semibold text-zinc-800">
                  成果見込みと計算根拠<span className="text-[11px] font-normal text-zinc-500">（AIが置いた目安・修正可）</span>
                </h3>
                <div className="mb-3 text-[11px] text-zinc-600">
                  AIが置いた成果見込みです。前提条件を修正すると、見込み数値も変わります。
                </div>

                <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold text-blue-900">AIが置いた前提（修正できます）</div>
                    <div className="text-[10px] text-blue-700">単位：百万円</div>
                  </div>

                  <div className="mb-3 grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => updateImpactAssumptionsAndSave(getImpactPreset(selectedImpactRole, 'small'))}
                      disabled={isHydrating || isApproved()}
                      className="rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-blue-900 hover:bg-blue-50 disabled:opacity-50"
                    >
                      小さめ
                    </button>
                    <button
                      type="button"
                      onClick={() => updateImpactAssumptionsAndSave(getImpactPreset(selectedImpactRole, 'standard'))}
                      disabled={isHydrating || isApproved()}
                      className="rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-blue-900 hover:bg-blue-50 disabled:opacity-50"
                    >
                      標準
                    </button>
                    <button
                      type="button"
                      onClick={() => updateImpactAssumptionsAndSave(getImpactPreset(selectedImpactRole, 'large'))}
                      disabled={isHydrating || isApproved()}
                      className="rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-blue-900 hover:bg-blue-50 disabled:opacity-50"
                    >
                      大きめ
                    </button>
                  </div>

                  {(selectedProj as any).role === 'REVENUE' && (
                    <div className="grid grid-cols-3 gap-2">
                      <label className="space-y-1">
                        <span className="text-[11px] font-semibold text-zinc-700">対象顧客数（社）</span>
                        <input
                          type="number"
                          step="1"
                          className="h-9 w-full rounded-lg border border-blue-100 bg-white px-2 text-[13px]"
                          value={selectedImpactAssumptions.targetCustomers ?? ''}
                          onChange={(e) => updateImpactAssumptionsAndSave({ targetCustomers: toFiniteNumber(e.target.value) })}
                          disabled={isHydrating || isApproved()}
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] font-semibold text-zinc-700">想定受注率（%）</span>
                        <input
                          type="number"
                          step="1"
                          className="h-9 w-full rounded-lg border border-blue-100 bg-white px-2 text-[13px]"
                          value={selectedImpactAssumptions.conversionRatePct ?? ''}
                          onChange={(e) => updateImpactAssumptionsAndSave({ conversionRatePct: toFiniteNumber(e.target.value) })}
                          disabled={isHydrating || isApproved()}
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] font-semibold text-zinc-700">平均単価</span>
                        <input
                          type="number"
                          step="1"
                          className="h-9 w-full rounded-lg border border-blue-100 bg-white px-2 text-[13px]"
                          value={selectedImpactAssumptions.averageDealMJPY ?? ''}
                          onChange={(e) => updateImpactAssumptionsAndSave({ averageDealMJPY: toFiniteNumber(e.target.value) })}
                          disabled={isHydrating || isApproved()}
                        />
                      </label>
                    </div>
                  )}

                  {(selectedProj as any).role === 'COST' && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <span className="text-[11px] font-semibold text-zinc-700">現在コスト</span>
                        <input
                          type="number"
                          step="1"
                          className="h-9 w-full rounded-lg border border-blue-100 bg-white px-2 text-[13px]"
                          value={selectedImpactAssumptions.currentCostMJPY ?? ''}
                          onChange={(e) => updateImpactAssumptionsAndSave({ currentCostMJPY: toFiniteNumber(e.target.value) })}
                          disabled={isHydrating || isApproved()}
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] font-semibold text-zinc-700">削減率（%）</span>
                        <input
                          type="number"
                          step="1"
                          className="h-9 w-full rounded-lg border border-blue-100 bg-white px-2 text-[13px]"
                          value={selectedImpactAssumptions.reductionRatePct ?? ''}
                          onChange={(e) => updateImpactAssumptionsAndSave({ reductionRatePct: toFiniteNumber(e.target.value) })}
                          disabled={isHydrating || isApproved()}
                        />
                      </label>
                    </div>
                  )}

                  {(selectedProj as any).role === 'FUTURE' && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <span className="text-[11px] font-semibold text-zinc-700">投入人数（人）</span>
                        <input
                          type="number"
                          step="1"
                          className="h-9 w-full rounded-lg border border-blue-100 bg-white px-2 text-[13px]"
                          value={selectedImpactAssumptions.peopleCount ?? ''}
                          onChange={(e) => updateImpactAssumptionsAndSave({ peopleCount: toFiniteNumber(e.target.value) })}
                          disabled={isHydrating || isApproved()}
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] font-semibold text-zinc-700">実施月数（月）</span>
                        <input
                          type="number"
                          step="1"
                          className="h-9 w-full rounded-lg border border-blue-100 bg-white px-2 text-[13px]"
                          value={selectedImpactAssumptions.durationMonths ?? ''}
                          onChange={(e) => updateImpactAssumptionsAndSave({ durationMonths: toFiniteNumber(e.target.value) })}
                          disabled={isHydrating || isApproved()}
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] font-semibold text-zinc-700">1人あたり月額</span>
                        <input
                          type="number"
                          step="0.1"
                          className="h-9 w-full rounded-lg border border-blue-100 bg-white px-2 text-[13px]"
                          value={selectedImpactAssumptions.monthlyCostPerPersonMJPY ?? ''}
                          onChange={(e) => updateImpactAssumptionsAndSave({ monthlyCostPerPersonMJPY: toFiniteNumber(e.target.value) })}
                          disabled={isHydrating || isApproved()}
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] font-semibold text-zinc-700">外部費用</span>
                        <input
                          type="number"
                          step="1"
                          className="h-9 w-full rounded-lg border border-blue-100 bg-white px-2 text-[13px]"
                          value={selectedImpactAssumptions.externalCostMJPY ?? ''}
                          onChange={(e) => updateImpactAssumptionsAndSave({ externalCostMJPY: toFiniteNumber(e.target.value) })}
                          disabled={isHydrating || isApproved()}
                        />
                      </label>
                    </div>
                  )}
                </div>

                <div className="mb-3 rounded-lg border border-zinc-200 bg-white p-3">
                  <div className="text-[11px] font-semibold text-zinc-500">自動計算された見込み</div>
                  <div className="mt-1 flex items-end justify-between gap-3">
                    <div className="text-[13px] font-semibold text-zinc-800">{selectedImpactCalculation?.resultLabel ?? '見込み効果'}</div>
                    <div className="text-[20px] font-bold text-zinc-950">
                      {selectedImpactCalculation?.resultValue ?? 0}
                      <span className="ml-1 text-[11px] font-semibold text-zinc-500">百万円</span>
                    </div>
                  </div>
                  <div className="mt-2 rounded-md bg-zinc-50 px-2 py-1.5 text-[11px] text-zinc-600">
                    計算式：{selectedImpactCalculation?.formula ?? '前提を入力すると自動計算されます'}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowDirectImpactInput((v) => !v)}
                  className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-700"
                >
                  {showDirectImpactInput ? '▼ 金額を直接修正する' : '▶ 金額を直接修正する'}
                </button>

                {showDirectImpactInput && (
                  <div className="mt-2 space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                    {(selectedProj as any).role === 'REVENUE' && (
                      <div className="space-y-1">
                        <div className="text-[11px] font-semibold text-zinc-700">売上への見込み効果（百万円）</div>
                        <input
                          type="number"
                          step="1"
                          className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                          placeholder="例：300"
                          value={selectedProj.impactRevenueMJPY ?? ''}
                          onChange={(e) => {
                            if (!selected) return;
                            const raw = e.target.value;
                            updateProjectImpactAndSave(selected.deptIdx, selected.projIdx, {
                              impactRevenueMJPY: raw === '' ? undefined : Number(raw),
                            });
                          }}
                          disabled={isHydrating || isApproved()}
                        />
                      </div>
                    )}

                    {(selectedProj as any).role === 'COST' && (
                      <div className="space-y-1">
                        <div className="text-[11px] font-semibold text-zinc-700">利益への見込み効果（百万円）</div>
                        <input
                          type="number"
                          step="1"
                          className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                          placeholder="例：50"
                          value={selectedProj.impactOpIncomeMJPY ?? ''}
                          onChange={(e) => {
                            if (!selected) return;
                            const raw = e.target.value;
                            updateProjectImpactAndSave(selected.deptIdx, selected.projIdx, {
                              impactOpIncomeMJPY: raw === '' ? undefined : Number(raw),
                            });
                          }}
                          disabled={isHydrating || isApproved()}
                        />
                      </div>
                    )}

                    {(selectedProj as any).role === 'FUTURE' && (
                      <div className="space-y-1">
                        <div className="text-[11px] font-semibold text-zinc-700">必要な投資（百万円）</div>
                        <input
                          type="number"
                          step="1"
                          className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                          placeholder="例：30"
                          value={selectedProj.impactInvestmentMJPY ?? ''}
                          onChange={(e) => {
                            if (!selected) return;
                            const raw = e.target.value;
                            updateProjectImpactAndSave(selected.deptIdx, selected.projIdx, {
                              impactInvestmentMJPY: raw === '' ? undefined : Number(raw),
                            });
                          }}
                          disabled={isHydrating || isApproved()}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ========== Card 3: 成長KPI ========== */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-[16px] font-semibold text-zinc-900">成長KPI</h2>
            <div className="mb-3 text-[12px] text-zinc-600 leading-relaxed">
              この取り組みで成長に向けて動かすKPIを定義してください。既存の管理KPIではなく、新しい行動や市場の拡大につながる指標を追加してください。
            </div>

            {/* Add Button */}
            <div className="mb-4">
              <button
                onClick={() => setOpenAdd((m: any) => ({ ...m, [selectedAddKey]: !selectedIsOpen }))}
                disabled={isHydrating || !canEditKr}
                className="w-full h-9 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px] font-semibold text-zinc-800 hover:bg-zinc-50 disabled:bg-zinc-200 disabled:text-zinc-500"
              >
                <span className="inline-flex items-center gap-1">
                  <Plus className="h-4 w-4" /> 成長KPI を追加
                </span>
              </button>
            </div>

            {/* KPI Add Form */}
            {selectedIsOpen && (
              <div className="mb-4 rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4">
                <div className="mb-3 text-[12px] font-semibold text-zinc-800">成長KPIを追加</div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-semibold text-zinc-700">何を増やす・減らす・良くする？</label>
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
                      <label className="text-[11px] font-semibold text-zinc-700">どこまで変える？</label>
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
                      <label className="text-[11px] font-semibold text-zinc-700">いつまでに？</label>
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
                      <label className="text-[11px] font-semibold text-zinc-700">誰が見る？</label>
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

                  {/* Phase C: Milestones セクション */}
                  <div className={`border-t border-amber-200 pt-3 ${editingMode === 'variant' ? 'opacity-50' : ''}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[11px] font-semibold text-zinc-700">
                        途中の目安（任意）
                        {editingMode === 'variant' && <span className="ml-1 text-[10px] text-zinc-500">確定版でのみ編集可</span>}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const templates = [
                            { id: cryptoRandomId(), title: '要件定義', dueYm: undefined },
                            { id: cryptoRandomId(), title: 'PoC', dueYm: undefined },
                            { id: cryptoRandomId(), title: '本番展開', dueYm: undefined },
                          ];
                          const next = [...(selectedDraft.milestones ?? []), ...templates];
                          setDraft(selectedAddKey, { milestones: next });
                        }}
                        disabled={isHydrating || editingMode === 'variant'}
                        className="h-7 rounded-lg border border-zinc-200 bg-white px-2.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        テンプレ追加
                      </button>
                    </div>
                    {selectedDraft.milestones && selectedDraft.milestones.length > 0 ? (
                      <div className="space-y-1 mb-2">
                        {selectedDraft.milestones.map((m) => (
                          <div key={m.id} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-2">
                            <div className="flex-1 text-[12px]">
                              <div className="font-semibold text-zinc-800">{m.title}</div>
                              {m.dueYm && <div className="text-zinc-600 text-[11px]">{formatDeadlineLabel(m.dueYm)}</div>}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const next = (selectedDraft.milestones ?? []).filter((x) => x.id !== m.id);
                                setDraft(selectedAddKey, { milestones: next.length > 0 ? next : undefined });
                              }}
                              disabled={isHydrating || editingMode === 'variant'}
                              className="h-7 text-[11px] px-2 rounded border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              削除
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="何を達成する？"
                        className="h-8 flex-1 rounded-lg border border-zinc-200 bg-white px-2 text-[12px]"
                        value={mTitle}
                        onChange={(e) => setMTitle(e.target.value)}
                        disabled={isHydrating || editingMode === 'variant'}
                      />
                      <input
                        type="text"
                        placeholder="いつまでに？"
                        className="h-8 w-24 rounded-lg border border-zinc-200 bg-white px-2 text-[12px]"
                        value={mDue}
                        onChange={(e) => setMDue(e.target.value)}
                        disabled={isHydrating || editingMode === 'variant'}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const title = mTitle.trim();
                          if (!title) {
                            console.warn('マイルストーンのタイトルを入力してください');
                            return;
                          }
                          const newMilestone = {
                            id: crypto.randomUUID(),
                            title,
                            dueYm: mDue.trim() || undefined,
                          };
                          const next = [...(selectedDraft.milestones ?? []), newMilestone];
                          setDraft(selectedAddKey, { milestones: next });
                          setMTitle('');
                          setMDue('');
                        }}
                        disabled={isHydrating || editingMode === 'variant'}
                        className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-[12px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                      >
                        追加
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => addStructuredKRFromDraft(selected.deptIdx, selected.projIdx)}
                      disabled={isHydrating}
                      className="h-9 flex-1 rounded-xl bg-zinc-900 px-3 text-[12px] font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
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
              {renderKrList.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-3 text-center">
                  <p className="text-[12px] text-zinc-600">KPIがまだありません</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {renderKrList.map((kr, idx) => {
  // ★ 修正: key を index から kr.id に（削除後の入れ替わり防止）
  const rowId = String((kr as any)?.id ?? `kr-${idx}`);
  const jsxKey =
    (kr as any)?.id ||
    (kr as any)?.sourceKpiId ||
    `right-${selected.deptIdx}-${selected.projIdx}-${idx}`;
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
    <div key={jsxKey} className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      {isEditing && editingKrDraft ? (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2">
            <div>
              <div className="text-[11px] font-semibold text-zinc-700 mb-1">何を増やす・減らす・良くする？</div>
              <input
                value={editingKrDraft.label}
                onChange={(e) => setEditingKrDraft({ ...editingKrDraft, label: e.target.value })}
                className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[11px] font-semibold text-zinc-700 mb-1">どこまで変える？</div>
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
                <div className="text-[11px] font-semibold text-zinc-700 mb-1">いつまでに？</div>
                <input
                  value={editingKrDraft.due}
                  onChange={(e) => setEditingKrDraft({ ...editingKrDraft, due: e.target.value })}
                  className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                  placeholder="2026-04"
                />
              </div>
              <div>
                <div className="text-[11px] font-semibold text-zinc-700 mb-1">誰が見る？</div>
                <input
                  value={editingKrDraft.owner}
                  onChange={(e) => setEditingKrDraft({ ...editingKrDraft, owner: e.target.value })}
                  className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                />
              </div>
            </div>

            {/* Phase B-1: Milestones セクション */}
            <div className={`border-t border-zinc-200 pt-3 ${editingMode === 'variant' ? 'opacity-50' : ''}`}>
              <div className="text-[11px] font-semibold text-zinc-700 mb-2">
                途中の目安
                {editingMode === 'variant' && <span className="ml-1 text-[10px] text-zinc-500">（確定版でのみ編集可）</span>}
              </div>
              {editingKrDraft.milestones && editingKrDraft.milestones.length > 0 ? (
                <div className="space-y-2 text-[12px] mb-3">
                  {editingKrDraft.milestones.map((m, idx) => (
                    <div key={m.id || idx} className="rounded border border-zinc-200 bg-white p-2">
                      <div className="font-semibold text-zinc-800">{m.title || '（未設定）'}</div>
                      <div className="mt-1 grid grid-cols-2 gap-2 text-zinc-600">
                        <div>{m.dueYm ? `期限: ${formatDeadlineLabel(m.dueYm)}` : '期限: -'}</div>
                        <div>{m.owner ? `担当: ${m.owner}` : '担当: -'}</div>
                      </div>
                      <div className="mt-1 flex gap-1">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          m.status === 'done' ? 'bg-green-100 text-green-700'
                          : m.status === 'doing' ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-zinc-100 text-zinc-600'
                        }`}>
                          {m.status === 'done' ? '完了' : m.status === 'doing' ? '進行中' : 'TODO'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-zinc-500 mb-3">マイルストーンがありません</div>
              )}

              {/* 新規マイルストーン追加欄 */}
              <div className="bg-zinc-50 rounded border border-zinc-200 p-2">
                <div className="text-[11px] font-semibold text-zinc-700 mb-2">まず1つ、いつまでに何を達成するかを入れます</div>
                <div className="flex gap-2">
                  <input
                    ref={editingMilestoneTitleInputRef}
                    type="text"
                    placeholder="例）要件定義 / PoC / 本番展開"
                    className="flex-1 h-8 rounded border border-zinc-200 bg-white px-2 text-[12px]"
                    value={editingMilestoneTitle}
                    onChange={(e) => setEditingMilestoneTitle(e.target.value)}
                    disabled={isHydrating || editingMode === 'variant'}
                  />
                  <input
                    type="text"
                    placeholder="YYYY-MM"
                    className="w-24 h-8 rounded border border-zinc-200 bg-white px-2 text-[12px]"
                    value={editingMilestoneDueYm}
                    onChange={(e) => setEditingMilestoneDueYm(e.target.value)}
                    disabled={isHydrating || editingMode === 'variant'}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const title = editingMilestoneTitle.trim();
                      if (!title) {
                        console.warn('マイルストーンのタイトルを入力してください');
                        return;
                      }
                      const newMilestone = {
                        id: cryptoRandomId(),
                        title,
                        dueYm: editingMilestoneDueYm.trim() || undefined,
                        status: 'todo',
                      };
                      setEditingKrDraft((prev) => ({
                        ...prev!,
                        milestones: [...(prev?.milestones ?? []), newMilestone],
                      }));
                      setEditingMilestoneTitle('');
                      setEditingMilestoneDueYm('');
                    }}
                    disabled={isHydrating || editingMode === 'variant'}
                    className="h-8 px-2 rounded bg-zinc-200 text-zinc-700 text-[12px] font-semibold hover:bg-zinc-300 disabled:opacity-50"
                  >
                    追加
                  </button>
                </div>
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

          {/* マイルストーン件数バッジ */}
          {(() => {
            const milestonesCount = Array.isArray((kr as any)?.milestones) ? (kr as any).milestones.length : 0;
            const badgeInfo = getMilestoneStatusBadge(milestonesCount);

            return (
              <div className="mt-3">
                {badgeInfo.showAlert ? (
                  <div className={`mb-3 rounded-xl border border-amber-200 bg-amber-50 p-2.5`}>
                    <div className="text-[11px] font-medium text-amber-700">
                      💡 {badgeInfo.alertText}
                    </div>
                  </div>
                ) : (
                  <div className={`inline-flex rounded-full border px-2 py-1 mb-3 ${badgeInfo.badge?.bgClass}`}>
                    <span className={`text-[11px] font-medium ${badgeInfo.badge?.textClass}`}>
                      {badgeInfo.badge?.label}
                    </span>
                  </div>
                )}

                {/* マイルストーン一覧＋追加導線 */}
                {(() => {
                  const ms = Array.isArray((kr as any)?.milestones) ? (kr as any).milestones : [];

                  if (ms.length === 0) {
                    return (
                      <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-2.5">
                        <span className="text-[11px] text-zinc-600">マイルストーン未設定</span>
                        <button
                          type="button"
                          onClick={() => {
                            startEditKr(kr as any, rowId);
                            setTimeout(() => editingMilestoneTitleInputRef.current?.focus(), 0);
                          }}
                          disabled={isHydrating || editingMode === 'variant'}
                          className="whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          マイルストーンを追加
                        </button>
                      </div>
                    );
                  }

                  const displayMs = ms.slice(0, 3);
                  const moreCount = ms.length - 3;

                  return (
                    <div className="space-y-1">
                      {displayMs.map((m: any, mIdx: number) => (
                        <div key={mIdx} className="flex items-center gap-2 text-[11px] text-zinc-700">
                          <span>•</span>
                          <span className="flex-1 truncate">{m?.title || '（未設定）'}</span>
                          {m?.dueYm && <span className="text-zinc-500">({formatDeadlineLabel(m.dueYm)})</span>}
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${
                            m?.status === 'done'
                              ? 'bg-green-100 text-green-700'
                              : m?.status === 'doing'
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-zinc-100 text-zinc-600'
                          }`}>
                            {m?.status === 'done' ? '完了' : m?.status === 'doing' ? '進行中' : 'TODO'}
                          </span>
                        </div>
                      ))}
                      {moreCount > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            startEditKr(kr as any, rowId);
                            setTimeout(() => editingMilestoneTitleInputRef.current?.focus(), 0);
                          }}
                          className="text-[11px] text-blue-600 hover:text-blue-700 font-medium"
                        >
                          あと {moreCount} 件を表示...
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
})}
                </div>
              )}
            </div>

            {/* Admin/Manager Details - Hidden in SIMPLE_FORM */}
            {false && capabilities.canEditStrategy && renderKrList.length > 0 && (
              <details className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-3">
                <summary className="cursor-pointer text-[11px] font-semibold text-zinc-700 hover:text-zinc-900">
                  詳細情報（admin/manager のみ）
                </summary>
                <div className="mt-3 space-y-2 text-[11px] text-zinc-600">
                  {renderKrList.map((kr, idx) => {
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

          {/* ========== Card 3.5: 実行ステップ ========== */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-[16px] font-semibold text-zinc-900">実行ステップ</h2>
            <div className="mb-3 text-[12px] text-zinc-600 leading-relaxed">
              成長へシフトするために、最初の30日で起こす行動変化を記入してください。1件だけでも構いません。
            </div>

            {(() => {
              const msList = aggregateMilestones(renderKrList);

              if (msList.length === 0) {
                return (
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                    <div className="text-[12px] text-zinc-600 leading-relaxed">
                      ステップが未設定です。KPIのマイルストーンを1件追加すると、実行ステップが表示されます。
                    </div>
                  </div>
                );
              }

              return (
                <div className="space-y-2">
                  {msList.map((ms) => (
                    <div key={ms.id} className="rounded-lg border border-zinc-200 bg-white p-3">
                      <div className="grid grid-cols-4 gap-2 text-[12px]">
                        <div className="col-span-1">
                          <div className="text-zinc-500 text-[11px]">期限</div>
                          <div className="font-semibold text-zinc-800">{ms.dueYm || '—'}</div>
                        </div>
                        <div className="col-span-1">
                          <div className="text-zinc-500 text-[11px]">タイトル</div>
                          <div className="text-zinc-800 truncate">{ms.title || '（未設定）'}</div>
                        </div>
                        <div className="col-span-1">
                          <div className="text-zinc-500 text-[11px]">KPI名</div>
                          <div className="text-zinc-700 text-[11px] truncate">{ms.krLabel}</div>
                        </div>
                        <div className="col-span-1">
                          <div className="text-zinc-500 text-[11px]">ステータス</div>
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            ms.status === 'done'
                              ? 'bg-green-100 text-green-700'
                              : ms.status === 'doing'
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-zinc-100 text-zinc-600'
                          }`}>
                            {ms.status === 'done' ? '完了' : ms.status === 'doing' ? '進行中' : 'TODO'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* ========== 詳細設定アコーディオン ========== */}
          <details className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <summary className="cursor-pointer select-none p-5 text-[16px] font-semibold text-zinc-900 hover:bg-zinc-50">
              ▶ 成長を実現する条件（任意）
            </summary>

            {/* ========== Card 4: 投資（金額 or 人数） ========== */}
            <div className="border-t border-zinc-200 px-5 py-4">
              <h3 className="mb-3 text-[14px] font-semibold text-zinc-800">投資（金額 or 人数）</h3>
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
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2 text-[12px] font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                >
                  + 投資（金額 or 人数）を追加
                </button>
              )}

              {/* Investment Add Form - showInvestmentForm 時のみ表示 */}
              {showInvestmentForm && (
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4">
                  <div className="mb-3 text-[12px] font-semibold text-zinc-800">投資を追加</div>
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
                        queueStage4SnapshotPersist();
                      }}
                      disabled={isHydrating}
                      className="h-9 flex-1 rounded-xl bg-zinc-900 px-3 text-[12px] font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
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
                queueStage4SnapshotPersist();
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
                    queueStage4SnapshotPersist();
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
                    queueStage4SnapshotPersist();
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
                    queueStage4SnapshotPersist();
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
                    queueStage4SnapshotPersist();
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
            </div>

            {/* ========== Card 5: 必要スキル（任意） ========== */}
            <div className="border-t border-zinc-200 px-5 py-4">
              <h3 className="mb-3 text-[14px] font-semibold text-zinc-800">必要スキル（任意）</h3>
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
        className="w-full rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2 text-[12px] font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
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
                  {method ? `方法：${method}` : '方法：—'} / {dueYm ? `期限：${formatDeadlineLabel(dueYm)}` : '期限：—'}
                  {priority ? ` / 優先度：${priority}` : ''}
                  {Number.isFinite(cost) ? ` / コスト：¥${Number(cost).toLocaleString()}` : ''}
                </div>
              </div>

              {!isApproved() && (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-700"
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
                      queueStage4SnapshotPersist();
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
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 text-[12px] text-zinc-600">
          必須ではありません。必要なスキルがある場合だけ追加してください。
        </div>
      )}
    </div>

    {/* Add/Edit form（showSkillForm 時のみ表示） */}
    {!isApproved() && showSkillForm && (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4">
        <div className="mb-3 text-[12px] font-semibold text-zinc-800">
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
              className="rounded-xl bg-zinc-900 px-4 py-2 text-[12px] font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
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

                queueStage4SnapshotPersist();

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
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-[12px] font-semibold text-zinc-700 hover:bg-zinc-50"
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
          </details>

          {/* ========== Card 6: 金額ゴール（North Star寄与） - Card 2 に統合したため非表示 ========== */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm hidden">
            <h2 className="mb-3 text-[16px] font-semibold text-zinc-900">金額ゴール（North Star寄与）</h2>
            {/* ★STAGE4拡張：財務ゴール（North Star寄与・百万円） */}
            {(selectedProj as any)?.role && (
              <div className="mb-4 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-zinc-700">金額ゴール（North Star寄与）</label>
                  <span className="rounded-full bg-zinc-100 px-2 py-1 text-[10px] font-semibold text-zinc-600">
                    期限：{northStarDueYear ?? '未設定'}
                  </span>
                </div>

                {(selectedProj as any).role === 'REVENUE' && (
                  <div className="grid grid-cols-[1fr_120px] gap-2">
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-zinc-700">売上寄与（百万円）</div>
                      <input
                        type="number"
                        step="1"
                        className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                        placeholder="例：3000"
                        value={selectedProj.impactRevenueMJPY ?? ''}
                        onChange={(e) => {
                          if (!selected) return;
                          const raw = e.target.value;
                          updateProjectImpactAndSave(selected.deptIdx, selected.projIdx, {
                            impactRevenueMJPY: raw === '' ? undefined : Number(raw),
                          });
                        }}
                        disabled={isHydrating || isApproved()}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-zinc-700">確度（%）</div>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        max="100"
                        className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                        placeholder="例：70"
                        value={
                          typeof selectedProj.impactConfidence === 'number'
                            ? Math.round(selectedProj.impactConfidence * 100)
                            : ''
                        }
                        onChange={(e) => {
                          if (!selected) return;
                          const raw = e.target.value;
                          const v = raw === '' ? undefined : Math.max(0, Math.min(100, Number(raw)));
                          updateProjectImpactAndSave(selected.deptIdx, selected.projIdx, {
                            impactConfidence: typeof v === 'number' ? v / 100 : undefined,
                          });
                        }}
                        disabled={isHydrating || isApproved()}
                      />
                    </div>
                  </div>
                )}

                {(selectedProj as any).role === 'COST' && (
                  <div className="grid grid-cols-[1fr_120px] gap-2">
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-zinc-700">営業利益寄与（百万円）</div>
                      <input
                        type="number"
                        step="1"
                        className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                        placeholder="例：500（コスト削減なら＋）"
                        value={selectedProj.impactOpIncomeMJPY ?? ''}
                        onChange={(e) => {
                          if (!selected) return;
                          const raw = e.target.value;
                          updateProjectImpactAndSave(selected.deptIdx, selected.projIdx, {
                            impactOpIncomeMJPY: raw === '' ? undefined : Number(raw),
                          });
                        }}
                        disabled={isHydrating || isApproved()}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-zinc-700">確度（%）</div>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        max="100"
                        className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                        placeholder="例：70"
                        value={
                          typeof selectedProj.impactConfidence === 'number'
                            ? Math.round(selectedProj.impactConfidence * 100)
                            : ''
                        }
                        onChange={(e) => {
                          if (!selected) return;
                          const raw = e.target.value;
                          const v = raw === '' ? undefined : Math.max(0, Math.min(100, Number(raw)));
                          updateProjectImpactAndSave(selected.deptIdx, selected.projIdx, {
                            impactConfidence: typeof v === 'number' ? v / 100 : undefined,
                          });
                        }}
                        disabled={isHydrating || isApproved()}
                      />
                    </div>
                  </div>
                )}

                {(selectedProj as any).role === 'FUTURE' && (
                  <div className="grid grid-cols-[1fr_120px] gap-2">
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-zinc-700">投資（百万円）</div>
                      <input
                        type="number"
                        step="1"
                        className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                        placeholder="例：2000"
                        value={selectedProj.impactInvestmentMJPY ?? ''}
                        onChange={(e) => {
                          if (!selected) return;
                          const raw = e.target.value;
                          updateProjectImpactAndSave(selected.deptIdx, selected.projIdx, {
                            impactInvestmentMJPY: raw === '' ? undefined : Number(raw),
                          });
                        }}
                        disabled={isHydrating || isApproved()}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-zinc-700">確度（%）</div>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        max="100"
                        className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                        placeholder="例：50"
                        value={
                          typeof selectedProj.impactConfidence === 'number'
                            ? Math.round(selectedProj.impactConfidence * 100)
                            : ''
                        }
                        onChange={(e) => {
                          if (!selected) return;
                          const raw = e.target.value;
                          const v = raw === '' ? undefined : Math.max(0, Math.min(100, Number(raw)));
                          updateProjectImpactAndSave(selected.deptIdx, selected.projIdx, {
                            impactConfidence: typeof v === 'number' ? v / 100 : undefined,
                          });
                        }}
                        disabled={isHydrating || isApproved()}
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1 hidden">
                  <div className="text-[11px] font-semibold text-zinc-700">根拠メモ（任意）</div>
                  <input
                    type="text"
                    className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
                    placeholder="例：単価×数量の見直し、工数削減、人員再配置など"
                    value={selectedProj.impactRationale ?? ''}
                    onChange={(e) => {
                      if (!selected) return;
                      updateProjectImpactAndSave(selected.deptIdx, selected.projIdx, { impactRationale: e.target.value });
                    }}
                    disabled={isHydrating || isApproved()}
                  />
                </div>

                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-700">
                  入力した金額ゴールは、STAGE6の「North Star vs 予測」「プロジェクト寄与」に<strong>手動寄与（固定）</strong>として反映されます。
                </div>
              </div>
            )}
          </div>

          {/* ========== Card 7: プロジェクト共通マイルストーン（任意） ========== */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm hidden">
            <h2 className="mb-3 text-[16px] font-semibold text-zinc-900">プロジェクト共通マイルストーン（任意）</h2>
{/* Milestones */}
<div className="mb-4 space-y-2">
  <div className="flex items-center justify-between">
    <label className="text-[11px] font-semibold text-zinc-700">プロジェクト共通マイルストーン（任意・0〜2推奨）</label>
    <div className="text-[11px] text-zinc-500">{(((selectedProj as any).planMilestones || []) as any[]).length}件</div>
  </div>
  <div className="text-[10px] text-zinc-500 italic">主要なマイルストーンはKPI内で設定してください</div>

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
                  className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-700"
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

    {((((selectedProj as any).planMilestones || []) as any[]) as any[]).length >= 3 && (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 text-[12px] text-zinc-600">
        推奨は0〜2件です。必要に応じて調整してください。
      </div>
    )}

    {((((selectedProj as any).planMilestones || []) as any[]) as any[]).length === 0 && (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 text-[12px] text-zinc-600">
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
          className="rounded-xl bg-zinc-900 px-4 py-2 text-[12px] font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
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
          </div>
        </div>
      </div>
    );
  };

  /* ===== 反映候補セクションのハンドラー ===== */
  const handleDeleteOKRCandidate = (candidateId: string) => {
    setNotice('✅ 反映候補を削除しました');
  };

  /* ============================================================
   * renderLegacy: 旧UI（タブシステム・詳細フォーム）
   * ========================================================== */
  const renderLegacy = () => {
    const canEditDept = capabilities.canEditStrategy;

  return (
  <main className="min-h-screen bg-zinc-50">
    <div className="mx-auto max-w-6xl px-4 md:px-6 py-6 space-y-6">
      <ReflectionCandidatesSection
        onDelete={handleDeleteOKRCandidate}
      />

      {notice && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
          {notice}
        </div>
      )}

      {/* header */}
      <OKRHeader isHydrating={isHydrating} exportToPdf={stage4ExportToPdf} />

      {/* STAGE4 作業エリア：中央寄せ＆幅最適化 */}
      <div className="mx-auto max-w-6xl">
        <div data-debug="okr-scrollwrap" className="overflow-x-auto overscroll-x-contain touch-pan-x pb-2">
          <div className="min-w-0">
            <div className="grid gap-4 grid-cols-[280px_1fr]">
              {/* Left: project list */}
              <aside className="w-[280px] rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <ProjectListHeader departments={departments} />

            <div className="space-y-4">
              {(Array.isArray(departments) ? departments : []).map((dept, di) => {
                const projs = ensureArray(dept.projects);
                return (
                  <div key={deptRenderKey(dept, di)} className="rounded-2xl bg-zinc-50 p-3">
                    <div className="flex items-center justify-between">
                      <DepartmentListItem
                        deptName={dept.name || `部門${di + 1}`}
                        projectCount={projs.length}
                      />

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
                            key={projRenderKey(p, di, pi)}
                            type="button"
                            onClick={() => {
                              if (saveNow) void saveNow();
                              setSelected({ deptIdx: di, projIdx: pi });
                            }}
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
                  <ProjectSelectionPrompt />
                ) : (
                  renderSimpleRight()
                )}
              </section>
            </div>
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

export default function OKRPage() {
  return (
    <StrategyGuard mode="view" showReadOnlyBanner={false}>
      <OKRPageContent />
    </StrategyGuard>
  );
}
