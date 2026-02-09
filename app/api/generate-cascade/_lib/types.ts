/**
 * _lib/types.ts
 * Type definitions for cascade generation
 */

// ★ TASK 1: projectType を辞書ベースで分類
export type ProjectType =
  | 'sales_process'
  | 'customer_research'
  | 'inventory_system'
  | 'new_market'
  | 'dx'
  | 'quality'
  | 'r_and_d'
  | 'default';

// ★ TASK 3: KRI validation
export type ValidationResult = {
  ok: boolean;
  reasons: string[];
};

// ★ TASK 2-3: KR専用生成結果
export type GenKRResult = {
  keyResults: Array<{ label: string; unit?: string | null }>;
  errorCode?: 'ai_error_network' | 'ai_error_parse' | 'ai_error_schema';
};

// FACTPACK構造
export type FactAnchor = {
  id: string;
  text: string;
  source?: 'overview' | 'customers' | 'finance';
};

export type DeptFactPack = {
  segmentName: string;
  anchors: FactAnchor[];
  customers: string[];
  overview: string;
  financeHints: string[];
};

// 正規化されたプロジェクト
export type NormProject = {
  title: string;
  reason?: string;
  hypothesis?: string;
  mainLever?: 'ACQ' | 'ARPU' | 'CHURN' | 'COST' | 'EFFICIENCY' | 'FUTURE';
  horizon?: 'short' | 'mid' | 'long';
  kind?: 'growth' | 'cost' | 'efficiency' | 'future';
};
