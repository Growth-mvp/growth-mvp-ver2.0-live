/* 実行計画エンジン評価用の架空データ（実在の企業・顧客ではない） */
import type { RawPlanInput } from '@/lib/stage4/plan/source';

export const DEEPEN_INPUT = {
  membershipCompanyId: 'fx-company-logistics',
  requestedStrategyId: 'fx-strategy-logistics',
  requestedProjectId: 'fx-proj-additional-delivery',
  currentYm: '2026-11',
  strategy: {
    id: 'fx-strategy-logistics',
    company_id: 'fx-company-logistics',
    companyName: '架空物流株式会社（評価用）',
    strength: '同一地域の配送網を持ち、当日の追加対応ができる',
    weakness: '法人顧客ごとの配送量を把握していない',
    opportunity: '法人顧客の在庫の少量化により、配送回数の需要が増えている',
    threat: '燃料費の上昇',
    finalStory: [
      { title: '第1章 方向性', body: '既存の法人顧客の配送量を増やし、空いている配送枠を活かす。' },
      { title: '第2章 体制', body: '配送の空き枠を営業が把握できる状態にし、提案に使う。' },
    ],
    midtermStrategy: {
      priorityStrategicThemes: ['既存法人顧客の配送量を増やす'],
      companyWideDecisionCriteria: ['配送の空き枠を埋められるかで判断する'],
      deploymentPrinciplesForUnits: ['部門は、既存顧客からの追加受注で成果を示す'],
    },
    financePL: [{ year: 2025, revenue: 8000000000, operatingIncome: 300000000 }],
    valueAnalysis: { operatingMarginPctLatest: 3.8, roic: 5.1, wacc: 4.9 },
    answers2: [],
    stage3_strategy_bridge: {
      keyThemes: ['既存法人顧客の配送量を増やす'],
      departmentIssues: ['顧客ごとの配送量が見えない'],
      commonBehaviorChanges: ['配送の空き枠を、提案の前に確認する'],
    },
    departments: [
      {
        id: 'dept-b-sales',
        name: '営業部',
        mission: '既存の法人顧客からの追加受注を増やす',
        strategicRole: '既存顧客の配送量を増やす',
        keyIssues: ['顧客ごとの配送量が見えない', '追加配送の提案が一部の担当者に偏っている'],
        interDeptCollab: ['配送部と配送の空き枠を共有する'],
        alignmentRiskPoints: ['空き枠の情報が配送部と揃っていない'],
        projects: [
          {
            id: 'fx-proj-additional-delivery',
            title: '既存法人顧客への追加配送の提案',
            hypothesis: '既存顧客の配送量を把握して提案すれば、追加配送の受注が増える',
            rationale: '既存の取引がある顧客は、追加の配送を最も受けやすい',
            role: 'REVENUE',
            ownerName: '佐藤 花子（仮）',
            okrsV2: [
              { id: 'fx-kpi-b1', label: '追加配送を始めた法人顧客数', target: 10, unit: '件', due: '2027-04', owner: '佐藤 花子（仮）' },
              { id: 'fx-kpi-b2', label: '配送提案の実施件数', target: 40, unit: '件', due: '2027-03', owner: '佐藤 花子（仮）' },
            ],
          },
        ],
      },
      {
        id: 'dept-b-ops',
        name: '配送部',
        mission: '配送の効率を保ちながら、空き枠を営業に渡す',
        keyIssues: ['配送の空き枠が営業に見えていない'],
        interDeptCollab: [],
        alignmentRiskPoints: [],
        projects: [
          {
            id: 'fx-proj-slot',
            title: '配送の空き枠の把握',
            okrsV2: [{ id: 'fx-kpi-b3', label: '空き枠を共有した地域数', target: 4, unit: '件', due: '2027-02', owner: null }],
          },
        ],
      },
    ],
  },
} as unknown as RawPlanInput;
