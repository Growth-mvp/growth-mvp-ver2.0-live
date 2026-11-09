import { z } from 'zod';

export const YM = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM形式で指定する');

export const BASIS = z.enum(['STAGE_DATA', 'DERIVED', 'HYPOTHESIS', 'PROPOSAL', 'UNCONFIRMED']);
export type Basis = z.infer<typeof BASIS>;

const Text = z.string().min(1).max(300);
const StrList = z.array(z.string().min(1).max(300));
const Ref = z.array(z.string()).max(6);
const KpiKey = z.string().regex(/^[SA]\d+$/, 'S（確定KPI）またはA（追加KPI）の番号');

export const Stage3KpiSourceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  target: z.number().nullable(),
  unit: z.string().min(1),
  due: YM.nullable(),
  owner: z.string().nullable(),
  /** 目標値の根拠（省略時は UNKNOWN 扱い）。KPI の状態は kpiBasis.ts で判定する */
  basis: z.enum(['USER_CONFIRMED', 'AI_PROVISIONAL', 'UNKNOWN']).optional(),
});
export type Stage3KpiSource = z.infer<typeof Stage3KpiSourceSchema>;

export const PlanSourceSchema = z
  .object({
    companyId: z.string().min(1),
    strategyId: z.string().min(1),
    projectId: z.string().min(1),
    currentYm: YM,
    companySummary: z.string().nullable(),
    period: z.object({
      projectDeadlineYm: YM.nullable(),
      companyEndYear: z.string().nullable(),
      fiscalYearEndMonth: z.number().int().min(1).max(12).nullable(),
    }),
    stage1: z.object({
      financeYears: z
        .array(
          z.object({
            year: z.number().int(),
            revenueMYen: z.number().nullable(),
            operatingIncomeMYen: z.number().nullable(),
          })
        )
        .max(5),
      operatingMarginPct: z.number().nullable(),
      roicPct: z.number().nullable(),
      waccPct: z.number().nullable(),
    }),
    stage2: z.object({
      swot: z.object({ strength: Text, weakness: Text, opportunity: Text, threat: Text }),
      finalStory: z.array(z.object({ title: z.string(), body: z.string() })).max(6),
      customerValue: Text.nullable(),
      priorityThemes: StrList,
      decisionCriteria: StrList,
      deploymentPrinciples: StrList,
      evidence: z
        .array(z.object({ chapterTitle: z.string(), question: z.string(), answer: z.string() }))
        .max(40),
    }),
    stage3: z.object({
      department: z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        mission: z.string(),
        strategicRole: z.string().nullable(),
        keyIssues: StrList,
        interDeptCollab: StrList,
        alignmentRiskPoints: StrList,
        winPatterns: StrList,
        focusLevers: StrList,
      }),
      project: z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        hypothesis: z.string().nullable(),
        rationale: z.string().nullable(),
        role: z.enum(['REVENUE', 'COST', 'FUTURE']).nullable(),
        ownerName: z.string().nullable(),
        kpis: z.array(Stage3KpiSourceSchema),
      }),
      bridge: z
        .object({ keyThemes: StrList, departmentIssues: StrList, commonBehaviorChanges: StrList })
        .nullable(),
      otherDepartments: z
        .array(
          z.object({
            id: z.string().min(1),
            name: z.string().min(1),
            projects: z.array(z.object({ title: z.string(), kpiLabels: StrList })),
          })
        )
        .max(20),
    }),
  })
  .strict();
export type PlanSource = z.infer<typeof PlanSourceSchema>;

export const ClaimSchema = z
  .object({
    text: Text,
    basis: BASIS,
    sourceRefs: Ref,
  })
  .strict();
export type Claim = z.infer<typeof ClaimSchema>;

/** 障害：何が成果を妨げているか。根拠が無ければ仮説とし、検証の行動を添える */
export const ObstacleSchema = z
  .object({
    text: Text,
    basis: BASIS,
    verifyBy: Text,
    sourceRefs: Ref,
  })
  .strict();
export type Obstacle = z.infer<typeof ObstacleSchema>;

/** 障害の件数の上限（データの上限）。重要な障害を落とさないための値で、画面での表示件数（優先3件）とは別に決める */
export const MAX_OBSTACLES = 8;

