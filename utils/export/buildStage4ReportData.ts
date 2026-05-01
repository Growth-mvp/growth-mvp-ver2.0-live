/**
 * /utils/export/buildStage4ReportData.ts
 *
 * 目的：
 * - STAGE4 OKR実行計画書用データの構築
 * - 読み取り専用
 */

import type { StrategyState } from '@/store/strategyStore';
import type { Department } from '@/types/strategy';

export interface Stage4ReportData {
  generatedDate: string;

  okrPlans: Array<{
    departmentName: string;
    projectName: string;
    objective: string;
    keyResults: Array<{
      statement: string;
      owner?: string;
      targetValue?: string;
      baseValue?: string;
    }>;
    owner?: string;
    dueDate?: string;
    expectedImpactYen?: number;
    probability?: number;
  }>;

  summary: {
    totalPlans: number;
    totalDepartments: number;
    keyMetrics: Array<{
      name: string;
      value: string;
    }>;
  };
}

/**
 * STAGE4 レポートデータを構築
 */
export function buildStage4ReportData(state: StrategyState): Stage4ReportData {
  const now = new Date();
  const generatedDate = now.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const departments = state.departments || [];

  const okrPlans = extractOkrPlans(departments);
  const summary = buildSummary(okrPlans, departments);

  return {
    generatedDate,
    okrPlans,
    summary,
  };
}

/**
 * OKR計画を抽出（departments[].projects[].okrs から直接取得）
 */
function extractOkrPlans(
  departments: Department[],
): Stage4ReportData['okrPlans'] {
  if (!Array.isArray(departments)) {
    return [];
  }

  const plans: Stage4ReportData['okrPlans'] = [];

  departments.forEach((dept) => {
    if (!Array.isArray(dept.projects)) {
      return;
    }

    dept.projects.forEach((proj) => {
      const okrs = ensureArray(proj.okrs as any[] | undefined);

      okrs.forEach((okr) => {
        if (!okr.objective) {
          return; // 目標が未入力の場合はスキップ
        }

        plans.push({
          departmentName: dept.name || '（部門名不明）',
          projectName: proj.title || '（プロジェクト名不明）',
          objective: okr.objective,
          keyResults: extractKeyResults(okr),
          owner: okr.owner || undefined,
          dueDate: (okr as any)?.dueDate || undefined,
          expectedImpactYen: (okr as any)?.expectedImpactYen,
          probability: (okr as any)?.probability,
        });
      });
    });
  });

  return plans;
}

/**
 * 配列チェックヘルパー
 */
function ensureArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Key Results を抽出
 */
function extractKeyResults(
  plan: any,
): Stage4ReportData['okrPlans'][0]['keyResults'] {
  const keyResults = plan.keyResults || [];

  if (!Array.isArray(keyResults)) {
    return [];
  }

  return keyResults
    .map((kr: any) => ({
      statement:
        typeof kr === 'string'
          ? kr
          : typeof kr === 'object'
            ? kr?.statement || kr?.title || '（KR未入力）'
            : '（KR未入力）',
      owner: kr?.owner || plan?.owner || undefined,
      targetValue: kr?.targetValue || kr?.target || undefined,
      baseValue: kr?.baseValue || kr?.current || undefined,
    }))
    .slice(0, 5);
}

/**
 * 部門IDから部門名を取得
 */
function findDepartmentNameById(
  deptId: string,
  departments: Department[],
): string {
  const dept = departments.find(
    (d) => (d.id || d.name) === deptId || d.name === deptId,
  );
  return dept?.name || '（部門名不明）';
}

/**
 * プロジェクトIDからプロジェクト名を取得
 */
function findProjectNameById(
  projectId: string,
  departmentId: string,
  departments: Department[],
): string {
  const dept = departments.find(
    (d) => (d.id || d.name) === departmentId || d.name === departmentId,
  );

  if (!dept || !Array.isArray(dept.projects)) {
    return '（プロジェクト名不明）';
  }

  const project = dept.projects.find(
    (p) => (p.id || p.title) === projectId || p.title === projectId,
  );

  return project?.title || '（プロジェクト名不明）';
}

/**
 * サマリー統計を構築
 */
function buildSummary(
  okrPlans: Stage4ReportData['okrPlans'],
  departments: Department[],
): Stage4ReportData['summary'] {
  const deptSet = new Set(okrPlans.map((plan) => plan.departmentName));

  const metrics: Array<{ name: string; value: string }> = [];

  metrics.push({
    name: '総OKR数',
    value: okrPlans.length.toString(),
  });

  metrics.push({
    name: '関連部門数',
    value: deptSet.size.toString(),
  });

  // 期待インパクトの合計
  const totalImpact = okrPlans.reduce((sum, plan) => {
    return sum + (plan.expectedImpactYen || 0);
  }, 0);

  if (totalImpact > 0) {
    metrics.push({
      name: '総期待インパクト',
      value: `${(totalImpact / 1000000).toFixed(1)}M円`,
    });
  }

  // 平均成功確率
  const plansWithProbability = okrPlans.filter((p) => p.probability);
  if (plansWithProbability.length > 0) {
    const avgProbability =
      plansWithProbability.reduce((sum, p) => sum + (p.probability || 0), 0) /
      plansWithProbability.length;
    metrics.push({
      name: '平均成功確率',
      value: `${(avgProbability * 100).toFixed(0)}%`,
    });
  }

  return {
    totalPlans: okrPlans.length,
    totalDepartments: deptSet.size,
    keyMetrics: metrics,
  };
}
