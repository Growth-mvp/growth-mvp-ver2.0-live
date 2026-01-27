/**
 * /utils/insights/stage1Insight.ts
 * STAGE1 Insight Engine - ルールベース生成エンジン
 *
 * valueAnalysis / financeSummary / businessPortfolio / issueBlocks から
 * 企業価値インパクトを分析し、赤旗・勝ち筋・必要データを導出
 *
 * 設計方針：
 * - 例外で落とさない（入力が無ければ nextDataToCollect に回す）
 * - ルールは粗くてOK（閾値ゆるく）
 * - JSON サイズ肥大化を避ける（重要度高い情報のみ）
 */

import { Stage1Insight, ImpactScores, RedFlag, RecommendedWinPattern, DataToCollect } from './types';

/**
 * STAGE1 Insight を生成
 *
 * @param args - valueAnalysis, financeSummary等のデータソース
 * @returns ルールベースで生成されたStage1Insight
 */
export function buildStage1Insight(args: {
  strategy?: any;
  valueAnalysis?: any;
  financeSummary?: any;
  businessPortfolio?: any;
  issueBlocks?: any;
}): Stage1Insight {
  const { valueAnalysis, businessPortfolio, issueBlocks } = args;

  const result: Stage1Insight = {};

  // --- 1) impactScores を計算 ---
  const impactScores = computeImpactScores(valueAnalysis);
  if (impactScores && Object.keys(impactScores).length > 0) {
    result.impactScores = impactScores;
  }

  // --- 2) redFlags を抽出 ---
  const redFlags = extractRedFlags(valueAnalysis, issueBlocks);
  if (redFlags.length > 0) {
    result.redFlags = redFlags;
  }

  // --- 3) 推奨される勝ち筋を導出 ---
  const recommendedWinPatterns = deriveWinPatterns(impactScores, redFlags);
  if (recommendedWinPatterns.length > 0) {
    result.recommendedWinPatterns = recommendedWinPatterns;
  }

  // --- 4) 必要なデータを列挙 ---
  const nextDataToCollect = identifyMissingData(valueAnalysis);
  if (nextDataToCollect.length > 0) {
    result.nextDataToCollect = nextDataToCollect;
  }

  return result;
}

/**
 * impactScores を計算（各指標を 0-100 スコアに正規化）
 */
function computeImpactScores(valueAnalysis?: any): ImpactScores | undefined {
  if (!valueAnalysis) return undefined;

  const scores: ImpactScores = {};

  // 成長率: CAGR / revenueCagrPct
  // 低いほど低スコア（0-20% → 0-50, 20%+ → 80+）
  const growthRate = valueAnalysis?.revenueGrowthRate ?? valueAnalysis?.revenueCagrPct;
  if (typeof growthRate === 'number' && growthRate >= 0) {
    scores.growth = Math.min(100, Math.max(0, growthRate * 3)); // 0-33% → 0-100
  }

  // 収益性: operatingMarginRate / operatingMarginPctLatest
  // 低いほど低スコア（0-10% → 0-50, 10%+ → 80+）
  const marginRate = valueAnalysis?.operatingMarginRate ?? valueAnalysis?.operatingMarginPctLatest;
  if (typeof marginRate === 'number' && marginRate >= 0) {
    scores.profitability = Math.min(100, Math.max(0, marginRate * 5)); // 0-20% → 0-100
  }

  // 資本効率: ROIC（%）
  // 低いほど低スコア（0-10% → 0-50, 10%+ → 80+）
  if (typeof valueAnalysis?.roic === 'number' && valueAnalysis.roic >= 0) {
    scores.capitalEfficiency = Math.min(100, Math.max(0, valueAnalysis.roic * 5)); // 0-20% → 0-100
  }

  // 安全性: D/E レシオ（倍率）
  // 高いほど低スコア（1.0以下 → 80+, 2.0以上 → 20以下）
  if (typeof valueAnalysis?.debtEquityRatio === 'number') {
    const de = valueAnalysis.debtEquityRatio;
    scores.safety = Math.min(100, Math.max(0, (2 - de) * 40)); // D/E 0 → 80, 2.5 → 0
  }

  // 株価評価: PBR（倍） / PER（倍）
  // 低いほど割安（1.0以下 → 80+, 2.0以上 → 20以下）
  const pbr = valueAnalysis?.pbr;
  if (typeof pbr === 'number' && pbr > 0) {
    scores.valuation = Math.min(100, Math.max(0, (3 - pbr) * 30)); // PBR 1.0 → 60, 2.5 → 15
  }

  return Object.keys(scores).length > 0 ? scores : undefined;
}

