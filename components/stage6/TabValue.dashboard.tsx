'use client';

import React, { useMemo } from 'react';
import type { NorthStarRow, ProjectContribution } from '@/utils/stage6';

type Props = {
  northStarRows: NorthStarRow[];
  projectContrib: ProjectContribution[];
  vaCards: { key: string; label: string; value: string; unit: string }[];
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
function parseNumericFromCard(value: string | undefined) {
  if (!value) return undefined;
  const n = Number(String(value).replace(/,/g, '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}
function pickRow(rows: NorthStarRow[], label: string) {
  return rows.find((r) => r.label === label);
}

function topProjectsForMetric(metricLabel: '売上' | '営業利益', projectContrib: ProjectContribution[], limit = 3) {
  return projectContrib
    .map((p) => {
      const deltaYen = metricLabel === '売上' ? p.deltaRevenueTotal : p.deltaOpTotal;
      const deltaMJPY = yenToMJPY(deltaYen);
      return {
        key: p.key,
        dept: p.dept,
        proj: p.proj,
        deltaMJPY,
        evidenceBadge:
          p.evidence?.source === 'stage4_plan'
            ? 'STAGE4計画'
            : p.evidence?.source === 'kr_bridge'
              ? 'KR推定'
              : '推定',
        execWeightPct: p.executionWeight?.weight ? p.executionWeight.weight * 100 : undefined,
      };
    })
    .filter((x) => Math.abs(x.deltaMJPY) > 0.01)
    .sort((a, b) => Math.abs(b.deltaMJPY) - Math.abs(a.deltaMJPY))
    .slice(0, limit);
}

function makeActions({
  revenueNeedMJPY,
  opNeedMJPY,
  hasAnyInvestment,
}: {
  revenueNeedMJPY: number;
  opNeedMJPY: number;
  hasAnyInvestment: boolean;
}) {
  const actions: { title: string; detail: string }[] = [];

  if (opNeedMJPY > 0) {
    actions.push({
      title: `営業利益を +${fmtMJPY(opNeedMJPY)} 上積みする手当て`,
      detail:
        '利益寄与の大きいプロジェクトを強化するか、利益寄与の計画を追加してください。STAGE4で計画寄与を見直すと説明可能性が上がります。',
    });
  }

  if (revenueNeedMJPY > 0) {
    actions.push({
      title: `売上を +${fmtMJPY(revenueNeedMJPY)} 上積みする手当て`,
      detail:
        '売上寄与の大きいプロジェクトを増やすか、既存プロジェクトの寄与を引き上げてください。',
    });
  }

  if (!hasAnyInvestment) {
    actions.push({
      title: '投資額を入力して ROI を評価可能にする',
      detail:
        '投資が 0 のままだと ROI が意味を持ちません。STAGE4（目的カード内の投資）に最低限の投資額を入力してください。',
    });
  }

  if (actions.length === 0) {
    actions.push({
      title: '次のアクション',
      detail: '大きな未達は見えていません。プロジェクト寄与の内訳を確認し、実行度の低いプロジェクトを重点管理してください。',
    });
  }

  return actions.slice(0, 4);
}

function ProgressBar({ currentPct }: { currentPct: number }) {
  const current = Math.max(0, Math.min(100, currentPct));
  return (
    <div className="mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-3">
      <div className="text-[11px] font-semibold text-slate-500">現状</div>
      <div className="relative h-3 rounded-full bg-slate-100 overflow-hidden">
        <div className="absolute inset-y-0 left-0 w-full bg-blue-200" />
        <div className="absolute inset-y-0 left-0 bg-slate-900" style={{ width: `${current}%` }} />
      </div>
      <div className="text-[11px] font-semibold text-slate-500">目標</div>
    </div>
  );
}

function FiveMetricCard({
  label,
  current,
  forecast,
  target,
  unit,
}: {
  label: string;
  current?: number;
  forecast?: number;
  target?: number;
  unit?: string;
}) {
  const progress =
    Number.isFinite(current as any) && Number.isFinite(forecast as any) && Number.isFinite(target as any) && (target as number) !== (current as number)
      ? Math.max(0, Math.min(100, (((forecast as number) - (current as number)) / ((target as number) - (current as number))) * 100))
      : undefined;

  const fmtValue = (v?: number) => {
    if (!Number.isFinite(v as any)) return '未推定';
    return `${(v as number).toLocaleString()}${unit ?? ''}`;
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-[11px] font-semibold text-slate-600">{label}</div>
      <div className="mt-3 grid gap-2 text-sm">
        <div className="flex items-center justify-between"><span className="text-slate-500">現状</span><span className="font-semibold text-slate-900">{fmtValue(current)}</span></div>
        <div className="flex items-center justify-between"><span className="text-slate-500">達成見込み</span><span className="font-semibold text-slate-900">{fmtValue(forecast)}</span></div>
        <div className="flex items-center justify-between"><span className="text-slate-500">目標</span><span className="font-semibold text-slate-900">{fmtValue(target)}</span></div>
      </div>
      <div className="mt-3 text-[12px] text-slate-600">
        進捗：<span className="font-semibold text-slate-900">{fmtPct(progress)}</span>
      </div>
    </div>
  );
}

export function TabValueDashboard({ northStarRows, projectContrib, vaCards }: Props) {
  // ★ 実行確認用ログ
  console.log('[TABVALUE-NEW-CODE-RUNNING] TabValueDashboard component loaded');

  const revenueRow = useMemo(() => pickRow(northStarRows, '売上'), [northStarRows]);
  const opRow = useMemo(() => pickRow(northStarRows, '営業利益'), [northStarRows]);

  const revenue = useMemo(() => {
    const base = revenueRow?.base ?? 0;
    const forecast = revenueRow?.forecastValue ?? 0;
    const needMJPY = Math.max(0, base - forecast);
    const top3 = topProjectsForMetric('売上', projectContrib);
    // ★ FIX: current を使わない（データ源が存在しないため）
    return { base, forecast, needMJPY, achievementRate: revenueRow?.achievementRate, top3 };
  }, [revenueRow, projectContrib]);

  const op = useMemo(() => {
    const base = opRow?.base ?? 0;
    const forecast = opRow?.forecastValue ?? 0;
    const needMJPY = Math.max(0, base - forecast);
    const top3 = topProjectsForMetric('営業利益', projectContrib);
    // ★ FIX: current を使わない（データ源が存在しないため）
    return { base, forecast, needMJPY, achievementRate: opRow?.achievementRate, top3 };
  }, [opRow, projectContrib]);

  const hasAnyInvestment = useMemo(
    () => projectContrib.some((p) => Number.isFinite(p.investTotal as any) && (p.investTotal ?? 0) !== 0),
    [projectContrib]
  );

  const actions = useMemo(
    () => makeActions({ revenueNeedMJPY: revenue.needMJPY, opNeedMJPY: op.needMJPY, hasAnyInvestment }),
    [revenue.needMJPY, op.needMJPY, hasAnyInvestment]
  );

  const summary = useMemo(() => {
    const revenueText = `売上は ${fmtPct(revenue.achievementRate)}（不足 ${fmtMJPY(revenue.needMJPY)}）`;
    const opText = `営業利益は ${fmtPct(op.achievementRate)}（不足 ${fmtMJPY(op.needMJPY)}）`;
    const bottleneck = op.needMJPY > revenue.needMJPY ? '営業利益が主要ボトルネックです。' : revenue.needMJPY > 0 ? '売上が主要ボトルネックです。' : '大きな未達は見えていません。';
    return `${revenueText} / ${opText}。${bottleneck}`;
  }, [revenue, op]);

  const focusMetrics = [
    { title: '売上', ...revenue },
    { title: '営業利益', ...op },
  ];

  const fiveMetrics = useMemo(() => {
    const byKey = new Map(vaCards.map((c) => [c.key, c]));
    const revenueGrowth = byKey.get('revenue_cagr') ?? byKey.get('revenueGrowth') ?? vaCards.find((c) => c.label.includes('売上CAGR'));
    const opMargin = byKey.get('op_margin') ?? byKey.get('operatingMargin') ?? vaCards.find((c) => c.label.includes('営業利益率'));
    const roic = byKey.get('roic') ?? vaCards.find((c) => c.label.toUpperCase().includes('ROIC'));
    const pbr = byKey.get('pbr') ?? vaCards.find((c) => c.label.toUpperCase().includes('PBR'));

    const currentOpMargin = parseNumericFromCard(opMargin?.value);
    const forecastOpMargin = revenue.forecast > 0 ? (op.forecast / revenue.forecast) * 100 : undefined;

    return [
      {
        key: 'revenueGrowth',
        label: '売上CAGR',
        current: parseNumericFromCard(revenueGrowth?.value),
        forecast: undefined,
        target: undefined,
        unit: revenueGrowth?.unit ?? '%',
      },
      {
        key: 'opMargin',
        label: '営業利益率',
        current: currentOpMargin,
        forecast: forecastOpMargin,
        target: undefined,
        unit: '%',
      },
      {
        key: 'roic',
        label: 'ROIC',
        current: parseNumericFromCard(roic?.value),
        forecast: undefined,
        target: undefined,
        unit: roic?.unit ?? '%',
      },
      {
        key: 'pbr',
        label: 'PBR',
        current: parseNumericFromCard(pbr?.value),
        forecast: undefined,
        target: undefined,
        unit: pbr?.unit ?? '倍',
      },
    ];
  }, [vaCards, revenue.forecast, op.forecast]);

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">進捗サマリー</h2>
        <p className="mt-1 text-[12px] text-slate-600">会社業績目標に対して、いまどこまで来ているかを要約します。</p>
        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-800">{summary}</div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h3 className="text-base font-bold text-slate-900">会社業績目標に対する進捗</h3>
          <p className="mt-1 text-[12px] text-slate-600">現状、達成見込み、目標を並べて、どこまで来ているかを示します。</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {focusMetrics.map((m) => (
            <div key={m.title} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-bold text-slate-900">{m.title}</div>
                {/* ★ FIX: ラベルを「達成率」→「目標達成見込み」に変更（forecast/target*100の意味を明確化） */}
                <div className="text-sm font-semibold text-slate-700">目標達成見込み {fmtPct(m.achievementRate)}</div>
              </div>
              <ProgressBar currentPct={m.achievementRate ?? 0} />
              {/* ★ FIX: 3列から2列に変更。「現状」を削除（データ源なし） */}
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-[11px] font-semibold text-slate-600">達成見込み</div>
                  <div className="mt-1 font-bold text-slate-900">{fmtMJPY(m.forecast)}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-[11px] font-semibold text-slate-600">目標</div>
                  <div className="mt-1 font-bold text-slate-900">{fmtMJPY(m.base)}</div>
                </div>
              </div>
              <div className="mt-3 text-sm text-slate-700">
                残ギャップ：<span className="font-semibold">{fmtMJPY(m.needMJPY)}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h3 className="text-base font-bold text-slate-900">何が足りないか / どのプロジェクトが効くか</h3>
          <p className="mt-1 text-[12px] text-slate-600">不足分と、それを埋める候補となるプロジェクトを指標ごとに示します。</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {focusMetrics.map((m) => (
            <div key={m.title} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-bold text-slate-900">{m.title}</div>
                <div className="text-sm text-slate-700">
                  必要追加Δ <span className="font-semibold">+{fmtMJPY(m.needMJPY)}</span>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {m.top3.length ? (
                  m.top3.map((t) => (
                    <div key={t.key} className="rounded-lg border border-slate-100 p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-900">{t.dept}：{t.proj}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                          <span className="rounded bg-slate-100 px-2 py-1">{t.evidenceBadge}</span>
                          {Number.isFinite(t.execWeightPct as any) && (
                            <span className="rounded bg-blue-100 px-2 py-1 text-blue-800">
                              実行度 {Math.round(t.execWeightPct as number)}%
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] text-slate-600">寄与Δ</div>
                        <div className="font-bold text-slate-900">{fmtMJPY(t.deltaMJPY)}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-slate-600">まだ寄与が入力されていません（STAGE4 / この画面）。</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h3 className="text-base font-bold text-slate-900">企業価値の主要5指標の進捗</h3>
          <p className="mt-1 text-[12px] text-slate-600">現状値を基準に、達成見込みがどこまで進んだかを確認します。</p>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          {fiveMetrics.map((m) => (
            <FiveMetricCard
              key={m.key}
              label={m.label}
              current={m.current}
              forecast={m.forecast}
              target={m.target}
              unit={m.unit}
            />
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h3 className="text-base font-bold text-slate-900">次に取るべきアクション</h3>
          <p className="mt-1 text-[12px] text-slate-600">不足分を埋めるために、次にやるべきことを示します。</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {actions.map((a) => (
            <div key={a.title} className="rounded-xl border border-slate-200 p-4">
              <div className="font-semibold text-slate-900">{a.title}</div>
              <div className="mt-1 text-sm text-slate-700">{a.detail}</div>
              <div className="mt-2 text-[12px] text-slate-600">操作場所：STAGE4 / この画面 / プロジェクト寄与一覧</div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
