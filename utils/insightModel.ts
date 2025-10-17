// /utils/insightModel.ts
export type InsightInput = {
  baseline: { sales: number; op: number } | null; // Y0合算
  y3: { sales: number; op: number; opMargin?: number } | null;
  prob: number; // 0..1
  // KR スナップショット（存在すれば活用）
  krs?: Array<{ variable?: string; baseline?: number; target?: number; unit?: string; weight?: number }>;
};

export type Insight = {
  headline: string;
  highlights: string[];   // 3〜5個
  risks: string[];        // 2〜3個
  levers: string[];       // 2〜4個
  metrics: {
    y0Sales?: number;
    y0Op?: number;
    y3Sales?: number;
    y3Op?: number;
    y3OpMargin?: number;
    salesCAGR?: number;        // %
    opDeltaAbs?: number;       // 絶対額
    opMarginDeltaPctPt?: number; // 乖離(ポイント)
    successProbPct?: number;   // %
  };
};

function pct(n: number, d: number) {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0;
  return (n / d) * 100;
}
function cagr(from: number, to: number, years = 3) {
  if (from <= 0 || to <= 0 || years <= 0) return 0;
  return Math.pow(to / from, 1 / years) - 1;
}
function round1(n: number) { return Math.round(n * 10) / 10; }
function round0(n: number) { return Math.round(n); }

export function generateInsights(input: InsightInput): Insight {
  const y0Sales = input.baseline?.sales ?? 0;
  const y0Op    = input.baseline?.op ?? 0;

  const y3Sales = input.y3?.sales ?? 0;
  const y3Op    = input.y3?.op ?? 0;
  const y3OpMargin = Number.isFinite(input.y3?.opMargin ?? NaN) ? (input.y3!.opMargin!) : (y3Sales ? y3Op / y3Sales : 0);

  const salesCagr = cagr(y0Sales, y3Sales, 3); // 年率
  const opDeltaAbs = y3Op - y0Op;
  const y0OpMargin = y0Sales ? y0Op / y0Sales : 0;
  const opMarginDelta = (y3OpMargin - y0OpMargin) * 100; // ポイント
  const successProbPct = round1((input.prob ?? 0) * 100);

  // ハイライト
  const highlights: string[] = [];
  if (y0Sales && y3Sales) {
    highlights.push(`売上CAGR：${round1(salesCagr * 100)}%（${y0Sales.toLocaleString()} → ${y3Sales.toLocaleString()}）`);
  } else {
    highlights.push(`売上見通し：${y3Sales.toLocaleString()}（Y0不明）`);
  }
  highlights.push(`営業利益：${round0(y3Op).toLocaleString()}（差分 ${opDeltaAbs >= 0 ? '+' : ''}${round0(opDeltaAbs).toLocaleString()}）`);
  highlights.push(`営業利益率：${round1(y3OpMargin * 100)}%（Δ ${round1(opMarginDelta)} pt）`);
  highlights.push(`成功確度：${successProbPct}%`);

  // リスク（確度やマージンの閾値で簡易判定）
  const risks: string[] = [];
  if (successProbPct < 50) risks.push('成功確度が50%未満：施策の実行計画（担当・期日・前提）を再点検');
  if (y3OpMargin < 0.05) risks.push('営業利益率が低位：粗利改善（価格/ミックス/原価）または固定費抑制が必要');
  if (salesCagr < 0.03) risks.push('売上成長が3%未満：新規開拓・チャネル拡張または値上げ余地の検討');

  // レバー（KRスナップショット優先で示唆）
  const levers: string[] = [];
  const vars = new Set(
    (input.krs ?? [])
      .map(k => (k?.variable ?? '').toString().toLowerCase())
      .filter(Boolean)
  );
  const add = (s: string) => { if (!levers.includes(s)) levers.push(s); };

  if (vars.has('volume')) add('需要創造（ボリューム）：既存顧客の拡張/アップセル、休眠覚醒、流入チャネルのCPA最適化');
  if (vars.has('price')) add('単価最適化：プライシング実験、値上げ・値引き条件の明確化、プラン再設計');
  if (vars.has('cogsrate') || vars.has('cogs') || vars.has('grossmargin')) add('粗利改善：仕入・原価の見直し、SKU整理、交渉/代替調達');
  if (vars.has('opex') || vars.has('sgna') || vars.has('opexrate')) add('固定費コントロール：費目別ベンチ・ゼロベース、ROIの低い施策停止');

  // KRがない場合はデフォルト提案
  if (levers.length === 0) {
    add('プライシング再点検：価格-弾力性の計測、提供価値に基づくリフレーミング');
    add('販路拡張：新規チャネル/パートナー開拓、インバウンドのファネル改善');
    add('コスト構造：原価と固定費の二刀流でマージン防衛');
  }

  // 見出し
  const headline =
    successProbPct >= 65
      ? '計画は概ね妥当：実行と追跡で達成確度を高める'
      : successProbPct >= 45
      ? '達成確度は拮抗：優先施策の集中投下と前提の見直しを'
      : '計画はリスク高：成長レバーの再設計と支出の最適化が必要';

  return {
    headline,
    highlights,
    risks,
    levers,
    metrics: {
      y0Sales, y0Op, y3Sales, y3Op, y3OpMargin: round1(y3OpMargin * 100),
      salesCAGR: round1(salesCagr * 100), opDeltaAbs: round0(opDeltaAbs),
      opMarginDeltaPctPt: round1(opMarginDelta), successProbPct,
    },
  };
}
