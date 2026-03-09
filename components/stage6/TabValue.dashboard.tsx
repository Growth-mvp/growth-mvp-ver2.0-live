'use client';

import { useMemo } from 'react';
import type { NorthStarRow, ProjectContribution } from '@/utils/stage6';

type Props = {
  northStarRows: NorthStarRow[];
  projectContrib: ProjectContribution[];
  vaCards: Array<{ key: string; label: string; value: string | number; unit: string }>;
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
function pickRow(northStarRows: NorthStarRow[], label: string) {
  return northStarRows.find((r) => r.label === label);
}

function topProjectsForMetric(
  metricLabel: '売上' | '営業利益',
  projectContrib: ProjectContribution[],
  limit = 3
) {
  return projectContrib
    .map((p) => {
      const deltaYen = metricLabel === '売上' ? p.deltaRevenueTotal : p.deltaOpTotal;
      const deltaMJPY = yenToMJPY(deltaYen);
      return {
        key: p.key,
        proj: p.proj,
        dept: p.dept,
        deltaMJPY,
        evidenceBadge:
          p.evidence?.source === 'stage4_plan'
            ? 'STAGE4計画'
            : p.evidence?.source === 'kr_bridge'
              ? 'KR推定'
              : '推定',
      };
    })
    .filter((x) => Math.abs(x.deltaMJPY) > 0.01)
    .sort((a, b) => Math.abs(b.deltaMJPY) - Math.abs(a.deltaMJPY))
    .slice(0, limit);
}

function makeActions({ revenueNeedMJPY, opNeedMJPY, hasAnyInvestment }: { revenueNeedMJPY: number; opNeedMJPY: number; hasAnyInvestment: boolean; }) {
  const actions: { title: string; detail: string }[] = [];
  if (opNeedMJPY > 0) {
    actions.push({
      title: `営業利益を +${fmtMJPY(opNeedMJPY)} 上積みする手当て`,
      detail: '利益寄与の大きいPJを強化するか、利益寄与PJを追加してください。必要なら詳細分析で寄与Δを調整してください。',
    });
  }
  if (revenueNeedMJPY > 0) {
    actions.push({
      title: `売上を +${fmtMJPY(revenueNeedMJPY)} 上積みする手当て`,
      detail: '売上寄与PJを強化するか、売上寄与PJを追加してください。STAGE4の計画寄与も見直してください。',
    });
  }
  if (!hasAnyInvestment) {
    actions.push({
      title: '投資額を入力して ROI を評価可能にする',
      detail: '投資が 0 のままだと ROI が意味を持ちません。STAGE4で投資（百万円）を入力してください。',
    });
  }
  if (actions.length === 0) {
    actions.push({
      title: '次のアクション',
      detail: '大きな未達は見えていません。プロジェクト寄与の内訳を確認し、実行度の低いPJを重点管理してください。',
    });
  }
  return actions.slice(0, 4);
}

function ProgressBar({ currentPct }: { currentPct: number }) {
  const current = Math.max(0, Math.min(150, currentPct));
  return (
    <div className="mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-3">
      <div className="text-[11px] font-semibold text-slate-500">現状</div>
      <div className="relative h-3 rounded-full bg-slate-100">
        <div className="absolute inset-y-0 left-0 rounded-full bg-blue-200" style={{ width: '100%' }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-slate-900" style={{ width: `${Math.min(current, 100)}%` }} />
      </div>
      <div className="text-[11px] font-semibold text-slate-500">目標</div>
    </div>
  );
}

export function TabValueDashboard({ northStarRows, projectContrib, vaCards }: Props) {
  const revenueRow = useMemo(() => pickRow(northStarRows, '売上'), [northStarRows]);
  const opRow = useMemo(() => pickRow(northStarRows, '営業利益'), [northStarRows]);

  const revenue = useMemo(() => {
    const base = revenueRow?.base ?? 0;
    const forecast = revenueRow?.forecastValue ?? 0;
    const gap = typeof revenueRow?.gap === 'number' ? revenueRow.gap : forecast - base;
    const needMJPY = Math.max(0, base - forecast);
    return {
      base,
      forecast,
      gap,
      needMJPY,
      achievementRate: revenueRow?.achievementRate,
      top3: topProjectsForMetric('売上', projectContrib),
    };
  }, [revenueRow, projectContrib]);

  const op = useMemo(() => {
    const base = opRow?.base ?? 0;
    const forecast = opRow?.forecastValue ?? 0;
    const gap = typeof opRow?.gap === 'number' ? opRow.gap : forecast - base;
    const needMJPY = Math.max(0, base - forecast);
    return {
      base,
      forecast,
      gap,
      needMJPY,
      achievementRate: opRow?.achievementRate,
      top3: topProjectsForMetric('営業利益', projectContrib),
    };
  }, [opRow, projectContrib]);

  const hasAnyInvestment = useMemo(() => {
    return projectContrib.some((p) => Number.isFinite(p.investTotal as any) && (p.investTotal ?? 0) !== 0);
  }, [projectContrib]);

  const actions = useMemo(() => makeActions({
    revenueNeedMJPY: revenue.needMJPY,
    opNeedMJPY: op.needMJPY,
    hasAnyInvestment,
  }), [revenue.needMJPY, op.needMJPY, hasAnyInvestment]);

  const summary = useMemo(() => {
    const a = `売上は ${fmtPct(revenue.achievementRate)}（不足 ${fmtMJPY(revenue.needMJPY)}）`;
    const b = `営業利益は ${fmtPct(op.achievementRate)}（不足 ${fmtMJPY(op.needMJPY)}）`;
    const bottleneck = op.needMJPY > revenue.needMJPY ? '営業利益が主要ボトルネックです。' : revenue.needMJPY > 0 ? '売上が主要ボトルネックです。' : '大きな未達は見えていません。';
    return `${a} / ${b}。${bottleneck}`;
  }, [revenue, op]);

  const focusMetrics = [
    { title: '売上', ...revenue },
    { title: '営業利益', ...op },
  ];

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">判断ボード</h2>
        <p className="mt-1 text-[12px] text-slate-600">今どこまで達成できているか、何が足りないか、次に何をすべきかを一画面で示します。</p>
        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-800">{summary}</div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h3 className="text-base font-bold text-slate-900">会社NS目標 vs 実績 vs 達成状況</h3>
          <p className="mt-1 text-[12px] text-slate-600">現状と目標の間に、プロジェクト寄与を反映した達成状況を置いて進捗を表示します。</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {focusMetrics.map((m) => (
            <div key={m.title} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-bold text-slate-900">{m.title}</div>
                <div className="text-sm font-semibold text-slate-700">達成率 {fmtPct(m.achievementRate)}</div>
              </div>
              <ProgressBar currentPct={m.achievementRate ?? 0} />
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-[11px] font-semibold text-slate-600">現状/基準</div>
                  <div className="mt-1 font-bold text-slate-900">{fmtMJPY(m.forecast - (m.top3.reduce((s, t) => s + t.deltaMJPY, 0)))}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-[11px] font-semibold text-slate-600">達成状況</div>
                  <div className="mt-1 font-bold text-slate-900">{fmtMJPY(m.forecast)}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-[11px] font-semibold text-slate-600">目標</div>
                  <div className="mt-1 font-bold text-slate-900">{fmtMJPY(m.base)}</div>
                </div>
              </div>
              <div className="mt-3 text-sm text-slate-700">残ギャップ：<span className="font-semibold">{fmtMJPY(m.needMJPY)}</span></div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h3 className="text-base font-bold text-slate-900">ボトルネックと効いているプロジェクト</h3>
          <p className="mt-1 text-[12px] text-slate-600">不足分を埋めるために、どのPJが効いているかを指標ごとに示します。</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {focusMetrics.map((m) => (
            <div key={m.title} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-bold text-slate-900">{m.title}</div>
                <div className="text-sm text-slate-700">必要追加Δ <span className="font-semibold">+{fmtMJPY(m.needMJPY)}</span></div>
              </div>
              <div className="mt-3 space-y-2">
                {m.top3.length ? m.top3.map((t) => (
                  <div key={t.key} className="rounded-lg border border-slate-100 p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-900">{t.dept}：{t.proj}</div>
                      <div className="mt-1 text-[11px] text-slate-600"><span className="rounded bg-slate-100 px-2 py-1">{t.evidenceBadge}</span></div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-slate-600">寄与Δ</div>
                      <div className="font-bold text-slate-900">{fmtMJPY(t.deltaMJPY)}</div>
                    </div>
                  </div>
                )) : <div className="text-sm text-slate-600">寄与が未入力です。</div>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h3 className="text-base font-bold text-slate-900">5指標進捗カード</h3>
          <p className="mt-1 text-[12px] text-slate-600">STAGE1の企業価値指標を参考情報として表示します。</p>
        </div>
        {vaCards.length ? (
          <div className="grid gap-3 md:grid-cols-5">
            {vaCards.map((card) => (
              <div key={card.key} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-[11px] font-semibold text-slate-600">{card.label}</div>
                <div className="mt-2 text-lg font-bold text-slate-900">{card.value}{card.unit}</div>
                <div className="mt-2 text-[11px] text-slate-500">企業価値の参考指標</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-600">5指標分析はまだ入力されていません。</div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h3 className="text-base font-bold text-slate-900">次のアクション</h3>
          <p className="mt-1 text-[12px] text-slate-600">不足分を埋めるために、次にやるべきことを示します。</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {actions.map((a) => (
            <div key={a.title} className="rounded-xl border border-slate-200 p-4">
              <div className="font-semibold text-slate-900">{a.title}</div>
              <div className="mt-1 text-sm text-slate-700">{a.detail}</div>
              <div className="mt-2 text-[12px] text-slate-600">操作場所：STAGE4 / この画面の詳細分析 / プロジェクト寄与一覧</div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
