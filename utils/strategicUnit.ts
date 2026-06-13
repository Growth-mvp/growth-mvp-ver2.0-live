/**
 * utils/strategicUnit.ts
 * - 事業・部門別戦略（STAGE3）の戦略単位ブリッジ
 * - 既存の Department を StrategicUnit の一種として読み出すための変換関数
 * - 読み取り専用の変換のみ。departments の保存形式・normalize 処理には一切影響しない
 */

import type { Department, StrategicUnit, StrategicUnitType } from '@/types/strategy';

/**
 * Department の種別を StrategicUnitType として解決する。
 * - dept.unitType が明示されていればそれを優先
 * - STAGE1 事業セグメント由来（source: 'stage1' / segmentName あり）は business_unit
 * - departmentType（hr/corp/it/finance/production 等）が付いていれば function
 * - それ以外は other（既存データを誤分類しないための保守的デフォルト）
 */
export function resolveStrategicUnitType(dept: Department): StrategicUnitType {
  if (dept.unitType) return dept.unitType;
  if (dept.source === 'stage1' || dept.segmentName) return 'business_unit';
  if (dept.departmentType) return 'function';
  return 'other';
}

/**
 * 既存の Department を StrategicUnit ビューに変換する（読み取り専用）。
 * - id は既存の stable id（ensureDepartmentId 由来）を文字列化。未付与なら name でフォールバック
 * - KPI はプロジェクト OKR 側に保持されているため、ここでは展開しない（将来拡張）
 */
export function departmentToStrategicUnit(dept: Department): StrategicUnit {
  return {
    id: dept.id != null ? String(dept.id) : dept.name,
    name: dept.name,
    type: resolveStrategicUnitType(dept),
    description: dept.missionDescription || undefined,
    currentRole: dept.mission || undefined,
    strategicRole: dept.strategy || undefined,
    keyStrategies: dept.first90Days && dept.first90Days.length ? dept.first90Days : undefined,
    requiredCrossFunctionalSupport: mergeCollab(dept),
    risks: dept.riskNotes && dept.riskNotes.length ? dept.riskNotes : undefined,
  };
}

/** departments 全体を StrategicUnit ビューに変換する */
export function departmentsToStrategicUnits(departments: Department[] | undefined): StrategicUnit[] {
  return (departments ?? []).map(departmentToStrategicUnit);
}

/** 事業部内連携・他部門連携・旧互換 needsCollab を重複排除して統合 */
function mergeCollab(dept: Department): string[] | undefined {
  const merged = [
    ...(dept.intraDeptCollab ?? []),
    ...(dept.interDeptCollab ?? []),
    ...(dept.needsCollab ?? []),
  ].filter((v) => typeof v === 'string' && v.trim().length > 0);
  if (!merged.length) return undefined;
  return Array.from(new Set(merged));
}
