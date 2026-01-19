// /app/stage6/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';

import { useStrategyStore } from '@/store/strategyStore';
import { useAccess } from '@/utils/access';
import { hardResetForCompanySwitch } from '@/utils/resetAll';
import { loadAndHydrate } from '@/utils/loader';
import { useAutoSave } from '@/hooks/useAutoSave';

import {
  buildBridgeDeltas,
  type Ym,
  type BridgeInput,
  type BridgeKR,
  type BaseFigures,
} from '@/utils/simulationBridge';
import {
  simulateMonthlyPL,
  aggregateYearly,
  type BaseTrajectory,
  type YearlyPL,
} from '@/utils/financeSimulation';
import type { Department, KRStructured } from '@/types/strategy';

/**
 * STAGE6：価値検証・財務シミュレーション（社員向け最小構成）
 *
 * 目的：
 * 1) 会社全体の「売上・営業利益」の将来推移を、Baseline + シナリオで可視化
 * 2) 企業価値に直結する最小指標（売上成長率・営業利益率）を推移で可視化
 * 3) Approved プロジェクトの寄与を「複数選択」で合算し、会社推移の中で位置づける
 *
 * 非表示（情報量を削減）：
 * - My Impact
 * - KR別寄与
 * - 感度Top5
 * - 前提・スナップショット
 * - ガバナンス
 *
 * 注意：
 * - 現状の財務モデルは「STAGE1 financePL をベースにした簡易推計」です。
 * - PJ寄与は「選択PJのKRのみON」した結果とBaselineの差分（概算）です。
 */

/* Recharts（既存プロジェクトで使用実績がある前提） */
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  Legend,
  CartesianGrid,
} from 'recharts';

/** DEBUG フラグ（console.log をガード） */
const DEBUG = process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1';

