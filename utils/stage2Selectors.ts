/**
 * STAGE2構造化データの参照を一本化するセレクタ関数群
 *
 * 目的:
 * - valueDriverKPIs / targetRanges / winPatterns などの参照を統一
 * - データ保持の二重化があっても、読み取りは常に同じ優先順位で解決
 * - 将来の保存・復元・マージでの不整合を防止
 *
 * 優先順位ルール:
 * 1. StrategyData直下のフィールド（正式保存先）
 * 2. 互換吸収のための探索パス（stage2 / stage2State / stage2Draft 配下）
 * 3. 空配列 / undefined（フォールバック）
 *
 * 注意:
 * - 空配列・空文字・空オブジェクトは「未設定」として次優先へ回す
 * - 型安全のため、探索パスは controlled な any キャストで実装
 */

import type { StrategyData } from '@/types/strategy';

/* =========================
 * 型
 * ======================= */

export type ValueDriverKPI = {
  id: string;
  label: string;
  description?: string;
  category?: string;
};

export type TargetRanges = {
  low?: Record<string, number>;
  base?: Record<string, number>;
  high?: Record<string, number>;
};

/* =========================
 * ヘルパー関数（値の有効性チェック）
 * ======================= */

/**
 * 配列が有効かどうか（配列で length > 0）
 */
function isValidArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

/**
 * オブジェクトが有効かどうか（オブジェクトで null でない）
 */
function isValidObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 文字列が有効かどうか（文字列で trim 後に length > 0）
 */
function isValidString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * ValueDriverKPI の要素型ガード
 */
function isValueDriverKPI(v: unknown): v is ValueDriverKPI {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    o.id.trim().length > 0 &&
    typeof o.label === 'string' &&
    o.label.trim().length > 0
  );
}

/**
 * unknown から ValueDriverKPI[] を安全に復元（不正要素は捨てる）
 * - 互換吸収：余計なキーがあっても必要最小限に丸める
 */
function coerceValueDriverKPIs(v: unknown): ValueDriverKPI[] {
  if (!Array.isArray(v)) return [];
  const filtered = v.filter(isValueDriverKPI);
  return filtered.map((k) => ({
    id: k.id,
    label: k.label,
    description: k.description,
    category: k.category,
  }));
}

/* =========================
 * セレクタ関数
 * ======================= */

/**
 * Value Driver KPIs を取得
 *
 * 優先順位（後方互換対応）:
 * 1. strategyData.valueDriverKPIs（正式保存先）
 * 2. strategyData.stage2?.valueDriverKPIs
 * 3. strategyData.stage2State?.valueDriverKPIs
 * 4. strategyData.stage2Draft?.valueDriverKPIs
 * 5. 空配列（フォールバック）
 *
 * @param strategyData - StrategyData オブジェクト
 * @returns valueDriverKPIs 配列（常に配列を返す、undefined禁止）
 */
export function getStage2ValueDriverKPIs(
  strategyData: StrategyData | null | undefined
): ValueDriverKPI[] {
  // 優先順位1: StrategyData.valueDriverKPIs（正式保存先）
  const direct = coerceValueDriverKPIs(strategyData?.valueDriverKPIs);
  if (direct.length > 0) return direct;

  // 優先順位2: stage2?.valueDriverKPIs（互換パス）
  const stage2KPIs = (strategyData as any)?.stage2?.valueDriverKPIs;
  const s2 = coerceValueDriverKPIs(stage2KPIs);
  if (s2.length > 0) return s2;

  // 優先順位3: stage2State?.valueDriverKPIs（互換パス）
  const stage2StateKPIs = (strategyData as any)?.stage2State?.valueDriverKPIs;
  const s2s = coerceValueDriverKPIs(stage2StateKPIs);
  if (s2s.length > 0) return s2s;

  // 優先順位4: stage2Draft?.valueDriverKPIs（互換パス）
  const stage2DraftKPIs = (strategyData as any)?.stage2Draft?.valueDriverKPIs;
  const s2d = coerceValueDriverKPIs(stage2DraftKPIs);
  if (s2d.length > 0) return s2d;

  // フォールバック: 空配列
  return [];
}

/**
 * Target Ranges を取得
 *
 * 優先順位（後方互換対応）:
 * 1. strategyData.targetRanges（正式保存先）
 * 2. strategyData.stage2?.targetRanges
 * 3. strategyData.stage2State?.targetRanges
 * 4. strategyData.stage2Draft?.targetRanges
 * 5. undefined（フォールバック）
 *
 * @param strategyData - StrategyData オブジェクト
 * @returns targetRanges オブジェクトまたは undefined
 */
