'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useStrategyStore } from '@/store/strategyStore';
import { useStage6Data } from '@/components/stage6/hooks/useStage6Data';
import { safeGetSession } from '@/utils/supabase/client';

type ExecutionSummary = {
  totalOkrs: number;
  checkedOkrs7d: number;
  uncheckedOkrs7d: number;
  checkInRate: number | null;
  staleProjects: Array<{
    departmentId: string;
    departmentName: string;
    projectId: string;
    projectTitle: string;
    uncheckedOkrCount: number;
    lastCheckinAt: string | null;
  }>;
};

function formatOkuFromYen(n: number) {
  if (!Number.isFinite(n)) return '—';
  const oku = n / 100_000_000;
  return `${oku.toLocaleString('ja-JP', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}億円`;
}

function formatOkuFromMJPY(n: number) {
  if (!Number.isFinite(n)) return '—';
  const oku = n / 100;
  return `${oku.toLocaleString('ja-JP', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}億円`;
}

function formatRate(rate: number | null) {
  if (rate == null || !Number.isFinite(rate)) return '—';
  return `${Math.round(rate * 100)}%`;
}

const stageBtnClass =
  'inline-flex items-center rounded-xl border border-neutral-300 ' +
  'bg-white px-6 py-3 shadow-sm hover:bg-neutral-100 transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2';

function Stage6MetricRow({
  label,
  current,
  forecast,
  target,
  achievementRate,
}: {
  label: string;
  current: string;
  forecast: string;
  target: string;
  achievementRate: string;
}) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-neutral-200/60 dark:bg-neutral-950 dark:ring-neutral-800">
      <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">{label}</div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <div className="text-[11px] text-neutral-500">現状</div>
          <div className="mt-1 text-lg font-semibold text-neutral-900 dark:text-white">{current}</div>
        </div>
        <div>
          <div className="text-[11px] text-neutral-500">見込み</div>
          <div className="mt-1 text-lg font-semibold text-neutral-900 dark:text-white">{forecast}</div>
        </div>
        <div>
          <div className="text-[11px] text-neutral-500">目標</div>
          <div className="mt-1 text-lg font-semibold text-neutral-900 dark:text-white">{target}</div>
        </div>
        <div>
          <div className="text-[11px] text-neutral-500">達成率</div>
          <div className="mt-1 text-lg font-semibold text-neutral-900 dark:text-white">{achievementRate}</div>
        </div>
      </div>
    </div>
  );
}

