'use client';

import React, { useMemo } from 'react';
import type { NorthStarRow, ProjectContribution } from '@/utils/stage6';

type Props = {
  northStarRows: NorthStarRow[];
  projectContrib: ProjectContribution[];
};

function fmtMJPY(x: number | null | undefined) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '-';
  return `${Math.round(x).toLocaleString()} 百万円`;
}
function fmtPct(x: number | null | undefined) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '-';
  return `${x.toFixed(1)}%`;
}
function yenToMJPY(yen: number | null | undefined) {
  if (!Number.isFinite(yen as any)) return 0;
  return (yen as number) / 1_000_000;
}

function pickRow(northStarRows: NorthStarRow[], label: string): NorthStarRow | undefined {
  return northStarRows.find((r) => r.label === label);
}

function topProjectsForMetric(
  metricLabel: '売上' | '営業利益',
  projectContrib: ProjectContribution[],
  limit = 3
) {
  const items = projectContrib
    .map((p) => {
      const deltaYen = metricLabel === '売上'
        ? (p.achievedRevenueTotal ?? p.deltaRevenueTotal ?? 0)
        : (p.achievedOpTotal ?? p.deltaOpTotal ?? 0);
      const deltaMJPY = yenToMJPY(deltaYen);
      return {
        key: p.key,
        proj: p.proj,
        deltaMJPY,
        evidenceBadge:
          p.evidence?.source === 'stage4_plan'
            ? 'STAGE4計画'
            :p.evidence?.source === 'kr_bridge' ? 'KR推定' : '推定',
        evidenceNotes: p.evidence?.notes,
        execWeightPct: p.executionWeight?.weight ? p.executionWeight.weight * 100 : undefined,
      };
    })
    .filter((x) => Number.isFinite(x.deltaMJPY) && Math.abs(x.deltaMJPY) > 0.01)
    .sort((a, b) => Math.abs(b.deltaMJPY) - Math.abs(a.deltaMJPY))
    .slice(0, limit);

  return items;
}

function makeNextActions(params: {
  revenueNeedMJPY: number;
  opNeedMJPY: number;
  hasAnyInvestment: boolean;
  hasManyEstimated: boolean;
}) {
  const actions: { title: string; detail: string }[] = [];

  if (params.opNeedMJPY > 0) {
    actions.push({
      title: `営業利益を +${fmtMJPY(params.opNeedMJPY)} 上積みする手当て`,
      detail:
        '利益寄与の大きいPJを「強化」するか、利益寄与PJを追加してください（タブ2で寄与Δを調整、またはSTAGE4で計画寄与を固定）。',
    });
  }

  if (params.revenueNeedMJPY > 0) {
    actions.push({
      title: `売上を +${fmtMJPY(params.revenueNeedMJPY)} 上積みする手当て`,
      detail: '売上寄与PJの強化（寄与Δ増）や、売上寄与PJの追加を検討してください（タブ2 / STAGE4）。',
    });
  }

  if (!params.hasAnyInvestment) {
    actions.push({
      title: '投資（百万円）を入力してROIを意味のある指標にする',
      detail:
        'タブ1の投資が 0 のままだと ROI が評価不能です。STAGE4（目的カード内の投資）に最低限の投資額を入力してください。',
    });
  }

  if (params.hasManyEstimated) {
    actions.push({
      title: '推定を減らし、計画（固定）を増やして説明可能性を上げる',
      detail:
        'TopPJが「推定」ばかりの場合、説明の納得度が下がります。STAGE4の金額寄与（固定）を優先して入力し、推定依存を減らしてください。',
    });
  }

  if (actions.length === 0) {
    actions.push({
      title: '次のアクション',
      detail: '現時点では大きな未達要因は見えていません。タブ1で選択PJを絞って寄与の組み合わせを検討してください。',
    });
  }

  return actions.slice(0, 4);
}