/**
 * redFlags を抽出（ゆるい閾値でフラグ立て）
 */
function extractRedFlags(
  valueAnalysis?: any,
  issueBlocks?: any[]
): RedFlag[] {
  const flags: RedFlag[] = [];

  if (!valueAnalysis) {
    return flags;
  }

  // --- ROIC が低い / 不明 ---
  const roic = valueAnalysis.roic;
  if (roic === undefined || roic === null) {
    flags.push({
      code: 'ROIC_UNKNOWN',
      message: 'ROIC（投下資本利益率）が不明',
      evidence: '投下資本と営業利益の把握が必要',
    });
  } else if (roic < 8) {
    flags.push({
      code: 'ROIC_LOW',
      message: `ROIC が低い: ${roic.toFixed(1)}% （目標：8% 以上）`,
      evidence: `資本効率が不十分。投下資本圧縮 or 収益性向上が必要`,
    });
  }

  // --- 営業利益率が低い ---
  const margin = valueAnalysis.operatingMarginRate ?? valueAnalysis.operatingMarginPctLatest;
  if (margin !== undefined && margin !== null && margin < 5) {
    flags.push({
      code: 'MARGIN_LOW',
      message: `営業利益率が低い: ${margin.toFixed(1)}% （目標：5% 以上）`,
      evidence: '売価/原価/ミックス改善の余地あり',
    });
  }

  // --- 売上成長率が低い ---
  const growth = valueAnalysis.revenueGrowthRate ?? valueAnalysis.revenueCagrPct;
  if (growth !== undefined && growth !== null && growth < 3) {
    flags.push({
      code: 'GROWTH_LOW',
      message: `売上成長率が低い: ${growth.toFixed(1)}% （目標：3% 以上）`,
      evidence: '新規獲得 or ARPU拡大が必要',
    });
  }

  // --- D/E レシオが高い（財務リスク） ---
  const de = valueAnalysis.debtEquityRatio;
  if (de !== undefined && de !== null && de > 2.0) {
    flags.push({
      code: 'DE_HIGH',
      message: `D/E レシオが高い: ${de.toFixed(2)}倍 （安全水準：1.0〜1.5倍）`,
      evidence: '財務余力が制限されている可能性',
    });
  }

  // --- PBR が高い（株価評価が過剰） ---
  const pbr = valueAnalysis.pbr;
  if (pbr !== undefined && pbr !== null && pbr > 2.0) {
    flags.push({
      code: 'PBR_HIGH',
      message: `PBR が高い: ${pbr.toFixed(1)}倍 （平均：1.5倍程度）`,
      evidence: '期待値が高い。下方修正リスクあり',
    });
  }

  // --- IssueBlocks から追加の赤旗を抽出 ---
  if (Array.isArray(issueBlocks) && issueBlocks.length > 0) {
    issueBlocks.slice(0, 2).forEach((issue: any, idx: number) => {
      if (issue?.title && issue?.description) {
        flags.push({
          code: `ISSUE_BLOCK_${idx}`,
          message: `重要課題: ${issue.title}`,
          evidence: issue.description.slice(0, 100),
        });
      }
    });
  }

  return flags;
}

/**
 * redFlags と impactScores から推奨される勝ち筋を導出
 */
