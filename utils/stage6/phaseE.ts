/**
 * STAGE6 Phase E 計算ロジック
 *
 * - projectTargetImpacts を使った Forecast 計算
 * - projectIssueLinks を使った Issue 解決度計算
 *
 * v1 の設計:
 * - contribution は future拡張用（v1では1.0固定）
 * - baseline は future拡張用（v1では0固定）
 * - 正規化は Max正規化（全Issueの最大スコアを100とする）
 */

import type { ProjectTargetImpact, ProjectIssueLink, CompanyTarget } from '@/types/strategy';
import type { NorthStarRow, IssueResolution } from './types';
import { normalizeValueToUnit } from './compute';

/**
 * Phase E v1: Forecast 計算
 *
 * forecast = baseline + Σ(delta * executionWeight * contribution)
 *
 * - baseline: v1では0（future拡張で過去実績ベースライン等を追加可能）
 * - delta: projectTargetImpacts.delta（手入力）
 * - executionWeight: STAGE5ログから算出（既存）
 * - contribution: future拡張用（v1では1.0固定）
 */
export function calculateForecastWithImpacts(args: {
  targetId: string;
  targetBase: number;
  targetUnit: string;
  projectTargetImpacts: ProjectTargetImpact[];
  executionWeights: Map<string, { weight: number }>;
  contributions?: Map<string, number>; // future拡張用
}): {
  forecast: number;
  gap: number;
  breakdown: Array<{
    projectId: string;
    delta: number;
    executionWeight: number;
    contribution: number;
    effectiveDelta: number;
  }>;
} {
  const { targetId, targetBase, projectTargetImpacts, executionWeights, contributions } = args;

  // baseline: v1では0
  const baseline = 0;

  // 該当 target への影響を集計
  const impacts = projectTargetImpacts.filter((imp) => imp.targetId === targetId);

  const breakdown = impacts.map((imp) => {
    const delta = imp.delta ?? 0;
    const executionWeight = executionWeights.get(imp.projectId)?.weight ?? 1.0;
    const contribution = contributions?.get(imp.projectId) ?? 1.0;
    const effectiveDelta = delta * executionWeight * contribution;

    return {
      projectId: imp.projectId,
      delta,
      executionWeight,
      contribution,
      effectiveDelta,
    };
  });

  const totalDelta = breakdown.reduce((sum, b) => sum + b.effectiveDelta, 0);
  const forecast = baseline + totalDelta;
  const gap = forecast - targetBase;

  return { forecast, gap, breakdown };
}

/**
 * Phase E v1: Issue 解決度計算
 *
 * issueScore = normalize(Σ(contribution * executionWeight * strengthCoef))
 * strengthCoef: 1→0.6, 2→1.0, 3→1.3
 * normalize: Max正規化（全Issueの最大スコアを100とする）
 */
export function calculateIssueResolutionWithLinks(args: {
  issueId: string;
  projectIssueLinks: ProjectIssueLink[];
  executionWeights: Map<string, { weight: number }>;
  contributions?: Map<string, number>; // future拡張用
  normalizationMax?: number; // Max正規化用（後で全Issue走査して設定）
}): {
  resolutionScore: number; // 0-100
  resolutionRate: number; // %
  resolutionStatus: 'unconnected' | 'partial' | 'in_progress' | 'achieved';
  breakdown: Array<{
    projectId: string;
    strength: 1 | 2 | 3;
    strengthCoef: number;
    executionWeight: number;
    contribution: number;
    score: number;
  }>;
} {
  const { issueId, projectIssueLinks, executionWeights, contributions, normalizationMax = 100 } = args;

  // 該当 issue への紐付きを集計
  const links = projectIssueLinks.filter((link) => link.issueId === issueId);

  if (links.length === 0) {
    return {
      resolutionScore: 0,
      resolutionRate: 0,
      resolutionStatus: 'unconnected',
      breakdown: [],
    };
  }

  const strengthCoefMap: Record<1 | 2 | 3, number> = {
    1: 0.6,
    2: 1.0,
    3: 1.3,
  };

  const breakdown = links.map((link) => {
    const strength = link.strength ?? 2;
    const strengthCoef = strengthCoefMap[strength];
    const executionWeight = executionWeights.get(link.projectId)?.weight ?? 1.0;
    const contribution = contributions?.get(link.projectId) ?? 1.0;
    const score = contribution * executionWeight * strengthCoef;

    return {
      projectId: link.projectId,
      strength,
      strengthCoef,
      executionWeight,
      contribution,
      score,
    };
  });

  const totalScore = breakdown.reduce((sum, b) => sum + b.score, 0);

  // 正規化: 0-100 スケール（max正規化）
  // normalizationMax に基づいて0-100にスケール
  const resolutionScore = Math.min(100, (totalScore / normalizationMax) * 100);
  const resolutionRate = resolutionScore;

  let resolutionStatus: 'unconnected' | 'partial' | 'in_progress' | 'achieved' = 'unconnected';
  if (resolutionRate >= 100) {
    resolutionStatus = 'achieved';
  } else if (resolutionRate >= 80) {
    resolutionStatus = 'in_progress';
  } else if (resolutionRate > 0) {
    resolutionStatus = 'partial';
  }

  return { resolutionScore, resolutionRate, resolutionStatus, breakdown };
}

