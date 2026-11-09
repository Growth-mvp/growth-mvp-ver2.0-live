/* 品質評価セット②：収益改善型（既存事業の採算改善）。架空データ。
 * 期間の根拠：既存の確定KPIの期限（最も遅いのは2027年9月）。財務：営業利益率が3%から1.4%へ低下、投資余力は小さい。 */
import type { RawPlanInput } from '@/lib/stage4/plan/source';

export const PROFIT_INPUT = {
  membershipCompanyId: 'qp-company',
  requestedStrategyId: 'qp-strategy',
  requestedProjectId: 'qp-proj-yield',
  currentYm: '2026-11',
  strategy: {
    id: 'qp-strategy',
    company_id: 'qp-company',
    companyName: '架空食品加工株式会社（評価用）',
    summary: '量販店向けの惣菜事業の採算を立て直し、営業利益率を2028年にかけて2%台へ戻す。',
    strength: '量販店との取引が長く、品質の安定で信頼を得ている',
    weakness: '工場の歩留まりと不良の原因が、日次で把握できていない',
    opportunity: '原材料の調達先を見直せる余地がある',
    threat: '原材料価格の上昇が続き、値上げの交渉が難しい',
    finalStory: [
      { title: '第1章 現状', body: '売上は横ばいだが、原材料費と廃棄の増加で利益が減っている。' },
      { title: '第2章 勝ち筋', body: '既存製品の原価と不良を下げ、同じ売上で利益を戻す。新しい設備投資には頼らない。' },
      { title: '第3章 体制', body: '工場と購買が同じ数字を見て、原価への寄与額で施策を示す。' },
    ],
    midtermStrategy: {
      priorityStrategicThemes: ['既存製品の原価を下げ、採算を戻す', '不良と廃棄を減らす'],
      companyWideDecisionCriteria: ['営業利益率に効かない施策は優先しない'],
      deploymentPrinciplesForUnits: ['部門は、原価への寄与額で施策を示す'],
      strategicCore: {
        customerValue: '量販店の売場担当者が、欠品なく安定した品質の商品を仕入れられること',
      },
    },
    financePL: [
      { year: 2025, revenue: 9800000000, operatingIncome: 137200000 },
      { year: 2024, revenue: 9900000000, operatingIncome: 217800000 },
      { year: 2023, revenue: 10100000000, operatingIncome: 303000000 },
    ],
    valueAnalysis: { operatingMarginPctLatest: 1.4, roic: 3.0, wacc: 5.2 },
    answers2: [
      {
        chapterIndex: 0,
        chapterTitle: '第1章 現状',
        steps: [
          {
            stepNumber: 1,
            question: '利益が減った主な原因は何か',
            reason: '',
            answer: '原材料費率が上がり、不良による廃棄も増えた',
          },
        ],
      },
    ],
    stage3_strategy_bridge: {
      keyThemes: ['工場の歩留まりを上げる', '原材料の調達条件を見直す'],
      departmentIssues: ['歩留まりの実績が日次で見えない', '調達単価の交渉材料が揃っていない'],
      commonBehaviorChanges: ['不良の原因を毎週記録し、製造と購買で共有する'],
    },
    departments: [
      {
        id: 'qp-dept-prod',
        name: '製造部',
        mission: '安定した品質で、無駄なく生産する',
        strategicRole: '歩留まりを上げ、廃棄を減らす',
        keyIssues: ['歩留まりの実績が日次で見えない', '不良の原因が記録されていない'],
        interDeptCollab: ['購買部と、原材料の規格の見直しを相談する'],
        alignmentRiskPoints: ['規格を変えると、量販店の品質基準と合わなくなるおそれ'],
        winPatternPrimary: 'cost-leadership',
        focusLevers: ['原価の低減', '不良の削減'],
        projects: [
          {
            id: 'qp-proj-yield',
            title: '工場の歩留まり改善と原価低減',
            hypothesis: '不良の原因を毎週記録して対策すれば、歩留まりが上がり原価が下がる',
            rationale: '原材料費と廃棄の増加が、利益低下の主な原因になっている',
            role: 'COST',
            ownerName: '岡田 健（仮）',
            okrsV2: [
              { id: 'qp-kpi-yield', label: '歩留まり率', target: 94, unit: '%', due: '2027-03', owner: '岡田 健（仮）' },
              { id: 'qp-kpi-gross', label: '粗利率', target: 28, unit: '%', due: '2027-09', owner: '岡田 健（仮）' },
            ],
          },
        ],
      },
      {
        id: 'qp-dept-purchase',
        name: '購買部',
        mission: '品質を保ちながら、原材料を適正な価格で調達する',
        keyIssues: ['主要な原材料の調達条件が長年見直されていない'],
        interDeptCollab: ['製造部と、規格の見直しを相談する'],
        alignmentRiskPoints: [],
        projects: [
          {
            id: 'qp-proj-procure',
            title: '原材料の調達条件の見直し',
            okrsV2: [{ id: 'qp-kpi-price', label: '主要原材料の調達単価の改善率', target: 4, unit: '%', due: '2027-06', owner: null }],
          },
        ],
      },
    ],
  },
} as unknown as RawPlanInput;