function deriveWinPatterns(
  impactScores?: ImpactScores,
  redFlags?: RedFlag[]
): RecommendedWinPattern[] {
  const patterns: RecommendedWinPattern[] = [];

  if (!impactScores && !redFlags) {
    return patterns;
  }

  // --- パターン1: 成長低 × 利益率高 → ARPU/ACQ 拡大 ---
  if (
    impactScores?.growth !== undefined && impactScores.growth < 50 &&
    impactScores?.profitability !== undefined && impactScores.profitability > 60
  ) {
    patterns.push({
      key: 'ACQ_ARPU_EXPANSION',
      label: '顧客獲得・単価拡大',
      reason: '利益基盤は堅牢。成長ドライバーの強化が急務',
    });
  }

  // --- パターン2: 成長高 × 利益率低 → 収益性改善 ---
  if (
    impactScores?.growth !== undefined && impactScores.growth > 60 &&
    impactScores?.profitability !== undefined && impactScores.profitability < 50
  ) {
    patterns.push({
      key: 'MARGIN_IMPROVEMENT',
      label: '収益性改善（価格/原価/ミックス）',
      reason: 'トップライン成長がある。ボトムラインの圧縮が課題',
    });
  }

  // --- パターン3: 資本効率低 → 投下資本圧縮 or 収益化 ---
  if (impactScores?.capitalEfficiency !== undefined && impactScores.capitalEfficiency < 50) {
    patterns.push({
      key: 'CAPITAL_EFFICIENCY',
      label: '資本効率改善（回転率向上 / 在庫削減）',
      reason: '投下資本当たりのリターンが不十分',
    });
  }

  // --- パターン4: 安全性低（D/E高）→ キャッシュ優先 ---
  if (impactScores?.safety !== undefined && impactScores.safety < 40) {
    patterns.push({
      key: 'CASH_PRIORITY',
      label: 'キャッシュ・安全性優先',
      reason: '財務余力が制限されている。利益化・負債圧縮を優先',
    });
  }

  // --- パターン5: ROIC低フラグ → コスト/資本構造改善 ---
  const hasROICFlag = redFlags?.some((f) => f.code === 'ROIC_LOW' || f.code === 'ROIC_UNKNOWN');
  if (hasROICFlag && patterns.length === 0) {
    patterns.push({
      key: 'ROIC_IMPROVEMENT',
      label: 'ROIC向上（構造改善）',
      reason: '投下資本利益率の向上が最優先。事業ポートフォリオの見直しも検討',
    });
  }

  return patterns;
}

/**
 * valueAnalysis に不足しているデータを特定
 */
function identifyMissingData(valueAnalysis?: any): DataToCollect[] {
  const missing: DataToCollect[] = [];

  if (!valueAnalysis) {
    missing.push(
      { field: 'revenueGrowthRate', why: '売上成長率（CAGR%）は勝ち筋判定に必須' },
      { field: 'operatingMarginRate', why: '営業利益率は収益性評価の基本指標' },
      { field: 'roic', why: 'ROIC（投下資本利益率）は資本効率を示す最重要指標' }
    );
    return missing;
  }

  // 各指標のチェック
  if (valueAnalysis.roic === undefined || valueAnalysis.roic === null) {
    missing.push({
      field: 'roic',
      why: 'ROIC計算には営業利益と投下資本が必要（簡易：営業利益 ÷ 純資産）',
    });
  }

  if (
    (valueAnalysis.operatingMarginRate === undefined || valueAnalysis.operatingMarginRate === null) &&
    (valueAnalysis.operatingMarginPctLatest === undefined || valueAnalysis.operatingMarginPctLatest === null)
  ) {
    missing.push({
      field: 'operatingMarginRate',
      why: '営業利益率（営業利益 ÷ 売上）を入力してください',
    });
  }

  if (
    (valueAnalysis.revenueGrowthRate === undefined || valueAnalysis.revenueGrowthRate === null) &&
    (valueAnalysis.revenueCagrPct === undefined || valueAnalysis.revenueCagrPct === null)
  ) {
    missing.push({
      field: 'revenueGrowthRate',
      why: '過去3-5年の売上CAGR（%）を入力してください',
    });
  }

  if (valueAnalysis.debtEquityRatio === undefined || valueAnalysis.debtEquityRatio === null) {
    missing.push({
      field: 'debtEquityRatio',
      why: 'D/E レシオ（総負債 ÷ 純資産）は財務安全性の指標',
    });
  }

  if (valueAnalysis.pbr === undefined || valueAnalysis.pbr === null) {
    missing.push({
      field: 'pbr',
      why: 'PBR（時価総額 ÷ 純資産）は株価評価を示す（非上場企業は推定値も可）',
    });
  }

  return missing;
}
