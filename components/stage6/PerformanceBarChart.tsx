'use client';

import type { Achievement, PerformanceBar, PerformanceBarId, PerformanceMetric, PerformanceView } from '@/utils/stage6/performanceView';
import { METRIC_LABEL } from '@/utils/stage6/performanceView';
import { CHART_COLORS } from '@/lib/ui/tokens';

/* 縦棒：上部はラベル用の余白、下部は名前と対象年度の余白。ゼロ基準線と棒は同じ座標系で描く（底辺を一致させる） */
const LABEL_SPACE = 22;
const LABEL_BOTTOM = 46;
const PLOT_HEIGHT = 124;

const BAR_COLOR: Record<PerformanceBarId, string> = {
  COMPANY_CURRENT: CHART_COLORS.current,
  COMPANY_TARGET: CHART_COLORS.companyTarget,
  PROJECT_TARGET: CHART_COLORS.projectTarget,
  PROJECT_ACTUAL: CHART_COLORS.actual,
};

const SHORT_LABEL: Record<PerformanceBarId, string> = {
  COMPANY_CURRENT: '現状',
  COMPANY_TARGET: '目標',
  PROJECT_TARGET: '目標',
  PROJECT_ACTUAL: '実績',
};

/** 百万円表示。小額は丸めで消えないよう、1桁で0になる場合だけ小数2桁にする */
export function formatBarMillion(yen: number): string {
  const m = yen / 1_000_000;
  const one = m.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (Number(one.replace(/,/g, '')) === 0 && m !== 0) {
    return m.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return one;
}

const signedText = (yen: number) => (yen < 0 ? `−${formatBarMillion(Math.abs(yen))}` : formatBarMillion(yen));

function BarPlot({ bars, compact }: { bars: PerformanceBar[]; compact: boolean }) {
  const values = bars.flatMap((b) => (b.yen === null ? [] : [b.yen]));
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const yOf = (v: number) => LABEL_SPACE + ((max - v) / range) * PLOT_HEIGHT;
  const zeroY = yOf(0);
  const height = LABEL_SPACE + PLOT_HEIGHT + LABEL_BOTTOM;
  const gap = compact ? 'gap-1.5' : 'gap-3 sm:gap-6';

  const groups = bars.reduce<{ group: 'COMPANY' | 'PROJECT'; count: number }[]>((acc, b) => {
    const last = acc[acc.length - 1];
    if (last && last.group === b.group) last.count += 1;
    else acc.push({ group: b.group, count: 1 });
    return acc;
  }, []);

  return (
    <div className="w-full">
      <div className={`mb-2 flex text-[11px] font-medium text-slate-500 ${gap}`}>
        {groups.map((g, i) => (
          <div key={`${g.group}-${i}`} className="min-w-0 border-b border-slate-200 pb-1 text-center" style={{ flex: g.count }}>
            {g.group === 'COMPANY' ? '全社' : 'プロジェクト'}
          </div>
        ))}
      </div>
      <div className="relative w-full" style={{ height }}>
        <div className="absolute inset-x-0 h-px bg-slate-200" style={{ top: zeroY }} aria-hidden />
        <div className={`absolute inset-0 flex items-stretch ${gap}`}>
          {bars.map((bar, i) => {
            const startsProject = bar.group === 'PROJECT' && i > 0 && bars[i - 1].group === 'COMPANY';
            return (
              <div key={bar.id} className={`relative min-w-0 flex-1 ${startsProject ? 'ml-2 border-l border-slate-100 pl-3 sm:ml-3 sm:pl-6' : ''}`}>
                {bar.yen !== null && bar.yen !== 0 && (
                  <div
                    className={`absolute left-1/2 -translate-x-1/2 ${compact ? 'w-[52%]' : 'w-[58%]'}`}
                    style={{
                      top: Math.min(zeroY, yOf(bar.yen)),
                      height: Math.max(2, Math.abs(yOf(bar.yen) - zeroY)),
                      backgroundColor: BAR_COLOR[bar.id],
                      borderRadius: compact
                        ? bar.yen > 0 ? '10px 10px 0 0' : '0 0 10px 10px'
                        : bar.yen > 0 ? '6px 6px 0 0' : '0 0 6px 6px',
                    }}
                  />
                )}
                {bar.yen !== null && (
                  <div
                    className="absolute inset-x-0 text-center text-[13px] font-semibold tabular-nums text-slate-900"
                    style={bar.yen >= 0 ? { top: yOf(bar.yen) - LABEL_SPACE + 2 } : { top: yOf(bar.yen) + 4 }}
                  >
                    {signedText(bar.yen)}
                  </div>
                )}
                {bar.yen === null && (
                  <div className="absolute inset-x-1 text-center text-[11px] leading-4 text-slate-500" style={{ top: zeroY - 34 }}>
                    {bar.unknownText ?? '未算定'}
                  </div>
                )}
                <div className="absolute inset-x-0 px-0.5 text-center" style={{ top: height - LABEL_BOTTOM + 8 }}>
                  <div className="text-[12px] font-medium leading-4 text-slate-800">{SHORT_LABEL[bar.id]}</div>
                  <div className="mt-0.5 whitespace-nowrap text-[10px] leading-4 text-slate-500">{bar.periodLabel}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AchievementText({ a }: { a: Achievement }) {
  if (a.pct === null) return <span className="text-[13px] font-medium text-slate-500">{a.text}</span>;
  return (
    <span className="text-lg font-semibold tabular-nums text-slate-900">
      {a.pct.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}
      <span className="ml-0.5 text-xs font-medium text-slate-500">%</span>
      {a.reference && <span className="ml-1.5 rounded-full bg-bluegray-mist px-1.5 py-0.5 align-middle text-[10px] font-medium text-bluegray-deep">参考</span>}
    </span>
  );
}

const METRIC_ORDER: PerformanceMetric[] = ['REVENUE', 'OPERATING_INCOME'];

export function PerformanceBarChart({
  view,
  onMetricChange,
  compact = false,
}: {
  view: PerformanceView;
  onMetricChange: (metric: PerformanceMetric) => void;
  /** トップ画面用：余白と文字を詰める */
  compact?: boolean;
}) {
  const cur = view.current;
  const yenText = (yen: number | null, unknown: string | null) =>
    yen === null ? <span className="text-[13px] font-medium text-slate-500">{unknown ?? '未算定'}</span> : <span className="text-lg font-semibold tabular-nums text-slate-900">{formatBarMillion(yen)}</span>;

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="指標の切り替え" className="inline-flex rounded-full bg-slate-100 p-0.5">
          {METRIC_ORDER.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={view.metric === m}
              onClick={() => onMetricChange(m)}
              className={`rounded-full px-4 py-1 text-xs font-semibold transition-colors ${
                view.metric === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-slate-500">単位：百万円</span>
      </div>

      <div role="img" aria-label={`${METRIC_LABEL[view.metric]}の全社とプロジェクトの成果`} className="min-w-0 overflow-x-auto">
        <div className="min-w-[300px]">
          <BarPlot bars={view.bars} compact={compact} />
        </div>
      </div>

      {!compact && (
        <div className="rounded-xl bg-white/70 px-3 py-2.5 ring-1 ring-slate-200/70">
          <div className="mb-1.5 text-[11px] text-slate-500">
            当会計年度（{cur.periodLabel}）のプロジェクト　単位：百万円
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="min-w-0">
              <div className="text-[10px] text-slate-500">目標</div>
              <div className="mt-0.5">{yenText(cur.targetYen, cur.targetUnknownText)}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-slate-500">実績{cur.actualNote ? '（参考）' : ''}</div>
              <div className="mt-0.5">{yenText(cur.actualYen, cur.actualUnknownText)}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-slate-500">達成率</div>
              <div className="mt-0.5">
                {cur.achievement.pct === null ? (
                  <span className="text-[12px] font-medium leading-snug text-slate-500">{cur.achievement.text}</span>
                ) : (
                  <AchievementText a={cur.achievement} />
                )}
              </div>
            </div>
          </div>
          {cur.actualNote && <div className="mt-1.5 text-[11px] text-slate-500">実績：{cur.actualNote}。確定した達成率ではありません。</div>}
        </div>
      )}
    </div>
  );
}
