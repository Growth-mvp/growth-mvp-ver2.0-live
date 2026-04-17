'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { YearlyPL } from '@/utils/financeSimulation';
import type { BridgeKR } from '@/utils/simulationBridge';
import type { KRStructured, Department } from '@/types/strategy';
import type {
  ProjectContribution,
  ApprovedProject,
  NorthStarRow,
  IssueResolution,
} from '@/utils/stage6';

import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import { useAccess } from '@/utils/access';
import { hardResetForCompanySwitch } from '@/utils/resetAll';
import { loadAndHydrate } from '@/utils/loader';
import { loadProgressLogs } from '@/utils/supabase/strategy';
import { parseMetadata } from '@/utils/execution/metadata';

import {
  buildProjectContributions,
  buildNorthStarRows,
  buildIssueResolutions,
  buildValueAnalysisCards,
  mkBaseFigures,
  mkBaselineTrajectory,
  getEvidenceFromProject,
  getExecutionWeight,
  buildNorthStarRowsPhaseE,
  buildIssueResolutionsPhaseE,
  normalizeValueToUnit,
  matchProgressLogToProject,
  normalizeProjectName,
} from '@/utils/stage6';
import { calcYearlyFromKrs, buildStage6FourMetricCards } from '@/utils/stage6/compute';
import {
  inferAutoProjectTargetImpacts,
  mergeImpacts,
  inferAutoProjectIssueLinks,
  mergeLinks,
} from '@/utils/stage6/autoLinking';

const DEBUG = process.env.NODE_ENV === 'development' && !!process.env.NEXT_PUBLIC_DEBUG_STAGE6;

// ★ getSnapshot warning 対策：空参照を定数化（毎回新規生成を防止）
const EMPTY_OBJ: Readonly<Record<string, never>> = Object.freeze({});
const EMPTY_ARR: ReadonlyArray<never> = Object.freeze([]);

/**
 * useStage6Data
 * Consolidates all data fetching, initialization, and memoization for STAGE6
 * Returns computed data ready for rendering
 */
