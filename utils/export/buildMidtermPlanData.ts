/**
 * /utils/export/buildMidtermPlanData.ts
 *
 * StrategyState から中計戦略書プレビュー用のデータを組み立てる
 * STAGE1〜4のデータを統合し、6章構成で表示
 */

import type { StrategyData, MidtermStrategy, Department } from '@/types/strategy';

export type MidtermPlanData = {
  // 全社情報
  companyName?: string;
  companyMission?: string;
  companyVision?: string;

  // STAGE1：現状分析
  stage1: {
    portfolioPosition?: string;
    mainSegments?: string[];
    keyFinances?: string;
    swotStrengths?: string[];
    swotWeaknesses?: string[];
    swotOpportunities?: string[];
    swotThreats?: string[];
  };

  // STAGE2：全社戦略
  stage2: {
    finalStory?: string;
    midtermConcept?: string;
    targetVision?: string;
    priorityThemes?: string[];
    growthStrategy?: string;
    profitStrategy?: string;
    portfolioPolicy?: string;
    decisionCriteria?: string[];
    deploymentPrinciples?: string[];
    managementIssues?: string[];
    companyTargets?: Array<{ label: string; value: string }>;
  };

  // STAGE3：事業・部門別戦略
  stage3: {
    departments: Array<{
      name: string;
      currentPosition?: string;
      strategicRole?: string;
      keyIssues?: string[];
      projects?: string[];
      okrs?: string[];
      intraDeptCollab?: string[];
      interDeptCollab?: string[];
      riskNotes?: string[];
      alignmentRisks?: string[];
    }>;
  };

  // STAGE4：KPI・実行計画
  stage4: {
    companyThemes?: string[];
    companyDecisionCriteria?: string[];
    departmentKpis?: Array<{
      departmentName: string;
      kpis?: string[];
      risks?: string[];
    }>;
  };
};

/**
 * StrategyState から中計戦略書用データを抽出・変換
 */
export function buildMidtermPlanData(state: Partial<StrategyData>): MidtermPlanData {
  const midtermStrategy = (state as any).midtermStrategy as MidtermStrategy | undefined;
  const departments = state.departments || [];

  // STAGE2 データを抽出
  const stage2FinalStory =
    Array.isArray(state.finalStory) && state.finalStory.length > 0
      ? state.finalStory.map((ch) => `【${ch.title}】${ch.body}`).join('\n\n')
      : undefined;

  const companyTargets = Array.isArray(state.companyTargets)
    ? state.companyTargets
        .slice(0, 5)
        .map((t: any) => ({
          label: t?.label || '',
          value: `${t?.base || ''}${t?.unit || ''}${t?.dueYear ? `（${t.dueYear}年）` : ''}`,
        }))
    : [];

  // STAGE1 の SWOT を抽出
  const swotStrengths = typeof state.strength === 'string' && state.strength.trim() ? state.strength.split('、').slice(0, 5) : [];
  const swotWeaknesses = typeof state.weakness === 'string' && state.weakness.trim() ? state.weakness.split('、').slice(0, 5) : [];
  const swotOpportunities = typeof state.opportunity === 'string' && state.opportunity.trim() ? state.opportunity.split('、').slice(0, 5) : [];
  const swotThreats = typeof state.threat === 'string' && state.threat.trim() ? state.threat.split('、').slice(0, 5) : [];

  // STAGE3 の部門データを抽出
  const stage3Depts = departments
    .map((dept: Department) => ({
      name: dept.name || '（未命名）',
      currentPosition: typeof dept.currentPosition === 'string' ? dept.currentPosition : undefined,
      strategicRole: typeof dept.strategicRole === 'string' ? dept.strategicRole : undefined,
      keyIssues: Array.isArray(dept.keyIssues) ? dept.keyIssues.filter((k) => typeof k === 'string' && k.trim()).slice(0, 4) : undefined,
      projects: (Array.isArray(dept.projects) ? dept.projects.map((p: any) => p?.title).filter(Boolean).slice(0, 4) : []),
      okrs: (Array.isArray(dept.okrs)
        ? dept.okrs
            .flatMap((o: any) => {
              const results: string[] = [];
              if (typeof o.objective === 'string' && o.objective.trim()) results.push(o.objective);
              if (Array.isArray(o.keyResults)) {
                results.push(...o.keyResults.filter((kr: any) => typeof kr === 'string' && kr.trim()).slice(0, 2));
              }
              return results;
            })
            .slice(0, 5)
        : []),
      intraDeptCollab: Array.isArray(dept.intraDeptCollab) ? dept.intraDeptCollab.filter((x) => typeof x === 'string').slice(0, 2) : undefined,
      interDeptCollab: Array.isArray(dept.interDeptCollab) ? dept.interDeptCollab.filter((x) => typeof x === 'string').slice(0, 2) : undefined,
      riskNotes: Array.isArray(dept.riskNotes) ? dept.riskNotes.filter((x) => typeof x === 'string').slice(0, 3) : undefined,
      alignmentRisks: Array.isArray(dept.alignmentRiskPoints) ? dept.alignmentRiskPoints.filter((x) => typeof x === 'string').slice(0, 2) : undefined,
    }))
    .slice(0, 10);

  // STAGE4 の KPI 集約
  const deptKpis = stage3Depts.map((dept) => ({
    departmentName: dept.name,
    kpis: [...(dept.okrs || []), ...(dept.projects || [])].slice(0, 6),
    risks: dept.riskNotes,
  }));

  return {
    companyName: state.companyName || state.company?.name,
    companyMission: state.mission,
    companyVision: state.vision,

    stage1: {
      portfolioPosition: state.businessPortfolio?.summary,
      mainSegments: Array.isArray(state.businessSegments) ? state.businessSegments.map((s: any) => s?.name).filter(Boolean).slice(0, 5) : undefined,
      swotStrengths: swotStrengths.length > 0 ? swotStrengths : undefined,
      swotWeaknesses: swotWeaknesses.length > 0 ? swotWeaknesses : undefined,
      swotOpportunities: swotOpportunities.length > 0 ? swotOpportunities : undefined,
      swotThreats: swotThreats.length > 0 ? swotThreats : undefined,
    },

    stage2: {
      finalStory: stage2FinalStory,
      midtermConcept: midtermStrategy?.midtermConcept,
      targetVision: midtermStrategy?.targetVisionForMidterm,
      priorityThemes: midtermStrategy?.priorityStrategicThemes,
      growthStrategy: midtermStrategy?.growthStrategy,
      profitStrategy: midtermStrategy?.profitImprovementStrategy,
      portfolioPolicy: midtermStrategy?.portfolioPolicy,
      decisionCriteria: midtermStrategy?.companyWideDecisionCriteria,
      deploymentPrinciples: midtermStrategy?.deploymentPrinciplesForUnits,
      managementIssues: midtermStrategy?.managementMeetingIssues,
      companyTargets,
    },

    stage3: {
      departments: stage3Depts,
    },

    stage4: {
      companyThemes: midtermStrategy?.priorityStrategicThemes,
      companyDecisionCriteria: midtermStrategy?.companyWideDecisionCriteria,
      departmentKpis: deptKpis,
    },
  };
}
