/**
 * _lib/segmentContext.ts
 * Segment and department context management
 */

import { pickName } from './utils';
import { buildDeptFactPack } from './segmentMapping';
import { DeptFactPack } from './types';
import { createHash } from 'crypto';

/**
 * Build fact packs for all departments
 */
export function buildFactPacksForAllDepts(input: any): Map<string, DeptFactPack> {
  const factPackByDept = new Map<string, DeptFactPack>();

  const { departments = [], csvFinanceData, financeSummary, businessPortfolio, businessSegments: allBusinessSegments = [] } = input;

  for (const d of departments) {
    const name = pickName(d);
    if (!name) continue;

    const factPack = buildDeptFactPack(name, allBusinessSegments, csvFinanceData, financeSummary, businessPortfolio);
    factPackByDept.set(name, factPack);
  }

  return factPackByDept;
}
