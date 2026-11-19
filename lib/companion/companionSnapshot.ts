/* ストアの値から、伴走の判定に使う状態を作る（読み取りのみ）。
 * 読み込みが完了していない・失敗した・画面と保存データの会社が一致しない場合は ready=false とし、判定しない。 */

import type { CompanionRole, CompanionSnapshot } from './companionEngine';

export type CompanionStoreFacts = {
  restoreReady: boolean;
  loaded: boolean;
  fetching: boolean;
  hasLoadError: boolean;
  storeCompanyId: string | null;
  strategyId: string | null;
  dirty: boolean;
  currentPath: string;
  companyName: string | undefined;
  financePL: unknown;
  stage1Issues: unknown;
  answers12: unknown;
  finalStory: unknown;
  finalStoryDraft: unknown;
  finalStoryEdited: unknown;
  finalStoryFinal: unknown;
  stage3Bridge: unknown;
  departments: unknown;
  userId: string | null;
  userCompanyId: string | null;
  role: CompanionRole | null;
};

const hasText = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;
const nonEmptyArray = (v: unknown): boolean => Array.isArray(v) && v.length > 0;

function financeEntered(rows: unknown): boolean {
  if (!Array.isArray(rows)) return false;
  return rows.some((r) => {
    if (!r || typeof r !== 'object') return false;
    const row = r as { revenue?: unknown; operatingIncome?: unknown };
    return (typeof row.revenue === 'number' && Number.isFinite(row.revenue))
      || (typeof row.operatingIncome === 'number' && Number.isFinite(row.operatingIncome));
  });
}

function answered(answers: unknown): boolean {
  return Array.isArray(answers)
    && answers.some((a) => a && typeof a === 'object' && hasText((a as { answer?: unknown }).answer));
}

type Project = { planStatus?: unknown; okrsV2?: unknown; okrs?: unknown };
function departmentStats(departments: unknown): { departmentCount: number; projectCount: number; stage4Started: boolean } {
  const depts = Array.isArray(departments) ? departments.filter((d) => d && typeof d === 'object') as { projects?: unknown }[] : [];
  let projectCount = 0;
  let stage4Started = false;
  for (const d of depts) {
    const projects = Array.isArray(d.projects) ? (d.projects as Project[]) : [];
    for (const p of projects) {
      projectCount += 1;
      if (hasText(p?.planStatus)) stage4Started = true;
    }
  }
  return { departmentCount: depts.length, projectCount, stage4Started };
}

export function buildCompanionSnapshot(f: CompanionStoreFacts): CompanionSnapshot {
  const ready = f.restoreReady
    && f.loaded
    && !f.fetching
    && !f.hasLoadError
    && hasText(f.strategyId)
    && hasText(f.storeCompanyId)
    && f.storeCompanyId === f.userCompanyId
    && f.role !== null
    && Array.isArray(f.financePL)
    && Array.isArray(f.stage1Issues)
    && Array.isArray(f.departments);

  const dept = departmentStats(f.departments);
  const stage2Generated = nonEmptyArray(f.finalStory) || nonEmptyArray(f.finalStoryFinal);
  return {
    ready,
    companyId: f.storeCompanyId ?? '',
    strategyId: f.strategyId ?? '',
    role: f.role,
    currentPath: f.currentPath,
    dirty: f.dirty,
    companyNameEntered: hasText(f.companyName),
    financeEntered: financeEntered(f.financePL),
    issueCount: Array.isArray(f.stage1Issues) ? f.stage1Issues.length : 0,
    stage2Started: answered(f.answers12) || stage2Generated
      || nonEmptyArray(f.finalStoryDraft) || nonEmptyArray(f.finalStoryEdited),
    stage2Generated,
    stage2Confirmed: f.stage3Bridge !== null && f.stage3Bridge !== undefined,
    departmentCount: dept.departmentCount,
    projectCount: dept.projectCount,
    stage4Started: dept.stage4Started,
  };
}
