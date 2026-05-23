'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useStage6Data } from '@/components/stage6/hooks/useStage6Data';
import { safeGetSession } from '@/utils/supabase/client';

type ProjectUpdateItem = {
  departmentId: string;
  departmentName: string;
  projectId: string;
  projectTitle: string;
  okrId: string | null;
  latestUpdateAt: string;
  latestUpdateType:
    | 'progress'
    | 'comment'
    | 'rating'
    | 'advice'
    | 'request'
    | 'status'
    | 'update';
  latestSummary: string | null;
};

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
  recentProjectUpdates: ProjectUpdateItem[];
};

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

function formatUpdateType(type: ProjectUpdateItem['latestUpdateType']) {
  switch (type) {
    case 'progress':
      return '進捗更新';
    case 'comment':
      return 'コメント追加';
    case 'rating':
      return '評価更新';
    case 'advice':
      return 'アドバイス追加';
    case 'request':
      return '協力要請';
    case 'status':
      return '状態更新';
    default:
      return '更新あり';
  }
}

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '日時不明';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '日時不明';
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
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
  const s6 = useStage6Data('base') as any;

  const [summary, setSummary] = useState<ExecutionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedMap, setDismissedMap] = useState<Record<string, true>>({});

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('home:stage5:dismissed');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        setDismissedMap(parsed as Record<string, true>);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const sessionRes = await safeGetSession();
        if (!sessionRes.ok || !sessionRes.data.session?.access_token) {
          setError('認証トークンが取得できません');
          setSummary(null);
          return;
        }

        const apiRes = await fetch('/api/stage5/execution-summary', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${sessionRes.data.session.access_token}`,
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

  const recentProjectUpdates = useMemo(() => {
    const items = summary?.recentProjectUpdates ?? [];
    const filtered = items.filter((item) => {
      const key = `${item.departmentId}:${item.projectId}:${item.latestUpdateAt}`;
      const isDismissed = !!dismissedMap[key];
      if (isDismissed) {
        console.log('[ExecutionPanel-dismiss-filter] dismissed:', {
          projectId: item.projectId,
          latestUpdateAt: item.latestUpdateAt,
          key,
        });
      }
      return !isDismissed;
    });

    console.log('[ExecutionPanel-recentProjectUpdates]', {
      totalFromAPI: items.length,
      afterDismissFilter: filtered.length,
      dismissedMapSize: Object.keys(dismissedMap).length,
      sampleAPItems: items.slice(0, 2).map(item => ({
        projectId: item.projectId,
        latestUpdateAt: item.latestUpdateAt,
        latestUpdateType: item.latestUpdateType,
      })),
    });

    return filtered;
  }, [summary?.recentProjectUpdates, dismissedMap]);

  const dismissUpdate = (item: ProjectUpdateItem) => {
    if (typeof window === 'undefined') return;
    const key = `${item.departmentId}:${item.projectId}:${item.latestUpdateAt}`;
    setDismissedMap((prev) => {
      if (prev[key]) return prev;
      const next = { ...prev, [key]: true as const };
      try {
        window.localStorage.setItem('home:stage5:dismissed', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const stage6Summary = useMemo(() => {
    const dashboardSummary = s6?.dashboardSummary as any;
    if (!dashboardSummary) return null;

    const baselineRevenueMJPY = Number(dashboardSummary?.revenue?.baseline ?? NaN);
    const forecastRevenueMJPY = Number(dashboardSummary?.revenue?.forecast ?? NaN);
    const targetRevenueMJPY = Number(dashboardSummary?.revenue?.target ?? NaN);

    const baselineOpMJPY = Number(dashboardSummary?.op?.baseline ?? NaN);
    const forecastOpMJPY = Number(dashboardSummary?.op?.forecast ?? NaN);
    const targetOpMJPY = Number(dashboardSummary?.op?.target ?? NaN);

    const revenueAchievementRate =
      Number.isFinite(forecastRevenueMJPY) && Number.isFinite(targetRevenueMJPY) && targetRevenueMJPY > 0
        ? forecastRevenueMJPY / targetRevenueMJPY
        : null;

    const opAchievementRate =
      Number.isFinite(forecastOpMJPY) && Number.isFinite(targetOpMJPY) && targetOpMJPY > 0
        ? forecastOpMJPY / targetOpMJPY
        : null;

    return {
      revenue: {
        current: Number.isFinite(baselineRevenueMJPY) ? formatOkuFromMJPY(baselineRevenueMJPY) : '—',
        forecast: Number.isFinite(forecastRevenueMJPY) ? formatOkuFromMJPY(forecastRevenueMJPY) : '—',
        target: Number.isFinite(targetRevenueMJPY) ? formatOkuFromMJPY(targetRevenueMJPY) : '—',
        achievementRate: formatRate(revenueAchievementRate),
      },
      op: {
        current: Number.isFinite(baselineOpMJPY) ? formatOkuFromMJPY(baselineOpMJPY) : '—',
        forecast: Number.isFinite(forecastOpMJPY) ? formatOkuFromMJPY(forecastOpMJPY) : '—',
        target: Number.isFinite(targetOpMJPY) ? formatOkuFromMJPY(targetOpMJPY) : '—',
        achievementRate: formatRate(opAchievementRate),
      },
    };
  }, [s6?.dashboardSummary]);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-neutral-50 p-4 ring-1 ring-neutral-200/60 dark:bg-neutral-900/40 dark:ring-neutral-800">
        <div className="flex items-center gap-3">
          <Link href="/execution" className={stageBtnClass}>
            <span className="text-[15px] font-semibold text-neutral-900">STAGE5：実行計画支援</span>
          </Link>
          <div className="text-sm font-medium">最近動きのあったプロジェクト</div>
        </div>

        <div className="mt-3 rounded-xl bg-white p-3 ring-1 ring-neutral-200/60 dark:bg-neutral-950 dark:ring-neutral-800">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-neutral-700 dark:text-neutral-200">直近7日の更新</div>
              <div className="mt-1 text-[12px] leading-5 text-neutral-500">
                進捗・コメント・評価・アドバイス・協力要請など、変化があった案件だけを表示します。
              </div>
            </div>
            <Link
              href="/execution"
              className="shrink-0 text-xs font-medium text-neutral-600 underline-offset-4 hover:underline dark:text-neutral-300"
            >
              STAGE5を開く
            </Link>
          </div>

          <div className="mt-3 space-y-2">
            {loading ? (
              <div className="text-xs text-neutral-500">集計中…</div>
            ) : error ? (
              <div className="text-xs text-rose-600">{error}</div>
            ) : recentProjectUpdates.length === 0 ? (
              <div className="rounded-lg bg-neutral-50 px-3 py-3 text-xs leading-5 text-neutral-500 dark:bg-neutral-900/40">
                直近の更新はありません。進捗・コメント・協力要請などの更新があると、ここに表示されます。
              </div>
            ) : (
              recentProjectUpdates.map((item) => (
                <div
                  key={`${item.departmentId}-${item.projectId}-${item.latestUpdateAt}`}
                  className="flex items-center justify-between gap-3 rounded-lg bg-neutral-50 px-3 py-3 dark:bg-neutral-900/40"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs text-neutral-500">{item.departmentName}</div>
                    <div className="truncate text-sm font-medium text-neutral-900 dark:text-white">
                      {item.projectTitle}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-neutral-500">
                      <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-neutral-200 dark:bg-neutral-950 dark:ring-neutral-800">
                        {formatUpdateType(item.latestUpdateType)}
                      </span>
                      <span>{formatDateTime(item.latestUpdateAt)}</span>
                    </div>
                    {item.latestSummary ? (
                      <div className="mt-1 truncate text-[11px] text-neutral-500">{item.latestSummary}</div>
                    ) : null}
                  </div>
                  <Link
                    href={item.okrId ? `/execution?okrId=${encodeURIComponent(item.okrId)}&projectId=${encodeURIComponent(item.projectId)}&departmentId=${encodeURIComponent(item.departmentId)}` : '/execution'}
                    onClick={() => dismissUpdate(item)}
                    className="shrink-0 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:opacity-90 dark:bg-white dark:text-neutral-900"
                  >
                    開く
                  </Link>
                </div>
              ))
            )}
          </div>
        </div>
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

      <div className="rounded-2xl bg-neutral-50 p-4 ring-1 ring-neutral-200/60 dark:bg-neutral-900/40 dark:ring-neutral-800">
        <div className="flex items-center gap-3">
          <Link href="/org-transformation" className={stageBtnClass}>
            <span className="text-[15px] font-semibold text-neutral-900">組織変革・すり合わせルーム</span>
          </Link>
          <div className="text-sm font-medium">認識ズレ・違和感の要約</div>
        </div>

        <div className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
          現場の違和感や認識のズレを検知し、必要なすり合わせにつなげます。
        </div>

        <div className="mt-2 rounded-xl bg-white p-2.5 ring-1 ring-neutral-200/60 dark:bg-neutral-950 dark:ring-neutral-800">
          <div className="flex flex-wrap gap-2.5">
            <div className="rounded-full bg-neutral-100 px-3.5 py-1.5 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              部門間の認識ズレ：増加傾向
            </div>
            <div className="rounded-full bg-neutral-100 px-3.5 py-1.5 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              優先順位の違和感：3件登録
            </div>
            <div className="rounded-full bg-neutral-100 px-3.5 py-1.5 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              実行計画とのギャップ：要確認
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