export default function Stage6Page() {
  const strategyState: any = useStrategyStore();

  const {
    companyId: scopeCompanyId,
    hydrated,
    setCompanyScope,
    refetchFromServer,
    setHydrated,
  } = useStrategyStore();

  const access = useAccess();
  const accessCompanyId: string | undefined = useMemo(
    () =>
      ((access as any)?.companyId ??
        (strategyState?.companyId as string | undefined)) as string | undefined,
    [(access as any)?.companyId, strategyState?.companyId],
  );

  /* -------- 会社スコープ確立（cascade と同じパターン） -------- */
  const lastAppliedCompanyRef = useRef<string | null>(null);
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

  /* -------- 初期ロード（Dirty 回避付き） -------- */
  const loadGuardRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accessCompanyId) return;
    if (!scopeCompanyId) setCompanyScope(accessCompanyId);
    if (
      loadGuardRef.current === accessCompanyId &&
      hydrated &&
      scopeCompanyId === accessCompanyId
    )
      return;

    let cancelled = false;
    const run = async () => {
      if (hydrated && scopeCompanyId === accessCompanyId) {
        loadGuardRef.current = accessCompanyId;
        return;
      }

      // ハング回避：7秒で強制的に hydrated=true（UI待ちを解消）
      const timer = setTimeout(() => {
        if (!cancelled) {
          console.warn('[STAGE6] 7秒タイムアウト：hydrated=true を強制設定');
          setHydrated?.(true);
        }
      }, 7000);

      try {
        // ★ DEBUG：loadAndHydrate 前のログ
        const storeBefore = useStrategyStore.getState();
        if (DEBUG)
          console.log('[STAGE6] 📥 loadAndHydrate 前', {
            accessCompanyId,
            loadGuardRef_current: loadGuardRef.current,
            hydrated,
            revision: storeBefore.revision,
            issueBlocks_length: Array.isArray(storeBefore.stage1Issues)
              ? storeBefore.stage1Issues.length
              : 0,
            csvFinanceData_BS_length: Array.isArray(
              (storeBefore.csvFinanceData as any)?.financeBS,
            )
              ? (storeBefore.csvFinanceData as any).financeBS.length
              : 0,
            segmentPL_keys: Object.keys((storeBefore as any).segmentPL || {})
              .length,
            executionPlanBaseline_exists: !!storeBefore.executionPlanBaseline,
            executionPlanBaseline_snapshot: !!storeBefore.executionPlanBaseline
              ?.snapshot,
          });

        await loadAndHydrate(accessCompanyId);

        // ★ DEBUG：loadAndHydrate 後のログ
        const storeAfter = useStrategyStore.getState();
        if (DEBUG)
          console.log('[STAGE6] ✅ loadAndHydrate 後', {
            hydrated: storeAfter.hydrated,
            loaded: storeAfter.loaded,
            boot_isHydrating: (storeAfter.boot as any)?.isHydrating,
            revision: storeAfter.revision,
            issueBlocks_length: Array.isArray(storeAfter.stage1Issues)
              ? storeAfter.stage1Issues.length
              : 0,
            csvFinanceData_BS_length: Array.isArray(
              (storeAfter.csvFinanceData as any)?.financeBS,
            )
              ? (storeAfter.csvFinanceData as any).financeBS.length
              : 0,
            segmentPL_keys: Object.keys((storeAfter as any).segmentPL || {})
              .length,
            executionPlanBaseline_exists: !!storeAfter.executionPlanBaseline,
            executionPlanBaseline_snapshot: !!storeAfter.executionPlanBaseline
              ?.snapshot,
          });

        try {
          await refetchFromServer?.();
        } catch {
          // ignore
        }
        setHydrated?.(true);
        loadGuardRef.current = accessCompanyId;
      } catch (err) {
        // loadAndHydrate が throw しても UI を固めない
        const errObj = err as any;
        console.error('[STAGE6] ❌ loadAndHydrate error', {
          message: errObj?.message || String(err),
          code: errObj?.code,
          details: errObj?.details,
          stack: errObj?.stack?.split('\n')[0],
        });
        console.warn('[STAGE6] hydrated=true を強制設定（エラー時UI表示対応）');
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
    setCompanyScope,
  ]);

  /* -------- 自動保存（現行踏襲） -------- */
  const mismatch = !!(
    accessCompanyId &&
    scopeCompanyId &&
    scopeCompanyId !== accessCompanyId
  );

  const isHydrating =
    ((Boolean((strategyState.boot as any)?.isHydrating) && !hydrated) ||
      mismatch ||
      !hydrated) ??
    false;

  const departments = useStrategyStore(
    (st) => ((st.departments as Department[] | undefined) ?? []) as Department[],
  );
  useAutoSave(!isHydrating ? [accessCompanyId, departments] : []);

  /* -------- UI State -------- */
  const [scenarioKey, setScenarioKey] = useState<'low' | 'base' | 'high'>(
    'base',
  );

  const [deptFilter, setDeptFilter] = useState<string>('all');

  // 複数選択
  const [selectedProjectKeys, setSelectedProjectKeys] = useState<string[]>([]);

  /* =========================================================
   * ① データ抽出（Approved PJ / KR集約 / baseline / 全体シナリオ）
   * ======================================================= */

  const core = useMemo(() => {
    if (!hydrated || isHydrating || !strategyState) {
      return {
        ready: false,
        companyName: '会社名未設定',
        error: 'データ読込中...',
        deptNames: [] as string[],
        approved: [] as ApprovedProject[],
        projectKrsMap: new Map<string, BridgeKR[]>(),
        baselineYearly: [] as YearlyPL[],
        yearlyAll: { low: [], base: [], high: [] } as Record<
          'low' | 'base' | 'high',
          YearlyPL[]
        >,
      };
    }

    const companyName = strategyState?.companyName ?? '会社名未設定';
    const depts = Array.isArray(strategyState?.departments)
      ? strategyState.departments
      : [];

    // Approved PJと、PJ→KR を作る
    const approved: ApprovedProject[] = [];
    const projectKrsMap = new Map<string, BridgeKR[]>();
    const deptNameSet = new Set<string>();

    depts.forEach((d: any) => {
      const deptName = d?.name ?? d?.departmentName ?? '（未名）';
      deptNameSet.add(deptName);

      const projects = Array.isArray(d?.projects) ? d.projects : [];
      projects.forEach((p: any, pIndex: number) => {
        const planStatus = p?.planStatus ?? 'draft';
        if (planStatus !== 'approved') return;

        const projTitle = p?.title ?? '（未名）';
        const projKey = makeProjectKey(deptName, projTitle, pIndex);

        const krs: BridgeKR[] = [];

        const okrsV2 = Array.isArray(p?.okrsV2) ? p.okrsV2 : [];
        okrsV2.forEach((kr: KRStructured, krIndex: number) => {
          if (!kr || !(kr as any).kind) return;

          krs.push({
            id:
              (kr as any).id ??
              `kr-${projKey}-${krIndex}-${Math.random().toString(36).slice(2)}`,
            kind: (kr as any).kind,
            label: (kr as any).label ?? '（ラベル未設定）',
            target: (kr as any).target ?? 0,
            unit: (kr as any).unit,
            scope: (kr as any).scope ?? 'company',
            baseKey: (kr as any).baseKey ?? 'revenue',
            baseOverride: (kr as any).baseOverride,
            weight: (kr as any).weight,
            elasticity: (kr as any).elasticity,
            lagMonths: (kr as any).lagMonths,
            startYm: (kr as any).startYm as Ym | undefined,
            due: (kr as any).due,
            notes: (kr as any).notes,
          } as BridgeKR);
        });

        // 投資（skillPlans + executionHumanInvestments）を INVEST として追加
        const skillPlans = Array.isArray(p?.skillPlans) ? p.skillPlans : [];
        const investments = Array.isArray(p?.executionHumanInvestments)
          ? p.executionHumanInvestments
          : [];

        const investTotal =
          skillPlans.reduce((s: number, sk: any) => s + (sk?.cost ?? 0), 0) +
          investments.reduce((s: number, inv: any) => s + (inv?.amount ?? 0), 0);

        if (investTotal > 0) {
          krs.push({
            id: `invest-${projKey}-${Math.random().toString(36).slice(2)}`,
            kind: 'INVEST' as any,
            label: `${projTitle}: 投資計画`,
            target: investTotal,
            unit: '¥',
            scope: 'project' as any,
            baseKey: 'invest' as any,
          } as BridgeKR);
        }

        projectKrsMap.set(projKey, krs);

        approved.push({
          key: projKey,
          dept: deptName,
          proj: projTitle,
          krCount: okrsV2.length,
          investTotal,
        });
      });
    });

    // ベースライン
    const baseTraj = mkBaselineTrajectory(strategyState);
    if (!baseTraj) {
      return {
        ready: false,
        companyName,
        error: 'ベースラインが未設定です。STAGE1の財務データを入力してください。',
        deptNames: Array.from(deptNameSet).sort(),
        approved,
        projectKrsMap,
        baselineYearly: [],
        yearlyAll: { low: [], base: [], high: [] },
      };
    }

    const baseFigures = mkBaseFigures(strategyState);

    // Baseline（影響なし）
    const baselineYearly = calcYearlyFromKrs({
      baseTraj,
      baseFigures,
      krs: [],
      scenario: { successRate: 1, synergyRate: 0 },
    });

    // 全PJ合算（会社全体のシナリオ）
    const allKrs: BridgeKR[] = [];
    projectKrsMap.forEach((arr) => arr.forEach((x) => allKrs.push(x)));

    const scenarios = {
      low: { successRate: 0.5, synergyRate: -0.05 },
      base: { successRate: 0.8, synergyRate: 0.0 },
      high: { successRate: 1.0, synergyRate: 0.1 },
    };

    const yearlyAll = {
      low: calcYearlyFromKrs({
        baseTraj,
        baseFigures,
        krs: allKrs,
        scenario: scenarios.low,
      }),
      base: calcYearlyFromKrs({
        baseTraj,
        baseFigures,
        krs: allKrs,
        scenario: scenarios.base,
      }),
      high: calcYearlyFromKrs({
        baseTraj,
        baseFigures,
        krs: allKrs,
        scenario: scenarios.high,
      }),
    };

    return {
      ready: true,
      companyName,
      error: null as string | null,
      deptNames: Array.from(deptNameSet).sort(),
      approved,
      projectKrsMap,
      baselineYearly,
      yearlyAll,
    };
  }, [hydrated, isHydrating, strategyState]);

  // 初期：Approvedがあるなら「全選択」にする
  useEffect(() => {
    if (!core.ready) return;
    if (selectedProjectKeys.length > 0) return;
    if (core.approved.length === 0) return;
    setSelectedProjectKeys(core.approved.map((a) => a.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core.ready, core.approved]);

  /* =========================================================
   * ② PJ複数選択の合算（選択PJだけONした推移）
   * ======================================================= */

  const selectedYearly = useMemo(() => {
    if (!core.ready) {
      return { low: [], base: [], high: [] } as Record<
        'low' | 'base' | 'high',
        YearlyPL[]
      >;
    }

    const baseTraj = mkBaselineTrajectory(strategyState);
    if (!baseTraj) {
      return { low: [], base: [], high: [] };
    }
    const baseFigures = mkBaseFigures(strategyState);

    const selectedSet = new Set(selectedProjectKeys);

    const krs: BridgeKR[] = [];
    core.projectKrsMap.forEach((arr, key) => {
      if (!selectedSet.has(key)) return;
      arr.forEach((x) => krs.push(x));
    });

    const scenarios = {
      low: { successRate: 0.5, synergyRate: -0.05 },
      base: { successRate: 0.8, synergyRate: 0.0 },
      high: { successRate: 1.0, synergyRate: 0.1 },
    };

    return {
      low: calcYearlyFromKrs({
        baseTraj,
        baseFigures,
        krs,
        scenario: scenarios.low,
      }),
      base: calcYearlyFromKrs({
        baseTraj,
        baseFigures,
        krs,
        scenario: scenarios.base,
      }),
      high: calcYearlyFromKrs({
        baseTraj,
        baseFigures,
        krs,
        scenario: scenarios.high,
      }),
    };
  }, [core.ready, core.projectKrsMap, selectedProjectKeys, strategyState]);

  /* =========================================================
   * ③ PJ別寄与（単独ON差分）
   * ======================================================= */

  const projectContrib = useMemo(() => {
    if (!core.ready) return [] as ProjectContribution[];

    const baseTraj = mkBaselineTrajectory(strategyState);
    if (!baseTraj) return [];
    const baseFigures = mkBaseFigures(strategyState);

    const baseline = core.baselineYearly;
    const baseScenario = { successRate: 0.8, synergyRate: 0.0 };

    return core.approved.map((p) => {
      const krs = core.projectKrsMap.get(p.key) ?? [];
      const yearly = calcYearlyFromKrs({
        baseTraj,
        baseFigures,
        krs,
        scenario: baseScenario,
      });

      const delta = diffYearly(baseline, yearly);

      const deltaRevenueTotal = sumYearly(delta, 'revenue');
      const deltaOpTotal = sumYearly(delta, 'op_income');
      const roi = p.investTotal > 0 ? deltaOpTotal / p.investTotal : undefined;

      return {
        key: p.key,
        dept: p.dept,
        proj: p.proj,
        investTotal: p.investTotal,
        krCount: p.krCount,
        deltaRevenueTotal,
        deltaOpTotal,
        roi,
      };
    });
  }, [
    core.ready,
    core.approved,
    core.projectKrsMap,
    core.baselineYearly,
    strategyState,
  ]);

  /* =========================================================
   * ④ 指標（売上成長率・営業利益率）
   * ======================================================= */

  const indicatorSeries = useMemo(() => {
    const baseline = core.baselineYearly ?? [];
    const all = core.yearlyAll?.[scenarioKey] ?? [];
    const selected = selectedYearly?.[scenarioKey] ?? [];

    return buildIndicators({
      baseline,
      all,
      selected,
    });
  }, [core.baselineYearly, core.yearlyAll, scenarioKey, selectedYearly]);

  /* =========================================================
   * ⑤ グラフ用データ
   * ======================================================= */

  const chartData = useMemo(() => {
    const baseline = core.baselineYearly ?? [];
    const all = core.yearlyAll?.[scenarioKey] ?? [];
    const selected = selectedYearly?.[scenarioKey] ?? [];

    const byYear = new Map<number, any>();

    baseline.forEach((y) => {
      byYear.set(y.year, {
        year: y.year,
        baselineRevenue: y.revenue ?? 0,
        baselineOp: y.op_income ?? 0,
      });
    });

    all.forEach((y) => {
      const cur = byYear.get(y.year) ?? { year: y.year };
      cur.allRevenue = y.revenue ?? 0;
      cur.allOp = y.op_income ?? 0;
      byYear.set(y.year, cur);
    });

    selected.forEach((y) => {
      const cur = byYear.get(y.year) ?? { year: y.year };
      cur.selectedRevenue = y.revenue ?? 0;
      cur.selectedOp = y.op_income ?? 0;
      byYear.set(y.year, cur);
    });

    return Array.from(byYear.values()).sort((a, b) => a.year - b.year);
  }, [core.baselineYearly, core.yearlyAll, scenarioKey, selectedYearly]);

  /* =========================================================
   * UI helpers
   * ======================================================= */

  const companyName = core.companyName;

  const approvedFiltered = useMemo(() => {
    if (!core.ready) return [] as ApprovedProject[];

    if (deptFilter === 'all') return core.approved;
    return core.approved.filter((p) => p.dept === deptFilter);
  }, [core.ready, core.approved, deptFilter]);

  const selectedSet = useMemo(
    () => new Set(selectedProjectKeys),
    [selectedProjectKeys],
  );

  const selectedSummary = useMemo(() => {
    const baseline = core.baselineYearly ?? [];
    const sel = selectedYearly?.base ?? [];
    const delta = diffYearly(baseline, sel);
    const deltaRev = sumYearly(delta, 'revenue');
    const deltaOp = sumYearly(delta, 'op_income');

    const invest = core.approved
      .filter((p) => selectedSet.has(p.key))
      .reduce((s, p) => s + (p.investTotal ?? 0), 0);

    return { deltaRev, deltaOp, invest };
  }, [core.baselineYearly, selectedYearly, core.approved, selectedSet]);

  const toggleProject = (key: string) => {
    setSelectedProjectKeys((prev) => {
      const set = new Set(prev);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return Array.from(set);
    });
  };

  const selectAllFiltered = () => {
    setSelectedProjectKeys((prev) => {
      const set = new Set(prev);
      approvedFiltered.forEach((p) => set.add(p.key));
      return Array.from(set);
    });
  };

  const clearAllFiltered = () => {
    setSelectedProjectKeys((prev) => {
      const set = new Set(prev);
      approvedFiltered.forEach((p) => set.delete(p.key));
      return Array.from(set);
    });
  };

  /* =========================================================
   * ✅ ALL HOOKS MUST BE DEFINED HERE
   * ======================================================= */

  const diagnostics = useMemo(() => {
    const financeSummaryCount = Array.isArray(strategyState?.financeSummary)
      ? strategyState.financeSummary.length
      : 0;
    const departmentCount = Array.isArray(strategyState?.departments)
      ? strategyState.departments.length
      : 0;

    let projectTotal = 0;
    let okrTotal = 0;
    let structuredKrTotal = 0;

    if (Array.isArray(strategyState?.departments)) {
      strategyState.departments.forEach((dept: any) => {
        const projects = Array.isArray(dept?.projects) ? dept.projects : [];
        projectTotal += projects.length;

        projects.forEach((p: any) => {
          const okrsV2 = Array.isArray(p?.okrsV2) ? p.okrsV2 : [];
          okrTotal += okrsV2.length;

          okrsV2.forEach((kr: any) => {
            if (kr && kr.kind && kr.baseKey && typeof kr.target === 'number') {
              structuredKrTotal += 1;
            }
          });
        });
      });
    }

    const financePLCount = Array.isArray(strategyState?.financePL)
      ? strategyState.financePL.length
      : 0;
    const hasPL = financePLCount > 0;

    return {
      financeSummaryCount,
      departmentCount,
      projectTotal,
      okrTotal,
      structuredKrTotal,
      financePLCount,
      hasPL,
    };
  }, [strategyState]);

  /* =========================================================
   * CONDITIONAL RENDERING
   * ======================================================= */

  if (!accessCompanyId) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-900">
        <div className="mx-auto max-w-7xl px-4 pb-12 pt-8 md:px-6 md:pt-10">
          <p className="mt-4 text-sm text-slate-600">
            会社情報が取得できていません。左メニューから会社を選択してください。
          </p>
        </div>
      </main>
    );
  }

  if (isHydrating) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-900">
        <div className="mx-auto max-w-7xl px-4 pb-12 pt-8 md:px-6 md:pt-10">
          <div className="rounded-lg border border-slate-200 bg-slate-100 p-6">
            <p className="text-sm text-slate-600">データを読み込んでいます...</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 pb-12 pt-8 md:px-6 md:pt-10">
        {/* 診断パネル（開発用） */}
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="mb-3 text-xs font-semibold text-blue-900">
            📊 データロード状態（開発用診断）
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
            <div className="rounded bg-white px-2 py-1">
              <div className="font-medium text-blue-600">financeSummary</div>
              <div className="font-bold text-blue-900">
                {diagnostics.financeSummaryCount}
              </div>
            </div>
            <div className="rounded bg-white px-2 py-1">
              <div className="font-medium text-blue-600">部門</div>
              <div className="font-bold text-blue-900">
                {diagnostics.departmentCount}
              </div>
            </div>
            <div className="rounded bg-white px-2 py-1">
              <div className="font-medium text-blue-600">プロジェクト</div>
              <div className="font-bold text-blue-900">
                {diagnostics.projectTotal}
              </div>
            </div>
            <div className="rounded bg-white px-2 py-1">
              <div className="font-medium text-blue-600">OKR</div>
              <div className="font-bold text-blue-900">{diagnostics.okrTotal}</div>
            </div>
            <div className="rounded bg-white px-2 py-1">
              <div className="font-medium text-blue-600">構造化KR</div>
              <div className="font-bold text-blue-900">
                {diagnostics.structuredKrTotal}
              </div>
            </div>
            <div className="rounded bg-white px-2 py-1">
              <div className="font-medium text-blue-600">財務PL</div>
              <div
                className={`font-bold ${
                  diagnostics.hasPL ? 'text-green-700' : 'text-red-700'
                }`}
              >
                {diagnostics.financePLCount}
              </div>
            </div>
            <div className="rounded bg-white px-2 py-1">
              <div className="font-medium text-blue-600">Hydrated</div>
              <div
                className={`font-bold ${
                  hydrated ? 'text-green-700' : 'text-red-700'
                }`}
              >
                {hydrated ? 'Yes' : 'No'}
              </div>
            </div>
          </div>
          {!diagnostics.hasPL && (
            <div className="mt-2 rounded border-l-2 border-amber-400 bg-white px-2 py-1 text-xs text-blue-800">
              ⚠️ <strong>Warning:</strong> financePL がロードされていません。STAGE1で財務データを入力してください。フォールバックベースラインで表示を継続します。
            </div>
          )}
        </div>

        {/* ヘッダー */}
        <header className="mb-6">
          <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400">
            STAGE 6 / VALUE VALIDATION
          </p>
          <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                価値検証（会社の未来とプロジェクト寄与）
              </h1>
              <p className="mt-1 text-sm text-slate-600">{companyName}</p>
            </div>

            <div className="flex gap-2">
              {(['low', 'base', 'high'] as const).map((scen) => (
                <button
                  key={scen}
                  onClick={() => setScenarioKey(scen)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    scenarioKey === scen
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {scen === 'low' ? '悲観' : scen === 'base' ? '基準' : '楽観'}
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* エラー表示 */}
        {core.error && (
          <div className="mb-6 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700" />
            <div className="text-sm text-amber-800">{core.error}</div>
          </div>
        )}

        {/* A. 会社全体の推移（グラフ） */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-slate-900">
                会社全体の推移（売上・営業利益）
              </h2>
              <p className="mt-1 text-[12px] text-slate-600">
                Baseline（影響なし）／全プロジェクト（Approved合算）／選択プロジェクト（複数選択合算）
              </p>
            </div>

            {/* 売上 */}
            <div className="mb-6">
              <div className="mb-2 text-sm font-semibold text-slate-800">
                売上
              </div>
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="year" />
                    <YAxis tickFormatter={(v) => compactJPY(v)} />
                    <ReTooltip
                      formatter={(value: any, name: any) => [
                        fmtJPY(Number(value)),
                        name,
                      ]}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="baselineRevenue"
                      name="Baseline"
                      stroke="#64748b"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="allRevenue"
                      name="全プロジェクト（Approved合算）"
                      stroke="#0f172a"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="selectedRevenue"
                      name="選択プロジェクト（合算）"
                      stroke="#334155"
                      strokeWidth={2}
                      strokeDasharray="6 3"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 営業利益 */}
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-800">
                営業利益
              </div>
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="year" />
                    <YAxis tickFormatter={(v) => compactJPY(v)} />
                    <ReTooltip
                      formatter={(value: any, name: any) => [
                        fmtJPY(Number(value)),
                        name,
                      ]}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="baselineOp"
                      name="Baseline"
                      stroke="#64748b"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="allOp"
                      name="全プロジェクト（Approved合算）"
                      stroke="#0f172a"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="selectedOp"
                      name="選択プロジェクト（合算）"
                      stroke="#334155"
                      strokeWidth={2}
                      strokeDasharray="6 3"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="mt-3 text-[11px] text-slate-500">
              注：STAGE1の財務入力とKR/投資の前提に基づく簡易推計です。厳密な予算ではなく「因果の検証」を目的にします。
            </div>
          </section>

          {/* B. 企業価値に直結する最小指標（推移） */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-slate-900">
                企業価値につながる指標（最小セット）
              </h2>
              <p className="mt-1 text-[12px] text-slate-600">
                売上成長率（成長性）／営業利益率（収益性）
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {/* 売上成長率 */}
              <div>
                <div className="mb-2 text-sm font-semibold text-slate-800">
                  売上成長率（年次）
                </div>
                <div className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={indicatorSeries.growth}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="year" />
                      <YAxis tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                      <ReTooltip
                        formatter={(value: any, name: any) => [
                          `${(Number(value) * 100).toFixed(1)}%`,
                          name,
                        ]}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="baseline"
                        name="Baseline"
                        stroke="#64748b"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="all"
                        name="全プロジェクト"
                        stroke="#0f172a"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="selected"
                        name="選択プロジェクト"
                        stroke="#334155"
                        strokeWidth={2}
                        strokeDasharray="6 3"
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 営業利益率 */}
              <div>
                <div className="mb-2 text-sm font-semibold text-slate-800">
                  営業利益率（年次）
                </div>
                <div className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={indicatorSeries.margin}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="year" />
                      <YAxis tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                      <ReTooltip
                        formatter={(value: any, name: any) => [
                          `${(Number(value) * 100).toFixed(1)}%`,
                          name,
                        ]}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="baseline"
                        name="Baseline"
                        stroke="#64748b"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="all"
                        name="全プロジェクト"
                        stroke="#0f172a"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="selected"
                        name="選択プロジェクト"
                        stroke="#334155"
                        strokeWidth={2}
                        strokeDasharray="6 3"
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </section>

          {/* C. プロジェクト寄与（複数選択） */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  プロジェクト寄与（複数選択）
                </h2>
                <p className="mt-1 text-[12px] text-slate-600">
                  チェックしたプロジェクトだけを合算し、会社推移の中で位置づけます（基準シナリオで寄与一覧を表示）。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-600">部門</span>
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                >
                  <option value="all">全社（全部門）</option>
                  {core.deptNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>

                <button
                  onClick={selectAllFiltered}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
                >
                  表示中を全選択
                </button>
                <button
                  onClick={clearAllFiltered}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
                >
                  表示中を解除
                </button>
              </div>
            </div>

            {/* 選択サマリー */}
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-lg bg-slate-50 p-4">
                <div className="text-[12px] font-semibold text-slate-600">
                  選択PJ数
                </div>
                <div className="mt-1 text-lg font-bold text-slate-900">
                  {selectedProjectKeys.length} 件
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 p-4">
                <div className="text-[12px] font-semibold text-slate-600">
                  投資合計（選択PJ）
                </div>
                <div className="mt-1 text-lg font-bold text-slate-900">
                  {fmtJPY(selectedSummary.invest)}
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 p-4">
                <div className="text-[12px] font-semibold text-slate-600">
                  営業利益差分（概算 / Baseline比）
                </div>
                <div className="mt-1 text-lg font-bold text-slate-900">
                  {fmtJPY(selectedSummary.deltaOp)}
                </div>
                <div className="mt-1 text-[12px] text-slate-600">
                  売上差分：{fmtJPY(selectedSummary.deltaRev)}
                </div>
              </div>
            </div>

            {/* PJ一覧 */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">
                      選択
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">
                      部門
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">
                      プロジェクト
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">
                      投資合計
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">
                      売上差分（概算）
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">
                      営業利益差分（概算）
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">
                      ROI（概算）
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {projectContrib
                    .filter((p) => (deptFilter === 'all' ? true : p.dept === deptFilter))
                    .slice()
                    .sort((a, b) => Math.abs(b.deltaOpTotal) - Math.abs(a.deltaOpTotal))
                    .map((p) => {
                      const checked = selectedSet.has(p.key);
                      return (
                        <tr
                          key={p.key}
                          className="border-b border-slate-100 hover:bg-slate-50"
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleProject(p.key)}
                              className="h-4 w-4"
                            />
                          </td>
                          <td className="px-3 py-2 font-medium text-slate-900">
                            {p.dept}
                          </td>
                          <td className="px-3 py-2 text-slate-700">{p.proj}</td>
                          <td className="px-3 py-2 text-right text-slate-700">
                            {fmtJPY(p.investTotal)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700">
                            {fmtJPY(p.deltaRevenueTotal)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700">
                            {fmtJPY(p.deltaOpTotal)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700">
                            {Number.isFinite(p.roi as any)
                              ? `${((p.roi as number) * 100).toFixed(1)}%`
                              : '-'}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {core.approved.length === 0 && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                Approved のプロジェクトがありません（planStatus=approved のプロジェクトが対象です）。
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

/* =========================================================
 * Types
 * ======================================================= */

type ApprovedProject = {
  key: string;
  dept: string;
  proj: string;
  krCount: number;
  investTotal: number;
};

type ProjectContribution = {
  key: string;
  dept: string;
  proj: string;
  investTotal: number;
  krCount: number;
  deltaRevenueTotal: number;
  deltaOpTotal: number;
  roi?: number;
};

/* =========================================================
 * Utilities (format)
 * ======================================================= */

function fmtJPY(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return v.toLocaleString('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  });
}

function compactJPY(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return `${v.toFixed(0)}`;
}

/* =========================================================
 * Key / Baseline / BaseFigures
 * ======================================================= */

function makeProjectKey(dept: string, proj: string, idx: number) {
  return `${dept}::${proj}::${idx}`;
}

function mkBaseFigures(strategyState: any): BaseFigures {
  const latestPL = Array.isArray(strategyState?.financePL)
    ? strategyState.financePL[strategyState.financePL.length - 1]
    : null;

  return {
    revenue: latestPL?.revenue ?? 100000000,
    acq: Math.max(
      1000,
      (latestPL?.revenue ?? 100000000) / (latestPL?.cogs ?? 100000),
    ),
    arpu: Math.max(
      50000,
      (latestPL?.revenue ?? 100000000) /
        Math.max(
          1000,
          (latestPL?.revenue ?? 100000000) / (latestPL?.cogs ?? 100000),
        ),
    ),
    churn: 0.02,
    fixed_cost: (latestPL?.sga ?? 10000000) / 12,
    variable_cost: (latestPL?.cogs ?? 30000000) / 12,
    personnel_cost: (latestPL?.sga ?? 10000000) / 2 / 12,
    invest: 0,
    success_rate: 0.8,
    synergy: 0,
  };
}

/* =========================================================
 * Simulation helpers
 * ======================================================= */

function calcYearlyFromKrs(args: {
  baseTraj: BaseTrajectory;
  baseFigures: BaseFigures;
  krs: BridgeKR[];
  scenario: { successRate: number; synergyRate: number };
}): YearlyPL[] {
  const { baseTraj, baseFigures, krs, scenario } = args;

  const scenarioKrs = krs.map((kr) => ({
    ...kr,
    target:
      String((kr as any).kind ?? '') === 'SUCCESS_RATE'
        ? (Number(kr.target) || 0) * scenario.successRate
        : kr.target,
  }));

  if (scenario.synergyRate !== 0) {
    scenarioKrs.push({
      id: `synergy-${Math.random().toString(36).slice(2)}`,
      kind: 'SYNERGY' as any,
      label: `相乗効果（シナリオ）`,
      target: scenario.synergyRate,
      unit: '%',
      scope: 'company' as any,
      baseKey: 'synergy' as any,
    } as BridgeKR);
  }

  const bridgeInput: BridgeInput = {
    startYm: baseTraj.startYm,
    endYm: baseTraj.endYm,
    krs: scenarioKrs,
    base: baseFigures,
    config: {
      activityDefault: 'ACQ',
      activityRoute: { 訪問: 'ACQ', 新規: 'ACQ' },
    },
  };

  const deltas = buildBridgeDeltas(bridgeInput);
  const monthly = simulateMonthlyPL(baseTraj, deltas);
  return aggregateYearly(monthly);
}

function diffYearly(a: YearlyPL[], b: YearlyPL[]): YearlyPL[] {
  const mapA = new Map<number, YearlyPL>();
  a.forEach((x) => mapA.set(x.year, x));

  return b.map((x) => {
    const y = mapA.get(x.year);
    if (!y) return { ...x };

    const revenue = (x.revenue ?? 0) - (y.revenue ?? 0);
    const op_income = (x.op_income ?? 0) - (y.op_income ?? 0);
    const margin = revenue !== 0 ? op_income / revenue : 0;

    return { ...x, revenue, op_income, margin };
  });
}

function sumYearly(rows: YearlyPL[], key: 'revenue' | 'op_income'): number {
  return rows.reduce((s, r) => s + (Number((r as any)[key]) || 0), 0);
}

/* =========================================================
 * Indicators (growth/margin)
 * ======================================================= */

function buildIndicators(args: {
  baseline: YearlyPL[];
  all: YearlyPL[];
  selected: YearlyPL[];
}) {
  const { baseline, all, selected } = args;

  const years = Array.from(
    new Set<number>([
      ...baseline.map((x) => x.year),
      ...all.map((x) => x.year),
      ...selected.map((x) => x.year),
    ]),
  ).sort((a, b) => a - b);

  const map = (arr: YearlyPL[]) => {
    const m = new Map<number, YearlyPL>();
    arr.forEach((x) => m.set(x.year, x));
    return m;
  };

  const mb = map(baseline);
  const ma = map(all);
  const ms = map(selected);

  const growth = years.map((year, idx) => {
    const b = mb.get(year);
    const a = ma.get(year);
    const s = ms.get(year);

    const prevYear = years[idx - 1];
    const bPrev = prevYear ? mb.get(prevYear) : undefined;
    const aPrev = prevYear ? ma.get(prevYear) : undefined;
    const sPrev = prevYear ? ms.get(prevYear) : undefined;

    const g = (cur?: YearlyPL, prev?: YearlyPL) => {
      const cr = Number(cur?.revenue);
      const pr = Number(prev?.revenue);
      if (!Number.isFinite(cr) || !Number.isFinite(pr) || pr === 0) return 0;
      return cr / pr - 1;
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
}

/* =========================================================
 * Baseline builder（現行踏襲）
 * ======================================================= */

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function nextYm(y: Ym): Ym {
  const [Y, M] = y.split('-').map(Number);
  const nM = M === 12 ? 1 : M + 1;
  const nY = M === 12 ? Y + 1 : Y;
  return `${nY}-${pad(nM)}` as Ym;
}

function ymRange(startYm: Ym, endYm: Ym): Ym[] {
  const out: Ym[] = [];
  let cur = startYm;
  while (cur <= endYm) {
    out.push(cur);
    cur = nextYm(cur);
  }
  return out;
}

function mkBaselineTrajectory(strategyState: any): BaseTrajectory | null {
  const pls = Array.isArray(strategyState?.financePL) ? strategyState.financePL : [];
  if (pls.length === 0) {
    console.warn('[STAGE6] financePL is empty -> baseline missing', {
      financePLType: typeof strategyState?.financePL,
      hydrated: (strategyState as any)?.hydrated,
    });
    return null;
  }

  const latestPL = pls[pls.length - 1];
  const year = latestPL?.year ?? new Date().getFullYear();
  const startYm = `${year}-01` as Ym;
  const endYm = `${year + 3}-12` as Ym;

  const months = ymRange(startYm, endYm);
  const monthlyQty = Math.max(
    1000,
    (latestPL?.revenue ?? 100000000) / (latestPL?.cogs ?? 100000),
  );
  const monthlyArpu = Math.max(50000, (latestPL?.revenue ?? 100000000) / monthlyQty);

  const result: BaseTrajectory = {
    startYm,
    endYm,
    qtyMonthly: {},
    arpuMonthly: {},
    churnMonthly: {},
    fixedCostMonthly: {},
    variableCostMonthly: {},
    personnelCostMonthly: {},
  };

  months.forEach((ym) => {
    result.qtyMonthly[ym] = monthlyQty / 12;
    result.arpuMonthly[ym] = monthlyArpu;
    result.churnMonthly[ym] = 0.02;
    result.fixedCostMonthly[ym] = (latestPL?.sga ?? 10000000) / 12;
    result.variableCostMonthly[ym] = (latestPL?.cogs ?? 30000000) / 12;
    result.personnelCostMonthly[ym] = (latestPL?.sga ?? 10000000) / 2 / 12;
  });

  return result;
}
