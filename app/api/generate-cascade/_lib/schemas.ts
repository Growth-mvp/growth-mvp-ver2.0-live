/**
 * _lib/schemas.ts
 * Zod schemas for validation
 */

import { z } from 'zod';

/* =========================
 * スキーマ（AI応答の検証用：後方互換＋2レーン拡張）
 * ======================= */

// プロジェクト：仮説＋レバー×時間軸＋STAGE3拡張＋AI管理メタ
export const ProjectSchema = z.object({
  title: z.string().min(1).catch(''),
  reason: z.string().default(''),
  hypothesis: z.string().default(''),
  mainLever: z.enum(['ACQ', 'ARPU', 'CHURN', 'COST', 'EFFICIENCY', 'FUTURE']).optional(),
  horizon: z.enum(['short', 'mid', 'long']).optional(),
  kind: z.enum(['growth', 'cost', 'efficiency', 'future']).optional(),

  // ★TASK 2-1: FACTPACK引用の記録（fact-seg-*, fact-cust-*, fact-fin-* ID を列挙）
  citations: z.array(z.string()).optional().default([]),

  // ★STAGE3拡張：価値指標への紐づけ
  valueDriverLinks: z.array(z.string()).optional().default([]),

  // ★STAGE3拡張：スキル要件
  skillRequirements: z
    .object({
      roleSkills: z.array(z.string()).optional(),
      executionSkills: z.array(z.string()).optional(),
    })
    .optional(),

  // ★STAGE3拡張：人的投資施策
  humanInvestments: z
    .array(
      z.object({
        category: z.enum(['TRAINING_OJT', 'HIRING', 'ALLOCATION', 'EXTERNAL', 'TOOLS_PROCESS']),
        title: z.string(),
        detail: z.string().optional(),
        owner: z.string().optional(),
        horizon: z.enum(['0_3M', '3_6M', '6_12M', '']).optional(),
      }),
    )
    .optional()
    .default([]),

  // ★ TASK 2 / TASK 1: 各プロジェクトは必ず okrs を持つ（最低1件必須）
  okrs: z
    .array(
      z.object({
        objective: z.string().min(1, 'objective は必須').optional().default(''),
        keyResults: z
          .array(z.string().min(1, 'KR label は必須'))
          .min(3, 'keyResults は最低3個必須')
          .max(5, 'keyResults は最大5個')
          .optional()
          .default([]),
        owner: z.string().optional(),
        expectedImpactYen: z.number().optional(),
        probability: z.number().optional(),
      }),
    )
    .min(1, 'okrs は最低1件必須')
    .optional()
    .default([
      {
        objective: 'デフォルト目標',
        keyResults: ['指標1', '指標2', '指標3'],
      },
    ]),

  // ★AI生成管理用メタデータ
  generatedBy: z.enum(['ai', 'user']).optional(),
  generatedSlot: z.number().int().min(1).max(3).optional(),
  generatedGroup: z.string().optional(),
  generatedAt: z.string().optional(),
});

// レーン（existing / new）
export const LaneSchema = z.object({
  projects: z.array(ProjectSchema).default([]),
});

// 部門：後方互換（projects）＋拡張（lanes）
export const DepartmentSchema = z.object({
  name: z.string().min(1).catch(''),
  missionDraft: z.string().default(''),
  missionDescription: z.string().optional().default(''),

  // 旧：部門配下のフラットな projects（既存進化レーン扱い）
  projects: z.array(ProjectSchema).default([]),

  // 新：2レーン
  lanes: z
    .object({
      existing: LaneSchema.optional(),
      new: LaneSchema.optional(),
    })
    .optional(),

  needsCollab: z.array(z.string()).optional().default([]),
  stopList: z.array(z.string()).optional().default([]),
  first90Days: z.array(z.string()).optional().default([]),
  riskNotes: z.array(z.string()).optional().default([]),
});

export const ResponseSchema = z.object({
  strategy: z
    .object({
      summary: z.string().default(''),
    })
    .default({ summary: '' }),
  departments: z.array(DepartmentSchema).default([]),
});

/* =========================
 * リクエスト軽量バリデーション（Ver4情報を許容）
 * ======================= */
const AnswersSchema = z
  .array(
    z.object({
      stepNumber: z.number().int(),
      label: z.string().optional(),
      question: z.string().optional(),
      answer: z.string().optional(),
    }),
  )
  .optional()
  .default([]);

/**
 * NOTE:
 * - ここが今回の主因でした。
 *   フロントの csvFinanceData は「配列」ではなく、
 *   { financeBS: [...], segmentPL: {...}, 0: {...} } のような"オブジェクト"で来ることがある。
 *   旧スキーマは csvFinanceData: z.array(...) で弾いていたため、ReqSchema.safeParse が失敗していました。
 *
 * - また departments[].projects は string[] の場合もあれば、Project[]（オブジェクト）の場合もあり得るため、
 *   seeds 用として any[] を許容し、テキスト化の際に正規化します。
 */
const DeptInputSchema = z
  .object({
    name: z.string().optional(),
    departmentName: z.string().optional(),
    missionDraft: z.string().optional(),

    // seeds: string[] でも object[] でも許容（後段でテキスト化）
    projects: z.array(z.any()).optional(),

    okrs: z
      .array(
        z.object({
          objective: z.string().optional(),
          keyResults: z.array(z.string()).optional(),
          owner: z.string().optional(),
        }),
      )
      .optional(),

    // Ver4 summary
    direction: z.string().optional(),
    expectations: z.array(z.string()).optional(),
    focusThemes: z.array(z.string()).optional(),

    // Ver4 6回答
    answers: AnswersSchema,
  })
  .passthrough();

export const ReqSchema = z
  .object({
    thought: z.string().optional(),
    vision: z.string().optional(),
    mission: z.string().optional(),
    industry: z.string().optional(),
    revenue: z.union([z.string(), z.number()]).optional(),
    employees: z.union([z.string(), z.number()]).optional(),
    value: z.string().optional(),
    strength: z.string().optional(),
    weakness: z.string().optional(),
    opportunity: z.string().optional(),
    threat: z.string().optional(),
    story: z.any().optional(),
    // ★新規: STAGE2 final story（最終経営戦略）を注入
    finalStory: z.any().optional(),
    strategySummary: z.string().optional(),
    departments: z.array(DeptInputSchema).optional().default([]),

    // ★ここを緩和：配列/オブジェクトどちらも許容（strictで弾かない）
    csvFinanceData: z.any().optional(),

    financeSummary: z.any().optional(),
    businessPortfolio: z.any().optional(),

    // ★STAGE1 businessSegments（P3拡張：segmentName マッピング用、配列堅牢化）
    businessSegments: z.array(z.any()).optional().default([]),

    // ★STAGE2構造化データ
    winPatternPrimary: z.string().optional(),
    winPatternSecondary: z.string().optional(),
    valueDriverKPIs: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          description: z.string().optional(),
          category: z.string().optional(),
        }),
      )
      .optional()
      .default([]),
    targetRanges: z.any().optional(),
  })
  .passthrough();

export type ReqSchemaType = z.infer<typeof ReqSchema>;
export type ResponseSchemaType = z.infer<typeof ResponseSchema>;
