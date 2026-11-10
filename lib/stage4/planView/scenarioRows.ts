/* STAGE6の参考シナリオ：STAGE4の計画書（草案・採用・実行開始）から、案件ごとの参考試算を作る。
 * 案件はIDで1対1に対応づける（別の案件の金額は流用しない）。合計は作らない（STAGE6の正式な計画・経路A・経路Bには加算しない）。 */
import { stableIdOf } from '@/lib/stage4/plan/projectResolver';
import { estimateProjectImpact, hypothesisOf, type ImpactEstimate } from './impactEstimate';
import { draftOfBundle } from './regenPreview';

type Json = Record<string, unknown>;

export type ScenarioRecord = {
  key: { projectId: string };
  status?: string;
  aiDraft: Json;
  userEdits: Record<string, unknown>;
  adopted: boolean;
  startInfo?: unknown | null;
};

export type ScenarioRow = {
  deptName: string;
  projectTitle: string;
  projectId: string;
  stateLabel: string;
  estimate: ImpactEstimate;
  overlapNote: string | null;
};

const OVERLAP_NOTE =
  'STAGE3の業績インパクトと同じ効果の可能性があるため、合計には含めていない（正式な反映は、財務効果の確認を経て行う）';

export function scenarioStateLabel(rec: Pick<ScenarioRecord, 'adopted' | 'startInfo'>): string {
  if (rec.startInfo) return '実行開始済み（STAGE5で追跡）';
  if (rec.adopted) return '採用済み（正式な計画には未反映）';
  return '草案（未採用）';
}

export function scenarioRowsOf(args: { departments: unknown; records: ScenarioRecord[] }): ScenarioRow[] {
  const byProject = new Map<string, ScenarioRecord>();
  for (const rec of args.records) {
    if ((rec.status ?? 'DRAFT') !== 'DRAFT') continue;
    byProject.set(rec.key.projectId, rec);
  }
  const rows: ScenarioRow[] = [];
  const departments = Array.isArray(args.departments) ? (args.departments as Json[]) : [];
  for (const dept of departments) {
    const projects = Array.isArray(dept.projects) ? (dept.projects as Json[]) : [];
    for (const project of projects) {
      const id = stableIdOf(project);
      const rec = id ? byProject.get(id) : undefined;
      if (!id || !rec) continue;
      const raw = draftOfBundle(rec.aiDraft);
      const section4 = (raw?.section4 ?? (rec.aiDraft.plan as Json | undefined)?.section4) as Json | undefined;
      const estimate = estimateProjectImpact(project, {
        edits: rec.userEdits,
        hypothesis: hypothesisOf(section4?.financeItems),
      });
      const hasStage3Impact = project.impactRevenueMJPY !== undefined || project.impactOpIncomeMJPY !== undefined;
      rows.push({
        deptName: typeof dept.name === 'string' ? dept.name : '',
        projectTitle: typeof project.title === 'string' ? project.title : '',
        projectId: id,
        stateLabel: scenarioStateLabel(rec),
        estimate,
        overlapNote: hasStage3Impact ? OVERLAP_NOTE : null,
      });
    }
  }
  return rows;
}