/**
 * North Star Rows を Phase E ロジックで再計算
 *
 * H-1: breakdown を NorthStarRow に含める
 */
export function buildNorthStarRowsPhaseE(args: {
  companyTargets: CompanyTarget[];
  projectTargetImpacts: ProjectTargetImpact[];
  executionWeights: Map<string, { weight: number }>;
  contributions?: Map<string, number>;
}): NorthStarRow[] {
  const { companyTargets, projectTargetImpacts, executionWeights, contributions } = args;

  return companyTargets.map((target) => {
    const { forecast, gap, breakdown } = calculateForecastWithImpacts({
      targetId: target.id,
      targetBase: target.base,
      targetUnit: target.unit,
      projectTargetImpacts,
      executionWeights,
      contributions,
    });

    const achievementRate = target.base > 0 ? (forecast / target.base) * 100 : undefined;

    // Top 3 contributors
    const sortedByDelta = breakdown.sort(
      (a, b) => Math.abs(b.effectiveDelta) - Math.abs(a.effectiveDelta)
    );

    const topProjects = sortedByDelta.slice(0, 3).map((b) => {
      // projectId から dept/proj を抽出（key形式: dept::proj::idx）
      const parts = b.projectId.split('::');
      return {
        proj: parts[1] ?? b.projectId,
        dept: parts[0] ?? '',
        contribution: b.effectiveDelta,
      };
    });

    return {
      targetId: target.id,
      label: target.label,
      unit: target.unit,
      dueYear: target.dueYear,
      low: target.low,
      base: target.base,
      high: target.high,
      forecastValue: forecast,
      achievementRate,
      gap,
      topProjects: topProjects.length > 0 ? topProjects : undefined,
      // H-1: Add breakdown for detailed display
      breakdown: sortedByDelta.length > 0 ? sortedByDelta : undefined,
    };
  });
}

/**
 * Issue Resolutions を Phase E ロジックで再計算
 *
 * I-1: breakdown を IssueResolution に含める
 * 正規化: 全Issueの最大スコアを100とするMax正規化を使用
 */
export function buildIssueResolutionsPhaseE(args: {
  stage1Issues: Array<{ title: string; description: string; linkedMetrics?: string[] }>;
  companyTargets: CompanyTarget[];
  projectIssueLinks: ProjectIssueLink[];
  executionWeights: Map<string, { weight: number }>;
  contributions?: Map<string, number>;
}): IssueResolution[] {
  const { stage1Issues, companyTargets, projectIssueLinks, executionWeights, contributions } = args;

  // Step 1: 全Issueのスコアを計算して最大値を求める（Max正規化のため）
  const allScores = stage1Issues.map((issue) => {
    const links = projectIssueLinks.filter((link) => link.issueId === issue.title);
    if (links.length === 0) return 0;

    const strengthCoefMap: Record<1 | 2 | 3, number> = { 1: 0.6, 2: 1.0, 3: 1.3 };
    const totalScore = links.reduce((sum, link) => {
      const strengthCoef = strengthCoefMap[link.strength ?? 2];
      const executionWeight = executionWeights.get(link.projectId)?.weight ?? 1.0;
      const contribution = contributions?.get(link.projectId) ?? 1.0;
      return sum + contribution * executionWeight * strengthCoef;
    }, 0);

    return totalScore;
  });

  const maxScore = Math.max(...allScores, 100); // 最低でも100を基準値として使用

  // Step 2: 各Issueの解決度を計算
  return stage1Issues.map((issue) => {
    // Issue に紐づく CompanyTarget を取得（CompanyTarget.linkedIssueIds 経由）
    const linkedTargets = companyTargets.filter((t) =>
      (t.linkedIssueIds ?? []).includes(issue.title)
    );
    const linkedTargetLabels = linkedTargets.map((t) => t.label);

    // Phase E ロジックで解決度を計算
    const { resolutionRate, resolutionStatus, breakdown } = calculateIssueResolutionWithLinks({
      issueId: issue.title,
      projectIssueLinks,
      executionWeights,
      contributions,
      normalizationMax: maxScore,
    });

    // I-1: Top3 contributors を取得
    const topBreakdown = breakdown
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return {
      issueTitle: issue.title,
      issueDescription: issue.description ?? '',
      linkedMetrics: issue.linkedMetrics,
      linkedTargets: linkedTargetLabels,
      resolutionRate,
      resolutionStatus,
      // I-1: Add breakdown for Top3 display
      breakdown: topBreakdown.length > 0 ? topBreakdown : undefined,
    };
  });
}
