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

import { useStrategyStore } from '@/store/strategyStore';
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
} from '@/utils/stage6';
import { calcYearlyFromKrs } from '@/utils/stage6/compute';

const DEBUG = process.env.NODE_ENV === 'development' && !!process.env.NEXT_PUBLIC_DEBUG_STAGE6;

/**
 * useStage6Data
 * Consolidates all data fetching, initialization, and memoization for STAGE6
 * Returns computed data ready for rendering
 */
export function useStage6Data(scenarioKey: 'low' | 'base' | 'high') {
  // ===== Store selectors =====
  const companyName = useStrategyStore((s) => s.companyName ?? '会社名未設定');
  const departments = useStrategyStore((s) =>
    Array.isArray(s.departments) ? s.departments : [],
  ) as Department[];
  const financePL = useStrategyStore((s) => (Array.isArray(s.financePL) ? s.financePL : []));
  const csvFinanceData = useStrategyStore((s) => s.csvFinanceData ?? {});
  const revision = useStrategyStore((s) => s.revision);
  const boot = useStrategyStore((s) => s.boot);
  const companyTargets = useStrategyStore((s) => (Array.isArray(s.companyTargets) ? s.companyTargets : []));
  const stage1Issues = useStrategyStore((s) => (Array.isArray(s.stage1Issues) ? s.stage1Issues : []));
  const valueAnalysis = useStrategyStore((s) => s.valueAnalysis);
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

    const scenarios = {
      low: { successRate: 0.5, synergyRate: -0.05 },
      base: { successRate: 0.8, synergyRate: 0.0 },
      high: { successRate: 1.0, synergyRate: 0.1 },
    };

    // Baseline is with no KRs (empty array)
    const baselineYearly = baseTraj
      ? calcYearlyFromKrs({ baseTraj, baseFigures, krs: [], scenario: scenarios.base })
      : ([] as YearlyPL[]);

    const allKrs: BridgeKR[] = [];
    projectKrsMap.forEach((krs) => {
      allKrs.push(...krs);
    });

    const yearlyAll = {
      low: baseTraj ? calcYearlyFromKrs({ baseTraj, baseFigures, krs: allKrs, scenario: scenarios.low }) : [],
      base: baseTraj ? calcYearlyFromKrs({ baseTraj, baseFigures, krs: allKrs, scenario: scenarios.base }) : [],
      high: baseTraj ? calcYearlyFromKrs({ baseTraj, baseFigures, krs: allKrs, scenario: scenarios.high }) : [],
    };

    return {
      ready: isReady,
      companyName,
      error: isReady ? undefined : 'データ準備中...',
      deptNames: Array.from(deptNameSet).sort(),
      approved,
      projectKrsMap,
      baselineYearly,
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

  const northStarRows = useMemo(() => {
    return buildNorthStarRows({
      companyTargets,
      yearlyAll: core.yearlyAll,
      scenarioKey,
      projectContrib,
    });
  }, [companyTargets, core.yearlyAll, scenarioKey, projectContrib]);

  const issueResolutions = useMemo(() => {
    return buildIssueResolutions({
      stage1Issues,
      companyTargets,
      northStarRows,
    });
  }, [stage1Issues, companyTargets, northStarRows]);

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

  // ===== Chart data =====
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

    return years.map((year) => ({
      year,
      baselineRevenue: mb.get(year)?.revenue ?? 0,
      allRevenue: ma.get(year)?.revenue ?? 0,
      selectedRevenue: ms.get(year)?.revenue ?? 0,
      baselineOp: mb.get(year)?.op_income ?? 0,
      allOp: ma.get(year)?.op_income ?? 0,
      selectedOp: ms.get(year)?.op_income ?? 0,
    }));
  }, [core.baselineYearly, core.yearlyAll]);

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
    projectContrib,
    northStarRows,
    issueResolutions,
    vaCards,
    indicatorSeries,
    chartData,
    // Supporting data
    financePL,
    companyTargets,
    stage1Issues,
    valueAnalysis,
  };
}
