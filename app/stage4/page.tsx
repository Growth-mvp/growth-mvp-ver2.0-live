// app/stage4/page.tsx
'use client';

// ★ 診断: 実行中のファイル確認
if (typeof window !== 'undefined') {
  console.log('OKR_REAL_FILE_LOADED', { timestamp: new Date().toISOString() });
}

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { hardResetForCompanySwitch } from '@/utils/resetAll';
import { loadAndHydrate } from '@/utils/loader';
import { AlertCircle } from 'lucide-react';
import StrategyGuard from '@/app/StrategyGuard';
import { StatusBadge, StatusSelect, type Status } from '@/components/stage4/StatusBadge';
import { DiffViewer } from '@/components/stage4/DiffViewer';
import { AlignmentPreview } from '@/components/stage4/AlignmentPreview';
import { ProjectEditor } from '@/components/stage4/ProjectEditor';
import type { Stage4Plan, Stage4Baseline, Stage4Current, Department, Project, HumanInvestment } from '@/types/strategy';

/* =========================
 * STAGE3データからbaselineを生成
 * ======================= */
function createBaselineFromStage3(dept: Department): Stage4Baseline {
  const projects = (dept.projects || []).map((p: Project) => ({
    title: p.title,
    kpiTargets: extractKpiTargets(p),
    skillRequirements: (p as { skillRequirements?: { roleSkills?: string[]; executionSkills?: string[] } }).skillRequirements,
    humanInvestments: (p as { humanInvestments?: HumanInvestment[] }).humanInvestments,
    valueDriverLinks: (p as { valueDriverLinks?: string[] }).valueDriverLinks,
  }));
  return { projects };
}

function extractKpiTargets(p: Project): Record<string, number> {
  // OKRのkey resultsからKPIターゲットを抽出（簡易実装）
  const targets: Record<string, number> = {};
  const okrs = p.okrs || [];
  okrs.forEach((okr, idx) => {
    if (okr.objective) {
      targets[`OKR${idx + 1}: ${okr.objective}`] = 100; // デフォルト値
    }
  });
  return targets;
}

/* =========================
 * メイン画面
 * ======================= */
