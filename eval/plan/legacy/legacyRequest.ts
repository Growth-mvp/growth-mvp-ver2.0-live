/* 既存STAGE4と新エンジンに同一の入力を渡すためのアダプタ。比較評価専用。
 * 既存の画面（app/okr/page.tsx の projectInfo）と同じ項目を、同じ純粋関数（buildExecutionCompanyContext）で組み立てる。 */
import { buildExecutionCompanyContext, type ExecutionCompanyContext } from '@/lib/stage4/companyContext';
import { buildPlanSource, type RawPlanInput } from '@/lib/stage4/plan/source';
import type { LegacyRequestBody } from './legacyPrompt';

type RawDept = { id?: string | number; name: string; projects: Array<Record<string, any>> };

export function buildLegacyRequest(raw: RawPlanInput): LegacyRequestBody {
  const { source, scope } = buildPlanSource(raw);
  const departments = raw.strategy.departments as unknown as RawDept[];
  const dept = departments.find((d) => String(d.id ?? '') === scope.departmentId)!;
  const project = dept.projects.find((p) => String(p.id ?? '') === scope.projectId)!;
  const mid = raw.strategy.midtermStrategy;

  const companyContext: ExecutionCompanyContext = buildExecutionCompanyContext({
    department: dept as any,
    priorityThemes: mid?.priorityStrategicThemes,
    finalStory: raw.strategy.finalStory,
    financePL: raw.strategy.financePL,
  });

  const hypothesis = source.stage3.project.hypothesis ?? '';
  return {
    departmentName: dept.name,
    projectTitle: project.title ?? '',
    hypothesis,
    rationale: project.rationale ?? '',
    reason: '',
    kind: '',
    mainLever: '',
    horizon: '',
    role: project.role ?? 'REVENUE',
    due: source.stage3.project.kpis.map((k) => k.due).filter((d): d is string => !!d).sort().pop() ?? '',
    ownerName: project.ownerName ?? '',
    sourceKpis: source.stage3.project.kpis.map((k) => k.label),
    companyStrategy: raw.strategy.summary ?? '',
    companyTargets: [],
    companyContext,
  };
}
