// /app/simulation/page.tsx
'use client';

import React, { useEffect } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { useAccess } from '@/utils/access';
import { hardResetForCompanySwitch } from '@/utils/resetAll';
import { loadAndHydrate } from '@/utils/loader';
import { useAutoSave } from '@/hooks/useAutoSave';
import SimulationDashboard from '@/components/simulation/SimulationDashboard';

/**
 * STAGE 6：業績シミュレーション（ページオーケストレーター）
 * - 会社スコープ / Hydration / AutoSave をここで面倒を見る
 * - 実際のUI・計算ロジックは SimulationDashboard に委譲
 */
export default function SimulationPage() {
  // Strategy 全体の state をそのままダッシュボードに渡す
  const strategyState: any = useStrategyStore();
  const { user } = useUserStore();

  // hydration・companyId まわりだけ別途参照
  const {
    companyId: scopeCompanyId,
    hydrated,
    setCompanyScope,
  } = useStrategyStore();

  const access = useAccess();
  const accessCompanyId: string | undefined =
    (access as any)?.companyId ??
    (useStrategyStore.getState().companyId as string | undefined);

  // 会社スコープ確立＆切替時の完全リセット
  useEffect(() => {
    if (!accessCompanyId) return;

    // すでに別会社で hydrate 済みなら、完全リセットしてから切り替え
    if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
      hardResetForCompanySwitch(accessCompanyId);
    } else {
      setCompanyScope(accessCompanyId);
    }
  }, [accessCompanyId, scopeCompanyId, setCompanyScope]);

  // 初期ロード（strategy_data / finance_summary などを Supabase から取得）
  useEffect(() => {
    if (!accessCompanyId) return;

    let cancelled = false;

    const run = async () => {
      // すでに正しい companyId で hydrate 済みなら何もしない
      if (hydrated && scopeCompanyId === accessCompanyId) return;

      try {
        await loadAndHydrate(accessCompanyId);
      } catch {
        // 失敗してもここでは握りつぶす（別途 UI 側でハンドリング）
      }
      if (cancelled) return;
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [accessCompanyId, hydrated, scopeCompanyId]);

  // AutoSave（companyId が変わったら再度監視）
  useAutoSave([scopeCompanyId]);

  const isHydrating = !hydrated || scopeCompanyId !== accessCompanyId;

  // company がまだ確定していない場合のガード
  if (!accessCompanyId) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-900">
        <div className="mx-auto max-w-6xl px-4 pb-12 pt-8 md:px-6 md:pt-10">
          <header className="mb-6 md:mb-8">
            <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400">
              STAGE 6 / SIMULATION
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
              業績シミュレーション
            </h1>
          </header>
          <p className="mt-4 text-sm text-slate-600">
            会社情報が取得できていません。左メニューから会社を選択するか、もう一度ログインし直してください。
          </p>
        </div>
      </main>
    );
  }

  // Hydration 中はダッシュボード本体は描画しない
  if (isHydrating) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-900">
        <div className="mx-auto max-w-6xl px-4 pb-12 pt-8 md:px-6 md:pt-10">
          <header className="mb-6 md:mb-8">
            <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400">
              STAGE 6 / SIMULATION
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
              業績シミュレーション
            </h1>
          </header>
          <p className="mt-4 text-sm text-slate-600">
            サーバーのデータを読み込み中です…
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-4 pb-12 pt-8 md:px-6 md:pt-10">
        <header className="mb-6 md:mb-8">
          <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400">
            STAGE 6 / SIMULATION
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
            業績シミュレーション
          </h1>
          <p className="mt-2 text-sm text-slate-600 md:text-[15px]">
            これまで入力してきた{' '}
            <span className="font-medium">戦略・ポートフォリオ・財務データ</span> と
            <span className="font-medium"> プロジェクト / OKR</span> をもとに、
            「やり切ったら、業績がどこまで伸びるか」を一目で確認できます。
          </p>
        </header>

        <SimulationDashboard
          strategy={strategyState}
          userId={user?.id}
          isHydrating={false}
        />
      </div>
    </main>
  );
}
