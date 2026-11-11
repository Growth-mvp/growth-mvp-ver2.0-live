import type { MidtermStrategy } from '@/types/strategy';

export type MidtermCandidateField =
  | 'targetVisionForMidterm'
  | 'priorityStrategicThemes'
  | 'companyWideDecisionCriteria'
  | 'deploymentPrinciplesForUnits';

export type MidtermCandidate = {
  field: MidtermCandidateField;
  label: string;
  items: string[];
};

type Bridge = {
  keyThemes?: string[];
  commonBehaviorChanges?: string[];
  departmentTranslationRules?: string[];
  strategicCore?: { customerValue?: string };
} | null | undefined;

const LABELS: Record<MidtermCandidateField, string> = {
  targetVisionForMidterm: '目指す姿',
  priorityStrategicThemes: '重点戦略テーマ',
  companyWideDecisionCriteria: '全社共通の判断基準',
  deploymentPrinciplesForUnits: '部門・社員への展開方針',
};

function cleanItems(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * 空の中計項目について、確定時に作られた既存の構造化データ（STAGE3ブリッジ）から候補を返す。
 * 候補は表示用であり、確定値へは利用者が採用操作をした場合にだけ入る。
 */
export function buildMidtermCandidates(bridge: Bridge, midterm: MidtermStrategy | undefined): MidtermCandidate[] {
  if (!bridge) return [];
  const sources: Array<[MidtermCandidateField, string[]]> = [
    ['targetVisionForMidterm', bridge.strategicCore?.customerValue ? [bridge.strategicCore.customerValue] : []],
    ['priorityStrategicThemes', cleanItems(bridge.keyThemes)],
    ['companyWideDecisionCriteria', cleanItems(bridge.commonBehaviorChanges)],
    ['deploymentPrinciplesForUnits', cleanItems(bridge.departmentTranslationRules)],
  ];
  const candidates: MidtermCandidate[] = [];
  for (const [field, items] of sources) {
    const current = midterm?.[field];
    const filled = Array.isArray(current) ? current.length > 0 : typeof current === 'string' && current.trim() !== '';
    if (filled || items.length === 0) continue;
    candidates.push({ field, label: LABELS[field], items });
  }
  return candidates;
}
