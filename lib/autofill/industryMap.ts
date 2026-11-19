/* EDINETの提出者業種（東証33業種の名称）を、STAGE1の業種区分（選択できる16区分）に対応させる。
 * 対応は業種名だけで決める（数値からは推測しない）。対応表に無い名称は、業種を埋めず未対応として示す。 */
import { SELECTABLE_INDUSTRY_VALUES, type IndustryValue } from '@/utils/industryTemplates';

export const EDINET_INDUSTRY_TO_STAGE1: Readonly<Record<string, IndustryValue>> = {
  '水産・農林業': 'agri_forestry_fishery',
  鉱業: 'energy_resources',
  建設業: 'construction',
  食料品: 'manufacturing',
  繊維製品: 'manufacturing',
  'パルプ・紙': 'manufacturing',
  化学: 'manufacturing',
  医薬品: 'manufacturing',
  '石油・石炭製品': 'energy_resources',
  ゴム製品: 'manufacturing',
  'ガラス・土石製品': 'manufacturing',
  鉄鋼: 'manufacturing',
  非鉄金属: 'manufacturing',
  金属製品: 'manufacturing',
  機械: 'manufacturing',
  電気機器: 'manufacturing',
  輸送用機器: 'manufacturing',
  精密機器: 'manufacturing',
  その他製品: 'manufacturing',
  '電気・ガス業': 'energy_resources',
  陸運業: 'logistics',
  海運業: 'logistics',
  空運業: 'logistics',
  '倉庫・運輸関連業': 'logistics',
  '情報・通信業': 'it',
  卸売業: 'wholesale',
  小売業: 'retail',
  銀行業: 'finance',
  '証券、商品先物取引業': 'finance',
  保険業: 'finance',
  その他金融業: 'finance',
  不動産業: 'real_estate',
  サービス業: 'service',
};

export type IndustryMapping =
  | { status: 'MAPPED'; value: IndustryValue; edinetName: string }
  | { status: 'UNMAPPED'; edinetName: string | null };

export function mapEdinetIndustry(edinetName: string | null): IndustryMapping {
  const name = edinetName?.trim() ?? '';
  const value = name ? EDINET_INDUSTRY_TO_STAGE1[name] : undefined;
  if (value && (SELECTABLE_INDUSTRY_VALUES as readonly string[]).includes(value)) {
    return { status: 'MAPPED', value, edinetName: name };
  }
  return { status: 'UNMAPPED', edinetName: name || null };
}