function MetricPanel({
  label,
  unit,
  data,
}: {
  label: string;
  unit: string;
  data: {
    base: number;
    forecast: number;
    gap: number;
    needMJPY: number;
    top3: ReturnType<typeof topProjectsForMetric>;
    achievementRate?: number;
  };
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-baseline justify-between">
        <div className="font-bold text-slate-900">{label}</div>
        <div className="text-xs text-slate-600">単位：{unit}</div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-[11px] font-semibold text-slate-600">目標</div>
          <div className="mt-1 font-bold">{fmtMJPY(data.base)}</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-[11px] font-semibold text-slate-600">予測</div>
          <div className="mt-1 font-bold">{fmtMJPY(data.forecast)}</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-[11px] font-semibold text-slate-600">達成率</div>
          <div className="mt-1 font-bold">{fmtPct(data.achievementRate)}</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-[11px] font-semibold text-slate-600">必要追加Δ</div>
          <div className="mt-1 font-bold">+{fmtMJPY(data.needMJPY)}</div>
        </div>
      </div>

      <div className="mt-3">
        <div className="text-[11px] font-semibold text-slate-600">効いているPJ候補（Top3）</div>
        {data.top3.length ? (
          <div className="mt-2 space-y-2">
            {data.top3.map((t) => (
              <div key={t.key} className="rounded-lg border border-slate-100 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">{t.proj}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                      <span className="rounded bg-slate-100 px-2 py-1">{t.evidenceBadge}</span>
                      {Number.isFinite(t.execWeightPct as any) && (
                        <span className="rounded bg-blue-100 px-2 py-1 text-blue-800">
                          実行度 {Math.round(t.execWeightPct as number)}%
                        </span>
                      )}
                      {!!t.evidenceNotes && <span className="truncate">— {t.evidenceNotes}</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-slate-600">寄与Δ</div>
                    <div className="font-bold text-slate-900">{fmtMJPY(t.deltaMJPY)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-sm text-slate-600">まだ寄与が入力されていません（STAGE4 / タブ2）。</div>
        )}
      </div>
    </div>
  );
}

export function TabValueDashboard({ northStarRows, projectContrib }: Props) {
  const revenueRow = useMemo(() => pickRow(northStarRows, '売上'), [northStarRows]);
  const opRow = useMemo(() => pickRow(northStarRows, '営業利益'), [northStarRows]);

  const revenue = useMemo(() => {
    const base = revenueRow?.base ?? 0;
    const forecast = revenueRow?.forecastValue ?? 0;
    const gap = revenueRow?.gap ?? forecast - base;
    const needMJPY = Math.max(0, base - forecast);
    const top3 = topProjectsForMetric('売上', projectContrib, 3);
    return { base, forecast, gap, needMJPY, top3, achievementRate: revenueRow?.achievementRate };
  }, [revenueRow, projectContrib]);

  const op = useMemo(() => {
    const base = opRow?.base ?? 0;
    const forecast = opRow?.forecastValue ?? 0;
    const gap = opRow?.gap ?? forecast - base;
    const needMJPY = Math.max(0, base - forecast);
    const top3 = topProjectsForMetric('営業利益', projectContrib, 3);
    return { base, forecast, gap, needMJPY, top3, achievementRate: opRow?.achievementRate };
  }, [opRow, projectContrib]);

  const hasAnyInvestment = useMemo(() => {
    return projectContrib.some((p) => Number.isFinite(p.investTotal as any) && (p.investTotal ?? 0) !== 0);
  }, [projectContrib]);

  const hasManyEstimated = useMemo(() => {
    const top = [...op.top3, ...revenue.top3];
    if (top.length === 0) return false;
    const estimatedCount = top.filter((t) => t.evidenceBadge === '推定').length;
    return estimatedCount >= Math.ceil(top.length * 0.6);
  }, [op.top3, revenue.top3]);

  const actions = useMemo(
    () =>
      makeNextActions({
        revenueNeedMJPY: revenue.needMJPY,
        opNeedMJPY: op.needMJPY,
        hasAnyInvestment,
        hasManyEstimated,
      }),
    [revenue.needMJPY, op.needMJPY, hasAnyInvestment, hasManyEstimated]
  );

  const summary = useMemo(() => {
    const parts: string[] = [];
    if (revenueRow) parts.push(`売上は目標の ${fmtPct(revenue.achievementRate)}（ギャップ ${fmtMJPY(revenue.gap)}）`);
    if (opRow) parts.push(`営業利益は目標の ${fmtPct(op.achievementRate)}（ギャップ ${fmtMJPY(op.gap)}）`);

    const bottleneck =
      op.needMJPY > revenue.needMJPY
        ? `ボトルネックは「営業利益」（不足 +${fmtMJPY(op.needMJPY)}）です。`
        : revenue.needMJPY > 0
          ? `ボトルネックは「売上」（不足 +${fmtMJPY(revenue.needMJPY)}）です。`
          : '大きな未達は見えていません。';

    return `${parts.join(' / ')}。${bottleneck}`;
  }, [revenueRow, opRow, revenue.achievementRate, op.achievementRate, revenue.gap, op.gap, revenue.needMJPY, op.needMJPY]);

  return (
    <section className="space-y-6">
      {/* 1) 結論 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">判断ボード</h2>
        <p className="mt-1 text-[12px] text-slate-600">
          タブ2の計算結果を、経営判断（ボトルネックと次アクション）に翻訳して表示します。
        </p>
        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-800">{summary}</div>
      </div>

      {/* 2) ボトルネック */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-bold text-slate-900">ボトルネック（不足分）</h3>
        <p className="mt-1 text-[12px] text-slate-600">不足分（必要追加Δ）と、効いているPJ候補（Top3）を示します。</p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <MetricPanel label="売上" unit="百万円" data={revenue} />
          <MetricPanel label="営業利益" unit="百万円" data={op} />
        </div>
      </div>

      {/* 3) 次アクション */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-bold text-slate-900">次のアクション</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {actions.map((a) => (
            <div key={a.title} className="rounded-xl border border-slate-200 p-4">
              <div className="font-semibold text-slate-900">{a.title}</div>
              <div className="mt-1 text-sm text-slate-700">{a.detail}</div>
              <div className="mt-2 text-[12px] text-slate-600">
                操作場所：<span className="font-medium">タブ2（寄与Δの調整）</span> /{' '}
                <span className="font-medium">STAGE4（計画寄与の固定）</span> /{' '}
                <span className="font-medium">タブ1（投資とROI）</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}