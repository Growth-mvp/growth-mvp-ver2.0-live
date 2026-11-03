/* 回答品質評価用の架空企業（実在しない）。実顧客データではない。 */
import { buildStoredFinancePlan, FINANCE_PLAN_CALC_VERSION } from '@/utils/stage6/financePlanSnapshot';

export const FICTIONAL_COMPANY_ID = 'quality-company-a';
export const FICTIONAL_OTHER_COMPANY_ID = 'quality-company-b';
export const FICTIONAL_STRATEGY_ID = 'quality-strategy-a';
export const FICTIONAL_USER_ID = 'quality-user-ceo';
export const FICTIONAL_OTHER_USER_ID = 'quality-user-member';
export const FICTIONAL_COMPANY_NAME = '架空精密工業株式会社（評価用）';

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

export const FICTIONAL_DEPARTMENTS = [
  {
    id: 'dept-sales',
    name: '営業部',
    mission: '既存顧客の保守需要を取り込み、新規顧客を開拓する',
    projects: [
      {
        id: 'proj-new-customers',
        title: '新規顧客開拓',
        ownerName: '佐藤花子',
        planStatus: 'approved',
        valueDriverLinks: ['売上成長'],
        okrsV2: [
          {
            label: '新規商談数',
            target: 120,
            unit: '件',
            owner: '佐藤花子',
            due: '2027-03',
            milestones: [{ title: '提案資料の完成', dueYm: '2026-12' }],
          },
        ],
        impact: { metricDelta: [{ metric: '受注率', delta: 2, unit: 'pt' }] },
        humanInvestments: [{ type: 'HIRE', amount: 1200000 }],
      },
      {
        id: 'proj-retention',
        title: '既存顧客の保守契約更新',
        ownerName: '鈴木一郎',
        planStatus: 'approved',
        valueDriverLinks: ['売上成長'],
        okrsV2: [{ label: '保守契約の継続率', target: 95, unit: '%', owner: '鈴木一郎', due: '2027-06' }],
      },
    ],
  },
  {
    id: 'dept-manufacturing',
    name: '製造部',
    mission: '点検品質を守り、保守サービスの原価を下げる',
    projects: [
      {
        id: 'proj-standardization',
        title: '点検工程の標準化',
        ownerName: '田中次郎',
        planStatus: 'approved',
        valueDriverLinks: [],
        okrsV2: [
          {
            label: '点検報告の当日提出率',
            target: 90,
            unit: '%',
            owner: '田中次郎',
            due: '2027-01',
            milestones: [{ title: '点検手順書の改訂', dueYm: '2026-10' }],
          },
        ],
      },
    ],
  },
];

