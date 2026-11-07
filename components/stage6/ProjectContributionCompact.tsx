'use client';

import { useState } from 'react';
import type { ProjectContribution } from '@/utils/stage6';

export type ContributionRow = ProjectContribution & {
  targetRevenueMJPY?: number;
  targetOpIncomeMJPY?: number;
};

const INITIAL_ROWS = 5;

function fmtMJPY(value: number) {
  return `${Math.round(value).toLocaleString()} 百万円`;
}

function targetText(value?: number) {
  return value === undefined || !Number.isFinite(value) ? '目標 未設定' : `目標 ${fmtMJPY(value)}`;
}

function contributionText(p: ContributionRow, value: number) {
  const allExcluded = (p.krCount ?? 0) > 0 && p.financeExcludedKrCount === p.krCount;
  return allExcluded ? '未算定' : fmtMJPY(value);
}

export function ProjectContributionCompact({ projectContrib }: { projectContrib: ContributionRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = projectContrib
    .slice()
    .sort((a, b) => b.deltaRevenueTotal + b.deltaOpTotal - (a.deltaRevenueTotal + a.deltaOpTotal));
  const visible = expanded ? sorted : sorted.slice(0, INITIAL_ROWS);
  const columns = 'grid grid-cols-[minmax(0,1fr)_7rem_7rem] items-center gap-3';

  return (
    <section aria-label="プロジェクト寄与" className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h4 className="text-sm font-bold text-slate-900">プロジェクト別の売上・利益への寄与</h4>
        <p className="mt-1 text-xs leading-relaxed text-slate-600 break-keep">
          寄与額は現在の計画値に基づく額です。目標額と寄与額は別の値です。寄与が0の項目は「効果なし」を意味せず、計画値が未入力の場合も0と表示されます。
        </p>
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-600">
          表示するプロジェクトがありません。
        </p>
      ) : (
        <>
          <div className={`${columns} border-b border-slate-200 pb-2 text-xs font-semibold text-slate-600`}>
            <div>プロジェクト</div>
            <div className="text-right">売上への寄与</div>
            <div className="text-right">営業利益への寄与</div>
          </div>
          <ul className="divide-y divide-slate-100">
            {visible.map((p) => (
              <li key={p.key} className={`${columns} py-2 text-sm`}>
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-900">{p.proj}</div>
                  <div className="truncate text-xs text-slate-500">{p.dept}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-slate-900">{contributionText(p, p.deltaRevenueTotal)}</div>
                  <div className="text-xs text-slate-500">{targetText(p.targetRevenueMJPY)}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-slate-900">{contributionText(p, p.deltaOpTotal)}</div>
                  <div className="text-xs text-slate-500">{targetText(p.targetOpIncomeMJPY)}</div>
                </div>
              </li>
            ))}
          </ul>
          {sorted.length > INITIAL_ROWS && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {expanded ? `上位${INITIAL_ROWS}件に戻す` : `全${sorted.length}件を表示`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
