/* 施策の効果額・財務効果の書き込みと、北極星への同期（projectTargetImpacts）。useOkrEditor から分離。 */
import { guardFinanceEffectConfirmation } from '@/lib/financeEffect';
import { newProjectUid, rowsAfterProjectTargetWrite } from './impactRows';

const IMPACT_KEYS = ['impactRevenueMJPY', 'impactOpIncomeMJPY', 'impactRationale', 'impactConfidence'];

function findImpactTargets(companyTargets: any[]) {
  const norm = (s: any) =>
    String(s ?? '')
      .replace(/[\s　]+/g, '')
      .toLowerCase();
  const revenue = companyTargets.find((t: any) => norm(t?.label).includes('売上') || norm(t?.label).includes('revenue'));
  const opIncome = companyTargets.find(
    (t: any) =>
      norm(t?.label).includes('営業利益') ||
      norm(t?.label).includes('営業益') ||
      norm(t?.label).includes('op') ||
      norm(t?.label).includes('operatingincome'),
  );
  return { revenue, opIncome };
}

export function applyProjectImpactPatch(st: any, dIdx: number, pIdx: number, patch: Record<string, any>) {
  const departments: any[] = Array.isArray(st.departments) ? st.departments : [];
  const deptPrev = departments[dIdx];
  if (!deptPrev) return st;

  const projsPrev: any[] = Array.isArray(deptPrev.projects) ? deptPrev.projects : [];
  const projPrev = projsPrev[pIdx];
  if (!projPrev) return st;

  const touchesImpact = IMPACT_KEYS.some((k) => k in patch);
  const guardedPatch =
    'financeEffect' in patch
      ? { ...patch, financeEffect: guardFinanceEffectConfirmation(projPrev.financeEffect, patch.financeEffect) }
      : patch;
  const projectUid = touchesImpact ? projPrev.projectUid ?? newProjectUid() : projPrev.projectUid;
  const nextProj = { ...projPrev, ...guardedPatch, ...(projectUid ? { projectUid } : {}) };

  const nextDepartments = [...departments];
  const nextDept = { ...deptPrev, projects: [...projsPrev] };
  nextDept.projects[pIdx] = nextProj;
  nextDepartments[dIdx] = nextDept;

  if (!touchesImpact) {
    return { ...st, departments: nextDepartments, dirty: true, version: (st.version ?? 0) + 1 };
  }

  const companyTargets = Array.isArray(st.companyTargets) ? st.companyTargets : [];
  const { revenue, opIncome } = findImpactTargets(companyTargets);
  const notesBase = (patch.impactRationale ?? nextProj.impactRationale ?? '').toString().trim();
  const confidence = typeof patch.impactConfidence === 'number' ? patch.impactConfidence : nextProj.impactConfidence;

  let rows: any[] = Array.isArray(st.projectTargetImpacts) ? st.projectTargetImpacts : [];
  const sync = (target: any, valueMJPY: unknown, prefix: string) => {
    if (!target) return;
    const notes = notesBase ? `${prefix} ${notesBase}` : prefix;
    const n = valueMJPY === undefined || valueMJPY === null || valueMJPY === '' ? NaN : Number(valueMJPY);
    rows = rowsAfterProjectTargetWrite({
      rows,
      departments,
      companyTargets,
      dIdx,
      pIdx,
      projectUid,
      targetId: target.id,
      valueMJPY: Number.isFinite(n) ? n : undefined,
      confidence,
      notes,
    });
  };
  sync(revenue, nextProj.impactRevenueMJPY, '[STAGE4] 売上寄与');
  sync(opIncome, nextProj.impactOpIncomeMJPY, '[STAGE4] 営業利益寄与');

  return {
    ...st,
    departments: nextDepartments,
    projectTargetImpacts: rows,
    dirty: true,
    version: (st.version ?? 0) + 1,
  };
}
