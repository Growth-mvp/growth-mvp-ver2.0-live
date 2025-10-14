// /types/portfolio.ts

/**
 * ポートフォリオの粒度（事業 / 商品 / サービス）
 */
export type UnitType = 'business' | 'product' | 'service';

/**
 * 4象限の推奨ステージ
 * - invest: 高成長 × 高収益
 * - maintain: 高成長 × 低収益（改善投資）
 * - harvest: 低成長 × 高収益（収穫）
 * - exit: 低成長 × 低収益（撤退）
 */
export type PortfolioStage = 'invest' | 'maintain' | 'harvest' | 'exit';

/**
 * マトリクス上の1バブル（1ユニット）
 */
export type BusinessUnit = {
  id: string;            // uuidなど
  name: string;          // 事業名 / 商品名 / サービス名
  revenueShare: number;  // 売上構成比 [% 0-100]
  growthRate: number;    // 成長率 [% -100〜+300 目安]
  profitMargin: number;  // 利益率 [% -100〜+100]
  stage?: PortfolioStage; // 手動上書き用。通常は classifyStage の推奨を利用
  note?: string;         // 注釈
  color?: string;        // 表示用（任意）
};

/**
 * ステージ判定のための閾値
 */
export type PortfolioThreshold = {
  growthBaseline: number; // 成長率の閾値（%）
  profitBaseline: number; // 利益率の閾値（%）
};

/**
 * 事業ポートフォリオ全体
 */
export type BusinessPortfolio = {
  units: BusinessUnit[];
  threshold: PortfolioThreshold;
  currency: 'JPY' | 'USD' | 'EUR';
  periodLabel: string;   // 例: 'FY2025'
  unitType: UnitType;    // 事業/商品/サービスの粒度
  lastSavedAt?: string | null;
};

/* ============== 便利ユーティリティ（任意で使用） ============== */

/**
 * 閾値に基づき推奨ステージを判定
 */
export function classifyStage(
  growthRate: number,
  profitMargin: number,
  threshold: PortfolioThreshold
): PortfolioStage {
  const g = growthRate >= threshold.growthBaseline;
  const p = profitMargin >= threshold.profitBaseline;
  if (g && p) return 'invest';
  if (g && !p) return 'maintain';
  if (!g && p) return 'harvest';
  return 'exit';
}

/**
 * 型ガード：BusinessPortfolio っぽいものを最低限チェック
 */
export function isBusinessPortfolio(v: unknown): v is BusinessPortfolio {
  const o = v as any;
  return (
    !!o &&
    Array.isArray(o.units) &&
    typeof o.threshold?.growthBaseline === 'number' &&
    typeof o.threshold?.profitBaseline === 'number' &&
    (o.currency === 'JPY' || o.currency === 'USD' || o.currency === 'EUR') &&
    typeof o.periodLabel === 'string' &&
    (o.unitType === 'business' || o.unitType === 'product' || o.unitType === 'service')
  );
}

/**
 * 最小のデフォルトポートフォリオを作成
 * UIの初期表示やテストに便利
 */
export function createDefaultPortfolio(
  unitType: UnitType = 'business',
  periodLabel = 'FY2025',
  currency: BusinessPortfolio['currency'] = 'JPY'
): BusinessPortfolio {
  return {
    units: [],
    threshold: { growthBaseline: 5, profitBaseline: 10 },
    currency,
    periodLabel,
    unitType,
    lastSavedAt: null,
  };
}