export default function ExecutionPanel() {
  const strategy = useStrategyStore() as any;
  const s6 = useStage6Data('base') as any;

  const [summary, setSummary] = useState<ExecutionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        // session から Bearer token を取得
        const sessionRes = await safeGetSession();
        if (!sessionRes.ok || !sessionRes.data.session?.access_token) {
          setError('認証トークンが取得できません');
          setSummary(null);
          return;
        }

        // 新APIを呼び出し
        const apiRes = await fetch('/api/stage5/execution-summary', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${sessionRes.data.session.access_token}`,
          },
        });

        if (!apiRes.ok) {
          const errData = await apiRes.json().catch(() => ({}));
          setError(errData.error || `API error: ${apiRes.status}`);
          setSummary(null);
          return;
        }

        const data = await apiRes.json();
        if (data.ok && data.data) {
          setSummary(data.data);
        } else {
          setError(data.error || 'Failed to fetch execution summary');
          setSummary(null);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Failed to fetch data: ${msg}`);
        setSummary(null);
        console.error('[ExecutionPanel] error:', e);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  // 全社集計サマリーから直接取得（API ベース）
  const totalOkrs = summary?.totalOkrs ?? 0;
  const checkedOkrs7d = summary?.checkedOkrs7d ?? 0;
  const uncheckedOkrs7d = summary?.uncheckedOkrs7d ?? 0;
  const checkInRate = summary?.checkInRate ?? null;
  const staleProjectsList = summary?.staleProjects ?? [];

  const stage6Summary = useMemo(() => {
    const data = (s6?.chartData ?? []) as any[];
    const dashboardSummary = s6?.dashboardSummary as any;
    if (!Array.isArray(data) || data.length === 0) return null;

    const last = data[data.length - 1];
    const currentRevenueYen = Number(last?.baselineRevenue ?? 0);
    const forecastRevenueYen = Number(last?.allRevenue ?? 0);
    const currentOpYen = Number(last?.baselineOp ?? 0);
    const forecastOpYen = Number(last?.allOp ?? 0);

    const targetRevenueMJPY = Number(dashboardSummary?.revenue?.target ?? NaN);
    const targetOpMJPY = Number(dashboardSummary?.op?.target ?? NaN);

    const targetRevenueYen = Number.isFinite(targetRevenueMJPY) ? targetRevenueMJPY * 1_000_000 : forecastRevenueYen;
    const targetOpYen = Number.isFinite(targetOpMJPY) ? targetOpMJPY * 1_000_000 : forecastOpYen;

    const revenueAchievementRate = targetRevenueYen > 0 ? forecastRevenueYen / targetRevenueYen : null;
    const opAchievementRate = targetOpYen > 0 ? forecastOpYen / targetOpYen : null;

    return {
      year: last?.year,
      revenue: {
        current: formatOkuFromYen(currentRevenueYen),
        forecast: formatOkuFromYen(forecastRevenueYen),
        target: Number.isFinite(targetRevenueMJPY)
          ? formatOkuFromMJPY(targetRevenueMJPY)
          : formatOkuFromYen(targetRevenueYen),
        achievementRate: formatRate(revenueAchievementRate),
      },
      op: {
        current: formatOkuFromYen(currentOpYen),
        forecast: formatOkuFromYen(forecastOpYen),
        target: Number.isFinite(targetOpMJPY)
          ? formatOkuFromMJPY(targetOpMJPY)
          : formatOkuFromYen(targetOpYen),
        achievementRate: formatRate(opAchievementRate),
      },
    };
  }, [s6?.chartData, s6?.dashboardSummary]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-neutral-50 p-4 ring-1 ring-neutral-200/60 dark:bg-neutral-900/40 dark:ring-neutral-800">
        <div className="flex items-center gap-3">
          <Link href="/execution" className={stageBtnClass}>
            <span className="text-[15px] font-semibold text-neutral-900">STAGE5：実行計画支援</span>
          </Link>
          <div className="text-sm font-medium">実行状況（直近7日）</div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white p-3 ring-1 ring-neutral-200/60 dark:bg-neutral-950 dark:ring-neutral-800">
            <div className="text-xs text-neutral-500">チェックイン率</div>
            <div className="mt-1 text-2xl font-semibold">
              {checkInRate == null ? '—' : `${Math.round(checkInRate * 100)}%`}
            </div>
            <div className="mt-2 text-[11px] leading-5 text-neutral-500">
              直近7日で、進捗記録が1回以上入ったOKRの割合です。
            </div>
          </div>
          <div className="rounded-xl bg-white p-3 ring-1 ring-neutral-200/60 dark:bg-neutral-950 dark:ring-neutral-800">
            <div className="text-xs text-neutral-500">未チェックイン</div>
            <div className="mt-1 text-2xl font-semibold">
              {totalOkrs ? uncheckedOkrs7d : '—'}
            </div>
            <div className="mt-2 text-[11px] leading-5 text-neutral-500">
              直近7日で、進捗記録が入っていないOKR数です。
            </div>
          </div>
        </div>

       

        {totalOkrs ? (
          <div className="mt-4 rounded-xl bg-white p-3 ring-1 ring-neutral-200/60 dark:bg-neutral-950 dark:ring-neutral-800">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-neutral-700 dark:text-neutral-200">
                未チェックイン（要対応）
              </div>
              <Link
                href="/execution"
                className="text-xs font-medium text-neutral-600 underline-offset-4 hover:underline dark:text-neutral-300"
              >
                まとめて見る
              </Link>
            </div>

            <div className="mt-2 space-y-2">
              {loading ? (
                <div className="text-xs text-neutral-500">集計中…</div>
              ) : staleProjectsList.length === 0 ? (
                <div className="text-xs text-neutral-500">今週は未チェックインなし</div>
              ) : (
                staleProjectsList.map((proj) => (
                  <div
                    key={`${proj.departmentId}-${proj.projectId}`}
                    className="flex items-center justify-between gap-3 rounded-lg bg-neutral-50 px-2 py-2 dark:bg-neutral-900/40"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs text-neutral-500">{proj.departmentName}</div>
                      <div className="truncate text-sm font-medium text-neutral-900 dark:text-white">
                        {proj.projectTitle}
                      </div>
                      <div className="truncate text-[11px] text-neutral-500">
                        配下OKR {proj.uncheckedOkrCount} 件 / 直近7日で記録がありません
                      </div>
                    </div>
                    <Link
                      href="/execution"
                      className="shrink-0 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:opacity-90 dark:bg-white dark:text-neutral-900"
                    >
                      チェックイン
                    </Link>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl bg-neutral-50 p-4 ring-1 ring-neutral-200/60 dark:bg-neutral-900/40 dark:ring-neutral-800">
        <div className="flex items-center gap-3">
          <Link href="/stage6" className={stageBtnClass}>
            <span className="text-[15px] font-semibold text-neutral-900">STAGE6：業績シミュレーション</span>
          </Link>
          <div className="text-sm font-medium">売上・営業利益の要約</div>
        </div>

        <div className="mt-3 space-y-3">
          <Stage6MetricRow
            label="売上"
            current={stage6Summary?.revenue.current ?? '—'}
            forecast={stage6Summary?.revenue.forecast ?? '—'}
            target={stage6Summary?.revenue.target ?? '—'}
            achievementRate={stage6Summary?.revenue.achievementRate ?? '—'}
          />

          <Stage6MetricRow
            label="営業利益"
            current={stage6Summary?.op.current ?? '—'}
            forecast={stage6Summary?.op.forecast ?? '—'}
            target={stage6Summary?.op.target ?? '—'}
            achievementRate={stage6Summary?.op.achievementRate ?? '—'}
          />
        </div>
      </div>
    </div>
  );
}
