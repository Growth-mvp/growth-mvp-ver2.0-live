/* 実行計画エンジン評価用の架空データ（実在の企業・顧客ではない） */
import type { RawPlanInput } from '@/lib/stage4/plan/source';

export const COMMERCIAL_INPUT = {
  membershipCompanyId: 'fx-company-interior',
  requestedStrategyId: 'fx-strategy-interior',
  requestedProjectId: 'fx-proj-renovation',
  currentYm: '2026-11',
  strategy: {
    id: 'fx-strategy-interior',
    company_id: 'fx-company-interior',
    companyName: '架空内装株式会社（評価用）',
    strength: '店舗・商業施設の内装を設計から施工まで一貫して手がけられる',
    weakness: '提案の型が担当者の経験に頼っている',
    opportunity: '商業施設でテナントの入れ替えと改装の需要が続いている',
    threat: '工事の繁忙期に施工会社の手配が遅れる',
    finalStory: [
      { title: '第1章 市場の変化', body: '商業施設は来店客の減少とテナントの入れ替えに直面している。' },
      { title: '第2章 勝ち筋', body: '店舗の売上が落ちる兆しを早く示し、改装の判断を早める提案を強める。' },
      { title: '第3章 体制', body: '設計と施工を一体で提供できる強みを、提案の型として標準化する。' },
    ],
    midtermStrategy: {
      priorityStrategicThemes: ['商業施設の改装提案を強化する', '既存顧客の売上変化を見える化する'],
      companyWideDecisionCriteria: ['顧客の売上と来店に効くかで判断する'],
      deploymentPrinciplesForUnits: ['部門の提案件数を、改装の判断までの速さで測る'],
      strategicCore: {
        customerValue: '商業施設の運営者が、テナントの売上低下にいち早く気づき、改装の要否を判断できること',
      },
    },
    financePL: [
      { year: 2025, revenue: 1200000000, operatingIncome: 60000000 },
      { year: 2024, revenue: 1150000000, operatingIncome: 48000000 },
    ],
    valueAnalysis: { operatingMarginPctLatest: 5, roic: 6.2, wacc: 5.5 },
    answers2: [
      {
        chapterIndex: 0,
        chapterTitle: '第1章 市場の変化',
        steps: [
          {
            stepNumber: 1,
            question: 'テナントの売上低下にいつ気づいているか',
            reason: '',
            answer: '月次の売上は見ているが、改装の判断材料としては使えていない',
          },
        ],
      },
    ],
    stage3_strategy_bridge: {
      keyThemes: ['商業施設の改装提案を強化する', '提案の型を標準化する'],
      departmentIssues: ['テナント売上の変化が見えない', '提案が担当者ごとにばらつく'],
      commonBehaviorChanges: ['提案の前に、テナントの売上変化を確認する'],
    },
    departments: [
      {
        id: 'dept-sales',
        name: '営業部',
        mission: '商業施設の改装提案を通じて、既存顧客の売上回復に貢献する',
        strategicRole: '改装提案の件数と、判断までの速さを担う',
        keyIssues: ['テナント売上の変化が見えない', '提案の型が標準化されていない'],
        interDeptCollab: ['設計部と来店客の動線の観点を共有する', '施工管理と改装期間を確認する'],
        alignmentRiskPoints: ['提案件数が施工側の受注余力を超えるおそれ'],
        winPatternPrimary: 'existing-customer',
        focusLevers: ['既存顧客の深耕'],
        projects: [
          {
            id: 'fx-proj-renovation',
            title: '商業施設のテナント売上回復（改装提案）',
            hypothesis: { statement: 'テナント売上の変化を見える化すれば、改装の判断が早まる' },
            rationale: '売上低下の兆しに早く気づける提案は、改装の受注機会を増やす',
            role: 'REVENUE',
            ownerName: '田村 誠（仮）',
            okrsV2: [
              { id: 'fx-kpi-proposals', label: '改装提案を出した商業施設数', target: 3, unit: '件', due: '2027-02', owner: null },
              { id: 'fx-kpi-days', label: '提案から改装の要否決定までの日数', target: 30, unit: '日', due: '2027-05', owner: null },
            ],
          },
          {
            id: 'fx-proj-retention',
            title: '既存顧客の保守契約更新',
            ownerName: '鈴木 一郎（仮）',
            okrsV2: [{ id: 'fx-kpi-retention', label: '保守契約の継続率', target: 95, unit: '%', due: '2027-06', owner: '鈴木 一郎（仮）' }],
          },
        ],
      },
      {
        id: 'dept-design',
        name: '設計部',
        mission: '来店客の動線を踏まえた空間を設計する',
        keyIssues: ['来店客の動線の評価が担当者任せになっている'],
        interDeptCollab: [],
        alignmentRiskPoints: [],
        projects: [
          {
            id: 'fx-proj-layout',
            title: '来店動線の分析手法の標準化',
            okrsV2: [{ id: 'fx-kpi-layout', label: '動線分析を実施した店舗数', target: 5, unit: '件', due: '2027-03', owner: null }],
          },
        ],
      },
    ],
  },
} as unknown as RawPlanInput;
