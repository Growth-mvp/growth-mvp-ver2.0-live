'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useUserStore } from '@/store/userStore';
import { useStrategyStore } from '@/store/strategyStore';
import { useStage6Data } from '@/components/stage6/hooks/useStage6Data';
import { loadMyProgressLogs } from '@/utils/supabase/strategy';

type ProgressLogRow = {
  okr_id?: string | null;
  content?: any;
  status?: any;
  score?: number | null;
  created_at?: string;
};

function formatYen(n: number) {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(Math.round(n));
  return `${sign}${abs.toLocaleString('ja-JP')}円`;
}

function isCheckin(log: ProgressLogRow) {
  if (log == null) return false;
  if (typeof log.score === 'number') return true;
  if (log.status != null) return true;
  if (log.content == null) return false;
  if (typeof log.content === 'string') return log.content.trim().length > 0;
  return true;
}

// ✅ ピラミッドと完全に同じボタンデザイン（class名も同じ内容）
const stageBtnClass =
  'inline-flex items-center rounded-xl border border-neutral-300 ' +
  'bg-white px-6 py-3 shadow-sm hover:bg-neutral-100 transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2';

export default function ExecutionPanel() {
  const { user } = useUserStore();
  const strategy = useStrategyStore() as any;

  const s6 = useStage6Data('base');

  const [logs7d, setLogs7d] = useState<ProgressLogRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const run = async () => {
      if (!user?.id) return;
      setLoading(true);
      try {
        const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const res = await loadMyProgressLogs(user.id, { fromDate, limit: 500 });
        if (res?.data && Array.isArray(res.data)) setLogs7d(res.data as any);
        else setLogs7d([]);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [user?.id]);

  const totalOkrs = useMemo(() => {
    const depts = (strategy?.departments ?? []) as any[];
    let count = 0;
    for (const d of depts) {
      const projs = (d?.projects ?? []) as any[];
      for (const p of projs) {
        const okrs = (p?.okrs ?? []) as any[];
        if (Array.isArray(okrs) && okrs.length > 0) count += okrs.length;
      }
    }
    return count;
  }, [strategy?.departments]);

  const flatProjects = useMemo(() => {
    const depts = (strategy?.departments ?? []) as any[];
    const out: Array<{
      deptName: string;
      projectTitle: string;
      okrIds: string[];
    }> = [];

    for (const d of depts) {
      const deptName = String(d?.name ?? d?.departmentName ?? '部門');
      const projs = (d?.projects ?? []) as any[];
      for (const p of projs) {
        const projectTitle = String(p?.title ?? p?.name ?? 'プロジェクト');
        const okrs = (p?.okrs ?? []) as any[];
        const okrIds: string[] = [];

        if (Array.isArray(okrs)) {
          for (const o of okrs) {
            const id = o?.id ?? o?.okrId ?? o?.okr_id;
            if (id) okrIds.push(String(id));
          }
        }

        if (okrIds.length > 0) out.push({ deptName, projectTitle, okrIds });
      }
    }
    return out;
  }, [strategy?.departments]);

  const checkinOkrs = useMemo(() => {
    const set = new Set<string>();
    for (const l of logs7d) {
      if (!isCheckin(l)) continue;
      const id = l.okr_id ?? undefined;
      if (id) set.add(id);
    }
    return set;
  }, [logs7d]);

  const noCheckinTop3 = useMemo(() => {
    if (!flatProjects.length) return [];
    const res: Array<{ deptName: string; projectTitle: string }> = [];
    for (const pj of flatProjects) {
      const anyChecked = pj.okrIds.some((id) => checkinOkrs.has(id));
      if (!anyChecked) res.push({ deptName: pj.deptName, projectTitle: pj.projectTitle });
      if (res.length >= 3) break;
    }
    return res;
  }, [flatProjects, checkinOkrs]);

  const checkinRate = useMemo(() => {
    if (!totalOkrs) return null;
    return checkinOkrs.size / totalOkrs;
  }, [checkinOkrs.size, totalOkrs]);

  const opSummary = useMemo(() => {
    const data = (s6?.chartData ?? []) as any[];
    if (!Array.isArray(data) || data.length === 0) return null;
    const last = data[data.length - 1];
    const baselineOp = Number(last?.baselineOp ?? 0);
    const selectedOpRaw = Number(last?.selectedOp ?? 0);
    const allOp = Number(last?.allOp ?? 0);

    const selectedOp = selectedOpRaw !== 0 ? selectedOpRaw : allOp;
    return {
      baselineOp,
      selectedOp,
      delta: selectedOp - baselineOp,
      year: last?.year,
    };
  }, [s6?.chartData]);

  return (
    <div className="space-y-4">
      {/* STAGE5 */}
      <div className="rounded-2xl bg-neutral-50 p-4 ring-1 ring-neutral-200/60 dark:bg-neutral-900/40 dark:ring-neutral-800">
        <div className="flex items-center gap-3">
          <Link href="/execution" className={stageBtnClass}>
            {/* ✅ ピラミッドと同じ文字スタイル */}
            <span className="text-[15px] font-semibold text-neutral-900">STAGE5：実行計画支援</span>
          </Link>
          <div className="text-sm font-medium">実行状況（直近7日）</div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white p-3 ring-1 ring-neutral-200/60 dark:bg-neutral-950 dark:ring-neutral-800">
            <div className="text-xs text-neutral-500">チェックイン率</div>
            <div className="mt-1 text-2xl font-semibold">
              {checkinRate == null ? '—' : `${Math.round(checkinRate * 100)}%`}
            </div>
          </div>
          <div className="rounded-xl bg-white p-3 ring-1 ring-neutral-200/60 dark:bg-neutral-950 dark:ring-neutral-800">
            <div className="text-xs text-neutral-500">未チェックイン</div>
            <div className="mt-1 text-2xl font-semibold">
              {totalOkrs ? Math.max(totalOkrs - checkinOkrs.size, 0) : '—'}
            </div>
          </div>
        </div>

        {/* 未チェックインTop3 */}
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
              ) : noCheckinTop3.length === 0 ? (
                <div className="text-xs text-neutral-500">今週は未チェックインなし</div>
              ) : (
                noCheckinTop3.map((x, i) => (
                  <div
                    key={`${x.deptName}-${x.projectTitle}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-lg bg-neutral-50 px-2 py-2 dark:bg-neutral-900/40"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs text-neutral-500">{x.deptName}</div>
                      <div className="truncate text-sm font-medium text-neutral-900 dark:text-white">
                        {x.projectTitle}
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

      {/* STAGE6 */}
      <div className="rounded-2xl bg-neutral-50 p-4 ring-1 ring-neutral-200/60 dark:bg-neutral-900/40 dark:ring-neutral-800">
        <div className="flex items-center gap-3">
          <Link href="/stage6" className={stageBtnClass}>
            <span className="text-[15px] font-semibold text-neutral-900">STAGE6：業績シミュレーション</span>
          </Link>
          <div className="text-sm font-medium">（要約）</div>
        </div>

        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-neutral-500">営業利益 Baseline</span>
            <span className="font-semibold">
              {opSummary ? formatYen(opSummary.baselineOp) : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-neutral-500">営業利益 Selected</span>
            <span className="font-semibold">
              {opSummary ? formatYen(opSummary.selectedOp) : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-neutral-500">差分</span>
            <span className="font-semibold">
              {opSummary ? formatYen(opSummary.delta) : '—'}
            </span>
          </div>

          {opSummary?.year != null && (
            <div className="pt-2 text-xs text-neutral-500">
              ※ 最新年（{opSummary.year}）の要約
            </div>
          )}
        </div>
      </div>
    </div>
  );
}