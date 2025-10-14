// /utils/financeModel.ts
/* =========================================================
 * Finance Simulation Core (Stage 4/6)
 * - threeYear(): 3年のPL予測（決定論）
 * - impactModel(): KR → 財務変数への影響係数
 * - successProbability(): 黒字率×整合スコアから成功確率
 * まずは“動く”ことを優先した簡易モデル。後で精緻化可。
 * =======================================================*/

export type YearRow = {
  yearLabel: string;     // 'Y0' | 'Y1' | 'Y2' | 'Y3' ...
  sales: number;         // 売上
  cogs?: number;         // 売上原価
  sga?: number;          // 販管費
  operatingProfit?: number; // 営業利益
};

export type FinanceSummary = {
  // STAGE1で作る基準値（最低限、直近年があればOK）
  baseline: YearRow[];   // 例: [{yearLabel:'Y0', sales:1_000, operatingProfit:100}]
};

// KR（成果）の構造（STAGE3/4想定）
export type KRStruct = {
  baseline: number;      // 現状値
  target: number;        // 目標値
  unit: string;          // '件' | '%' | '人' など
  period?: string;       // 'FY2025 Q1' など
  owner?: string;
  weight?: number;       // 重要度 [0..1]（ない場合は等分）
  // 影響させたい財務変数をざっくり指定（必要に応じて拡張）
  variable?: 'price' | 'volume' | 'retention' | 'cogsRate' | 'opex';
  // AlignmentCheckerのスコア（0..100）。未計算時は省略でOK
  alignmentScore?: number;
};

export type ImpactResult = {
  // 年ごとの係数（倍率や差分）
  salesGrowthRatePerYear: number[];  // 例: [0.08, 0.06, 0.05] → 年次売上成長率
  opMarginDeltaPerYear: number[];    // 例: [+0.01, +0.005, +0.0] → 営業利益率の変化
  notes?: string[];
};

export type ProjectionPoint = {
  year: 'Y1' | 'Y2' | 'Y3';
  sales: number;
  op: number;   // operating profit
  opMargin: number; // op / sales
};

export type Projection = {
  points: ProjectionPoint[];
};

export type SuccessProbInput = {
  projections: Projection;
  alignmentScoreAvg: number; // 0..100
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const safeDiv = (a: number, b: number) => (b === 0 ? 0 : a / b);

/* ---------------------------------------------------------
 * impactModel:
 * KR群 → 年次の「売上成長率」「OPマージン差分」を推定
 * ざっくりルール：
 * - variable に応じて、sales（price/volume/retention） or opMargin（cogsRate/opex）へ寄与
 * - 寄与の大きさは ((target-baseline)/max(|baseline|,1)) × weight で近似
 * - 重要度weight未指定時は均等配分
 * --------------------------------------------------------*/
export function impactModel(krs: KRStruct[]): ImpactResult {
  if (!Array.isArray(krs) || krs.length === 0) {
    return {
      salesGrowthRatePerYear: [0.03, 0.02, 0.02], // デフォルトの控えめ成長
      opMarginDeltaPerYear: [0.002, 0.001, 0],   // わずかに改善
      notes: ['No KR provided: using default lightweight uplift.'],
    };
  }

  const n = krs.length;
  const baseWeight = 1 / n;

  let salesImpact = 0;  // 年率の合計寄与（単純化）
  let marginImpact = 0; // マージン差分合計

  const notes: string[] = [];

  for (const kr of krs) {
    const w = typeof kr.weight === 'number' ? kr.weight : baseWeight;
    const denom = Math.max(Math.abs(kr.baseline), 1);
    const magnitude = (kr.target - kr.baseline) / denom; // 比率変化
    const contrib = magnitude * w;

    switch (kr.variable) {
      case 'price':
      case 'volume':
      case 'retention':
        salesImpact += contrib * 0.5; // 係数は暫定（後で調整可能）
        notes.push(`KR→sales: ${kr.variable} +${(contrib * 50).toFixed(1)}bp/yr`);
        break;
      case 'cogsRate':
        marginImpact += (-contrib) * 0.3; // cogs率↓でmargin↑
        notes.push(`KR→opMargin: cogsRate ${(-contrib * 30).toFixed(1)}bp/yr`);
        break;
      case 'opex':
        marginImpact += (-contrib) * 0.2;  // opex↓でmargin↑
        notes.push(`KR→opMargin: opex ${(-contrib * 20).toFixed(1)}bp/yr`);
        break;
      default:
        // 未指定は売上に薄く効く
        salesImpact += contrib * 0.2;
        notes.push(`KR→sales: (default) +${(contrib * 20).toFixed(1)}bp/yr`);
        break;
    }
  }

  // ↘ 年ごとに減衰（初年度寄与が大きく、徐々に逓減）
  const salesGrowthRatePerYear = [salesImpact, salesImpact * 0.75, salesImpact * 0.5].map((r) =>
    Math.max(-0.3, Math.min(0.5, r)) // 安全ガード
  );
  const opMarginDeltaPerYear = [marginImpact, marginImpact * 0.6, marginImpact * 0.4].map((m) =>
    Math.max(-0.1, Math.min(0.1, m))
  );

  return { salesGrowthRatePerYear, opMarginDeltaPerYear, notes };
}

/* ---------------------------------------------------------
 * threeYear:
 * 直近期（baselineの末尾）をY0として、Y1~Y3を予測
 * - sales: 前年売上 × (1 + growthRateY)
 * - opMargin: 前年op/sales に delta を加え、[0..0.6] にクリップ
 * - op: sales × opMargin
 * --------------------------------------------------------*/
export function threeYear(fin: FinanceSummary, impact: ImpactResult): Projection {
  const y0 = fin?.baseline?.at(-1);
  const startSales = y0?.sales ?? 100; // 最低限動く安全値
  const y0Margin = clamp01(safeDiv(y0?.operatingProfit ?? 10, startSales));

  const growth = impact.salesGrowthRatePerYear ?? [0.03, 0.02, 0.02];
  const marginDelta = impact.opMarginDeltaPerYear ?? [0.0, 0.0, 0.0];

  const points: ProjectionPoint[] = [];
  let prevSales = startSales;
  let prevMargin = y0Margin;

  (['Y1', 'Y2', 'Y3'] as const).forEach((label, idx) => {
    const g = growth[idx] ?? 0;
    const m = marginDelta[idx] ?? 0;

    const sales = Math.max(0, prevSales * (1 + g));
    const opMargin = clamp01(prevMargin + m); // 0..1 の範囲に制限（現実的には 0..0.6）
    const op = sales * opMargin;

    points.push({ year: label, sales, op, opMargin });

    prevSales = sales;
    prevMargin = opMargin;
  });

  return { points };
}

/* ---------------------------------------------------------
 * successProbability:
 * - 黒字率：3年のうち営業利益>0 の年の割合（0..1）
 * - 整合スコア：0..100 → 0..1 に正規化
 * - 最終： 0.5*黒字率 + 0.5*整合スコア
 * --------------------------------------------------------*/
export function successProbability(input: SuccessProbInput): number {
  const { projections, alignmentScoreAvg } = input;
  const n = projections.points.length || 1;
  const blackYears = projections.points.filter((p) => p.op > 0).length;
  const blackRatio = blackYears / n; // 0..1

  const align = clamp01(alignmentScoreAvg / 100);
  const prob = 0.5 * blackRatio + 0.5 * align;

  return clamp01(prob);
}
