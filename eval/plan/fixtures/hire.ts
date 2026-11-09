/* 実行計画エンジン評価用の架空データ（実在の企業・顧客ではない）。責任者未設定・戦略ブリッジ無しのケース */
import type { RawPlanInput } from '@/lib/stage4/plan/source';

export const HIRE_INPUT = {
  membershipCompanyId: 'fx-company-manufacturing',
  requestedStrategyId: 'fx-strategy-manufacturing',
  requestedProjectId: 'fx-proj-hiring',
  currentYm: '2026-11',
  strategy: {
    id: 'fx-strategy-manufacturing',
    company_id: 'fx-company-manufacturing',
    companyName: '架空製造株式会社（評価用）',
    strength: '点検の品質を長く保ってきた実績がある',
    weakness: '点検員の育成が先輩の経験に頼っている',
    opportunity: '設備の老朽化で点検の需要が増えている',
    threat: '点検員の採用競争が激しい',
    finalStory: [{ title: '第1章 体制', body: '点検の需要に応えるため、点検員の体制を広げる。' }],
    midtermStrategy: {
      priorityStrategicThemes: ['保守点検の体制を広げる'],
      companyWideDecisionCriteria: ['顧客の設備を止めないことに効くかで判断する'],
      deploymentPrinciplesForUnits: ['部門は、人員計画を売上計画と合わせて示す'],
    },
    financePL: [{ year: 2025, revenue: 3000000000, operatingIncome: 150000000 }],
    valueAnalysis: { operatingMarginPctLatest: 5, roic: 4.4, wacc: 5.0 },
    answers2: [],
    stage3_strategy_bridge: null,
    departments: [
      {
        id: 'dept-hr',
        name: '人事部',
        mission: '点検の体制を支える人材を確保し、育成する',
        strategicRole: '点検員の採用と育成の仕組みを作る',
        keyIssues: ['点検員の育成が先輩の経験に頼っている'],
        interDeptCollab: ['製造部と必要な技能の水準を確認する'],
        alignmentRiskPoints: ['採用計画が製造部の受注計画と合っていない'],
        projects: [
          {
            id: 'fx-proj-hiring',
            title: '点検員の採用と育成計画',
            hypothesis: '育成の手順を整えれば、新任点検員が早く独り立ちできる',
            rationale: '点検の需要に対して人員が不足している',
            role: 'FUTURE',
            ownerName: null,
            okrsV2: [
              { id: 'fx-kpi-c1', label: '点検員の採用人数', target: 2, unit: '人', due: '2027-03', owner: null },
              { id: 'fx-kpi-c2', label: '新任点検員が一人で点検できるまでの期間', target: 6, unit: 'ヶ月', due: '2027-05', owner: null },
            ],
          },
        ],
      },
      {
        id: 'dept-mfg',
        name: '製造部',
        mission: '点検の品質を守り、保守サービスの原価を下げる',
        keyIssues: ['点検工程が人によって違う'],
        interDeptCollab: [],
        alignmentRiskPoints: [],
        projects: [
          {
            id: 'fx-proj-standard',
            title: '点検工程の標準化',
            okrsV2: [{ id: 'fx-kpi-c3', label: '点検報告の当日提出率', target: 90, unit: '%', due: '2027-01', owner: null }],
          },
        ],
      },
    ],
  },
} as unknown as RawPlanInput;
