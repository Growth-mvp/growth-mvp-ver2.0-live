// /utils/okrToFinance.ts
import type { KRStructured } from '@/types/strategy';
import type { KRStruct } from '@/utils/financeModel';

/**
 * 進化版ブリッジ:
 * - baseKey → financeModel.variable へマッピング
 * - 弾性（elasticity）で活動→指標の変換を反映
 * - 上書き（overrideMode=OVERRIDE）/ 按分（APPORTION）の扱い
 * - ラグ（月）/ 開始月（startYm）など時間パラメータを meta で後段へ連携
 * - churn は retention に符号反転して寄与
 * - success_rate / synergy / revenue は variable には乗せず meta で渡す（後段で別レイヤー集計想定）
 */

type KREx = KRStructured & {
  weight?: number;
  elasticity?: number;
  lagMonths?: number;
  startYm?: string;
  notes?: string;
  overrideMode?: 'APPORTION' | 'OVERRIDE';
  baseOverride?: number;
  // baseline が types に無い場合があるため any セーフティ
  baseline?: number;
  unit?: '%' | '¥' | '件' | '人' | '比率' | string;
  baseKey?: string;
};

type BridgeOptions = {
  /**
   * 按分係数：scopeが会社/部門/プロジェクト跨ぎになるときに、
   * 事前に係数を掛けたい場合に使用（0〜1）。
   * 例）部門内配分で 0.5 を掛ける等。未指定なら 1。
   */
  apportionFactor?: number;
};

/** baseKey → financeModel.variable の対応表 */
const VAR_MAP: Partial<Record<string, KRStruct['variable']>> = {
  acq: 'volume',              // 新規獲得 → 量
  arpu: 'price',              // 単価 → 価格
  churn: 'retention',         // 解約 → 継続（符号注意）
  variable_cost: 'cogsRate',  // 変動費率
  fixed_cost: 'opex',         // 固定費
  personnel_cost: 'opex',     // 人件費
  invest: 'opex',             // 投資は暫定 OPEX に寄せる
  // success_rate / synergy / revenue は variable にマップしない
};

// デフォルト値
const DEFAULT_WEIGHT = 1;
const DEFAULT_ALIGNMENT = 75;

// 単位に応じて値を正規化（必要に応じて調整）
function normalizeByUnit(v: number, unit?: string): number {
  if (unit === '%' || unit === '比率') {
    // 仕様によりパーセント入力（例：5）を 5 のまま扱うか 0.05 にするかはプロジェクト方針次第。
    // ここでは「5% は 0.05 に正規化」して返す。
    return v / 100;
  }
  return v;
}

/**
 * CHURN → retention 変換の符号調整
 * - CHURN の +Δ は RETENTION の -Δ で寄与（逆方向）
 * - ここでは delta を反転して返す。baseline の扱いは financeModel 側で最終決定でもOK
 */
function churnToRetentionDelta(delta: number): number {
  return -delta;
}

/**
 * okrsV2（構造化KR）→ financeModel.KRStruct[] へ変換
 *  - 直接 variable に乗らない KR（success_rate / synergy / revenue）は meta に格納しつつ
 *    financeModel 側に渡らないように filter します。
 */