export function useStage6Data(scenarioKey: 'low' | 'base' | 'high') {
  // ===== Store selectors =====
  const companyName = useStrategyStore((s: StrategyState) => s.companyName ?? '会社名未設定');
  const departments = useStrategyStore((s: StrategyState) =>
    Array.isArray(s.departments) ? s.departments : (EMPTY_ARR as any),
  ) as Department[];
  const financePL = useStrategyStore((s: StrategyState) => (Array.isArray(s.financePL) ? s.financePL : (EMPTY_ARR as any)));
  const csvFinanceData = useStrategyStore((s: StrategyState) => s.csvFinanceData ?? (EMPTY_OBJ as any));
  const revision = useStrategyStore((s: StrategyState) => s.revision);
  const boot = useStrategyStore((s: StrategyState) => s.boot);
  const companyTargets = useStrategyStore((s: StrategyState) => (Array.isArray(s.companyTargets) ? s.companyTargets : (EMPTY_ARR as any)));
  const stage1Issues = useStrategyStore((s: StrategyState) => (Array.isArray(s.stage1Issues) ? s.stage1Issues : (EMPTY_ARR as any)));
  const valueAnalysis = useStrategyStore((s: StrategyState) => s.valueAnalysis);

  // === STAGE6 Phase E：プロジェクト→North Star / 論点リンク ===
  const projectTargetImpacts = useStrategyStore((s: StrategyState) =>
    Array.isArray(s.projectTargetImpacts) ? s.projectTargetImpacts : (EMPTY_ARR as any)
  );
  const projectIssueLinks = useStrategyStore((s: StrategyState) =>
    Array.isArray(s.projectIssueLinks) ? s.projectIssueLinks : (EMPTY_ARR as any)
  );

  const { companyId: scopeCompanyId, hydrated, setCompanyScope, refetchFromServer, setHydrated } =
    useStrategyStore();

  // ===== Access & Company scope =====
  const access = useAccess();
  const accessCompanyId: string | undefined = useMemo(
    () =>
      ((access as any)?.companyId ?? (scopeCompanyId as string | undefined)) as
        | string
        | undefined,
    [(access as any)?.companyId, scopeCompanyId],
  );

  const lastAppliedCompanyRef = useRef<string | null>(null);
  const progressLogsRef = useRef<any[]>([]); // Cache for mutable access
  const [progressLogs, setProgressLogs] = useState<any[]>([]); // State for re-renders

  useEffect(() => {
    if (!accessCompanyId) return;
    if (
      lastAppliedCompanyRef.current === accessCompanyId &&
      scopeCompanyId === accessCompanyId
    )
      return;

    if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
      setHydrated?.(false);
      hardResetForCompanySwitch(accessCompanyId);
      setCompanyScope(accessCompanyId);
    } else if (!scopeCompanyId) {
      setCompanyScope(accessCompanyId);
    }
    lastAppliedCompanyRef.current = accessCompanyId;
  }, [accessCompanyId, scopeCompanyId, setCompanyScope, setHydrated]);

  // ===== Initial load =====
  const loadGuardRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accessCompanyId) return;
    if (!scopeCompanyId) setCompanyScope(accessCompanyId);
    if (loadGuardRef.current === accessCompanyId && hydrated && scopeCompanyId === accessCompanyId)
      return;

    let cancelled = false;
    const run = async () => {
      if (hydrated && scopeCompanyId === accessCompanyId) {
        loadGuardRef.current = accessCompanyId;
        return;
      }

      const timer = setTimeout(() => {
        if (!cancelled) {
          console.warn('[STAGE6] 7秒タイムアウト：hydrated=true を強制設定');
          setHydrated?.(true);
        }
      }, 7000);

      try {
        const storeBefore = useStrategyStore.getState();
        if (DEBUG)
          console.log('[STAGE6] 📥 loadAndHydrate 前', {
            accessCompanyId,
            loadGuardRef_current: loadGuardRef.current,
            hydrated,
          });

        await loadAndHydrate(accessCompanyId);

        const storeAfter = useStrategyStore.getState();
        if (DEBUG)
          console.log('[STAGE6] ✅ loadAndHydrate 後', {
            hydrated: storeAfter.hydrated,
          });

        try {
          await refetchFromServer?.();
        } catch {
          // ignore
        }
        setHydrated?.(true);
        loadGuardRef.current = accessCompanyId;
      } catch (err) {
        const errObj = err as any;
        console.error('[STAGE6] ❌ loadAndHydrate error', {
          message: errObj?.message || String(err),
        });
        console.warn('[STAGE6] hydrated=true を強制設定');
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
  }, [accessCompanyId, hydrated, scopeCompanyId, refetchFromServer, setHydrated, setCompanyScope]);

  // ===== Load progress logs for execution weight =====
  // Use both ref (cache) and state (re-render trigger)
  useEffect(() => {
    if (!accessCompanyId) return;

    const loadLogs = async () => {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await loadProgressLogs(accessCompanyId, {
        limit: 1000,
        fromDate: ninetyDaysAgo,
      });

      if (data) {
        progressLogsRef.current = data; // Cache
        setProgressLogs(data); // Trigger re-render and executionWeight recalc
        if (DEBUG) {
          console.log('[STAGE6] ✅ Loaded', data.length, 'progress logs');
        }
      }
    };

    loadLogs().catch((e) => {
      console.warn('[STAGE6] ⚠️ Failed to load progress logs:', e);
    });
  }, [accessCompanyId]);

  // ===== Ready gate =====
  const mismatch = !!(accessCompanyId && scopeCompanyId && scopeCompanyId !== accessCompanyId);
  const isHydrating = ((Boolean((boot as any)?.isHydrating) && !hydrated) || mismatch || !hydrated) ?? false;

  const isReady = useMemo(() => {
    const financeLen = Array.isArray(financePL) ? financePL.length : 0;
    const deptLen = Array.isArray(departments) ? departments.length : 0;
    return hydrated && !isHydrating && financeLen > 0 && deptLen > 0;
  }, [hydrated, isHydrating, financePL, departments]);

  // ===== Helper function =====
  const makeProjectKey = (dept: string, proj: string, idx: number) => `${dept}::${proj}::${idx}`;

  // ===== Normalize helpers =====
  const normalizeKind = (s: unknown): BridgeKR['kind'] | null => {
    if (typeof s !== 'string') return null;
    const kinds: BridgeKR['kind'][] = ['ACQ', 'ARPU', 'CHURN', 'SUCCESS_RATE', 'INVEST', 'SYNERGY', 'REVENUE', 'COST_FIXED', 'COST_VARIABLE', 'PERSONNEL', 'ACTIVITY'];
    return kinds.includes(s as BridgeKR['kind']) ? (s as BridgeKR['kind']) : null;
  };

  const normalizeUnit = (s: unknown): string | undefined => {
    if (typeof s !== 'string') return undefined;
    if (s === '¥' || s === '円') return 'JPY';
    if (s === '％') return '%';
    if (s.toLowerCase() === 'percent') return 'percent';
    return s;
  };

  // ===== Core data extraction =====
  const core = useMemo(() => {
    if (!hydrated || isHydrating) {
      return {
        ready: false,
        companyName: '会社名未設定',
        error: 'データ読込中...',
        deptNames: [] as string[],
        approved: [] as ApprovedProject[],
        projectKrsMap: new Map<string, BridgeKR[]>(),
        baselineYearly: [] as YearlyPL[],
        yearlyAll: { low: [], base: [], high: [] } as Record<'low' | 'base' | 'high', YearlyPL[]>,
        // ★ executionWeightsMap は常に Map（undefined ではない）
        executionWeightsMap: new Map<string, { weight: number }>(),
      };
    }

    const depts = departments ?? [];
    const approved: ApprovedProject[] = [];
    const projectKrsMap = new Map<string, BridgeKR[]>();
    const deptNameSet = new Set<string>();

    depts.forEach((d: any) => {
      const deptName = d?.name ?? d?.departmentName ?? '（未名）';
      deptNameSet.add(deptName);

      const projects = Array.isArray(d?.projects) ? d.projects : [];
      projects.forEach((p: any, pIndex: number) => {
        const projTitle = p?.title ?? '（未名）';
        const projKey = makeProjectKey(deptName, projTitle, pIndex);

        const krs: BridgeKR[] = [];
        const okrsV2 = Array.isArray(p?.okrsV2) ? p.okrsV2 : [];

        okrsV2.forEach((kr: KRStructured, krIndex: number) => {
          if (!kr) return;

          const kind = normalizeKind((kr as any).kind);
          if (!kind) return;

          const unit = normalizeUnit((kr as any).unit);

          const base: BridgeKR = {
            id: (kr as any).id ?? `kr-${projKey}-${krIndex}`,
            kind,
            label: (kr as any).label ?? '（ラベル未設定）',
            target: (kr as any).target ?? 0,
            scope: (kr as any).scope ?? 'company',
            baseKey: (kr as any).baseKey ?? 'revenue',
            baseOverride: (kr as any).baseOverride,
            weight: (kr as any).weight,
            elasticity: (kr as any).elasticity,
            lagMonths: (kr as any).lagMonths,
            startYm: (kr as any).startYm as any,
            due: (kr as any).due,
            notes: (kr as any).notes,
            ...(unit ? { unit } : {}),
          };

          krs.push(base);
        });

        const skillPlans = Array.isArray(p?.skillPlans) ? p.skillPlans : [];
        const investments = Array.isArray(p?.executionHumanInvestments) ? p.executionHumanInvestments : [];

        const investTotal =
          skillPlans.reduce((s: number, sk: any) => s + (sk?.cost ?? 0), 0) +
          investments.reduce((s: number, inv: any) => s + (inv?.amount ?? 0), 0);

        if (investTotal > 0) {
          krs.push({
            id: `invest-${projKey}`,
            kind: 'INVEST',
            label: `${projTitle}: 投資計画`,
            target: investTotal,
            unit: 'JPY',
            scope: 'project',
            baseKey: 'invest',
          });
        }

        projectKrsMap.set(projKey, krs);

        approved.push({
          key: projKey,
          dept: deptName,
          proj: projTitle,
          krCount: krs.length,
          investTotal,
          impactRevenueProgress: typeof p?.impactRevenueProgress === 'number' ? p.impactRevenueProgress : null,
          impactOpIncomeProgress: typeof p?.impactOpIncomeProgress === 'number' ? p.impactOpIncomeProgress : null,
        });
      });
    });

    const baseTraj = mkBaselineTrajectory({ financePL } as any);
    const baseFigures = mkBaseFigures({ financePL } as any);

    // ★ TASK-2: baseFigures が null（financePLなし）の場合は baseline系列を使わない
    if (!baseTraj || !baseFigures) {
      if (DEBUG) {
        console.warn('[STAGE6] [TASK-2] baseline skipped (baseTraj or baseFigures is null)', {
          baseTraj_ok: !!baseTraj,
          baseFigures_ok: !!baseFigures,
          financePL_len: Array.isArray(financePL) ? financePL.length : 0,
        });
      }
    }

    const scenarios = {
      low: { successRate: 0.5, synergyRate: -0.05 },
      base: { successRate: 0.8, synergyRate: 0.0 },
      high: { successRate: 1.0, synergyRate: 0.1 },
    };

    // Baseline is with no KRs (empty array)
    const baselineYearly = baseTraj && baseFigures
      ? calcYearlyFromKrs({ baseTraj, baseFigures, krs: [], scenario: scenarios.base })
      : ([] as YearlyPL[]);

    // ★ Baseline営業利益を mkBaseFigures.operatingIncome で固定（全年度を2024実績でフラット延長）
    const baselineOpIncomeYen =
      typeof baseFigures?.operatingIncome === 'number'
        ? baseFigures.operatingIncome
        : undefined;

    const baselineYearlyFixed = baselineOpIncomeYen !== undefined && baselineYearly.length > 0
      ? baselineYearly.map((row) => ({
          ...row,
          // ★ Baseline営業利益は全年度を2024実績で固定（フラット延長）
          op_income: baselineOpIncomeYen,
        }))
      : baselineYearly;

    // ★ 確定ログ
    if (DEBUG && baselineOpIncomeYen !== undefined) {
      console.log('[stage6][baseline-opIncome] used=%s source=%s',
        baselineOpIncomeYen,
        'baseFigures.operatingIncome'
      );
    }

    // ★ 適用確認ログ（全年度置換）
    if (DEBUG && baselineOpIncomeYen !== undefined && baselineYearlyFixed.length > 0) {
      console.log('[stage6][baseline-opIncome] applied_all_years firstYear=%s op_income=%s',
        baselineYearlyFixed[0].year,
        baselineYearlyFixed[0].op_income
      );
    }

    // === TASK1: progress_logs の実メタデータを詳細出力 ===
    if (progressLogs && progressLogs.length > 0) {
      console.group('[TASK1] Progress logs metadata inspection');
      console.log('Total progress_logs:', progressLogs.length);

      const logsWithMeta = progressLogs.map((log: any) => {
        const { metadata } = parseMetadata(log.content ?? '');
        return {
          id: log.id,
          score: log.score,
          status: log.status,
          metadata,
        };
      });

      logsWithMeta.forEach((log: any) => {
        console.log({
          logId: log.id,
          score: log.score,
          status: log.status,
          'meta.projectKey': log.metadata?.projectKey,
          'meta.projectId': log.metadata?.projectId,
          'meta.deptId': log.metadata?.deptId,
          'meta.okrId': log.metadata?.okrId,
        });
      });

      console.groupEnd();
    }

    // === TASK2: STAGE6 side approved projects と comparison ===
    if (approved && approved.length > 0) {
      console.group('[TASK2] STAGE6 approved projects and key matching');
      console.log('Total approved projects:', approved.length);

      approved.forEach((p: any) => {
        const key = p.key; // Format: deptName::projTitle::index
        const projectTitle = p.proj; // This is the title string

        // Count matching logs using common function
        const matchCount = progressLogs ? progressLogs.filter((log: any) => {
          const { metadata } = parseMetadata(log.content ?? '');
          if (!metadata) return false;

          const result = matchProgressLogToProject({
            log,
            metadata,
            projectTitle,
            projectKey: key,
          });
          return result.matched;
        }).length : 0;

        console.log({
          'p.key (STAGE6 format)': key,
          'p.dept': p.dept,
          'p.proj (title)': projectTitle,
          'normalized proj': normalizeProjectName(projectTitle),
          matchingLogCount: matchCount,
        });
      });

      console.groupEnd();
    }

    // === executionWeights Map を先に計算（TDZ 回避のため allKrs 前に定義）
    // ★ 常に Map を返す（undefined にしない）
    const executionWeightsMap = new Map<string, { weight: number }>();

    if (progressLogs && approved && approved.length > 0) {
      // ★ ログ：executionWeights 計算開始
      console.group('[A] STAGE6 executionWeights calculation');
      console.log('progressLogs count:', progressLogs.length);
      console.log('approved projects:', approved.length);

      approved.forEach((p: any) => {
        const weight = getExecutionWeight(p.proj, progressLogs, {
          projectKey: p.key,
          impactRevenueProgress: p.impactRevenueProgress,
          impactOpIncomeProgress: p.impactOpIncomeProgress,
        });
        executionWeightsMap.set(p.key, weight);

        console.log('  Project:', {
          key: p.key,
          projTitle: p.proj,
          projId: p.proj?.id,
          impactRevenueProgress: p.impactRevenueProgress,
          impactOpIncomeProgress: p.impactOpIncomeProgress,
          calculatedWeight: weight.weight,
          notes: weight.notes,
        });
      });

      console.log('executionWeightsMap.size:', executionWeightsMap.size);
      console.log('executionWeightsMap.keys:', Array.from(executionWeightsMap.keys()));
      console.groupEnd();
    }

    // プロジェクトキーを付与した allKrs を生成
    const allKrs: BridgeKR[] = [];
    projectKrsMap.forEach((krs, projectKey) => {
      allKrs.push(
        ...krs.map((kr) => ({
          ...kr,
          projectKey, // executionWeight 参照用
        }))
      );
    });

    // ★ ログ：allKrs の projectKey と kind を確認
    console.group('[A] allKrs with projectKey');
    console.log('Total KRs:', allKrs.length);
    allKrs.forEach((kr) => {
      const weight = executionWeightsMap.has(kr.projectKey!) ? executionWeightsMap.get(kr.projectKey!)?.weight : undefined;
      console.log({
        projectKey: kr.projectKey,
        label: kr.label,
        kind: kr.kind,
        target: kr.target,
        hasWeight: executionWeightsMap.has(kr.projectKey!),
        weight,
      });
    });
    console.groupEnd();

    const yearlyAll = {
      low: baseTraj && baseFigures ? calcYearlyFromKrs({ baseTraj, baseFigures, krs: allKrs, scenario: scenarios.low, executionWeights: executionWeightsMap }) : [],
      base: baseTraj && baseFigures ? calcYearlyFromKrs({ baseTraj, baseFigures, krs: allKrs, scenario: scenarios.base, executionWeights: executionWeightsMap }) : [],
      high: baseTraj && baseFigures ? calcYearlyFromKrs({ baseTraj, baseFigures, krs: allKrs, scenario: scenarios.high, executionWeights: executionWeightsMap }) : [],
    };

    return {
      ready: isReady,
      companyName,
      error: isReady ? undefined : 'データ準備中...',
      deptNames: Array.from(deptNameSet).sort(),
      approved,
      projectKrsMap,
      baselineYearly: baselineYearlyFixed,
      yearlyAll,
      executionWeightsMap, // STAGE5 進捗率から計算した weight マップ
    };
  }, [hydrated, isHydrating, departments, financePL, revision, isReady, companyName, makeProjectKey, normalizeKind, normalizeUnit, progressLogs]);

  // ===== Project keys and effective selected keys =====
  const allProjectKeys = useMemo(() => Array.from(core.projectKrsMap.keys()), [core.projectKrsMap]);

  // ★ FIX-FINAL: projectContrib の raw_simulation は廃止
  // 代わりに projectContribForUI で formal fields only を直接計算

  // === STAGE6 Phase E：AUTO推定（projectTargetImpacts） ===
  const autoProjectTargetImpacts = useMemo(() => {
    if (!isReady || allProjectKeys.length === 0 || companyTargets.length === 0) {
      return [] as any;
    }

    // ★入力ログ（ゼロ件特定用）
    if (DEBUG) {
      const krsEntries = Array.from(core.projectKrsMap.entries()).slice(0, 3).map(([k, v]) => ({
        key: k,
        krsLen: v?.length ?? 0,
        sample: v?.[0] ? { kind: v[0].kind, label: v[0].label } : undefined,
      }));
      console.log('[STAGE6-AUTO-TARGET] 入力チェック:', {
        scenarioKey,
        companyTargets_len: companyTargets.length,
        projectKeys_len: allProjectKeys.length,
        projectKeys_sample: allProjectKeys.slice(0, 3),
        projectKrsMap_size: core.projectKrsMap.size,
        executionWeightsMap_size: core.executionWeightsMap.size,
        projectKrsMap_samples: krsEntries,
      });
    }

    const auto = inferAutoProjectTargetImpacts({
      companyTargets,
      projectKeys: allProjectKeys,
      projectKrsMap: core.projectKrsMap,
      executionWeightsMap: core.executionWeightsMap,
      scenarioKey,
    });

    if (DEBUG) {
      console.log(`[STAGE6] AUTO targetImpacts: ${auto.length}件生成`);
    }

    return auto;
  }, [isReady, allProjectKeys, companyTargets, core.projectKrsMap, core.executionWeightsMap, scenarioKey]);

  // === STAGE6 Phase E：effectiveProjectTargetImpacts（manual + auto マージ） ===
  const effectiveProjectTargetImpacts = useMemo(() => {
    const manual = Array.isArray(projectTargetImpacts) ? projectTargetImpacts : [];
    const auto = autoProjectTargetImpacts;

    const effective = mergeImpacts({ manual, auto });

    if (DEBUG) {
      console.log(`[STAGE6] effectiveProjectTargetImpacts: manual=${manual.length}, auto=${auto.length}, merged=${effective.length}`);
    }

    return effective;
  }, [projectTargetImpacts, autoProjectTargetImpacts]);


  // === STAGE6 統一基準修正 FIX-FINAL：参照元ルール完全統一 + Op Fallback ===
  // ★修正方針：
  // 1. formal fields only（impactRevenueMJPY × impactRevenueProgress）
  // 2. op 未設定時は baselineMargin で推定（暫定対応）
  // 3. 同一プロジェクト内で revenue/op の source が異なる場合は警告
  // 4. 上段（northStarRows）と下段（projectContribForUI）の参照元を完全に統一
  const projectContribForUI = useMemo(() => {
    // Project データを dept::proj::idx キーで検索可能な map を構築
    const projectMap = new Map<string, any>();
    if (Array.isArray(departments)) {
      departments.forEach((dept: any) => {
        const deptName = dept?.name ?? '（未名）';
        const projects = Array.isArray(dept.projects) ? dept.projects : [];
        projects.forEach((proj: any, idx: number) => {
          const key = `${deptName}::${proj.title}::${idx}`;
          projectMap.set(key, proj);
        });
      });
    }

    // ★ baselineMargin を先に計算（op 推定に使用）
    // baselineMargin = company baseline op / company baseline revenue
    const baselineYearlyFinal = core.baselineYearly?.[core.baselineYearly.length - 1];
    const companyBaselineRevenueMJPY = (baselineYearlyFinal?.revenue ?? 0) / 1_000_000;
    const companyBaselineOpMJPY = (baselineYearlyFinal?.op_income ?? 0) / 1_000_000;
    const baselineMargin = companyBaselineRevenueMJPY > 0
      ? companyBaselineOpMJPY / companyBaselineRevenueMJPY
      : 0;

    // core.approved から各プロジェクトを反復
    // ★重要: buildProjectContributions の結果（raw_simulation）を使わない
    const result = core.approved.map((p: any) => {
      const projectData = projectMap.get(p.key);

      // ★ formal fields のみを参照
      const impactRevenueMJPY = projectData?.impactRevenueMJPY;
      const impactRevenueProgress = projectData?.impactRevenueProgress;
      const impactOpIncomeMJPY = projectData?.impactOpIncomeMJPY;
      const impactOpIncomeProgress = projectData?.impactOpIncomeProgress;

      // ★ STAGE4で入力した目標額（単なる表示用。寄与額とは別）
      const targetRevenueMJPY =
        typeof impactRevenueMJPY === 'number' && Number.isFinite(impactRevenueMJPY)
          ? impactRevenueMJPY
          : undefined;
      const targetOpIncomeMJPY =
        typeof impactOpIncomeMJPY === 'number' && Number.isFinite(impactOpIncomeMJPY)
          ? impactOpIncomeMJPY
          : undefined;

      // ★ formal fields の有無を判定
      const hasRevenueFields = typeof impactRevenueMJPY === 'number' && typeof impactRevenueProgress === 'number';
      const hasOpFields = typeof impactOpIncomeMJPY === 'number' && typeof impactOpIncomeProgress === 'number';

      // ★ Revenue の effective delta
      const deltaRevenueTotal = hasRevenueFields ? (impactRevenueMJPY * impactRevenueProgress) / 100 : 0;

      // ★ Op の effective delta - formal field or baselineMargin 推定
      let deltaOpTotal = 0;
      let opSourceUsed = 'unset';

      if (hasOpFields) {
        // ケース 1: op formal field あり
        deltaOpTotal = (impactOpIncomeMJPY * impactOpIncomeProgress) / 100;
        opSourceUsed = 'stage5_progress';
      } else if (hasRevenueFields && deltaRevenueTotal > 0 && baselineMargin > 0) {
        // ケース 2: op formal field なし、revenue あり → baselineMargin で推定
        deltaOpTotal = deltaRevenueTotal * baselineMargin;
        opSourceUsed = 'estimated_from_margin';

        // ★ ログ：[STAGE6][op-fallback]
        if (DEBUG) {
          console.log('[STAGE6][op-fallback]', {
            projectTitle: p.proj,
            effectiveRevenueDelta: deltaRevenueTotal,
            impactOpIncomeMJPY,
            impactOpIncomeProgress,
            companyBaselineRevenueMJPY,
            companyBaselineOpMJPY,
            baselineMargin: baselineMargin.toFixed(4),
            effectiveOpDelta: deltaOpTotal,
            sourceUsed: opSourceUsed,
            '説明': `op未設定 → revenue ${deltaRevenueTotal}M × margin ${(baselineMargin * 100).toFixed(1)}% = ${deltaOpTotal.toFixed(1)}M`,
          });
        }
      }

      // ★ FIX-FINAL: source mixing 検出
      const isMixedSource = hasRevenueFields !== hasOpFields && opSourceUsed !== 'estimated_from_margin';

      // Source の統一確認
      const revenueSourceUsed = hasRevenueFields ? 'stage5_progress' : 'unset';

      // 投資額（buildProjectContributions から引き継ぎ）
      const investTotal = p.investTotal ?? 0;
      const roi = investTotal > 0 ? deltaOpTotal / investTotal : undefined;

      // ★ ログ：[STAGE6][project-source-final]
      if (DEBUG) {
        console.log('[STAGE6][project-source-final]', {
          projectTitle: p.proj,
          hasImpactRevenue: hasRevenueFields,
          hasImpactOp: hasOpFields,
          revenueSourceUsed,
          opSourceUsed,
          displayRevenue: deltaRevenueTotal,
          displayOp: deltaOpTotal,
          isMixedSource,
          '警告': isMixedSource ? `⚠️ source mixing detected: revenue=${revenueSourceUsed}, op=${opSourceUsed}` : '✓ 統一',
        });
      }

      // ★ 根拠情報
      const evidence = {
        source: hasRevenueFields ? 'stage5_progress' : 'unset',
        confidence: hasRevenueFields ? 'high' : 'none',
        notes: hasRevenueFields
          ? `STAGE5実行度: ${impactRevenueProgress?.toFixed(0) ?? '?'}%` + (opSourceUsed === 'estimated_from_margin' ? ' (op は margin推定)' : '')
          : 'Formal field未設定',
      };

      return {
        key: p.key,
        dept: p.dept,
        proj: p.proj,
        deptId: projectData?.departmentId ?? projectData?.deptId ?? undefined,
        projectId: projectData?.id ?? projectData?.projectId ?? undefined,
        investTotal,
        krCount: p.krCount,
        // ★ STAGE4入力の目標額
        targetRevenueMJPY,
        targetOpIncomeMJPY,
        // ★ STAGE6計算の寄与額
        deltaRevenueTotal,  // MJPY単位
        deltaOpTotal,        // MJPY単位（formal or margin推定）
        roi,
        evidence,
        executionWeight: core.executionWeightsMap?.get(p.key),
      };
    });

    return result;
  }, [core.approved, core.executionWeightsMap, departments, core.baselineYearly]);
  // === STAGE6 Phase E：AUTO推定（projectIssueLinks） ===
  const autoProjectIssueLinks = useMemo(() => {
    if (!isReady || allProjectKeys.length === 0 || stage1Issues.length === 0) {
      return [] as any;
    }

    // ★入力ログ（ゼロ件特定用）
    if (DEBUG) {
      const krsEntries = Array.from(core.projectKrsMap.entries()).slice(0, 3).map(([k, v]) => ({
        key: k,
        krsLen: v?.length ?? 0,
        sample: v?.[0] ? { kind: v[0].kind, label: v[0].label } : undefined,
      }));
      console.log('[STAGE6-AUTO-ISSUE] 入力チェック:', {
        stage1Issues_len: stage1Issues.length,
        stage1Issues_sample: stage1Issues.slice(0, 2).map((i: any) => i.title),
        projectKeys_len: allProjectKeys.length,
        projectKeys_sample: allProjectKeys.slice(0, 3),
        projectKrsMap_size: core.projectKrsMap.size,
        progressLogs_len: progressLogs?.length ?? 0,
        executionWeightsMap_size: core.executionWeightsMap.size,
        projectKrsMap_samples: krsEntries,
      });
    }

    // projectDeptMap の作成（projectKey → {dept, proj}）
    const projectDeptMap = new Map<string, { dept: string; proj: string }>();
    core.approved.forEach((proj) => {
      projectDeptMap.set(proj.key, { dept: proj.dept, proj: proj.proj });
    });

    const auto = inferAutoProjectIssueLinks({
      stage1Issues,
      companyTargets,
      projectKeys: allProjectKeys,
      projectKrsMap: core.projectKrsMap,
      progressLogs,
      executionWeightsMap: core.executionWeightsMap,
      projectDeptMap,
    });

    if (DEBUG) {
      console.log(`[STAGE6] AUTO issueLinks: ${auto.length}件生成`);
    }

    return auto;
  }, [isReady, allProjectKeys, stage1Issues, companyTargets, core.projectKrsMap, progressLogs, core.executionWeightsMap, core.approved]);

  // === STAGE6 Phase E：effectiveProjectIssueLinks（manual + auto マージ） ===
  const effectiveProjectIssueLinks = useMemo(() => {
    const manual = Array.isArray(projectIssueLinks) ? projectIssueLinks : [];
    const auto = autoProjectIssueLinks;

    const effective = mergeLinks({ manual, auto });

    if (DEBUG) {
      console.log(`[STAGE6] effectiveProjectIssueLinks: manual=${manual.length}, auto=${auto.length}, merged=${effective.length}`);
    }

    return effective;
  }, [projectIssueLinks, autoProjectIssueLinks]);

  // === G-1: Debug logging setup ===
  useEffect(() => {
    if (DEBUG && companyTargets.length > 0) {
      const samples = companyTargets.slice(0, 2);
      console.log('[G-1] CompanyTargets sample:', samples.map((t: any) => ({ id: t.id, label: t.label, unit: t.unit, base: t.base })));
    }
  }, [companyTargets]);

  // === E-2: chartData ビルド（売上・営業利益の最終値を取得） ===
  const chartData = useMemo(() => {
    const baseline = (Array.isArray(core.baselineYearly) ? core.baselineYearly : []) as YearlyPL[];
    const all = (Array.isArray(core.yearlyAll?.base) ? core.yearlyAll.base : []) as YearlyPL[];
    const selected = [] as YearlyPL[];

    const years = Array.from(
      new Set<number>([...baseline.map((x: YearlyPL) => x.year), ...all.map((x: YearlyPL) => x.year), ...selected.map((x: YearlyPL) => x.year)]),
    ).sort((a, b) => a - b);

    const mapYearly = (arr: YearlyPL[]) => {
      const m = new Map<number, YearlyPL>();
      arr.forEach((x: YearlyPL) => m.set(x.year, x));
      return m;
    };

    const mb = mapYearly(baseline);
    const ma = mapYearly(all);
    const ms = mapYearly(selected);

    const data = years.map((year) => ({
      year,
      baselineRevenue: mb.get(year)?.revenue ?? 0,
      allRevenue: ma.get(year)?.revenue ?? 0,
      selectedRevenue: ms.get(year)?.revenue ?? 0,
      baselineOp: mb.get(year)?.op_income ?? 0,
      allOp: ma.get(year)?.op_income ?? 0,
      selectedOp: ms.get(year)?.op_income ?? 0,
    }));

    // ★Debug: グラフ系列が同一か確認
    if (DEBUG) {
      const revBaseline = data.map(d => d.baselineRevenue);
      const revAll = data.map(d => d.allRevenue);
      const revSelected = data.map(d => d.selectedRevenue);
      const opBaseline = data.map(d => d.baselineOp);
      const opAll = data.map(d => d.allOp);
      const opSelected = data.map(d => d.selectedOp);

      console.log('[E-2 グラフ系列チェック]', {
        years,
        revenueBaseline: revBaseline,
        revenueAll: revAll,
        revenueSelected: revSelected,
        allEqualRevenue: JSON.stringify(revAll) === JSON.stringify(revBaseline),
        selectedEqualRevenue: JSON.stringify(revSelected) === JSON.stringify(revBaseline),
        opBaseline: opBaseline,
        opAll: opAll,
        opSelected: opSelected,
        allEqualOp: JSON.stringify(opAll) === JSON.stringify(opBaseline),
        selectedEqualOp: JSON.stringify(opSelected) === JSON.stringify(opBaseline),
      });
    }

    return data;
  }, [core.baselineYearly, core.yearlyAll]);

  // ★ TASK-2: Baseline 参照元追跡ログ（デバッグ用）
  useEffect(() => {
    if (!DEBUG || !isReady) return;

    const DEBUG_ENABLED = process.env.NEXT_PUBLIC_DEBUG_STAGE6 === '1';
    if (!DEBUG_ENABLED) return;

    try {
      // Baseline 候補ソースの収集
      const baselineSources: Array<{
        sourceName: string;
        pickedYear?: number;
        rawValue?: number;
        rawUnit?: string;
        normalizedValue?: number;
        normalizedUnit?: string;
      }> = [];

      // Candidate 1: Stage1 financeSummary (deprecated but check anyway)
      if (financePL && Array.isArray(financePL) && financePL.length > 0) {
        const latestPL = financePL[financePL.length - 1];
        baselineSources.push({
          sourceName: 'Stage1_financePL',
          pickedYear: latestPL?.year,
          rawValue: latestPL?.revenue,
          rawUnit: 'yen（推定）',
        });
      }

      // Candidate 2: csvFinanceData
      if (csvFinanceData && typeof csvFinanceData === 'object') {
        baselineSources.push({
          sourceName: 'Stage1_csvFinanceData',
          rawValue: (csvFinanceData as any)?.financeBS?.length,
          rawUnit: 'object_key_count',
        });
      }

      // Candidate 3: valueAnalysis
      if (valueAnalysis && typeof valueAnalysis === 'object') {
        baselineSources.push({
          sourceName: 'Stage1_valueAnalysis',
          rawValue: (valueAnalysis as any)?.revenue,
          rawUnit: 'object_property',
        });
      }

      // Candidate 4: companyTargets（North Star メトリクス）
      if (companyTargets && Array.isArray(companyTargets) && companyTargets.length > 0) {
        const revenueTarget = companyTargets.find((t) => t.label?.toLowerCase().includes('売上'));
        baselineSources.push({
          sourceName: 'Stage2_companyTargets_revenue',
          pickedYear: revenueTarget?.dueYear,
          rawValue: revenueTarget?.base,
          rawUnit: revenueTarget?.unit,
        });
      }

      // Candidate 5: core.baselineYearly（実際の計算結果）
      if (core.baselineYearly && Array.isArray(core.baselineYearly) && core.baselineYearly.length > 0) {
        const lastBaseline = core.baselineYearly[core.baselineYearly.length - 1];
        baselineSources.push({
          sourceName: 'Stage6_baselineYearly_final',
          pickedYear: lastBaseline?.year,
          rawValue: lastBaseline?.revenue,
          rawUnit: 'yen（計算結果）',
        });
      }

      console.group('[TASK-2] Baseline 参照元追跡');
      console.log('Context:', {
        companyName,
        scenarioKey,
        isReady,
      });
      console.table(baselineSources);
      if (core.baselineYearly && core.baselineYearly.length > 0) {
        const lastBaseline = core.baselineYearly[core.baselineYearly.length - 1];
        console.log(`✓ 最終採用 Baseline: Stage6_baselineYearly_final (year=${lastBaseline?.year}, revenue=${lastBaseline?.revenue})`);
      }
      console.groupEnd();
    } catch (e) {
      console.warn('[TASK-2] Baseline追跡ログエラー:', e);
    }
  }, [isReady, financePL, csvFinanceData, valueAnalysis, companyTargets, core.baselineYearly, companyName, scenarioKey]);

  // === E-3: Hybrid North Star calculation ===
  // 1. 既存ロジックで全行を計算
  // 2. 売上/営業利益の行は chartData の終点値と同期
  // 3. Phase E impact がある行だけ上書き（ハイブリッド）
  const northStarRows = useMemo(() => {
    // Step 1: 既存ロジックで初期計算
    const baseRows = buildNorthStarRows({
      companyTargets,
      yearlyAll: core.yearlyAll,  // ★ raw full forecast（STAGE5実行度未反映）
      scenarioKey,
    projectContrib: projectContribForUI,
    });

    // ★ 追加ログ：buildNorthStarRows の入力確認
    if (DEBUG && baseRows.length > 0) {
      console.group('[E-3] buildNorthStarRows input/output');
      console.log('Input: core.yearlyAll[base]:', {
        '説明': 'raw full forecast（全KRの100%効果）',
        'yearlyAll.base.length': core.yearlyAll?.base?.length ?? 0,
      });
      const revRow = baseRows.find(r => r.label.toLowerCase().includes('売上') && !r.label.toLowerCase().includes('成長'));
      if (revRow) {
        console.log('Revenue row (raw forecast):', {
          base: revRow.base,
          forecastValue: revRow.forecastValue,
          '説明': 'STAGE5実行度未反映（Project.impactRevenueMJPY ではなく calcYearlyFromKrs 結果）',
        });
      }
      console.groupEnd();
    }

    // ★ 追加修正：project contribution の合算を計算（effective ベース化用）
    // ★注意: projectContribForUI の deltaRevenueTotal / deltaOpTotal は常に MJPY に統一済
    const sumProjectEffectiveRevenue = projectContribForUI.reduce((s, p) => s + (p.deltaRevenueTotal ?? 0), 0);
    const sumProjectEffectiveOp = projectContribForUI.reduce((s, p) => s + (p.deltaOpTotal ?? 0), 0);

    if (DEBUG) {
      console.log('[E-3-EFFECTIVE] Project contribution sum (MJPY unified):', {
        sumProjectEffectiveRevenue_UNIT: 'MJPY',
        sumProjectEffectiveRevenue,
        sumProjectEffectiveOp_UNIT: 'MJPY',
        sumProjectEffectiveOp,
        projectCount: projectContribForUI.length,
        '説明': '★統一基準：下段の合算値（MJPY）が上段の company forecast となる',
      });
    }

    // Step 2: ★修正 FIX-FINAL：売上/営業利益の行を effective ベース（project 合算）で上書き（E-2）
    // ★BUG-FIX：baseline（KRなし見込み）と target（北極星）を正確に分離
    const syncedRows = baseRows.map((row) => {
      const isRevenueLike = row.label.toLowerCase().includes('売上') && !row.label.toLowerCase().includes('成長');
      const isOpIncomeLike = row.label.toLowerCase().includes('営業利益') && !row.label.toLowerCase().includes('率');

      if (isRevenueLike || isOpIncomeLike) {
        // ★修正 FIX-FINAL：Unit Normalization 追加修正
        // - 北極星の baseline/forecast/target をすべて同一単位（MJPY推奨）に正規化
        // - achievementRate = forecastMJPY / targetMJPY * 100
        const metricType = isRevenueLike ? 'Revenue' : 'OpIncome';

        // ★重要：row.unit を確認して MJPY に統一
        const targetRowUnit = row.unit ?? 'yen';
        const targetRowUnitNormalized =
          (targetRowUnit === 'MJPY' || targetRowUnit === '百万円') ? 'MJPY' : 'yen';

        // ★BUG-FIX：baselineVal を core.baselineYearly から正確に取得（yen で返される）
        const baselineYearlyFinal = core.baselineYearly?.[core.baselineYearly.length - 1];
        const baselineValYen = isRevenueLike
          ? (baselineYearlyFinal?.revenue ?? (row.base * 1_000_000))
          : (baselineYearlyFinal?.op_income ?? (row.base * 1_000_000));

        // ★UNIT NORMALIZATION: すべて MJPY に統一して計算
        // baseline（KRなし見込み）
        const baselineMJPY = baselineValYen / 1_000_000;

        // target（北極星目標値）- row.base は既に row.unit なので MJPY に変換
        const targetMJPY = targetRowUnitNormalized === 'MJPY'
          ? row.base
          : (row.base / 1_000_000);

        // project effective delta（既に MJPY）
        const effectiveDeltaMJPY = isRevenueLike ? sumProjectEffectiveRevenue : sumProjectEffectiveOp;

        // forecast = baseline + project delta （MJPY）
        const forecastMJPY = baselineMJPY + effectiveDeltaMJPY;

        // achievementRate = forecastMJPY / targetMJPY × 100%（単位統一）
        const newAchievement =
          targetMJPY && targetMJPY !== 0
            ? (forecastMJPY / targetMJPY) * 100
            : undefined;

        // ★表示値：row.unit に変換して返す（row.unit がyen なら MJPY→yen）
        const baselineValDisplay = targetRowUnitNormalized === 'MJPY' ? baselineMJPY : baselineValYen;
        const forecastValDisplay = targetRowUnitNormalized === 'MJPY' ? forecastMJPY : (forecastMJPY * 1_000_000);
        const targetValDisplay = row.base;  // 既に row.unit
        const gapDisplay = targetRowUnitNormalized === 'MJPY' ? effectiveDeltaMJPY : (effectiveDeltaMJPY * 1_000_000);

        if (DEBUG) {
          console.log(`[STAGE6][top-debug-${metricType}]`, {
            '★計算ステップ': '全て MJPY で統一',
            baselineMJPY,
            targetMJPY,
            effectiveDeltaMJPY,
            forecastMJPY,
            achievementRate: newAchievement,
            '表示単位': targetRowUnitNormalized,
            baselineValDisplay,
            forecastValDisplay,
            targetValDisplay,
            gapDisplay,
            '確認': `baseline=${baselineMJPY}M, target=${targetMJPY}M, forecast=${forecastMJPY}M, achievement=${newAchievement?.toFixed(1)}%`,
          });
        }

        return {
          ...row,
          forecastValue: forecastValDisplay,
          gap: gapDisplay,
          achievementRate: newAchievement,
        };
      }

      return row;
    });

    // Step 3: ★修正B（必須）Phase E は「チャートデータで既に反映」なら northStarRows では追加しない
    // 判定：effectiveProjectTargetImpacts に値があり、chartDataWithPhaseE で加算されている場合は、
    // northStarRows では Phase E を「参考情報のみ」として breakdownを付与するが、
    // forecastValue/gap/achievementRate には含めない（chartDataWithPhaseE と同期するだけ）

    // 全 delta が 0 のときは Phase E を適用しない（E-2の推定を壊さない）
    const allZero = effectiveProjectTargetImpacts.every((i) => !i.delta || i.delta === 0);
    if (allZero) {
      if (DEBUG) console.log('[E-3] skip PhaseE: all deltas are zero');
      return syncedRows;
    }

    if (effectiveProjectTargetImpacts.length > 0) {

      // 1) targetId × projectId で effectiveDelta（= delta × 実行度）を合算
      const byTarget = new Map<
        string,
        { deltaSum: number; breakdown: Array<{ projectId: string; delta: number; executionWeight: number; effectiveDelta: number }> }
      >();

      for (const imp of effectiveProjectTargetImpacts) {
        const delta = typeof imp.delta === 'number' ? imp.delta : 0;
        if (!Number.isFinite(delta) || delta === 0) continue;

        const weight = core.executionWeightsMap.get(imp.projectId)?.weight ?? 1;
        const execW = Number.isFinite(weight) ? weight : 1;
        const effectiveDelta = delta * execW;

        const cur = byTarget.get(imp.targetId) ?? { deltaSum: 0, breakdown: [] };
        cur.deltaSum += effectiveDelta;

        // breakdown は projectId ごとに集約
        const existing = cur.breakdown.find((b) => b.projectId === imp.projectId);
        if (existing) {
          existing.delta += delta;
          existing.effectiveDelta += effectiveDelta;
          existing.executionWeight = execW; // 最新で上書き
        } else {
          cur.breakdown.push({
            projectId: imp.projectId,
            delta,
            executionWeight: execW,
            effectiveDelta,
          });
        }

        byTarget.set(imp.targetId, cur);
      }

      if (DEBUG) {
        console.log('[E-3] PhaseE deltas (sample):', Array.from(byTarget.entries()).slice(0, 3).map(([tid, v]) => ({
          targetId: tid,
          deltaSum: v.deltaSum,
          breakdownTop: v.breakdown.slice(0, 1),
        })));
      }

      // 2) ★修正B：northStarRows では Phase E を「加算しない」（chartDataWithPhaseE で既に加算されているため）
      // 代わりに、breakdownとphaseEDelta は「参考情報」として付与するが、
      // forecastValue/gap/achievementRate は chartDataWithPhaseE と同期したsyncedRows のまま
      const hybridRows = syncedRows.map((row) => {
        const hit = byTarget.get(row.targetId);
        if (!hit) return row;

        // ★修正：forecastValue/gap/achievementRate は既に chartData (E-2) で決定済み
        // ここでは Phase E の breakdown を「参考情報」として付与するのみ
        return {
          ...row,
          // forecastValue, gap, achievementRate はそのまま（chartData同期済み）
          // E-4（年次配賦）用：プロジェクト寄与のΔ（単位は row.unit）【参考情報】
          phaseEDelta: hit.deltaSum,
          breakdown: hit.breakdown,
        } as any;
      });

      if (DEBUG) {
        console.log(`[E-3] Breakdown(reference): ${hybridRows.length}行中${byTarget.size}行にPhaseE情報を参考付与（加算しない）`);
      }

      return hybridRows;
    }

    return syncedRows;
  }, [companyTargets, core.yearlyAll, scenarioKey, projectContribForUI, chartData, effectiveProjectTargetImpacts, core.executionWeightsMap]);

  // ★ TASK-3: North Star 単位ズレ追跡ログ - 「原本 vs 加工後」比較（デバッグ用）
  useEffect(() => {
    if (!DEBUG || !isReady || northStarRows.length === 0 || !companyTargets || companyTargets.length === 0) return;

    const DEBUG_ENABLED = process.env.NEXT_PUBLIC_DEBUG_STAGE6 === '1';
    if (!DEBUG_ENABLED) return;

    try {
      // knownUnit 定義
      const knownUnits = new Set(['yen', 'million_yen', '円', '百万円', '%', 'percent']);

      // Stage2 原本（companyTargets）から売上・営業利益を取得
      const stage2Revenue = companyTargets.find((t: any) => t.label?.toLowerCase().includes('売上') && !t.label?.toLowerCase().includes('成長'));
      const stage2OpIncome = companyTargets.find((t: any) => t.label?.toLowerCase().includes('営業利益') && !t.label?.toLowerCase().includes('率'));

      // Stage6 加工後（northStarRows）から売上・営業利益を取得
      const stage6Revenue = northStarRows.find((r) => r.label.toLowerCase().includes('売上') && !r.label.toLowerCase().includes('成長'));
      const stage6OpIncome = northStarRows.find((r) => r.label.toLowerCase().includes('営業利益') && !r.label.toLowerCase().includes('率'));

      // 比較テーブル
      const comparisonData: Array<{
        metricKey: string;
        stage2Label?: string;
        stage2RawValue?: number;
        stage2RawUnit?: string;
        stage6Label?: string;
        stage6RawValue?: number;
        stage6Unit?: string;
        stage6ForecastValue?: number;
        unitChanged?: string;
        unitFallback?: string;
      }> = [];

      // 売上の比較
      comparisonData.push({
        metricKey: 'revenue',
        stage2Label: stage2Revenue?.label,
        stage2RawValue: stage2Revenue?.base,
        stage2RawUnit: stage2Revenue?.unit,
        stage6Label: stage6Revenue?.label,
        stage6RawValue: stage6Revenue?.base,
        stage6Unit: stage6Revenue?.unit,
        stage6ForecastValue: stage6Revenue?.forecastValue,
        unitChanged: stage2Revenue && stage6Revenue && stage2Revenue.unit !== stage6Revenue.unit
          ? `${stage2Revenue.unit} → ${stage6Revenue.unit}`
          : undefined,
        unitFallback: stage6Revenue && !knownUnits.has(String(stage6Revenue.unit))
          ? `unknown_unit: ${stage6Revenue.unit}`
          : undefined,
      });

      // 営業利益の比較
      comparisonData.push({
        metricKey: 'opIncome',
        stage2Label: stage2OpIncome?.label,
        stage2RawValue: stage2OpIncome?.base,
        stage2RawUnit: stage2OpIncome?.unit,
        stage6Label: stage6OpIncome?.label,
        stage6RawValue: stage6OpIncome?.base,
        stage6Unit: stage6OpIncome?.unit,
        stage6ForecastValue: stage6OpIncome?.forecastValue,
        unitChanged: stage2OpIncome && stage6OpIncome && stage2OpIncome.unit !== stage6OpIncome.unit
          ? `${stage2OpIncome.unit} → ${stage6OpIncome.unit}`
          : undefined,
        unitFallback: stage6OpIncome && !knownUnits.has(String(stage6OpIncome.unit))
          ? `unknown_unit: ${stage6OpIncome.unit}`
          : undefined,
      });

      // ログ出力
      console.groupCollapsed('[stage6][task3] North Star 原本 vs 加工後 比較');
      console.log('Context:', {
        companyName,
        scenarioKey,
        stage2Targets_len: companyTargets.length,
        stage6Rows_len: northStarRows.length,
      });
      console.table(comparisonData);

      // Unit fallback 警告
      const fallbacks = comparisonData.filter((d) => d.unitFallback);
      if (fallbacks.length > 0) {
        console.warn('[stage6][task3] ⚠️ Unit fallback detected:');
        fallbacks.forEach((d) => {
          console.warn(`  ${d.metricKey}: ${d.unitFallback}`);
        });
      }

      // Unit 変化警告
      const changes = comparisonData.filter((d) => d.unitChanged);
      if (changes.length > 0) {
        console.warn('[stage6][task3] ⚠️ Unit changed from Stage2:');
        changes.forEach((d) => {
          console.warn(`  ${d.metricKey}: ${d.unitChanged}`);
        });
      }

      if (fallbacks.length === 0 && changes.length === 0) {
        console.log('✓ Unit consistency OK (no changes, no fallbacks)');
      }

      console.groupEnd();
    } catch (e) {
      console.warn('[TASK-3] North Star比較ログエラー:', e);
    }
  }, [isReady, northStarRows, companyTargets, companyName, scenarioKey]);

  // === E-4: グラフデータに Phase E の影響を反映（年次系列に delta 配賦） ===
  // northStarRows から売上/営業利益の forecast を取得し、年次系列に線形配賦
  const chartDataWithPhaseE = useMemo(() => {
    // Phase E の影響なければ元の chartData を返す
    if (effectiveProjectTargetImpacts.length === 0 || northStarRows.length === 0) {
      return chartData;
    }

    // northStarRows から売上/営業利益の行を探す
    const revRow = northStarRows.find(
      (r) => r.label.toLowerCase().includes('売上') && !r.label.toLowerCase().includes('成長')
    );
    const opRow = northStarRows.find(
      (r) => r.label.toLowerCase().includes('営業利益') && !r.label.toLowerCase().includes('率')
    );

    // ★修正D：Phase E検証ログ（修正B後：northStarRows は forecastValue を上書きしていないため、参考情報のみ）
    if (DEBUG && (revRow || opRow)) {
      console.group('[STAGE6][phaseE] - North Star Rows vs Chart Data');
      console.log('Note: northStarRows は chartData と同期済み（E-2）、Phase E情報は参考のみ');
      if (revRow) {
        console.log('Revenue Row:', {
          label: revRow.label,
          forecastValue: revRow.forecastValue,
          phaseEDelta: (revRow as any).phaseEDelta ?? '無し（参考情報のみ）',
          unit: revRow.unit,
        });
      }
      if (opRow) {
        console.log('OpIncome Row:', {
          label: opRow.label,
          forecastValue: opRow.forecastValue,
          phaseEDelta: (opRow as any).phaseEDelta ?? '無し（参考情報のみ）',
          unit: opRow.unit,
        });
      }
      console.groupEnd();
    }

    if (!revRow && !opRow) {
      return chartData; // Phase E で売上/営業利益が更新されていない
    }

    // ★ yen ベースの delta を計算
    let revDeltaYen = 0;
    let opDeltaYen = 0;

    if (revRow) {
      // Phase E の寄与Δ（単位: revRow.unit）。なければ0。
      const phaseEDeltaDisplay = (revRow as any).phaseEDelta ?? 0;
      revDeltaYen = normalizeValueToUnit(phaseEDeltaDisplay, revRow.unit, 'yen') ?? phaseEDeltaDisplay;

      if (DEBUG) {
        console.log(
          `[E-4] Revenue phaseEDelta: delta=${phaseEDeltaDisplay}, unit=${revRow.unit}, deltaYen=${revDeltaYen}`
        );
      }
    }

    if (opRow) {
      const phaseEDeltaDisplay = (opRow as any).phaseEDelta ?? 0;
      opDeltaYen = normalizeValueToUnit(phaseEDeltaDisplay, opRow.unit, 'yen') ?? phaseEDeltaDisplay;

      if (DEBUG) {
        console.log(
          `[E-4] OP phaseEDelta: delta=${phaseEDeltaDisplay}, unit=${opRow.unit}, deltaYen=${opDeltaYen}`
        );
      }
    }

    // 年次系列に線形配賦
    const years = chartData.map((d) => d.year);
    const startYear = Math.min(...years);
    const endYear = Math.max(...years);
    const yearRange = endYear - startYear;

    // ★Debug: delta 配賦状況
    if (DEBUG) {
      console.log(`[E-4] 年次配賦ランプ: startYear=${startYear}, endYear=${endYear}, revDeltaYen=${revDeltaYen}, opDeltaYen=${opDeltaYen}`);
    }

    return chartData.map((row) => {
      // 線形ランプ: 0 (startYear) → 1 (endYear)
      const progress = yearRange > 0 ? (row.year - startYear) / yearRange : 1;

      // ★ yen で delta を配賦、その後 百万円 に変換（表示値）
      const appliedRevDeltaYen = revDeltaYen * progress;
      const appliedOpDeltaYen = opDeltaYen * progress;

      return {
        ...row,
        // all = baseline + delta（線形配賦）
        allRevenue: (row.allRevenue ?? 0) + appliedRevDeltaYen,
        allOp: (row.allOp ?? 0) + appliedOpDeltaYen,
      };
    });
  }, [northStarRows, chartData, effectiveProjectTargetImpacts]);

  // === F-1: IssueResolution calculation with hybrid logic ===
  // If effectiveProjectIssueLinks exist, use Phase E; otherwise use existing logic
  const issueResolutions = useMemo(() => {
    if (effectiveProjectIssueLinks.length > 0) {
      // Phase E ロジックで計算
      const phaseEResolutions = buildIssueResolutionsPhaseE({
        stage1Issues,
        companyTargets,
        projectIssueLinks: effectiveProjectIssueLinks,
        executionWeights: core.executionWeightsMap,
      });

      if (DEBUG) {
        console.log(`[F-1] Phase E Issues: ${phaseEResolutions.length}件計算 (effective=${effectiveProjectIssueLinks.length})`);
      }

      return phaseEResolutions;
    } else {
      // 既存ロジック
      return buildIssueResolutions({
        stage1Issues,
        companyTargets,
        northStarRows,
      });
    }
  }, [effectiveProjectIssueLinks, stage1Issues, companyTargets, core.executionWeightsMap, northStarRows]);

  const vaCards = useMemo(() => {
    return buildValueAnalysisCards(valueAnalysis);
  }, [valueAnalysis]);

  // ===== Indicators (growth/margin) =====
  const indicatorSeries = useMemo(() => {
    const baseline = (Array.isArray(core.baselineYearly) ? core.baselineYearly : []) as YearlyPL[];
    const all = (Array.isArray(core.yearlyAll?.base) ? core.yearlyAll.base : []) as YearlyPL[];
    const selected = [] as YearlyPL[]; // No selection in this context

    const years = Array.from(
      new Set<number>([...baseline.map((x: YearlyPL) => x.year), ...all.map((x: YearlyPL) => x.year), ...selected.map((x: YearlyPL) => x.year)]),
    ).sort((a, b) => a - b);

    const mapYearly = (arr: YearlyPL[]) => {
      const m = new Map<number, YearlyPL>();
      arr.forEach((x: YearlyPL) => m.set(x.year, x));
      return m;
    };

    const mb = mapYearly(baseline);
    const ma = mapYearly(all);
    const ms = mapYearly(selected);

    const growth = years.map((year, idx) => {
      const b = mb.get(year);
      const a = ma.get(year);
      const s = ms.get(year);

      const prevYear = years[idx - 1];
      const bPrev = prevYear ? mb.get(prevYear) : undefined;
      const aPrev = prevYear ? ma.get(prevYear) : undefined;
      const sPrev = prevYear ? ms.get(prevYear) : undefined;

      const g = (cur?: YearlyPL, prev?: YearlyPL) => {
        const curRev = Number(cur?.revenue);
        const prevRev = Number(prev?.revenue);
        if (!Number.isFinite(curRev) || !Number.isFinite(prevRev) || prevRev === 0) return 0;
        return (curRev - prevRev) / prevRev;
      };

      return { year, baseline: g(b, bPrev), all: g(a, aPrev), selected: g(s, sPrev) };
    });

    const margin = years.map((year) => {
      const b = mb.get(year);
      const a = ma.get(year);
      const s = ms.get(year);

      const m = (cur?: YearlyPL) => {
        const rev = Number(cur?.revenue);
        const op = Number(cur?.op_income);
        if (!Number.isFinite(rev) || !Number.isFinite(op) || rev === 0) return 0;
        return op / rev;
      };

      return { year, baseline: m(b), all: m(a), selected: m(s) };
    });

    return { growth, margin };
  }, [core.baselineYearly, core.yearlyAll]);

  // === J-2: Detailed debug logging for calculations ===
  if (DEBUG && northStarRows.length > 0) {
    const revenueRows = northStarRows.filter(r => r.label.toLowerCase().includes('売上'));
    if (revenueRows.length > 0) {
      const sample = revenueRows[0];
      console.log('[J-2] unitNormalized:', {
        label: sample.label,
        unit: sample.unit,
        forecastValue: sample.forecastValue,
        achievementRate: sample.achievementRate,
      });
    }

    if (projectTargetImpacts.length > 0) {
      const affectedIds: string[] = [];
      northStarRows.forEach(r => {
        if ((r as any).breakdown && (r as any).breakdown.length > 0) {
          affectedIds.push(r.targetId);
        }
      });
      console.log('[J-2] phaseEOverwrite:', {
        totalRows: northStarRows.length,
        affected: affectedIds.length,
        affectedIds,
      });
    }
  }

  // === STAGE6 Step 1: Dashboard Summary & Four Metric Cards ===
  // Calculate baseline, forecast, target for revenue/op
  // Gap = target - forecast (NOT baseline - forecast)
  // ★ A.修正: Forecast = Baseline + sum(projectContrib) に統一
  const dashboardSummary = useMemo(() => {
    const baselineYearlyFinal = core.baselineYearly?.[core.baselineYearly.length - 1];

    // Baseline (KR なし、yen単位)
    const baselineRevenueMJPY = (baselineYearlyFinal?.revenue ?? 0) / 1_000_000;
    const baselineOpMJPY = (baselineYearlyFinal?.op_income ?? 0) / 1_000_000;

    // ★ Forecast = Baseline + sum(projectContrib.delta) に統一
    // これにより上段のforecastと下段のprojectContribのソースが統一される
    const sumProjectRevenueContrib = projectContribForUI.reduce((sum, p) => sum + (p.deltaRevenueTotal ?? 0), 0);
    const sumProjectOpContrib = projectContribForUI.reduce((sum, p) => sum + (p.deltaOpTotal ?? 0), 0);

    const forecastRevenueMJPY = baselineRevenueMJPY + sumProjectRevenueContrib;
    const forecastOpMJPY = baselineOpMJPY + sumProjectOpContrib;

    // Target (from northStarRows, already normalized to MJPY)
    const revenueRow = northStarRows.find(r => r.label.toLowerCase().includes('売上') && !r.label.toLowerCase().includes('成長'));
    const opRow = northStarRows.find(r => r.label.toLowerCase().includes('営業利益') && !r.label.toLowerCase().includes('率'));

    // Target は row.unit で保存されているが、MJPY に正規化
    const revenueRowUnit = revenueRow?.unit ?? 'yen';
    const opRowUnit = opRow?.unit ?? 'yen';
    const revenueRowUnitNorm = (revenueRowUnit === 'MJPY' || revenueRowUnit === '百万円') ? 'MJPY' : 'yen';
    const opRowUnitNorm = (opRowUnit === 'MJPY' || opRowUnit === '百万円') ? 'MJPY' : 'yen';

    const targetRevenueMJPY = revenueRowUnitNorm === 'MJPY'
      ? (revenueRow?.base ?? 0)
      : ((revenueRow?.base ?? 0) / 1_000_000);
    const targetOpMJPY = opRowUnitNorm === 'MJPY'
      ? (opRow?.base ?? 0)
      : ((opRow?.base ?? 0) / 1_000_000);

    // Gap = target - forecast (key change from base - forecast)
    // Math.max(0, ...) で負の値を避ける（達成済みの場合は0）
    const revenueGapMJPY = Math.max(0, targetRevenueMJPY - forecastRevenueMJPY);
    const opGapMJPY = Math.max(0, targetOpMJPY - forecastOpMJPY);

    // Top projects by revenue and op contribution
    const topRevenueProjects = projectContribForUI
      .filter(p => p.deltaRevenueTotal > 0)
      .sort((a, b) => (b.deltaRevenueTotal ?? 0) - (a.deltaRevenueTotal ?? 0))
      .slice(0, 3);

    const topOpProjects = projectContribForUI
      .filter(p => p.deltaOpTotal > 0)
      .sort((a, b) => (b.deltaOpTotal ?? 0) - (a.deltaOpTotal ?? 0))
      .slice(0, 3);

    return {
      revenue: {
        baseline: baselineRevenueMJPY,
        forecast: forecastRevenueMJPY,
        target: targetRevenueMJPY,
        gap: revenueGapMJPY,
      },
      op: {
        baseline: baselineOpMJPY,
        forecast: forecastOpMJPY,
        target: targetOpMJPY,
        gap: opGapMJPY,
      },
      topRevenueProjects,
      topOpProjects,
    };
  }, [northStarRows, core.baselineYearly, projectContribForUI]);

  // === STAGE6 Step 2: Four Metric Cards ===
  const fourMetricCards = useMemo(() => {
    const baselineYearlyFinal = core.baselineYearly?.[core.baselineYearly.length - 1];
    const forecastYearlyFinal = core.yearlyAll?.base?.[core.yearlyAll.base.length - 1];

    // Determine years for CAGR calculation
    const baselineYear = baselineYearlyFinal?.year;
    const forecastYear = forecastYearlyFinal?.year;
    const targetYear = companyTargets?.[0]?.dueYear ?? forecastYear; // fallback to forecast year

    // Estimate investedCapital (baseline equity + debt)
    // For now, use a simple heuristic: baselineRevenue * 0.3 (30% of revenue as capital)
    const baselineRevenue = baselineYearlyFinal?.revenue ?? 1_000_000;
    const estimatedInvestedCapital = baselineRevenue * 0.3;

    return buildStage6FourMetricCards({
      currentValueAnalysis: valueAnalysis,
      baselineRevenue: baselineYearlyFinal?.revenue,
      baselineOp: baselineYearlyFinal?.op_income,
      baselineYear,
      forecastRevenue: forecastYearlyFinal?.revenue,
      forecastOp: forecastYearlyFinal?.op_income,
      forecastYear,
      targetRevenue: dashboardSummary.revenue.target * 1_000_000, // MJPY -> yen
      targetOp: dashboardSummary.op.target * 1_000_000, // MJPY -> yen
      targetYear,
      investedCapital: estimatedInvestedCapital,
      baselineTaxRate: 0.3,
    });
  }, [core.baselineYearly, core.yearlyAll, valueAnalysis, companyTargets, dashboardSummary]);


  // === STAGE6: Review candidates for STAGE4 feedback ===
  const reviewCandidates = useMemo(() => {
    const candidates = projectContribForUI.map((p: any) => {
      const targetRevenue = Number((p as any).targetRevenueMJPY ?? 0);
      const targetOp = Number((p as any).targetOpIncomeMJPY ?? 0);
      const revenueContribution = Number(p.deltaRevenueTotal ?? 0);
      const opContribution = Number(p.deltaOpTotal ?? 0);

      const hasRevenueTarget = Number.isFinite(targetRevenue) && targetRevenue > 0;
      const hasOpTarget = Number.isFinite(targetOp) && targetOp > 0;

      const revenueAchievementRate =
        hasRevenueTarget ? (revenueContribution / targetRevenue) * 100 : null;
      const opAchievementRate = hasOpTarget ? (opContribution / targetOp) * 100 : null;

      let severity: 'high' | 'medium' | 'low' = 'low';
      let score = 0;
      const reasons: string[] = [];
      const stage3Reasons: string[] = [];
      const stage4Reasons: string[] = [];

      if (!hasRevenueTarget && !hasOpTarget) {
        severity = 'high';
        score += 100;
        reasons.push('目標額が未入力です');
        stage4Reasons.push('目標額が未入力です');
      }

      if (hasRevenueTarget && revenueContribution <= 0) {
        severity = 'high';
        score += 90;
        reasons.push('売上目標はあるが売上寄与が0です');
        stage3Reasons.push('売上目標はあるが売上寄与が0です');
      } else if (hasRevenueTarget && revenueAchievementRate !== null && revenueAchievementRate < 70) {
        severity = severity === 'high' ? 'high' : 'medium';
        score += Math.max(0, 80 - revenueAchievementRate);
        reasons.push(`売上寄与が目標に対して不足しています（${Math.round(revenueAchievementRate)}%）`);
        if (revenueAchievementRate < 40) {
          stage3Reasons.push(`売上寄与が目標に対して極めて弱い状態です（${Math.round(revenueAchievementRate)}%）`);
        } else {
          stage4Reasons.push(`売上寄与が目標に対して不足しています（${Math.round(revenueAchievementRate)}%）`);
        }
      }

      if (hasOpTarget && opContribution <= 0) {
        severity = 'high';
        score += 90;
        reasons.push('営業利益目標はあるが営業利益寄与が0です');
        stage3Reasons.push('営業利益目標はあるが営業利益寄与が0です');
      } else if (hasOpTarget && opAchievementRate !== null && opAchievementRate < 70) {
        severity = severity === 'high' ? 'high' : 'medium';
        score += Math.max(0, 80 - opAchievementRate);
        reasons.push(`営業利益寄与が目標に対して不足しています（${Math.round(opAchievementRate)}%）`);
        if (opAchievementRate < 40) {
          stage3Reasons.push(`営業利益寄与が目標に対して極めて弱い状態です（${Math.round(opAchievementRate)}%）`);
        } else {
          stage4Reasons.push(`営業利益寄与が目標に対して不足しています（${Math.round(opAchievementRate)}%）`);
        }
      }

      if (!hasOpTarget && hasRevenueTarget) {
        severity = severity === 'high' ? 'high' : 'medium';
        score += 35;
        reasons.push('営業利益目標が未入力です');
        stage4Reasons.push('営業利益目標が未入力です');
      }

      if (!hasRevenueTarget && hasOpTarget) {
        severity = severity === 'high' ? 'high' : 'medium';
        score += 35;
        reasons.push('売上目標が未入力です');
        stage4Reasons.push('売上目標が未入力です');
      }

      const bothTargetsReady = hasRevenueTarget && hasOpTarget;
      const revenueSeverelyLow =
        hasRevenueTarget && (revenueContribution <= 0 || (revenueAchievementRate !== null && revenueAchievementRate < 40));
      const opSeverelyLow =
        hasOpTarget && (opContribution <= 0 || (opAchievementRate !== null && opAchievementRate < 40));

      const reviewStage: 'stage3' | 'stage4' =
        bothTargetsReady && (revenueSeverelyLow || opSeverelyLow) ? 'stage3' : 'stage4';

      const reviewReasonType =
        reviewStage === 'stage3' ? 'low_financial_leverage' : 'okr_or_target_gap';

      const stageReason =
        reviewStage === 'stage3'
          ? stage3Reasons[0] ?? reasons[0] ?? '目標は入力済みですが寄与が弱く、プロジェクト自体の見直し候補です'
          : stage4Reasons[0] ?? reasons[0] ?? '目標・実行設計の見直し候補です';

      return {
        key: p.key,
        dept: p.dept,
        proj: p.proj,
        deptId: p.deptId,
        projectId: p.projectId,
        reviewStage,
        reviewReasonType,
        reason: stageReason,
        severity,
        score,
        targetRevenueMJPY: hasRevenueTarget ? targetRevenue : undefined,
        revenueContributionMJPY: revenueContribution,
        revenueAchievementRate,
        targetOpMJPY: hasOpTarget ? targetOp : undefined,
        opContributionMJPY: opContribution,
        opAchievementRate,
      };
    });

    return candidates
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [projectContribForUI]);


  // ★ 追加修正：上段と下段の整合性確認ログ（★統一基準確認＋baseline修正）
  if (DEBUG && isReady && northStarRows.length > 0 && projectContribForUI.length > 0) {
    const revenueRow = northStarRows.find(r => r.label.toLowerCase().includes('売上') && !r.label.toLowerCase().includes('成長'));
    const opRow = northStarRows.find(r => r.label.toLowerCase().includes('営業利益') && !r.label.toLowerCase().includes('率'));

    const companyRevenueForecast = revenueRow?.forecastValue ?? 0;
    const companyOpForecast = opRow?.forecastValue ?? 0;

    const sumProjectEffectiveRevenue = projectContribForUI.reduce((s, p) => s + (p.deltaRevenueTotal ?? 0), 0);
    const sumProjectEffectiveOp = projectContribForUI.reduce((s, p) => s + (p.deltaOpTotal ?? 0), 0);

    // ★修正後：Unit Normalization を MJPY で統一
    // NOTE:
    // - baselineYearly は yen
    // - revenueRow.base / opRow.base は row.unit に依存（MJPY or yen）
    // - projectContribForUI の delta は MJPY
    // → すべて MJPY に統一して計算
    const baselineYearlyFinal = core.baselineYearly?.[core.baselineYearly.length - 1];

    // Baseline（KRなし見込み、yen→MJPY）
    const baselineRevenueMJPY = (baselineYearlyFinal?.revenue ?? 0) / 1_000_000;
    const baselineOpMJPY = (baselineYearlyFinal?.op_income ?? 0) / 1_000_000;

    // Target（北極星目標値、row.unit に応じて正規化）
    const revenueRowUnit = revenueRow?.unit ?? 'yen';
    const opRowUnit = opRow?.unit ?? 'yen';
    const revenueRowUnitNormalized = (revenueRowUnit === 'MJPY' || revenueRowUnit === '百万円') ? 'MJPY' : 'yen';
    const opRowUnitNormalized = (opRowUnit === 'MJPY' || opRowUnit === '百万円') ? 'MJPY' : 'yen';

    const targetRevenueMJPY = revenueRowUnitNormalized === 'MJPY'
      ? (revenueRow?.base ?? 0)
      : ((revenueRow?.base ?? 0) / 1_000_000);
    const targetOpMJPY = opRowUnitNormalized === 'MJPY'
      ? (opRow?.base ?? 0)
      : ((opRow?.base ?? 0) / 1_000_000);

    // Forecast（baseline + project delta、MJPY）
    // ★重要：companyRevenueForecast / companyOpForecast は既に northStarRows で正規化済み
    // ただし row.unit に応じて yen or MJPY で返される。MJPY に統一
    const forecastRevenueMJPY = revenueRowUnitNormalized === 'MJPY'
      ? (companyRevenueForecast ?? 0)
      : ((companyRevenueForecast ?? 0) / 1_000_000);
    const forecastOpMJPY = opRowUnitNormalized === 'MJPY'
      ? (companyOpForecast ?? 0)
      : ((companyOpForecast ?? 0) / 1_000_000);

    // 検証用：baselineRevenue / baselineOp は MJPY
    const baselineRevenue = baselineRevenueMJPY;
    const baselineOp = baselineOpMJPY;
    const targetRevenue = targetRevenueMJPY;
    const targetOp = targetOpMJPY;
    const companyRevenueAchievement = revenueRow?.achievementRate ?? 0;
    const companyOpAchievement = opRow?.achievementRate ?? 0;

    // Gap（MJPY ベース）
    const gapRevenue = Math.abs(forecastRevenueMJPY - baselineRevenueMJPY - sumProjectEffectiveRevenue);
    const gapOp = Math.abs(forecastOpMJPY - baselineOpMJPY - sumProjectEffectiveOp);

    // ★症状診断
    const is100Fixed = companyRevenueAchievement === 100;
    const hasSemiRevenue = projectContribForUI.some((p: any) => p.proj.toLowerCase().includes('半導体') && p.deltaRevenueTotal > 0);

    console.group('[STAGE6][top-vs-bottom] 上段 company forecast vs 下段 project contribution（★統一基準＋診断）');
    console.log('Company Level (Top) - Revenue（MJPY統一）:', {
      baselineRevenueMJPY: { value: baselineRevenueMJPY.toFixed(1), unit: 'M' },
      targetRevenueMJPY: { value: targetRevenueMJPY.toFixed(1), unit: 'M', note: '北極星目標値' },
      forecastRevenueMJPY: { value: forecastRevenueMJPY.toFixed(1), unit: 'M', note: 'baseline + project' },
      companyDeltaRevenueMJPY: (forecastRevenueMJPY - baselineRevenueMJPY).toFixed(1),
      achievementRateRevenue: `${companyRevenueAchievement?.toFixed(1) ?? '?'}%`,
      '⚠️症状①': is100Fixed ? '✗ 100%固定' : '✓ 可変',
    });
    console.log('Company Level (Top) - OpIncome（MJPY統一）:', {
      baselineOpMJPY: { value: baselineOpMJPY.toFixed(1), unit: 'M' },
      targetOpMJPY: { value: targetOpMJPY.toFixed(1), unit: 'M', note: '北極星目標値' },
      forecastOpMJPY: { value: forecastOpMJPY.toFixed(1), unit: 'M', note: 'baseline + project' },
      companyDeltaOpMJPY: (forecastOpMJPY - baselineOpMJPY).toFixed(1),
      achievementRateOp: `${companyOpAchievement?.toFixed(1) ?? '?'}%`,
    });
    console.log('Project Contributions (Bottom)（MJPY統一）:', {
      sumProjectEffectiveRevenueMJPY: sumProjectEffectiveRevenue.toFixed(1),
      sumProjectEffectiveOpMJPY: sumProjectEffectiveOp.toFixed(1),
      projectCount: projectContribForUI.length,
      '⚠️症状②': hasSemiRevenue ? '✓ 半導体案件に revenue ある' : '✗ 半導体案件に revenue なし',
    });
    console.log('Reconciliation (★統一基準での検証 - MJPY統一):', {
      '計算式': 'forecastMJPY = baselineMJPY + sumProjectEffectiveMJPY',
      '単位': 'すべて MJPY',
      forecastRevenueCheck: `${baselineRevenueMJPY.toFixed(1)}M + ${sumProjectEffectiveRevenue.toFixed(1)}M = ${(baselineRevenueMJPY + sumProjectEffectiveRevenue).toFixed(1)}M（期待 ${forecastRevenueMJPY.toFixed(1)}M）`,
      forecastOpCheck: `${baselineOpMJPY.toFixed(1)}M + ${sumProjectEffectiveOp.toFixed(1)}M = ${(baselineOpMJPY + sumProjectEffectiveOp).toFixed(1)}M（期待 ${forecastOpMJPY.toFixed(1)}M）`,
      gapRevenue: gapRevenue < 1 ? '✓整合' : `⚠️乖離 ${gapRevenue.toFixed(1)}M`,
      gapOp: gapOp < 1 ? '✓整合' : `⚠️乖離 ${gapOp.toFixed(1)}M`,
      '説明': '★修正後：上下が同じ MJPY ベースなので gap はほぼ 0（丸め誤差のみ）',
    });
    console.log('Data Source Unification（★Unit Normalization）:', {
      '計算の基盤': 'すべて MJPY に統一',
      baseline: 'core.baselineYearly → yen / 1_000_000 = MJPY',
      target: 'northStarRow.base（row.unit に応じて MJPY に正規化）',
      projectDelta: 'projectContribForUI.sum（既に MJPY）',
      achievementRate: 'forecastMJPY / targetMJPY × 100%（単位統一）',
      '✓統一': 'STAGE6 全体が STAGE5 進捗を反映した「現時点の見込み」',
    });
    console.groupEnd();
  }

  return {
    // Status
    hydrated,
    isHydrating,
    isReady,
    companyName: core.companyName,
    error: core.error,
    // Core data
    core,
    allProjectKeys,
    // Computed data
    projectContrib: projectContribForUI,
    northStarRows,
    issueResolutions,
    vaCards,
    indicatorSeries,
    chartData: chartDataWithPhaseE,  // ★Phase E の影響を反映したグラフデータ
    // STAGE6 Step 1 & 2: Dashboard summary & metric cards
    dashboardSummary,
    // Supporting data
    financePL,
    companyTargets,
    stage1Issues,
    valueAnalysis,
    reviewCandidates,
  };
}
