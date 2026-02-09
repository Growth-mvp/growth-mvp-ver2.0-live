/**
 * _lib/projectType.ts
 * Project type classification
 */

import { ProjectType } from './types';

/**
 * ★ TASK 1: projectType を辞書ベースで分類
 * - タイトル/部門名からプロジェクトの性質を推測
 * - LLM 呼び出し前に実行（高速）
 */
export function classifyProjectType(
  projectTitle: string,
  deptName?: string,
  laneType?: 'existing' | 'new'
): ProjectType {
  const titleLower = projectTitle.toLowerCase();
  const deptLower = (deptName ?? '').toLowerCase();
  const combined = `${titleLower} ${deptLower}`;

  // 新規市場/新規開拓系
  if (laneType === 'new' || combined.match(/新規|開拓|ポック|poc|仮説検証|市場検証/)) {
    return 'new_market';
  }

  // 受注/営業プロセス系
  if (
    combined.match(/受注|見積|提案|営業|案件|リード|営業プロセス|見積プロセス/)
  ) {
    return 'sales_process';
  }

  // 顧客調査/理解系
  if (
    combined.match(/ニーズ|調査|ヒアリング|voc|顧客理解|顧客インサイト|ペルソナ|失注|顧客情報/)
  ) {
    return 'customer_research';
  }

  // 在庫/倉庫系
  if (
    combined.match(/在庫|倉庫|棚卸|入出庫|erp|mrp|在庫管理|在庫精度/)
  ) {
    return 'inventory_system';
  }

  // DX/デジタル系
  if (
    combined.match(/dx|デジタル|自動化|システム導入|業務プロセス|rpa|ツール/)
  ) {
    return 'dx';
  }

  // 品質系
  if (
    combined.match(/品質|保証|不良|監査|認証|クレーム|信頼性/)
  ) {
    return 'quality';
  }

  // R&D/開発系
  if (
    combined.match(/研究|開発|r&d|r and d|新商品|プロトタイプ|設計/)
  ) {
    return 'r_and_d';
  }

  return 'default';
}
