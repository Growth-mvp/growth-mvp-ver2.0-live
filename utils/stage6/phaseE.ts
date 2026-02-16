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
import { normalizeValueToUnit, canonicalizeUnit } from './compute';

/**
 * Phase E v1: Forecast 計算（★単位正規化対応）
 *
 * forecast = baseline + Σ(delta * executionWeight * contribution)
 *
 * - baseline: v1では0（future拡張で過去実績ベースライン等を追加可能）
 * - delta: projectTargetImpacts.delta（手入力、target.unit で表現される想定）
 * - executionWeight: STAGE5ログから算出（既存）
 * - contribution: future拡張用（v1では1.0固定）
 *
 * ★重要: forecast と targetBase は同じ単位（target.unit）で計算される前提
 * - delta は既に target.unit で入力されている（UI から）
 * - targetBase も target.unit で保存されている
 * - 達成率計算時は両者が同じ単位で比較可能
 */
export function calculateForecastWithImpacts(args: {
  targetId: string;
  targetBase: number;
  targetUnit: string;
  projectTargetImpacts: ProjectTargetImpact[];
  executionWeights: Map<string, { weight: number }>;
  contributions?: Map<string, number>; // future拡張用
}): {
  forecast: number;  // ★yen単位
  gap: number;       // ★yen単位
  achievementRate: number | undefined; // ★yen単位で計算
  breakdown: Array<{
    projectId: string;
    delta: number;           // targetUnit
    executionWeight: number;
    contribution: number;
    effectiveDelta: number;  // targetUnit
    effectiveDeltaYen: number; // ★yen単位
  }>;
} {
  const { targetId, targetBase, targetUnit, projectTargetImpacts, executionWeights, contributions } = args;

  // ★ TASK-3 + Phase E 修正: targetUnit を先に正規化
  const normalizedUnit = canonicalizeUnit(targetUnit);
  if (!normalizedUnit) {
    console.warn('[TASK-3][phaseE] Unknown unit in calculateForecast', {
      targetId,
      rawUnit: targetUnit,
    });
  }
  const unitForCalc = normalizedUnit || targetUnit;

  // ★Phase E 修正: yen 統一で計算（達成率異常値対策の根本解決）
  // Step 1: targetBase を yen に正規化
  const baseYen = normalizeValueToUnit(targetBase, unitForCalc, 'yen') ?? targetBase;

  // baseline: v1では0
  const baselineYen = 0;

  // 該当 target への影響を集計
  const impacts = projectTargetImpacts.filter((imp) => imp.targetId === targetId);

  const breakdown = impacts.map((imp) => {
    // Step 2: 各 delta を targetUnit から yen へ正規化
    // ★ TASK-3: deltaFromUnit も正規化
    const deltaFromUnit = canonicalizeUnit((imp as any).unit ?? unitForCalc);
    const deltaYen = normalizeValueToUnit(imp.delta ?? 0, deltaFromUnit || unitForCalc, 'yen') ?? (imp.delta ?? 0);

    // Step 3: yen ベースで effectiveDelta を計算
    const executionWeight = executionWeights.get(imp.projectId)?.weight ?? 1.0;
    const contribution = contributions?.get(imp.projectId) ?? 1.0;
    const effectiveDeltaYen = deltaYen * executionWeight * contribution;

    // Step 4: 表示用に unitForCalc に戻す（target.unit ベースで表示）
    const deltaDisplay = imp.delta ?? 0;
    const effectiveDeltaDisplay = normalizeValueToUnit(effectiveDeltaYen, 'yen', unitForCalc) ?? effectiveDeltaYen;

    return {
      projectId: imp.projectId,
      delta: deltaDisplay,           // ユーザー入力値（targetUnit）
      executionWeight,
      contribution,
      effectiveDelta: effectiveDeltaDisplay,  // 表示用（targetUnit）
      effectiveDeltaYen,             // 計算用（yen）
    };
  });

  // Step 5: yen ベースで forecast を計算
  const totalDeltaYen = breakdown.reduce((sum, b) => sum + b.effectiveDeltaYen, 0);
  const forecastYen = baselineYen + totalDeltaYen;
  const gapYen = forecastYen - baseYen;

  // Step 6: yen ベースで achievementRate を計算（これが重要！）
  const achievementRate = baseYen > 0 ? (forecastYen / baseYen) * 100 : undefined;

  return {
    forecast: forecastYen,  // yen単位
    gap: gapYen,            // yen単位
    achievementRate,
    breakdown,
  };
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
 * ★重要: forecast と targetBase が同じ単位（target.unit）で計算される前提
 *      projectTargetImpacts.delta は target.unit で入力されている想定
 */
export function buildNorthStarRowsPhaseE(args: {
  companyTargets: CompanyTarget[];
  projectTargetImpacts: ProjectTargetImpact[];
  executionWeights: Map<string, { weight: number }>;
  contributions?: Map<string, number>;
}): NorthStarRow[] {
  const { companyTargets, projectTargetImpacts, executionWeights, contributions } = args;

  return companyTargets.map((target) => {
    const { forecast: forecastYen, gap: gapYen, achievementRate, breakdown } = calculateForecastWithImpacts({
      targetId: target.id,
      targetBase: target.base,
      targetUnit: target.unit,
      projectTargetImpacts,
      executionWeights,
      contributions,
    });

    // ★Phase E 修正: yen から target.unit に変換（表示用）
    const forecastDisplay = normalizeValueToUnit(forecastYen, 'yen', target.unit) ?? forecastYen;
    const gapDisplay = normalizeValueToUnit(gapYen, 'yen', target.unit) ?? gapYen;

    // ★Debug: 単位確認＆計算検証
    if (process.env.NODE_ENV === 'development' && !!process.env.NEXT_PUBLIC_DEBUG_STAGE6) {
      const canonUnit = canonicalizeUnit(target.unit);
      console.log(`[Phase E 最終検証] ${target.label}:`, {
        rawUnit: target.unit,
        canonUnit,
        baseRaw: target.base,
        baseYen: normalizeValueToUnit(target.base, target.unit, 'yen'),
        forecastYen,
        forecastDisplay,
        gapYen,
        gapDisplay,
        achievementRate: achievementRate?.toFixed(2) + '%',
      });
    }

    // Top 3 contributors
    const sortedByDelta = breakdown.sort(
      (a, b) => Math.abs(b.effectiveDelta) - Math.abs(a.effectiveDelta)
    );

    const topProjects = sortedByDelta.slice(0, 3).map((b) => {
      // projectId から dept/proj を抽出（key形式: dept::proj::idx）
      const parts = b.projectId.includes('::') ? b.projectId.split('::') : b.projectId.split(':');
      return {
        projectId: b.projectId,
        proj: parts[1] ?? b.projectId,
        dept: parts[0] ?? '',
        delta: b.delta,
        executionWeight: b.executionWeight,
        effectiveDelta: b.effectiveDelta,
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
      forecastValue: forecastDisplay,  // ★target.unit で表示
      achievementRate,                 // ★yen ベースで計算（内部用）
      gap: gapDisplay,                 // ★target.unit で表示
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

    // I-1: topProjects を生成（Tab2 と同形式）
    const topProjects = topBreakdown.map((b) => {
      // projectId から dept/proj を抽出（key形式: dept::proj::idx または dept:proj:idx）
      const parts = b.projectId.includes('::') ? b.projectId.split('::') : b.projectId.split(':');
      return {
        projectId: b.projectId,
        dept: parts[0] ?? '',
        proj: parts[1] ?? b.projectId,
        title: `${parts[0] ?? ''}::${parts[1] ?? b.projectId}`,
        strength: b.strength,
        strengthCoef: b.strengthCoef,
        executionWeight: b.executionWeight,
        score: b.score,
        contribution: b.score,
      };
    });

    return {
      issueTitle: issue.title,
      issueDescription: issue.description ?? '',
      linkedMetrics: issue.linkedMetrics,
      linkedTargets: linkedTargetLabels,
      resolutionRate,
      resolutionStatus,
      // I-1: Add breakdown for Top3 display
      breakdown: topBreakdown.length > 0 ? topBreakdown : undefined,
      // I-1: Add topProjects for UI consistency
      topProjects: topProjects.length > 0 ? topProjects : undefined,
    };
  });
}
