/* 品質評価セット③：組織横断型（複数部門の協働が必要なプロジェクト）。架空データ。
 * 期間の根拠：無し（全社計画期間・KPI期限とも未設定のため、AIが仮期間を提案する）。
 * 財務：営業赤字で、投資余力は限られる。 */
import type { RawPlanInput } from '@/lib/stage4/plan/source';

export const CROSSDEPT_INPUT = {
  membershipCompanyId: 'qc-company',
  requestedStrategyId: 'qc-strategy',
  requestedProjectId: 'qc-proj-launch',
  currentYm: '2026-11',
  strategy: {
    id: 'qc-strategy',
    company_id: 'qc-company',
    companyName: '架空ソフトウェア株式会社（評価用）',
    summary: '既存顧客の業務データを活かす製品で、導入後も使われ続ける事業モデルを作る。',
    strength: '既存顧客の業務に深く入り込み、現場の信頼を得ている',
    weakness: '部門ごとに成功の定義が違い、連携が遅い',
    opportunity: '中小企業の業務自動化の需要が続いている',
    threat: '大手の類似製品との価格競争',
    finalStory: [
      { title: '第1章 現状', body: '受注は伸びているが、導入後に使われなくなる顧客が多く、継続収入が伸びない。' },
      { title: '第2章 勝ち筋', body: '導入後の定着を収益の柱に置き、既存顧客からの紹介で広げる。' },
      { title: '第3章 体制', body: '営業・開発・CSが同じ顧客の状況を見て、共通のKPIで協働する。' },
    ],
    midtermStrategy: {
      priorityStrategicThemes: ['既存顧客の業務データを活かす製品を広げる', '導入後の定着を収益の柱にする'],
      companyWideDecisionCriteria: ['部門の成果は、顧客の継続利用に効くかで判断する'],
      deploymentPrinciplesForUnits: ['部門は、他部門との共通KPIで協働を示す'],
      strategicCore: {
        customerValue: '中小企業の業務担当者が、自動化の効果を自分の手で確かめながら使い続けられること',
      },
    },
    financePL: [
      { year: 2025, revenue: 260000000, operatingIncome: -20000000 },
      { year: 2024, revenue: 230000000, operatingIncome: -28000000 },
    ],
    valueAnalysis: { wacc: 6.1 },
    answers2: [
      {
        chapterIndex: 0,
        chapterTitle: '第1章 現状',
        steps: [
          {
            stepNumber: 1,
            question: '導入後に使われなくなる理由は何か',
            reason: '',
            answer: '導入時の設定で止まり、現場の業務に組み込まれていない',
          },
        ],
      },
    ],
    stage3_strategy_bridge: {
      keyThemes: ['業務自動化パッケージを市場に出す'],
      departmentIssues: ['部門ごとに成功の定義が違う', '導入支援の手順が担当者によって違う'],
      commonBehaviorChanges: ['週次で3部門が同じ顧客の状況を見る'],
    },
    departments: [
      {
        id: 'qc-dept-plan',
        name: '事業企画部',
        mission: '新製品を市場に出し、収益の柱に育てる',
        strategicRole: '新製品の市場投入と、部門をまたぐ成功の定義を揃える',
        keyIssues: ['部門ごとに成功の定義が違う', '市場投入の計画が部門間で共有されていない'],
        interDeptCollab: ['営業部と見込み顧客の条件を揃える', '開発部と、機能の優先順位を決める', 'CS部と導入後の定着の基準を決める'],
        alignmentRiskPoints: ['開発の優先度が、営業の要望と合わないおそれ'],
        winPatternPrimary: 'retention',
        focusLevers: ['導入後の定着', '紹介による新規獲得'],
        projects: [
          {
            id: 'qc-proj-launch',
            title: '業務自動化パッケージの市場投入',
            hypothesis: '既存顧客の紹介と導入後の定着支援があれば、新製品が継続的に使われる',
            rationale: '既存顧客の業務データを使える点が、他社との差になる',
            role: 'REVENUE',
            ownerName: '高橋 亮（仮）',
            okrsV2: [
              { id: 'qc-kpi-adopt', label: '市場投入後の導入企業数', target: 30, unit: '社', due: null, owner: '高橋 亮（仮）' },
              { id: 'qc-kpi-trial', label: '無償トライアルから有償へ転換した率', target: 25, unit: '%', due: null, owner: null },
              { id: 'qc-kpi-retain', label: '導入後90日の定着率', target: 80, unit: '%', due: null, owner: '松本 優（仮）' },
            ],
          },
        ],
      },
      {
        id: 'qc-dept-sales',
        name: '営業部',
        mission: '既存顧客からの紹介で、新製品の商談を増やす',
        keyIssues: ['既存顧客からの紹介の仕組みが無い'],
        interDeptCollab: ['事業企画部と見込み顧客の条件を揃える'],
        alignmentRiskPoints: [],
        projects: [
          {
            id: 'qc-proj-referral',
            title: '既存顧客からの紹介の仕組み作り',
            okrsV2: [{ id: 'qc-kpi-referral', label: '既存顧客からの紹介商談数', target: 40, unit: '件', due: null, owner: null }],
          },
        ],
      },
      {
        id: 'qc-dept-dev',
        name: '開発部',
        mission: '製品を安定して動かし、顧客の業務に合わせて改善する',
        keyIssues: ['リリース後の不具合の原因が追えない', '機能の優先度が部門ごとに違う'],
        interDeptCollab: ['事業企画部と機能の優先順位を決める'],
        alignmentRiskPoints: ['営業の要望を優先すると、保守の時間が足りなくなるおそれ'],
        projects: [
          {
            id: 'qc-proj-stable',
            title: '自動化機能の安定化',
            okrsV2: [{ id: 'qc-kpi-bugs', label: 'リリース後の重大な不具合件数', target: 0, unit: '件', due: null, owner: null }],
          },
        ],
      },
      {
        id: 'qc-dept-cs',
        name: 'CS部',
        mission: '導入後の顧客が、製品を業務に組み込めるよう支援する',
        keyIssues: ['導入支援の手順が担当者ごとに違う'],
        interDeptCollab: ['事業企画部と導入後の定着の基準を決める'],
        alignmentRiskPoints: [],
        projects: [
          {
            id: 'qc-proj-onboard',
            title: '導入支援の標準化',
            okrsV2: [{ id: 'qc-kpi-manual', label: '導入支援の標準手順書の整備数', target: 3, unit: '件', due: null, owner: null }],
          },
        ],
      },
    ],
  },
} as unknown as RawPlanInput;
