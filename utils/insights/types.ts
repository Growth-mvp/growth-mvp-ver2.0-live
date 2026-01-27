/**
 * /utils/insights/types.ts
 * STAGE1 Insight Engine の型定義
 *
 * ルールベースで生成される企業価値インパクト分析
 */

/**
 * 企業価値インパクト指標スコア（0-100）
 * - 各指標が「あるべき状態」からどれだけ離れているか
 * - 高いほど課題（または改善余地がある）
 */
export type ImpactScores = {
  /** 成長率指標（売上CAGR等）。低いと低スコア */
  growth?: number;
  /** 収益性指標（営業利益率等）。低いと低スコア */
  profitability?: number;
  /** 資本効率（ROIC等）。低いと低スコア */
  capitalEfficiency?: number;
  /** 財務安全性（D/E等）。高いと低スコア */
  safety?: number;
  /** 株価評価（PBR/PER等）。低いと課題スコア高 */
  valuation?: number;
};

/**
 * 企業価値に対する赤旗（RedFlag）
 * - ビジネスに悪影響を与える可能性がある事実/指標
 */
export type RedFlag = {
  /** 赤旗コード（例：'ROIC_LOW', 'MARGIN_LOW', 'GROWTH_STALLED'） */
  code: string;
  /** ユーザー向けメッセージ */
  message: string;
  /** 根拠データ（例：'ROIC: 3.2% (目標:8%以上)'） */
  evidence?: string;
};

/**
 * 推奨される勝ち筋（WinPattern）
 * - redFlags と valueAnalysis から導出される推奨戦略
 */
export type RecommendedWinPattern = {
  /** 勝ち筋キー（例：'MARGIN_IMPROVEMENT', 'ACQ_FOCUS', 'COST_EFFICIENCY'） */
  key: string;
  /** ユーザー向けラベル（例：'収益性改善'） */
  label: string;
  /** なぜこれを推奨するのか（理由） */
  reason: string;
};

/**
 * 収集すべきデータ（Data To Collect）
 * - valueAnalysis に不足しているデータ
 */
export type DataToCollect = {
  /** フィールド名（例：'roic', 'operatingMarginRate'） */
  field: string;
  /** なぜこれが必要か */
  why: string;
};

/**
 * STAGE1 Insight メイン型
 * - ルールベースで生成される企業価値分析
 * - JSON で systemPrompt に注入される
 */
export type Stage1Insight = {
  /** 各指標の 0-100 スコア */
  impactScores?: ImpactScores;
  /** 企業価値に対する赤旗（課題）一覧 */
  redFlags?: RedFlag[];
  /** 推奨される勝ち筋 */
  recommendedWinPatterns?: RecommendedWinPattern[];
  /** 分析に必要なデータが不足している場合 */
  nextDataToCollect?: DataToCollect[];
};
