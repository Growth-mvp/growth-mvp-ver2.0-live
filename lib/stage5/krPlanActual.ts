/* STAGE6 で、STAGE5に登録されたKRの実績を、同じKRの計画（目標）と比べる。
 * KRの実績と財務実績は混同しない。財務の実績は登録が無いため、金額を作らず「実績未登録」と表す。
 * 計画・実績の換算や、財務計画の自動修正はしない。 */
import { progressOf } from './actionProgress';

export type KrComparisonStatus = 'COMPARABLE' | 'NO_ACTUAL' | 'NO_PLAN' | 'NO_ID';

export type KrPlanActualRow = {
  krId: string;
  label: string;
  unit: string;
  due: string | null;
  plan: number | null;
  actual: number | null;
  asOf: string | null;
  status: KrComparisonStatus;
  achievementPct: number | null;
  difference: number | null;
  linkedTotal: number;
  linkedDone: number;
};

export type KrPlanActualProject = {
  projectId: string;
  projectTitle: string;
  departmentName: string;
  rows: KrPlanActualRow[];
};

export const FINANCIAL_ACTUAL_NOTE = '売上・営業利益の実績は、この画面に登録されていないため、財務計画とは比較していません（実績未登録）。';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round1 = (v: number): number => Math.round(v * 10) / 10;

export function buildKrPlanActualRows(departments: unknown): KrPlanActualProject[] {
  const out: KrPlanActualProject[] = [];
  for (const d of Array.isArray(departments) ? departments : []) {
    const projects = Array.isArray((d as { projects?: unknown })?.projects) ? ((d as { projects: unknown[] }).projects) : [];
    for (const p of projects) {
      const project = p as Record<string, unknown>;
      const projectId = typeof project.id === 'string' ? project.id : '';
      if (!projectId) continue;
      const progress = progressOf(project);
      const krs = Array.isArray(project.okrsV2) ? (project.okrsV2 as Array<Record<string, unknown>>) : [];
      const rows: KrPlanActualRow[] = krs.map((k) => {
        const krId = typeof k.id === 'string' ? k.id : '';
        const plan = num(k.target);
        const actualRec = k.actual as { value?: unknown; asOf?: unknown } | undefined;
        const actual = num(actualRec?.value);
        const asOf = typeof actualRec?.asOf === 'string' ? actualRec.asOf : null;
        const unit = typeof k.unit === 'string' ? k.unit : '';
        const linked = Object.values(progress).filter((r) => krId !== '' && r.krIds.includes(krId));
        let status: KrComparisonStatus = 'COMPARABLE';
        if (!krId) status = 'NO_ID';
        else if (plan === null) status = 'NO_PLAN';
        else if (actual === null) status = 'NO_ACTUAL';
        const comparable = status === 'COMPARABLE';
        return {
          krId,
          label: typeof k.label === 'string' ? k.label : '',
          unit,
          due: typeof k.due === 'string' ? k.due : null,
          plan,
          actual,
          asOf,
          status,
          achievementPct: comparable && plan !== null && plan > 0 && actual !== null ? round1((actual / plan) * 100) : null,
          difference: comparable && plan !== null && actual !== null ? round1(actual - plan) : null,
          linkedTotal: linked.length,
          linkedDone: linked.filter((r) => r.status === 'DONE').length,
        };
      });
      out.push({
        projectId,
        projectTitle: typeof project.title === 'string' ? project.title : '',
        departmentName: typeof (d as { name?: unknown })?.name === 'string' ? (d as { name: string }).name : '',
        rows,
      });
    }
  }
  return out;
}