export default function Stage4Page() {
  // Zustand selector で個別購読（副作用最小化）
  const loaded = useStrategyStore((s: StrategyState) => s.loaded);
  const hydrated = useStrategyStore((s: StrategyState) => s.hydrated);
  const departments = useStrategyStore((s: StrategyState) => s.departments);
  const stage4Plans = useStrategyStore((s: StrategyState) => s.stage4Plans);
  const setStage4Plans = useStrategyStore((s: StrategyState) => s.setStage4Plans);
  const saveStrategyData = useStrategyStore((s: StrategyState) => s.saveStrategyData);
  const valueDriverKPIs = useStrategyStore((s: StrategyState) => (s as any).valueDriverKPIs);
  const targetRanges = useStrategyStore((s: StrategyState) => (s as any).targetRanges);

  // userStore も selector 化
  const companyId = useUserStore((s) => s.companyId);
  const isAdmin = useUserStore((s) => s.isAdmin);
  const isManager = useUserStore((s) => s.isManager);
  const isMember = useUserStore((s) => s.isMember);

  // ★ STAGE4 は member も編集OK
  const canEdit = isAdmin || isManager || isMember;

  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [localPlans, setLocalPlans] = useState<Stage4Plan[]>([]);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // ★ UI表示のゲート（store.loaded に依存しない）
  const [initializedReady, setInitializedReady] = useState(false);

  // 初期化ガード（StrictMode二重実行対策）
  const initOnceRef = useRef<string | null>(null);
  const lastInitializedCompanyId = useRef<string | null>(null);

  // 初期化・ハイドレーション
  useEffect(() => {
    const init = async () => {
      // companyId 未確定時は待つ（ここでエラーにしない）
      if (!companyId) {
        console.log('[STAGE4] companyId 未確定のため初期化待機');
        setIsInitializing(false);
        setInitializedReady(false);
        return;
      }

      // 二重実行防止：同じ companyId で既に初期化中/完了している場合はスキップ
      if (initOnceRef.current === companyId) {
        console.log('[STAGE4] 初期化スキップ（既に実行済み）:', companyId);
        return;
      }

      console.log('[STAGE4] 初期化開始', { companyId });
      initOnceRef.current = companyId;

      setIsInitializing(true);
      setInitializedReady(false);
      setLoadError(null);

      // タイムアウト（15秒）
      const timeoutId = setTimeout(() => {
        console.warn('[STAGE4] タイムアウト：15秒経過。UIは表示し、エラーとして案内します');
        setIsInitializing(false);
        setInitializedReady(true); // UIは表示して操作可能にする
        setLoadError(
          '読み込みがタイムアウトしました。プロビジョニング再実行を試すか、管理画面のデータ管理から最新データを読み込んでください。'
        );
      }, 15000);

      try {
        // hardResetForCompanySwitch は会社IDが変わった時のみ実行
        if (lastInitializedCompanyId.current !== companyId) {
          console.log('[STAGE4] hardResetForCompanySwitch 実行（会社ID変更検知）', {
            from: lastInitializedCompanyId.current,
            to: companyId,
          });
          hardResetForCompanySwitch(companyId);
          lastInitializedCompanyId.current = companyId;
        } else {
          console.log('[STAGE4] hardResetForCompanySwitch スキップ（同一会社ID）');
        }

        console.log('[STAGE4] loadAndHydrate 実行前');
        await loadAndHydrate(companyId);
        console.log('[STAGE4] loadAndHydrate 完了', {
          hydrated: useStrategyStore.getState().hydrated,
          loaded: useStrategyStore.getState().loaded,
          companyId: useStrategyStore.getState().companyId,
          departments: useStrategyStore.getState().departments?.length ?? 0,
        });

        // ★ 重要：store.loaded を待たずにUIゲートを開ける
        setInitializedReady(true);
        clearTimeout(timeoutId);
      } catch (error) {
        clearTimeout(timeoutId);
        const err = error as Error;
        console.error('[STAGE4] 初期ロードエラー:', err);
        setLoadError(err.message || '初期化に失敗しました');
        // エラー時は再試行できるようにガードを解除
        initOnceRef.current = null;
        // UIは表示して、ユーザーが「再試行/最新取得」を押せるようにする
        setInitializedReady(true);
      } finally {
        console.log('[STAGE4] finally → isInitializing=false');
        setIsInitializing(false);
      }
    };

    init();
  }, [companyId]);

  // store から stage4Plans を取得
  useEffect(() => {
    if (stage4Plans) {
      // ★ restore-source ログ追加（PHASE 1 cleanup 検証用）
      const plansByDept = new Map<string, number>();
      for (const plan of stage4Plans) {
        plansByDept.set(
          plan.departmentId,
          (plansByDept.get(plan.departmentId) ?? 0) + 1
        );
      }

      console.log('[diag][stage4:restore-source]', {
        source: 'strategy_data.stage4Plans',
        totalPlans: stage4Plans.length,
        departmentCounts: Object.fromEntries(plansByDept),
        timestamp: new Date().toISOString(),
      });

      setLocalPlans(stage4Plans);
    }
  }, [stage4Plans]);

  // ★ stage4Plans と departments の整合性チェック（orphan 計画削除）
  // NOTE: orphan cleanup は restoreWithAudit.ts (lines 205-244) で既に処理されているため、
  // ここでは localPlans のみ cleanup し、store 反映は stage4Plans useEffect で自動処理
  useEffect(() => {
    if (!localPlans || !departments) return;

    const validDeptIds = new Set(
      departments.map((d: Department) => String(d.id || d.name))
    );

    const orphanPlans = localPlans.filter(
      (plan) => !validDeptIds.has(plan.departmentId)
    );

    if (orphanPlans.length > 0) {
      // orphan cleanup ログ（毎回出力は避ける）
      if (Math.random() < 0.3) {
        console.log('[diag][stage4:orphan-plans:cleanup]', {
          orphanCount: orphanPlans.length,
          orphanDeptIds: orphanPlans.map((p) => p.departmentId),
          validDeptIds: Array.from(validDeptIds),
        });
      }

      // ★ FIX: orphan 計画を削除（localPlans のみ、setStage4Plans は呼ばない）
      // setStage4Plans を呼ぶと autosave -> restore -> departments update -> effect re-trigger
      // というループが発生するため、localPlans のみ更新
      const cleanedPlans = localPlans.filter((plan) =>
        validDeptIds.has(plan.departmentId)
      );
      setLocalPlans(cleanedPlans);
      // setStage4Plans(cleanedPlans);  // ★ 削除：loop 防止
    }
  }, [departments, localPlans]);  // ★ FIX: setStage4Plans を dependency から削除

  // strategyStore の状態変化を監視（デバッグ用）
  useEffect(() => {
    console.log('[STAGE4] store state:', {
      hydrated,
      loaded,
      departments: departments?.length ?? 0,
      companyIdInStore: useStrategyStore.getState().companyId,
    });
  }, [hydrated, loaded, departments]);

  // ★ selection repair: selectedDeptId が orphan になっていないか確認
  useEffect(() => {
    if (!departments || departments.length === 0) {
      if (selectedDeptId !== null) {
        console.log('[diag][selection:repair]', {
          issue: 'departments_empty',
          oldSelectedDeptId: selectedDeptId,
          action: 'clearing_selection',
        });
        setSelectedDeptId(null);
      }
      return;
    }

    const validDeptIds = new Set(
      departments.map((d: Department) => String(d.id || d.name))
    );

    if (selectedDeptId && !validDeptIds.has(selectedDeptId)) {
      console.log('[diag][selection:repair]', {
        issue: 'orphan_selectedDeptId',
        oldSelectedDeptId: selectedDeptId,
        validDeptIds: Array.from(validDeptIds),
        action: 'selecting_first_valid_dept',
      });
      // 最初の有効な部門を選択
      const firstValidDeptId = String(
        (departments[0] as Department).id || (departments[0] as Department).name
      );
      setSelectedDeptId(firstValidDeptId);
    }
  }, [departments, selectedDeptId]);

  // 部門リスト
  const departmentsList = useMemo(() => departments || [], [departments]);

  // 選択中の部門
  const selectedDept = useMemo(
    () => departmentsList.find((d: Department) => (d.id || d.name) === selectedDeptId),
    [departmentsList, selectedDeptId]
  );

  // 選択中の部門のStage4Plan
  const selectedPlan = useMemo(
    () => localPlans.find((plan) => plan.departmentId === selectedDeptId),
    [localPlans, selectedDeptId]
  );

  // ★ 修正2: department 構成 hash を計算（STAGE3再生成検知用）
  // hash に含める項目：id, name, projectIds/titles, KPI count
  const deptHash = useMemo(() => {
    if (!selectedDept) return '';
    const hashObj = {
      id: selectedDept.id,
      name: selectedDept.name,
      projectCount: selectedDept.projects?.length ?? 0,
      projectTitles: selectedDept.projects?.map((p: Project) => p.title) ?? [],
      // KPI count（okrsV2 / okrs から count）
      kpiCount:
        (selectedDept.projects ?? []).reduce((sum: number, p: any) => {
          return (
            sum +
            ((p.okrsV2?.length ?? 0) + (p.okrs?.length ?? 0)) +
            (p.kpis?.length ?? 0)
          );
        }, 0),
    };
    // 簡易 hash（本番なら crypto.subtle.digest を使う）
    return JSON.stringify(hashObj);
  }, [selectedDept]);

  // baseline初期化（STAGE3データから生成）
  useEffect(() => {
    if (!selectedDept) return;

    const deptId = String(selectedDept.id || selectedDept.name);
    if (!deptId) return;

    const existingPlan = localPlans.find((p) => p.departmentId === deptId);

    // ★ 修正2: hash が変わった場合は baseline を再初期化（STAGE3再生成検知）
    if (existingPlan && existingPlan.deptHashAtCreation !== deptHash) {
      console.log('[diag][stage4:baseline:hash-mismatch]', {
        deptId,
        oldHash: existingPlan.deptHashAtCreation,
        newHash: deptHash,
        existingEdits: existingPlan.current.projects?.length ?? 0,
      });

      const newBaseline = createBaselineFromStage3(selectedDept);
      const updatedPlan: Stage4Plan = {
        ...existingPlan,
        baseline: newBaseline,
        current: JSON.parse(JSON.stringify(newBaseline)), // 編集をリセット
        deptHashAtCreation: deptHash, // hash を更新
        updatedAt: new Date().toISOString(),
      };

      setLocalPlans((prev) => {
        const next = prev.map((p) => (p.departmentId === deptId ? updatedPlan : p));
        setStage4Plans(next);
        return next;
      });
      return;
    }

    // すでに plan があるなら何もしない
    if (existingPlan) return;

    const baseline = createBaselineFromStage3(selectedDept);
    const newPlan: Stage4Plan = {
      departmentId: deptId,
      status: 'Draft',
      baseline,
      current: JSON.parse(JSON.stringify(baseline)), // deep copy
      deptHashAtCreation: deptHash, // ★ 新規作成時に hash を記録
      updatedAt: new Date().toISOString(),
    };

    // setState は関数形式で安全に（依存のループを避ける）
    setLocalPlans((prev) => {
      const next = [...prev, newPlan];
      setStage4Plans(next);
      return next;
    });
  }, [selectedDept, deptHash, localPlans, setStage4Plans]);

  // ステータス変更
  const updateStatus = useCallback(
    (deptId: string, newStatus: Status) => {
      setLocalPlans((prev) => {
        const updated = prev.map((plan) =>
          plan.departmentId === deptId ? { ...plan, status: newStatus, updatedAt: new Date().toISOString() } : plan
        );
        setStage4Plans(updated);
        return updated;
      });
    },
    [setStage4Plans]
  );

  // current編集
  const updateCurrent = useCallback(
    (deptId: string, newCurrent: Stage4Current) => {
      // ★ KPI削除時の詳細ログ
      const totalKpiCount = newCurrent.projects.reduce((sum, p) => sum + Object.keys((p as any).kpiTargets || {}).length, 0);
      console.log('[diag][stage4:kpi-delete:updateCurrent]', {
        deptId,
        projectCount: newCurrent.projects.length,
        totalKpiCount,
        projectTitles: newCurrent.projects.map(p => p.title),
      });

      setLocalPlans((prev) => {
        const updated = prev.map((plan) =>
          plan.departmentId === deptId ? { ...plan, current: newCurrent, updatedAt: new Date().toISOString() } : plan
        );
        console.log('[diag][stage4:kpi-delete:setStage4Plans]', {
          deptId,
          updatedPlanCount: updated.length,
          targetPlan: updated.find(p => p.departmentId === deptId),
        });
        setStage4Plans(updated);
        return updated;
      });
    },
    [setStage4Plans]
  );

  // provision 再実行
  const handleProvision = async () => {
    setLoadError(null);
    setIsInitializing(true);
    try {
      if (!companyId) {
        throw new Error('会社IDが見つかりません');
      }

      const res = await fetch('/api/companies/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'プロビジョニングに失敗しました' }));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      alert('プロビジョニングが完了しました。データを再読み込みします。');
      hardResetForCompanySwitch(companyId);
      await loadAndHydrate(companyId);

      // UI表示ゲートを開く（loaded に依存しない）
      setInitializedReady(true);
    } catch (error) {
      const err = error as Error;
      console.error('[STAGE4] provision エラー:', err);
      setLoadError(err.message || 'プロビジョニングに失敗しました');
      setInitializedReady(true);
    } finally {
      setIsInitializing(false);
    }
  };

  // 初回読み込み中：★ store.loaded/hydrated に依存しない
  if (isInitializing || !initializedReady) {
    console.log('[STAGE4] ローディング中:', {
      isInitializing,
      initializedReady,
      hydrated,
      loaded,
    });
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-4" />
          <p className="text-sm text-gray-600">STAGE4を読み込んでいます...</p>
          <p className="text-xs text-gray-500 mt-2">
            isInitializing: {String(isInitializing)} / initializedReady: {String(initializedReady)} / loaded:{' '}
            {String(loaded)} / hydrated: {String(hydrated)}
          </p>
        </div>
      </div>
    );
  }

  // 初回読み込みエラー（UIは出したまま、操作ボタンを提示）
  if (loadError) {
    return (
      <div className="p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">STAGE4: 実行計画策定</h1>
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-base font-medium text-red-900 mb-2">初期化エラー</h3>
                <p className="text-sm text-red-800">{loadError}</p>
                <p className="text-xs text-red-700 mt-2">
                  debug: loaded={String(loaded)} hydrated={String(hydrated)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => {
                  // init をやり直したいのでガード解除
                  initOnceRef.current = null;
                  setLoadError(null);
                  setInitializedReady(false);
                  setIsInitializing(true);
                }}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                再試行
              </button>
              <button
                onClick={handleProvision}
                className="px-4 py-2 text-sm border border-red-300 text-red-700 rounded-lg hover:bg-red-50"
              >
                プロビジョニング再実行
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 部門なし
  if (departmentsList.length === 0) {
    return (
      <div className="p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">STAGE4: 実行計画策定</h1>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
            STAGE3の部門・プロジェクトが見つかりません。先にSTAGE3を完了してください。
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={handleProvision}
              className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <AlertCircle className="w-4 h-4" />
              プロビジョニング再実行
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            debug: loaded={String(loaded)} hydrated={String(hydrated)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <StrategyGuard mode="view">
      <div className="p-8">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* ヘッダー */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">STAGE4: 実行計画策定</h1>
              <p className="text-sm text-gray-600 mt-1">現場が編集して初めてコミットが成立</p>
              <div className="flex items-center gap-2 mt-2">
                <p className="text-xs text-gray-500">※ 変更は自動保存されます</p>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                debug: loaded={String(loaded)} hydrated={String(hydrated)}
              </p>
            </div>
            <div className="shrink-0">
              <SaveStatusIndicator />
            </div>
          </div>

          {/* 衝突警告 */}
          {conflictError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-medium text-red-900">保存に失敗しました（REVISION_CONFLICT）</h3>
                <p className="text-sm text-red-800 mt-1">{conflictError}</p>
                <p className="text-xs text-red-700 mt-2">管理画面のデータ管理から最新データを読み込んでください。</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-12 gap-6">
            {/* 左サイドバー：部門一覧 */}
            <div className="col-span-3 space-y-2">
              <h2 className="text-sm font-medium text-gray-700 mb-3">部門一覧</h2>
              {departmentsList.map((dept: Department) => {
                const deptId = String(dept.id || dept.name);
                const plan = localPlans.find((p) => p.departmentId === deptId);
                const isSelected = deptId === selectedDeptId;

                return (
                  <button
                    key={deptId}
                    onClick={() => setSelectedDeptId(deptId)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      isSelected ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="font-medium text-sm text-gray-900">{dept.name}</div>
                    <div className="flex items-center gap-2 mt-2">
                      <StatusBadge status={plan?.status || 'Draft'} />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* 右メインエリア：選択中の部門 */}
            <div className="col-span-9 space-y-6">
              {!selectedPlan ? (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center text-gray-600">
                  左から部門を選択してください
                </div>
              ) : (
                <>
                  {/* ステータス切替 */}
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-gray-700">ステータス</h3>
                      <StatusSelect
                        value={selectedPlan.status}
                        onChange={(newStatus) => updateStatus(selectedPlan.departmentId, newStatus)}
                        disabled={!canEdit}
                      />
                    </div>
                  </div>

                  {/* 差分表示 */}
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h3 className="text-sm font-medium text-gray-700 mb-4">差分（STAGE3 → STAGE4編集後）</h3>
                    <DiffViewer baseline={selectedPlan.baseline} current={selectedPlan.current} />
                  </div>

                  {/* 整合プレビュー */}
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <AlignmentPreview
                      current={selectedPlan.current}
                      valueDriverKPIs={valueDriverKPIs}
                      targetRanges={targetRanges}
                    />
                  </div>

                  {/* プロジェクト編集 */}
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h3 className="text-sm font-medium text-gray-700 mb-4">プロジェクト編集</h3>
                    <ProjectEditor
                      current={selectedPlan.current}
                      onChange={(newCurrent) => updateCurrent(selectedPlan.departmentId, newCurrent)}
                      disabled={!canEdit}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </StrategyGuard>
  );
}