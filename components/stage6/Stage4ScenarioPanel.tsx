'use client';

import { useEffect, useMemo, useState } from 'react';
import { remotePlanOps } from '@/components/okr/execution-plan/planStores';
import { scenarioRowsOf, type ScenarioRecord, type ScenarioRow } from '@/lib/stage4/planView/scenarioRows';

const pick = (row: ScenarioRow, prefix: string): { text: string; source: string | null } => {
  const r = row.estimate.status === 'CALCULATED' ? row.estimate.rows.find((x) => x.label.startsWith(prefix)) : undefined;
  if (!r) return { text: '未算定', source: null };
  return { text: r.valueText ?? (r.valueMJPY === null ? '未算定' : `${r.valueMJPY}百万円`), source: r.source };
};

/* 案件ごとの参考シナリオの表。合計は作らない（STAGE6の正式な計画・経路A・経路Bには加算しない） */
export function Stage4ScenarioTable({ rows }: { rows: ScenarioRow[] }) {
  return (
    <section aria-label="STAGE4の参考シナリオ" className="space-y-3">
      <h3 className="text-[15px] font-bold text-zinc-900">STAGE4の参考シナリオ（合計には加算しない）</h3>
      <p className="text-[12px] leading-relaxed text-zinc-700">
        STAGE4の計画書から算出した参考試算です。AIの仮説や未確認の前提を含みます。STAGE6の正式な業績計画・STAGE3の業績インパクト・財務効果には、まだ反映していません。
      </p>
      {rows.length === 0 ? (
        <p className="text-[13px] text-zinc-700">STAGE4で計画書を作った案件はまだありません。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse text-[13px]">
            <thead>
              <tr className="bg-zinc-50 text-left text-zinc-700">
                <th className="border px-2 py-1">案件</th>
                <th className="border px-2 py-1">状態</th>
                <th className="border px-2 py-1">売上（参考）</th>
                <th className="border px-2 py-1">粗利益（参考）</th>
                <th className="border px-2 py-1">営業利益の参考値</th>
                <th className="border px-2 py-1">投資支出</th>
                <th className="border px-2 py-1">計上期間</th>
                <th className="border px-2 py-1">注意</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const revenue = pick(row, '売上');
                const gross = pick(row, '粗利益');
                const op = pick(row, '営業利益の参考値');
                const invest = pick(row, '投資支出');
                const period = pick(row, '計上期間');
                return (
                  <tr key={row.projectId} className="align-top">
                    <td className="border px-2 py-1">
                      <div className="font-medium text-zinc-900">{row.projectTitle}</div>
                      <div className="text-[11px] text-zinc-500">{row.deptName}</div>
                    </td>
                    <td className="border px-2 py-1">{row.stateLabel}</td>
                    <td className="border px-2 py-1">
                      {revenue.text}
                      {revenue.source && <div className="text-[11px] text-zinc-500">{revenue.source}</div>}
                    </td>
                    <td className="border px-2 py-1">{gross.text}</td>
                    <td className="border px-2 py-1">{op.text}</td>
                    <td className="border px-2 py-1">{invest.text}</td>
                    <td className="border px-2 py-1">{period.text}</td>
                    <td className="border px-2 py-1 text-[12px] text-zinc-700">{row.overlapNote ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type LoadState = { status: 'LOADING' } | { status: 'READY'; records: ScenarioRecord[] } | { status: 'OFF' } | { status: 'FAILED' };

/* STAGE4の計画書の一覧を読み、STAGE3の案件ごとに参考シナリオを表示する（読み取りのみ） */
export default function Stage4ScenarioPanel({
  companyId,
  strategyId,
  departments,
}: {
  companyId: string;
  strategyId: string;
  departments: unknown;
}) {
  const [load, setLoad] = useState<LoadState>({ status: 'LOADING' });
  useEffect(() => {
    let alive = true;
    remotePlanOps()
      .list(companyId, strategyId)
      .then((r) => {
        if (!alive) return;
        if (r.status === 'FOUND') setLoad({ status: 'READY', records: r.records as unknown as ScenarioRecord[] });
        else if (r.status === 'DISABLED') setLoad({ status: 'OFF' });
        else setLoad({ status: 'FAILED' });
      });
    return () => {
      alive = false;
    };
  }, [companyId, strategyId]);
  const rows = useMemo(
    () => (load.status === 'READY' ? scenarioRowsOf({ departments, records: load.records }) : []),
    [load, departments]
  );
  if (load.status === 'OFF') return null;
  if (load.status === 'LOADING') return <p className="text-[13px] text-zinc-600">STAGE4の参考シナリオを読み込んでいます…</p>;
  if (load.status === 'FAILED') return <p className="text-[13px] text-amber-800">STAGE4の参考シナリオを読み込めませんでした。</p>;
  return <Stage4ScenarioTable rows={rows} />;
}
