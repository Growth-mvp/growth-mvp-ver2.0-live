// /app/stage6/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { TrendingUp, AlertCircle, CheckCircle2 } from 'lucide-react';

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
 * STAGE6：価値検証・財務シミュレーション
 * - Approved のみを計算対象にしてシミュレーション
 * - STAGE1〜4 のデータから PL推移（Low/Base/High）を表示
 */
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
        if (!cancelled) setHydrated?.(true);
      }, 7000);

      try {
        await loadAndHydrate(accessCompanyId);
        try {
          await refetchFromServer?.();
        } catch {
          // ignore
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
    setCompanyScope,
  ]);

  /* -------- 自動保存 -------- */
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

  /* -------- Approved Projects 抽出＆シミュレーション -------- */
  const simData = useMemo(() => {
    if (!hydrated || isHydrating || !strategyState) {
      return {
        approved: [],
        yearlyResults: { low: [], base: [], high: [] },
        error: 'データ読込中...',
      };
    }

    const depts = Array.isArray(strategyState.departments)
      ? strategyState.departments
      : [];

    const approved: Array<{
      dept: string;
      proj: string;
      planStatus: string;
      krCount: number;
      investTotal: number;
    }> = [];

    depts.forEach((d: any) => {
      const deptName = d?.name ?? d?.departmentName ?? '（未名）';
      const projects = Array.isArray(d?.projects) ? d.projects : [];

      projects.forEach((p: any) => {
        const planStatus = p?.planStatus ?? 'draft';
        if (planStatus !== 'approved') return;

        const krs = Array.isArray(p?.okrsV2) ? p.okrsV2 : [];
        const skillPlans = Array.isArray(p?.skillPlans) ? p.skillPlans : [];
        const investments = Array.isArray(p?.executionHumanInvestments)
          ? p.executionHumanInvestments
          : [];

        const krCount = krs.length;
        const investTotal =
          investments.reduce((s: number, inv: any) => s + (inv?.amount ?? 0), 0) +
          skillPlans.reduce((s: number, sk: any) => s + (sk?.cost ?? 0), 0);

        approved.push({
          dept: deptName,
          proj: p?.title ?? '（未名）',
          planStatus,
          krCount,
          investTotal,
        });
      });
    });

    // ベースラインの生成（STAGE1 financePL から）
    const baseTraj = mkBaselineTrajectory(strategyState);
    if (!baseTraj) {
      return {
        approved,
        yearlyResults: { low: [], base: [], high: [] },
        error: 'ベースラインが未設定です。STAGE1の財務データを入力してください。',
      };
    }

    // Approved project から KR を集める
    const allBridgeKrs: BridgeKR[] = [];

    depts.forEach((d: any) => {
      const projects = Array.isArray(d?.projects) ? d.projects : [];
      projects.forEach((p: any) => {
        if (p?.planStatus !== 'approved') return;

        const krs = Array.isArray(p?.okrsV2) ? p.okrsV2 : [];
        krs.forEach((kr: KRStructured) => {
          if (!kr || !kr.kind) return;

          const bridgeKr: BridgeKR = {
            id: kr.id ?? `kr-${Math.random().toString(36).slice(2)}`,
            kind: kr.kind,
            label: kr.label ?? '（ラベル未設定）',
            target: kr.target ?? 0,
            unit: kr.unit,
            scope: kr.scope ?? 'company',
            baseKey: kr.baseKey ?? 'revenue',
            baseOverride: kr.baseOverride,
            weight: kr.weight,
            elasticity: kr.elasticity,
            lagMonths: kr.lagMonths,
            startYm: kr.startYm as Ym | undefined,
            due: kr.due,
            notes: kr.notes,
          };

          allBridgeKrs.push(bridgeKr);
        });

        // skillPlans / executionHumanInvestments を「投資」として BridgeKR に追加
        const skillPlans = Array.isArray(p?.skillPlans) ? p.skillPlans : [];
        const investments = Array.isArray(p?.executionHumanInvestments)
          ? p.executionHumanInvestments
          : [];

        const totalProjectInvest =
          skillPlans.reduce((s: number, sk: any) => s + (sk?.cost ?? 0), 0) +
          investments.reduce((s: number, inv: any) => s + (inv?.amount ?? 0), 0);

        if (totalProjectInvest > 0) {
          const investKr: BridgeKR = {
            id: `invest-${p?.title ?? 'unknown'}-${Math.random()
              .toString(36)
              .slice(2)}`,
            kind: 'INVEST',
            label: `${p?.title ?? '（プロジェクト）'}: 投資計画`,
            target: totalProjectInvest,
            unit: '¥',
            scope: 'project',
            baseKey: 'invest',
          };
          allBridgeKrs.push(investKr);
        }
      });
    });

    // BaseFigures を STAGE1 financePL から抽出
    const latestPL = Array.isArray(strategyState?.financePL)
      ? strategyState.financePL[strategyState.financePL.length - 1]
      : null;

    const baseFigures: BaseFigures = {
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
      personnel_cost: ((latestPL?.sga ?? 10000000) / 2) / 12,
      invest: 0,
      success_rate: 0.8,
      synergy: 0,
    };

    // 3シナリオ計算（buildBridgeDeltas ベース）
    const scenarios = {
      low: { successRate: 0.5, synergyRate: -0.05 },
      base: { successRate: 0.8, synergyRate: 0.0 },
      high: { successRate: 1.0, synergyRate: 0.1 },
    };

    const yearlyResults = {
      low: [] as YearlyPL[],
      base: [] as YearlyPL[],
      high: [] as YearlyPL[],
    };

    Object.entries(scenarios).forEach(([key, cfg]) => {
      const scenarioKrs = allBridgeKrs.map((kr) => ({
        ...kr,
        target: kr.kind === 'SUCCESS_RATE' ? kr.target * cfg.successRate : kr.target,
      }));

      if (cfg.synergyRate !== 0) {
        scenarioKrs.push({
          id: `synergy-${key}`,
          kind: 'SYNERGY' as const,
          label: `${key}シナリオ相乗効果`,
          target: cfg.synergyRate,
          unit: '%',
          scope: 'company' as const,
          baseKey: 'synergy' as const,
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
      const yearly = aggregateYearly(monthly);
      yearlyResults[key as keyof typeof yearlyResults] = yearly;
    });

    return { approved, yearlyResults, error: null as string | null };
  }, [hydrated, isHydrating, strategyState]);

  const companyName = strategyState?.companyName ?? '会社名未設定';

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
        {/* ヘッダー */}
        <header className="mb-8">
          <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400">
            STAGE 6 / VALUE VALIDATION
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            価値検証・財務シミュレーション
          </h1>
          <p className="mt-1 text-sm text-slate-600">{companyName}</p>
        </header>

        {/* エラー表示 */}
        {simData.error && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 flex gap-3">
            <AlertCircle className="h-5 w-5 text-amber-700 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">{simData.error}</div>
          </div>
        )}

        <div className="space-y-6">
          {/* 結果カード */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">PL推移（シナリオ別）</h2>
              <div className="flex gap-2">
                {(['low', 'base', 'high'] as const).map((scen) => (
                  <button
                    key={scen}
                    onClick={() => setScenarioKey(scen)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
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

            {/* 年次PL表 */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-2 text-left text-slate-700 font-semibold">年度</th>
                    <th className="px-4 py-2 text-right text-slate-700 font-semibold">売上</th>
                    <th className="px-4 py-2 text-right text-slate-700 font-semibold">営業利益</th>
                    <th className="px-4 py-2 text-right text-slate-700 font-semibold">利益率</th>
                  </tr>
                </thead>
                <tbody>
                  {simData.yearlyResults[scenarioKey].map((yr) => (
                    <tr key={yr.year} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2 text-slate-900 font-medium">{yr.year}</td>
                      <td className="px-4 py-2 text-right text-slate-700">{fmtJPY(yr.revenue)}</td>
                      <td className="px-4 py-2 text-right text-slate-700">{fmtJPY(yr.op_income)}</td>
                      <td className="px-4 py-2 text-right text-slate-700">
                        {(yr.margin * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 前提カード */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-bold text-slate-900">前提・スナップショット</h2>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-lg bg-slate-50 p-4">
                <div className="text-[12px] font-semibold text-slate-600">ベースラインステータス</div>
                <div className="mt-2 text-sm text-slate-900">
                  {strategyState?.financePL?.length ? '✓ 設定済み' : '✗ 未設定'}
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 p-4">
                <div className="text-[12px] font-semibold text-slate-600">投資合計</div>
                <div className="mt-2 text-sm text-slate-900">
                  {fmtJPY(simData.approved.reduce((s: number, a: any) => s + a.investTotal, 0))}
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 p-4">
                <div className="text-[12px] font-semibold text-slate-600">KR件数</div>
                <div className="mt-2 text-sm text-slate-900">
                  {simData.approved.reduce((s: number, a: any) => s + a.krCount, 0)} 件
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 p-4">
                <div className="text-[12px] font-semibold text-slate-600">対象プロジェクト</div>
                <div className="mt-2 text-sm text-slate-900">{simData.approved.length} 件</div>
              </div>

              <div className="rounded-lg bg-slate-50 p-4">
                <div className="text-[12px] font-semibold text-slate-600">Revision状態</div>
                <div className="mt-2 text-sm text-slate-900">確認中...</div>
              </div>

              <div className="rounded-lg bg-slate-50 p-4">
                <div className="text-[12px] font-semibold text-slate-600">更新日時</div>
                <div className="mt-2 text-[11px] text-slate-600">
                  {new Date().toLocaleDateString('ja-JP')}
                </div>
              </div>
            </div>
          </div>

          {/* 因果マップ枠（未実装） */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-bold text-slate-900">因果マップ</h2>
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <TrendingUp className="mx-auto h-8 w-8 text-slate-400 mb-2" />
              <p className="text-sm text-slate-600">勝ち筋 → 価値指標 → レバー</p>
              <p className="text-[11px] text-slate-500 mt-1">（次の反復で実装）</p>
            </div>
          </div>

          {/* 寄与分解枠（未実装） */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-bold text-slate-900">寄与分解</h2>
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-slate-400 mb-2" />
              <p className="text-sm text-slate-600">部門別 / プロジェクト別の寄与度（Top N）</p>
              <p className="text-[11px] text-slate-500 mt-1">（次の反復で実装）</p>
            </div>
          </div>

          {/* 検証枠（未実装） */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-bold text-slate-900">検証・感度分析</h2>
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <AlertCircle className="mx-auto h-8 w-8 text-slate-400 mb-2" />
              <p className="text-sm text-slate-600">感度 Top 5 / 反証ポイント</p>
              <p className="text-[11px] text-slate-500 mt-1">（次の反復で実装）</p>
            </div>
          </div>

          {/* ガバナンス枠（未実装） */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-bold text-slate-900">ガバナンス・バージョン管理</h2>
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <TrendingUp className="mx-auto h-8 w-8 text-slate-400 mb-2" />
              <p className="text-sm text-slate-600">Revision / 差分比較 / コメント</p>
              <p className="text-[11px] text-slate-500 mt-1">（次の反復で実装）</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

/* ========== ユーティリティ ========== */
function fmtJPY(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return v.toLocaleString('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  });
}

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

/**
 * STAGE1 の financePL から BaseTrajectory を生成
 * 最新年度をベースに 3年分を簡易推定（月次均等配分）
 */
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
  const monthlyArpu = Math.max(
    50000,
    (latestPL?.revenue ?? 100000000) / monthlyQty,
  );

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
