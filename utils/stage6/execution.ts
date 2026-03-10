/**
 * STAGE6 実行度補正ロジック
 * STAGE5 ログから実行度係数を計算
 */

import { parseMetadata } from '@/utils/execution/metadata';

// ===== Constants: Execution Weight Configuration =====
const EXEC_WEIGHT_MIN = 0.6; // Low execution: conservative floor
const EXEC_WEIGHT_MAX = 1.2; // High execution: prevent over-weight (保守的)
const LOOKBACK_COUNT = 5; // Average over recent N logs

// ===== Normalize project name for comparison =====
/**
 * Normalize project name for comparison
 * - trim
 * - remove full-width/half-width spaces
 * - extract last part after :: or ： or ：(full-width colon)
 *
 * Examples:
 * "エンバイロメント事業：自動車メーカー向け次世代製品開発" → "自動車メーカー向け次世代製品開発"
 * "自動車メーカー向け次世代製品開発" → "自動車メーカー向け次世代製品開発"
 * "dept::projectName" → "projectName"
 */
export function normalizeProjectName(name: string | undefined | null): string {
  if (!name) return '';

  // Trim and remove all spaces (full-width and half-width)
  let normalized = String(name)
    .trim()
    .replace(/\s+/g, '')           // half-width space
    .replace(/\u3000+/g, '');      // full-width space

  // Extract last part after :: or ： (full-width) or : (half-width)
  // Priority: :: > ： > :
  const lastColonIdx = Math.max(
    normalized.lastIndexOf('::'),
    normalized.lastIndexOf('：'),
    normalized.lastIndexOf(':')
  );

  if (lastColonIdx >= 0) {
    normalized = normalized.substring(lastColonIdx + (normalized[lastColonIdx] === ':' && normalized[lastColonIdx + 1] === ':' ? 2 : 1));
  }

  return normalized;
}

/**
 * Common matching function for progress logs
 * Returns: { matched: boolean, matchedBy: string }
 */
export function matchProgressLogToProject(args: {
  log: any;
  metadata: any;
  projectTitle: string;
  projectKey?: string;
  okrId?: string;
}): { matched: boolean; matchedBy: string } {
  const { log, metadata, projectTitle, projectKey, okrId } = args;

  // 1. okrId exact match
  if (okrId && metadata?.okrId === okrId) {
    return { matched: true, matchedBy: 'okrId (exact)' };
  }

  // 2. projectKey exact match
  if (projectKey && metadata?.projectKey === projectKey) {
    return { matched: true, matchedBy: 'projectKey (exact)' };
  }

  // 3. projectKey prefix match
  if (projectKey) {
    const prefix = projectKey.split('::').slice(0, 2).join('::'); // Remove index
    if (metadata?.projectKey === prefix) {
      return { matched: true, matchedBy: `projectKey (prefix: ${prefix})` };
    }
  }

  // 4. normalized(meta.projectId) === normalized(projectTitle)
  const normalizedMetaProjectId = normalizeProjectName(metadata?.projectId);
  const normalizedProjectTitle = normalizeProjectName(projectTitle);
  if (
    normalizedMetaProjectId &&
    normalizedProjectTitle &&
    normalizedMetaProjectId === normalizedProjectTitle
  ) {
    return { matched: true, matchedBy: 'projectId (normalized)' };
  }

  // 5. normalized(meta.projectTitle) === normalized(projectTitle)
  const normalizedMetaProjectTitle = normalizeProjectName(metadata?.projectTitle);
  if (
    normalizedMetaProjectTitle &&
    normalizedProjectTitle &&
    normalizedMetaProjectTitle === normalizedProjectTitle
  ) {
    return { matched: true, matchedBy: 'projectTitle (normalized)' };
  }

  return { matched: false, matchedBy: 'no match' };
}

/**
 * Convert progress % to weight
 * 0% → 0.6, 100% → 1.0, 150% → 1.2
 * Linear interpolation, clamped to [0.6, 1.2]
 */
function progressPctToWeight(progressPct: number | undefined | null, minWeight = 0.6, maxWeight = 1.2): number {
  if (typeof progressPct !== 'number' || progressPct < 0) return 1.0;

  // Linear: 0% → 0.6, 100% → 1.0, 150% → 1.2
  const normalizedPct = progressPct / 100;
  const weight = normalizedPct <= 1.0
    ? minWeight + normalizedPct * (1.0 - minWeight)
    : 1.0 + (normalizedPct - 1.0) * (maxWeight - 1.0);

  return Math.max(minWeight, Math.min(maxWeight, weight));
}

/**
 * Step C-2: 実行度係数を計算（STAGE5の進捗率または progress_logs から）
 *
 * 優先順位：
 * 1. project の impactRevenueProgress / impactOpIncomeProgress → weight に変換
 * 2. progress_logs の score → weight に変換
 * 3. どちらもなければ weight=1.0
 *
 * Progress % → Weight マッピング：
 * - 0% → weight=0.6 (進捗なし)
 * - 100% → weight=1.0 (計画どおり)
 * - 150% → weight=1.2 (超過達成)
 *
 * ※保守的に 1.0 付近の範囲に制限し、過度な変動を防ぐ
 */