export const FICTIONAL_STRATEGY_ROW = {
  id: FICTIONAL_STRATEGY_ID,
  companyName: FICTIONAL_COMPANY_NAME,
  mission: '地域の中小製造業の設備を止めない',
  vision: '保守の確かさで選ばれる会社になる',
  ceoIntent: '保守の確かさを武器に、既存顧客の信頼を次の成長の土台にしたい。',
  departments: FICTIONAL_DEPARTMENTS,
  answers2: [],
  answers12: [
    { id: 'ch0-q1', answer: '既存顧客からの受注が減り、価格競争が激しくなっている。' },
    { id: 'ch1-q1', answer: '3〜5年後、中小製造業では保守人材が不足し、点検の遅れが困りごとになる。' },
    { id: 'ch1-q2', answer: '点検の確実さと速さが選ばれる理由になる。' },
  ],
  finalStoryFinal: [
    { title: '危機', body: '価格競争で受注が減り、既存顧客の信頼を失う危機にある。' },
    { title: '提供価値', body: '点検の確実さと速さを、地域の中小製造業に届ける。' },
    { title: '実行', body: '1〜2年で点検工程の標準化を完了する。' },
  ],
  stage3_strategy_bridge: {
    strategicCore: { primaryShift: '価格競争から、保守の確かさへの転換', behaviorChange: '点検記録の即日提出' },
    keyThemes: ['点検の確実さ', '保守人材の確保'],
    departmentIssues: ['営業と製造の点検情報の共有'],
    commonBehaviorChanges: ['点検記録を当日中に提出する'],
    generatedAt: '2026-10-15T00:00:00Z',
  },
  financePL: [
    { year: 2023, revenue: 950_000_000, operatingIncome: 70_000_000, netIncome: 45_000_000, depreciation: 18_000_000 },
    { year: 2024, revenue: 960_000_000, operatingIncome: 66_000_000, netIncome: 42_000_000, depreciation: 19_000_000 },
    { year: 2025, revenue: 930_000_000, operatingIncome: 52_000_000, netIncome: 33_000_000, depreciation: 20_000_000 },
  ],
  financeBS: [
    { year: 2023, cash: 240_000_000, ar: 130_000_000, inventory: 70_000_000, ap: 80_000_000 },
    { year: 2024, cash: 230_000_000, ar: 132_000_000, inventory: 71_000_000, ap: 81_000_000 },
    { year: 2025, cash: 210_000_000, ar: 128_000_000, inventory: 72_000_000, ap: 79_000_000 },
  ],
  fiscalYearEnd: '3',
  csvFinanceData: {
    financePlanAssumptions: buildStoredFinancePlan({
      domain: {
        assumptions: {
          minCashYen: 150_000_000,
          taxRate: 0.3,
          depreciationYen: null,
          arRatio: null,
          inventoryRatio: null,
          apRatio: null,
          targetRevenueYen: 1_000_000_000,
          targetOperatingIncomeYen: 70_000_000,
          targetYear: 2027,
        },
        existingLoans: [],
        newLoans: [],
        dividendsYen: {},
      },
      companyId: FICTIONAL_COMPANY_ID,
      savedAt: '2026-10-20T00:00:00Z',
      meta: {
        calcVersion: FINANCE_PLAN_CALC_VERSION,
        companyId: FICTIONAL_COMPANY_ID,
        baseYear: 2025,
        bsBaseYear: 2025,
        assumptionsHash: 'quality-a',
        sourceHash: 'quality-s',
        unconfirmed: { unapprovedReadyYen: 0, unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
        computedAt: '2026-10-20T00:00:00Z',
      },
    }),
  },
  simulationResults: [
    {
      id: 'sim-quality-1',
      created_at: '2026-09-01T00:00:00Z',
      title: '点検の標準化を先行する案',
      payload: { projection: { points: [{ year: '2027', sales: 980_000_000, op: 60_000_000 }] }, finalProb: 0.5 },
    },
  ],
};

/** 進捗（STAGE5）の架空データ。営業部の新規顧客開拓には最近の確認があり、製造部の標準化には確認がない。 */
export const FICTIONAL_OKRS = [
  { id: 'okr-new-customers', company_id: FICTIONAL_COMPANY_ID, department_id: 'dept-sales', project_id: 'proj-new-customers', objective: '新規', is_deleted: false },
  { id: 'okr-retention', company_id: FICTIONAL_COMPANY_ID, department_id: 'dept-sales', project_id: 'proj-retention', objective: '保守', is_deleted: false },
  { id: 'okr-standardization', company_id: FICTIONAL_COMPANY_ID, department_id: 'dept-manufacturing', project_id: 'proj-standardization', objective: '標準化', is_deleted: false },
  { id: 'okr-other', company_id: FICTIONAL_OTHER_COMPANY_ID, department_id: 'other-dept', project_id: 'other-proj', objective: '他社', is_deleted: false },
];

export const FICTIONAL_PROGRESS_LOGS = [
  {
    id: 'log-own-1',
    company_id: FICTIONAL_COMPANY_ID,
    user_id: FICTIONAL_USER_ID,
    okr_id: 'okr-new-customers',
    created_at: ago(2),
    content: '__META__{"k":1}\n提案資料の草案を作った。',
    score: 4,
    status: '進行中',
  },
  {
    id: 'log-other-1',
    company_id: FICTIONAL_COMPANY_ID,
    user_id: FICTIONAL_OTHER_USER_ID,
    okr_id: 'okr-retention',
    created_at: ago(3),
    content: '他の担当者の本文（経営者には本文を出さない）',
  },
  {
    id: 'log-other-company',
    company_id: FICTIONAL_OTHER_COMPANY_ID,
    user_id: 'other-company-user',
    okr_id: 'okr-other',
    created_at: ago(1),
    content: '別会社の本文',
  },
];

export type QualityQuestion = {
  id: number;
  text: string;
  /** 経路判定で期待する種類（すべて advisor） */
  mode: 'advisor';
  /** 注入されるべきブロック */
  blocks: { rationale: boolean; bridge: boolean; progress: boolean; plan: boolean };
  /** 事実として含まれるべき語（数値・名称は架空データに由来する） */
  mustInclude: string[];
  /** 含めてはならない語（他社・他人の本文・秘密の値） */
  mustNotInclude: string[];
  /** 実 AI 評価の観点メモ（推測・断定の注意） */
  evaluationNote: string;
};

export const QUALITY_QUESTIONS: QualityQuestion[] = [
  {
    id: 1,
    text: '当社の最大の経営課題は何か？',
    mode: 'advisor',
    blocks: { rationale: true, bridge: false, progress: true, plan: true },
    mustInclude: ['価格競争', '保守人材'],
    mustNotInclude: ['別会社の本文', '他の担当者の本文', '1200000'],
    evaluationNote: '財務の減益傾向（営業利益）と戦略の危機認識を結びつけているか。対症療法で終わっていないか。',
  },
  {
    id: 2,
    text: '今の戦略で3年後に成長できるか？',
    mode: 'advisor',
    blocks: { rationale: true, bridge: false, progress: false, plan: true },
    mustInclude: ['提供価値', '目標（経営者が登録）', '予測未算出'],
    mustNotInclude: ['別会社の本文', '1200000', '2027年度（予測）'],
    evaluationNote: '3年後の数値は保存済み前提からの計算値として区別して扱えているか。断定しすぎていないか。',
  },
  {
    id: 3,
    text: '営業部門と製造部門の連携に問題はないか？',
    mode: 'advisor',
    blocks: { rationale: false, bridge: true, progress: false, plan: false },
    mustInclude: ['営業部', '製造部', '価値指標との対応（登録）: 未登録'],
    mustNotInclude: ['別会社の本文', '1200000'],
    evaluationNote: '製造部の標準化プロジェクトに価値指標の登録がないことを、断定ではなく確認事項として扱えているか。',
  },
  {
    id: 4,
    text: 'どの実行計画が遅れているか？',
    mode: 'advisor',
    blocks: { rationale: false, bridge: false, progress: true, plan: false },
    mustInclude: ['製造部 / 点検工程の標準化', '確認がないプロジェクト'],
    mustNotInclude: ['別会社の本文', '他の担当者の本文'],
    evaluationNote: '「確認記録がない」を「遅れている」と断定していないか。確認記録と進捗の遅れを区別しているか。',
  },
  {
    id: 5,
    text: '来年度の利益と資金繰りはどうなるか？',
    mode: 'advisor',
    blocks: { rationale: false, bridge: false, progress: false, plan: true },
    mustInclude: ['予測未算出', '期末現預金', '既存借入・新規借入・配当は未登録'],
    mustNotInclude: ['別会社の本文', '1200000', '2027年度（予測）'],
    evaluationNote: '計算値と登録値を区別しているか。借入が未登録のため返済の数値を作っていないか。',
  },
  {
    id: 6,
    text: '設備投資と人材採用のどちらを優先すべきか？',
    mode: 'advisor',
    blocks: { rationale: true, bridge: false, progress: true, plan: true },
    mustInclude: ['保守人材'],
    mustNotInclude: ['別会社の本文'],
    evaluationNote: '判断基準（判断に必要な情報の不足）を示せているか。どちらかを断定しすぎていないか。',
  },
  {
    id: 7,
    text: '社長が今、最も優先すべきことは何か？',
    mode: 'advisor',
    blocks: { rationale: true, bridge: false, progress: true, plan: true },
    mustInclude: ['提供価値'],
    mustNotInclude: ['別会社の本文', '他の担当者の本文'],
    evaluationNote: '経営者の意図と全体の課題を結びつけ、正面から答えているか。組織変革へ無理に誘導していないか。',
  },
];
