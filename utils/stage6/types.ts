/**
 * STAGE6 固有の型定義
 * UI表示に必要な最小限の型のみ
 */

/**
 * Approved プロジェクト（基本情報）
 */
export type ApprovedProject = {
  key: string;
  dept: string;
  proj: string;
  krCount: number;
  investTotal: number;
};

/**
 * プロジェクト寄与度（タブ1）
 */
export type ProjectContribution = {
  key: string;
  dept: string;
  proj: string;
  investTotal: number;
  krCount: number;
  deltaRevenueTotal: number;
  deltaOpTotal: number;
  roi?: number;
  // ★ Step B: 根拠情報
  evidence?: {
    source: 'kr_bridge' | 'stage4_plan' | 'estimated';
    confidence: 'high' | 'medium' | 'low';
    notes?: string;
  };
  // ★ Step C: 実行度補正
  executionWeight?: {
    weight: number;
    logCount: number;
    notes?: string;
  };
};

/**
 * North Star 比較行（タブ2）
 *
 * H-1: breakdown を追加（Top3寄与プロジェクトの詳細）
 */
export type NorthStarRow = {
  targetId: string;
  label: string;
  unit: string;
  dueYear?: number;
  low?: number;
  base: number;
  high?: number;
  forecastValue?: number;
  achievementRate?: number; // %
  gap?: number;
  topProjects?: Array<{ proj: string; dept: string; contribution: number }>;
  // H-1: Phase E breakdown （delta, executionWeight, effectiveDelta）
  breakdown?: Array<{
    projectId: string;
    delta: number;
    executionWeight: number;
    contribution: number;
    effectiveDelta: number;
  }>;
};

/**
 * 論点解決度（タブ3）
 *
 * I-1: breakdown を追加（Top3寄与プロジェクトと強度係数）
 */
export type IssueResolution = {
  issueTitle: string;
  issueDescription: string;
  linkedMetrics?: string[];
  linkedTargets: string[]; // North Star label
  resolutionRate?: number; // %
  resolutionStatus: 'unconnected' | 'partial' | 'in_progress' | 'achieved';
  // I-1: Phase E breakdown （strength, executionWeight, contribution）
  breakdown?: Array<{
    projectId: string;
    strength: 1 | 2 | 3;
    strengthCoef: number;
    executionWeight: number;
    contribution: number;
    score: number;
  }>;
};

/**
 * STAGE6 コア計算結果
 */
export type Stage6Core = {
  ready: boolean;
  error?: string;
  approved: ApprovedProject[];
  projectKrsMap: Map<string, any[]>;
  baselineYearly: any[];
  yearlyAll: { low: any[]; base: any[]; high: any[] };
  deptNames: string[];
};
