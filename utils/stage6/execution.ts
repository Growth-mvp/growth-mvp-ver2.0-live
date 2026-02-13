/**
 * STAGE6 実行度補正ロジック
 * STAGE5 ログから実行度係数を計算
 */

/**
 * Step C-2: 実行度係数を計算（STAGE5ログから）
 * 暫定ロジック：
 * - ログが 0 件 → 1.0（通常）
 * - ログの rating から係数を推定（0.6～1.2）
 * - rating がない場合は confidence から推定
 */
export function getExecutionWeight(
  projectName: string,
  _progressLogs: any[] | undefined
): { weight: number; logCount: number; notes?: string } {
  // 暫定: progressLogs はまだ取得されないため、常に 1.0
  // 将来: progressLogs から projectName に合致するログを取得し、
  //       rating / confidence から weight を計算

  if (!Array.isArray(_progressLogs) || _progressLogs.length === 0) {
    return { weight: 1.0, logCount: 0, notes: '未運用' };
  }

  // プロジェクト名で絞る
  const matchingLogs = _progressLogs.filter((log: any) => log.project === projectName);
  if (matchingLogs.length === 0) {
    return { weight: 1.0, logCount: 0, notes: '未運用' };
  }

  // 直近ログの rating を見る
  const latestLog = matchingLogs[matchingLogs.length - 1];
  const rating = latestLog?.rating ?? 0.5; // 0～1

  // rating に基づいて weight を決める（暫定: rating = 0.5 なら weight = 1.0）
  const weight = Math.max(0.6, Math.min(1.2, 0.8 + rating * 0.8)); // 0.6～1.2
  return { weight: weight, logCount: matchingLogs.length, notes: `${matchingLogs.length}件ログ` };
}
