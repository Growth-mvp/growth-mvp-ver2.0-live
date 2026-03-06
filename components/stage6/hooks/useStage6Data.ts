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
} from '@/utils/stage6';
import { calcYearlyFromKrs } from '@/utils/stage6/compute';
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

    const allKrs: BridgeKR[] = [];
    projectKrsMap.forEach((krs) => {
      allKrs.push(...krs);
    });

    const yearlyAll = {
      low: baseTraj && baseFigures ? calcYearlyFromKrs({ baseTraj, baseFigures, krs: allKrs, scenario: scenarios.low }) : [],
      base: baseTraj && baseFigures ? calcYearlyFromKrs({ baseTraj, baseFigures, krs: allKrs, scenario: scenarios.base }) : [],
      high: baseTraj && baseFigures ? calcYearlyFromKrs({ baseTraj, baseFigures, krs: allKrs, scenario: scenarios.high }) : [],
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
    };
  }, [hydrated, isHydrating, departments, financePL, revision, isReady, companyName, makeProjectKey, normalizeKind, normalizeUnit]);

  // ===== Project keys and effective selected keys =====
  const allProjectKeys = useMemo(() => Array.from(core.projectKrsMap.keys()), [core.projectKrsMap]);

  // ===== Project contribution, North Star, Issues, Value Analysis =====
  const projectContrib = useMemo(() => {
    return buildProjectContributions({
      core,
      financePL,
      departments,
      effectiveSelectedKeys: allProjectKeys, // Use all projects by default
      mkBaseFigures,
      mkBaselineTrajectory,
      getEvidenceFromProject,
      getExecutionWeight,
      progressLogs, // Use state (not ref) to ensure re-render and executionWeight recalc
    });
  }, [core, financePL, departments, allProjectKeys, progressLogs]);

  // === STAGE6 Phase E：executionWeights Map化 ===
  const executionWeightsMap = useMemo(() => {
    const map = new Map<string, { weight: number }>();
    projectContrib.forEach((contrib) => {
      if (contrib.executionWeight) {
        map.set(contrib.key, { weight: contrib.executionWeight.weight });
      }
    });
    return map;
  }, [projectContrib]);

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
        executionWeightsMap_size: executionWeightsMap.size,
        projectKrsMap_samples: krsEntries,
      });
    }

    const auto = inferAutoProjectTargetImpacts({
      companyTargets,
      projectKeys: allProjectKeys,
      projectKrsMap: core.projectKrsMap,
      executionWeightsMap,
      scenarioKey,
    });

    if (DEBUG) {
      console.log(`[STAGE6] AUTO targetImpacts: ${auto.length}件生成`);
    }

    return auto;
  }, [isReady, allProjectKeys, companyTargets, core.projectKrsMap, executionWeightsMap, scenarioKey]);

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


  // === STAGE6 安定版：Tab1（プロジェクト寄与）用に、STAGE4入力の projectTargetImpacts をプロジェクト単位へ合算して上書き ===
  // - TabImpact は deltaRevenueTotal / deltaOpTotal を「円」で表示（fmtJPY）
  // - projectTargetImpacts.delta は companyTargets.unit（通常: 百万円）なので、必ず「円」に換算してから埋める
  const projectContribForUI = useMemo(() => {
    if (!projectContrib || projectContrib.length === 0) return projectContrib;

    const revTarget = companyTargets.find(
      (t: any) => typeof t?.label === 'string' && t.label.includes('売上') && !t.label.includes('成長'),
    );
    const opTarget = companyTargets.find(
      (t: any) => typeof t?.label === 'string' && t.label.includes('営業利益') && !t.label.includes('率'),
    );

    const revId: string | undefined = revTarget?.id;
    const opId: string | undefined = opTarget?.id;
    const revUnit: string = revTarget?.unit ?? 'yen';
    const opUnit: string = opTarget?.unit ?? 'yen';

    const revMap = new Map<string, number>();
    const opMap = new Map<string, number>();

    for (const imp of effectiveProjectTargetImpacts) {
      const delta = typeof (imp as any).delta === 'number' ? (imp as any).delta : 0;
      if (!Number.isFinite(delta) || delta === 0) continue;

      if (revId && (imp as any).targetId === revId) {
        const dy = normalizeValueToUnit(delta, revUnit, 'yen') ?? delta;
        revMap.set((imp as any).projectId, (revMap.get((imp as any).projectId) ?? 0) + dy);
      }
      if (opId && (imp as any).targetId === opId) {
        const dy = normalizeValueToUnit(delta, opUnit, 'yen') ?? delta;
        opMap.set((imp as any).projectId, (opMap.get((imp as any).projectId) ?? 0) + dy);
      }
    }

    // Progress Map をビルド（dept::proj::idx → {revPct, opPct}）
    const progressMap = new Map<string, { revPct?: number; opPct?: number }>();
    departments?.forEach((d: any) => {
      const deptName = d?.name ?? d?.departmentName ?? '（未名）';
      const projects = Array.isArray(d?.projects) ? d.projects : [];
      projects.forEach((proj: any, pIdx: number) => {
        const projTitle = proj?.title ?? '（未名）';
        const projKey = makeProjectKey(deptName, projTitle, pIdx);

        const revRaw = proj?.impactRevenueProgress;
        const revPct = typeof revRaw === 'number' ? Math.max(0, Math.min(100, revRaw)) : undefined;

        const opRaw = proj?.impactOpIncomeProgress;
        const opPct = typeof opRaw === 'number' ? Math.max(0, Math.min(100, opRaw)) : undefined;

        progressMap.set(projKey, { revPct, opPct });
      });
    });

    return projectContrib.map((p: any) => {
      const deltaRevenueTotal = revMap.get(p.key) ?? 0;
      const deltaOpTotal = opMap.get(p.key) ?? 0;

      // Progress から達成寄与を計算
      const progressData = progressMap.get(p.key);
      const progressRevenuePct = progressData?.revPct;
      const progressOpPct = progressData?.opPct;
      const achievedRevenueTotal = deltaRevenueTotal * ((progressRevenuePct ?? 0) / 100);
      const achievedOpTotal = deltaOpTotal * ((progressOpPct ?? 0) / 100);

      // 投資は既存の集計を尊重（0のままでもOK）。ROIは投資がある場合のみ概算。
      const investTotal = typeof p.investTotal === 'number' ? p.investTotal : 0;
      const roi =
        investTotal > 0 ? deltaOpTotal / investTotal : (Number.isFinite(p.roi as any) ? p.roi : undefined);

      const evidence =
        deltaRevenueTotal !== 0 || deltaOpTotal !== 0
          ? {
              source: 'stage4_plan',
              confidence: 'high',
              notes: 'STAGE4金額寄与（売上/営業利益）',
            }
          : p.evidence;

      return {
        ...p,
        deltaRevenueTotal,
        deltaOpTotal,
        roi,
        evidence,
        progressRevenuePct,
        progressOpPct,
        achievedRevenueTotal,
        achievedOpTotal,
      };
    });
  }, [projectContrib, effectiveProjectTargetImpacts, companyTargets, departments, makeProjectKey]);
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
        stage1Issues_sample: stage1Issues.slice(0, 2).map((i) => i.title),
        projectKeys_len: allProjectKeys.length,
        projectKeys_sample: allProjectKeys.slice(0, 3),
        projectKrsMap_size: core.projectKrsMap.size,
        progressLogs_len: progressLogs?.length ?? 0,
        executionWeightsMap_size: executionWeightsMap.size,
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
      executionWeightsMap,
      projectDeptMap,
    });

    if (DEBUG) {
      console.log(`[STAGE6] AUTO issueLinks: ${auto.length}件生成`);
    }

    return auto;
  }, [isReady, allProjectKeys, stage1Issues, companyTargets, core.projectKrsMap, progressLogs, executionWeightsMap, core.approved]);

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
      console.log('[G-1] CompanyTargets sample:', samples.map(t => ({ id: t.id, label: t.label, unit: t.unit, base: t.base })));
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
      yearlyAll: core.yearlyAll,
      scenarioKey,
    projectContrib: projectContribForUI,
    });

    // Step 2: 売上/営業利益の行は chartData と同期（E-2）
    const syncedRows = baseRows.map((row) => {
      const isRevenueLike = row.label.toLowerCase().includes('売上') && !row.label.toLowerCase().includes('成長');
      const isOpIncomeLike = row.label.toLowerCase().includes('営業利益') && !row.label.toLowerCase().includes('率');

      if (isRevenueLike || isOpIncomeLike) {
        // chartData の最後の年のデータを取得
        const lastChartRow = chartData.length > 0 ? chartData[chartData.length - 1] : null;
        if (lastChartRow) {
          const chartValue = isRevenueLike ? lastChartRow.allRevenue : lastChartRow.allOp;
          const normalizedValue = normalizeValueToUnit(chartValue, row.unit);

          if (DEBUG) {
            console.log(`[E-2] ${row.label}: chartValue=${chartValue}, normalized=${normalizedValue}, unit=${row.unit}`);
          }

          // ★Phase E 修正: yen 統一で計算（単位混在対策）
          // chartValue と baseNorm の両方を yen に統一
          const baseYen = normalizeValueToUnit(row.base, row.unit, 'yen') ?? row.base;

          const newForecast = normalizedValue;
          const newGapYen = chartValue !== undefined && baseYen ? chartValue - baseYen : undefined;
          const newGap = newGapYen !== undefined ? normalizeValueToUnit(newGapYen, 'yen', row.unit) : undefined;

          // achievementRate は yen ベースで計算（★重要）
          const newAchievement =
            chartValue !== undefined && baseYen && baseYen !== 0
              ? (chartValue / baseYen) * 100
              : undefined;

          return {
            ...row,
            forecastValue: newForecast,
            gap: newGap,
            achievementRate: newAchievement,
          };
        }
      }

      return row;
    });

    // Step 3: Phase E で加算（ハイブリッド：impact がある行だけ）
    // ★修正：ゼロチェック
    const allZero = effectiveProjectTargetImpacts.every((i) => !i.delta || i.delta === 0);
    if (allZero && effectiveProjectTargetImpacts.length > 0) {
      if (DEBUG) {
        console.log('[E-3] skip PhaseE: all deltas are zero');
      }
      return syncedRows;
    }

    if (effectiveProjectTargetImpacts.length > 0) {
      // 0) 全 delta が 0 のときは Phase E を適用しない（E-2の推定を壊さない）
      const allZero = effectiveProjectTargetImpacts.every((i) => !i.delta || i.delta === 0);
      if (allZero) {
        if (DEBUG) console.log('[E-3] skip PhaseE: all deltas are zero');
        return syncedRows;
      }

      // 1) targetId × projectId で effectiveDelta（= delta × 実行度）を合算
      const byTarget = new Map<
        string,
        { deltaSum: number; breakdown: Array<{ projectId: string; delta: number; executionWeight: number; effectiveDelta: number }> }
      >();

      for (const imp of effectiveProjectTargetImpacts) {
        const delta = typeof imp.delta === 'number' ? imp.delta : 0;
        if (!Number.isFinite(delta) || delta === 0) continue;

        const weight = executionWeightsMap.get(imp.projectId)?.weight ?? 1;
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

      // 2) syncedRows（E-2の予測=現状見込み）に PhaseE delta を「加算」する（絶対値を維持）
      const hybridRows = syncedRows.map((row) => {
        const hit = byTarget.get(row.targetId);
        if (!hit) return row;

        const baseValue = typeof row.base === 'number' ? row.base : 0;
        const syncedForecastAbs = typeof row.forecastValue === 'number' ? row.forecastValue : baseValue;

        const combinedForecastAbs = syncedForecastAbs + hit.deltaSum;
        const gapAbs = combinedForecastAbs - baseValue;
        const achievementAbs = baseValue !== 0 ? (combinedForecastAbs / baseValue) * 100 : undefined;

        return {
          ...row,
          forecastValue: combinedForecastAbs,
          gap: gapAbs,
          achievementRate: achievementAbs,
          // E-4（年次配賦）用：プロジェクト寄与のΔ（単位は row.unit）
          phaseEDelta: hit.deltaSum,
          breakdown: hit.breakdown,
        } as any;
      });

      if (DEBUG) {
        console.log(`[E-3] Hybrid(add): ${hybridRows.length}行中${byTarget.size}行にPhaseE deltaを加算`);
      }

      return hybridRows;
    }

    return syncedRows;
  }, [companyTargets, core.yearlyAll, scenarioKey, projectContrib, chartData, effectiveProjectTargetImpacts, executionWeightsMap]);

  // ★ TASK-3: North Star 単位ズレ追跡ログ - 「原本 vs 加工後」比較（デバッグ用）
  useEffect(() => {
    if (!DEBUG || !isReady || northStarRows.length === 0 || !companyTargets || companyTargets.length === 0) return;

    const DEBUG_ENABLED = process.env.NEXT_PUBLIC_DEBUG_STAGE6 === '1';
    if (!DEBUG_ENABLED) return;

    try {
      // knownUnit 定義
      const knownUnits = new Set(['yen', 'million_yen', '円', '百万円', '%', 'percent']);

      // Stage2 原本（companyTargets）から売上・営業利益を取得
      const stage2Revenue = companyTargets.find((t) => t.label?.toLowerCase().includes('売上') && !t.label?.toLowerCase().includes('成長'));
      const stage2OpIncome = companyTargets.find((t) => t.label?.toLowerCase().includes('営業利益') && !t.label?.toLowerCase().includes('率'));

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
        executionWeights: executionWeightsMap,
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
  }, [effectiveProjectIssueLinks, stage1Issues, companyTargets, executionWeightsMap, northStarRows]);

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
    // Supporting data
    financePL,
    companyTargets,
    stage1Issues,
    valueAnalysis,
  };
}