export function okrsV2ToKRStruct(list: KRStructured[] | undefined, options: BridgeOptions = {}): KRStruct[] {
  if (!Array.isArray(list)) return [];

  const { apportionFactor = 1 } = options;

  return list
    .map((raw): KRStruct | null => {
      const k = raw as KREx;

      const baseKey = k.baseKey ?? (k as any)?.baseKey;
      const variable = baseKey ? VAR_MAP[baseKey] : undefined;

      // variable に乗らないものはここではスキップ（ただし meta としては後段に渡したい場合がある）
      // → 必要であれば別の関数で success_rate / synergy / revenue を処理
      if (!variable) return null;

      // baseline：優先度は baseOverride（OVERRIDE） > baseline（OKRに設定があれば） > 0
      const baselineFromKR = typeof k.baseline === 'number' ? k.baseline : 0;
      const baseline =
        k.overrideMode === 'OVERRIDE' && typeof k.baseOverride === 'number'
          ? k.baseOverride
          : baselineFromKR;

      // target（入力値）→ elasticity・按分・単位正規化を考慮した「寄与Δ」を得る
      const rawTarget = typeof k.target === 'number' ? k.target : 0;
      const unit = k.unit;
      const normalizedTarget = normalizeByUnit(rawTarget, unit);
      const elasticity = typeof k.elasticity === 'number' ? k.elasticity : 1; // elasticity 未設定なら 1
      const weighted = (typeof k.weight === 'number' ? k.weight : DEFAULT_WEIGHT);

      // 活動→指標: 弾性を掛けたデルタ
      let delta = normalizedTarget * elasticity;

      // CHURN → retention の符号反転（baseKey が churn のときのみ）
      if (baseKey === 'churn' && variable === 'retention') {
        delta = churnToRetentionDelta(delta);
      }

      // 按分（画面外の配分計算で渡される係数）
      if (apportionFactor !== 1) {
        delta *= apportionFactor;
      }

      // weight は「寄与の強さ」として最終的に反映（好みで delta に掛ける or weight に渡す）
      // ここでは KRStruct.weight にも入れつつ、delta 自体にも掛けておく（寄与量の直感を合わせる）
      delta *= weighted;

      // financeModel.KRStruct に合わせて詰める
      const out: KRStruct = {
        baseline,
        target: baseline + delta,     // ← target は「新しい水準」を想定（deltaなら別フィールドにしてもよい）
        unit: unit ? String(unit) : '',
        variable,                     // 'price' | 'volume' | 'retention' | 'cogsRate' | 'opex'
        weight: weighted,
        alignmentScore: DEFAULT_ALIGNMENT,
        // @ts-expect-error: financeModel.KRStruct に無い拡張は meta に入れて後段で参照
        meta: {
          // 入力の内訳（後段のデバッグ/説明用）
          input: {
            rawTarget,
            normalizedTarget,
            elasticity,
            apportionFactor,
            appliedDelta: delta,
          },
          time: {
            lagMonths: typeof k.lagMonths === 'number' ? k.lagMonths : 0,
            startYm: k.startYm,
            due: k.due,
          },
          applyMode: k.overrideMode ?? 'APPORTION', // 表示用
          notes: k.notes,
          scope: k.scope,
          kind: k.kind,
          baseKey,
          // もし baseline そのものを上書きしたことを残したい場合のメモ
          baselineOverridden: k.overrideMode === 'OVERRIDE' && typeof k.baseOverride === 'number',
        },
      };

      return out;
    })
    .filter((v): v is KRStruct => v !== null);
}

/* -----------------------------------------
 * （任意）success_rate / synergy / revenue を回収する関数（メタ出力）
 *  - financeModel 変数に乗せないため、別口で返して後段で重ね掛けする想定
 * ----------------------------------------- */
export type MetaKR = {
  kind: KREx['kind'];
  label: KREx['label'];
  baseKey?: string;
  unit?: string;
  target: number;
  weight?: number;
  elasticity?: number;
  lagMonths?: number;
  startYm?: string;
  notes?: string;
};

export function extractMetaOnlyKRs(list: KRStructured[] | undefined): MetaKR[] {
  if (!Array.isArray(list)) return [];
  const PICK = new Set(['success_rate', 'synergy', 'revenue']);
  return list
    .map((raw) => raw as KREx)
    .filter((k) => k.baseKey && PICK.has(k.baseKey))
    .map((k): MetaKR => ({
      kind: k.kind,
      label: k.label,
      baseKey: k.baseKey,
      unit: k.unit,
      target: typeof k.target === 'number' ? k.target : 0,
      weight: typeof k.weight === 'number' ? k.weight : undefined,
      elasticity: typeof k.elasticity === 'number' ? k.elasticity : undefined,
      lagMonths: typeof k.lagMonths === 'number' ? k.lagMonths : undefined,
      startYm: k.startYm,
      notes: k.notes,
    }));
}