/** 行動が、どの障害を、どう変えて、なぜ価値につながるか（活動ではなく成果の因果） */
export const MechanismSchema = z
  .object({
    obstacleRefs: z.array(z.number().int().min(1).max(MAX_OBSTACLES)).max(MAX_OBSTACLES),
    stateChange: Text,
    whyItMatters: Text,
  })
  .strict();
export type Mechanism = z.infer<typeof MechanismSchema>;

/** 財務計算の入力。役割（role）で、既存の算定式に入るかを決める。単位・根拠・確認状態を持つ */
export const FINANCE_ROLES = [
  'MEETINGS',
  'WIN_RATE',
  'AVG_DEAL',
  'QUANTITY',
  'UNIT_PRICE',
  'DIRECT_AMOUNT',
  'YIELD_RATE',
  'COST_RATE',
  'CONVERSION_RATE',
  'RETENTION_RATE',
  'OTHER',
] as const;
export type FinanceRole = (typeof FINANCE_ROLES)[number];

export const FinanceInputSchema = z
  .object({
    role: z.enum(FINANCE_ROLES),
    label: z.string().min(1).max(80),
    value: z.number().nonnegative().nullable(),
    unit: z.string().min(1).max(12),
    basis: BASIS,
    confirmState: z.enum(['UNCONFIRMED', 'AI_PROPOSED', 'USER_CONFIRMED']),
    sourceRefs: Ref,
  })
  .strict();
export type FinanceInput = z.infer<typeof FinanceInputSchema>;

const AiKpiSchema = z
  .object({
    key: z.string().regex(/^A\d+$/, '追加KPIは A1, A2 … の番号'),
    kind: z.enum(['CUSTOMER_OUTCOME', 'COMPANY_RESULT', 'LEADING']),
    label: z.string().min(1).max(80),
    target: z.number().nullable(),
    unit: z.string().min(1).max(12),
    targetBasis: z.enum(['AI_PROVISIONAL']).nullable(),
    due: YM.nullable(),
    owner: z.string().nullable(),
    measurement: z.string().min(1).max(120),
    supportsActionOrders: z.array(z.number().int().min(1)).max(8),
  })
  .strict();
export type AiKpi = z.infer<typeof AiKpiSchema>;

/** 確認事項。実行前に必要なもの（BEFORE_START）は最大3件、それ以外は詳細（DETAIL） */
export const VerificationItemSchema = z
  .object({
    item: Text,
    priority: z.enum(['BEFORE_START', 'DETAIL']),
    confirmBy: YM.nullable(),
    sourceRefs: Ref,
  })
  .strict();
export type VerificationItem = z.infer<typeof VerificationItemSchema>;

