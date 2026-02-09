/**
 * _lib/constants.ts
 * Shared constants for cascade generation
 */

/**
 * Stop words for similarity calculation
 * Used in conflict detection to filter out common/generic words
 */
export const STOP_WORDS_TASK3 = new Set([
  '高付加価値', '付加価値', '強化', '改善', '推進', '最適化', '効率化', '省力化', '標準化',
  '商談', '案件', '受注', '獲得', '拡大', '新規開拓', '顧客開拓',
  '次世代', '仮説', '検証', '実証', 'poc', 'PoC', 'パイロット',
  'dx', 'DX', 'デジタル', 'データ活用', '体制', 'プロセス', '仕組み',
]);

/**
 * Generic project titles that indicate template-based generation
 */
export const GENERIC_BASE_TITLES = [
  '既存顧客のltv改善',
  '商談設計力の強化',
  '次世代サービス仮説検証',
];
