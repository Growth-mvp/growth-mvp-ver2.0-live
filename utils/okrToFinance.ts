// /utils/okrToFinance.ts
import type { KRStructured } from '@/types/strategy';
import type { KRStruct } from '@/utils/financeModel';

/**
 * baseKey → financeModel.variable の対応表
 * financeModel 側の許容は: 'price' | 'volume' | 'retention' | 'cogsRate' | 'opex'
 * それ以外（success_rate / synergy / revenue など）は、ここではマッピングしない（=除外）。
 */
const VAR_MAP: Partial<Record<string, KRStruct['variable']>> = {
  acq: 'volume',              // 新規獲得 → 量（ボリューム）
  arpu: 'price',              // 単価 → 価格
  churn: 'retention',         // 解約率 → 継続（逆方向で寄与）
  variable_cost: 'cogsRate',  // 変動費率 → 粗利率に影響
  fixed_cost: 'opex',         // 固定費 → OPEX
  personnel_cost: 'opex',     // 人件費 → OPEX
  invest: 'opex',             // 投資 → ここでは OPEX に寄せる（必要なら別変数を追加検討）
  // success_rate / synergy / revenue は financeModel の variable 型に無いため割り当てない
};

// KR 重み・整合性スコアのデフォルト（必要に応じて調整）
const DEFAULT_WEIGHT = 0.2;
const DEFAULT_ALIGNMENT = 75;

/** okrsV2（構造化KR）→ financeModel.KRStruct[] へ変換 */
export function okrsV2ToKRStruct(list: KRStructured[] | undefined): KRStruct[] {
  if (!Array.isArray(list)) return [];

  return list
    .map((k): KRStruct | null => {
      const baseKey = (k as any)?.baseKey as string | undefined;
      const variable = baseKey ? VAR_MAP[baseKey] : undefined;

      // financeModel 側に存在しない variable はスキップ
      if (!variable) return null;

      const baseline =
        typeof (k as any)?.baseline === 'number' ? (k as any).baseline : 0;
      const target =
        typeof (k as any)?.target === 'number' ? (k as any).target : 0;
      const unit = (k as any)?.unit ? String((k as any).unit) : '';

      return {
        baseline,
        target,
        unit,
        variable,                // ← 'price' | 'volume' | 'retention' | 'cogsRate' | 'opex'
        weight: DEFAULT_WEIGHT,  // ← KRStructured には無いのでデフォルト採用
        alignmentScore: DEFAULT_ALIGNMENT,
      };
    })
    .filter((v): v is KRStruct => v !== null);
}