/** AIの出力契約。確定KPI（S）はここに含めない。プログラムが入力値から組み込む */
export const PlanDraftSchema = z
  .object({
    provisionalPeriod: z
      .object({ endYm: YM, reason: z.string().min(1).max(200) })
      .strict()
      .nullable(),
    section1: z
      .object({
        customerProblem: ClaimSchema,
        problemCause: ClaimSchema,
        ourValue: ClaimSchema,
        whyChosen: ClaimSchema,
        customerOutcome: ClaimSchema,
        companyResult: ClaimSchema,
        goalState: ClaimSchema,
        obstacles: z.array(ObstacleSchema).max(MAX_OBSTACLES),
      })
      .strict(),
    section2: z
      .object({
        actions: z
          .array(
            z
              .object({
                order: z.number().int().min(1).max(8),
                title: z.string().min(1).max(80),
                ownerRole: z.string().min(1).max(40),
                dueYm: YM,
                dependsOn: z.array(z.number().int().min(1).max(8)).max(8),
                basis: BASIS,
                sourceRefs: Ref,
                supportsKpiKeys: z.array(KpiKey).max(6),
                mechanism: MechanismSchema.nullable(),
              })
              .strict()
          )
          .min(1)
          .max(8),
      })
      .strict(),
    section3: z
      .object({
        kpis: z.array(AiKpiSchema).max(10),
        stage3Review: z
          .array(
            z
              .object({
                stage3KpiId: z.string().min(1),
                concern: z.string().min(1).max(200),
                sourceRefs: Ref,
              })
              .strict()
          )
          .max(6),
      })
      .strict(),
    section4: z
      .object({
        financeItems: z
          .array(
            z
              .object({
                key: z.string().regex(/^F\d+$/),
                label: z.string().min(1).max(80),
                kind: z.enum(['REVENUE_UP', 'COST_REDUCTION', 'COST_INCREASE']),
                method: z.enum(['FUNNEL', 'QUANTITY_UNIT_PRICE', 'DIRECT_AMOUNT', 'FREE']),
                inputs: z.array(FinanceInputSchema).max(10),
                amountBasis: z.enum(['TOTAL', 'MONTHLY', 'ANNUAL']),
                startYm: YM,
                endYm: YM.nullable(),
                sourceNote: z.string().min(1).max(200),
                basedOnKpiKeys: z.array(KpiKey).max(6),
                freeNote: z.string().max(200).nullable(),
              })
              .strict()
          )
          .max(6),
      })
      .strict(),
    section5: z
      .object({
        responsible: z
          .object({
            name: z.string().nullable(),
            basis: BASIS,
            note: z.string().max(200).nullable(),
          })
          .strict(),
        roles: z
          .array(
            z
              .object({
                unit: z.string().min(1).max(40),
                role: z.string().min(1).max(120),
                actionOrders: z.array(z.number().int().min(1)).max(8),
              })
              .strict()
          )
          .max(6),
        budget: z.null(),
        risks: z
          .array(
            z
              .object({
                risk: z.string().min(1).max(120),
                countermeasure: z.string().min(1).max(160),
                confirmBy: YM,
                basis: BASIS,
                sourceRefs: z.array(z.string()).max(4),
              })
              .strict()
          )
          .max(5),
        preconditions: z.array(z.string().min(1).max(120)).max(5),
      })
      .strict(),
    verificationItems: z.array(VerificationItemSchema).max(8),
  })
  .strict();
export type PlanDraft = z.infer<typeof PlanDraftSchema>;
export type PlanAction = PlanDraft['section2']['actions'][number];
export type PlanFinanceItem = PlanDraft['section4']['financeItems'][number];

/** 確定KPI。内容はプログラムが入力値からコピーし、AIは変えられない */
export type ProtectedKpi = {
  key: string;
  origin: 'STAGE3';
  stage3KpiId: string;
  kind: 'UNCLASSIFIED';
  label: string;
  target: number | null;
  unit: string;
  targetBasis: 'STAGE_DATA' | null;
  /** 利用者が確定した目標か（省略時は未確認）。未確認の入力値は、AIは変えないが確定とは表示しない */
  confirmation?: 'USER_CONFIRMED' | 'UNCONFIRMED';
  due: string | null;
  owner: string | null;
  measurement: string;
  supportsActionOrders: number[];
  /** 期限が未設定の確定KPIに対する、判定時期の候補（入力にない期限は作らず、計画期間の終わりを候補にする） */
  judgeCandidateYm: string | null;
};

export type PeriodBasis = 'PROJECT_DEADLINE' | 'COMPANY_PLAN' | 'STAGE3_KPI_DUE' | 'AI_PROVISIONAL';

/** 検証に使う、組み立て済みの計画（AI出力＋確定KPI＋確定期間） */
export type AssembledPlan = {
  period: { startYm: string; endYm: string; basis: PeriodBasis };
  section1: PlanDraft['section1'];
  section2: PlanDraft['section2'];
  section3: {
    protectedKpis: ProtectedKpi[];
    proposedKpis: AiKpi[];
    stage3Review: PlanDraft['section3']['stage3Review'];
  };
  section4: PlanDraft['section4'];
  section5: PlanDraft['section5'];
  verificationItems: VerificationItem[];
  /** AIが担当を決めなかった場合に、入力の担当候補の先頭を候補として示す（確定ではない） */
  responsibleSuggestion: string | null;
};

export type IssueSeverity = 'error' | 'warning' | 'info';

export type PlanIssue = {
  severity: IssueSeverity;
  code: string;
  path: string;
  message: string;
};