export function getExecutionWeight(
  projectTitle: string, // ★ 互換性のため引数名は変わらずが、projectKey も受け付ける（deptName::projTitle 形式）
  progressLogs: any[] | undefined,
  options?: {
    lookbackCount?: number;
    minWeight?: number;
    maxWeight?: number;
    okrId?: string; // Optional: if provided, filter by okrId first
    projectKey?: string; // ★ 追加：STAGE6 から明示的に projectKey で検索できるように
    impactRevenueProgress?: number | null; // ★ 新規：STAGE5 マイルストーン完了率
    impactOpIncomeProgress?: number | null; // ★ 新規：STAGE5 マイルストーン完了率
  }
): { weight: number; logCount: number; avgRating?: number; notes?: string } {
  const minWeight = options?.minWeight ?? EXEC_WEIGHT_MIN;
  const maxWeight = options?.maxWeight ?? EXEC_WEIGHT_MAX;
  const lookbackCount = options?.lookbackCount ?? LOOKBACK_COUNT;
  const okrId = options?.okrId;
  const projectKey = options?.projectKey;
  const impactRevenueProgress = options?.impactRevenueProgress;
  const impactOpIncomeProgress = options?.impactOpIncomeProgress;

  // ★ 優先度1: project progress から weight を計算
  // 両方あれば平均、片方あればそれを使用
  if (
    (typeof impactRevenueProgress === 'number' || typeof impactOpIncomeProgress === 'number')
  ) {
    const progresses = [impactRevenueProgress, impactOpIncomeProgress].filter(
      p => typeof p === 'number'
    ) as number[];

    if (progresses.length > 0) {
      const avgProgress = progresses.reduce((a, b) => a + b, 0) / progresses.length;
      const weight = progressPctToWeight(avgProgress, minWeight, maxWeight);
      console.log(
        '[getExecutionWeight-from-project-progress] projectKey=%s, avgProgress=%s%, weight=%s',
        projectKey,
        avgProgress.toFixed(1),
        weight.toFixed(3)
      );
      return {
        weight,
        logCount: 0,
        avgRating: avgProgress / 100,
        notes: `プロジェクト進捗${avgProgress.toFixed(1)}%から算出`,
      };
    }
  }

  // ★ TASK2: 詳細ログ開始 + 正規化
  const normalizedProjectTitle = normalizeProjectName(projectTitle);
  console.group(`[TASK2-getExecutionWeight] projectKey=${projectKey}, projectTitle=${projectTitle}`);
  console.log('Input:', { okrId, projectKey, projectTitle, normalizedProjectTitle, impactRevenueProgress, impactOpIncomeProgress });

  if (!Array.isArray(progressLogs) || progressLogs.length === 0) {
    console.log('No progress logs available');
    console.groupEnd();
    return { weight: 1.0, logCount: 0, notes: 'ログなし' };
  }

  console.log('Total progress logs:', progressLogs.length);

  // Parse metadata from all logs
  const logsWithMeta = progressLogs
    .map(log => {
      const { metadata, text } = parseMetadata(log.content ?? '');
      return { ...log, metadata, text };
    });

  // ★ ログ出し：各ログの metadata (正規化版含む)
  console.group('All logs metadata:');
  logsWithMeta.forEach((log, idx) => {
    const normalizedProjectId = normalizeProjectName(log.metadata?.projectId);
    console.log(`[${idx}]`, {
      'meta.projectKey': log.metadata?.projectKey,
      'meta.projectId': log.metadata?.projectId,
      'meta.projectId (normalized)': normalizedProjectId,
      'meta.deptId': log.metadata?.deptId,
      'meta.okrId': log.metadata?.okrId,
      score: log.score,
      status: log.status,
    });
  });
  console.groupEnd();

  // ★ Use common matching function for all logs
  console.group('Match check per log:');
  const matchResults = logsWithMeta.map(log => {
    const result = matchProgressLogToProject({
      log,
      metadata: log.metadata,
      projectTitle,
      projectKey,
      okrId,
    });
    console.log(`[${log.id}]`, {
      rawProjectId: log.metadata?.projectId,
      normalizedProjectId: normalizeProjectName(log.metadata?.projectId),
      normalizedProjectTitle,
      matched: result.matched,
      matchedBy: result.matchedBy,
      score: log.score,
      scoreUsable: typeof log.score === 'number' && Number.isFinite(log.score),
    });
    return { log, result };
  });
  console.groupEnd();

  // Filter by match result
  let filteredLogs = matchResults.filter(m => m.result.matched).map(m => m.log);

  if (filteredLogs.length === 0) {
    console.log('No logs matched after all conditions');
    console.groupEnd();
    return { weight: 1.0, logCount: 0, notes: 'ログなし' };
  }

  // Get matchedBy from first matched log's condition
  const firstMatch = matchResults.find(m => m.result.matched);
  const matchedBy = firstMatch?.result.matchedBy ?? 'unknown';

  console.log(`Matched by: ${matchedBy}, count: ${filteredLogs.length}`);

  // Get recent N logs
  const recentLogs = filteredLogs
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, lookbackCount);

  // ★ score null を除外
  const logsWithValidScore = recentLogs.filter(log =>
    typeof log.score === 'number' && Number.isFinite(log.score)
  );

  const nullScoreLogs = recentLogs.filter(log =>
    log.score === null || log.score === undefined || !Number.isFinite(log.score)
  );

  console.log(`Score filtering: valid=${logsWithValidScore.length}, null=${nullScoreLogs.length}`);

  // Calculate average rating from score (0-5 stars) or status
  const ratings = logsWithValidScore
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
    console.log('No valid ratings found in recent logs');
    console.groupEnd();
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

  const finalWeight = Math.max(minWeight, Math.min(maxWeight, weight));

  console.log('Final result:', {
    'raw projectTitle': projectTitle,
    'normalized projectTitle': normalizedProjectTitle,
    matchedBy,
    matchedLogCount: filteredLogs.length,
    usableScoreCount: logsWithValidScore.length,
    ratingsCount: ratings.length,
    avgRating,
    weightBefore: weight,
    finalWeight,
    minWeight,
    maxWeight,
  });
  console.groupEnd();

  return {
    weight: finalWeight,
    logCount: recentLogs.length,
    avgRating,
    notes: `直近${recentLogs.length}件平均`,
  };
}