export function getStage2TargetRanges(
  strategyData: StrategyData | null | undefined
): TargetRanges | undefined {
  // 優先順位1: StrategyData.targetRanges（正式保存先）
  if (isValidObject(strategyData?.targetRanges)) {
    return strategyData.targetRanges as TargetRanges;
  }

  // 優先順位2: stage2?.targetRanges（互換パス）
  const stage2Ranges = (strategyData as any)?.stage2?.targetRanges;
  if (isValidObject(stage2Ranges)) {
    return stage2Ranges as TargetRanges;
  }

  // 優先順位3: stage2State?.targetRanges（互換パス）
  const stage2StateRanges = (strategyData as any)?.stage2State?.targetRanges;
  if (isValidObject(stage2StateRanges)) {
    return stage2StateRanges as TargetRanges;
  }

  // 優先順位4: stage2Draft?.targetRanges（互換パス）
  const stage2DraftRanges = (strategyData as any)?.stage2Draft?.targetRanges;
  if (isValidObject(stage2DraftRanges)) {
    return stage2DraftRanges as TargetRanges;
  }

  // フォールバック: undefined
  return undefined;
}

/**
 * Win Patterns (Primary / Secondary) を取得
 *
 * 優先順位（後方互換対応）:
 * 1. strategyData.winPatternPrimary / winPatternSecondary（正式保存先）
 * 2. strategyData.stage2?.winPatternPrimary / winPatternSecondary
 * 3. strategyData.stage2State?.winPatternPrimary / winPatternSecondary
 * 4. strategyData.stage2Draft?.winPatternPrimary / winPatternSecondary
 * 5. undefined（フォールバック）
 *
 * @param strategyData - StrategyData オブジェクト
 * @returns { primary, secondary } オブジェクト
 */
export function getStage2WinPatterns(strategyData: StrategyData | null | undefined): {
  primary: string | undefined;
  secondary: string | undefined;
} {
  let primary: string | undefined = undefined;
  let secondary: string | undefined = undefined;

  // 優先順位1: StrategyData直下（正式保存先）
  if (isValidString(strategyData?.winPatternPrimary)) {
    primary = strategyData.winPatternPrimary;
  }
  if (isValidString(strategyData?.winPatternSecondary)) {
    secondary = strategyData.winPatternSecondary;
  }

  // primary がまだ未設定なら、互換パスを探索
  if (!primary) {
    const stage2Primary = (strategyData as any)?.stage2?.winPatternPrimary;
    if (isValidString(stage2Primary)) {
      primary = stage2Primary;
    } else {
      const stage2StatePrimary = (strategyData as any)?.stage2State?.winPatternPrimary;
      if (isValidString(stage2StatePrimary)) {
        primary = stage2StatePrimary;
      } else {
        const stage2DraftPrimary = (strategyData as any)?.stage2Draft?.winPatternPrimary;
        if (isValidString(stage2DraftPrimary)) {
          primary = stage2DraftPrimary;
        }
      }
    }
  }

  // secondary がまだ未設定なら、互換パスを探索
  if (!secondary) {
    const stage2Secondary = (strategyData as any)?.stage2?.winPatternSecondary;
    if (isValidString(stage2Secondary)) {
      secondary = stage2Secondary;
    } else {
      const stage2StateSecondary = (strategyData as any)?.stage2State?.winPatternSecondary;
      if (isValidString(stage2StateSecondary)) {
        secondary = stage2StateSecondary;
      } else {
        const stage2DraftSecondary = (strategyData as any)?.stage2Draft?.winPatternSecondary;
        if (isValidString(stage2DraftSecondary)) {
          secondary = stage2DraftSecondary;
        }
      }
    }
  }

  return { primary, secondary };
}

/**
 * すべてのSTAGE2構造化データを一括取得
 *
 * 複数のフィールドを一度に取得したい場合に使用
 *
 * @param strategyData - StrategyData オブジェクト
 * @returns STAGE2データオブジェクト
 */
export function getStage2StructuredData(strategyData: StrategyData | null | undefined) {
  return {
    valueDriverKPIs: getStage2ValueDriverKPIs(strategyData),
    targetRanges: getStage2TargetRanges(strategyData),
    winPatterns: getStage2WinPatterns(strategyData),
  };
}
