/* 品質評価セット①：成長戦略型（新市場・新用途開拓）。架空データ。
 * 期間の根拠：全社計画期間（2028年度・3月決算）。財務：営業利益率が1%台で投資余力は限られる。 */
import type { RawPlanInput } from '@/lib/stage4/plan/source';

export const GROWTH_INPUT = {
  membershipCompanyId: 'qg-company',
  requestedStrategyId: 'qg-strategy',
  requestedProjectId: 'qg-proj-medical',
  currentYm: '2026-11',
  strategy: {
    id: 'qg-strategy',
    company_id: 'qg-company',
    companyName: '架空精密計測株式会社（評価用）',
    summary: '工場向けの計測器で培った精度を、医療機関の感染対策など新しい用途へ広げ、2028年度に新用途の売上を柱の一つにする。',
    strength: '工場向けの計測器で、高い精度と長い稼働実績を持つ',
    weakness: '医療機関の業務や購買の流れを知る社員が少ない',
    opportunity: '院内感染対策の記録を自動化したいという医療機関の需要が増えている',
    threat: '医療機器としての規制対応に時間と費用がかかる',
    periodEndYear: '2028',
    fiscalYearEnd: '3',
    finalStory: [
      { title: '第1章 現状', body: '主力の工場向け計測器は国内で安定しているが、新規の設備投資は頭打ちになっている。' },
      { title: '第2章 勝ち筋', body: '既存の計測技術を医療現場の記録業務へ転用し、少ない投資で新しい顧客を開拓する。' },
      { title: '第3章 体制', body: '新用途の顧客の声を製品開発に戻し、試験導入の数で進捗を測る。' },
    ],
    midtermStrategy: {
      priorityStrategicThemes: ['既存の計測技術を医療現場へ展開する', '新用途の顧客の声を製品開発に戻す'],
      companyWideDecisionCriteria: ['投資は、回収期間を明示して判断する'],
      deploymentPrinciplesForUnits: ['新用途は、試験導入の数で進捗を測る'],
      strategicCore: {
        customerValue: '医療機関の感染対策担当者が、計測の手間を減らして確実に記録できること',
      },
    },
    financePL: [
      { year: 2025, revenue: 4200000000, operatingIncome: 42000000 },
      { year: 2024, revenue: 4050000000, operatingIncome: 60750000 },
      { year: 2023, revenue: 3900000000, operatingIncome: 74100000 },
    ],
    valueAnalysis: { operatingMarginPctLatest: 1.0, roic: 2.1, wacc: 5.8 },
    answers2: [
      {
        chapterIndex: 0,
        chapterTitle: '第1章 現状',
        steps: [
          {
            stepNumber: 1,
            question: '新規の設備投資が頭打ちの理由は何か',
            reason: '',
            answer: '工場の更新需要はほぼ一巡し、新しい用途の顧客を見つけられていない',
          },
        ],
      },
      {
        chapterIndex: 1,
        chapterTitle: '第2章 勝ち筋',
        steps: [
          {
            stepNumber: 1,
            question: '医療機関のどの業務に計測が役立つか',
            reason: '',
            answer: '院内の感染対策の記録と点検の時間が、現場の負担になっている',
          },
        ],
      },
    ],
    stage3_strategy_bridge: {
      keyThemes: ['医療機関向けの計測の試験導入を進める', '製品の仕様を新用途の要望で見直す'],
      departmentIssues: ['医療機関の業務フローが社内で分からない', '試験導入の条件が決まっていない'],
      commonBehaviorChanges: ['試験導入の結果を毎週製品開発部と共有する'],
    },
    departments: [
      {
        id: 'qg-dept-growth',
        name: '新規事業開発部',
        mission: '工場向け計測技術を、新しい用途と市場へ広げる',
        strategicRole: '医療機関向けの新用途を立ち上げる',
        keyIssues: ['医療機関の業務フローを知る社員がいない', '試験導入の費用と期間の条件が決まっていない'],
        interDeptCollab: ['製品開発部と、仕様の優先順位を決める'],
        alignmentRiskPoints: ['新用途に人を回すと、既存顧客の保守対応が遅れる'],
        winPatternPrimary: 'new-market',
        winPatternSecondary: 'existing-tech',
        focusLevers: ['新市場の開拓', '既存技術の転用'],
        projects: [
          {
            id: 'qg-proj-medical',
            title: '医療機関向け計測ソリューションの試験導入',
            hypothesis: '院内の感染対策の記録を自動化すれば、医療機関が試験導入を検討する',
            rationale: '既存の計測技術を転用でき、新市場の初期投資を抑えられる',
            role: 'REVENUE',
            ownerName: '中村 美咲（仮）',
            okrsV2: [
              { id: 'qg-kpi-trial', label: '試験導入に合意した医療機関数', target: 5, unit: '件', due: '2027-09', owner: '中村 美咲（仮）' },
              { id: 'qg-kpi-intent', label: '試験導入後に継続利用の意向を確認した医療機関数', target: 3, unit: '件', due: '2028-02', owner: null },
            ],
          },
          {
            id: 'qg-proj-maint',
            title: '既存顧客の保守体制の維持',
            ownerName: '田口 真一（仮）',
            okrsV2: [{ id: 'qg-kpi-maint', label: '保守の一次対応時間', target: 24, unit: '時間', due: '2027-12', owner: '田口 真一（仮）' }],
          },
        ],
      },
      {
        id: 'qg-dept-product',
        name: '製品開発部',
        mission: '計測器の性能と使いやすさを高める',
        keyIssues: ['医療向けの仕様が未整理になっている'],
        interDeptCollab: ['新規事業開発部と、仕様の優先順位を決める'],
        alignmentRiskPoints: [],
        projects: [
          {
            id: 'qg-proj-small',
            title: '計測器の小型化',
            okrsV2: [{ id: 'qg-kpi-proto', label: '小型化モデルの試作数', target: 2, unit: '台', due: '2027-06', owner: null }],
          },
        ],
      },
    ],
  },
} as unknown as RawPlanInput;
