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
  buildNorthStarRowsPhaseE,
  buildIssueResolutionsPhaseE,
  normalizeValueToUnit,
} from '@/utils/stage6';
import { calcYearlyFromKrs } from '@/utils/stage6/compute';

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
  const companyName = useStrategyStore((s) => s.companyName ?? '会社名未設定');
  const departments = useStrategyStore((s) =>
    Array.isArray(s.departments) ? s.departments : (EMPTY_ARR as any),
  ) as Department[];
  const financePL = useStrategyStore((s) => (Array.isArray(s.financePL) ? s.financePL : (EMPTY_ARR as any)));
  const csvFinanceData = useStrategyStore((s) => s.csvFinanceData ?? (EMPTY_OBJ as any));
  const revision = useStrategyStore((s) => s.revision);
  const boot = useStrategyStore((s) => s.boot);
  const companyTargets = useStrategyStore((s) => (Array.isArray(s.companyTargets) ? s.companyTargets : (EMPTY_ARR as any)));
  const stage1Issues = useStrategyStore((s) => (Array.isArray(s.stage1Issues) ? s.stage1Issues : (EMPTY_ARR as any)));
  const valueAnalysis = useStrategyStore((s) => s.valueAnalysis);

  // === STAGE6 Phase E：プロジェクト→North Star / 論点リンク ===
  const projectTargetImpacts = useStrategyStore((s) =>
    Array.isArray(s.projectTargetImpacts) ? s.projectTargetImpacts : (EMPTY_ARR as any)
  );
  const projectIssueLinks = useStrategyStore((s) =>
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
      projectContrib,
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

    // Step 3: Phase E で上書き（ハイブリッド：impact がある行だけ）
    if (projectTargetImpacts.length > 0) {
      // ★Debug logging for Phase E calculation
      if (DEBUG) {
        console.log(`[E-3] Phase E 計算開始: projectTargetImpacts=${projectTargetImpacts.length}件`);
        const sampleImpacts = projectTargetImpacts.slice(0, 2);
        sampleImpacts.forEach((imp) => {
          const target = companyTargets.find((t) => t.id === imp.targetId);
          console.log(`  Impact: targetId=${imp.targetId}, delta=${imp.delta}, target.base=${target?.base}, target.unit=${target?.unit}`);
        });
      }

      const phaseERows = buildNorthStarRowsPhaseE({
        companyTargets,
        projectTargetImpacts,
        executionWeights: executionWeightsMap,
      });

      if (DEBUG) {
        console.log(`[E-3] Phase E 計算完了:`, phaseERows.slice(0, 2).map((r) => ({
          label: r.label,
          unit: r.unit,
          base: r.base,
          forecastValue: r.forecastValue,
          achievementRate: r.achievementRate,
        })));
      }

      const phaseEMap = new Map(phaseERows.map((r) => [r.targetId, r]));

      const hybridRows = syncedRows.map((row) => {
        const phaseERow = phaseEMap.get(row.targetId);
        if (phaseERow) {
          if (DEBUG) {
            console.log(`[E-3] ${row.label}: PhaseE上書き (forecast ${row.forecastValue} → ${phaseERow.forecastValue}, achievement ${row.achievementRate}% → ${phaseERow.achievementRate}%)`);
          }
          return phaseERow;
        }
        return row;
      });

      if (DEBUG) {
        console.log(`[E-3] Hybrid: ${hybridRows.length}行中${phaseERows.length}行がPhaseEで上書き`);
      }

      return hybridRows;
    }

    return syncedRows;
  }, [companyTargets, core.yearlyAll, scenarioKey, projectContrib, chartData, projectTargetImpacts, executionWeightsMap]);

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
    if (projectTargetImpacts.length === 0 || northStarRows.length === 0) {
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

    if (revRow && revRow.forecastValue !== undefined && revRow.base !== undefined) {
      // revRow.forecastValue は target.unit（例：百万円）
      // revRow.base も同じ unit
      // delta = forecastValue - base（同じ単位）
      const revDeltaDisplay = revRow.forecastValue - revRow.base;
      // yen に変換
      revDeltaYen = normalizeValueToUnit(revDeltaDisplay, revRow.unit, 'yen') ?? revDeltaDisplay;

      if (DEBUG) {
        console.log(`[E-4] Revenue delta: forecastValue=${revRow.forecastValue}, base=${revRow.base}, unit=${revRow.unit}, deltaYen=${revDeltaYen}`);
      }
    }

    if (opRow && opRow.forecastValue !== undefined && opRow.base !== undefined) {
      const opDeltaDisplay = opRow.forecastValue - opRow.base;
      opDeltaYen = normalizeValueToUnit(opDeltaDisplay, opRow.unit, 'yen') ?? opDeltaDisplay;

      if (DEBUG) {
        console.log(`[E-4] OP delta: forecastValue=${opRow.forecastValue}, base=${opRow.base}, unit=${opRow.unit}, deltaYen=${opDeltaYen}`);
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
        allRevenue: (row.baselineRevenue ?? 0) + appliedRevDeltaYen / 1_000_000, // ★yen→百万円
        allOp: (row.baselineOp ?? 0) + appliedOpDeltaYen / 1_000_000,           // ★yen→百万円
      };
    });
  }, [northStarRows, chartData, projectTargetImpacts]);

  // === F-1: IssueResolution calculation with hybrid logic ===
  // If projectIssueLinks exist, use Phase E; otherwise use existing logic
  const issueResolutions = useMemo(() => {
    if (projectIssueLinks.length > 0) {
      // Phase E ロジックで計算
      const phaseEResolutions = buildIssueResolutionsPhaseE({
        stage1Issues,
        companyTargets,
        projectIssueLinks,
        executionWeights: executionWeightsMap,
      });

      if (DEBUG) {
        console.log(`[F-1] Phase E Issues: ${phaseEResolutions.length}件計算`);
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
  }, [projectIssueLinks, stage1Issues, companyTargets, executionWeightsMap, northStarRows]);

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
    projectContrib,
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
