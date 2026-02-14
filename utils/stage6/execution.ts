/**
 * STAGE6 実行度補正ロジック
 * STAGE5 ログから実行度係数を計算
 */

import { parseMetadata } from '@/utils/execution/metadata';

// ===== Constants: Execution Weight Configuration =====
const EXEC_WEIGHT_MIN = 0.6; // Low execution: conservative floor
const EXEC_WEIGHT_MAX = 1.2; // High execution: prevent over-weight (保守的)
const LOOKBACK_COUNT = 5; // Average over recent N logs

/**
 * Step C-2: 実行度係数を計算（STAGE5ログから）
 *
 * ログ抽出優先度：
 * 1. okrId が指定されていれば meta.okrId で完全一致
 * 2. okrId がなければ meta.projectId で一致（フォールバック）
 * 3. マッチするログがなければ weight=1.0（係数なし）
 *
 * Rating → Weight マッピング：
 * - rating=0.5 (中立) → weight=1.0 (実行状況が平均的)
 * - rating=0.0 (最低) → weight=0.6 (実行が低い場合の下限)
 * - rating=1.0 (最高) → weight=1.2 (実行が高い場合の上限)
 *
 * ※保守的に 1.0 付近の範囲に制限し、過度な変動を防ぐ
 */
export function getExecutionWeight(
  projectTitle: string,
  progressLogs: any[] | undefined,
  options?: {
    lookbackCount?: number;
    minWeight?: number;
    maxWeight?: number;
    okrId?: string; // Optional: if provided, filter by okrId first
  }
): { weight: number; logCount: number; avgRating?: number; notes?: string } {
  const minWeight = options?.minWeight ?? EXEC_WEIGHT_MIN;
  const maxWeight = options?.maxWeight ?? EXEC_WEIGHT_MAX;
  const lookbackCount = options?.lookbackCount ?? LOOKBACK_COUNT;
  const okrId = options?.okrId;

  if (!Array.isArray(progressLogs) || progressLogs.length === 0) {
    return { weight: 1.0, logCount: 0, notes: 'ログなし' };
  }

  // Parse metadata from all logs
  const logsWithMeta = progressLogs
    .map(log => {
      const { metadata, text } = parseMetadata(log.content ?? '');
      return { ...log, metadata, text };
    });

  // Filter by okrId (priority) or projectId (fallback)
  let filteredLogs = logsWithMeta;
  if (okrId) {
    filteredLogs = logsWithMeta.filter(log => log.metadata?.okrId === okrId);
  }
  if (filteredLogs.length === 0) {
    // Fallback to project-level filtering
    filteredLogs = logsWithMeta.filter(log => log.metadata?.projectId === projectTitle);
  }

  if (filteredLogs.length === 0) {
    return { weight: 1.0, logCount: 0, notes: 'ログなし' };
  }

  // Get recent N logs
  const recentLogs = filteredLogs
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, lookbackCount);

  // Calculate average rating from score (0-5 stars) or status
  const ratings = recentLogs
    .map(log => {
      // Convert 0-5 score to 0-1 rating
      if (typeof log.score === 'number' && log.score >= 0 && log.score <= 5) {
        return log.score / 5.0;
      }
      // Fallback to status
      if (log.status === 'ontrack') return 0.8;
      if (log.status === 'atrisk') return 0.5;
      if (log.status === 'offtrack') return 0.3;
      return null;
    })
    .filter((r): r is number => r !== null);

  if (ratings.length === 0) {
    return { weight: 1.0, logCount: recentLogs.length, notes: 'スコアなし' };
  }

  const avgRating = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;

  // Map rating (0-1) to weight (minWeight-maxWeight)
  // rating=0.5 → weight=1.0 (neutral)
  // rating=0 → weight=minWeight
  // rating=1.0 → weight=maxWeight
  const weight = avgRating <= 0.5
    ? minWeight + (avgRating / 0.5) * (1.0 - minWeight)
    : 1.0 + ((avgRating - 0.5) / 0.5) * (maxWeight - 1.0);

  return {
    weight: Math.max(minWeight, Math.min(maxWeight, weight)),
    logCount: recentLogs.length,
    avgRating,
    notes: `直近${recentLogs.length}件平均`,
  };
}
