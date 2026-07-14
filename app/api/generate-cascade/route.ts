// /app/api/generate-cascade/route.ts
// fix9: A案維持。固定補完を抑え、旧形式d.projectsから新規探索・仮説説明を復元
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { industryTemplates, getIndustryLabel } from '@/utils/industryTemplates';
import { toTextStory, extractJsonObject, sanitizeText } from '@/app/api/_shared/utils';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership, assertMinRole } from '@/lib/server/rbacGuard';
import type { PortfolioSignals, StorySignals, DiscussionSignals, GeneratedSignals, ReconsiderationSeverity, ReconsiderationPointInternal } from '@/types/strategy';

/* =========================
 * グローバル定数
 * ========================= */
const DEBUG = process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1';

/* =========================
 * スキーマ（AI応答の検証用：後方互換＋4レーン拡張）
 * ======================= */

type CascadeLaneType = 'existing' | 'new' | 'intraCollab' | 'interCollab';

// プロジェクト：仮説＋レバー×時間軸＋STAGE3拡張＋AI管理メタ
const ProjectSchema = z.object({
  title: z.string().min(1).catch(''),
  reason: z.string().default(''),
  hypothesis: z.string().default(''),
  mainLever: z.enum(['ACQ', 'ARPU', 'CHURN', 'COST', 'EFFICIENCY', 'FUTURE']).optional(),
  horizon: z.enum(['short', 'mid', 'long']).optional(),
  kind: z.enum(['growth', 'cost', 'efficiency', 'future']).optional(),

  // ★STAGE3拡張：STEP4の生成分類（既存進化/新規探索/事業部内連携/事業部間連携）
  sourceType: z.enum(['existing', 'new', 'intraCollab', 'interCollab']).optional(),
  collaborationType: z.enum(['intraDept', 'interDept']).optional(),
  partnerDepartment: z.string().optional(),

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
  generatedSlot: z.number().int().min(1).max(5).optional(),
  generatedGroup: z.string().optional(),
  generatedAt: z.string().optional(),
});

// レーン（existing / new / intraCollab / interCollab）
const LaneSchema = z.object({
  projects: z.array(ProjectSchema).default([]),
});

// 部門：後方互換（projects）＋拡張（lanes）
const DepartmentSchema = z.object({
  name: z.string().min(1).catch(''),
  missionDraft: z.string().default(''),
  missionDescription: z.string().optional().default(''),

  // 旧：部門配下のフラットな projects（既存進化レーン扱い）
  projects: z.array(ProjectSchema).default([]),

  // 新：4レーン
  lanes: z
    .object({
      existing: LaneSchema.optional(),
      new: LaneSchema.optional(),
      intraCollab: LaneSchema.optional(),
      interCollab: LaneSchema.optional(),
    })
    .optional(),

  needsCollab: z.array(z.string()).optional().default([]),
  intraDeptCollab: z.array(z.string()).optional().default([]),
  interDeptCollab: z.array(z.string()).optional().default([]),
  stopList: z.array(z.string()).optional().default([]),
  first90Days: z.array(z.string()).optional().default([]),
  riskNotes: z.array(z.string()).optional().default([]),

  /* ★STEP5拡張：事業・部門別戦略の観点（すべて optional・default なし）
   * - default を付けると既存データに空配列/空文字が書き込まれるため、未出力時は undefined のまま通す
   * - LLM が返さなくても parse は成功する（JSON parse 失敗リスクを増やさない） */
  currentPosition: z.string().optional(),
  strategicRole: z.string().optional(),
  keyIssues: z.array(z.string()).optional(),
  alignmentRiskPoints: z.array(z.string()).optional(),
  /* ★ STAGE3拡張：再生成結果のレビューサマリー */
  reviewSummary: z
    .object({
      correctedItems: z.array(z.string()).optional().default([]),
      reconsiderationPoints: z.array(z.string()).optional().default([]),
    })
    .optional(),
});

const ResponseSchema = z.object({
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
 *   { financeBS: [...], segmentPL: {...}, 0: {...} } のような“オブジェクト”で来ることがある。
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

const ReqSchema = z
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

    // ★STEP7: STAGE2中計設計（midtermStrategy）の注入（すべて optional）
    midtermStrategy: z
      .object({
        midtermConcept: z.string().optional(),
        targetVisionForMidterm: z.string().optional(),
        priorityStrategicThemes: z.array(z.string()).optional(),
        growthStrategy: z.string().optional(),
        profitImprovementStrategy: z.string().optional(),
        portfolioPolicy: z.string().optional(),
        companyWideDecisionCriteria: z.array(z.string()).optional(),
        deploymentPrinciplesForUnits: z.array(z.string()).optional(),
        managementMeetingIssues: z.array(z.string()).optional(),
        strategicCore: z.any().optional(),
      })
      .optional(),

    // ★STAGE2→STAGE3 戦略展開ブリッジ
    stage3_strategy_bridge: z.any().optional(),

    // ★STAGE2補助セクション編集（stage2FinalDocumentEdits）の注入
    stage2FinalDocumentEdits: z.any().optional(),
  })
  .passthrough();

/* =========================
 * 小ユーティリティ
 * ======================= */
const toLinesFromCsv = (csvRows: any[], limit = 5) =>
  (csvRows || [])
    .slice(0, limit)
    .map((row: any, i: number) => {
      const obj = row && typeof row === 'object' ? row : { value: row };
      return `【${i + 1}行目】 ${Object.entries(obj)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')}`;
    })
    .join('\n');

function formatStage3StrategyBridgeForPrompt(bridge: any): string {
  if (!bridge || typeof bridge !== 'object') return '（戦略展開ブリッジ未生成）';

  const lines: string[] = [];
  const arr = (label: string, values: any, max = 6) => {
    if (!Array.isArray(values) || values.length === 0) return;
    lines.push(`${label}:`);
    for (const v of values.slice(0, max)) {
      const text = sanitizeText(String(v ?? '').trim(), 180);
      if (text) lines.push(`・${text}`);
    }
  };
  const text = (label: string, value: any) => {
    const t = sanitizeText(String(value ?? '').trim(), 260);
    if (t) lines.push(`${label}: ${t}`);
  };

  const core = bridge.strategicCore && typeof bridge.strategicCore === 'object' ? bridge.strategicCore : null;
  if (core) {
    lines.push('【戦略の芯】');
    text('転換の軸', core.primaryShift);
    arr('重点領域', core.concreteDomains, 8);
    text('顧客価値', core.customerValue);
    arr('中核能力', core.coreCapabilities, 8);
    text('資源配分・ポートフォリオ転換', core.portfolioShift);
    text('行動変化', core.behaviorChange);
    arr('保持すべきテーマ', core.nonNegotiableThemes, 8);
  }

  arr('会社として目指す方向', bridge.keyThemes);
  arr('重点的に伸ばす領域', bridge.departmentIssues);
  arr('見直すべき事業・活動', bridge.kpiCriteria);
  arr('各部門に求める役割', bridge.commonBehaviorChanges);
  arr('部門展開ルール', bridge.departmentTranslationRules);

  return lines.length > 0 ? lines.join('\n') : '（戦略展開ブリッジ未生成）';
}

function scrubUngroundedStrategyOverviewText(text: string, evidenceText: string): string {
  let out = String(text ?? '').trim();
  if (!out) return out;

  const evidence = String(evidenceText ?? '');
  const hasEvidence = (needle: string) => !!needle && evidence.includes(needle);

  // Prompt example contamination: remove phrases that should never be copied without input evidence.
  out = out
    .replace(/全社成長の\s*\d+(?:\.\d+)?\s*%を担う重点事業として[、，]?/g, '全社戦略で定めた重点領域への展開を担う事業として、')
    .replace(/売上は好調だが[、，]?\s*利益率改善が課題(?:となっています|です)?/g, '部門別の売上・利益率データは追加確認が必要です')
    .replace(/売上は好調(?:です|となっています)?/g, '部門別の売上データは追加確認が必要です')
    .replace(/利益率改善が課題(?:となっています|です)?/g, '利益率データは追加確認が必要です')
    .replace(/本部は短期売上拡大を期待するが[、，]?\s*持続可能な成長には中長期の人材育成が不可欠/g, '経営側の成長期待と、現場側の実行準備・リソース配分の認識がずれやすい')
    .replace(/市場浸透と隣接市場への拡大を並行して実行(?:しています|する)?/g, '重点市場への展開と隣接領域への展開仮説を具体化する');

  // Numeric assertions in overview fields must be grounded in request evidence.
  out = out.replace(/\d+(?:\.\d+)?\s*%/g, (m) => {
    return hasEvidence(m) ? m : '数値根拠は追加確認が必要';
  });

  return out.replace(/\s+/g, ' ').trim();
}

function scrubUngroundedStrategyOverviewArray(values: any, evidenceText: string): string[] {
  return trimList(values, 6)
    .map((item) => scrubUngroundedStrategyOverviewText(String(item ?? ''), evidenceText))
    .filter(Boolean);
}

function pickName(d: any) {
  return (
    (typeof d?.name === 'string' && d.name.trim()) ||
    (typeof d?.departmentName === 'string' && d.departmentName.trim()) ||
    ''
  );
}

function onlyDeptNames(list: any[]): string[] {
  return (list || []).map(pickName).filter(Boolean);
}

function trimList(list?: string[], max = 6) {
  return (Array.isArray(list) ? list : [])
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function toStringList(value: unknown, max = 6): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? [value]
      : [];

  return raw
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .slice(0, max);
}


function dedupeStrings(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list || []) {
    const v = String(item || '').trim();
    const key = v.toLowerCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function extractCollabAnswerText(dept: any): string {
  const answers = pickDeptAnswers6(dept);
  if (!Array.isArray(answers) || answers.length === 0) return '';
  const step5 = answers.find((a: any) => Number(a?.stepNumber) === 5);
  if (step5?.answer) return String(step5.answer).trim();
  const labeled = answers.find((a: any) => String(a?.label ?? '').includes('協力'));
  return String(labeled?.answer ?? '').trim();
}

function looksLikeInterDeptCollab(answerText: string): boolean {
  const t = String(answerText || '').toLowerCase();
  if (!t) return false;
  const keywords = [
    '他事業部', '別の事業部', '別事業部', '共同開発', '共同', '横断', '他部門',
    '別部門', '全社', '連携', '協業', '他部署', '複数事業部'
  ];
  return keywords.some((kw) => t.includes(kw.toLowerCase()));
}

function buildInterDeptCollabFallback(deptName: string, dept: any): string[] {
  const answerText = extractCollabAnswerText(dept);
  if (!looksLikeInterDeptCollab(answerText)) return [];
  const cleaned = answerText.replace(/\s+/g, ' ').trim();
  const title = cleaned.length > 90 ? cleaned.slice(0, 90) + '…' : cleaned;
  return [`事業部間連携：${deptName} - ${title}`];
}

function findDeptAnswerByStep(answers: any[], stepNumber: number): string {
  if (!Array.isArray(answers)) return '';
  const direct = answers.find((a: any) => Number(a?.stepNumber) === stepNumber);
  if (direct?.answer) return String(direct.answer).trim();
  return '';
}

function summarizeDeptAnswer(answer: string, max = 120): string {
  const cleaned = sanitizeText(String(answer ?? '').replace(/\s+/g, ' ').trim(), max);
  if (!cleaned || cleaned === '(未回答)') return '';
  return cleaned;
}

function hasTextOverlap(target: any, source: string): boolean {
  const targetText = Array.isArray(target) ? target.join(' ') : String(target ?? '');
  const sourceText = String(source ?? '');
  if (!targetText.trim() || !sourceText.trim()) return false;
  const tokens = (sourceText.match(/[ァ-ヴー]{2,}|[一-龯々]{2,10}|[A-Za-z0-9]{2,}/g) || [])
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !['こと', 'ため', 'する', 'ある', 'いる', '必要', '部門', '事業'].includes(t))
    .slice(0, 8);
  return tokens.some((token) => targetText.includes(token));
}

function appendUniqueText(list: any, text: string, max = 6): string[] {
  const base = trimList(Array.isArray(list) ? list : [], max);
  const value = String(text ?? '').trim();
  if (!value) return base;
  if (hasTextOverlap(base, value)) return base;
  return dedupeStrings([...base, value]).slice(0, max);
}

function ensureDept6AnswerReflection(deptResult: any, deptInput: any, hasMultipleRequestedDepartments: boolean): void {
  const answers = pickDeptAnswers6(deptInput);
  if (!hasAnsweredSteps6(answers)) return;

  const step1 = summarizeDeptAnswer(findDeptAnswerByStep(answers, 1), 120);
  const step2 = summarizeDeptAnswer(findDeptAnswerByStep(answers, 2), 120);
  const step3 = summarizeDeptAnswer(findDeptAnswerByStep(answers, 3), 120);
  const step4 = summarizeDeptAnswer(findDeptAnswerByStep(answers, 4), 120);
  const step5 = summarizeDeptAnswer(findDeptAnswerByStep(answers, 5), 120);
  const step6 = summarizeDeptAnswer(findDeptAnswerByStep(answers, 6), 120);

  if (step1 && !hasTextOverlap(`${deptResult?.missionDraft ?? ''} ${deptResult?.missionDescription ?? ''}`, step1)) {
    const prefix = String(deptResult?.missionDraft ?? '').trim();
    deptResult.missionDraft = prefix
      ? `${prefix} また、${step1}。`
      : `${pickName(deptInput) || pickName(deptResult) || 'この部門'}は、${step1}。`;
  }

  if (step2 && !hasTextOverlap(deptResult?.lanes?.existing?.projects?.map((p: any) => `${p?.title ?? ''} ${p?.reason ?? ''} ${p?.hypothesis ?? ''}`), step2)) {
    deptResult.keyIssues = appendUniqueText(deptResult?.keyIssues, `既存進化テーマは、6問回答で示された「${step2}」との接続を明確にする必要がある。`, 4);
  }

  if (step3 && !hasTextOverlap(deptResult?.lanes?.new?.projects?.map((p: any) => `${p?.title ?? ''} ${p?.reason ?? ''} ${p?.hypothesis ?? ''}`), step3)) {
    deptResult.keyIssues = appendUniqueText(deptResult?.keyIssues, `新規探索テーマは、6問回答で示された「${step3}」を将来仮説として具体化する必要がある。`, 4);
  }

  if (step4) {
    deptResult.riskNotes = appendUniqueText(deptResult?.riskNotes, `犠牲・制約：${step4}`, 6);
    deptResult.keyIssues = appendUniqueText(deptResult?.keyIssues, `資源配分上の制約として、${step4}を踏まえる必要がある。`, 4);
  }

  if (step5) {
    const collabText = `6問回答に基づく協力論点：${step5}`;
    if (hasMultipleRequestedDepartments && looksLikeInterDeptCollab(step5)) {
      deptResult.interDeptCollab = appendUniqueText(deptResult?.interDeptCollab, collabText, 6);
    } else {
      deptResult.intraDeptCollab = appendUniqueText(deptResult?.intraDeptCollab, collabText, 6);
    }
    deptResult.needsCollab = appendUniqueText(deptResult?.needsCollab, collabText, 6);
  }

  if (step6) {
    deptResult.stopList = appendUniqueText(deptResult?.stopList, `非対象・見直し：${step6}`, 6);
  }
}

function normalizeCollabLists(deptResult: any, deptInput?: any): { intra: string[]; inter: string[]; legacy: string[] } {
  const intra = trimList(
    deptResult?.intraDeptCollab ??
    deptResult?.needsCollab ??
    [],
    6
  );

  let inter = trimList(deptResult?.interDeptCollab ?? [], 6);

  if (inter.length === 0 && deptInput) {
    inter = buildInterDeptCollabFallback(pickName(deptInput) || pickName(deptResult) || '対象事業部', deptInput);
  }

  const legacy = dedupeStrings([
    ...intra,
    ...inter,
    ...trimList(deptResult?.needsCollab ?? [], 6),
  ]);

  return { intra, inter, legacy };
}

function toNum(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(/[,%\s]/g, '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** probability: 0..1 を基本。100や%が来たら吸収 */
function normalizeProbability(v: any): number | undefined {
  const n = toNum(v);
  if (n == null) return undefined;
  if (n <= 0) return 0;
  if (n > 1 && n <= 100) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

/**
 * ★ STAGE3: 部門の6問回答を取り出す（保存先の優先探索）
 * - answers6 → answers12 → answers → answers2 → answerSteps → questionAnswers の順で探索
 * - 見つかったら配列を返す；なければ []
 */
function pickDeptAnswers6(dept: any): any[] {
  const cands =
    (dept as any)?.answers6 ??
    (dept as any)?.answers12 ??
    (dept as any)?.answers ??
    (dept as any)?.answers2 ??
    (dept as any)?.answerSteps ??
    (dept as any)?.questionAnswers ??
    null;
  return Array.isArray(cands) ? cands : [];
}

/**
 * ★ STAGE3: 部門の6問回答を整形（prompt注入用）
 * - stepNumber でソート、最大6件まで取得
 * - 空や不正な要素は .filter で除外
 */
function formatDept6Answers(answers: any[]): string {
  if (!Array.isArray(answers) || answers.length === 0) return '(なし)';
  const rows = answers
    .filter((a) => a && typeof a === 'object')
    .slice()
    .sort((a, b) => Number(a?.stepNumber || 0) - Number(b?.stepNumber || 0))
    .slice(0, 6)
    .map((a) => {
      const n = a?.stepNumber ?? '?';
      const label = (a?.label ?? '').toString().trim();
      const ans = (a?.answer ?? '').toString().trim();
      return `- Step${n}${label ? `（${label}）` : ''}: ${ans || '(未回答)'}`;
    });
  return rows.length ? rows.join('\n') : '(なし)';
}

/**
 * ★ STAGE3: Step 1-6 がすべて揃っているか判定
 */
function hasAnsweredSteps6(answers: any[]): boolean {
  if (!Array.isArray(answers)) return false;
  const steps = new Set(
    answers
      .map((a) => Number(a?.stepNumber))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 6),
  );
  return steps.size >= 6;
}

/**
 * ★ STAGE3: TASK 2 - 6問回答のキーワードが生成結果に反映されているかをスコアリング
 * @param deptAnswers6 - 部門の6問回答配列
 * @param generatedText - 生成されたテキスト（mission + projects + okrs）
 * @returns {topTokens, coveragePct, hitTokens}
 */
function scoreDept6Impact(deptAnswers6: any[], generatedText: string): {
  topTokens: string[];
  coveragePct: number;
  hitTokens: string[];
} {
  if (!Array.isArray(deptAnswers6) || deptAnswers6.length === 0 || !generatedText) {
    return { topTokens: [], coveragePct: 0, hitTokens: [] };
  }

  // 6問回答からテキスト抽出
  const answersText = deptAnswers6
    .map((a) => String(a?.answer || ''))
    .join(' ');

  // 簡易トークン抽出（カタカナ、漢字2文字以上、英数字）
  const tokenPattern = /[ァ-ヴー]{2,}|[一-龯々]{2,10}|[A-Za-z0-9]{2,}/g;
  const tokens = (answersText.match(tokenPattern) || [])
    .filter((t) => t.length >= 2 && t.length <= 15)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  // 頻度カウント
  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) || 0) + 1);
  }

  // 上位10個を取得
  const topTokens = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([token]) => token);

  // 生成結果に含まれるトークン
  const hitTokens = topTokens.filter((token) => generatedText.includes(token));

  // カバレッジ率
  const coveragePct = topTokens.length > 0 ? Math.round((hitTokens.length / topTokens.length) * 100) : 0;

  return { topTokens, coveragePct, hitTokens };
}

/**
 * ★ TASK KR-1: keyResults の別名を吸収して正規化
 * - kpis/metrics/measures/values の別名に対応
 * - 各要素をオブジェクト形式に統一（label, current, target, unit, due）
 */
/**
 * ★ TASK A: KR正規化関数（汎用版）
 * 入力形式を広く受け取り、常に標準OKR形式に統一
 *
 * 入力例：
 * - string[]
 * - [{label:string}, {title:string}]
 * - {keyResults: [...]}
 * - そのまま配列
 */
function normalizeKeyResults(raw: any): {
  normalized: Array<{label:string; current:null; target:null; unit:null; due:null}>;
  rawType: string;
  rawLen: number;
} {
  // Step 1: 入力形式を判定 & 配列を抽出
  let arr: any[] = [];
  let rawType = 'unknown';
  let rawLen = 0;

  if (!raw) {
    // null/undefined → 空
    rawType = 'null';
    rawLen = 0;
  } else if (Array.isArray(raw)) {
    // raw 自体が配列 → そのまま使用
    arr = raw;
    rawType = 'array<string|object>';
    rawLen = raw.length;
  } else if (typeof raw === 'object') {
    // オブジェクト → フィールドから配列を抽出
    const candidate =
      Array.isArray(raw?.keyResults) ? { arr: raw.keyResults, type: 'object.keyResults' } :
      Array.isArray(raw?.krs) ? { arr: raw.krs, type: 'object.krs' } :
      Array.isArray(raw?.key_results) ? { arr: raw.key_results, type: 'object.key_results' } :
      Array.isArray(raw?.kpis) ? { arr: raw.kpis, type: 'object.kpis' } :
      Array.isArray(raw?.metrics) ? { arr: raw.metrics, type: 'object.metrics' } :
      Array.isArray(raw?.measures) ? { arr: raw.measures, type: 'object.measures' } :
      Array.isArray(raw?.values) ? { arr: raw.values, type: 'object.values' } :
      Array.isArray(raw?.outcomes) ? { arr: raw.outcomes, type: 'object.outcomes' } :
      null;

    if (candidate) {
      arr = candidate.arr;
      rawType = candidate.type;
      rawLen = arr.length;
    } else {
      rawType = 'object<no-array-fields>';
      rawLen = 0;
    }
  }

  // Step 2: 配列の各要素を正規化
  const normalized = arr
    .map((x: any) => {
      // 文字列の場合、label にする
      if (typeof x === 'string') {
        return { label: x.trim(), current: null, target: null, unit: null, due: null };
      }
      // オブジェクトの場合、フィールド別名に対応して正規化
      const label = (x?.label ?? x?.title ?? x?.name ?? x?.metric ?? x?.kpi ?? x?.measure ?? x?.outcome ?? '').toString().trim();
      if (!label) return null; // label なしは skip

      return {
        label,
        current: x?.current ?? x?.baseline ?? x?.from ?? null,
        target: x?.target ?? x?.goal ?? x?.to ?? x?.destination ?? null,
        unit: x?.unit ?? x?.uom ?? x?.metric_unit ?? null,
        due: x?.due ?? x?.deadline ?? x?.dueDate ?? null,
      };
    })
    .filter((x: any): x is {label:string; current:null; target:null; unit:null; due:null} => x !== null);

  return { normalized, rawType, rawLen };
}


/**
 * KPI/KR label の表示・保存用整形。
 * - 旧生成データに残る「プロジェクト名：KPI名」形式を、保存前にも安全に除去する
 * - projectTitle と一致する prefix を優先的に削除する
 * - KPI/KR ラベルとして扱う箇所でのみ利用する前提
 */
function stripProjectPrefixFromKpiLabel(label: string, projectTitle?: string): string {
  const t = String(label ?? '').trim();
  if (!t) return '';

  const knownPrefix = String(projectTitle ?? '').trim();
  if (knownPrefix) {
    for (const sep of ['：', ':']) {
      const prefix = `${knownPrefix}${sep}`;
      if (t.startsWith(prefix)) {
        return t.slice(prefix.length).trim();
      }
    }
  }

  // KPIラベルの旧形式対策。文章全般ではなく、KR/KPI label に限定して使用する。
  if (t.includes('：')) {
    return t.split('：').slice(1).join('：').trim();
  }
  if (t.includes(':')) {
    return t.split(':').slice(1).join(':').trim();
  }

  return t;
}

function normalizeKpiLabel(label: string, projectTitle?: string): string {
  return stripProjectPrefixFromKpiLabel(label, projectTitle)
    .replace(/（\s*%\s*）/g, '（%）')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const GENERIC_KPI_PATTERNS = [
  /^売上向上（?%?）?$/,
  /^利益率向上（?%?）?$/,
  /^顧客満足度向上（?.*?）?$/,
  /^活動強化$/,
  /^提案推進$/,
  /^目標達成度（?%?）?$/,
  /^効果実現度（?%?）?$/,
  /^実行進捗度（?%?）?$/,
  /^歩留改善（?.*?）?$/,
  /^材料ロス削減（?.*?）?$/,
  /^稼働率向上（?.*?）?$/,
  /^目標仕様達成率（?.*?）?$/,
  /^原価低減達成率（?.*?）?$/,
  /^新製品認定率（?.*?）?$/,
  /^商談会の初回接触数（?.*?）?$/,
  /^重点案件の仕掛け期間（?.*?）?$/,
];

function isGenericKpiLabel(label: string): boolean {
  const t = String(label ?? '').trim();
  return GENERIC_KPI_PATTERNS.some((pattern) => pattern.test(t));
}

/**
 * ★ TASK 1: projectType を辞書ベースで分類
 * - タイトル/部門名からプロジェクトの性質を推測
 * - LLM 呼び出し前に実行（高速）
 */
type ProjectType =
  | 'sales_process'
  | 'customer_research'
  | 'inventory_system'
  | 'new_market'
  | 'dx'
  | 'quality'
  | 'r_and_d'
  | 'default';

function classifyProjectType(
  projectTitle: string,
  deptName?: string,
  laneType?: CascadeLaneType
): ProjectType {
  const titleLower = projectTitle.toLowerCase();
  const deptLower = (deptName ?? '').toLowerCase();
  const combined = `${titleLower} ${deptLower}`;

  // 新規市場/新規開拓系
  if (laneType === 'new' || combined.match(/新規|開拓|ポック|poc|仮説検証|市場検証/)) {
    return 'new_market';
  }

  // 受注/営業プロセス系
  if (
    combined.match(/受注|見積|提案|営業|案件|リード|営業プロセス|見積プロセス/)
  ) {
    return 'sales_process';
  }

  // 顧客調査/理解系
  if (
    combined.match(/ニーズ|調査|ヒアリング|voc|顧客理解|顧客インサイト|ペルソナ|失注|顧客情報/)
  ) {
    return 'customer_research';
  }

  // 在庫/倉庫系
  if (
    combined.match(/在庫|倉庫|棚卸|入出庫|erp|mrp|在庫管理|在庫精度/)
  ) {
    return 'inventory_system';
  }

  // DX/デジタル系
  if (
    combined.match(/dx|デジタル|自動化|システム導入|業務プロセス|rpa|ツール/)
  ) {
    return 'dx';
  }

  // 品質系
  if (
    combined.match(/品質|保証|不良|監査|認証|クレーム|信頼性/)
  ) {
    return 'quality';
  }

  // R&D/開発系
  if (
    combined.match(/研究|開発|r&d|r and d|新商品|プロトタイプ|設計/)
  ) {
    return 'r_and_d';
  }

  return 'default';
}

/**
 * ★ TASK 3: KRI validation（汎用3点セット排除 + 種別適合性）
 */
type ValidationResult = {
  ok: boolean;
  reasons: string[];
};

function validateKRs(
  projectType: ProjectType,
  krs: Array<{ label: string; unit?: string | null }>,
  projectTitle: string
): ValidationResult {
  const reasons: string[] = [];

  // 旧仕様では projectTitle prefix を要求していたが、現在は「KPI名（単位）」のみを正とする。
  const hasProjectPrefix = krs.some((kr) => {
    const label = String(kr.label ?? '').trim();
    return Boolean(projectTitle) && (
      label.startsWith(`${projectTitle}：`) ||
      label.startsWith(`${projectTitle}:`)
    );
  });
  if (hasProjectPrefix) {
    reasons.push('project_prefix_included');
  }

  // チェック2: KPI名が被ってないか（prefix除去後で判定）
  const kpiNames = krs.map((kr) => normalizeKpiLabel(kr.label ?? '', projectTitle));
  const uniqueCount = new Set(kpiNames).size;
  if (uniqueCount < 3) {
    reasons.push('duplicate_kpi_names');
  }

  // チェック3: 汎用KPIだけで終わっていないか
  if (kpiNames.some(isGenericKpiLabel)) {
    reasons.push('generic_kpi_label');
  }

  // チェック4: 種別別の禁止セット
  const allLabelsLower = kpiNames.map((label) => label.toLowerCase()).join(' ');

  if (projectType === 'customer_research') {
    if (allLabelsLower.match(/不良率|合格率|稼働率/)) {
      reasons.push('invalid_for_customer_research');
    }
  } else if (projectType === 'inventory_system') {
    if (allLabelsLower.match(/試験合格率|不良率/)) {
      reasons.push('invalid_for_inventory_system');
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}

/**
 * ★ TASK 2: 種別別 KPI メニュー生成（プロンプト構築）
 * - projectType に応じて適切な KPI 候補と禁止パターンをプロンプトに埋め込む
 */
function generateTypeSpecificPrompt(projectType: ProjectType, projectTitle: string, isRetry: boolean): string {
  const typeConfig: Record<ProjectType, { candidates: string; forbidden: string }> = {
    customer_research: {
      candidates: `
【推奨KPI候補】
- 重点顧客への課題ヒアリング実施件数（件/月）
- 対象セグメント別の仮説検証完了数（件/月）
- 顧客要望の提案仕様反映率（%）
- 重点顧客からの有効VoC抽出件数（件）
- 重点顧客ニーズとの適合率（%）`,
      forbidden: '不良率|合格率|稼働率|納期|生産性|歩留まり|稼働時間',
    },
    inventory_system: {
      candidates: `
【推奨KPI候補】
- 重点部材の在庫差異率（%）
- 重点部材の欠品率（%）
- 対象品目の滞留在庫金額（万円）
- 対象倉庫の棚卸工数（h/月）
- 対象品目の入出庫精度（%）`,
      forbidden: '試験合格率|不良率|ヒアリング|ニーズ|提案反映',
    },
    sales_process: {
      candidates: `
【推奨KPI候補】
- 重点案件の初回提案から見積提出までの期間（日）
- 重点顧客向け提案の受注率（%）
- 重点案件の失注理由が特定された案件比率（%）
- 重点案件の提案から受注判断までの期間（日）
- 重点案件の月次ステージ進捗件数（件/月）`,
      forbidden: '在庫|棚卸|稼働率|不良率|試験合格',
    },
    new_market: {
      candidates: `
【推奨KPI候補】
- 新規市場向けPoC開始件数（件/月）
- 重点市場向け商談会での有効接触件数（件）
- 対象市場リードの商談化率（%）
- 新規顧客仮説の検証完了数（件）
- 対象市場における導入可能性評価スコア（1-10）`,
      forbidden: '既存事業改善|既知顧客|安定供給|製造稼働',
    },
    dx: {
      candidates: `
【推奨KPI候補】
- 対象業務プロセスの自動化率（%）
- 対象システムの現場利用率（%）
- 対象業務の手作業削減工数（h/月）
- 対象拠点へのシステム導入期間短縮（日）
- 対象業務のRPA処理件数（件/月）`,
      forbidden: '顧客満足度|ヒアリング|在庫精度|不良率',
    },
    quality: {
      candidates: `
【推奨KPI候補】
- 重点製品ラインの工程内不良率（ppm）
- 重点顧客向け案件の納期遵守率（%）
- 重点顧客からの品質クレーム件数（件/月）
- 重点製品ラインの初回検査合格率（%）
- 対象工程のトレーサビリティ記録完全率（%）`,
      forbidden: '提案反映|ニーズ|商談化|利用率',
    },
    r_and_d: {
      candidates: `
【推奨KPI候補】
- 重点顧客要求に対する試作開発期間短縮（日）
- 重点仕様の試作検証実施数（件）
- 重点顧客要求仕様の性能改善幅（%）
- 重点仕様の設計検証完了率（%）
- 対象市場向け新商品の上市準備完了率（%）`,
      forbidden: '顧客満足度|稼働率|在庫精度|失注率',
    },
    default: {
      candidates: `
【推奨KPI候補】
- 重点テーマの初回実行マイルストーン達成率（%）
- 対象顧客・対象市場における重点成果指標の達成率（%）
- 重点施策による現場行動変化の実行率（%）`,
      forbidden: '',
    },
  };

  const config = typeConfig[projectType] || typeConfig.default;

  return `
${config.candidates}

【禁止パターン】
【絶対に使用禁止】：${config.forbidden || '生産性向上、NPS、プロセス改善スコア、顧客満足度、従業員満足度、エンゲージメント'}

※ プロジェクト名「${projectTitle}」に合わせて、上記の推奨候補から3本を選び、必要に応じてカスタマイズしてください。
※ 3本のKPIは異なる視点・指標である必要があります（同じKPIの焼き直しは禁止）
`;
}

/**
 * ★ TASK 2-3: KR専用生成関数（LLMで必ず3本埋める）
 * - ドメイン固有な KR を生成（禁止セット除外）
 * - 返却フォーマットを固定化
 * - エラーを分類（network/parse/schema）
 */
type GenKRResult = {
  keyResults: Array<{ label: string; unit?: string | null }>;
  errorCode?: 'ai_error_network' | 'ai_error_parse' | 'ai_error_schema';
};

async function generateKeyResultsByLLM(
  params: {
    deptName: string;
    projectTitle: string;
    mainLever?: string;
    kind?: string;
    objective?: string;
    laneType?: CascadeLaneType;
    projectType?: ProjectType;
    attempt?: number;
    // ★ STAGE3: TASK 4-1 新規パラメータ
    missionDraft?: string;
    projectDescription?: string;  // reason + hypothesis
    dept6AnswersBlock?: string;
  }
): Promise<GenKRResult> {
  const { deptName, projectTitle, mainLever, kind, objective, laneType = 'existing', projectType = 'default', attempt = 1, missionDraft, projectDescription, dept6AnswersBlock } = params;

  // プロンプト生成
  const isRetry = attempt >= 2;
  const strictnessLevel = isRetry ? '厳格' : '標準';
  const typeSpecificContent = generateTypeSpecificPrompt(projectType, projectTitle, isRetry);

  // ★ STAGE3: TASK 4-2 - projectType に応じた品質/生産性KPI候補の生成
  const qualityProductivityExamples = (() => {
    switch (projectType) {
      case 'sales_process':
        return '見積作成時間、提案件数、商談化率、リードタイム、営業工数';
      case 'dx':
        return '自動化率、データ入力工数、処理時間、システムエラー率、データ精度';
      case 'new_market':
        return 'PoC完了数、仮説検証リードタイム、検証継続率、パイロット顧客数';
      case 'quality':
        return '重点製品ラインの初回良品率、対象工程の再工数、重点製品ラインの材料ロス率、対象設備の稼働安定率';
      case 'inventory_system':
        return '納期遵守率、在庫回転数、リードタイム、配送精度';
      case 'customer_research':
        return '重点顧客への課題ヒアリング実施件数、分析対象セグメント数、顧客要望の提案反映率、仮説検証完了数';
      case 'r_and_d':
        return '試作完了数、開発リードタイム、実験成功率、知識共有度';
      default:
        return '対象業務の処理時間、重点プロセスの完了率、対象工程の精度、対象業務の工数削減';
    }
  })();

  const prompt = `
部門: ${deptName}
部門ミッション: ${missionDraft || '未定'}
プロジェクト: ${projectTitle}
プロジェクト説明: ${projectDescription || '未定'}
プロジェクト種別: ${projectType}
レバー: ${mainLever || '未定'}
種別: ${kind || '未定'}
目標: ${objective || '未定'}
${laneType === 'new' ? '※ 新規探索レーン：新規市場/新規顧客の検証に適したKRを' : '※ 既存進化レーン：既存事業の改善に適したKRを'}

【部門の6問回答（プロジェクト背景）】
${dept6AnswersBlock || '（6問回答なし）'}

${isRetry ? `
【${strictnessLevel}モード: 前回失敗のため、さらに厳格に要件を確認します】
` : ''}

${typeSpecificContent}

【★ KPI の3カテゴリ制約（必須）】
以下の3カテゴリから、それぞれ1本ずつ選択すること（合計3本）：

1. **主要成果KPI**: プロジェクトの直接成果（売上、粗利、受注率、リードタイム、案件数など）
2. **品質/生産性KPI**: 業務品質や効率（${qualityProductivityExamples}）
3. **顧客価値KPI**: 顧客体験や満足度（納期遵守率、クレーム数、NPS、再購買率、案件継続率など）

以下の要件で、このプロジェクトの KPI（Key Result）を3本だけ生成してください：

【必須要件】
1. JSONのみ返す（説明・前後の言葉は絶対禁止）
2. keyResultsは必ず3本、各カテゴリから1本ずつ
3. label形式は「{KPI名}（{unit}）」とする。プロジェクト名やテーマ名は含めない
4. 各KRの unit は単位のみ（例："ppm", "日", "%" など）
5. 上記の【部門の6問回答】と整合性を保つこと
6. プロジェクト種別（${projectType}）に適した指標を選択すること
7. KPI名は具体的で、成長・行動変化・戦略テーマとのつながりが分かる表現にする
8. KPI名には可能な限り、対象顧客・対象市場・対象製品・対象プロセスのいずれかを含める
9. 「売上向上」「利益率向上」「歩留改善」「材料ロス削減」「稼働率向上」「目標仕様達成率」「原価低減達成率」のような一般表現だけで終わらせない
10. 一般指標を使う場合も、必ず対象を付ける（例：重点製品ラインの初回良品率、重点顧客要求仕様の充足率、新製品量産時の目標原価達成率）
11. KPI名は「対象」だけでなく、可能な限り「どの行動・どのプロセス・どの転換点を測るのか」が分かる表現にする（例：重点案件の仕掛け期間ではなく、重点案件の初回提案から見積提出までの期間。商談会の初回接触数ではなく、重点市場向け商談会での有効接触件数。）

【返却フォーマット】
{
  "keyResults": [
    { "label": "{具体的なKPI名}（{unit}）", "unit": "単位コード" },
    { "label": "{具体的なKPI名}（{unit}）", "unit": "単位コード" },
    { "label": "{具体的なKPI名}（{unit}）", "unit": "単位コード" }
  ]
}

【例】
{
  "keyResults": [
    { "label": "重点顧客における導入検討案件数（件/月）", "unit": "件/月" },
    { "label": "EMS提案から商談化までの転換率（%）", "unit": "%" },
    { "label": "重点顧客へのPoC提案から受注検討への転換率（%）", "unit": "%" }
  ]
}

★重要★ 汎用的な「売上向上」「利益率向上」「歩留改善」「材料ロス削減」「稼働率向上」「目標仕様達成率」「原価低減達成率」「顧客満足度」だけで終わらせないこと。必ず対象（重点顧客・対象市場・重点製品ライン・対象工程・新規市場・PoC案件など）を含め、さらに『初回提案→見積提出』『PoC→受注検討』『顧客要求→仕様充足』『対象工程→再工数削減』のように、どの行動・プロセス・転換点を測るのかが分かる具体的な指標にすること。JSON以外は返さないこと。
`.trim();

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content: `あなたは製造業 B2B の経営戦略コンサルタント。JSON 形式のみで回答する。前後の説明や注記は絶対禁止。`,
        },
        { role: 'user', content: prompt },
      ],
    });

    const rawContent = completion.choices?.[0]?.message?.content || '';
    const parsed = extractJsonObject(rawContent);

    if (!parsed) {
      console.log(
        `[cascade][kpi][ai-gen-debug] attempt=${attempt} dept="${deptName}" project="${projectTitle}" error=parse_failed`
      );
      return { keyResults: [], errorCode: 'ai_error_parse' };
    }

    const krArray = parsed?.keyResults;
    if (!Array.isArray(krArray) || krArray.length < 3) {
      console.log(
        `[cascade][kpi][ai-gen-debug] attempt=${attempt} dept="${deptName}" project="${projectTitle}" error=schema krCount=${Array.isArray(krArray) ? krArray.length : 0}`
      );
      return { keyResults: [], errorCode: 'ai_error_schema' };
    }

    // スキーマ検証
    const valid = krArray.slice(0, 3).every((kr: any) => {
      const label = String(kr?.label ?? '').trim();
      return label.length > 0;
    });

    if (!valid) {
      return { keyResults: [], errorCode: 'ai_error_schema' };
    }

    const extracted = krArray.slice(0, 3).map((kr: any) => ({
      label: normalizeKpiLabel(String(kr.label).trim(), projectTitle),
      unit: kr.unit ? String(kr.unit).trim() : null,
    }));

    console.log(
      `[cascade][kpi][ai-gen-debug] attempt=${attempt} dept="${deptName}" project="${projectTitle}" success krCount=3`
    );
    return { keyResults: extracted };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    const isNetworkErr = errMsg.includes('socket') || errMsg.includes('timeout') || errMsg.includes('connection');

    console.log(
      `[cascade][kpi][ai-gen-debug] attempt=${attempt} dept="${deptName}" project="${projectTitle}" error=network msg="${isNetworkErr ? 'network_error' : errMsg.slice(0, 50)}"`
    );

    return { keyResults: [], errorCode: 'ai_error_network' };
  }
}

/**
 * ★ TASK 4: ensureKeyResults を修正（AI→リトライ→テンプレの順）
 * - AI が返した keyResults を使う
 * - 空の場合は generateKeyResultsByLLM で AI 生成（最大2回）
 * - 2回ダメならテンプレートに落ちる
 * - エラーコードを詳細に分類
 */
async function ensureKeyResults(
  okr: any,
  projectTitle: string,
  deptName?: string,
  laneType?: CascadeLaneType
): Promise<any> {
  // Step 1: raw candidates を広く拾う
  const rawKrs =
    okr?.keyResults ??
    okr?.krs ??
    okr?.key_results ??
    okr?.metrics ??
    null;

  // Step 2: 正規化（rawType/rawLen も取得）
  const { normalized, rawType, rawLen } = normalizeKeyResults(rawKrs);

  // Step 3: ai_called の判定（rawが「存在」したか）
  const ai_called = rawKrs != null && rawLen > 0;

  // Step 4: AI採用（LLMから返ってきたデータ）
  if (normalized.length > 0) {
    const normalizedClean = normalized.map((kr) => ({
      ...kr,
      label: normalizeKpiLabel(kr.label, projectTitle),
    }));
    // ★ ログ: label の先頭30文字を出して形式確認（直接LLM返却の場合）
    const labels = normalizedClean.map((kr: any) => (kr.label ?? '').substring(0, 30)).join(' | ');
    console.log(
      `[cascade][kpi][llm-label-check] dept="${deptName ?? 'unknown'}" project="${projectTitle}" rawType="${rawType}" labels="${labels}"`
    );

    return {
      ...okr,
      keyResults: normalizedClean,
      _aiCalled: ai_called,
      _krSource: 'AI',
      _krReason: 'llm_returned',
      _krSourceDetail: 'ai:gpt',
      _rawType: rawType,
      _rawLen: rawLen,
      _aiAttempts: 0,
    };
  }

  // Step 5: projectType を分類
  const projectType = classifyProjectType(projectTitle, deptName, laneType);
  console.log(
    `[cascade][kpi][classify] dept="${deptName}" project="${projectTitle}" projectType="${projectType}"`
  );

  // Step 5.5: rawが空の場合、AI生成を試す（最大2回）
  let aiGenResult = null;
  let lastErrorCode: string | undefined = undefined;
  let aiAttempts = 0;

  for (let attempt = 1; attempt <= 2; attempt++) {
    aiAttempts = attempt;
    const result = await generateKeyResultsByLLM({
      deptName: deptName ?? '未設定',
      projectTitle,
      mainLever: (okr as any)?.mainLever,
      kind: (okr as any)?.kind,
      objective: (okr as any)?.objective,
      laneType,
      projectType,
      attempt,
    });

    if (result.keyResults.length === 3) {
      // ★ TASK 4: AI生成が成功したら検証を実施
      const aiKrs = result.keyResults.map((kr: any) => ({
        label: normalizeKpiLabel(kr.label, projectTitle),
        current: null,
        target: null,
        unit: kr.unit ?? null,
        due: null,
      }));

      // ログ: label の先頭30文字を出して形式確認
      const labels = aiKrs.map((kr: any) => (kr.label ?? '').substring(0, 30)).join(' | ');
      console.log(
        `[cascade][kpi][ai-label-check] dept="${deptName ?? 'unknown'}" project="${projectTitle}" labels="${labels}"`
      );

      // KRI検証を実施
      const validation = validateKRs(projectType, aiKrs, projectTitle);
      const validationStatus = validation.ok ? 'pass' : 'fail';
      console.log(
        `[cascade][kpi][validate] dept="${deptName}" project="${projectTitle}" attempt=${attempt} status="${validationStatus}" reasons="${validation.reasons.join('|')}"`
      );

      // KPI名抽出ログ（projectTitle接頭辞を削除）
      const kpiNames = aiKrs.map((kr: any) => {
        return normalizeKpiLabel(kr.label ?? '', projectTitle);
      });
      console.log(
        `[cascade][kpi][ai-kpi-name] dept="${deptName}" project="${projectTitle}" names="${kpiNames.join(' | ')}"`
      );

      if (validation.ok) {
        // 検証成功
        aiGenResult = result;
        break;
      } else if (attempt < 2) {
        // 検証失敗 → リトライ可能
        console.log(
          `[cascade][kpi][validate-retry] dept="${deptName}" project="${projectTitle}" attempt=${attempt} will_retry=true reasons="${validation.reasons.join('|')}"`
        );
        // ループが続くので次のattemptで自動的にリトライされる
        continue;
      } else {
        // 検証失敗 → リトライ不可
        lastErrorCode = 'ai_error_validation';
        console.log(
          `[cascade][kpi][validate-fail] dept="${deptName}" project="${projectTitle}" attempt=${attempt} reasons="${validation.reasons.join('|')}"`
        );
        // ループを抜けてテンプレートフォールバックへ
        break;
      }
    }

    lastErrorCode = result.errorCode;
    console.log(
      `[cascade][kpi][retry] dept="${deptName}" project="${projectTitle}" attempt=${attempt} failed errorCode=${result.errorCode}`
    );
  }

  // Step 6: AI生成成功 → 結果を返す
  if (aiGenResult && aiGenResult.keyResults.length === 3) {
    const aiKrs = aiGenResult.keyResults.map((kr: any) => ({
      label: kr.label,
      current: null,
      target: null,
      unit: kr.unit ?? null,
      due: null,
    }));

    return {
      ...okr,
      keyResults: aiKrs,
      _aiCalled: true,
      _krSource: 'AI',
      _krReason: 'ai_generated_after_retry',
      _krSourceDetail: 'ai:gpt',
      _rawType: rawType,
      _rawLen: rawLen,
      _aiAttempts: aiAttempts,
    };
  }

  // Step 7: AI生成失敗 → テンプレをやむを得ず使用
  const reason_detail = lastErrorCode
    ? `ai_failed_after_retry(${lastErrorCode})`
    : 'ai_empty';

  console.log(
    `[cascade][kpi][template-fallback] dept="${deptName}" project="${projectTitle}" reason="${reason_detail}"`
  );

  const result = deriveKrsByContext(projectTitle, deptName, laneType);
  const fallbackKrs = result.krs;
  const sourceDetail = result.sourceDetail;

  return {
    ...okr,
    keyResults: fallbackKrs.map((label: string) => ({
      label,
      current: null,
      target: null,
      unit: null,
      due: null,
    })),
    _aiCalled: false,
    _krSource: 'TEMPLATE',
    _krReason: reason_detail,
    _krSourceDetail: sourceDetail,
    _rawType: rawType,
    _rawLen: rawLen,
    _aiAttempts: aiAttempts,
  };
}


/**
 * ★ TASK 4-2: プロジェクトコンテキストに応じた KR を生成（複数バリエーション対応）
 * - LLM が返さない / 補完が必要な場合、プロジェクトタイトル/ミッション/レーン種別から妥当な KR を生成
 * - 固定3本ではなく、タイトルに応じて異なる KR セットを返す
 * - variant パラメータで複数の候補セットを切り替え可能（重複時に差し替え用）
 * - すべてのプロジェクトで KR が差別化される
 */
function deriveKrsByContext(
  projectTitle: string,
  deptMission?: string,
  laneType?: CascadeLaneType,
  projectTags?: string[],
  variant: 0 | 1 | 2 = 0  // ★ variant: 0=第一候補, 1=第二候補, 2=第三候補
): { krs: string[]; sourceDetail: string } {
  const title = String(projectTitle).toLowerCase();
  const tags = (projectTags ?? []).map((t) => String(t).toLowerCase());

  // タイトルに含まれるキーワードをチェック
  const hasKeyword = (keywords: string[]) =>
    keywords.some((kw) => title.includes(kw) || tags.some((t) => t.includes(kw)));

  // ★ 分岐ルール 1: 品質 / 不良 / クレーム / 保証 / 検査 / 監査
  if (hasKeyword(['品質', '不良', 'クレーム', '保証', '検査', '監査', '信頼性'])) {
    const sets = [
      ['重点製品ラインの工程内不良率（ppm）', '重点顧客からの品質クレーム件数（件/月）', '対象工程の監査合格率（%）'],
      ['重点製品ラインの検査工数削減（h/ロット）', '対象工程の再加工率（%）', '重点製品ラインの初回良品率（%）'],
      ['対象工程の工程内流出率（ppm）', '重点製品の保証費率（%）', '重点顧客向け出荷品の返品率（%）'],
    ];
    return { krs: sets[variant], sourceDetail: `template:quality_v${variant}` };
  }

  // ★ 分岐ルール 2: 受注 / 見積 / 営業 / 案件 / 納期 / リードタイム
  if (hasKeyword(['受注', '見積', '営業', '案件', '納期', 'リード', 'lead time'])) {
    const sets = [
      ['重点案件の初回提案から見積提出までの期間（営業日）', '重点顧客向け提案の受注率（%）', '重点顧客向け案件の納期遵守率（%）'],
      ['重点案件の初回提案から受注判断までの期間（日）', '重点顧客への初回提案件数（件/月）', '重点案件の平均想定受注金額（円）'],
      ['重点案件の見積依頼から一次回答までの時間（時間）', '重点顧客向け提案後の商談化率（%）', '営業人日あたりの有効商談創出数（件）'],
    ];
    return { krs: sets[variant], sourceDetail: `template:sales_v${variant}` };
  }

  // ★ 分岐ルール 3: コスト / 原価 / 工数 / 効率 / 自動化 / 省力
  if (hasKeyword(['コスト', '原価', '工数', '効率', '自動化', '省力', 'automation'])) {
    const sets = [
      ['重点製品ラインの量産単位原価削減率（%）', '対象業務の作業工数削減（h/月）', '対象工程の段取り時間短縮（分）'],
      ['重点製品ラインの初回良品率（%）', '高付加価値製品ラインの材料ロス率（%）', '対象設備の稼働安定率（%pt）'],
      ['対象工程の1個あたり加工時間短縮（分/個）', '対象業務プロセスの人件費率削減（%）', '重点設備の計画稼働率達成率（%）'],
    ];
    return { krs: sets[variant], sourceDetail: `template:cost_v${variant}` };
  }

  // ★ 分岐ルール 4: 新規 / 開発 / 軽量 / 耐久 / 設計
  if (hasKeyword(['新規', '開発', '軽量', '耐久', '設計', 'design', 'development'])) {
    const sets = [
      ['重点仕様の試作検証回数（回）', '重点顧客要求仕様の試験合格率（%）', '新製品開発リードタイム（月）'],
      ['新製品量産立ち上げマイルストーン達成率（%）', '重点顧客要求仕様の充足率（%）', '新製品量産時の目標原価達成率（%）'],
      ['設計段階での顧客要求課題検出数（件）', '重点仕様変更による手戻り削減率（%）', '対象部品の共通化率（%）'],
    ];
    return { krs: sets[variant], sourceDetail: `template:newbiz_v${variant}` };
  }

  // ★ 分岐ルール 5: 市場 / 開拓 / 仮説 / 検証 / PoC
  if (hasKeyword(['市場', '開拓', '仮説', '検証', 'poc', 'パイロット', 'prototype', 'validation'])) {
    const sets = [
      ['新規市場向け有効商談創出件数（件/月）', '新規市場向けPoC開始件数（件）', 'PoCから受注検討への転換率（%）'],
      ['重点顧客への課題ヒアリング実施社数（社）', '新規市場の見込み案件数（件）', 'パイロット参加企業数（社）'],
      ['対象市場への課題ヒアリング有効回答率（%）', '新規市場の早期顧客獲得数（社）', 'PoC案件の実装案件化率（%）'],
    ];
    return { krs: sets[variant], sourceDetail: `template:market_v${variant}` };
  }

  // ★ 分岐ルール 6: スマート / IoT / データ / DX / AI / 分析
  if (hasKeyword(['smart', 'iot', 'データ', 'dx', 'ai', '分析', 'analytics', 'digital'])) {
    const sets = [
      ['対象設備のデータ取得率（%）', '対象設備の予兆検知精度（%）', '重点設備の稼働安定率（%pt）'],
      ['対象システムのデータ活用範囲（システム数）', '対象業務プロセスの自動化カバー率（%）', '異常検知モデルの検出精度（%）'],
      ['対象設備の停止時間削減（h/月）', '需要・稼働予測モデルの予測精度（%）', '対象データの品質スコア（1-10）'],
    ];
    return { krs: sets[variant], sourceDetail: `template:dx_v${variant}` };
  }

  // ★ デフォルト: 汎用 KR（レーン種別で少し調整）
  if (laneType === 'new') {
    const sets = [
      ['新規テーマの事業化仮説検証完了率（%）', '新規テーマからの獲得知見数（件）', '対象市場におけるスケーラビリティ評価スコア（1-10）'],
      ['新規テーマの実装体制構築度（%）', '新規テーマの主要リスク特定件数（件）', 'PoCプロトタイプ完成度（%）'],
      ['対象市場の受容度調査回答率（%）', '対象市場における提携先候補企業数（社）', '導入可能性評価スコア（1-10）'],
    ];
    return { krs: sets[variant], sourceDetail: `template:newlane_v${variant}` };
  }

  // laneType === 'existing' または デフォルト
  const sets = [
    ['重点顧客における導入検討案件数（件/月）', '重点顧客向け有効商談転換率（%）', '既存重点顧客の継続契約率（%）'],
    ['営業人日あたりの有効商談創出数（件）', '高付加価値提案の平均受注単価（円）', '対象業務プロセスの工数削減率（%）'],
    ['対象セグメントにおける重点提案案件の営業利益率（%pt）', '高付加価値商談の平均契約額（円）', '重点案件の初回提案から受注判断までの営業人日（営業人日/案件）'],
  ];
  return { krs: sets[variant], sourceDetail: `template:default_v${variant}` };
}

/**
 * ★ TASK 2-2: 各プロジェクトに必ず okrs があることを保証（LLMの生成漏れ対策）
 * - 既に okrs があれば保持
 * - LLMが objective/keyResults を別名で返していれば拾う
 * - 両方ない場合も空の okrs を入れる（UI側が「未生成」と判定可能に）
 * - ★ keyResults が空の場合は最低3件を保証する（deriveKrsByContext で差別化）
 */
async function ensureOkrs(project: any, laneType?: CascadeLaneType, deptName?: string): Promise<any> {
  if (!project) return project;

  const projectTitle = String(project?.title ?? project?.name ?? 'プロジェクト').trim();
  const deptLabel = deptName ? `dept="${deptName}"` : '';
  let fallbackUsed = false;

  // 既に okrs があればそれを使用（ただし keyResults も正規化）
  if (Array.isArray(project?.okrs) && project.okrs.length > 0) {
    // ★ 既存の okrs も keyResults を正規化＆保証（Promise.all で並列処理）
    project.okrs = await Promise.all(
      project.okrs.map(async (o: any) => {
        const normalized = await ensureKeyResults(o, projectTitle, deptName, laneType);
        return {
          ...normalized,
          objective: String(normalized?.objective ?? normalized?.goal ?? normalized?.outcome ?? projectTitle).trim() || projectTitle,
          // ★ TASK D: メタデータを明示的に保持
          _krSource: (normalized as any)?._krSource,
          _krReason: (normalized as any)?._krReason,
          _krSourceDetail: (normalized as any)?._krSourceDetail,
          _rawType: (normalized as any)?._rawType,
          _rawLen: (normalized as any)?._rawLen,
          _aiCalled: (normalized as any)?._aiCalled,
        };
      })
    );
    // ★ TASK C: raw と final ログを分離
    // raw段階：okr.okrs が存在する場合
    const okrs0 = project.okrs[0];
    const rawKrLen = (okrs0 as any)?._rawLen ?? 'unknown';
    const rawKrType = (okrs0 as any)?._rawType ?? 'object.okrs';
    console.log(
      `[cascade][kpi][raw] project="${projectTitle}" ${deptLabel} ` +
      `rawType="${rawKrType}" rawLen=${rawKrLen} ai_called=true`
    );

    // 生成経路メタ情報
    project._krSource = (okrs0 as any)?._krSource ?? 'AI';
    project._krReason = (okrs0 as any)?._krReason ?? 'llm_returned';
    project._krSourceDetail = (okrs0 as any)?._krSourceDetail ?? 'ai:gpt';

    // final 段階：テンプレ注入後の最終結果
    const finalKrLen = project.okrs[0]?.keyResults?.length ?? 0;
    console.log(
      `[cascade][kpi][final] project="${projectTitle}" ${deptLabel} ` +
      `krSource="${project._krSource}" reason="${project._krReason}" ` +
      `sourceDetail="${project._krSourceDetail}" finalLen=${finalKrLen}`
    );

    return project;
  }

  // objective / keyResults が別の名前で来ていないか確認
  const objective =
    project?.objective ??
    project?.goal ??
    project?.outcome ??
    projectTitle ??
    '';

  const keyResults =
    (Array.isArray(project?.keyResults) && project.keyResults.length > 0 ? project.keyResults : null) ||
    (Array.isArray(project?.kpis) && project.kpis.length > 0 ? project.kpis : null) ||
    (Array.isArray(project?.metrics) && project.metrics.length > 0 ? project.metrics : null) ||
    (Array.isArray(project?.measures) && project.measures.length > 0 ? project.measures : null) ||
    [];

  // 最低限の okrs を作成
  const okrObj = {
    objective: String(objective ?? '').trim() || projectTitle,
    keyResults: keyResults,
  };

  // ★ keyResults が空なら自動補完（deriveKrsByContext で差別化）
  fallbackUsed = !Array.isArray(keyResults) || keyResults.length === 0;

  // ★ TASK C: raw 段階のログ（ensureKeyResults 実行前）
  const rawKrLen_pre = Array.isArray(keyResults) ? keyResults.length : 0;
  const rawKrType_pre = Array.isArray(keyResults) ? 'array' : typeof keyResults;
  console.log(
    `[cascade][kpi][raw] project="${projectTitle}" ${deptLabel} ` +
    `rawType="${rawKrType_pre}" rawLen=${rawKrLen_pre} ai_called=${rawKrLen_pre > 0}`
  );

  const okrWithKR = await ensureKeyResults(okrObj, projectTitle, deptName, laneType);

  // ★ TASK D: メタデータを保持しながら OKR を設定
  project.okrs = [{
    ...okrWithKR,
    // メタデータを OKR レベルでも明示的に保持
    _krSource: (okrWithKR as any)?._krSource,
    _krReason: (okrWithKR as any)?._krReason,
    _krSourceDetail: (okrWithKR as any)?._krSourceDetail,
    _rawType: (okrWithKR as any)?._rawType,
    _rawLen: (okrWithKR as any)?._rawLen,
    _aiCalled: (okrWithKR as any)?._aiCalled,
    _aiAttempts: (okrWithKR as any)?._aiAttempts,
  }];

  // ★ TASK D: メタ情報は ensureKeyResults から取得（常に存在）
  project._krSource = (okrWithKR as any)?._krSource ?? 'unknown';
  project._krReason = (okrWithKR as any)?._krReason ?? 'unknown';
  project._krSourceDetail = (okrWithKR as any)?._krSourceDetail ?? 'unknown';

  // ★ TASK C: final 段階のログ（ensureKeyResults 実行後）
  const finalKrLen = okrWithKR?.keyResults?.length ?? 0;
  console.log(
    `[cascade][kpi][final] project="${projectTitle}" ${deptLabel} ` +
    `krSource="${project._krSource}" reason="${project._krReason}" ` +
    `sourceDetail="${project._krSourceDetail}" finalLen=${finalKrLen}`
  );

  // ★ TASK 2-1: end-to-end メタ証明ログ（ensureKeyResults 戻り直後）
  const okr0 = project.okrs?.[0];
  console.log('[cascade][kpi][meta]', {
    dept: deptName ?? 'unknown',
    project: projectTitle,
    krSource: (project as any)._krSource ?? (okr0 as any)?._krSource,
    reason: (project as any)._krReason ?? (okr0 as any)?._krReason,
    sourceDetail: (project as any)._krSourceDetail ?? (okr0 as any)?._krSourceDetail,
    rawType: (okr0 as any)?._rawType,
    rawLen: (okr0 as any)?._rawLen,
    ai_called: (okr0 as any)?._aiCalled,
    finalLen: Array.isArray((okr0 as any)?.keyResults) ? (okr0 as any).keyResults.length : null,
  });

  return project;
}

/**
 * TASK 2-2: 全部門の全 lane の全プロジェクトに okrs を保証する
 * - TASK B: deriveKrsByContext で KR を差別化（laneType を渡す）
 * - TASK C: 同一部門内の KR 重複を抑制する（usedKrSet で微調整）
 */
async function ensureOkrsForAllDepts(depts: any[]): Promise<any[]> {
  if (!Array.isArray(depts)) return depts;

  return Promise.all(
    depts.map(async (dept: any) => {
      if (!dept) return dept;

      // ★ TASK 4-3: 部門単位での usedKrSet で重複を検出＆差し替え
      const usedKrSet = new Set<string>();

      // ★ ヘルパー: KR のリストから重複を回避した新しいリストを生成
      const deduplicateAndReplaceKrs = (krs: any[], projectTitle: string, laneType?: CascadeLaneType): any[] => {
        // usedKrSet に対してチェック
        const uniqueLabels = new Set<string>();
        const finalKrs: any[] = [];

        for (const kr of krs) {
          const krLabel = normalizeKpiLabel(kr.label || String(kr), projectTitle);
          if (usedKrSet.has(krLabel)) {
            // 重複！差し替え候補を探す
            let replaced = false;
            // variant 1, 2 を試して、被らない KR セットを見つける
            for (let variant of [1, 2] as const) {
              const result = deriveKrsByContext(projectTitle, undefined, laneType, undefined, variant);
              const altKrs = result.krs;
              for (const altKr of altKrs) {
                const cleanAltKr = normalizeKpiLabel(altKr, projectTitle);
                if (!usedKrSet.has(cleanAltKr) && !uniqueLabels.has(cleanAltKr)) {
                  finalKrs.push({ ...kr, label: cleanAltKr });
                  uniqueLabels.add(cleanAltKr);
                  usedKrSet.add(cleanAltKr);
                  replaced = true;
                  break;
                }
              }
              if (replaced) break;
            }
            // 差し替え候補が見つからない場合は suffix 付与（最終手段）
            if (!replaced) {
              const shortTitle = projectTitle.substring(0, 8);
              const suffixKr = `${krLabel} - ${shortTitle}`;
              finalKrs.push({ ...kr, label: suffixKr });
              usedKrSet.add(suffixKr);
              uniqueLabels.add(suffixKr);
            }
          } else {
            finalKrs.push({ ...kr, label: krLabel });
            usedKrSet.add(krLabel);
            uniqueLabels.add(krLabel);
          }
        }
        return finalKrs;
      };

      const deptName = dept?.name ?? '';

      // lanes.existing.projects（laneType='existing' を指定）
      if (Array.isArray(dept?.lanes?.existing?.projects)) {
        dept.lanes.existing.projects = await Promise.all(
          dept.lanes.existing.projects.map(async (p: any) => {
            const processed = await ensureOkrs(p, 'existing', deptName);
            // ★ TASK 4-3: 重複排除＆差し替え
            if (Array.isArray(processed?.okrs?.[0]?.keyResults)) {
              processed.okrs[0].keyResults = deduplicateAndReplaceKrs(
                processed.okrs[0].keyResults,
                p?.title,
                'existing'
              );
            }
            return processed;
          })
        );
      }

      // lanes.new.projects（laneType='new' を指定）
      if (Array.isArray(dept?.lanes?.new?.projects)) {
        dept.lanes.new.projects = await Promise.all(
          dept.lanes.new.projects.map(async (p: any) => {
            const processed = await ensureOkrs(p, 'new', deptName);
            // ★ TASK 4-3: 重複排除＆差し替え
            if (Array.isArray(processed?.okrs?.[0]?.keyResults)) {
              processed.okrs[0].keyResults = deduplicateAndReplaceKrs(
                processed.okrs[0].keyResults,
                p?.title,
                'new'
              );
            }
            return processed;
          })
        );
      }

      // lanes.intraCollab / lanes.interCollab.projects（STEP1連携候補をSTEP4の連携型プロジェクトへ昇格）
      for (const laneType of ['intraCollab', 'interCollab'] as const) {
        const projects = dept?.lanes?.[laneType]?.projects;
        if (!Array.isArray(projects)) continue;

        dept.lanes[laneType].projects = await Promise.all(
          projects.map(async (p: any) => {
            const processed = await ensureOkrs(p, laneType, deptName);
            if (Array.isArray(processed?.okrs?.[0]?.keyResults)) {
              processed.okrs[0].keyResults = deduplicateAndReplaceKrs(
                processed.okrs[0].keyResults,
                p?.title,
                laneType
              );
            }
            return {
              ...processed,
              sourceType: laneType,
              collaborationType: laneType === 'intraCollab' ? 'intraDept' : 'interDept',
            };
          })
        );
      }

      // 旧形式: dept.projects（後方互換、laneType なし）
      if (Array.isArray(dept?.projects)) {
        dept.projects = await Promise.all(
          dept.projects.map(async (p: any) => {
            const processed = await ensureOkrs(p, undefined, deptName);
            // ★ TASK 4-3: 重複排除＆差し替え
            if (Array.isArray(processed?.okrs?.[0]?.keyResults)) {
              processed.okrs[0].keyResults = deduplicateAndReplaceKrs(
                processed.okrs[0].keyResults,
                p?.title
              );
            }
            return processed;
          })
        );
      }

      return dept;
    })
  );
}

/**
 * csvFinanceData から「表示用に抜粋できる"行配列"」を抽出する。
 * - 旧：csvFinanceData が配列（row[]）
 * - 新：csvFinanceData がオブジェクト（{financeBS, segmentPL, segmentBS, 0: {...}} 等）
 */
function extractCsvPreviewRows(csvFinanceData: any): any[] {
  if (!csvFinanceData) return [];

  // 1) 既に配列
  if (Array.isArray(csvFinanceData)) return csvFinanceData;

  // 2) rows/data が配列
  if (Array.isArray(csvFinanceData?.rows)) return csvFinanceData.rows;
  if (Array.isArray(csvFinanceData?.data)) return csvFinanceData.data;

  // 3) 数値キーが混ざるケース（0,1,...）
  if (typeof csvFinanceData === 'object') {
    const numericKeys = Object.keys(csvFinanceData).filter((k) => /^\d+$/.test(k));
    if (numericKeys.length > 0) {
      numericKeys.sort((a, b) => Number(a) - Number(b));
      const first = (csvFinanceData as any)[numericKeys[0]];
      if (Array.isArray(first)) return first;
      if (first && typeof first === 'object') return [first];
    }
  }

  // 4) financeBS / segmentPL / segmentBS などの構造から無理やり数行作る
  const out: any[] = [];

  if (Array.isArray(csvFinanceData?.financeBS)) {
    out.push(...csvFinanceData.financeBS.slice(0, 3).map((r: any) => ({ source: 'financeBS', ...r })));
  }

  const segPL = csvFinanceData?.segmentPL;
  if (segPL && typeof segPL === 'object') {
    const segNames = Object.keys(segPL).slice(0, 2);
    for (const name of segNames) {
      const rows = Array.isArray(segPL[name]) ? segPL[name] : [];
      out.push(...rows.slice(0, 2).map((r: any) => ({ source: `segmentPL:${name}`, ...r })));
    }
  }

  const segBS = csvFinanceData?.segmentBS;
  if (segBS && typeof segBS === 'object') {
    const segNames = Object.keys(segBS).slice(0, 1);
    for (const name of segNames) {
      const rows = Array.isArray(segBS[name]) ? segBS[name] : [];
      out.push(...rows.slice(0, 2).map((r: any) => ({ source: `segmentBS:${name}`, ...r })));
    }
  }

  return out;
}

/** 部門seed projects（string[]/object[] 混在）を string[] に正規化 */
function normalizeProjectSeeds(raw: any): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((p) => {
      if (typeof p === 'string') return p;
      if (p && typeof p === 'object') return String(p.title ?? p.name ?? '').trim();
      return '';
    })
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 5);
}

/* =========================
 * 財務サマリ / ポートフォリオをテキスト化（AI用）
 * ======================= */

function mStrFromUnknown(v: any): number | null {
  const n = toNum(v);
  return n == null ? null : n;
}

function summarizeFinanceSummary(financeSummary: any, limitYears = 4): string {
  if (!financeSummary) return '（サマリー未入力）';

  const rows: any[] = Array.isArray(financeSummary)
    ? financeSummary
    : Array.isArray(financeSummary?.rows)
      ? financeSummary.rows
      : [];

  if (!rows.length) return '（サマリー未入力）';

  const byYear = new Map<string, any[]>();

  for (const r of rows) {
    const yRaw = r.year ?? r.fiscal_year ?? r.yearLabel ?? 'N/A';
    const yKey = String(yRaw);
    if (!byYear.has(yKey)) byYear.set(yKey, []);
    byYear.get(yKey)!.push(r);
  }

  // 年度は「最新→過去」を優先（数字化できるものは数字で比較、できないものは文字列）
  const yearKeys = [...byYear.keys()].sort((a, b) => {
    const na = toNum(a);
    const nb = toNum(b);
    if (na != null && nb != null) return nb - na; // desc
    if (na != null && nb == null) return -1;
    if (na == null && nb != null) return 1;
    return String(b).localeCompare(String(a));
  });

  const pickedYears = yearKeys.slice(0, limitYears);

  const lines: string[] = [];
  for (const y of pickedYears) {
    const group = byYear.get(y) || [];
    const yearLabel = String(y);

    const unitLines = group
      .slice(0, 3)
      .map((r: any) => {
        const bu = r.business_unit ?? r.unitName ?? '全社';
        const rev = r.revenue ?? r.sales ?? r.net_sales;
        const op = r.operating_income ?? r.op ?? r.operatingProfit;

        const revNum = toNum(rev);
        const opNum = toNum(op);
        const margin =
          toNum(r.operating_margin_pct ?? r.opMargin) ??
          (revNum != null && revNum !== 0 && opNum != null ? Math.round((opNum / revNum) * 1000) / 10 : null);

        const revStr = revNum != null ? `${revNum}百万円` : '—';
        const opStr = opNum != null ? `${opNum}百万円` : '—';
        const mStr = margin != null ? `${margin}%` : '—';
        return `    - ${bu}: 売上=${revStr}, 営業利益=${opStr}, 利益率=${mStr}`;
      })
      .join('\n');

    lines.push(`  <${yearLabel}年>:\n${unitLines || '    - （データ不足）'}`);
  }

  return lines.join('\n');
}

function summarizeBusinessPortfolio(bp: any, limitUnits = 8): string {
  if (!bp || typeof bp !== 'object') return '（ポートフォリオ未入力）';

  const units: any[] = Array.isArray(bp.units) ? bp.units : [];
  if (!units.length) return '（ポートフォリオ未入力）';

  const lines = units.slice(0, limitUnits).map((u: any) => {
    const name = u.name ?? u.label ?? '不明ユニット';
    const revNum = toNum(u.revenue ?? u.sales ?? u.netSales);
    const opNum = toNum(u.operatingProfit ?? u.profit ?? u.op);
    const growthNum = toNum(u.growthRate ?? u.growth ?? u.salesGrowthRate);
    const marginNum = mStrFromUnknown(u.profitMargin ?? u.margin ?? u.opMargin);

    const revStr = revNum != null ? `${revNum}百万円` : '—';
    const opStr = opNum != null ? `${opNum}百万円` : '—';
    const gStr = growthNum != null ? `${growthNum}%` : '—';
    const mStr = marginNum != null ? `${marginNum}%` : '—';

    const pos =
      growthNum != null && marginNum != null
        ? growthNum >= 0 && marginNum >= 0
          ? '高成長×高収益（攻めの投資候補）'
          : growthNum >= 0 && marginNum < 0
            ? '高成長×低収益（テコ入れ前提の投資）'
            : growthNum < 0 && marginNum >= 0
              ? '低成長×高収益（収穫・守り）'
              : '低成長×低収益（撤退・縮小候補）'
        : 'ポジション不明';

    return `  - ${name}: 売上=${revStr}, 利益=${opStr}, 成長率=${gStr}, 利益率=${mStr} → ${pos}`;
  });

  return lines.join('\n');
}

/* =========================
 * FactPack 機構（TASK 1: 引用可能な固有事実セット）
 * ======================= */

/** FactPack の基本単位：引用可能な短テキスト片 */
type FactAnchor = {
  id: string;
  // 例："fact-seg-1", "fact-cust-2", "fact-fin-3"
  text: string;
  // 引用対象のテキスト（50～120文字程度）
  source?: 'overview' | 'customers' | 'finance';
  // 由来
};

/** 部門ごとの事実パック */
type DeptFactPack = {
  segmentName: string; // マッチしたセグメント名（未マッチの場合は部門名）
  anchors: FactAnchor[]; // 8～12個の引用可能な事実
  customers: string[]; // 主要顧客（2～3個）
  overview: string; // セグメント事業概要（短い）
  financeHints: string[]; // 財務の傾向・変化を示唆するテキスト（3～5個）
};

/**
 * 部門ごとの FactPack を生成（引用ベース生成用）
 * - segment 特定（既存の正規化マッチングを流用）
 * - anchors を overview, customers, finance から抽出
 * ★修正1: anchors.length >= 8 を保証
 */
function buildDeptFactPack(
  deptName: string,
  businessSegments: any[],
  csvFinanceData: any,
  financeSummary: any,
  businessPortfolio: any
): DeptFactPack {
  const normalizeName = (s: string) =>
    (s ?? '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[・･]/g, '・')
      .replace(/(事業部|本部|部門|部)$/g, '')
      .trim();

  /**
   * ★STAGE3専用補助：finance raw 値の単位判定と金額文言生成
   * csvFinanceData 由来の値は「円」「百万円」が混在しているため、値の大きさで判定
   * - >= 10,000,000: 「円」と判定 → 百万円へ換算（÷1,000,000）
   * - 100～9,999,999: 「百万円」と判定（そのまま使用）
   * - < 100: 不正値 → 金額文言を返さない（増減率のみ残す）
   */
  const formatFinanceValue = (value: number | null): { text: string; isValid: boolean } => {
    if (value == null || !Number.isFinite(value)) {
      return { text: '', isValid: false };
    }

    if (value >= 10000000) {
      // 「円」と判定 → 百万円へ換算
      const converted = Math.round((value / 1000000) * 10) / 10;
      return { text: `${converted}百万円`, isValid: true };
    } else if (value >= 100 && value < 10000000) {
      // 「百万円」と判定（そのまま）
      const rounded = Math.round(value * 10) / 10;
      return { text: `${rounded}百万円`, isValid: true };
    } else {
      // < 100 は不正値 → 金額文言を出さない
      return { text: '', isValid: false };
    }
  };

  // ★ segment マッチング（既存ロジックを流用）
  const keyN = normalizeName(deptName);
  let seg: any = undefined;

  if (Array.isArray(businessSegments)) {
    // 完全一致
    seg = businessSegments.find((s: any) => normalizeName(s?.name ?? '') === keyN);
    // 部分一致
    if (!seg && keyN.length >= 4) {
      const hits = businessSegments.filter((s: any) => normalizeName(s?.name ?? '').includes(keyN));
      seg = hits.length === 1 ? hits[0] : undefined;
    }
  }

  const segmentName = seg?.name ?? deptName;
  const anchors: FactAnchor[] = [];
  let anchorCount = 0;

  // ★ overview から最大4個の anchors
  const overview = (seg?.overview ?? seg?.summary ?? '').trim();
  if (overview) {
    // 全体を1つ
    if (overview.length <= 120) {
      anchors.push({
        id: `fact-seg-${++anchorCount}`,
        text: overview,
        source: 'overview',
      });
    } else {
      // 文で分割（最大4文）
      const sentences = overview.split(/[。．]/g).filter((s: string) => s.trim().length > 0);
      for (let i = 0; i < Math.min(4, sentences.length); i++) {
        const sent = sentences[i].trim();
        if (sent) {
          anchors.push({
            id: `fact-seg-${++anchorCount}`,
            text: sent,
            source: 'overview',
          });
        }
      }
    }
  }

  // ★ customers から最大3個（string | string[] 両対応）
  const customersVal = seg?.mainCustomers ?? seg?.keyCustomers ?? seg?.customers;
  const customersList: string[] = [];

  if (customersVal) {
    // customersVal が string[] または string の両方に対応
    const parts: string[] = Array.isArray(customersVal)
      ? customersVal.map((c: any) => String(c ?? '').trim()).filter(Boolean)
      : String(customersVal ?? '')
          .split(/[、,，]/g)
          .map((s: string) => s.trim())
          .filter(Boolean);
    customersList.push(...parts);

    for (let i = 0; i < Math.min(3, parts.length); i++) {
      const cust = parts[i];
      anchors.push({
        id: `fact-cust-${++anchorCount}`,
        text: `主要顧客：${cust}`,
        source: 'customers',
      });
    }
  }

  // ★ finance から複数個（segment 別 PL/BS または segment の nested pl/bs）
  const financeHints: string[] = [];

  if (seg) {
    const segPL = seg?.pl ?? seg?.segmentPL;
    const segBS = seg?.bs ?? seg?.segmentBS;
    let latestYear: string | number | undefined;

    if (Array.isArray(segPL) && segPL.length >= 2) {
      const latest = segPL[segPL.length - 1];
      const prev = segPL[segPL.length - 2];

      latestYear = latest?.year ?? latest?.period;

      const latestRev = toNum(latest?.revenue ?? latest?.sales);
      const prevRev = toNum(prev?.revenue ?? prev?.sales);
      const latestMargin = toNum(latest?.operatingIncome ?? latest?.operatingProfit);

      if (latestRev != null && prevRev != null) {
        const change = ((latestRev - prevRev) / prevRev) * 100;
        const sign = change >= 0 ? '成長' : '低迷';
        const yearStr = latestYear ? `${latestYear}年` : '';

        // ★STAGE3修正：latestRev を単位判定して hint 生成
        const revFormat = formatFinanceValue(latestRev);
        let hint: string;
        if (revFormat.isValid) {
          hint = `売上は${Math.abs(change).toFixed(1)}%${sign}（${yearStr}${revFormat.text}）`;
        } else {
          // 異常値 → 金額文言を落とす（増減率のみ）
          hint = `売上は${Math.abs(change).toFixed(1)}%${sign}`;
        }
        financeHints.push(hint);

        // [STAGE3_FACTPACK_GEN] ログ：fact-fin 生成時点での値
        console.log('[STAGE3_FACTPACK_GEN_SEGPL]', {
          deptName,
          anchorId: `fact-fin-${anchorCount + 1}`,
          source: 'seg.pl (businessSegments)',
          latestRev_raw: latestRev,
          latestRev_type: typeof latestRev,
          formatResult: revFormat,
          change_pct: change.toFixed(1),
          yearLabel: latestYear,
          hint_text: hint,
          note: revFormat.isValid ? 'corrected' : 'money_removed',
        });

        anchors.push({
          id: `fact-fin-${++anchorCount}`,
          text: hint,
          source: 'finance',
        });
      }

      if (latestMargin != null && latestRev != null && latestRev !== 0) {
        const margin = (latestMargin / latestRev) * 100;
        const yearStr = latestYear ? `${latestYear}年` : '';
        const hint = `営業利益率は約${margin.toFixed(1)}%（${yearStr}）`;
        financeHints.push(hint);
        anchors.push({
          id: `fact-fin-${++anchorCount}`,
          text: hint,
          source: 'finance',
        });
      }

      // ★ BS 由来の anchor を1つ追加（在庫/売掛金/設備のいずれか）
      if (Array.isArray(segBS) && segBS.length > 0) {
        const latestBS = segBS[segBS.length - 1];
        let bsHint: string | undefined;

        // 優先順：在庫 → 売掛金 → 設備
        const inventory = toNum(latestBS?.inventory ?? latestBS?.currentAssets?.inventory);
        const receivables = toNum(latestBS?.receivables ?? latestBS?.currentAssets?.receivables ?? latestBS?.accountsReceivable);
        const fixedAssets = toNum(latestBS?.fixedAssets ?? latestBS?.propertyPlantEquipment);

        // ★STAGE3修正：BS 値も単位判定して hint 生成
        if (inventory != null) {
          const invFormat = formatFinanceValue(inventory);
          bsHint = invFormat.isValid ? `在庫は${invFormat.text}` : undefined;
        } else if (receivables != null) {
          const recFormat = formatFinanceValue(receivables);
          bsHint = recFormat.isValid ? `売掛金は${recFormat.text}` : undefined;
        } else if (fixedAssets != null) {
          const faFormat = formatFinanceValue(fixedAssets);
          bsHint = faFormat.isValid ? `固定資産は${faFormat.text}` : undefined;
        }

        if (bsHint && financeHints.length < 4) {
          // 既に4個以上ある場合は追加しない
          const yearStr = latestYear ? `${latestYear}年` : '';
          const fullHint = yearStr ? `${bsHint}（${yearStr}）` : bsHint;

          // [STAGE3_FACTPACK_GEN_BS] ログ：BS hint 生成時点での値
          const bsType = inventory != null ? 'inventory' : receivables != null ? 'receivables' : 'fixedAssets';
          const bsValue = inventory ?? receivables ?? fixedAssets ?? 0;
          console.log('[STAGE3_FACTPACK_GEN_BS]', {
            deptName,
            anchorId: `fact-fin-${anchorCount + 1}`,
            source: 'seg.bs (businessSegments)',
            bsType: bsType,
            bsValue_raw: bsValue,
            bsValue_type: typeof bsValue,
            bsValue_isNormal: bsValue < 10000000,
            yearLabel: latestYear,
            hint_text: fullHint,
            note: bsValue > 10000000 ? 'ABNORMAL_VALUE' : 'normal',
          });

          financeHints.push(fullHint);
          anchors.push({
            id: `fact-fin-${++anchorCount}`,
            text: fullHint,
            source: 'finance',
          });
        }
      }
    }
  }

  // ★ fallback 1: csvFinanceData.segmentPL から該当セグメントを検索
  if (anchors.length < 8 && csvFinanceData) {
    const segPL = csvFinanceData?.segmentPL;
    if (segPL && typeof segPL === 'object') {
      const rows = Array.isArray(segPL[segmentName]) ? segPL[segmentName] : null;
      if (rows && rows.length >= 2) {
        const latest = rows[rows.length - 1];
        const prev = rows[rows.length - 2];
        const latestRev = toNum(latest?.revenue ?? latest?.sales);
        const prevRev = toNum(prev?.revenue ?? prev?.sales);

        if (latestRev != null && prevRev != null && anchors.length < 8) {
          const change = ((latestRev - prevRev) / prevRev) * 100;
          const sign = change >= 0 ? '増加' : '減少';

          // ★STAGE3修正：csvFinanceData 由来の latestRev を単位判定
          const revFormat = formatFinanceValue(latestRev);
          let hint: string;
          if (revFormat.isValid) {
            hint = `売上は${Math.abs(change).toFixed(1)}%${sign}（${revFormat.text}）`;
          } else {
            // 異常値 → 金額文言を落とす
            hint = `売上は${Math.abs(change).toFixed(1)}%${sign}`;
          }

          // [STAGE3_FACTPACK_GEN_CSV] ログ：csvFinanceData フォールバック版
          console.log('[STAGE3_FACTPACK_GEN_CSV]', {
            deptName,
            anchorId: `fact-fin-${anchorCount + 1}`,
            source: 'csvFinanceData.segmentPL',
            latestRev_raw: latestRev,
            latestRev_type: typeof latestRev,
            formatResult: revFormat,
            change_pct: change.toFixed(1),
            hint_text: hint,
            note: revFormat.isValid ? 'corrected' : 'money_removed',
          });

          anchors.push({
            id: `fact-fin-${++anchorCount}`,
            text: hint,
            source: 'finance',
          });
        }
      }
    }
  }

  // ★ fallback 2: financeSummary から情報を抽出
  if (anchors.length < 8 && financeSummary) {
    const summary = (financeSummary ?? '').toString().trim();
    if (summary) {
      // 文で分割して最大3個追加
      const sentences = summary.split(/[。．]/g).filter((s: string) => s.trim().length > 0);
      for (let i = 0; i < Math.min(3, sentences.length) && anchors.length < 8; i++) {
        const sent = sentences[i].trim();
        if (sent && sent.length > 10) {
          anchors.push({
            id: `fact-fin-${++anchorCount}`,
            text: sent.slice(0, 100),
            source: 'finance',
          });
        }
      }
    }
  }

  // ★ fallback 3: businessPortfolio から情報を抽出
  if (anchors.length < 8 && businessPortfolio) {
    const portfolio = (businessPortfolio ?? '').toString().trim();
    if (portfolio) {
      // 文で分割して最大2個追加
      const sentences = portfolio.split(/[。．]/g).filter((s: string) => s.trim().length > 0);
      for (let i = 0; i < Math.min(2, sentences.length) && anchors.length < 8; i++) {
        const sent = sentences[i].trim();
        if (sent && sent.length > 10) {
          anchors.push({
            id: `fact-fin-${++anchorCount}`,
            text: sent.slice(0, 100),
            source: 'finance',
          });
        }
      }
    }
  }

  // 入力に存在しない一般論を「事実」として水増ししない。
  // anchors が0〜1件でも、その実在件数に合わせて後段の引用必須数を動的に調整する。
  if (anchors.length < 2) {
    console.warn('[cascade][factpack-quality]', {
      deptName,
      segmentName,
      actualAnchorCount: anchors.length,
      requiredCitationCount: Math.min(2, anchors.length),
      note: 'insufficient_real_anchors_no_generic_fallback',
    });
  }

  return {
    segmentName,
    anchors: anchors.slice(0, 12), // 最大12個。実データ由来の事実だけを返す
    customers: customersList.slice(0, 3),
    overview: overview.slice(0, 200),
    financeHints: financeHints.slice(0, 5),
  };
}

/* =========================
 * 応答の正規化（2レーン対応＋後方互換）
 * ======================= */
type NormProject = {
  title: string;
  reason: string;
  hypothesis: string;
  mainLever?: 'ACQ' | 'ARPU' | 'CHURN' | 'COST' | 'EFFICIENCY' | 'FUTURE';
  horizon?: 'short' | 'mid' | 'long';
  kind?: 'growth' | 'cost' | 'efficiency' | 'future';
  sourceType?: CascadeLaneType;
  collaborationType?: 'intraDept' | 'interDept';
  partnerDepartment?: string;
  generatedBy?: 'ai' | 'user';
  generatedSlot?: number;
  generatedGroup?: string;
  citations?: string[];
  valueDriverLinks?: string[];
  skillRequirements?: any;
  humanInvestments?: any[];
  okrs?: any[];
};

function normalizeProjects(raw: any): NormProject[] {
  const list = Array.isArray(raw) ? raw : [];
  const allowedLevers = ['ACQ', 'ARPU', 'CHURN', 'COST', 'EFFICIENCY', 'FUTURE'] as const;
  const allowedHorizons = ['short', 'mid', 'long'] as const;
  const allowedKinds = ['growth', 'cost', 'efficiency', 'future'] as const;

  return list
    .filter((p: any) => typeof p?.title === 'string' && p.title.trim().length > 0)
    .map((p: any) => {
      const title = p.title.trim();
      const reason = typeof p?.reason === 'string' ? p.reason.trim() : '';
      // ★fix9: AIが返した説明文を最大限尊重する。
      // hypothesis が空でも、AI由来の reason / description / detail があれば仮説説明として復元する。
      // 固定文の補完はここでは行わない。
      const hypothesis =
        (typeof p?.hypothesis === 'string' && p.hypothesis.trim()) ||
        (typeof p?.description === 'string' && p.description.trim()) ||
        (typeof p?.detail === 'string' && p.detail.trim()) ||
        reason ||
        '';

      const mainLeverRaw = typeof p?.mainLever === 'string' ? p.mainLever.trim().toUpperCase() : '';
      const mainLever = allowedLevers.includes(mainLeverRaw as any) ? (mainLeverRaw as NormProject['mainLever']) : undefined;

      const horizonRaw = typeof p?.horizon === 'string' ? p.horizon.trim().toLowerCase() : '';
      const horizon = allowedHorizons.includes(horizonRaw as any) ? (horizonRaw as NormProject['horizon']) : undefined;

      const kindRaw = typeof p?.kind === 'string' ? p.kind.trim().toLowerCase() : '';
      const kind = allowedKinds.includes(kindRaw as any) ? (kindRaw as NormProject['kind']) : undefined;

      const sourceType = ['existing', 'new', 'intraCollab', 'interCollab'].includes(String(p?.sourceType ?? '')) ? p.sourceType as CascadeLaneType : undefined;
      const collaborationType = ['intraDept', 'interDept'].includes(String(p?.collaborationType ?? '')) ? p.collaborationType as 'intraDept' | 'interDept' : undefined;
      const partnerDepartment = typeof p?.partnerDepartment === 'string' ? p.partnerDepartment.trim() : undefined;

      return {
        title,
        reason,
        hypothesis,
        mainLever,
        horizon,
        kind,
        sourceType,
        collaborationType,
        partnerDepartment,
        generatedBy: p?.generatedBy,
        generatedSlot: p?.generatedSlot,
        generatedGroup: p?.generatedGroup,
        citations: Array.isArray(p?.citations) ? p.citations : undefined,
        valueDriverLinks: Array.isArray(p?.valueDriverLinks) ? p.valueDriverLinks : undefined,
        skillRequirements: p?.skillRequirements,
        humanInvestments: Array.isArray(p?.humanInvestments) ? p.humanInvestments : undefined,
        okrs: Array.isArray(p?.okrs) ? p.okrs : undefined,
      };
    });
}

/* ★STAGE3軽量化：OKR生成関数削除（API側で OKR 生成しない） */

/* =========================
 * ★STAGE3高度化：部門別ポートフォリオから signals を抽出
 * ======================= */

function extractDeptPortfolioSignals(
  deptName: string,
  businessPortfolio?: any
): {
  isMaintainExpected: boolean;
  isProfitPriority: boolean;
  portfolioText: string;
} {
  const result = {
    isMaintainExpected: false,
    isProfitPriority: false,
    portfolioText: '',
  };

  // ★ ログ：入力値チェック
  console.log('[diag][extractDeptPortfolioSignals:start]', {
    deptName,
    typeof_businessPortfolio: typeof businessPortfolio,
    has_units: Array.isArray(businessPortfolio?.units),
    units_length: Array.isArray(businessPortfolio?.units) ? businessPortfolio.units.length : 0,
  });

  if (!businessPortfolio) {
    console.log('[diag][extractDeptPortfolioSignals:no-portfolio]', { deptName });
    return result;
  }

  // ★ units が配列か確認（完全防御）
  const units = Array.isArray(businessPortfolio?.units) ? businessPortfolio.units : [];

  if (units.length === 0) {
    console.log('[diag][extractDeptPortfolioSignals:no-units]', { deptName, unitsLength: 0 });
    // units がない場合、businessPortfolio 全体を文字列化して処理（古い形式の互換性）
    const portfolioStr = typeof businessPortfolio === 'string'
      ? businessPortfolio
      : JSON.stringify(businessPortfolio ?? {});

    // portfolioStr が文字列であることを確認してから slice
    if (typeof portfolioStr === 'string') {
      result.portfolioText = portfolioStr.slice(0, 300);
    } else {
      result.portfolioText = '';
    }

    const portfolioLower = (result.portfolioText || '').toLowerCase();
    result.isMaintainExpected = /維持|maintain|安定|stable|低成長/.test(portfolioLower);
    result.isProfitPriority = /利益|profit|margin|収益|高収益/.test(portfolioLower);

    console.log('[diag][extractDeptPortfolioSignals:fallback]', {
      deptName,
      portfolioText_len: result.portfolioText.length,
      result
    });
    return result;
  }

  // ★ units から部門名に合致するユニットを探す（units は配列で安全）
  const deptNameLower = deptName.toLowerCase();
  const matchedUnit = units.find((u: any) => {
    const unitName = String(u?.name || '').toLowerCase();
    return unitName.includes(deptNameLower) || deptNameLower.includes(unitName);
  });

  if (matchedUnit) {
    // ユニット情報からポートフォリオテキストを組み立てる
    const positionRaw = String(matchedUnit.position || '');
    const growthRaw = String(matchedUnit.growth || '');
    const profitabilityRaw = String(matchedUnit.profitability || matchedUnit.margin || '');
    const scaleRaw = String(matchedUnit.scale || matchedUnit.size || '');

    const position = positionRaw.toLowerCase();
    const growth = String(matchedUnit.growth || matchedUnit.growthRate || '').toLowerCase();
    const profitability = profitabilityRaw.toLowerCase();
    const scale = scaleRaw.toLowerCase();

    // ★ 数値型ポートフォリオ（growthRate / profitMargin）も解釈する
    const growthRateNum = typeof matchedUnit.growthRate === 'number' ? matchedUnit.growthRate : undefined;
    const profitMarginNum = typeof matchedUnit.profitMargin === 'number' ? matchedUnit.profitMargin : undefined;
    const growthBaseline =
      typeof businessPortfolio?.threshold?.growthBaseline === 'number'
        ? businessPortfolio.threshold.growthBaseline
        : 0;
    const profitBaseline =
      typeof businessPortfolio?.threshold?.profitBaseline === 'number'
        ? businessPortfolio.threshold.profitBaseline
        : 0;

    const isLowGrowthByNumber = typeof growthRateNum === 'number' && growthRateNum <= growthBaseline;
    const isHighProfitByNumber = typeof profitMarginNum === 'number' && profitMarginNum >= profitBaseline;

    // position が無い場合は数値から portfolioPosition を推定
    let derivedPosition = positionRaw;
    if (!derivedPosition && (typeof growthRateNum === 'number' || typeof profitMarginNum === 'number')) {
      if (isLowGrowthByNumber && isHighProfitByNumber) derivedPosition = '維持（低成長 × 高収益）';
      else if (!isLowGrowthByNumber && isHighProfitByNumber) derivedPosition = '成長（高成長 × 高収益）';
      else if (isLowGrowthByNumber && !isHighProfitByNumber) derivedPosition = '改善（低成長 × 低収益）';
      else if (!isLowGrowthByNumber && !isHighProfitByNumber) derivedPosition = '探索（高成長 × 低収益）';
    }

    // テキスト化（診断用）
    const parts = [
      matchedUnit.name || deptName,
      derivedPosition && `位置: ${derivedPosition}`,
      growthRaw && `成長性: ${growthRaw}`,
      typeof growthRateNum === 'number' ? `成長率: ${growthRateNum}` : '',
      profitabilityRaw && `収益性: ${profitabilityRaw}`,
      typeof profitMarginNum === 'number' ? `利益率: ${profitMarginNum}` : '',
      scaleRaw && `規模: ${scaleRaw}`,
    ].filter(Boolean);

    result.portfolioText = parts.join(' / ');

    // position から isMaintainExpected を判定
    result.isMaintainExpected = /維持|maintain|安定|stable|低成長/.test(position) || /維持|maintain|安定|stable|低成長/.test(derivedPosition.toLowerCase());

    // profitability から isProfitPriority を判定
    result.isProfitPriority = /高収益|利益|profit|margin|high/.test(profitability);

    // fallback: position に「高収益」等が含まれているか確認
    result.isProfitPriority ||= /高収益|利益|profit|margin/.test(position);

    // ★ 数値型からの補助判定
    result.isMaintainExpected ||= isLowGrowthByNumber && isHighProfitByNumber;
    result.isProfitPriority ||= isHighProfitByNumber;

    console.log('[diag][extractDeptPortfolioSignals:matched]', {
      deptName,
      matchedUnitName: matchedUnit.name,
      position,
      growth,
      profitability,
      scale,
      derivedPosition,
      growthRateNum,
      profitMarginNum,
      growthBaseline,
      profitBaseline,
      isLowGrowthByNumber,
      isHighProfitByNumber,
      result
    });
    return result;
  }

  // units に合致するユニットがない場合
  console.log('[diag][extractDeptPortfolioSignals:no-match]', {
    deptName,
    unitsCount: units.length,
    unitNames: units.map((u: any) => u?.name).filter(Boolean),
  });

  return result;
}

/* =========================
 * ★STAGE3高度化：6テーマ議論から signals を抽出（強化版）
 * ======================= */

function extractDiscussionSignals(answers?: any[]) {
  const result = {
    growIntent: false,
    maintainIntent: false,
    shrinkIntent: false,
    retreatIntent: false,
    futurePositive: false,
    futureNegative: false,
    resourceReduceIntent: false,
    collaborationIntent: false,
    stopIntent: false,
  };

  if (!Array.isArray(answers) || answers.length === 0) {
    return result;
  }

  // stepNumber ベースで answer を取得
  const getAnswerByStep = (stepNum: number): string =>
    String(answers.find((a: any) => Number(a?.stepNumber) === stepNum)?.answer ?? '').toLowerCase();

  /* ==========================================
   * Step 1: 基本方針
   * ========================================== */
  const step1 = getAnswerByStep(1);
  result.growIntent = /成長|拡大|expand|growth/.test(step1);
  result.maintainIntent = /維持|継続|安定|maintain/.test(step1);

  // ★Step1 からの撤退意図検出（拡張）
  const step1RetractKeywords = /撤退|退出|廃止|撤収|終了|中止|見送る|やめる|やめた方がよい|やめた方が会社のため|続けるべきではない|成長は見込めない|成果が見込めない|難しい|厳しい|無理|会社のためにならない/;
  if (step1RetractKeywords.test(step1)) {
    result.retreatIntent = true;
  }

  /* ==========================================
   * Step 2: 既存貢献
   * ========================================== */
  const step2 = getAnswerByStep(2);
  result.growIntent ||= /成長|拡大|伸ばす|expand/.test(step2);
  result.maintainIntent ||= /維持|継続|保つ|安定/.test(step2);

  // ★縮小・削減意図（拡張語彙）
  const step2ShrinkKeywords = /縮小|減らす|減員|削減|社員数を減らす|他事業部に移す|再配置|リソースを移す|投資しない|優先しない|reduce|shrink|cut|downsize/;
  result.shrinkIntent ||= step2ShrinkKeywords.test(step2);

  /* ==========================================
   * Step 3: 未来への挑戦
   * ========================================== */
  const step3 = getAnswerByStep(3);
  result.futurePositive ||= /挑戦|新規|探索|投資|期待|可能性|チャンス|opportunity|challenge/.test(step3);

  // ★否定的な未来見通し（拡張）
  const step3NegativeKeywords = /慎重|見極|困難|難しい|厳しい|無理|懸念|リスク|不確実|不透明|成長は見込めない|成果が見込めない|やめた方がよい|やめた方が会社のため|やめるべき|challenging|difficult|risky/;
  result.futureNegative ||= step3NegativeKeywords.test(step3);

  /* ==========================================
   * Step 4: 利益と成長（新規：正式実装）
   * ========================================== */
  const step4 = getAnswerByStep(4);
  if (step4) {
    // リソース削減の検出
    const step4ReduceKeywords = /削減|減らす|減らして|減員|人員削減|社員数を減らす|社員数を減らして|他事業部に移す|他の事業部に移す|再配置|リソースを移す|投資しない|優先しない|縮小|reduce|cut|downsize/;
    if (step4ReduceKeywords.test(step4)) {
      result.resourceReduceIntent = true;
    }

    // 成長否定の検出
    const step4NegativeKeywords = /成長は見込めない|成果が見込めない|やめた方がよい|やめた方が会社のため|難しい|厳しい|無理|リスク|不確実/;
    if (step4NegativeKeywords.test(step4)) {
      result.retreatIntent = true;
    }
  }

  /* ==========================================
   * Step 5: 協力・連携
   * ========================================== */
  const step5 = getAnswerByStep(5);
  result.collaborationIntent = /協力|連携|他部門|全社|協調|パートナー|collaboration|partnership/.test(step5);

  /* ==========================================
   * Step 6: 撤退・停止（拡張語彙）
   * ========================================== */
  const step6 = getAnswerByStep(6);

  // 撤退意図の拡張語彙
  const step6RetractKeywords = /撤退|退出|廃止|終了|中止|見送る|やめる|やめた方がよい|やめた方が会社のため|続けるべきではない|非対象|打ち切り|撤収|成長は見込めない|成果が見込めない|retreat|exit|withdraw|stop|cease/;
  result.retreatIntent ||= step6RetractKeywords.test(step6);

  // 停止対象
  const step6StopKeywords = /やめる|停止|非対象|廃止|中止|見送る|やめた方がよい|やめた方が会社のため|成果が見込めない|継続すべきではない|continue.?べきではない|stop|cease|terminate/;
  result.stopIntent ||= step6StopKeywords.test(step6);

  // リソース削減
  const step6ReduceKeywords = /人員削減|予算削減|リソース削減|減員|削減|減らす|社員数を減らす|他事業部に移す|再配置|リソースを移す|投資しない|reduce|cut|downsize/;
  result.resourceReduceIntent ||= step6ReduceKeywords.test(step6);

  return result;
}

/* =========================
 * ★STAGE3拡張：部門レビューサマリー生成（高度化版）
 * ======================= */
function buildDeptReviewSummary(params: {
  deptName: string;
  deptInput?: any;
  generatedDept?: any;
  storyText?: string;
  strategySummary?: string;
  businessPortfolio?: any;
  financeSummary?: any;
  csvFinanceData?: any;
}): {
  correctedItems: string[];
  reconsiderationPoints: string[];
} {
  const correctedItems: string[] = [];
  const reconsiderationPoints: string[] = [];

  const {
    deptName,
    deptInput,
    generatedDept,
    storyText = '',
    businessPortfolio,
  } = params;

  // ★ 開始ログ
  console.log('[diag][stage3:buildDeptReviewSummary:start]', {
    deptName,
    hasGeneratedDept: !!generatedDept,
    hasInputAnswers: !!deptInput?.answers,
    businessPortfolio_type: typeof businessPortfolio,
  });

  if (!generatedDept) {
    console.log('[diag][stage3:buildDeptReviewSummary:no-dept]', { deptName });
    return { correctedItems, reconsiderationPoints };
  }

  // ★SIGNALS 抽出
  const discussion = extractDiscussionSignals(deptInput?.answers);

  // ★プロジェクト判定
  const hasExisting = Array.isArray(generatedDept.lanes?.existing?.projects) && generatedDept.lanes.existing.projects.length > 0;
  const hasNew = Array.isArray(generatedDept.lanes?.new?.projects) && generatedDept.lanes.new.projects.length > 0;
  const totalProjects = (hasExisting ? generatedDept.lanes.existing.projects.length : 0) + (hasNew ? generatedDept.lanes.new.projects.length : 0);

  // ★部門別ポートフォリオ signals 抽出（修正：businessPortfolio.units から部門別情報を抽出）
  console.log('[diag][stage3:buildDeptReviewSummary:before-portfolio]', { deptName });
  const portfolioSignals = extractDeptPortfolioSignals(deptName, businessPortfolio);
  console.log('[diag][stage3:buildDeptReviewSummary:after-portfolio]', { deptName, portfolioSignals });
  const { isMaintainExpected, isProfitPriority, portfolioText } = portfolioSignals;

  // ★高度化判定：ポートフォリオ期待 vs 議論結果（最高優先度）
  const portfolioMismatchPoints: string[] = [];

  if (isMaintainExpected && discussion.resourceReduceIntent && discussion.stopIntent) {
    portfolioMismatchPoints.push(
      '高収益事業に対して継続前提を外し、人員削減・撤退判断が同時に示されています。維持方針の根拠を再確認してください。'
    );
  }

  if (isMaintainExpected && discussion.retreatIntent) {
    portfolioMismatchPoints.push(
      '当部門は事業ポートフォリオ上「維持（低成長 × 高収益）」に位置付けられていますが、6テーマ議論では撤退判断が強く示されています。維持方針との整合を再検討してください。'
    );
  }

  if (isProfitPriority && discussion.retreatIntent && !discussion.growIntent) {
    portfolioMismatchPoints.push(
      '利益優先事業として位置付けられているにもかかわらず、撤退方向が示されています。事業継続の妥当性を再確認してください。'
    );
  }

  // ★portfolio mismatch を最優先で追加
  reconsiderationPoints.push(...portfolioMismatchPoints);

  // ★議論 vs 再生成結果（次の優先度）
  // 既にポートフォリオ不整合などの上位方針メッセージが出ている場合は、
  // generic な撤退警告は重複感が強いため非表示にする。
  if (portfolioMismatchPoints.length === 0 && discussion.retreatIntent && discussion.stopIntent && totalProjects > 0) {
    reconsiderationPoints.push(
      '撤退・停止判断が同時に示されているにもかかわらず、プロジェクトが含まれています。実行計画の取捨選別を再確認してください。'
    );
  }

  if ((discussion.growIntent || discussion.maintainIntent) && totalProjects === 0) {
    reconsiderationPoints.push(
      '成長・維持方針が示されているにもかかわらず、具体的なプロジェクトが含まれていません。実行計画の構築を確認してください。'
    );
  }

  if (discussion.collaborationIntent && Array.isArray(generatedDept.interDeptCollab) && generatedDept.interDeptCollab.length === 0) {
    reconsiderationPoints.push(
      '6テーマ議論で協力・連携が強く示されているにもかかわらず、具体的な協力相手が明確化されていません。部門間連携を具体化してください。'
    );
  }

  // ★リスク・制約（最低優先度）
  const infoPoints: string[] = [];
  if (Array.isArray(generatedDept.riskNotes) && generatedDept.riskNotes.length > 0) {
    infoPoints.push('実行上の主要リスクを確認してください');
  }

  if (Array.isArray(generatedDept.stopList) && generatedDept.stopList.length > 0) {
    infoPoints.push('非対象とした事項が実行計画に混入していないか確認してください');
  }

  // ★より強いメッセージがある場合は generic info を抑制
  if (reconsiderationPoints.length === 0) {
    reconsiderationPoints.push(...infoPoints);
  }

  /* ★診断ログ（修正：部門別ポートフォリオ signals に対応） */
  console.log('[diag][stage3:buildDeptReviewSummary]', {
    deptName,
    portfolioText,  // extractDeptPortfolioSignals() から取得
    isMaintainExpected,
    isProfitPriority,
    portfolioMismatchDetected: portfolioMismatchPoints.length > 0,
    portfolioMismatchCount: portfolioMismatchPoints.length,
    discussionSignals: discussion,
    hasExisting,
    hasNew,
    totalProjects,
    reconsiderationPointsCount: reconsiderationPoints.length,
    reconsiderationPoints,  // 最終的な内容も出力
  });

  return {
    correctedItems: [...new Set(correctedItems)],
    reconsiderationPoints: [...new Set(reconsiderationPoints)],
  };
}

/* =========================
 * 部門間分析（重複・矛盾・協力）
 * ======================= */

/**
 * 複数部門のプロジェクトテーマの重複を検出
 * （例：2部門が同じレバーで同じターゲットに取り組む可能性）
 */
function detectInterDeptProjectOverlaps(
  allDepts: Array<{
    name: string;
    projects?: Array<any>;
    reviewSummary?: any;
  }>
): Array<{
  severity: ReconsiderationSeverity;
  deptPair: [string, string];
  message: string;
}> {
  const overlaps: Array<{
    severity: ReconsiderationSeverity;
    deptPair: [string, string];
    message: string;
  }> = [];

  for (let i = 0; i < allDepts.length; i++) {
    for (let j = i + 1; j < allDepts.length; j++) {
      const dept1 = allDepts[i];
      const dept2 = allDepts[j];

      if (!dept1.name || !dept2.name) continue;

      const projs1 = Array.isArray(dept1.projects) ? dept1.projects : [];
      const projs2 = Array.isArray(dept2.projects) ? dept2.projects : [];

      // Project title の類似性を検査（レバーや主要テーマの重複）
      for (const p1 of projs1) {
        for (const p2 of projs2) {
          const title1 = String(p1?.title || '').toLowerCase();
          const title2 = String(p2?.title || '').toLowerCase();
          const lever1 = String(p1?.mainLever || '').toLowerCase();
          const lever2 = String(p2?.mainLever || '').toLowerCase();

          // 同じレバーで同じキーワード（顧客、プロダクト、チャネル等）を含む場合
          if (lever1 === lever2 && lever1 && title1 && title2) {
            const keywordMatch =
              /顧客|customer|プロダクト|product|チャネル|channel|ブランド|brand/.test(title1) &&
              /顧客|customer|プロダクト|product|チャネル|channel|ブランド|brand/.test(title2);

            if (keywordMatch) {
              overlaps.push({
                severity: 'review',
                deptPair: [dept1.name, dept2.name],
                message: `「${dept1.name}」と「${dept2.name}」が、同じレバー「${lever1}」で類似テーマに取り組む可能性があります。役割分担・リソース効率化を検討してください。`,
              });
              break;
            }
          }
        }
      }
    }
  }

  return overlaps;
}

/**
 * 部門間の戦略的矛盾を検出
 * （例：一方が成長投資、他方が撤退；一方が既存固守、他方が新規探索）
 */
function detectInterDeptStrategyContradictions(
  allDepts: Array<{
    name: string;
    reviewSummary?: {
      reconsiderationPoints?: string[];
    };
  }>
): Array<{
  severity: ReconsiderationSeverity;
  deptPair: [string, string];
  message: string;
}> {
  const contradictions: Array<{
    severity: ReconsiderationSeverity;
    deptPair: [string, string];
    message: string;
  }> = [];

  // 各部門の戦略意図を抽出
  const strategySignals = allDepts.map((d) => {
    const points = d.reviewSummary?.reconsiderationPoints || [];
    const pointsText = points.join(' ');

    return {
      deptName: d.name,
      hasRetreatIntent: /撤退|退出|廃止/.test(pointsText),
      hasShrinkIntent: /縮小|リソース削減|縮小方針/.test(pointsText),
      hasMaintainIntent: /維持|安定化|現状維持/.test(pointsText),
      hasGrowthIntent: /成長|拡大|新規投資|スケール/.test(pointsText),
      hasCollaborationIntent: /協力|連携|パートナーシップ/.test(pointsText),
      stopIntent: /停止|中止/.test(pointsText),
    };
  });

  // 矛盾パターンを検出
  for (let i = 0; i < strategySignals.length; i++) {
    for (let j = i + 1; j < strategySignals.length; j++) {
      const s1 = strategySignals[i];
      const s2 = strategySignals[j];

      // パターン1: 成長 vs 撤退
      if ((s1.hasGrowthIntent && s2.hasRetreatIntent) || (s1.hasRetreatIntent && s2.hasGrowthIntent)) {
        const growthDept = s1.hasGrowthIntent ? s1.deptName : s2.deptName;
        const retreatDept = s1.hasRetreatIntent ? s1.deptName : s2.deptName;

        contradictions.push({
          severity: 'warning',
          deptPair: [growthDept, retreatDept],
          message: `「${growthDept}」が成長投資を進める一方、「${retreatDept}」が撤退を検討しています。全社的なリソース配分と経営判断の整合性を確認してください。`,
        });
      }

      // パターン2: 成長 vs 縮小
      if ((s1.hasGrowthIntent && s2.hasShrinkIntent) || (s1.hasShrinkIntent && s2.hasGrowthIntent)) {
        const growthDept = s1.hasGrowthIntent ? s1.deptName : s2.deptName;
        const shrinkDept = s1.hasShrinkIntent ? s1.deptName : s2.deptName;

        // 既に成長vs撤退が報告されている場合はスキップ
        const alreadyReported = contradictions.some(
          (c) =>
            (c.deptPair.includes(growthDept) && c.deptPair.includes(shrinkDept)) ||
            (c.deptPair.includes(shrinkDept) && c.deptPair.includes(growthDept))
        );

        if (!alreadyReported) {
          contradictions.push({
            severity: 'review',
            deptPair: [growthDept, shrinkDept],
            message: `「${growthDept}」と「${shrinkDept}」で経営方針の温度感に差があります。事業戦略全体での位置付けを確認してください。`,
          });
        }
      }
    }
  }

  return contradictions;
}

/**
 * 部門間の協力可能性を検出
 * （例：テーマ・レバー・スキルセットの補完関係）
 */
function extractInterDeptCollaborationPotential(
  allDepts: Array<{
    name: string;
    projects?: Array<any>;
    reviewSummary?: {
      reconsiderationPoints?: string[];
    };
  }>
): Array<{
  severity: ReconsiderationSeverity;
  deptPair: [string, string];
  message: string;
}> {
  const collaborations: Array<{
    severity: ReconsiderationSeverity;
    deptPair: [string, string];
    message: string;
  }> = [];

  // 部門のスキル・レバー・テーマを抽出
  const deptCapabilities = allDepts.map((d) => {
    const projs = Array.isArray(d.projects) ? d.projects : [];
    const levers = new Set<string>();
    const themes = new Set<string>();
    const skills = new Set<string>();

    for (const p of projs) {
      const lever = String(p?.mainLever || '').toLowerCase();
      const kind = String(p?.kind || '').toLowerCase();
      const skillReqs = p?.skillRequirements;

      if (lever) levers.add(lever);
      if (kind) themes.add(kind);
      if (skillReqs && typeof skillReqs === 'object') {
        Object.keys(skillReqs).forEach((k) => skills.add(k.toLowerCase()));
      }
    }

    // reconsiderationPoints からの協力シグナル
    const points = d.reviewSummary?.reconsiderationPoints || [];
    const hasCollaborationIntent = points.some((p) => /協力|連携|パートナーシップ|共同/.test(String(p)));

    return {
      deptName: d.name,
      levers: Array.from(levers),
      themes: Array.from(themes),
      skills: Array.from(skills),
      hasCollaborationIntent,
    };
  });

  // 補完的なスキル・レバーの組み合わせを検出
  for (let i = 0; i < deptCapabilities.length; i++) {
    for (let j = i + 1; j < deptCapabilities.length; j++) {
      const cap1 = deptCapabilities[i];
      const cap2 = deptCapabilities[j];

      // 協力シグナルがある場合は可能性高
      if (cap1.hasCollaborationIntent || cap2.hasCollaborationIntent) {
        // 共通のレバーまたはテーマを持つ場合
        const sharedLevers = cap1.levers.filter((l) => cap2.levers.includes(l));
        const sharedThemes = cap1.themes.filter((t) => cap2.themes.includes(t));

        if (sharedLevers.length > 0 || sharedThemes.length > 0) {
          const commonArea = sharedLevers.length > 0 ? `レバー「${sharedLevers[0]}」` : `テーマ「${sharedThemes[0]}」`;

          collaborations.push({
            severity: 'info',
            deptPair: [cap1.deptName, cap2.deptName],
            message: `「${cap1.deptName}」と「${cap2.deptName}」は、${commonArea}で協力可能性があります。相乗効果やスケール効率を検討してください。`,
          });
        }
      }

      // 異なるスキルセットを補完する場合
      const cap1SkillsSet = new Set(cap1.skills);
      const cap2SkillsSet = new Set(cap2.skills);
      const nonOverlappingInCap2 = Array.from(cap2SkillsSet).filter((s) => !cap1SkillsSet.has(s));
      const nonOverlappingInCap1 = Array.from(cap1SkillsSet).filter((s) => !cap2SkillsSet.has(s));

      if (nonOverlappingInCap1.length > 0 && nonOverlappingInCap2.length > 0) {
        collaborations.push({
          severity: 'info',
          deptPair: [cap1.deptName, cap2.deptName],
          message: `「${cap1.deptName}」と「${cap2.deptName}」のスキルセットは相補的です。統合プロジェクトで相乗効果を生み出す可能性があります。`,
        });
      }
    }
  }

  return collaborations;
}

/**
 * 全部門の部門間分析を統合実行
 */
function buildInterDeptCrossAnalysis(
  allDepts: Array<any>
): Array<{
  severity: ReconsiderationSeverity;
  category: 'overlap' | 'contradiction' | 'collaboration';
  deptPair: [string, string];
  message: string;
}> {
  const results: Array<{
    severity: ReconsiderationSeverity;
    category: 'overlap' | 'contradiction' | 'collaboration';
    deptPair: [string, string];
    message: string;
  }> = [];

  // 各種分析を実行
  const overlaps = detectInterDeptProjectOverlaps(allDepts);
  const contradictions = detectInterDeptStrategyContradictions(allDepts);
  const collaborations = extractInterDeptCollaborationPotential(allDepts);

  // カテゴリタグを付与して統合
  overlaps.forEach((o) => results.push({ ...o, category: 'overlap' }));
  contradictions.forEach((c) => results.push({ ...c, category: 'contradiction' }));
  collaborations.forEach((col) => results.push({ ...col, category: 'collaboration' }));

  // Severity の重大度順（critical > warning > review > info）でソート
  const severityOrder = { critical: 0, warning: 1, review: 2, info: 3 };
  results.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return results;
}

/* =========================
 * ハンドラ
 * ======================= */
export async function POST(req: NextRequest) {
  try {
    // Bearer token authentication and membership validation
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const membership = await requireMembership(admin, userId);
    if (!membership) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // ★ Role チェック: admin / manager のみ許可
    try {
      await assertMinRole(membership, 'manager');
    } catch {
      return NextResponse.json({ error: 'insufficient_role' }, { status: 403 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsedReq = ReqSchema.safeParse(raw);

    if (!parsedReq.success) {
      // ★デバッグ可能に：どこが不正か返す
      return new NextResponse(
        JSON.stringify({
          error: '入力の形式が不正です。',
          issues: parsedReq.error.issues,
        }),
        {
          status: 400,
          headers: { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        },
      );
    }

    const {
      thought,
      vision,
      mission: mvvMission,
      industry,
      revenue,
      employees,
      value,
      strength,
      weakness,
      opportunity,
      threat,
      story,
      finalStory, // ★新規: STAGE2 final story
      strategySummary,
      departments,
      csvFinanceData,
      financeSummary,
      businessPortfolio,
      businessSegments: allBusinessSegments,
      winPatternPrimary,
      winPatternSecondary,
      valueDriverKPIs,
      targetRanges,
      // ★STEP7: STAGE2中計設計
      midtermStrategy,
      stage3_strategy_bridge,
      // ★STAGE2補助セクション編集
      stage2FinalDocumentEdits,
    } = parsedReq.data;

	    if (!Array.isArray(departments) || departments.length === 0) {
	      return new NextResponse(JSON.stringify({ error: '部門情報が未入力です。カスケード生成できません。' }), {
	        status: 400,
	        headers: { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
	      });
	    }

	    const requestedDeptNames = onlyDeptNames(departments);
	    const hasMultipleRequestedDepartments = requestedDeptNames.length > 1;

    // [STAGE3_INPUT_DATA] ログ：request に来た allBusinessSegments と csvFinanceData の初期確認
    {
      const segSample = Array.isArray(allBusinessSegments)
        ? allBusinessSegments.slice(0, 2).map((s: any) => ({
            name: s?.name,
            haspl: !!s?.pl,
            hasbs: !!s?.bs,
            plSample: Array.isArray(s?.pl) ? s.pl.slice(0, 1).map((p: any) => ({
              year: p?.year,
              revenue: p?.revenue,
              revenue_type: typeof p?.revenue,
            })) : null,
          }))
        : [];
      const csvSegPLKeys = csvFinanceData?.segmentPL ? Object.keys(csvFinanceData.segmentPL).slice(0, 5) : [];
      const csvSegPLSample = csvFinanceData?.segmentPL && csvSegPLKeys.length > 0
        ? csvSegPLKeys.map((key: string) => {
            const rows = csvFinanceData.segmentPL[key];
            const row = Array.isArray(rows) ? rows[rows.length - 1] : rows;
            return {
              segmentName: key,
              revenue: row?.revenue,
              revenue_type: typeof row?.revenue,
            };
          })
        : [];
      console.log('[STAGE3_INPUT_DATA]', {
        allBusinessSegments_len: Array.isArray(allBusinessSegments) ? allBusinessSegments.length : 0,
        businessSegments_sample: segSample,
        csvFinanceData_hasSegmentPL: !!csvFinanceData?.segmentPL,
        csvSegmentPL_keys: csvSegPLKeys,
        csvSegmentPL_sample: csvSegPLSample,
      });
    }

    // ★TASK 2: request に finalStory が到達しているか確認（parse直後）
    console.log('[cascade][req] hasFinalStory=', !!finalStory, 'type=', typeof finalStory, 'jsonLen=', JSON.stringify(finalStory || '').length);

    const effectiveFinalStory =
      finalStory ??
      stage2FinalDocumentEdits?.finalStory ??
      stage2FinalDocumentEdits?.story ??
      stage2FinalDocumentEdits?.finalStoryFinal ??
      story;

    const storyText = toTextStory(story);
    // ★新規: STAGE2 final story を text 化（DB編集値を含めて最終版を優先）
    const finalStoryText = toTextStory(effectiveFinalStory);

    // ★デバッグログ: final story が注入されたことを確認
    const finalStoryLen = typeof finalStoryText === 'string' ? finalStoryText.length : 0;
    console.log(`[cascade][story] storyText.len=${typeof storyText === 'string' ? storyText.length : 0} finalStoryText.len=${finalStoryLen}`);
    const stage3BridgeText = formatStage3StrategyBridgeForPrompt(stage3_strategy_bridge);

    const hasValidInput =
      (typeof strategySummary === 'string' && strategySummary.trim().length > 0) ||
      (typeof storyText === 'string' && storyText.trim().length > 0) ||
      (typeof finalStoryText === 'string' && finalStoryText.trim().length > 0);
    if (!hasValidInput) {
      return new NextResponse(JSON.stringify({ error: '経営戦略ストーリーと要約の両方が空です。どちらかを入力してください。' }), {
        status: 400,
        headers: { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    /* =========================
     * プロンプト組み立て（2レーン生成：既存進化 / 新規探索）
     * ======================= */
    const summary = strategySummary?.trim() || finalStoryText.slice(0, 220) || storyText.slice(0, 160) || '（要約なし）';

    // ★csvFinanceData はオブジェクトで来ても落とさない（抜粋行を抽出）
    const previewRows = extractCsvPreviewRows(csvFinanceData);
    const financeCsvText = previewRows.length > 0 ? toLinesFromCsv(previewRows, 5) : '（CSVベースの財務データなし）';

    const financeSummaryText = summarizeFinanceSummary(financeSummary);
    const portfolioText = summarizeBusinessPortfolio(businessPortfolio);

    // [STAGE3_FIN_INPUT] ログ：全社レベルの財務概要
    console.log('[STAGE3_FIN_INPUT_GLOBAL]', {
      revenue: revenue,
      revenue_type: typeof revenue,
      employees: employees,
      financeSummaryText_len: financeSummaryText.length,
      financeSummaryText_sample: financeSummaryText.slice(0, 200),
      portfolioText_sample: portfolioText.slice(0, 200),
    });

    const industryLabel = industry ? getIndustryLabel(industry, { full: true }) : '';
    const industryLine = industryLabel ? `${industryLabel}${industry ? `（${industry}）` : ''}` : industry ?? '（不明）';
    const industryContext = (industry && (industryTemplates as any)?.[industry]) || '';

    // ★ csvFinanceData から segmentPL / segmentBS を抽出（P3拡張：segmentName マッピング用）
    const segmentPL = (csvFinanceData as any)?.segmentPL ?? {};
    const segmentBS = (csvFinanceData as any)?.segmentBS ?? {};

    // ★ allBusinessSegments 実データ確認ログ（診断用）
    if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
      const names = Array.isArray(allBusinessSegments)
        ? allBusinessSegments.map((s: any) => s?.name).filter(Boolean).slice(0, 10)
        : [];
      console.log('[cascade][segdebug] allBusinessSegments.len=', Array.isArray(allBusinessSegments) ? allBusinessSegments.length : -1);
      console.log('[cascade][segdebug] allBusinessSegments.names(sample)=', names);
    }

    // ★ セグメント名の正規化（ホワイトスペース除去、小文字化、サフィックス除去）
    const normalizeName = (s: string) =>
      (s ?? '')
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[・･]/g, '・')
        .replace(/(事業部|本部|部門|部)$/g, '')
        .trim();

    // ★ FactPack 生成（TASK 1: 部門ごとの引用可能な事実セット）
    const factPackByDept = new Map<string, DeptFactPack>();
    for (const d of departments) {
      const name = pickName(d);
      if (!name) continue;
      const factPack = buildDeptFactPack(name, allBusinessSegments, csvFinanceData, financeSummary, businessPortfolio);
      factPackByDept.set(name, factPack);

      // [STAGE3_FACTPACK_ANCHORS] ログ：生成された anchors の全体確認
      {
        const abnormalAnchors = factPack.anchors.filter(a => {
          const hasAbnormal = /\d{10,}百万円|\d{10,}M円/.test(a.text);
          return hasAbnormal;
        });
        console.log('[STAGE3_FACTPACK_ANCHORS]', {
          dept: name,
          totalAnchors: factPack.anchors.length,
          abnormalCount: abnormalAnchors.length,
          allAnchors: factPack.anchors.map((a, idx) => ({
            index: idx,
            id: a.id,
            source: a.source,
            text: a.text,
            hasAbnormalValue: /\d{10,}百万円|\d{10,}M円/.test(a.text),
          })),
        });
      }

      if (DEBUG) {
        console.log(`[cascade][factpack] ${name}: ${factPack.anchors.length}anchors, ${factPack.customers.length}customers`);
      }
    }

    const deptBlocks = departments
      .map((d) => {
        const name = pickName(d);
        const segmentName = typeof (d as any)?.segmentName === 'string' ? (d as any).segmentName : name;
        const answers = (d?.answers || []) as Array<{ stepNumber: number; label?: string; answer?: string }>;
        const dir = d?.direction || '';
        const exps = trimList(d?.expectations, 4);
        const focuses = trimList(d?.focusThemes, 4);

        const ansLines = (answers || [])
          .sort((a, b) => (a?.stepNumber || 0) - (b?.stepNumber || 0))
          .slice(0, 6)
          .map((a) => `  - Q${a.stepNumber}${a.label ? `（${a.label}）` : ''}: ${sanitizeText(a?.answer || '', 220)}`)
          .join('\n');

        // ★ allBusinessSegments から該当セグメントを検索（正規化マッチング）
        const segKey = (segmentName ?? name ?? '').trim();
        const keyN = normalizeName(segKey);

        // ★ 段階的マッチング：完全一致 → 部分一致（複数は除外） → not_found
        let seg: any = undefined;
        if (Array.isArray(allBusinessSegments)) {
          // 1) 完全一致
          seg = allBusinessSegments.find((s: any) => normalizeName(s?.name ?? '') === keyN);

          // 2) 部分一致（複数ヒットは誤マッチ防止で除外）
          if (!seg && keyN.length >= 4) {
            const hits = allBusinessSegments.filter((s: any) => normalizeName(s?.name ?? '').includes(keyN));
            seg = hits.length === 1 ? hits[0] : undefined;
          }
        }

        // ★ セグメント情報を抽出（P3拡張：prompt注入用）
        const segOverview = seg?.overview ?? '';
        const segCustomers = seg?.mainCustomers ?? seg?.customers ?? '';
        const segPLData = seg?.pl ?? seg?.segmentPL ?? null;
        const segBSData = seg?.bs ?? seg?.segmentBS ?? null;

        // ★ 部門別財務サマリー（seg優先、csvFinanceData は補助）
        const deptFinanceSummaryText = (() => {
          const parts: string[] = [];

          // [STAGE3_FIN_INPUT] ログ：部門入力時点での金額値
          if (segPLData && typeof segPLData === 'object') {
            const plData = Array.isArray(segPLData) ? segPLData : [segPLData];
            for (const row of plData.slice(-2)) {
              if (row?.revenue !== undefined) {
                console.log('[STAGE3_FIN_INPUT]', {
                  dept: name,
                  year: row?.year,
                  revenue_raw: row?.revenue,
                  revenue_type: typeof row?.revenue,
                  operatingIncome_raw: row?.operatingIncome,
                  operatingIncome_type: typeof row?.operatingIncome,
                  note: 'segPLData から抽出'
                });
              }
            }
          }

          // ★ 異常値ガード関数
          const formatMoneyWithGuard = (value: number, label: string): string => {
            const converted = Math.round(value / 100) / 10;
            // STAGE3専用防御：1000万以上は異常値として非表示化（単位混在対応）
            if (converted > 10000000) {
              return '';
            }
            return `${label}${converted}M円`;
          };

          // 1) seg から抽出（優先）
          if (segPLData && typeof segPLData === 'object') {
            const plData = Array.isArray(segPLData) ? segPLData : [segPLData];
            for (const row of plData.slice(-2)) {
              if (!row) continue;
              const year = row?.year ? `(${row.year})` : '';
              const revenue = typeof row?.revenue === 'number' ? formatMoneyWithGuard(row.revenue, '売上') : '';
              const operatingIncome = typeof row?.operatingIncome === 'number' ? formatMoneyWithGuard(row.operatingIncome, '営業利益') : '';
              const items = [year, revenue, operatingIncome].filter(Boolean).join(' ');
              if (items) parts.push(items);
            }
          }

          // 2) csvFinanceData.segmentPL から抽出（補助）
          if (!seg && segmentPL && segmentPL[segKey]) {
            const segRows = Array.isArray(segmentPL[segKey]) ? segmentPL[segKey].slice(-2) : [];
            for (const row of segRows) {
              const year = row?.year ? `(${row.year})` : '';
              const revenue = typeof row?.revenue === 'number' ? formatMoneyWithGuard(row.revenue, '売上') : '';
              const operatingIncome = typeof row?.operatingIncome === 'number' ? formatMoneyWithGuard(row.operatingIncome, '営業利益') : '';
              const items = [year, revenue, operatingIncome].filter(Boolean).join(' ');
              if (items) parts.push(items);
            }
          }

          // 3) financeSummary から部門マッチで抽出（最終補助）
          if (financeSummary && parts.length === 0) {
            const summaryList = Array.isArray(financeSummary) ? financeSummary : [];
            const deptMatches = summaryList.filter((row: any) => {
              const businessUnit = String(row?.business_unit || row?.unitName || '').toLowerCase();
              return businessUnit.includes(name.toLowerCase()) || name.toLowerCase().includes(businessUnit);
            });
            for (const row of deptMatches.slice(0, 1)) {
              const revenue = typeof row.revenue === 'number' ? (() => {
                const converted = Math.round(row.revenue / 100) / 10;
                // STAGE3専用防御：1000万以上は異常値として非表示化
                if (converted > 10000000) return '';
                return `${converted}M円`;
              })() : row.revenue || '';
              const margin = row.profitMargin ? `利益率${row.profitMargin}` : '';
              const item = [revenue, margin].filter(Boolean).join(', ');
              if (item) parts.push(item);
            }
          }

          // 4) ★STEP5: STAGE1手入力（BusinessSegment.revenue/profit）を最終フォールバックとして使用
          // 【売上・利益の優先順位ルール】
          //   1. segmentPL など既存の財務データ（上記 1〜3）があればそれを優先する
          //   2. 財務データが一切ない場合のみ、STAGE1 で手入力された
          //      BusinessSegment.revenue / profit（単位：百万円）を補助情報として使う
          //   3. どちらもなければ「部門別財務不明」として生成する
          if (parts.length === 0 && seg) {
            const manualParts: string[] = [];
            if (typeof seg.revenue === 'number' && Number.isFinite(seg.revenue)) {
              manualParts.push(`売上${seg.revenue}百万円`);
            }
            if (typeof seg.profit === 'number' && Number.isFinite(seg.profit)) {
              manualParts.push(`利益${seg.profit}百万円`);
            }
            if (manualParts.length > 0) {
              parts.push(`${manualParts.join(' ')}（STAGE1手入力・参考値）`);
            }
          }

          return parts.length > 0 ? parts.join(' / ') : '（部門別財務不明）';
        })();

        // ★STEP5: STAGE1中計入力（事業・部門情報）をプロンプトへ注入
        // - STEP4 で BusinessSegment に追加された optional 項目（既存データには存在しない場合がある）
        // - 値が存在しない項目は1行も出力しない（既存データでも生成が成功する）
        const midtermInfoBlock = (() => {
          if (!seg) return '';
          const UNIT_TYPE_LABELS: Record<string, string> = {
            business_unit: '事業部',
            function: '機能部門',
            site: '拠点',
            project: '重点プロジェクト',
            subsidiary: '子会社',
            segment: '事業セグメント',
            other: 'その他',
          };
          const lines: string[] = [];
          if (typeof seg.unitType === 'string' && seg.unitType) {
            lines.push(`    - 種別: ${UNIT_TYPE_LABELS[seg.unitType] ?? seg.unitType}`);
          }
          if (Array.isArray(seg.mainProductsServices) && seg.mainProductsServices.length > 0) {
            lines.push(`    - 主要製品・サービス: ${seg.mainProductsServices.slice(0, 6).map((v: any) => sanitizeText(String(v), 60)).join('、')}`);
          }
          if (Array.isArray(seg.currentIssues) && seg.currentIssues.length > 0) {
            lines.push(`    - 主な課題: ${seg.currentIssues.slice(0, 6).map((v: any) => sanitizeText(String(v), 80)).join('、')}`);
          }
          if (typeof seg.expectedRoleInMidtermPlan === 'string' && seg.expectedRoleInMidtermPlan.trim()) {
            lines.push(`    - 中計で期待される役割: ${sanitizeText(seg.expectedRoleInMidtermPlan, 200)}`);
          }
          if (Array.isArray(seg.existingKpis) && seg.existingKpis.length > 0) {
            lines.push(`    - 既存KPI: ${seg.existingKpis.slice(0, 8).map((v: any) => sanitizeText(String(v), 60)).join('、')}`);
          }
          if (lines.length === 0) return '';
          return `\n  ★事業・部門情報（STAGE1中計入力）: ※入力された前提情報。currentPosition/strategicRole/keyIssues/okrs に必ず反映すること\n${lines.join('\n')}`;
        })();

        // ★ 部門別ポートフォリオ位置（businessPortfolio から該当ユニットを抽出）
        const deptPortfolioText = (() => {
          if (!businessPortfolio?.units) return '（ポートフォリオ未設定）';
          const matchedUnits = (businessPortfolio.units as any[]).filter((u: any) => {
            const unitName = String(u?.name || '').toLowerCase();
            const deptNameLower = name.toLowerCase();
            return unitName.includes(deptNameLower) || deptNameLower.includes(unitName);
          });
          if (matchedUnits.length > 0) {
            return matchedUnits.map((u: any) => `${u.name}: ${u.position || 'N/A'}`).join(' / ');
          }
          return '（ポートフォリオ内の位置不明）';
        })();

        // ★projects seed を string[]/object[] 混在から正規化
        const projSeedList = normalizeProjectSeeds(d?.projects);
        const projSeed = projSeedList.map((p) => `  - ${sanitizeText(p, 100)}`).join('\n');

        const okrSeed = (Array.isArray(d?.okrs) ? d!.okrs! : [])
          .slice(0, 2)
          .map((o: any, i: number) => {
            const kr = trimList(o?.keyResults, 3)
              .map((k) => `"${sanitizeText(k, 80)}"`)
              .join(', ');
            return `  - OKR${i + 1}: O="${sanitizeText(o?.objective || '', 100)}" KR=[${kr}]`;
          })
          .join('\n');

        // ★ TASK 2: FACTPACK ブロック生成（anchors付き、引用ベース）
        const factPack = factPackByDept.get(name);
        const factPackBlock = (() => {
          const anchors = factPack?.anchors ?? [];
          const requiredCitationCount = Math.min(2, anchors.length);
          const anchorLines = anchors
            .map((a) => `  - ${a.id}: "${sanitizeText(a.text, 100)}"`)
            .join('\n');

          const customerLines = (factPack?.customers?.length ?? 0) > 0
            ? `\n- customers: ${(factPack?.customers ?? []).map((c) => `"${c}"`).join(', ')}`
            : '';

          const citationRule = requiredCitationCount === 0
            ? '- citation rule: 利用可能なanchorがないため citations=[] とし、fact-idを創作しない。STAGE2最終ストーリーと6問回答を根拠に記述すること。'
            : `- citation rule: citations は上記anchorから必ず${requiredCitationCount}個。reason/hypothesisにも同じ${requiredCitationCount}個を引用すること。`;

          return `\n\n[FACTPACK]\n- segment: ${factPack?.segmentName ?? segKey}${customerLines}\n- requiredCitationCount: ${requiredCitationCount}\n${citationRule}\n- anchors:\n${anchorLines || '  - （利用可能な事実なし）'}`;
        })();

        // ★ デバッグログ
        if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
          console.log('[cascade][segmap]', name, 'segmentName=', segmentName, 'found=', !!seg, 'key=', segKey);
          if (factPack) {
            console.log('[cascade][factpack]', name, `anchors=${factPack.anchors.length}`);
          }
        }

        // ★ 部門別ユニークネスルール（全部門同一PJ防止の物理的制約）
        const deptName = name;
        const uniquenessRule = `

[UNIQUENESS_CONSTRAINT]
- 生成するプロジェクト案は「他部門と同一/酷似」禁止
- existing lane の各プロジェクト title は必ず "${deptName}：" で始め、入力本文に存在する具体的な市場・用途・製品・技術・顧客価値を含める
- new lane の各プロジェクト title も必ず "${deptName}：" で始め、入力本文に存在する具体的な市場・用途・製品・技術・顧客価値を含める
- hypothesis と reason には、必ず [SEGMENT] の要素（overview/customers/PL/BS のどれか）を最低1つ"引用"して根拠にする
- 禁止：汎用テンプレ（DX推進/業務効率化/新規開拓 だけの抽象表現）で終わらせること`;

        // ★ STAGE3: A) 部門ごとの6問ブロック生成 + ログ
        const deptAnswers6 = pickDeptAnswers6(d);
        const dept6AnswersBlock = formatDept6Answers(deptAnswers6);
        const dept6Answered = hasAnsweredSteps6(deptAnswers6);

        // ★ STAGE3: C) 証明ログ（6問注入チェック）
        console.log('[cascade][dept6]', {
          dept: name,
          answersLen: Array.isArray(deptAnswers6) ? deptAnswers6.length : null,
          answered6: dept6Answered,
          preview: dept6AnswersBlock.slice(0, 120),
        });

        // ★ STAGE3: TASK 3 - 6問完成時の生成ルール強制（部門ごと）
        const dept6ConstraintsBlock = dept6Answered
          ? `

【★ STAGE3: 6問完成部門への追加制約】
- Step1（役まわり）を mission に必ず反映すること（役割を示す語句を含める）
- Step2（既存貢献）から最低1本を「既存進化」プロジェクトに含めること
- Step3（未来への挑戦）から最低1本を「新規探索」プロジェクトに含めること
- Step4（犠牲）に該当する内容を、部門の riskNotes と keyIssues に明記すること
- Step5（協力）を、needsCollab / intraDeptCollab / interDeptCollab のいずれかに明記すること
- Step6（撤退・停止）を、stopList に「非対象・見直し項目」として明記すること
`
          : '';

        return `
[部門] ${name}
  direction: ${sanitizeText(dir || '', 140) || '（未設定）'}
  expectations:
${exps.map((e) => `    - ${sanitizeText(e, 120)}`).join('\n') || '    - （未設定）'}
  focusThemes:
${focuses.map((f) => `    - ${sanitizeText(f, 120)}`).join('\n') || '    - （未設定）'}
  ★部門別財務: ${deptFinanceSummaryText}
  ★部門別ポートフォリオ: ${deptPortfolioText}${midtermInfoBlock}
  answers (1..6): ※この6回答は必ず提案に反映し、矛盾は禁止
${ansLines || '  - （未回答）'}
  ★ STAGE3: 6問の回答（部門戦略ガイド）: ${dept6Answered ? '（6/6完成）' : '（不足あり）'}
${dept6AnswersBlock.split('\n').map((line) => `    ${line}`).join('\n')}${dept6ConstraintsBlock}
  seeds.projects:
${projSeed || '  - （なし）'}
  seeds.okr:
${okrSeed || '  - （なし）'}${factPackBlock}${uniquenessRule}
`.trim();
      })
      .join('\n\n');

    const prompt = `
あなたは世界最高の経営戦略コンサルタントです。以下の情報をもとに、部門ごとの提案を「既存進化（Existing）」「新規探索（New）」「事業部内連携（IntraCollab）」${hasMultipleRequestedDepartments ? '「事業部間連携（InterCollab）」' : ''}のレーンで返してください。

【★最重要：プロジェクト数と命名規則（STAGE3正式版）】
- 各部門の提案は、複数のプロジェクト + OKR（必須）で構成される。
- プロジェクト数：各部門で${hasMultipleRequestedDepartments ? '合計5個（既存進化 2個 + 新規探索 1個 + 事業部内連携 1個 + 事業部間連携 1個）' : '合計4個（既存進化 2個 + 新規探索 1個 + 事業部内連携 1個。事業部間連携は0個）'}を厳密に守ること。
- ★★★全部門で異なるプロジェクト案を出すこと（部門AのプロジェクトAが部門Bにも出現することは厳禁）。
- ★★★各部門の【部門別財務】【部門別ポートフォリオ】【主な顧客層】【意思決定権】を参照し、その部門固有の課題と機会に基づいてプロジェクトを立案すること。
- ★★★missionDraft / missionDescription / currentPosition / strategicRole / projects / okrs / alignmentRiskPoints には、【STAGE2最終ストーリー】に実際に登場する市場名、顧客用途、製品・サービス、技術、競争環境、投資方針、判断基準、成功条件などの具体語を必ず反映すること。
- 既存業務をそのまま言い換えただけの部門ミッションは禁止。必ず「上位戦略のどの変化を、この部門がどう実装するか」を書くこと。
- ★TASK 2 引用ベース生成（FACTPACK から必ず根拠を引く）：
  - 各プロジェクトの title は必ず [FACTPACK] の customers または overview、または【STAGE2最終ストーリー】に実際に登場する固有名詞を1つ以上含むこと。
  - reason と hypothesis の引用数は、各部門[FACTPACK]の requiredCitationCount に従うこと。引用文は実際の anchor text だけを使い、例示の市場名・顧客名を創作しないこと。
  - citations フィールドには、当該部門のFACTPACKに実在するanchor IDだけを列挙すること。requiredCitationCount=0の場合は citations=[] とし、fact-idを創作しないこと。
- ★対象部門の事業領域から外れる提案は禁止。既存事業と離れすぎた提案や、部門の守備範囲外の分野への展開は避けること。

【部門ミッション記述ルール】
- missionDraft: 1〜2文で、部門の戦略的ミッション（構造変化/役割の再定義を含める）
- missionDescription: 2〜4文で、missionDraft の背景・理由・狙いを説明。部門の事業概要、主要顧客層、部門別財務の入力がある場合はその根拠に言及すること。
- 部門別売上、利益率、成長率、構成比、全社成長への寄与率などの数値は、入力データに明示されている場合のみ使用すること。
- 入力に数値根拠がない場合は、「売上は好調」「利益率改善が課題」「全社成長の30%を担う」などの断定表現を使わず、「部門別の売上・利益率データは追加確認が必要」と表現すること。

【★事業・部門別戦略の観点（中計対応）】
★★★以下の4つのフィールドは【必須】です。毎回必ず生成してください★★★

各部門について、以下の観点を反映すること。観点と出力フィールドの対応：
- 現在の位置づけ → currentPosition（1〜2文。★部門別財務/★部門別ポートフォリオ/★事業・部門情報を根拠にする。【必須】）
  書き方：数値根拠がある場合は部門別財務を踏まえて書く。数値根拠がない場合は、戦略上の位置づけと「部門別の売上・利益率データは追加確認が必要」を明記する。
  出力例：「この部門は、既存の技術・顧客基盤を活かし、全社戦略で定めた重点領域への展開を担う候補事業である。部門別の売上・利益率データは追加確認が必要である。」

- 中計上の役割 → strategicRole（1〜2文。「中計で期待される役割」が入力されている場合は必ずそれと整合させる。【必須】）
  書き方：寄与率や構成比を入力なしに作らない。全社戦略に対して、この部門が担う役割・変えること・具体化するテーマを書く。
  出力例：「この部門は、既存事業を全社戦略で定めた高付加価値提案へ転換し、重点市場向けの開発案件・顧客提案・量産移行を具体化する役割を担う。」

- 主要課題 → keyIssues（2〜4個。「主な課題」が入力されている場合は取り込んだうえで、財務・ポートフォリオの観点から補強する。【必須】）
  書き方：入力にある戦略テーマ、部門情報、顧客用途、既存プロジェクトとの接続で書く。財務・人員・投資の不足を断定する場合は入力根拠が必要。

- 認識のズレが起きやすいポイント → alignmentRiskPoints（1〜3個。経営層の期待と現場の実態がズレやすい点を具体的に書く。【必須】）
  書き方：入力にある全社戦略・部門文脈・実行テーマから、認識がずれやすい論点を書く。例文や一般論を流用しない。

【★根拠なし数値・例文混入の禁止】
- 「全社成長の30%」「売上は好調」「利益率改善が課題」「本部は短期売上拡大を期待するが、持続可能な成長には中長期の人材育成が不可欠」など、例文由来の表現を出力しない。
- 部門別売上、利益率、成長率、構成比、全社成長への寄与率、シェア、改善率などの数値は、入力に明示されている場合のみ使う。
- 入力にない数値や財務状態は推測しない。根拠が不足する場合は「追加確認が必要」と書く。

- 戦略方向性 → missionDraft / missionDescription（既存ルールどおり）
- 重点施策 → lanes の projects（既存ルールどおり）
- KPI案 → 各プロジェクトの okrs（「既存KPI」が入力されている場合は、既存KPIとの関係（継続/置き換え/補完）が分かる指標設計にする）
- 必要な連携 → intraDeptCollab / interDeptCollab（既存ルールどおり）
- 実行リスク → riskNotes（既存ルールどおり）

【レーン定義】
- 既存深掘/既存進化（Existing）：短期〜中期（今年〜3年）でPLに効く改善/強化。既存顧客・既存製品・既存サービスを、STAGE2最終ストーリーで示された価値軸に沿って高付加価値化する。2個のプロジェクト。
- 新規探索（New）：将来成長の仮説検証。STAGE2最終ストーリーに登場する成長市場、顧客用途、技術テーマ、事業機会に沿って探索する。1個のプロジェクト。
- 事業部内連携（IntraCollab）：同一事業部内の営業・開発・製造・品質・管理などをつなぎ、顧客価値・実行速度・収益性を高める。1個のプロジェクト。
- 事業部間連携（InterCollab）：${hasMultipleRequestedDepartments ? '複数事業部の顧客・技術・販路・機能を組み合わせ、単独部門では実現しにくい成長機会を具体化する。1個のプロジェクト。' : '入力部門が1つだけの場合は生成禁止。lanes.interCollab.projects は空配列、interDeptCollab も空配列にする。架空の第二事業部・関連事業部を作らない。'}
- 6つの回答（answers 1..6）に反する提案は禁止（特に Q4:犠牲/やめる、Q6:撤退/停止）。

【業界背景・成功パターン】
${industryContext || '（該当テンプレートなし）'}

【経営者の想い】
${thought || '（未入力）'}

【MVV】
Mission: ${mvvMission ?? ''} / Vision: ${vision ?? ''} / Value: ${value ?? ''}

【SWOT】
強み: ${strength ?? ''} / 弱み: ${weakness ?? ''} / 機会: ${opportunity ?? ''} / 脅威: ${threat ?? ''}

【業種・規模】
${industryLine}、年商${String(revenue ?? '（不明）')}百万円、従業員${String(employees ?? '（不明）')}人

【財務サマリー（financeSummary）】
${financeSummaryText}

【事業ポートフォリオ（businessPortfolio）】
${portfolioText}

【CSV抜粋（参考）】
${financeCsvText}

【経営戦略ストーリー（要約/抜粋）】
${sanitizeText(storyText || '', 800) || '（ストーリー未入力）'}
要約: ${summary}

【STAGE2 最終ストーリー（Final Story）】
${sanitizeText(finalStoryText || '', 2600) || '（最終ストーリー未入力）'}

【★STAGE2→STAGE3 戦略の芯・展開ブリッジ（最優先）】
${stage3BridgeText}

【★戦略の芯の扱い】
- 上記に「戦略の芯」がある場合、missionDraft / missionDescription / strategicRole / projects / okrs では、その内容を最優先の上位判断軸として扱うこと。
- primaryShift は、各部門が「既存の何を、どの方向へ変えるのか」を書くための軸である。部門ミッションに必ず反映すること。
- concreteDomains / nonNegotiableThemes は、STAGE2で抽出されたこの会社固有の重点領域である。各プロジェクトは、入力された部門の守備範囲と矛盾しない限り、いずれかに接続すること。
- customerValue は、技術テーマや施策を顧客価値に変換する基準である。reason / hypothesis / KPI に反映すること。
- portfolioShift は、既存事業の維持・選別・資源移管を判断する基準である。既存進化・新規探索・見直しの配分に反映すること。
- behaviorChange は、現場に求める行動変化である。KPIは行動変化が測れる先行指標を含めること。
- 「成長領域」「新市場」「高付加価値」「新技術」などの一般語だけに丸めない。入力に含まれる具体語を保持すること。
- ただし、入力にない市場名・技術名・製品名・顧客名は絶対に追加しないこと。

【★全社戦略・中計設計（STAGE2）】
${(() => {
  if (!midtermStrategy || typeof midtermStrategy !== 'object') return '（中計設計未生成）';
  const lines: string[] = [];
  if (typeof (midtermStrategy as any).midtermConcept === 'string' && (midtermStrategy as any).midtermConcept?.trim()) {
    lines.push(`・中計の基本コンセプト: ${sanitizeText((midtermStrategy as any).midtermConcept, 200)}`);
  }
  if (typeof (midtermStrategy as any).targetVisionForMidterm === 'string' && (midtermStrategy as any).targetVisionForMidterm?.trim()) {
    lines.push(`・目指す姿: ${sanitizeText((midtermStrategy as any).targetVisionForMidterm, 200)}`);
  }
  if (Array.isArray((midtermStrategy as any).priorityStrategicThemes) && (midtermStrategy as any).priorityStrategicThemes.length > 0) {
    lines.push(`・重点戦略テーマ: ${((midtermStrategy as any).priorityStrategicThemes as string[]).map((t) => sanitizeText(t, 100)).join('、')}`);
  }
  if (typeof (midtermStrategy as any).growthStrategy === 'string' && (midtermStrategy as any).growthStrategy?.trim()) {
    lines.push(`・成長戦略: ${sanitizeText((midtermStrategy as any).growthStrategy, 200)}`);
  }
  if (typeof (midtermStrategy as any).profitImprovementStrategy === 'string' && (midtermStrategy as any).profitImprovementStrategy?.trim()) {
    lines.push(`・収益改善戦略: ${sanitizeText((midtermStrategy as any).profitImprovementStrategy, 200)}`);
  }
  if (typeof (midtermStrategy as any).portfolioPolicy === 'string' && (midtermStrategy as any).portfolioPolicy?.trim()) {
    lines.push(`・事業ポートフォリオ方針: ${sanitizeText((midtermStrategy as any).portfolioPolicy, 200)}`);
  }
  if (Array.isArray((midtermStrategy as any).companyWideDecisionCriteria) && (midtermStrategy as any).companyWideDecisionCriteria.length > 0) {
    lines.push(`・全社共通の判断基準: ${((midtermStrategy as any).companyWideDecisionCriteria as string[]).map((c) => sanitizeText(c, 100)).join('、')}`);
  }
  if (Array.isArray((midtermStrategy as any).deploymentPrinciplesForUnits) && (midtermStrategy as any).deploymentPrinciplesForUnits.length > 0) {
    lines.push(`・事業・部門へ展開する基本軸: ${((midtermStrategy as any).deploymentPrinciplesForUnits as string[]).map((p) => sanitizeText(p, 100)).join('、')}`);
  }
  if (Array.isArray((midtermStrategy as any).managementMeetingIssues) && (midtermStrategy as any).managementMeetingIssues.length > 0) {
    lines.push(`・経営会議で確認すべき論点: ${((midtermStrategy as any).managementMeetingIssues as string[]).map((i) => sanitizeText(i, 100)).join('、')}`);
  }
  if (lines.length === 0) return '（中計設計未生成）';
  return lines.join('\n');
})()}

上記の全社戦略・中計設計は、各事業・部門の戦略を生成する際の上位判断軸です。

各事業・部門について、STAGE1の事業・部門情報と、上記の全社戦略・中計設計を照らし合わせて、中計上の役割、重点テーマ、KPI案、連携論点、認識のズレが起きやすいポイントを整理してください。

重要：根拠が不足する場合でも省略せず、「確認が必要な仮説」として記載してください。currentPosition / strategicRole / keyIssues / alignmentRiskPoints / 5類型プロジェクト / OKR・KPI は必ず返してください。

【部門文脈（Ver4準拠）】
${deptBlocks}

【STAGE2 価値指標（ValueDriverKPIs）】
${
  valueDriverKPIs && valueDriverKPIs.length > 0
    ? valueDriverKPIs.map((kpi: any) => `- ${kpi.id}: ${kpi.label}${kpi.description ? ` (${kpi.description})` : ''}`).join('\n')
    : '（未設定）'
}

【STAGE2 勝ち筋パターン】
主要: ${winPatternPrimary ?? '（未設定）'} / 副次: ${winPatternSecondary ?? '（未設定）'}

【プロジェクト設計ルール（仮説ベース＋2軸＋Final Story整合）】
- projects は「仮説ベースのプロジェクト」として設計する。
- ★【STAGE2最終ストーリー】の経営戦略方針を反映したプロジェクト案に編成すること。
- 各プロジェクトの reason/hypothesis には【STAGE2最終ストーリー】のキーコンセプト/価値軸との連携を明示すること。
- 【STAGE2最終ストーリー】、[部門文脈]、[FACTPACK] に存在しない市場名・顧客名・用途名・製品名は使わないこと。例示文に含まれる業界名を実データとして採用することは禁止。
- 入力本文に存在しない業界・顧客・用途を推測で入れることは禁止。入力に存在する場合のみ使用してよい。
- ★プロジェクト title は必ず【STAGE2最終ストーリー】または[部門文脈]/[FACTPACK]に実在する「市場・用途・製品・技術・顧客価値」の具体語を1つ以上含めること。
- ★以下のような汎用タイトルは禁止：顧客満足度向上プログラム、新規顧客開拓戦略、デジタルマーケティング強化プロジェクト、DX推進、業務効率化、サービス拡充、売上向上、収益性改善、商談設計力の強化、次世代サービス仮説検証。
- ★ただし、上記語が【STAGE2最終ストーリー】または[部門文脈]/[FACTPACK]に明示されている場合に限り、その文脈に限定して使用してよい。
- 各プロジェクトは以下の2軸を必ず持つ：
  - mainLever（何に効かせるか）:
    - 'ACQ'          : 新規顧客数・案件数
    - 'ARPU'         : 単価・LTV・客単価
    - 'CHURN'        : 解約率・離脱率
    - 'COST'         : 固定費・変動費・人件費などコスト全般
    - 'EFFICIENCY'   : 業務効率・時間削減（最終的にコスト/スループットに効く）
    - 'FUTURE'       : 将来の成長余地（新規事業・仕組み・人材など）
  - horizon（いつ効くか）:
    - 'short' : 〜1年
    - 'mid'   : 1〜3年
    - 'long'  : 3年以上
  - kind（種別ラベル）:
    - 'growth'     : 売上・単価アップ中心
    - 'cost'       : コスト削減中心
    - 'efficiency' : 業務効率化中心
    - 'future'     : 将来の種・仕組み・新規事業
- reason は「このプロジェクトを実施する理由」（1文）。【STAGE2最終ストーリー】と整合する根拠を引用で明示すること。
- hypothesis は「もし誰に対して/どの業務に対して◯◯を行えば、行動や体験がこう変わり、その結果 mainLever の指標がこう改善するはず」という形で1〜2文。【STAGE2最終ストーリー】のキーコンセプト/価値軸と連携させること。引用で根拠を示すこと。

【★Final Story整合（全プロジェクト・ミッション必須）】
- missionDraft/missionDescription、全projects の reason/hypothesis は【STAGE2最終ストーリー】の経営戦略方針と整合していなければ不合格。
- 各プロジェクトの実施根拠が【STAGE2最終ストーリー】に明示されている価値軸・キーコンセプト・経営ドメインの何を実装するのかを reason で述べること。
- hypothesis には、そのプロジェクトが実行される際に【STAGE2最終ストーリー】で定義された成功条件/価値指標がどう改善するのかを接続させること。
- 3部門のプロジェクト群全体が、統一された経営戦略ストーリーの「異なる実装アプローチ」として見える設計にすること。

【★STAGE3拡張フィールド（必須）】

【★TASK 1: OKR (Objective & Key Results) は必須】
- 各プロジェクトは okrs フィールドを必ず含める（省略禁止）
- okrs は最低1件、最大3件
- okrs[0].objective は必須（プロジェクトタイトルの実現ターゲット）
- okrs[0].keyResults は string[] で最低3個、最大5個（ラベルのみ）
  - keyResults の各要素は「プロジェクト短縮名 + 指標内容」形式
  - 例: "品質保証強化：不良率低減（ppm）", "受注プロセス：見積LT（営業日）"

【★TASK 1: OKR（KPI）差別化制約】
- 同一部門内で、別プロジェクトの keyResults をコピペしない（重複禁止）
- 各 keyResults には プロジェクト固有の名詞を含める：
  - 工程名（例：「検査」「梱包」「納品」）
  - 製品/サービス名（入力本文にある具体名）
  - 顧客セグメント（入力本文にある具体名）
  - 技術領域（入力本文にある具体名）

【★TASK 4-4: KR（Key Result）は「数値で追える指標」にする】
- KR は「数値で計測できる先行指標」ONLY（例：納期遵守率、検査工数、見積回答時間、歩留、再加工率、試作完了数、商談数、PoC件数…）
- 「改善」「強化」「推進」「推奨」など抽象語だけは厳禁（具体的な測定方法が見えない指標は不合格）
- 各指標に unit を明記（例：%, ppm, 件, 日, 時間, 円, h/月…）
- 同一部門内で、異なるプロジェクト間での KR 被り検出・回避が必須
  - 品質改善系、受注強化系、自動化系で、KR セットが明らかに異なる
  - 「リードタイム」と「リードタイム」はNG。「見積回答時間」と「納期遵守率」に差別化する等

【★TASK D: KPI（OKR）ユニーク制約】
- 各プロジェクトのKPIは、他プロジェクトと同一にならないようにする（完全一致を避ける）
- KPIはプロジェクトの施策内容に直結する先行指標を含める（汎用的な一般指標は避ける）
- 各プロジェクトのOKR：3〜5個。うち最低2つは固有指標（プロジェクト title / hypothesis から具体化した指標）を必ず含める
- 品質改善系 vs 営業強化系 vs 新規事業系等、プロジェクトアーキタイプが異なれば、KPIセットも明らかに異なる必須（同じ指標セットは物理的に避ける）

【★★CRITICAL: KPI生成の多様性強化（テンプレ化防止）】
- 絶対禁止：「生産性向上（%）」「顧客満足度（NPS）」「プロセス改善スコア（1-10）」の3本セット（汎用テンプレ）
- 絶対禁止：各プロジェクトで同一の3本KPI指標セット（部門内の別プロジェクトとの重複）
- 必須制約1：部門・プロジェクト固有の前提（Stage1の事業部情報）を必ず参照し、汎用的な一般化KPIではなくドメイン固有の指標を使用すること
  - 例：品質向上系なら「不良率（ppm）」「初回良品率」など製造業固有指標
  - 例：売上増加系なら「提案件数」「商談化率」など営業固有指標
  - 例：新規開発系なら「試作完了率」「開発リードタイム」など開発固有指標
- 必須制約2：3本のうち最低1本は"ドメイン固有指標"を含める（金融ならLTVや解約率、製造なら歩留まり、流通なら在庫回転数など）
- 必須制約3：3本のKRのうち2本以上は互いに異なるカテゴリに属すること。指標カテゴリの例：
  - 品質指標（歩留、不良率、再加工率、初回良品率など）
  - 納期・リードタイム指標（納期遵守率、見積回答時間、開発期間など）
  - コスト・効率指標（単位原価、工数、稼働率など）
  - 顧客・営業指標（受注率、提案件数、NPS、顧客単価など）
  - 安全・コンプライアンス指標（ヒヤリハット件数、監査合格率など）

0. okrs: OKR[] - 【★必須】 最低1個以上。各要素に objective と keyResults を含める（上記参照）

1. valueDriverLinks: string[] - STAGE2で定義された価値指標（valueDriverKPIs）の id を最低1つ以上含める。複数選択可。valueDriverKPIs が存在する場合、それ以外の値は禁止（自由記述不可）。
2. skillRequirements: { roleSkills?: string[]; executionSkills?: string[] } - 実行に必要なスキル
   - roleSkills: 職種スキル（例：「営業」「技術」「開発」「製造」等）1〜3個
   - executionSkills: 実行スキル（例：「PM」「標準化」「データ活用」「改善運用」「設計力」「交渉力」等）必ず1〜3個
   - ★重要：全プロジェクトで同一のスキルセットは厳禁。各プロジェクトごとに、title/hypothesis/mainLever/kind/valueDriverLinks/departmentName/laneを分析し、プロジェクトのアーキタイプ（品質改善型/自動化型/営業強化型/新規事業型/ITデータ型/組織改革型など）を内部で推定してから、そのアーキタイプに最適なスキルを選択すること。
3. humanInvestments: HumanInvestment[] - 人的投資施策、最低2カテゴリ以上を含める
   - category: 固定5カテゴリのみ使用可能（'TRAINING_OJT' | 'HIRING' | 'ALLOCATION' | 'EXTERNAL' | 'TOOLS_PROCESS'）
   - title: 施策名（短く、5〜15文字）
   - detail: 詳細（任意、1〜2文程度）
   - owner: 担当者（任意）
   - horizon: 実行時期（任意、'0_3M' | '3_6M' | '6_12M' | ''）
   - ★重要：全プロジェクトで同一の人的投資施策は厳禁。各プロジェクトのアーキタイプに基づき、入力本文にある事業・技術・顧客文脈に沿った施策名を選択すること。

--- 出力（日本語のJSONのみ、説明禁止） ---
{
  "strategy": { "summary": "会社全体の経営戦略要約（2〜3文）" },
  "departments": [
    {
      "name": "部門名（入力に存在するもののみ）",
      "missionDraft": "この部門の戦略ミッション案（1〜2文。構造変化/役割も含める）★【STAGE2 最終ストーリー】と整合性を持たせること",
      "missionDescription": "missionDraft の背景・理由・狙い（2〜4文。部門の事業概要/主要顧客/部門別財務/【STAGE2最終ストーリー】に言及すること）",
      "lanes": {
        "existing": {
          "projects": [
            {
              "title": "{STAGE2最終ストーリーの具体語を含む既存深掘プロジェクト名}",
              "reason": "目的（1文、引用あり）",
              "hypothesis": "仮説（1〜2文、引用あり）",
              "mainLever": "ACQ",
              "horizon": "short",
              "kind": "growth",
              "generatedBy": "ai",
              "generatedSlot": 1,
              "generatedGroup": "cascade_v1",
              "citations": ["fact-cust-1", "fact-fin-2"],
              "valueDriverLinks": ["kpi_id_1", "kpi_id_2"],
              "skillRequirements": {
                "roleSkills": ["営業", "技術"],
                "executionSkills": ["PM", "データ活用"]
              },
              "humanInvestments": [
                { "category": "TRAINING_OJT", "title": "{入力文脈に基づく育成施策名}", "detail": "{対象技術・用途に即した実践内容}" },
                { "category": "TOOLS_PROCESS", "title": "{入力文脈に基づく仕組み名}", "detail": "{対象案件・工程に即した運用内容}" }
              ]
            },
            {
              "title": "{STAGE2最終ストーリーの具体語を含む既存進化プロジェクト名}",
              "reason": "目的（1文、引用あり）",
              "hypothesis": "仮説（1〜2文、引用あり）",
              "mainLever": "ACQ",
              "horizon": "mid",
              "kind": "growth",
              "generatedBy": "ai",
              "generatedSlot": 2,
              "generatedGroup": "cascade_v1",
              "citations": ["fact-cust-1"],
              "valueDriverLinks": ["kpi_id_1"],
              "skillRequirements": {
                "roleSkills": ["営業"],
                "executionSkills": ["設計力", "PM"]
              },
              "humanInvestments": [
                { "category": "TRAINING_OJT", "title": "{入力文脈に基づく育成施策名}", "detail": "{対象顧客価値に即した実践内容}" },
                { "category": "TOOLS_PROCESS", "title": "{入力文脈に基づく仕組み名}", "detail": "{対象案件・工程に即した運用内容}" }
              ]
            }
          ]
        },
        "new": {
          "projects": [
            {
              "title": "{STAGE2最終ストーリーの具体語を含む新規探索プロジェクト名}",
              "reason": "目的（1文、引用あり）",
              "hypothesis": "仮説（1〜2文、引用あり）",
              "mainLever": "FUTURE",
              "horizon": "mid",
              "kind": "future",
              "generatedBy": "ai",
              "generatedSlot": 3,
              "generatedGroup": "cascade_v1",
              "citations": ["fact-cust-1", "fact-fin-2"],
              "valueDriverLinks": ["kpi_id_1"],
              "skillRequirements": {
                "roleSkills": ["エンジニア", "プロダクトマネジャー"],
                "executionSkills": ["PM", "設計力", "検証力"]
              },
              "humanInvestments": [
                { "category": "HIRING", "title": "{入力文脈に基づく人材施策名}", "detail": "{対象市場・用途に即した役割}" },
                { "category": "EXTERNAL", "title": "{入力文脈に基づく外部連携名}", "detail": "{対象技術・用途に即した検証内容}" }
              ]
            }
          ]
        },
        "intraCollab": {
          "projects": [
            {
              "title": "{STAGE2最終ストーリーの具体語を含む事業部内連携プロジェクト名}",
              "reason": "事業部内の機能連携が必要な理由（引用あり）",
              "hypothesis": "営業・技術・開発などが役割分担して動けば、顧客価値・提案精度・実行速度が高まるという仮説（引用あり）",
              "mainLever": "ACQ",
              "horizon": "short",
              "kind": "growth",
              "sourceType": "intraCollab",
              "collaborationType": "intraDept",
              "generatedBy": "ai",
              "generatedSlot": 4,
              "generatedGroup": "cascade_v1",
              "citations": ["fact-cust-1", "fact-fin-2"],
              "valueDriverLinks": ["kpi_id_1"],
              "skillRequirements": { "roleSkills": ["営業", "技術"], "executionSkills": ["共同ヒアリング", "提案設計"] },
              "humanInvestments": [
                { "category": "TOOLS_PROCESS", "title": "共同案件レビュー会", "detail": "営業と技術が重点案件を定例でレビューする" },
                { "category": "TRAINING_OJT", "title": "技術提案OJT", "detail": "顧客課題を技術仕様に翻訳する実践訓練" }
              ]
            }
          ]
        },
        "interCollab": {
          "projects": [
            {
              "title": "{STAGE2最終ストーリーの具体語を含む事業部間連携プロジェクト名}",
              "reason": "事業部間で連携すべき理由（引用あり）",
              "hypothesis": "別事業部の顧客・技術・販路を組み合わせれば、単独部門では作れない成長機会を検証できるという仮説（引用あり）",
              "mainLever": "FUTURE",
              "horizon": "mid",
              "kind": "future",
              "sourceType": "interCollab",
              "collaborationType": "interDept",
              "partnerDepartment": "連携先部門名",
              "generatedBy": "ai",
              "generatedSlot": 5,
              "generatedGroup": "cascade_v1",
              "citations": ["fact-cust-1", "fact-fin-2"],
              "valueDriverLinks": ["kpi_id_1"],
              "skillRequirements": { "roleSkills": ["事業開発", "技術"], "executionSkills": ["共同企画", "仮説検証"] },
              "humanInvestments": [
                { "category": "ALLOCATION", "title": "共同PJ担当アサイン", "detail": "両事業部から担当者を任命する" },
                { "category": "EXTERNAL", "title": "共同検証パートナー探索", "detail": "市場検証に必要な外部協力先を探索する" }
              ]
            }
          ]
        }
      },
      "needsCollab": ["誰と何をするかを具体化して記載（例：営業×技術：入力本文にある重点顧客・用途について、営業が要求を整理し、技術が実現可能性を検討して、提案精度の改善につなげる）"],
      "intraDeptCollab": ["事業部内連携を具体化して記載（例：営業×技術×製造：入力本文にある重点用途・製品について、営業が顧客要求を整理し、技術・製造が仕様化と量産実現性を検討して、戦略テーマの提案化につなげる）"],
      "interDeptCollab": ["事業部間連携を具体化して記載（例：A事業部×B事業部：入力情報に含まれる重点市場・顧客用途について、A事業部が市場要求を整理し、B事業部が既存技術や機能を組み合わせて、共同検証テーマを立ち上げる）"],
      "stopList": ["やめる/諦める項目（KRには含めない）"],
      "first90Days": ["最初の90日でやること（週/マイルストン粒度）"],
      "riskNotes": ["主要リスクと対処の一言"],
      "currentPosition": "この部門の現在の位置づけ（1〜2文・【必須】）",
      "strategicRole": "中期経営計画におけるこの部門の役割（1〜2文・【必須】）",
      "keyIssues": ["主要課題（2〜4個・【必須】）"],
      "alignmentRiskPoints": ["経営と現場で認識のズレが起きやすいポイント（1〜3個・【必須】）"]
    }
  ]
}

制約：
- missionDraft と missionDescription は必ず両方を含めること（空・null 禁止）。
- currentPosition、strategicRole、keyIssues、alignmentRiskPoints の4フィールドは【必須】。すべての部門について必ず生成し、返すこと。根拠不足を理由に省略することは禁止。
- lanes.existing は必ず2個のプロジェクトを出す（OK: 2個、NG: 1個・3個以上）。
- lanes.new は必ず1個のプロジェクトを出す（OK: 1個、NG: 0個・2個以上）。
- lanes.intraCollab は、事業部内連携が有効な場合は必ず1個の連携型プロジェクトを出す。該当が薄い場合でも候補を1個出し、sourceType="intraCollab"、collaborationType="intraDept" を付ける。
- lanes.interCollab は、入力部門が2つ以上ある場合のみ1個の連携型プロジェクトを出す。入力部門が1つだけの場合は必ず projects=[] とし、架空の連携先を作らない。現在の入力部門数: ${requestedDeptNames.length}
- ★TASK 2 引用ルール：
  - 各プロジェクトに citations フィールドを必ず含める。
  - 引用数は、各部門[FACTPACK]の requiredCitationCount（0〜2）と一致させること。
  - citations は当該部門のanchorsに実在するIDだけを使う。requiredCitationCount=0の場合は citations=[] とし、reason/hypothesisにfact-idを記載しない。
  - requiredCitationCountが1以上の場合、reason と hypothesis に「anchor本文」(fact-id) 形式で必要数を引用すること。
- 各プロジェクトに generatedBy="ai"、generatedSlot (既存進化=1/2、新規探索=3、事業部内連携=4、事業部間連携=5)、generatedGroup="cascade_v1" を必ず含める。
- financeSummary / businessPortfolio とかけ離れた非現実（売上10倍等）は避ける。
- ★全プロジェクトに valueDriverLinks、skillRequirements、humanInvestments、citations を必ず含める。citationsのみ requiredCitationCount=0 の場合は空配列を許可する。
- valueDriverLinks は valueDriverKPIs の id から選ぶこと（自由記述禁止）。
- humanInvestments は最低2カテゴリを含めること。
- ★★重要：全プロジェクトで skillRequirements.executionSkills や humanInvestments が同一になることは絶対に禁止。各プロジェクトのアーキタイプ（品質/自動化/営業/新規/ITデータ/組織など）を推定し、それぞれに適したスキルと施策を割り当てること。
- ★対象部門の既存事業と大きく異なる领域（全く無関係な新規事業など）を提案しないこと。
- intraDeptCollab / interDeptCollab / needsCollab は抽象表現で終わらせず、最低でも「誰と誰が」「何を対象に」「何を実現するか」が分かる1文にすること。
- 望ましい形式は「X×Y：対象顧客・案件・テーマについて、Xが〜し、Yが〜して、〜につなげる」。
- 「顧客ニーズの深掘り」「共同開発テーマの推進」「連携強化」などの抽象語だけで終わる記述は禁止。必ず対象、役割分担、目的を入れること。
- 各連携候補は実行イメージが湧く具体度にし、短すぎる標語（20字前後）にしないこと。目安は40〜90字程度。
- Q5（協力）の回答に他事業部・別事業部・共同開発・横断連携が明示される場合でも、入力部門が1つだけなら interDeptCollab は空配列にする。入力部門が2つ以上ある場合のみ、interDeptCollab を少なくとも1件返すこと。
`.trim();

    const overviewEvidenceText = [
      deptBlocks,
      finalStoryText,
      storyText,
      stage3BridgeText,
      financeSummaryText,
      portfolioText,
      financeCsvText,
    ].filter(Boolean).join('\n');

    // [STAGE3_PROMPT_FACTS] ログ：prompt に埋め込まれた FACTPACK ブロック全体
    {
      const factPackBlocks = prompt.match(/\[FACTPACK\][^[]*(?=\[|$)/g) || [];
      const factFinMatches = prompt.match(/fact-fin-\d+/g) || [];
      const moneyPatterns = prompt.match(/\d{10,}百万円|\d{10,}M円/g) || [];
      console.log('[STAGE3_PROMPT_FACTS]', {
        fact_fin_ids_count: factFinMatches.length,
        fact_fin_ids: factFinMatches,
        abnormal_money_patterns_count: moneyPatterns.length,
        abnormal_money_patterns: moneyPatterns,
        factPackBlocks_count: factPackBlocks.length,
        factPackBlocks_sample: factPackBlocks.map(b => b.slice(0, 300)),
      });
    }

    // ★ STAGE3: TASK 1-2 - LLM呼び出し直前の注入証明ログ
    if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1') {
      const injected = prompt.includes('★ STAGE3: 6問の回答');
      const deptBlocksInPrompt = (prompt.match(/\[部門\]/g) || []).length;
      console.log('[cascade][dept6][inject-proof]', {
        deptCount: departments.length,
        deptBlocksInPrompt,
        promptLen: prompt.length,
        injected,
        head: prompt.slice(0, 120),
        tail: prompt.slice(-160),
      });
    }

    /* =========================
     * OpenAI 呼び出し（JSON強制）
     * ======================= */
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0.35,
      max_tokens: 5000,
      messages: [
        { role: 'system', content: '必ずJSONのみを返し、日本語で。前後の説明は禁止。' },
        { role: 'user', content: prompt },
      ],
    });

    const rawContent = completion.choices?.[0]?.message?.content || '';
    const parsed = extractJsonObject(rawContent);

    // [STAGE3_AI_RAW] ログ：AI生成結果の詳細
    {
      const hypothesisMatches = (rawContent.match(/"hypothesis"\s*:\s*"([^"]+)"/g) || []).slice(0, 10);
      const abnormalInHypothesis = (rawContent.match(/"hypothesis"\s*:\s*"[^"]*\d{10,}百万円[^"]*"/g) || []).length;
      const factFinInContent = (rawContent.match(/fact-fin-\d+/g) || []).length;
      console.log('[STAGE3_AI_RAW]', {
        rawContent_len: rawContent.length,
        rawContent_sample: rawContent.slice(0, 200),
        hasParsed: !!parsed,
        hypothesis_count: hypothesisMatches.length,
        hypothesis_samples: hypothesisMatches.slice(0, 3),
        abnormalMoney_inHypothesis_count: abnormalInHypothesis,
        factFin_in_content: factFinInContent,
      });
    }

    if (!parsed) {
      return new NextResponse(JSON.stringify({ error: '生成結果のJSON解析に失敗しました。' }), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    // ★ 調査ログ①：API生成直後の missionDescription 確認
    {
      if (parsed?.departments && Array.isArray(parsed.departments)) {
        console.log('[STAGE3][API generated departments]', parsed.departments.map((d: any) => ({
          name: d?.name,
          missionDraft: d?.missionDraft?.substring(0, 60),
          missionDescription: d?.missionDescription?.substring(0, 60),
        })));
      }
    }

    // [STAGE3_ABNORMAL_MONEY] ログ：異常値検出の詳細
    {
      const abnormalList = [];
      if (parsed?.departments) {
        for (const dept of parsed.departments) {
          const deptName = dept?.name || '不明';
          for (const proj of [...((dept?.lanes?.existing?.projects) || []), ...((dept?.lanes?.new?.projects) || []), ...(dept?.projects || [])]) {
            const hypothesis = proj?.hypothesis || '';
            const reason = proj?.reason || '';
            const abnormalValues = hypothesis.match(/\d{10,}百万円|\d{10,}M円/) || [];
            const factIds = hypothesis.match(/\(fact-[^)]+\)/g) || [];
            if (abnormalValues.length > 0 || factIds.length > 0) {
              abnormalList.push({
                dept: deptName,
                projTitle: proj?.title,
                hypothesis_full: hypothesis,
                reason_full: reason,
                abnormalValues: abnormalValues,
                factIds: factIds,
              });
            }
          }
        }
      }
      if (abnormalList.length > 0) {
        console.log('[STAGE3_ABNORMAL_MONEY]', {
          count: abnormalList.length,
          details: abnormalList,
        });
      }
    }

    const safe = ResponseSchema.safeParse(parsed);
    if (!safe.success) {
      console.warn('generate-cascade: schema validation errors:', safe.error?.issues);
    }
    let normalized = (safe.success ? safe.data : parsed) as z.infer<typeof ResponseSchema>;

    /* =========================
     * ★TASK 2-2: Citations Grounding Gate + 1回再生成
     * ======================= */

    // 部門ごとの実在anchor数に応じて、引用必須数を0〜2件で動的に決める。
    const getValidAnchorIds = (deptName: string): Set<string> => {
      const anchors = factPackByDept.get(deptName)?.anchors ?? [];
      return new Set(
        anchors
          .map((a: any) => String(a?.id ?? '').trim())
          .filter(Boolean),
      );
    };

    const getRequiredCitationCount = (deptName: string): number =>
      Math.min(2, getValidAnchorIds(deptName).size);

    const extractFactIds = (text: string): string[] =>
      Array.from(String(text ?? '').matchAll(/fact-[a-z0-9_-]+/gi))
        .map((m) => m[0])
        .filter(Boolean);

    // 引用フォーマット数（診断ログ用）
    const countInlineQuotes = (p: any): number => {
      const text = `${p?.reason ?? ''} ${p?.hypothesis ?? ''}`;
      const citationPattern = /[「『][^」』]+[」』]\s*[（(][^）)]*fact-[^）)]*[)）]/g;
      return text.match(citationPattern)?.length ?? 0;
    };

    type GroundingLevel = {
      level: 'A' | 'B' | 'C';
      matchCount: number;
      factIdCount: number;
      requiredCitationCount: number;
      validCitationCount: number;
      invalidCitationCount: number;
    };

    const getGroundingLevel = (p: any, deptName: string): GroundingLevel => {
      const validAnchorIds = getValidAnchorIds(deptName);
      const requiredCitationCount = Math.min(2, validAnchorIds.size);
      const citations = Array.isArray(p?.citations)
        ? Array.from(new Set(p.citations.map((id: any) => String(id ?? '').trim()).filter(Boolean)))
        : [];
      const validCitations = citations.filter((id: string) => validAnchorIds.has(id));
      const invalidCitationCount = citations.length - validCitations.length;
      const text = `${p?.reason ?? ''} ${p?.hypothesis ?? ''}`;
      const validFactIdsInText = Array.from(
        new Set(extractFactIds(text).filter((id) => validAnchorIds.has(id))),
      );
      const inlineQuoteMatches = countInlineQuotes(p);

      // 実在anchorがない場合は、引用を捏造させずSTAGE2/6問回答で接地させる。
      if (requiredCitationCount === 0) {
        return {
          level: 'A',
          matchCount: inlineQuoteMatches,
          factIdCount: 0,
          requiredCitationCount,
          validCitationCount: 0,
          invalidCitationCount,
        };
      }

      if (
        validCitations.length >= requiredCitationCount &&
        validFactIdsInText.length >= requiredCitationCount
      ) {
        return {
          level: 'A',
          matchCount: inlineQuoteMatches,
          factIdCount: validFactIdsInText.length,
          requiredCitationCount,
          validCitationCount: validCitations.length,
          invalidCitationCount,
        };
      }

      if (validCitations.length >= requiredCitationCount) {
        return {
          level: 'B',
          matchCount: inlineQuoteMatches,
          factIdCount: validFactIdsInText.length,
          requiredCitationCount,
          validCitationCount: validCitations.length,
          invalidCitationCount,
        };
      }

      return {
        level: 'C',
        matchCount: inlineQuoteMatches,
        factIdCount: validFactIdsInText.length,
        requiredCitationCount,
        validCitationCount: validCitations.length,
        invalidCitationCount,
      };
    };

    const isProjectGrounded = (p: any, deptName: string): boolean =>
      getGroundingLevel(p, deptName).level === 'A';

    // Required fields チェック
    const hasRequiredFields = (p: any): boolean => {
      if (!p?.title || !p?.reason || !p?.hypothesis) return false;
      if (!p?.mainLever || !p?.kind || !p?.horizon) return false;
      if (!Array.isArray(p?.valueDriverLinks) || p.valueDriverLinks.length < 1) return false;
      if (!p?.skillRequirements) return false;
      if (!Array.isArray(p?.humanInvestments) || p.humanInvestments.length < 1) return false;
      return true;
    };

    // ★ TASK 5: 2nd-pass 実行条件制限用の追跡用Set（grounding/conflict/risk issues）
    const groundingFailedDepts = new Set<string>();
    const conflictFailedDepts = new Set<string>();
    const highRiskDepts = new Set<string>();

    // ★ groundingCheckAndRetry 関数定義（groundingFailedDepts 参照のため上記Set定義後）
    const groundingCheckAndRetry = async (depts: any[]): Promise<void> => {
      const failedProjects: Array<{
        deptIndex: number;
        deptName: string;
        laneType: CascadeLaneType;
        projectIndex: number;
        slot: number;
        project: any;
        groundingLevel: string;
        citationCount: number;
        factIdCount: number;
        matchCount: number;
        requiredCitationCount: number;
      }> = [];

      // 失敗したproject特定
      for (let dIdx = 0; dIdx < depts.length; dIdx++) {
        const dept = depts[dIdx];
        const deptName = dept?.name ?? `dept_${dIdx}`;

        // existing lane
        if (dept?.lanes?.existing?.projects) {
          for (let pIdx = 0; pIdx < dept.lanes.existing.projects.length; pIdx++) {
            const proj = dept.lanes.existing.projects[pIdx];
            const groundingLevel = getGroundingLevel(proj, deptName);

            if (groundingLevel.level !== 'A') {
              const slot = pIdx + 1;
              const citationCount = Array.isArray(proj?.citations) ? proj.citations.length : 0;

              // ★デバッグログ: isProjectGrounded が false のとき詳細出力
              const reasonHead = (proj?.reason ?? '').slice(0, 200);
              const hypothesisHead = (proj?.hypothesis ?? '').slice(0, 200);
              console.log(
                `[cascade][grounding][ng] dept=${deptName} lane=existing slot=${slot} ` +
                `level=${groundingLevel.level} citations=${citationCount} factIdCount=${groundingLevel.factIdCount} matchCount=${groundingLevel.matchCount}\n` +
                `  reason[0:200]="${reasonHead}"\n` +
                `  hypothesis[0:200]="${hypothesisHead}"\n` +
                `  citations=[${(proj?.citations ?? []).join(', ')}]`
              );

              failedProjects.push({
                deptIndex: dIdx,
                deptName,
                laneType: 'existing',
                projectIndex: pIdx,
                slot,
                project: proj,
                groundingLevel: groundingLevel.level,
                citationCount,
                factIdCount: groundingLevel.factIdCount,
                matchCount: groundingLevel.matchCount,
                requiredCitationCount: groundingLevel.requiredCitationCount,
              });
            }
          }
        }

        // new lane
        if (dept?.lanes?.new?.projects) {
          for (let pIdx = 0; pIdx < dept.lanes.new.projects.length; pIdx++) {
            const proj = dept.lanes.new.projects[pIdx];
            const groundingLevel = getGroundingLevel(proj, deptName);

            if (groundingLevel.level !== 'A') {
              const slot = 3 + pIdx;
              const citationCount = Array.isArray(proj?.citations) ? proj.citations.length : 0;

              // ★デバッグログ: isProjectGrounded が false のとき詳細出力
              const reasonHead = (proj?.reason ?? '').slice(0, 200);
              const hypothesisHead = (proj?.hypothesis ?? '').slice(0, 200);
              console.log(
                `[cascade][grounding][ng] dept=${deptName} lane=new slot=${slot} ` +
                `level=${groundingLevel.level} citations=${citationCount} factIdCount=${groundingLevel.factIdCount} matchCount=${groundingLevel.matchCount}\n` +
                `  reason[0:200]="${reasonHead}"\n` +
                `  hypothesis[0:200]="${hypothesisHead}"\n` +
                `  citations=[${(proj?.citations ?? []).join(', ')}]`
              );

              failedProjects.push({
                deptIndex: dIdx,
                deptName,
                laneType: 'new',
                projectIndex: pIdx,
                slot,
                project: proj,
                groundingLevel: groundingLevel.level,
                citationCount,
                factIdCount: groundingLevel.factIdCount,
                matchCount: groundingLevel.matchCount,
                requiredCitationCount: groundingLevel.requiredCitationCount,
              });
            }
          }
        }
      }

      // 失敗projectがあれば再生成（最大1回）
      if (failedProjects.length > 0) {
        for (const failed of failedProjects) {
          const dept = depts[failed.deptIndex];
          const deptName = dept?.name ?? '';
          const slot = failed.slot;

          console.log(
            `[cascade][grounding][retry] dept=${deptName} slot=${slot} level=${failed.groundingLevel} ` +
            `citations=${failed.citationCount} factIdCount=${failed.factIdCount} matchCount=${failed.matchCount}`
          );

          // FACTPACK anchors を取得
          const factPack = factPackByDept.get(deptName);
          const anchorsList = factPack?.anchors ?? [];
          const anchorsText = anchorsList
            .map((a: any) => `  - ${a.id}: ${a.text}`)
            .join('\n');

          // ★ テンプレ文：2つのanchorを「text」(fact-id)で埋める形式を強制
          const templateExample = failed.requiredCitationCount >= 2
            ? `例：「${anchorsList[0].text}」(${anchorsList[0].id}) により${anchorsList[0].text.slice(0, 20)}が確認でき、` +
              `「${anchorsList[1].text}」(${anchorsList[1].id}) の観点から戦略を立案する`
            : failed.requiredCitationCount === 1
              ? `例：「${anchorsList[0].text}」(${anchorsList[0].id}) を根拠に戦略を立案する`
              : '利用可能なanchorがないため、fact-idを創作せずSTAGE2最終ストーリーと6問回答を根拠にする';

          // 再生成prompt
          const retryPrompt = `
前回のプロジェクト案では、引用ベース生成の要件を満たしていません。
現在の状況：
- citations数: ${failed.citationCount}/${failed.requiredCitationCount} (必須数は実在anchor数に応じて決定)
- 有効fact-id出現数: ${failed.factIdCount}/${failed.requiredCitationCount}
- 引用フォーマット数: ${failed.matchCount}

以下の部門について、${failed.laneType === 'existing' ? '既存進化レーン' : '新規探索レーン'}のプロジェクト案を修正してください：

部門: ${deptName}

【このセグメントで利用可能なFACTPACK anchors】
${anchorsText || '（利用可能なanchorsなし）'}

【修正必須条件】
1. citations は上記リストから実在するIDをちょうど${failed.requiredCitationCount}個含めること（捏造禁止）
2. reason と hypothesis に 「text」(fact-id) 形式で合計${failed.requiredCitationCount}箇所含めること
   ${templateExample}
3. 固有名詞（顧客名/製品名/工程）を title に必須で含めること
4. 他の部門と異なるanchorsを選ぶこと

前回の出力（参考）：
${JSON.stringify(failed.project, null, 2)}

修正後のプロジェクト案の JSON のみを返してください：

{
  "title": "...",
  "reason": "...",
  "hypothesis": "...",
  "mainLever": "ACQ" | "ARPU" | "CHURN" | "COST" | "EFFICIENCY" | "FUTURE",
  "horizon": "short" | "mid" | "long",
  "kind": "growth" | "cost" | "efficiency" | "future",
  "citations": ${failed.requiredCitationCount === 0 ? '[]' : failed.requiredCitationCount === 1 ? '["fact-..."]' : '["fact-...", "fact-..."]'},
  "valueDriverLinks": [...],
  "skillRequirements": {...},
  "humanInvestments": [...],
  "generatedBy": "ai",
  "generatedSlot": ${slot},
  "generatedGroup": "cascade_v1"
}
`.trim();

          try {
            // ★修正3: OpenAI リトライ機能を使用（fetch failed/UND_ERR_SOCKET 対策）
            const retryRaw = await callOpenAIJsonWithRetry(
              retryPrompt,
              '修正プロジェクト案の JSON のみを返してください。日本語で。',
              `grounding-retry-dept=${deptName}`
            );
            const retryParsed = extractJsonObject(retryRaw);

            if (retryParsed) {
              const retrySafe = ProjectSchema.safeParse(retryParsed);
              const retryProject = retrySafe.success ? retrySafe.data : retryParsed;

              // 再検証: grounding + required fields
              if (isProjectGrounded(retryProject, deptName) && hasRequiredFields(retryProject)) {
                // 成功：差し替え
                if (failed.laneType === 'existing') {
                  depts[failed.deptIndex].lanes.existing.projects[failed.projectIndex] = retryProject;
                } else {
                  depts[failed.deptIndex].lanes.new.projects[failed.projectIndex] = retryProject;
                }
                console.log(`[cascade][grounding][retry-success] dept=${deptName} slot=${slot}`);
              } else {
                // 再生成でもNGなら fallback（既存結果を採用）
                const failReason = !isProjectGrounded(retryProject, deptName) ? 'grounding_ng' : 'required_fields_missing';
                console.warn(`[cascade][grounding][fail] dept=${deptName} slot=${slot} reason="${failReason}" (再生成でも条件未充足、既存結果を採用)`);
                // ★ TASK 5: grounding failed として記録
                groundingFailedDepts.add(deptName);
              }
            } else {
              // JSON解析失敗なら fallback
              console.warn(`[cascade][grounding][fail] dept=${deptName} slot=${slot} reason="retry_json_parse_error"`);
              // ★ TASK 5: grounding failed として記録
              groundingFailedDepts.add(deptName);
            }
          } catch (err) {
            console.warn(`[cascade][grounding][fail] dept=${deptName} slot=${slot} reason="retry_error" error=${err instanceof Error ? err.message : String(err)}`);
            // ★ TASK 5: grounding failed として記録
            groundingFailedDepts.add(deptName);
          }
        }
      }
    };

    // ★TASK 2-2 実行
    await groundingCheckAndRetry(normalized.departments);

    /* =========================
     * ★TASK 3: 部門横断の類似度チェック→衝突側だけ再生成（最大2回、全体6回制限）
     * ======================= */

    // STOP_WORDS（テンプレ語）
    const STOP_WORDS_TASK3 = new Set([
      '高付加価値', '付加価値', '強化', '改善', '推進', '最適化', '効率化', '省力化', '標準化',
      '商談', '案件', '受注', '獲得', '拡大', '新規開拓', '顧客開拓',
      '次世代', '仮説', '検証', '実証', 'poc', 'PoC', 'パイロット',
      'dx', 'DX', 'デジタル', 'データ活用', '体制', 'プロセス', '仕組み',
    ]);

    // normalizeForSim: title + reason を対象に類似度計算用に正規化
    const normalizeForSim = (text: string): Set<string> => {
      // stripAiPrefix
      let t = (text ?? '').replace(/^\s*\[ai#\d+\]\s*/i, '').trim();
      // toLowerCase + 記号除去 + 連続スペース除去
      t = t.toLowerCase().replace(/[！！?？。，、、\.,:;；：\-—–~～（）\(\)\[\]【】「」『』《》<>《》・]/g, ' ').replace(/\s+/g, ' ').trim();
      // 日本語/英数字を tokenize（例：text.split(/[^一-龠ぁ-んァ-ヶa-zA-Z0-9]+/)）
      const tokens = t.split(/[^一-龠ぁ-んァ-ヶa-zA-Z0-9]+/).filter(Boolean);
      // 2文字未満 token を除外
      const filtered = tokens.filter((tok: string) => tok.length >= 2);
      // STOP_WORDS を除外
      const result = filtered.filter((tok: string) => !STOP_WORDS_TASK3.has(tok.toLowerCase()));
      return new Set(result);
    };

    // tokenJaccard: token set で Jaccard 距離
    const tokenJaccard = (set1: Set<string>, set2: Set<string>): number => {
      if (set1.size === 0 && set2.size === 0) return 1;
      const intersection = new Set([...set1].filter((x: string) => set2.has(x)));
      const union = new Set([...set1, ...set2]);
      if (union.size === 0) return 1;
      return intersection.size / union.size;
    };

    // 衝突検知＆再生成
    const detectAndFixSimilarProjects = async (depts: any[]): Promise<void> => {
      // 衝突を検知する
      const conflicts: Array<{
        deptAIdx: number;
        deptAName: string;
        laneTypeA: CascadeLaneType;
        slotA: number;
        projA: any;
        deptBIdx: number;
        deptBName: string;
        laneTypeB: CascadeLaneType;
        slotB: number;
        projB: any;
        score: number;
      }> = [];

      // 全 dept pair を走査
      for (let i = 0; i < depts.length; i++) {
        for (let j = i + 1; j < depts.length; j++) {
          const deptA = depts[i];
          const deptB = depts[j];
          const deptAName = deptA?.name ?? '';
          const deptBName = deptB?.name ?? '';

          // deptA の projects
          const projectsA: Array<{ laneType: CascadeLaneType; slot: number; proj: any }> = [];
          if (deptA?.lanes?.existing?.projects) {
            deptA.lanes.existing.projects.forEach((p: any, idx: number) => {
              projectsA.push({ laneType: 'existing', slot: idx + 1, proj: p });
            });
          }
          if (deptA?.lanes?.new?.projects) {
            deptA.lanes.new.projects.forEach((p: any, idx: number) => {
              projectsA.push({ laneType: 'new', slot: 3 + idx, proj: p });
            });
          }

          // deptB の projects
          const projectsB: Array<{ laneType: CascadeLaneType; slot: number; proj: any }> = [];
          if (deptB?.lanes?.existing?.projects) {
            deptB.lanes.existing.projects.forEach((p: any, idx: number) => {
              projectsB.push({ laneType: 'existing', slot: idx + 1, proj: p });
            });
          }
          if (deptB?.lanes?.new?.projects) {
            deptB.lanes.new.projects.forEach((p: any, idx: number) => {
              projectsB.push({ laneType: 'new', slot: 3 + idx, proj: p });
            });
          }

          // 全ペアで類似度計算
          for (const pA of projectsA) {
            for (const pB of projectsB) {
              const textA = `${pA.proj?.title ?? ''} ${pA.proj?.reason ?? ''}`;
              const textB = `${pB.proj?.title ?? ''} ${pB.proj?.reason ?? ''}`;

              const setA = normalizeForSim(textA);
              const setB = normalizeForSim(textB);
              const score = tokenJaccard(setA, setB);

              if (score >= 0.62) {
                conflicts.push({
                  deptAIdx: i,
                  deptAName,
                  laneTypeA: pA.laneType,
                  slotA: pA.slot,
                  projA: pA.proj,
                  deptBIdx: j,
                  deptBName,
                  laneTypeB: pB.laneType,
                  slotB: pB.slot,
                  projB: pB.proj,
                  score,
                });
              }
            }
          }
        }
      }

      if (conflicts.length === 0) return;

      // 衝突ログ
      for (const conflict of conflicts) {
        console.log(
          `[cascade][sim][conflict] deptA=${conflict.deptAName} deptB=${conflict.deptBName} slotA=${conflict.slotA} slotB=${conflict.slotB} score=${(conflict.score * 100).toFixed(1)}`
        );
      }

      // 衝突側（後に出てきた方 = deptB）だけ再生成
      const regen_attempts = new Map<string, number>(); // key: "deptName|laneType|slot"
      let totalRegenAttempts = 0;
      const MAX_REGEN_PER_PROJECT = 2;
      const MAX_TOTAL_REGEN = 6;

      for (const conflict of conflicts) {
        // deptB 側を再生成対象にする
        const key = `${conflict.deptBName}|${conflict.laneTypeB}|${conflict.slotB}`;
        const currentAttempts = regen_attempts.get(key) ?? 0;

        if (currentAttempts >= MAX_REGEN_PER_PROJECT || totalRegenAttempts >= MAX_TOTAL_REGEN) {
          console.log(`[cascade][sim][regen-skip] dept=${conflict.deptBName} slot=${conflict.slotB} reason="max_attempts"`);
          continue;
        }

        const attempt = currentAttempts + 1;
        regen_attempts.set(key, attempt);
        totalRegenAttempts++;

        console.log(`[cascade][sim][regen] dept=${conflict.deptBName} slot=${conflict.slotB} attempt=${attempt}`);

        // 再生成prompt
        const factPack = factPackByDept.get(conflict.deptBName);
        const anchorsList = factPack?.anchors ?? [];
        const anchorsText = anchorsList.map((a: any) => `  - ${a.id}: ${a.text}`).join('\n');
        const requiredCitationCount = Math.min(2, anchorsList.length);

        const retryPrompt = `
部門間で同じ内容のプロジェクト案が出現しました：

衝突相手の部門: ${conflict.deptAName}
衝突相手のプロジェクト:
- title: "${conflict.projA?.title ?? ''}"
- reason: "${conflict.projA?.reason ?? ''}"

以下の条件で修正してください：

【修正必須条件】
1. 衝突相手と同じ内容を避けること
2. 衝突相手と異なる固有名詞を使うこと
3. 衝突相手と異なるanchors を引用すること
4. mainLever を変える（可能であれば）
5. citations と「text」(fact-id) 引用は、利用可能なanchor数に応じて${requiredCitationCount}件必須。実在しないIDは禁止。required fields（title/reason/hypothesis/mainLever/kind/horizon/valueDriverLinks>=1/skillRequirements/humanInvestments>=1）も必須

【このセグメントで利用可能なFACTPACK anchors】
${anchorsText || '（利用可能なanchorsなし）'}
※ citations は上記リストから選択すること、捏造禁止

修正後のプロジェクト案の JSON のみを返してください：

{
  "title": "...",
  "reason": "...",
  "hypothesis": "...",
  "mainLever": "ACQ" | "ARPU" | "CHURN" | "COST" | "EFFICIENCY" | "FUTURE",
  "horizon": "short" | "mid" | "long",
  "kind": "growth" | "cost" | "efficiency" | "future",
  "citations": ${requiredCitationCount === 0 ? '[]' : requiredCitationCount === 1 ? '["fact-..."]' : '["fact-...", "fact-..."]'},
  "valueDriverLinks": [...],
  "skillRequirements": {...},
  "humanInvestments": [...],
  "generatedBy": "ai",
  "generatedSlot": ${conflict.slotB},
  "generatedGroup": "cascade_v1"
}
`.trim();

        try {
          // ★修正3: OpenAI リトライ機能を使用（fetch failed/UND_ERR_SOCKET 対策）
          const retryRaw = await callOpenAIJsonWithRetry(
            retryPrompt,
            '修正プロジェクト案の JSON のみを返してください。日本語で。',
            `conflict-retry-dept=${conflict.deptBName}`
          );
          const retryParsed = extractJsonObject(retryRaw);

          if (retryParsed) {
            const retrySafe = ProjectSchema.safeParse(retryParsed);
            const retryProject = retrySafe.success ? retrySafe.data : retryParsed;

            // 再検証: grounding + required fields
            if (isProjectGrounded(retryProject, conflict.deptBName) && hasRequiredFields(retryProject)) {
              // 成功：差し替え
              if (conflict.laneTypeB === 'existing') {
                depts[conflict.deptBIdx].lanes.existing.projects[conflict.slotB - 1] = retryProject;
              } else {
                depts[conflict.deptBIdx].lanes.new.projects[conflict.slotB - 3] = retryProject;
              }
              console.log(`[cascade][sim][regen-success] dept=${conflict.deptBName} slot=${conflict.slotB} attempt=${attempt}`);
            } else {
              // 再生成でもNGなら fallback
              const failReason = !isProjectGrounded(retryProject, conflict.deptBName) ? 'grounding_ng' : 'required_fields_missing';
              console.warn(`[cascade][sim][regen-fail] dept=${conflict.deptBName} slot=${conflict.slotB} attempt=${attempt} reason="${failReason}"`);
              // ★バグ修正③: conflictFailedDepts に追加
              conflictFailedDepts.add(conflict.deptBName);
            }
          } else {
            // JSON解析失敗
            console.warn(`[cascade][sim][regen-fail] dept=${conflict.deptBName} slot=${conflict.slotB} attempt=${attempt} reason="json_parse_error"`);
            // ★バグ修正③: conflictFailedDepts に追加
            conflictFailedDepts.add(conflict.deptBName);
          }
        } catch (err) {
          console.warn(
            `[cascade][sim][regen-fail] dept=${conflict.deptBName} slot=${conflict.slotB} attempt=${attempt} reason="api_error" error=${err instanceof Error ? err.message : String(err)}`
          );
          // ★バグ修正③: conflictFailedDepts に追加
          conflictFailedDepts.add(conflict.deptBName);
        }
      }
    };

    // ★TASK 3 実行
    await detectAndFixSimilarProjects(Array.isArray(normalized?.departments) ? normalized.departments : []);

    // ★ TASK 2: [AI#] prefix 除去ヘルパー
    const stripAiPrefix = (title: string) => {
      return (title ?? '').replace(/^\s*\[ai#\d+\]\s*/i, '').trim();
    };

    // 画面表示用：FACTPACK ID、DEBUG、旧版の汎用constraint文を除去する。
    // fact-constraint--3 のような負数IDや、将来追加されるfact-*も包括的に対象にする。
    const stripInternalMarkers = (value: unknown): string => {
      return String(value ?? '')
        .replace(/【DEBUG】[^\n。]*[。]?/g, '')
        .replace(/[「『]?(?:経営課題への対応が重要です|経営課題の多層性を考慮する必要があります|デジタルトランスフォーメーションは継続的課題です|人材確保と育成は常に優先度が高い|顧客ニーズへの迅速な対応が求められます|サプライチェーンの最適化が進行中です|市場変化への適応力強化が重要です|コスト効率化と品質向上の両立が課題|グローバル展開の加速を計画中です)[」』]?/g, '')
        .replace(/[（(]\s*fact-[a-z0-9_-]+\s*[）)]/gi, '')
        .replace(/\[\s*fact-[a-z0-9_-]+\s*\]/gi, '')
        .replace(/(^|[。．]\s*)\s*を?(?:考慮し|踏まえ)[、，]\s*/g, '$1')
        .replace(/([」』])\s+を根拠に/g, '$1を根拠に')
        .replace(/\s*、\s*を根拠に/g, 'を根拠に')
        .replace(/^[、，。．\s]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const sanitizeOkrsForUi = (okrs: any[]) => {
      if (!Array.isArray(okrs)) return [];
      return okrs.map((okr: any) => ({
        ...okr,
        objective: stripInternalMarkers(okr?.objective),
        keyResults: Array.isArray(okr?.keyResults)
          ? okr.keyResults.map((kr: any) => typeof kr === 'string'
              ? stripInternalMarkers(kr)
              : { ...kr, title: stripInternalMarkers(kr?.title), label: stripInternalMarkers(kr?.label), text: stripInternalMarkers(kr?.text) })
          : [],
      }));
    };

    const sanitizeProjectForUi = (proj: any, deptName: string) => {
      const validAnchorIds = getValidAnchorIds(deptName);
      const citations = Array.isArray(proj?.citations)
        ? Array.from(
            new Set(
              proj.citations
                .map((id: any) => String(id ?? '').trim())
                .filter((id: string) => validAnchorIds.has(id)),
            ),
          )
        : [];

      return {
        ...proj,
        citations,
        title: stripInternalMarkers(proj?.title),
        reason: stripInternalMarkers(proj?.reason),
        hypothesis: stripInternalMarkers(proj?.hypothesis),
        okrs: sanitizeOkrsForUi(proj?.okrs ?? []),
      };
    };

    // P0: Prefix強制用関数
    const ensurePrefix = (deptName: string, title: string) => {
      // ★ TASK 2: stripAiPrefix を先に適用
      const stripped = stripAiPrefix(title);
      const t = stripped.trim();
      if (!t) return `${deptName}：（未設定プロジェクト）`;
      return /^[^：:]+[：:]/.test(t) ? t : `${deptName}：${t}`;
    };

    // P1: baseTitle抽出（部門名prefixを剥がして正規化）
    const baseTitle = (deptName: string, title: string) => {
      const t = (title ?? '').trim();
      const dn = (deptName ?? '').trim();
      // "部門名：" を剥がす（: / ： 両対応）
      const re = dn ? new RegExp(`^${dn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[：:]\\s*`) : null;
      const stripped = re ? t.replace(re, '') : t;
      // ★ TASK D: [AI#1]等のprefix を剥がす
      const stripped2 = stripped.replace(/^\[ai#\d+\]\s*/i, '');
      return stripped2
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[：:]/g, ':')
        .trim();
    };

    // テンプレ三種の神器（ロジック的に同一になりやすい）
    const GENERIC_BASE_TITLES = [
      '既存顧客のltv改善',
      '商談設計力の強化',
      '次世代サービス仮説検証',
      '顧客満足度向上プログラム',
      '新規顧客開拓戦略',
      'デジタルマーケティング強化プロジェクト',
      '業務効率化',
      'サービス拡充',
      '売上向上',
      '収益性改善',
    ];

    const isGeneric = (bt: string) => GENERIC_BASE_TITLES.some(g => bt.includes(g));

    const collectAllTitles = (depts: any[]) => {
      const titleMap = new Map<string, { deptNames: string[]; baseTitles: string[] }>();

      for (const dept of depts) {
        const deptName = dept?.name ?? '';
        const allProjects = [
          ...(dept?.lanes?.existing?.projects ?? []),
          ...(dept?.lanes?.new?.projects ?? []),
          ...(dept?.projects ?? []),
        ];

        for (const proj of allProjects) {
          const title = proj?.title ?? '';
          const bt = baseTitle(deptName, title);
          if (bt) {
            if (!titleMap.has(bt)) {
              titleMap.set(bt, { deptNames: [], baseTitles: [] });
            }
            const entry = titleMap.get(bt)!;
            if (!entry.deptNames.includes(deptName)) {
              entry.deptNames.push(deptName);
            }
            entry.baseTitles.push(title);
          }
        }
      }

      return titleMap;
    };

    const findDuplicateDepts = (depts: any[]) => {
      const titleMap = collectAllTitles(depts);
      const duplicateDepts = new Set<string>();
      const genericDepts = new Set<string>();

      for (const [bt, { deptNames }] of titleMap) {
        // 複数部門で同じ baseTitle が使われている
        if (new Set(deptNames).size > 1) {
          deptNames.forEach(d => duplicateDepts.add(d));
        }
        // テンプレ判定
        if (isGeneric(bt)) {
          deptNames.forEach(d => genericDepts.add(d));
        }
      }

      // 重複 or generic のどちらかに当たれば 2nd-pass 対象
      return new Set([...duplicateDepts, ...genericDepts]);
    };

    const duplicateDeptNames = findDuplicateDepts(Array.isArray(normalized?.departments) ? normalized.departments : []);

    /* =========================
     * ★ TASK 1-3: 他セグメント語彙の検知と拒否
     * ======================= */

    const splitTokens = (s: string): string[] =>
      (s ?? '')
        .replace(/\s+/g, ' ')
        .split(/[ 、,，。．/・\-\n\r\t]+/g)
        .map((t: string) => t.trim())
        .filter(Boolean) as string[];

    const STOP_WORDS = new Set([
      '顧客', '市場', 'メーカー', '事業', '部品', '製品', '提供', '拡大', '強化', '改善', '向上', '開発', '推進',
      '最適化', '効率化', 'プロジェクト', 'サービス', '顧客層', '主要', '新規', '既存',
    ]);

    // ★ TASK 1-A: セグメント名分解ヘルパー（例：自動車精密部品 → [自動車, 精密, 部品, 自動車精密, ...])
    const splitSegmentNameTokens = (name: string): string[] => {
      const base = (name ?? '')
        .trim()
        .replace(/(事業部|本部|部門|部)$/g, '') // サフィックス除去
        .trim();

      if (!base) return [];

      const tokens: string[] = [base]; // セグメント名全体を含める

      // 簡易分割：・ や空白で分割
      const parts = base.split(/[・\s]+/).filter(Boolean);
      tokens.push(...parts);

      // 部分語生成（2～4文字の連続部分）
      const subTokens: string[] = [];
      for (let i = 0; i < base.length; i++) {
        for (let len = 2; len <= 4 && i + len <= base.length; len++) {
          const sub = base.substring(i, i + len);
          // 日本語を含むもののみ
          if (/[一-龠ぁ-んァ-ヶ]/.test(sub)) {
            subTokens.push(sub);
          }
        }
      }
      tokens.push(...subTokens);

      // 重複除去＆上限20
      return Array.from(new Set(tokens.filter(Boolean))).slice(0, 20);
    };

    const pickKeywords = (text: string) => {
      const raw = splitTokens(text);
      const out: string[] = [];

      for (const t of raw) {
        if (t.length < 2 || t.length > 12) continue;
        if (STOP_WORDS.has(t)) continue;
        // 記号だらけは除外、日本語を含むもののみ
        if (!/[一-龠ぁ-んァ-ヶ]/.test(t)) continue;
        out.push(t);
      }
      return Array.from(new Set(out));
    };

    const normalizeLoose = (s: string) =>
      (s ?? '')
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[・･]/g, '・')
        .replace(/(事業部|本部|部門|部)$/g, '')
        .trim();

    // ★新規: SEGMENT_GUARD 用正規化（allowed name チェック）
    const normalizeForGuard = (s: string): string =>
      (s ?? '')
        .toLowerCase()
        .replace(/\s+/g, '')           // スペース除去
        .replace(/[　\s]/g, '')         // 全角スペース除去
        .replace(/[・・\-\/_]/g, '')    // 記号除去（・ / - など）
        .replace(/(事業部|本部|部門|部)$/g, '') // サフィックス除去
        .trim();

    // ★新規: OpenAI JSON呼び出し（リトライ機能付き）
    // ★ TASK 0: function 宣言に変更（hoisted）→ TDZ バグ修正
    async function callOpenAIJsonWithRetry(
      prompt: string,
      systemMessage: string,
      retryKey?: string,
      temperature?: number,
      maxTokens?: number
    ): Promise<string> {
      const MAX_RETRIES = 2; // 2回リトライ = 最大3回試行
      const BACKOFFS = [300, 600]; // ms
      const temp = temperature ?? 0.2;
      const tokens = maxTokens ?? 1000;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL ?? 'gpt-4o',
            response_format: { type: 'json_object' },
            temperature: temp,
            max_tokens: tokens,
            messages: [
              { role: 'system', content: systemMessage },
              { role: 'user', content: prompt },
            ],
          });

          return completion.choices?.[0]?.message?.content ?? '';
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const isNetworkError =
            errMsg.includes('fetch failed') ||
            errMsg.includes('UND_ERR_SOCKET') ||
            errMsg.includes('SocketError') ||
            errMsg.includes('socket');

          if (isNetworkError && attempt < MAX_RETRIES) {
            const backoffMs = BACKOFFS[attempt];
            console.warn(
              `[cascade][openai][retry] ${retryKey ?? 'call'} attempt=${attempt + 1} backoff=${backoffMs}ms error="${errMsg.slice(0, 80)}"`
            );
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            continue;
          }

          // リトライ不可またはリトライ回数超過
          throw err;
        }
      }

      throw new Error('callOpenAIJsonWithRetry: max retries exceeded');
    }

    // ★ TASK 3: 類似度計算用の title 正規化
    const normalizeTitleForSim = (title: string): string => {
      return (title ?? '')
        .toLowerCase()
        .replace(/\[ai#\d+\]\s*/i, '') // [AI#1] を除去
        .replace(/^[^：:]+[：:]\s*/, '') // 部門名prefix を除去
        .replace(/[【】「」（）『』\[\]()・：:—\-\s]/g, '') // 記号を除去
        .trim();
    };

    const STRATEGY_GENERIC_TITLE_PATTERNS = [
      /顧客.*(満足|サポート).*向上/,
      /新規.*(顧客|市場).*開拓/,
      /デジタル.*マーケ/,
      /製品.*品質.*改善/,
      /業務.*効率化/,
      /DX.*推進/i,
      /サービス.*拡充/,
      /売上.*向上/,
      /収益性.*改善/,
      /商談設計力.*強化/,
      /次世代サービス.*仮説検証/,
    ];

    const STRATEGY_TERM_STOP_WORDS = new Set([
      '現在', '当社', '市場', '顧客', '部品', '製品', '事業', '部門', '戦略', '成長', '投資', '改善',
      '競争', '環境', '変化', '価値', '必要', '重要', '実現', '強化', '検討', '対応', '全社',
      '利益', '売上', '課題', '関係', '技術力', '可能', '期待', '社員', '社会', '企業',
    ]);

    const normalizeStrategyText = (s: string): string =>
      (s ?? '')
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[　「」『』【】（）()\[\]、。，．・･:：;；/／\\\-ー〜~]/g, '');

    const extractStrategyTerms = (story: string, deptTexts: string[] = []): string[] => {
      const source = [story, ...deptTexts].filter(Boolean).join('\n');
      const terms = new Set<string>();
      const highSignalTerms = new Set<string>();

      const add = (term: string, highSignal = false) => {
        const clean = String(term ?? '')
          .trim()
          .replace(/^[のをがはにへでとや、。，．・･:：;；「」『』【】（）()\[\]\s]+/g, '')
          .replace(/[のをがはにへでとや、。，．・･:：;；「」『』【】（）()\[\]\s]+$/g, '');
        if (!clean) return;
        if (clean.length < 2 || clean.length > 22) return;
        if (STRATEGY_TERM_STOP_WORDS.has(clean)) return;
        if (/^[0-9０-９]+$/.test(clean)) return;
        if (/^(主要顧客|既存顧客|新規顧客|重点顧客|対象市場|新規市場|顧客価値|成長領域|競争環境|高付加価値)$/.test(clean)) return;
        terms.add(clean);
        if (highSignal) highSignalTerms.add(clean);
      };

      for (const m of source.matchAll(/\b[A-Z][A-Z0-9+&./-]{1,}\b/g)) add(m[0], true);

      const suffixes = [
        '市場', '領域', '用途', '顧客', 'カメラ', 'モジュール', 'ユニット', 'モータ', 'ロボット', 'ドローン',
        '機器', '部品', '加工', '金型', '技術', '量産', '安全性', '信頼性', '精度', '制御', '設計段階',
        '自動運転', '資本効率', '投下資本', '主導権', '高付加価値',
      ];

      const chunks = source
        .split(/[\n\r\t\s、。，．；;：:（）()\[\]【】「」『』]+|(?:として|における|において|向けの|向けに|向けへ|から|では|には|とは|へと|など|より|まで|は|を|が|に|へ|で|と|や)/g)
        .map((s) => s.trim())
        .filter(Boolean);

      for (const chunk of chunks) {
        if (chunk.length < 2 || chunk.length > 24) continue;
        if (chunk.includes('・') && /[A-Z]{2,}/.test(chunk)) {
          for (const part of chunk.split('・')) add(part, true);
        }
        if (suffixes.some((suffix) => chunk.endsWith(suffix))) add(chunk, true);
        if (chunk.endsWith('向け')) add(chunk, true);
        for (const suffix of suffixes) {
          const suffixPattern = new RegExp(`[一-龠ぁ-んァ-ヶA-Za-z0-9・ー]{2,14}${suffix}`, 'g');
          for (const m of chunk.matchAll(suffixPattern)) add(m[0], true);
        }
      }

      for (const m of source.matchAll(/[一-龠ぁ-んァ-ヶA-Za-z0-9・ー]{2,18}向け/g)) add(m[0], true);
      for (const m of source.matchAll(/[一-龠ぁ-んァ-ヶA-Za-z0-9・ー]{2,18}から[一-龠ぁ-んァ-ヶA-Za-z0-9・ー]{2,18}へ/g)) add(m[0], true);
      for (const m of source.matchAll(/[一-龠ぁ-んァ-ヶA-Za-z0-9・ー]{1,18}AI[一-龠ぁ-んァ-ヶA-Za-z0-9・ー]{0,12}/g)) add(m[0], true);
      for (const m of source.matchAll(/AI[一-龠ぁ-んァ-ヶA-Za-z0-9・ー]{1,18}/g)) add(m[0], true);

      return Array.from(new Set([...highSignalTerms, ...terms]))
        .sort((a, b) => {
          const ah = highSignalTerms.has(a) ? 1 : 0;
          const bh = highSignalTerms.has(b) ? 1 : 0;
          if (ah !== bh) return bh - ah;
          return b.length - a.length;
        })
        .slice(0, 40);
    };

    const strategyTerms = extractStrategyTerms(
      [
        finalStoryText || storyText || '',
        stage3BridgeText || '',
      ].filter(Boolean).join('\n'),
      Array.isArray(departments)
        ? departments.map((d: any) => [
            pickName(d),
            d?.direction,
            d?.expectations,
            ...(Array.isArray(d?.focusThemes) ? d.focusThemes : []),
            ...(Array.isArray(d?.constraints) ? d.constraints : []),
          ].filter(Boolean).join(' '))
        : []
    );

    console.log('[cascade][strategy-grounding][terms]', {
      count: strategyTerms.length,
      sample: strategyTerms.slice(0, 20),
    });

    const projectHasStrategyTerm = (project: any): { ok: boolean; matched?: string } => {
      if (strategyTerms.length === 0) return { ok: true };
      const blob = normalizeStrategyText(`${project?.title ?? ''} ${project?.reason ?? ''} ${project?.hypothesis ?? ''}`);
      for (const term of strategyTerms) {
        const nt = normalizeStrategyText(term);
        if (nt && blob.includes(nt)) return { ok: true, matched: term };
      }
      return { ok: false };
    };

    const pickProjectStrategyTerm = (project: any): string => {
      const blob = `${project?.title ?? ''} ${project?.reason ?? ''} ${project?.hypothesis ?? ''}`;
      const normalizedBlob = normalizeStrategyText(blob);
      const matched = strategyTerms.find((term) => {
        const nt = normalizeStrategyText(term);
        return nt && normalizedBlob.includes(nt);
      });
      if (matched) return matched;

      const titleBody = String(project?.title ?? '')
        .replace(/^[^：:]+[：:]\s*/, '')
        .replace(/プロジェクト|強化|開発|推進|検証|戦略|改善|向上/g, '')
        .trim();
      const fallback = titleBody
        .split(/[、。，．・･\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2 && s.length <= 18 && !STRATEGY_TERM_STOP_WORDS.has(s))[0];
      return fallback || strategyTerms[0] || '重点テーマ';
    };

    const isGenericKpiLabel = (label: string, projectTerm: string): boolean => {
      const text = String(label ?? '');
      const normalized = normalizeStrategyText(text);
      const term = normalizeStrategyText(projectTerm);
      if (term && normalized.includes(term)) return false;
      return /営業人日|有効商談|高付加価値提案|平均受注単価|対象業務プロセス|重点顧客|重点案件|新規市場|顧客満足|プロセス改善|導入検討案件|商談化率/.test(text);
    };

    const buildStrategicKpiLabels = (project: any, laneType?: CascadeLaneType | string): string[] => {
      const term = pickProjectStrategyTerm(project);
      const title = String(project?.title ?? '');
      if (laneType === 'intraCollab') {
        return [
          `${term}要求の営業・技術共同仕様化件数（件/月）`,
          `${term}案件の共同レビュー実施件数（件/月）`,
          `${term}提案から仕様回答までの期間（日）`,
        ];
      }
      if (laneType === 'interCollab') {
        return [
          `${term}共同検証テーマ数（件）`,
          `${term}共同試作・PoC完了件数（件）`,
          `${term}共同提案先候補数（社）`,
        ];
      }
      if (laneType === 'new' || /新規|探索|医療|ロボット|ドローン|PoC|仮説/.test(title)) {
        return [
          `${term}用途仮説の検証完了件数（件）`,
          `${term}試作・PoC完了件数（件）`,
          `${term}顧客評価フィードバック取得件数（件）`,
        ];
      }
      if (/品質|信頼|高性能|高精度|量産|ADAS|DMS|車載|光学|モータ|加工|ユニット/.test(title)) {
        return [
          `${term}重点案件の設計段階提案件数（件）`,
          `${term}試作・性能評価の初回適合率（%）`,
          `${term}量産立ち上げマイルストーン達成率（%）`,
        ];
      }
      return [
        `${term}重点案件の具体提案件数（件）`,
        `${term}要求仕様の初回充足率（%）`,
        `${term}提案から受注判断までの期間（日）`,
      ];
    };

    const applyStrategicKpiGrounding = (project: any, laneType?: CascadeLaneType | string): void => {
      if (!project || !Array.isArray(project.okrs) || project.okrs.length === 0) return;
      const term = pickProjectStrategyTerm(project);
      for (const okr of project.okrs) {
        const rawKrs = Array.isArray(okr?.keyResults) ? okr.keyResults : [];
        const labels = rawKrs.map((kr: any) => typeof kr === 'string' ? kr : String(kr?.label ?? ''));
        const shouldReplace =
          labels.length < 3 ||
          labels.some((label: string) => isGenericKpiLabel(label, term)) ||
          labels.every((label: string) => !normalizeStrategyText(label).includes(normalizeStrategyText(term)));
        if (!shouldReplace) continue;

        okr.keyResults = buildStrategicKpiLabels(project, laneType).map((label) => ({
          label,
          current: null,
          target: null,
          unit: label.match(/（([^）]+)）/)?.[1] ?? null,
          due: null,
        }));
        (project as any)._krSource = 'STRATEGY_TEMPLATE';
        (project as any)._krReason = 'strategy_grounded_rewrite';
        (project as any)._krSourceDetail = `strategy-term:${term}`;
      }
    };

    const isGenericStrategyTitle = (title: string): boolean => {
      const body = String(title ?? '').replace(/^[^：:]+[：:]\s*/, '').trim();
      if (!body) return true;
      const hasSpecificTerm = projectHasStrategyTerm({ title: body }).ok;
      return STRATEGY_GENERIC_TITLE_PATTERNS.some((re) => re.test(body)) && !hasSpecificTerm;
    };

    const collectLaneProjects = (dept: any): Array<{ laneType: CascadeLaneType; slot: number; index: number; project: any }> => {
      const out: Array<{ laneType: CascadeLaneType; slot: number; index: number; project: any }> = [];
      const lanes: Array<{ key: CascadeLaneType; baseSlot: number }> = [
        { key: 'existing', baseSlot: 1 },
        { key: 'new', baseSlot: 3 },
        { key: 'intraCollab', baseSlot: 4 },
        { key: 'interCollab', baseSlot: 5 },
      ];
      for (const lane of lanes) {
        const arr = dept?.lanes?.[lane.key]?.projects;
        if (!Array.isArray(arr)) continue;
        arr.forEach((project: any, index: number) => {
          out.push({
            laneType: lane.key,
            slot: lane.key === 'existing' ? index + 1 : lane.baseSlot + index,
            index,
            project,
          });
        });
      }
      return out;
    };

    const validateStrategyGrounding = (project: any): { ok: boolean; reasons: string[]; matched?: string } => {
      const reasons: string[] = [];
      const title = String(project?.title ?? '');
      const termMatch = projectHasStrategyTerm(project);
      if (!termMatch.ok) reasons.push('no_strategy_term');
      if (isGenericStrategyTitle(title)) reasons.push('generic_title');
      return { ok: reasons.length === 0, reasons, matched: termMatch.matched };
    };

    const isCoreStrategyLane = (laneType?: CascadeLaneType | string): boolean =>
      laneType === 'existing' || laneType === 'new';

    const strategyGroundingCheckAndRetry = async (depts: any[]): Promise<void> => {
      if (!Array.isArray(depts) || strategyTerms.length === 0) return;

      const failedProjects: Array<{
        deptIndex: number;
        deptName: string;
        laneType: CascadeLaneType;
        slot: number;
        index: number;
        project: any;
        reasons: string[];
      }> = [];

      for (let dIdx = 0; dIdx < depts.length; dIdx++) {
        const dept = depts[dIdx];
        const deptName = dept?.name ?? `dept_${dIdx}`;
        for (const item of collectLaneProjects(dept)) {
          if (!isCoreStrategyLane(item.laneType)) continue;
          const validation = validateStrategyGrounding(item.project);
          if (!validation.ok) {
            failedProjects.push({
              deptIndex: dIdx,
              deptName,
              laneType: item.laneType,
              slot: item.slot,
              index: item.index,
              project: item.project,
              reasons: validation.reasons,
            });
          }
        }
      }

      if (failedProjects.length === 0) return;

      console.warn('[cascade][strategy-grounding][ng]', failedProjects.map((p) => ({
        dept: p.deptName,
        slot: p.slot,
        lane: p.laneType,
        title: p.project?.title,
        reasons: p.reasons,
      })));

      const allowedTermsText = strategyTerms.slice(0, 28).map((t) => `- ${t}`).join('\n');

      for (const failed of failedProjects.slice(0, 12)) {
        const factPack = factPackByDept.get(failed.deptName);
        const strategyRetryAnchors = (factPack?.anchors ?? []).slice(0, 12);
        const anchorsText = strategyRetryAnchors
          .map((a: any) => `- ${a.id}: ${a.text}`)
          .join('\n');
        const requiredCitationCount = Math.min(2, strategyRetryAnchors.length);
        const laneLabel =
          failed.laneType === 'existing' ? (failed.slot === 1 ? '既存深掘' : '既存進化') :
          failed.laneType === 'new' ? '新規探索' :
          failed.laneType === 'intraCollab' ? '事業部内連携' :
          '事業部間連携';

        const retryPrompt = `
前回のSTAGE3プロジェクト案は、STAGE2最終ストーリーとの接続が弱い、または汎用タイトルです。
以下の条件で、この1件だけを再生成してください。

対象部門: ${failed.deptName}
対象類型: ${laneLabel}

【STAGE2最終ストーリー】
${sanitizeText(finalStoryText || storyText || '', 2200)}

【必ず使う具体語候補（この中から title に最低1語、reason/hypothesis に合計2語以上）】
${allowedTermsText || '（具体語候補なし）'}

【FACTPACK anchors】
${anchorsText || '（利用可能なanchorsなし）'}

【前回の不合格理由】
${failed.reasons.join(', ')}

【前回案】
${JSON.stringify(failed.project, null, 2)}

【厳守条件】
1. title は「${failed.deptName}：」で始め、上記の具体語候補を最低1語含める。
2. 「顧客サポート向上」「製品品質改善」「新規市場開拓」「デジタルマーケティング」「業務効率化」などの汎用タイトルは禁止。
3. reason/hypothesis は、STAGE2最終ストーリーのどの変化をこの部門が実装するのかを書く。
4. citations はFACTPACK anchorsから${requiredCitationCount}個。reason/hypothesisにも同じ件数だけ「text」(fact-id) 形式で引用を入れる。anchorが0件なら citations=[] とし、fact-idを創作しない。
5. JSONのみ返す。

{
  "title": "...",
  "reason": "...",
  "hypothesis": "...",
  "mainLever": "ACQ" | "ARPU" | "CHURN" | "COST" | "EFFICIENCY" | "FUTURE",
  "horizon": "short" | "mid" | "long",
  "kind": "growth" | "cost" | "efficiency" | "future",
  "citations": ${requiredCitationCount === 0 ? '[]' : requiredCitationCount === 1 ? '["fact-..."]' : '["fact-...", "fact-..."]'},
  "valueDriverLinks": [...],
  "skillRequirements": {...},
  "humanInvestments": [...],
  "generatedBy": "ai",
  "generatedSlot": ${failed.slot},
  "generatedGroup": "cascade_v1"
}
`.trim();

        try {
          const retryRaw = await callOpenAIJsonWithRetry(
            retryPrompt,
            '必ずJSONのみを返し、日本語で。前後の説明は禁止。',
            `strategy-grounding-dept=${failed.deptName}-slot=${failed.slot}`,
            0.2,
            1800
          );
          const retryParsed = extractJsonObject(retryRaw);
          if (!retryParsed) {
            highRiskDepts.add(failed.deptName);
            continue;
          }

          const retrySafe = ProjectSchema.safeParse(retryParsed);
          const retryProject = retrySafe.success ? retrySafe.data : retryParsed;
          const validation = validateStrategyGrounding(retryProject);

          if (validation.ok && hasRequiredFields(retryProject)) {
            const laneProjects = depts?.[failed.deptIndex]?.lanes?.[failed.laneType]?.projects;
            if (Array.isArray(laneProjects)) {
              laneProjects[failed.index] = retryProject;
              console.log('[cascade][strategy-grounding][retry-success]', {
                dept: failed.deptName,
                slot: failed.slot,
                matched: validation.matched,
                title: retryProject?.title,
              });
            }
          } else {
            highRiskDepts.add(failed.deptName);
            console.warn('[cascade][strategy-grounding][retry-fail]', {
              dept: failed.deptName,
              slot: failed.slot,
              title: retryProject?.title,
              reasons: validation.reasons,
            });
          }
        } catch (err) {
          highRiskDepts.add(failed.deptName);
          console.warn('[cascade][strategy-grounding][retry-error]', {
            dept: failed.deptName,
            slot: failed.slot,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };

    await strategyGroundingCheckAndRetry(Array.isArray(normalized?.departments) ? normalized.departments : []);

    // ★ TASK 3: Jaccard 距離（セット類似度）
    const jaccard = (s1: string, s2: string): number => {
      const set1 = new Set((s1 ?? '').split(''));
      const set2 = new Set((s2 ?? '').split(''));
      const intersection = new Set([...set1].filter((x: string) => set2.has(x)));
      const union = new Set([...set1, ...set2]);
      if (union.size === 0) return 1; // 両方空
      return intersection.size / union.size;
    };

    const containsAny = (blob: string, tokens: string[]): string | null => {
      const b = normalizeLoose(blob);
      for (const tok of tokens) {
        const t = normalizeLoose(tok);
        if (!t) continue;
        if (b.includes(t)) return tok;
      }
      return null;
    };

    const buildForbiddenTokens = (businessSegments: any[], allowedSegName: string): string[] => {
      const allowN = normalizeLoose(allowedSegName);
      const tokens: string[] = [];

      for (const s of (businessSegments ?? []) as any[]) {
        const name = (s?.name ?? '').trim();
        if (normalizeLoose(name) === allowN) continue;

        // ★ TASK 1-B: セグメント名自体と分解語彙を追加
        tokens.push(name);
        tokens.push(...splitSegmentNameTokens(name));

        // overview と customers から語彙抽出
        const ov = (s?.overview ?? '').trim();
        const cust = (s?.mainCustomers ?? (s?.customers ?? '')).trim();
        tokens.push(...pickKeywords(ov));
        tokens.push(...pickKeywords(cust));
      }

      // 重複除去 & 上限（増えすぎ防止）
      const result = Array.from(new Set(tokens.filter(Boolean))).slice(0, 60);

      // ★ デバッグログ：トークン数確認
      if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
        console.log(`[cascade][segGuard] allowed="${allowedSegName}" forbiddenTokens.len=${result.length}`);
      }

      return result;
    };

    // ★ TASK 4: SEGMENT_GUARD soft penalty フィルタリング
    const filterForbiddenTokens = (tokens: string[]): string[] => {
      // STOP_WORDS（テンプレ語）を除外
      const filtered1 = tokens.filter((tok: string) => !STOP_WORDS_TASK3.has(tok.toLowerCase()));
      // 3文字未満を除外
      const filtered2 = filtered1.filter((tok: string) => tok.length >= 3);
      // 数字のみ を除外
      const filtered3 = filtered2.filter((tok: string) => !/^\d+$/.test(tok));
      // 記号のみ を除外（日本語/英数字を含まないもの）
      const filtered4 = filtered3.filter((tok: string) => /[一-龠ぁ-んァ-ヶa-zA-Z0-9]/.test(tok));
      return filtered4;
    };

    // ★ TASK 5: 2nd-pass 実行条件を限定（重複 OR grounding failed OR conflict failed OR high risk）
    const needsSecondPass = duplicateDeptNames.size > 0 || groundingFailedDepts.size > 0 || conflictFailedDepts.size > 0 || highRiskDepts.size > 0;
    if (needsSecondPass) {
      const reasons: string[] = [];
      if (duplicateDeptNames.size > 0) reasons.push(`duplicates: ${Array.from(duplicateDeptNames).join(',')}`);
      if (groundingFailedDepts.size > 0) reasons.push(`grounding-failed: ${Array.from(groundingFailedDepts).join(',')}`);
      if (conflictFailedDepts.size > 0) reasons.push(`conflict-failed: ${Array.from(conflictFailedDepts).join(',')}`);
      if (highRiskDepts.size > 0) reasons.push(`high-risk: ${Array.from(highRiskDepts).join(',')}`);
      console.log(`[cascade][2ndpass] 発火条件: ${reasons.join(' / ')}`);

      const titleMap = collectAllTitles(Array.isArray(normalized?.departments) ? normalized.departments : []);
      const bannedTitlesList: string[] = [];

      for (const [bt, { deptNames }] of titleMap) {
        // 複数部門で同じ baseTitle か generic の場合
        if (new Set(deptNames).size > 1 || isGeneric(bt)) {
          bannedTitlesList.push(bt);
        }
      }

      // ★設計修正①: 2nd-pass対象を union 化（duplicates/grounding-failed/conflict-failed/high-risk）
      const secondPassTargets = new Set<string>([
        ...Array.from(duplicateDeptNames),
        ...Array.from(groundingFailedDepts),
        ...Array.from(conflictFailedDepts),
        ...Array.from(highRiskDepts),
      ]);

      // 対象部門ごとに2nd pass
      for (const targetDeptName of secondPassTargets) {
        const deptIndex = (normalized?.departments ?? []).findIndex(d => d?.name === targetDeptName);
        if (deptIndex < 0) continue;

        const dept = normalized.departments[deptIndex];
        const deptInput = departments.find(d => {
          const n = pickName(d);
          return n === targetDeptName;
        });

        if (!deptInput) continue;

        // ★ SEGMENT_GUARD: request-level allBusinessSegments を使用
        const segPool = Array.isArray(allBusinessSegments) ? (allBusinessSegments as any[]) : [];

        // allowedSegmentName を必ず埋める（空禁止）
        const allowedSegmentName =
          (typeof (deptInput as any)?.segmentName === 'string' && (deptInput as any).segmentName.trim()) ||
          targetDeptName; // 最終フォールバック：部門名

        const forbiddenSegmentNames = segPool
          .map((s: any) => (s?.name ?? '').trim())
          .filter((n: string) => n && normalizeLoose(n) !== normalizeLoose(allowedSegmentName));

        // ★ TASK 1: forbiddenTokens を他セグメント語彙から構築（segPool ベース）
        const forbiddenTokens = buildForbiddenTokens(segPool, allowedSegmentName);

        // 2nd pass用プロンプト作成（元のdeptBlocks生成ロジックを再利用）
        const secondPassDeptBlock = (() => {
          const name = targetDeptName;
          const answers = pickDeptAnswers6(deptInput) as Array<{ stepNumber: number; answer?: string; label?: string }>;
          const answersText = (answers || [])
            .sort((a, b) => (a?.stepNumber || 0) - (b?.stepNumber || 0))
            .slice(0, 6)
            .map((a) => `Q${a.stepNumber}${a.label ? `(${a.label})` : ''}: ${String(a.answer || '')}`)
            .join('\n');

          const focusThemesArr = ((deptInput?.focusThemes || []) as any[]);
          const constraintsArr = ((deptInput?.constraints || []) as any[]);
          const focusThemes = focusThemesArr.slice(0, 3).join('、');
          const constraints = constraintsArr.slice(0, 2).join('、');

          let segBlock = '';
          if (Array.isArray(segPool) && segPool.length > 0) {
            const segmentInfo = segPool
              .slice(0, 5)
              .map((s: any) => {
                const segName = (s?.name ?? '').trim();
                const segOverview = (s?.overview ?? '').trim().slice(0, 200);
                const segPL = (s as any)?.segmentPL;
                const plStr = segPL
                  ? ` / PL: ${segPL?.revenue ?? 0}円(売上), ${segPL?.COGS ?? 0}円(原価), ${segPL?.operatingProfit ?? 0}円(営利)`
                  : '';
                return `- ${segName}${plStr}${segOverview ? ` / ${segOverview}` : ''}`;
              })
              .join('\n');

            segBlock = `\n[SEGMENT]\n${segmentInfo}`;
          }

          const deptName = name;
          const uniquenessRule = `
[UNIQUENESS_CONSTRAINT - 2ND PASS]
- ★前回生成したタイトルと異なるプロジェクト案を生成する（必須）
- 禁止タイトル: ${bannedTitlesList.map(t => `"${t}"`).join(', ')}
- 新しいプロジェクト案は、別の"顧客層"、"価値提案"、"KPI" の組み合わせを使用すること
- ★[SEGMENT]、[質問への回答]、【STAGE2最終ストーリー】に実際に登場する固有名詞だけをtitleに含めること。ここに存在しない市場名・顧客名・用途名は創作しないこと
- existing lane の各プロジェクト title は必ず "${deptName}：" で始まり、[SEGMENT] から抽出した顧客層・対象市場を含める
- new lane の各プロジェクト title も必ず "${deptName}：" で始まり、[SEGMENT] から抽出した顧客層・対象市場を含める
- hypothesis と reason には、必ず [SEGMENT] の要素（customers / overview）を最低1つ引用して根拠にする

[SEGMENT_GUARD - セグメント汚染防止]
- ★ このセグメント専用：${allowedSegmentName || '（指定なし）'}
- ★ 禁止セグメント：${forbiddenSegmentNames.length > 0 ? forbiddenSegmentNames.map(s => `"${s}"`).join(', ') : '（なし）'}
- ★ 禁止語彙（他セグメントから）：${forbiddenTokens.slice(0, 20).map(t => `"${t}"`).join(', ')}
- [SEGMENT]語彙以外を使用禁止（他セグメント名や語彙は絶対に含めるな）
- title / hypothesis / reason のどこにも、禁止セグメント名・禁止語彙を含めたら失格
- 必ず allowed セグメント（${allowedSegmentName || '（指定なし）'}）の語彙のみを使用すること`;

          return `
[部門] ${name}

[質問への回答]
${answersText}

[既存事業の焦点]
${focusThemes}

[制約条件]
${constraints}
${segBlock}
${uniquenessRule}
`.trim();
        })();

        const secondPassPrompt = `以下の ${targetDeptName} 部門について、前回とは異なるプロジェクト案を生成してください。

【STAGE2最終ストーリー】
${sanitizeText(finalStoryText || storyText || '', 2200)}

【必ず反映する具体語候補】
${strategyTerms.slice(0, 28).map((t) => `- ${t}`).join('\n') || '（具体語候補なし）'}

${secondPassDeptBlock}

【STAGE2接続ルール】
- project.title は上記の具体語候補、または[SEGMENT]/[質問への回答]に実在する具体語を最低1つ含める。
- 「顧客サポート向上」「製品品質改善」「新規市場開拓」「デジタルマーケティング」「業務効率化」だけの汎用タイトルは禁止。
- reason/hypothesis は、STAGE2最終ストーリーのどの変化をこの部門が実装するのかを書く。

# 出力形式（前回と同じ）
{
  "departments": [
    {
      "name": "${targetDeptName}",
      "missionDraft": "...",
      "missionDescription": "...",
      "lanes": {
        "existing": {
          "projects": [
            { "title": "...", "hypothesis": "...", "reason": "...", ... },
            { "title": "...", "hypothesis": "...", "reason": "...", ... }
          ]
        },
        "new": {
          "projects": [
            { "title": "...", "hypothesis": "...", "reason": "...", ... }
          ]
        }
      },
      ...
    }
  ]
}`.trim();

        // ★ TASK 2: 2nd-pass結果の検証関数（語彙混入検知）
        const validateSecondPassWithTokens = (
          deptName: string,
          allowedSegName: string,
          segs: any[],
          secondDept: any,
          bannedSegmentNames?: string[]
        ): { valid: boolean; riskScore?: number; hitTokens?: string[] } => {
          const rawTokens = buildForbiddenTokens(segs, allowedSegName);
          // ★ TASK 4: soft penalty フィルタリング（STOP_WORDS/3文字未満/数字のみ/記号のみ除外）
          const forbiddenFiltered = filterForbiddenTokens(rawTokens);

          // ★修正1: allowed name に含まれるトークンを除外（完全一致のみ）
          // ★バグ修正④: includes禁止 → 完全一致のみ除外（部分一致による検知漏れを防ぐ）
          const allowedNorm = normalizeForGuard(allowedSegName);
          const forbiddenUniq = Array.from(new Set(forbiddenFiltered)).filter((t: string) => {
            const tn = normalizeForGuard(t);
            if (!tn) return false;
            return tn !== allowedNorm; // 完全一致のみ除外
          });

          // ★ TASK 1-C: tokens が弱くても forbiddenSegmentNames との合算で検知対象を確保
          // tokens < 5 でも reject しない。最低でも「他セグメント名」が入るため混入検知は成立
          let checkTokens = forbiddenUniq;
          if ((!forbiddenUniq || forbiddenUniq.length < 5) && bannedSegmentNames && bannedSegmentNames.length > 0) {
            checkTokens = Array.from(new Set([...forbiddenUniq, ...bannedSegmentNames]));
            console.log(
              `[cascade][dup] tokens_weak但し回避可能: dept="${deptName}" tokens.len=${forbiddenUniq?.length ?? 0} segs=${bannedSegmentNames?.length ?? 0}`
            );
          }

          const allProjects = [
            ...(secondDept?.lanes?.existing?.projects ?? []),
            ...(secondDept?.lanes?.new?.projects ?? []),
            ...(secondDept?.projects ?? []),
          ];

          // ★修正2: TASK 4 soft penalty ロジック（ユニーク違反トークン数 = riskScore）
          const hits = new Set<string>(); // ユニーク化用Set
          const RISK_THRESHOLD = 2;

          for (const proj of allProjects) {
            const blob = `${proj?.title ?? ''} ${proj?.reason ?? ''} ${proj?.hypothesis ?? ''}`;
            const hit = containsAny(blob, checkTokens);
            if (hit) {
              hits.add(hit); // 同じトークンは1点のみ
            }
          }

          const riskScore = hits.size; // ユニークなトークン数
          const hitTokens = Array.from(hits);

          // ★デバッグログ：ユニークなトークンのみ出力
          for (const t of hits) {
            console.log(`[cascade][guard][risk] token="${t}" riskScore=${riskScore} dept="${deptName}"`);
          }

          // riskScore が閾値以上なら valid=false
          if (riskScore >= RISK_THRESHOLD) {
            console.log(`[cascade][dup][rejected] dept="${deptName}" riskScore=${riskScore} >= RISK_THRESHOLD`);
            return { valid: false, riskScore, hitTokens };
          }

          console.log(`[cascade][dup][accepted] dept="${deptName}" riskScore=${riskScore}`);
          return { valid: true, riskScore };
        };

        // 2nd pass LLM呼び出し
        try {
          // ★修正3: OpenAI リトライ機能を使用（fetch failed/UND_ERR_SOCKET 対策）
          const secondRawContent = await callOpenAIJsonWithRetry(
            secondPassPrompt,
            '必ずJSONのみを返し、日本語で。前後の説明は禁止。',
            `2ndpass-dept=${targetDeptName}`,
            0.35, // temperature for 2nd pass
            1500  // maxTokens for 2nd pass
          );
          const secondParsed = extractJsonObject(secondRawContent);

          if (secondParsed && Array.isArray(secondParsed?.departments) && secondParsed.departments.length > 0) {
            const secondDept = secondParsed.departments[0];

            // ★ TASK 2: 語彙混入検知検証（bannedSegmentNames 与えてトークン不足時も対応）
            const validation = validateSecondPassWithTokens(targetDeptName, allowedSegmentName, segPool, secondDept, forbiddenSegmentNames);

            if (validation.valid) {
              // 2nd passの結果で置き換え
              if (secondDept?.lanes?.existing || secondDept?.lanes?.new) {
                normalized.departments[deptIndex].lanes = secondDept.lanes;
              }
              if (secondDept?.missionDescription) {
                normalized.departments[deptIndex].missionDescription = secondDept.missionDescription;
              }
            } else {
              // ★設計修正②: reject時に highRiskDepts を追加
              highRiskDepts.add(targetDeptName);
              console.log(`[cascade][dup][reject] dept="${targetDeptName}" riskScore=${validation.riskScore} hitTokens=${validation.hitTokens?.join(',')}`);
            }
          }
        } catch (err: any) {
          console.warn(`[cascade][dup] 2nd pass失敗 (${targetDeptName}):`, err?.message);
          // 失敗時は1st passの結果をそのまま使用
        }
      }
    }

    /* =========================
     * ★STAGE3フィールドの補完（fallback）
     * ======================= */

    function inferProjectArchetype(project: any, deptName: string, lane: string): string {
      const title = (project?.title ?? '').toLowerCase();
      const hypothesis = (project?.hypothesis ?? '').toLowerCase();
      const kind = project?.kind ?? '';
      const mainLever = project?.mainLever ?? '';

      if (title.includes('品質') || title.includes('テスト') || hypothesis.includes('品質') || hypothesis.includes('不具合')) return 'quality';
      if (title.includes('自動化') || title.includes('効率化') || hypothesis.includes('自動化') || kind === 'efficiency') return 'automation';
      if (title.includes('営業') || title.includes('販売') || deptName.includes('営業') || mainLever === 'ACQ') return 'sales';
      if (title.includes('新規') || title.includes('事業') || kind === 'future' || lane === 'new') return 'new_business';
      if (title.includes('データ') || title.includes('分析') || title.includes('it') || hypothesis.includes('データ')) return 'data_it';
      if (title.includes('組織') || title.includes('人事') || title.includes('育成') || deptName.includes('人事')) return 'org_hr';
      if (title.includes('コスト') || title.includes('削減') || kind === 'cost') return 'cost';
      if (title.includes('マーケ') || title.includes('広告') || deptName.includes('マーケ')) return 'marketing';

      return 'general';
    }

    function getSkillsAndInvestmentsByArchetype(archetype: string): {
      executionSkills: string[];
      roleSkills: string[];
      investments: any[];
    } {
      const templates: Record<string, any> = {
        quality: {
          executionSkills: ['品質管理', '検証力', '改善運用'],
          roleSkills: ['QAエンジニア'],
          investments: [
            { category: 'TRAINING_OJT', title: '品質管理研修', detail: 'テスト設計と品質保証の実践トレーニング', owner: '', horizon: '0_3M' },
            { category: 'TOOLS_PROCESS', title: '検証ツール導入', detail: '自動テストツールとCI/CD環境の整備', owner: '', horizon: '3_6M' },
          ],
        },
        automation: {
          executionSkills: ['自動化設計', 'プロセス標準化', 'データ活用'],
          roleSkills: ['エンジニア'],
          investments: [
            { category: 'TOOLS_PROCESS', title: '業務自動化ツール導入', detail: 'RPA・ワークフロー自動化の環境構築', owner: '', horizon: '0_3M' },
            { category: 'TRAINING_OJT', title: '効率化ワークショップ', detail: '業務プロセス分析と改善手法の習得', owner: '', horizon: '3_6M' },
          ],
        },
        sales: {
          executionSkills: ['顧客要求整理', '技術提案', 'PM'],
          roleSkills: ['営業', 'セールス'],
          investments: [
            { category: 'TRAINING_OJT', title: '要求定義OJT', detail: '重点顧客の要求を技術仕様に落とし込む実践訓練', owner: '', horizon: '0_3M' },
            { category: 'TOOLS_PROCESS', title: '案件レビュー基盤', detail: '重点案件の要求・仕様・採算を横断確認する仕組み', owner: '', horizon: '3_6M' },
          ],
        },
        new_business: {
          executionSkills: ['事業開発', '仮説検証', 'MVP設計'],
          roleSkills: ['プロダクトマネジャー'],
          investments: [
            { category: 'HIRING', title: 'プロダクトマネジャー採用', detail: '新規事業推進のための専門人材獲得', owner: '', horizon: '3_6M' },
            { category: 'EXTERNAL', title: 'MVP開発パートナー契約', detail: '迅速な仮説検証のための外部リソース活用', owner: '', horizon: '0_3M' },
          ],
        },
        data_it: {
          executionSkills: ['データ分析', 'システム設計', '標準化'],
          roleSkills: ['データアナリスト', 'エンジニア'],
          investments: [
            { category: 'TOOLS_PROCESS', title: 'データ基盤構築', detail: 'BI・分析環境の整備とデータ統合', owner: '', horizon: '3_6M' },
            { category: 'TRAINING_OJT', title: 'データ活用研修', detail: 'SQL・分析手法の実践トレーニング', owner: '', horizon: '0_3M' },
          ],
        },
        org_hr: {
          executionSkills: ['育成設計', '組織開発', 'ファシリテーション'],
          roleSkills: ['人事', 'HRビジネスパートナー'],
          investments: [
            { category: 'TRAINING_OJT', title: 'マネジメント研修', detail: 'リーダーシップと育成スキルの強化', owner: '', horizon: '0_3M' },
            { category: 'ALLOCATION', title: '人材配置最適化', detail: 'スキルマトリクスに基づく適材適所の実現', owner: '', horizon: '3_6M' },
          ],
        },
        cost: {
          executionSkills: ['コスト分析', '調達力', '標準化'],
          roleSkills: ['経営企画', '調達'],
          investments: [
            { category: 'TOOLS_PROCESS', title: 'コスト管理システム導入', detail: '経費可視化と予実管理の効率化', owner: '', horizon: '3_6M' },
            { category: 'TRAINING_OJT', title: 'コスト削減ワークショップ', detail: 'ムダ発見と改善提案の手法習得', owner: '', horizon: '0_3M' },
          ],
        },
        marketing: {
          executionSkills: ['市場要求分析', '顧客価値設計', 'データ活用'],
          roleSkills: ['事業開発', '営業企画'],
          investments: [
            { category: 'TOOLS_PROCESS', title: '市場仮説検証基盤', detail: '入力本文にある重点市場・用途の要求仮説を検証する仕組み', owner: '', horizon: '3_6M' },
            { category: 'TRAINING_OJT', title: '顧客価値設計OJT', detail: '重点用途の顧客価値を言語化し、提案仮説に落とし込む訓練', owner: '', horizon: '0_3M' },
          ],
        },
        general: {
          executionSkills: ['PM', '改善運用', '標準化'],
          roleSkills: [],
          investments: [
            { category: 'TRAINING_OJT', title: 'プロジェクト管理研修', detail: '計画立案と進捗管理スキルの習得', owner: '', horizon: '0_3M' },
            { category: 'TOOLS_PROCESS', title: '業務標準化の仕組み整備', detail: '効率的な実行を支援するプロセス導入', owner: '', horizon: '3_6M' },
          ],
        },
      };

      return templates[archetype] || templates['general'];
    }

    function fillMissingStage3Fields(project: any, availableKPIs: any[], deptName: string = '', lane: string = ''): void {
      // 1. valueDriverLinks の補完
      if (!project.valueDriverLinks || project.valueDriverLinks.length === 0) {
        if (availableKPIs && availableKPIs.length > 0) {
          project.valueDriverLinks = availableKPIs
            .slice(0, 2)
            .map((kpi: any) => kpi.id)
            .filter(Boolean);
        } else {
          project.valueDriverLinks = [];
        }
      }

      const archetype = inferProjectArchetype(project, deptName, lane);
      const template = getSkillsAndInvestmentsByArchetype(archetype);

      // 2. skillRequirements の補完
      if (!project.skillRequirements) project.skillRequirements = {};
      if (!project.skillRequirements.executionSkills || project.skillRequirements.executionSkills.length === 0) {
        project.skillRequirements.executionSkills = template.executionSkills.slice(0, 2);
      }
      if (!project.skillRequirements.roleSkills) {
        project.skillRequirements.roleSkills = template.roleSkills;
      }

      // 3. humanInvestments の補完
      if (!project.humanInvestments || project.humanInvestments.length === 0) {
        project.humanInvestments = template.investments;
      }
    }

    if (Array.isArray(normalized?.departments)) {
      for (const dept of normalized.departments) {
        const deptName = dept?.name ?? '';

        if (dept?.lanes?.existing?.projects) {
          for (const proj of dept.lanes.existing.projects) fillMissingStage3Fields(proj, valueDriverKPIs, deptName, 'existing');
        }
        if (dept?.lanes?.new?.projects) {
          for (const proj of dept.lanes.new.projects) fillMissingStage3Fields(proj, valueDriverKPIs, deptName, 'new');
        }
        if (Array.isArray(dept?.projects)) {
          for (const proj of dept.projects) fillMissingStage3Fields(proj, valueDriverKPIs, deptName, '');
        }
      }
    }

    const inputNames = new Set(onlyDeptNames(departments));

    const deptInputByName = new Map<string, any>();
    for (const d of departments) {
      const name = pickName(d);
      if (!name) continue;
      deptInputByName.set(name, d);
    }

    const result = {
      strategy: {
        summary:
          typeof normalized?.strategy?.summary === 'string' && normalized.strategy.summary.trim()
            ? normalized.strategy.summary.trim()
            : summary,
      },
      departments: (() => {
        // ★ FIX2: LLM/JSONパース結果が departments: [] になった場合でも、
        // リクエストで指定された部門を起点に最低限のたたき台を返す。
        // これによりフロント側の「この部門のたたき台が取得できませんでした」を防ぐ。
        const sourceDepartments =
          Array.isArray(normalized?.departments) && normalized.departments.length > 0
            ? normalized.departments
            : (Array.isArray(departments) ? departments : []).map((inputDept: any) => {
                const inputName = pickName(inputDept);
                const inputProjects = Array.isArray(inputDept?.projects)
                  ? inputDept.projects
                      .map((x: any, i: number) =>
                        typeof x === 'string'
                          ? { title: x, reason: '', hypothesis: '', generatedSlot: i + 1 }
                          : x
                      )
                  : [];
                return {
                  name: inputName,
                  missionDraft: String(inputDept?.missionDraft || inputDept?.direction || `${inputName}の部門ミッション案`).trim(),
                  missionDescription: '',
                  projects: inputProjects,
                  lanes: {},
                  intraDeptCollab: [],
                  interDeptCollab: [],
                  needsCollab: [],
                  stopList: [],
                  first90Days: [],
                  riskNotes: [],
                };
              });

        if (Array.isArray(normalized?.departments) && normalized.departments.length === 0) {
          console.warn('[STAGE3][API fallback departments]', {
            reason: 'normalized.departments is empty',
            requestDepartments: (departments || []).map((d: any) => pickName(d)),
            fallbackCount: sourceDepartments.length,
          });
        }

        return sourceDepartments
            .map((d: any, deptIndex: number) => {
              // ★ A案追加後の安定化:
              // LLMが部門名を微妙に言い換えると、従来の exact match で返却対象から落ち、
              // フロント側で「この部門のたたき台が取得できませんでした」になる。
              // 返却名は入力部門名を正とし、生成内容だけ d から採用する。
              const generatedName = typeof d?.name === 'string' ? d.name.trim() : '';
              const requestedName = pickName(departments?.[deptIndex]) || generatedName;
              const name = typeof requestedName === 'string' ? requestedName.trim() : '';
              if (!name || !inputNames.has(name)) return null;

              const missionDraft = typeof d?.missionDraft === 'string' ? d.missionDraft.trim() : '';
              const lanesRaw = d?.lanes;

              const deptInput = deptInputByName.get(name);
              const answers = pickDeptAnswers6(deptInput) as Array<{ stepNumber: number; answer?: string; label?: string }>;
              const answersText = (answers || [])
                .sort((a, b) => (a?.stepNumber || 0) - (b?.stepNumber || 0))
                .slice(0, 6)
                .map((a) => `Q${a.stepNumber}${a.label ? `(${a.label})` : ''}: ${String(a.answer || '')}`)
                .join('\n');

              // ★STAGE3軽量化：OKR生成を削除、プロジェクトのみ返す
              // ★fix9: LLMが新形式 lanes ではなく旧形式 d.projects に3件返す場合がある。
              // その場合、従来品質の title/reason/hypothesis を壊さず、
              // 先頭2件を既存進化、3件目を新規探索として復元する。
              const topLevelProjects = normalizeProjects(d?.projects ?? []);
              const rawExistingLaneProjects = normalizeProjects(lanesRaw?.existing?.projects ?? []);
              const rawNewLaneProjects = normalizeProjects(lanesRaw?.new?.projects ?? []);

              const existingProjects = (
                rawExistingLaneProjects.length > 0
                  ? rawExistingLaneProjects
                  : topLevelProjects.filter((p: any) => p?.sourceType === 'existing').length > 0
                    ? topLevelProjects.filter((p: any) => p?.sourceType === 'existing')
                    : topLevelProjects.filter((p: any) => !['new', 'intraCollab', 'interCollab'].includes(String(p?.sourceType ?? ''))).slice(0, 2)
              ).slice(0, 2);

              const existingTitleSet = new Set(existingProjects.map((p: any) => normalizeName(p?.title ?? '')));
              const newProjects = (
                rawNewLaneProjects.length > 0
                  ? rawNewLaneProjects
                  : topLevelProjects.filter((p: any) => p?.sourceType === 'new').length > 0
                    ? topLevelProjects.filter((p: any) => p?.sourceType === 'new')
                    : topLevelProjects.filter((p: any) => !existingTitleSet.has(normalizeName(p?.title ?? '')) && !['intraCollab', 'interCollab'].includes(String(p?.sourceType ?? ''))).slice(0, 1)
              ).slice(0, 1);

              // ★STAGE3 A案：STEP1の連携候補を、STEP4の連携型プロジェクト候補にも昇格する
              const normalizedCollab = normalizeCollabLists(d, deptInputByName.get(name));

              // ★fix3: LLM応答やfallback部門で intraDeptCollab / interDeptCollab が空になっても、
              // STEP1の「事業部内連携1件 / 事業部間連携1件」と、STEP4の連携型プロジェクトを必ず維持する。
              // 先生指摘の「STEP1で連携案を出したなら、STEP4にも連携型PJ/KPIを出す」ための安定化。
              // ★fix5: 「この部門だけ生成」のpayloadでは departments が1件だけになる。
              // そのため、連携先を departments だけから探すと「他事業部」になり、旧版より品質が落ちる。
              // businessSegments / businessPortfolio / financeSummary からも事業部名を拾い、具体的な連携先名を維持する。
              const collectContextDeptNames = (): string[] => {
                const names: string[] = [];
                names.push(...onlyDeptNames(Array.isArray(departments) ? departments : []));
                for (const s of (Array.isArray(allBusinessSegments) ? allBusinessSegments : [])) {
                  const n = String(s?.name ?? s?.segmentName ?? s?.businessName ?? s?.departmentName ?? '').trim();
                  if (n) names.push(n);
                }
                for (const u of (Array.isArray(businessPortfolio?.units) ? businessPortfolio.units : [])) {
                  const n = String(u?.name ?? u?.segmentName ?? u?.businessName ?? u?.departmentName ?? '').trim();
                  if (n) names.push(n);
                }
                const financeRows = Array.isArray(financeSummary)
                  ? financeSummary
                  : Array.isArray(financeSummary?.rows)
                    ? financeSummary.rows
                    : [];
                for (const r of financeRows) {
                  const n = String(r?.name ?? r?.segmentName ?? r?.businessName ?? r?.departmentName ?? r?.事業部 ?? r?.事業名 ?? '').trim();
                  if (n) names.push(n);
                }
                return dedupeStrings(names).filter((n) => normalizeName(n) !== normalizeName(name));
              };
	              const allRequestedDeptNames = collectContextDeptNames();
	              const partnerDeptName = hasMultipleRequestedDepartments ? (allRequestedDeptNames[0] || '') : '';
	              const primaryStrategyTerm = strategyTerms.find((t) => /向け|ユニット|モジュール|カメラ|モータ|加工|ロボット|ドローン|自動運転|DMS|ADAS|市場|用途/.test(t)) || strategyTerms[0] || '重点テーマ';
	              const defaultIntraCollabText = `営業×技術×製造：${primaryStrategyTerm}について、営業が顧客要求を整理し、技術・製造が仕様化と量産実現性を検討して、設計段階からの提案につなげる`;
	              const defaultInterCollabText = hasMultipleRequestedDepartments && partnerDeptName
	                ? `${partnerDeptName}：${name}の顧客課題と${partnerDeptName}の技術・販路を組み合わせ、共同提案または共同検証テーマを立ち上げる`
	                : '';
	              const effectiveIntraCollab = trimList(normalizedCollab.intra, 1).length > 0
	                ? trimList(normalizedCollab.intra, 1)
	                : [defaultIntraCollabText];
	              const effectiveInterCollab = hasMultipleRequestedDepartments
	                ? (trimList(normalizedCollab.inter, 1).length > 0
	                    ? trimList(normalizedCollab.inter, 1)
	                    : (defaultInterCollabText ? [defaultInterCollabText] : []))
	                : [];
              const effectiveLegacyCollab = dedupeStrings([
                ...effectiveIntraCollab,
                ...effectiveInterCollab,
                ...trimList(normalizedCollab.legacy, 6),
              ]);

              const intraCollabProjectsFromAi = normalizeProjects(lanesRaw?.intraCollab?.projects ?? []).slice(0, 1);
	              const interCollabProjectsFromAi = hasMultipleRequestedDepartments
	                ? normalizeProjects(lanesRaw?.interCollab?.projects ?? []).slice(0, 1)
	                : [];

              // ★致命修正: fallback anchors ヘルパー関数
              const pickFallbackAnchors = () => {
                const fp = factPackByDept.get(name);
                const anchors = Array.isArray(fp?.anchors) ? fp.anchors : [];
                return anchors.slice(0, 2);
              };

              const buildFallbackGroundedText = (base: string) => {
                // 画面には fact-seg-* などの内部根拠IDを出さない。
                // 根拠IDは citations に保持し、説明文はユーザーに読める文章だけにする。
                return stripInternalMarkers(base);
              };

              const buildFallbackCitations = () => {
                const a = pickFallbackAnchors();
                return a.map((x: any) => x.id).filter(Boolean).slice(0, 2);
              };

              const buildCollabProjectFromText = (
                text: string,
                sourceType: 'intraCollab' | 'interCollab',
                slot: 4 | 5
              ): NormProject => {
                const clean = stripInternalMarkers(text);
                const isInter = sourceType === 'interCollab';
                const rawTitleBody = clean.includes('：') ? clean.split('：')[0].trim() : clean.slice(0, 38).trim();
                const genericCollabTitle = /^(営業\s*[×xX]\s*技術|技術\s*[×xX]\s*営業|他事業部|別事業部|関連事業部|共同|連携)$/;
                const looksLikePartnerOnly = isInter && /事業$|事業部$|部門$/.test(rawTitleBody) && !/共同|検証|開発|提案|推進|削減|強化/.test(rawTitleBody);
                const intraPairOnly = !isInter && /^[^：:]{1,12}\s*[×xX]\s*[^：:]{1,12}$/.test(rawTitleBody);
	                const projectTerm = primaryStrategyTerm;
	                const title = (!rawTitleBody || genericCollabTitle.test(rawTitleBody))
	                  ? (isInter ? `${partnerDeptName}との${projectTerm}共同検証` : `営業×技術×製造による${projectTerm}共同提案`)
	                  : looksLikePartnerOnly
	                    ? `${rawTitleBody}との${projectTerm}共同検証`
	                    : intraPairOnly
	                      ? `${rawTitleBody}による${projectTerm}共同提案`
	                      : projectHasStrategyTerm({ title: rawTitleBody }).ok
	                        ? rawTitleBody
	                        : `${rawTitleBody}：${projectTerm}`;
                return {
                  title,
	                  reason: buildFallbackGroundedText(clean || (isInter ? `${projectTerm}について他事業部との連携により単独部門では実行しにくいテーマを具体化する。` : `${projectTerm}について営業・技術・製造の機能連携により顧客要求の仕様化と提案速度を高める。`)),
	                  hypothesis: buildFallbackGroundedText(isInter
	                    ? `${projectTerm}に関して事業部間で顧客・技術・販路を組み合わせれば、単独部門では作れない成長機会を検証できる。`
	                    : `${projectTerm}に関して営業が顧客要求を整理し、技術・製造が実現可能性を検討すれば、設計段階からの提案精度が高まる。`),
                  mainLever: isInter ? 'FUTURE' : 'ACQ',
                  horizon: isInter ? 'mid' : 'short',
                  kind: isInter ? 'future' : 'growth',
                  sourceType,
                  collaborationType: isInter ? 'interDept' : 'intraDept',
                  partnerDepartment: isInter ? (clean.match(/×([^：:]+)/)?.[1]?.trim()) : undefined,
                  generatedBy: 'ai',
                  generatedSlot: slot,
                  generatedGroup: 'cascade_v1',
                  citations: buildFallbackCitations(),
                  valueDriverLinks: (Array.isArray(valueDriverKPIs) ? valueDriverKPIs : [])
                    .slice(0, 2)
                    .map((k:any)=>k.id)
                    .filter(Boolean),
                  skillRequirements: isInter
                    ? { roleSkills: ['事業開発', '技術'], executionSkills: ['共同企画', '仮説検証'] }
                    : { roleSkills: ['営業', '技術'], executionSkills: ['共同ヒアリング', '提案設計'] },
                  humanInvestments: isInter
                    ? [
                        { category: 'ALLOCATION', title: '共同PJ担当アサイン', detail: '両部門から担当者を任命する' },
                        { category: 'TOOLS_PROCESS', title: '共同検討会の設計', detail: '共同テーマを定例で検討する' },
                      ]
                    : [
                        { category: 'TOOLS_PROCESS', title: '共同案件レビュー会', detail: '部門内の関係者が重点案件を定例でレビューする' },
                        { category: 'TRAINING_OJT', title: '連携提案OJT', detail: '顧客課題を提案・仕様に翻訳する実践訓練' },
                      ],
                  okrs: [
                    {
	                      objective: isInter ? `${projectTerm}の共同テーマを具体化し検証する` : `${projectTerm}の顧客要求を部門内連携で仕様化する`,
	                      keyResults: isInter
	                        ? [`${projectTerm}共同企画テーマ数（件）`, `${projectTerm}共同検証件数（件）`, `${projectTerm}共同提案先候補数（社）`]
	                        : [`${projectTerm}顧客要求の共同仕様化件数（件/月）`, `${projectTerm}共同レビュー件数（件/月）`, `${projectTerm}提案から仕様回答までの期間（日）`],
                    },
                  ],
                };
              };

              // ★fix8: 既存進化・新規探索は固定補完しない。AI生成結果だけを採用する。
              const safeExistingProjects = Array.isArray(existingProjects) ? existingProjects.slice(0, 2) : [];

              const safeNewProjects = Array.isArray(newProjects) ? newProjects.slice(0, 1) : [];

              const safeIntraCollabProjects = intraCollabProjectsFromAi.length >= 1
                ? intraCollabProjectsFromAi.map((p) => ({
                    ...p,
                    sourceType: 'intraCollab' as const,
                    collaborationType: 'intraDept' as const,
                    generatedSlot: p.generatedSlot ?? 4,
                  }))
                : effectiveIntraCollab.map((text) => buildCollabProjectFromText(text, 'intraCollab', 4));

	              const safeInterCollabProjects = hasMultipleRequestedDepartments
	                ? (interCollabProjectsFromAi.length >= 1
	                    ? interCollabProjectsFromAi.map((p) => ({
	                        ...p,
	                        sourceType: 'interCollab' as const,
	                        collaborationType: 'interDept' as const,
	                        generatedSlot: p.generatedSlot ?? 5,
	                      }))
	                    : effectiveInterCollab.map((text) => buildCollabProjectFromText(text, 'interCollab', 5)))
	                : [];


              // ★ missionDescription のフォールバック（API から空の場合は簡易生成）
              let missionDescription = typeof d?.missionDescription === 'string' ? d.missionDescription.trim() : '';
              if (!missionDescription && missionDraft) {
                // 最低限の説明をロジックで生成
                const focusThemesText = toStringList(d?.focusThemes, 2).join('、') || '事業成長';
                const directionText = d?.direction ? `（${d.direction}）` : '';
                missionDescription = `${missionDraft}を実現するために、${focusThemesText}に注力します${directionText}。`;
              }

              // ★ TASK 6: [AI#] prefix を完全除去（返却前処理）
              const stripAllAiPrefixes = (proj: any) => {
                const stripped = stripAiPrefix(proj?.title ?? '');
                return { ...proj, title: ensurePrefix(name, stripped) };
              };

              const cleanedMissionDraft = stripAiPrefix(missionDraft);
              const cleanedMissionDescription = stripAiPrefix(missionDescription);

              const normalizeCollabProjectTitle = (proj: any, sourceType: 'intraCollab' | 'interCollab') => {
                const raw = stripInternalMarkers(stripAiPrefix(proj?.title ?? ''));
                const isInter = sourceType === 'interCollab';
                const isTooGeneric = !raw || /^(営業\s*[×xX]\s*技術|技術\s*[×xX]\s*営業|他事業部|別事業部|関連事業部|共同|連携)$/i.test(raw);
                const looksLikePartnerOnly = isInter && /事業$|事業部$|部門$/.test(raw) && !/共同|検証|開発|提案|推進|削減|強化/.test(raw);
                const intraPairOnly = !isInter && /^[^：:]{1,12}\s*[×xX]\s*[^：:]{1,12}$/.test(raw);
                const preferredTerm = strategyTerms.find((t) => /向け|ユニット|モジュール|カメラ|モータ|加工|ロボット|ドローン|自動運転|DMS|ADAS|市場|用途/.test(t)) || strategyTerms[0] || '重点テーマ';
                const title = isTooGeneric
                  ? (isInter ? `${partnerDeptName}との${preferredTerm}共同検証` : `営業×技術による${preferredTerm}共同提案`)
                  : looksLikePartnerOnly
                    ? `${raw}との${preferredTerm}共同検証`
                    : intraPairOnly
                      ? `${raw}による${preferredTerm}共同提案`
                      : projectHasStrategyTerm({ title: raw }).ok
                        ? raw
                        : `${raw}：${preferredTerm}`;
                return { ...proj, title };
              };

              // ★fix6: A案維持。ただし既存進化/新規探索でも仮説説明が消えないように、
              // AIが reason/hypothesis を空で返した場合のみ、画面表示用の自然文を補完する。
              // ここでは内部fact-idを混ぜず、STEP1/STEP4でそのまま読める文にする。
              const ensureReadableProjectNarrative = (proj: any, sourceType: CascadeLaneType): any => {
                const rawTitle = stripInternalMarkers(stripAiPrefix(proj?.title ?? '')).trim();
                const titleBody = rawTitle.startsWith(`${name}：`)
                  ? rawTitle.slice(`${name}：`.length).trim()
                  : rawTitle.startsWith(`${name}:`)
                    ? rawTitle.slice(`${name}:`.length).trim()
                    : rawTitle;
                const titleForText = titleBody || 'このプロジェクト';
                const currentHypothesis = stripInternalMarkers(proj?.hypothesis ?? '').trim();
                const currentReason = stripInternalMarkers(proj?.reason ?? '').trim();

                let fallbackReason = '';
                let fallbackHypothesis = '';

                if (sourceType === 'existing') {
                  fallbackReason = `${name}の既存事業・既存顧客基盤を活かし、${titleForText}を通じて収益性または顧客価値を高めるためです。`;
                  fallbackHypothesis = `既存顧客や既存業務に対して${titleForText}を重点的に進めれば、提案精度・顧客満足・収益性のいずれかが改善し、短期的な成果につながるはずです。`;
                } else if (sourceType === 'new') {
                  fallbackReason = `${name}の将来成長に向けて、${titleForText}の実行可能性と事業化可能性を小さく検証するためです。`;
                  fallbackHypothesis = `${titleForText}を限定的に検証すれば、市場性・実行条件・投資判断に必要な情報が得られ、次の成長テーマとして進めるべきかを判断できるはずです。`;
                } else if (sourceType === 'intraCollab') {
                  fallbackReason = `${name}内の営業・技術・開発などの機能をつなぎ、単独機能では解きにくい顧客課題に対応するためです。`;
                  fallbackHypothesis = `営業が顧客課題を整理し、技術・開発が実現可能性を検討しながら${titleForText}を進めれば、提案精度と実行速度が高まるはずです。`;
                } else {
                  const partner = proj?.partnerDepartment || partnerDeptName || '関連事業部';
                  fallbackReason = `${name}と${partner}の顧客・技術・販路を組み合わせ、単独部門では作りにくい成長機会を具体化するためです。`;
                  fallbackHypothesis = `${name}の顧客課題と${partner}の技術・販路を組み合わせて${titleForText}を進めれば、共同提案または共同検証の機会が生まれるはずです。`;
                }

                return {
                  ...proj,
                  reason: currentReason || fallbackReason,
                  hypothesis: currentHypothesis || currentReason || fallbackHypothesis,
                };
              };

              // ★仮説表示の根本修正
              // 以前の fix8 で既存進化 / 新規探索だけ固定補完を止めたため、
              // AIが hypothesis / reason を空で返したケースでは、STEP1で通常3プロジェクトの仮説が消えていた。
              // ここでは「AI由来の reason/hypothesis がある場合は必ず尊重」し、
              // 空の場合だけ STEP1で読める最小限の説明を補完する。
              const safeExistingProjectsWithNarrative = safeExistingProjects.map((p) => ensureReadableProjectNarrative(p, 'existing'));
              const safeNewProjectsWithNarrative = safeNewProjects.map((p) => ensureReadableProjectNarrative(p, 'new'));
              const safeIntraCollabProjectsWithNarrative = safeIntraCollabProjects.map((p) => ensureReadableProjectNarrative(p, 'intraCollab'));
              const safeInterCollabProjectsWithNarrative = safeInterCollabProjects.map((p) => ensureReadableProjectNarrative(p, 'interCollab'));

              // ★ P0: 全プロジェクトに部門名prefix強制（[AI#]除去後）
              const prefixedExistingProjects = safeExistingProjectsWithNarrative.map((p) => ({ ...sanitizeProjectForUi(stripAllAiPrefixes(p), name), sourceType: 'existing' as const }));
              const prefixedNewProjects = safeNewProjectsWithNarrative.map((p) => ({ ...sanitizeProjectForUi(stripAllAiPrefixes(p), name), sourceType: 'new' as const }));
              const prefixedIntraCollabProjects = safeIntraCollabProjectsWithNarrative.map((p) => ({ ...sanitizeProjectForUi(stripAllAiPrefixes(normalizeCollabProjectTitle(p, 'intraCollab')), name), sourceType: 'intraCollab' as const, collaborationType: 'intraDept' as const }));
              const prefixedInterCollabProjects = safeInterCollabProjectsWithNarrative.map((p) => {
                const normalized = normalizeCollabProjectTitle(p, 'interCollab');
                const guessedPartner =
                  p?.partnerDepartment ||
                  String(normalized?.title ?? '').match(/^(.+?)(?:との|×|x|X)/)?.[1]?.trim() ||
                  partnerDeptName;
                return {
                  ...sanitizeProjectForUi(stripAllAiPrefixes(normalized), name),
                  sourceType: 'interCollab' as const,
                  collaborationType: 'interDept' as const,
                  partnerDepartment: guessedPartner,
                };
              });

              // ★ CRITICAL FIX（根本原因修正）: projects に lanes を統合（canonical source を projects に寄せる）
              // 【背景】
              // - 旧動作: department.projects = [] を返していた（重複防止のため lanes 分離）
              // - 問題: 後続処理（save/hydrate）で projects が canonical source として扱われるため、
              //        空の projects がそのまま DB に保存されていた
              // - 修正: API返却時点で lanes から flatten したプロジェクト配列を projects に入れる
              // 【実装】
              // - mergedProjects = [...existingProjects, ...newProjects] でflat化
              // - lanes は後方互換のため残す（UI が参考表示で使用可能）
              // - projectIdベースで dedupe（重複削除）
              const mergedProjects = [...prefixedExistingProjects, ...prefixedNewProjects, ...prefixedIntraCollabProjects, ...prefixedInterCollabProjects];

              // dedupe by project.id or title（安全側）
              const seenIds = new Set<string>();
              const seenTitles = new Set<string>();
              const dedupedProjects = mergedProjects.filter((p: any) => {
                const id = p?.id ?? p?.title ?? '';
                const title = p?.title ?? '';
                if (!id && !title) return false; // id/title両方ないなら除外
                if (seenIds.has(id) || seenTitles.has(title)) return false;
                if (id) seenIds.add(id);
                seenTitles.add(title);
                return true;
              });

              return {
                name,
                missionDraft: stripInternalMarkers(cleanedMissionDraft),
                missionDescription: stripInternalMarkers(cleanedMissionDescription),

                lanes: {
                  existing: {
                    projects: prefixedExistingProjects,
                  },
                  new: {
                    projects: prefixedNewProjects,
                  },
                  intraCollab: {
                    projects: prefixedIntraCollabProjects,
                  },
                  interCollab: {
                    projects: prefixedInterCollabProjects,
                  },
                },

                // ★ CRITICAL FIX: projects に lanes を統合したフラット配列を返す（canonical source）
                // 旧: projects: [] だったため projects が空のまま DB 保存されていた（根本原因）
                // 新: lanes から統合したプロジェクト配列を返す（title/okrs/owner等の主要フィールドを保持）
                projects: dedupedProjects,

                // ★fix3: STEP1の生成内訳表示にも必ず反映されるよう、有効化済みの連携候補を返す
                intraDeptCollab: effectiveIntraCollab.map(stripInternalMarkers),
                interDeptCollab: effectiveInterCollab.map(stripInternalMarkers),
                needsCollab: effectiveLegacyCollab.map(stripInternalMarkers),
                stopList: trimList(d?.stopList, 6),
                first90Days: trimList(d?.first90Days, 8),
                riskNotes: trimList(d?.riskNotes, 6),

                // ★STEP5拡張：事業・部門別戦略の観点（LLMが返した場合のみ付与。
                // 未出力時はキー自体を含めず、既存データ・既存UIへの影響をゼロにする）
                ...(typeof d?.currentPosition === 'string' && d.currentPosition.trim()
                  ? { currentPosition: scrubUngroundedStrategyOverviewText(stripInternalMarkers(d.currentPosition.trim()), overviewEvidenceText) }
                  : {}),
                ...(typeof d?.strategicRole === 'string' && d.strategicRole.trim()
                  ? { strategicRole: scrubUngroundedStrategyOverviewText(stripInternalMarkers(d.strategicRole.trim()), overviewEvidenceText) }
                  : {}),
                ...(trimList(d?.keyIssues, 6).length > 0
                  ? { keyIssues: scrubUngroundedStrategyOverviewArray(trimList(d?.keyIssues, 6).map(stripInternalMarkers), overviewEvidenceText) }
                  : {}),
                ...(trimList(d?.alignmentRiskPoints, 6).length > 0
                  ? { alignmentRiskPoints: scrubUngroundedStrategyOverviewArray(trimList(d?.alignmentRiskPoints, 6).map(stripInternalMarkers), overviewEvidenceText) }
                  : {}),
              };
            })
            .filter(Boolean);
      })(),
    };

    /* =========================
     * ★ STAGE3: 6問回答の構造反映を保証
     * - プロンプト注入だけでは Q4/Q5/Q6 が消えるため、実スキーマの出力先へ補完する
     * - Q4: riskNotes / keyIssues
     * - Q5: needsCollab / intraDeptCollab / interDeptCollab
     * - Q6: stopList
     * ======================= */
    if (Array.isArray(result.departments)) {
      for (const dept of result.departments) {
        const deptName = pickName(dept);
        const deptInput = deptInputByName.get(deptName);
        if (!deptInput) continue;
        ensureDept6AnswerReflection(dept, deptInput, hasMultipleRequestedDepartments);
      }
    }

    /* =========================
     * ★ CRITICAL: 4つのフィールド（currentPosition/strategicRole/keyIssues/alignmentRiskPoints）チェック＋専用再生成
     * fallback 処理後、最終バリデーション前に実施
     * ======================= */
    {
      const checkMissingFields = (depts: any[]): { deptIndex: number; deptName: string; missing: string[] }[] => {
        return depts
          .map((dept: any, index: number) => {
            const missing: string[] = [];
            if (!dept.currentPosition || typeof dept.currentPosition !== 'string' || !dept.currentPosition.trim()) {
              missing.push('currentPosition');
            }
            if (!dept.strategicRole || typeof dept.strategicRole !== 'string' || !dept.strategicRole.trim()) {
              missing.push('strategicRole');
            }
            if (!Array.isArray(dept.keyIssues) || dept.keyIssues.length === 0) {
              missing.push('keyIssues');
            }
            if (!Array.isArray(dept.alignmentRiskPoints) || dept.alignmentRiskPoints.length === 0) {
              missing.push('alignmentRiskPoints');
            }
            return { deptIndex: index, deptName: dept.name, missing };
          })
          .filter((item: any) => item.missing.length > 0);
      };

      const missingFields = checkMissingFields(result.departments);

      if (missingFields.length > 0) {
        // ★ 専用生成：不足部門だけを対象に、JSON Schema で4項目を必須にして生成
        for (const missing of missingFields) {
          const dept = result.departments[missing.deptIndex];
          if (!dept) continue;

          const deptName = dept.name;

          // 部門データ準備
          const deptInfo: string[] = [];
          deptInfo.push(`部門名: ${deptName}`);
          if (dept.missionDraft) deptInfo.push(`ミッション: ${dept.missionDraft}`);
          if (dept.missionDescription) deptInfo.push(`ミッション説明: ${dept.missionDescription}`);

          const deptInput = deptInputByName?.get(deptName);
          if (deptInput) {
            if (deptInput.direction) deptInfo.push(`方向性（STAGE1）: ${deptInput.direction}`);
            if (deptInput.expectations && Array.isArray(deptInput.expectations)) {
              deptInfo.push(`期待（STAGE1）: ${deptInput.expectations.join(', ')}`);
            }
          }

          // プロジェクト情報
          const projList: string[] = [];
          if (Array.isArray(dept.lanes?.existing?.projects)) {
            dept.lanes.existing.projects.slice(0, 2).forEach((p: any) => {
              projList.push(`既存進化: ${p.title || '（未命名）'}`);
            });
          }
          if (Array.isArray(dept.lanes?.new?.projects)) {
            dept.lanes.new.projects.slice(0, 1).forEach((p: any) => {
              projList.push(`新規探索: ${p.title || '（未命名）'}`);
            });
          }
          if (projList.length > 0) deptInfo.push(`プロジェクト: ${projList.join('; ')}`);

          // 専用プロンプト
          const specialPrompt = `【部門別戦略の観点を生成】

対象部門: ${deptName}

【部門情報】
${deptInfo.join('\n')}

【全社戦略（STAGE2）】
${sanitizeText(finalStoryText || '（未設定）', 1800)}

【要件】
以下の4つをすべて必須で生成してください：

1. currentPosition（現在の位置づけ）
   - 1〜2文
   - STAGE1情報と全社戦略からみた、この部門の現状
   - 入力本文にない市場名・顧客名・用途名・製品名は使わない
   - 部門別売上、利益率、成長率、構成比などの数値は、部門情報に明示されている場合のみ使う
   - 数値根拠がない場合は「部門別の売上・利益率データは追加確認が必要」と書く

2. strategicRole（中計上の役割）
   - 1〜2文
   - 全社戦略の実現に向けた、この部門の役割
   - 「全社成長の30%」など、入力にない寄与率・構成比を作らない

3. keyIssues（主要課題）
   - 配列（2〜4個）
   - その役割を果たすために解決すべき課題

4. alignmentRiskPoints（認識のズレが起きやすいポイント）
   - 配列（1〜3個）
   - 経営層と現場で見方が異なる論点

【禁止】
- 「売上は好調」「利益率改善が課題」「全社成長の30%を担う」「本部は短期売上拡大を期待するが、持続可能な成長には中長期の人材育成が不可欠」などの例文由来表現を使わない。
- 入力にない数値・財務状態・寄与率を推測しない。`;

          try {
            // JSON Schema による構造化出力
            const model = process.env.OPENAI_MODEL ?? 'gpt-4o';
            const responseFormat = {
              type: 'json_schema',
              json_schema: {
                name: 'strategy_overview',
                strict: true,
                schema: {
                  type: 'object',
                  properties: {
                    currentPosition: {
                      type: 'string',
                      description: '現在の位置づけ（1〜2文）',
                    },
                    strategicRole: {
                      type: 'string',
                      description: '中計上の役割（1〜2文）',
                    },
                    keyIssues: {
                      type: 'array',
                      items: { type: 'string' },
                      description: '主要課題（2〜4個）',
                      minItems: 1,
                    },
                    alignmentRiskPoints: {
                      type: 'array',
                      items: { type: 'string' },
                      description: '認識のズレが起きやすいポイント（1〜3個）',
                      minItems: 1,
                    },
                  },
                  required: ['currentPosition', 'strategicRole', 'keyIssues', 'alignmentRiskPoints'],
                  additionalProperties: false,
                },
              },
            };

            const specialCompletion = await (openai.chat.completions as any).create({
              model,
              response_format: responseFormat as any,
              temperature: 0.3,
              max_tokens: 800,
              messages: [
                { role: 'system', content: 'JSON形式で、指定された4つのフィールドすべてを返す。説明は不要。' },
                { role: 'user', content: specialPrompt },
              ],
            });

            const message = specialCompletion.choices?.[0]?.message;

            // ★ message.parsed が undefined の場合、message.content を JSON.parse する
            let specialResult: any = (message as any)?.parsed;

            if (!specialResult && typeof (message as any)?.content === 'string') {
              const content = ((message as any).content as string).trim();
              if (content) {
                try {
                  specialResult = JSON.parse(content);
                } catch (_parseError) {
                  // JSON 解析失敗時は specialResult は undefined のまま
                }
              }
            }

            if (
              specialResult &&
              specialResult.currentPosition &&
              typeof specialResult.currentPosition === 'string' &&
              specialResult.strategicRole &&
              typeof specialResult.strategicRole === 'string' &&
              Array.isArray(specialResult.keyIssues) &&
              specialResult.keyIssues.length > 0 &&
              Array.isArray(specialResult.alignmentRiskPoints) &&
              specialResult.alignmentRiskPoints.length > 0
            ) {
              const targetDept = result.departments[missing.deptIndex];
              if (!targetDept) continue;

              // 4項目を既存部門データへ明示的にマージ
              Object.assign(targetDept, {
                currentPosition: scrubUngroundedStrategyOverviewText(specialResult.currentPosition.trim(), overviewEvidenceText),
                strategicRole: scrubUngroundedStrategyOverviewText(specialResult.strategicRole.trim(), overviewEvidenceText),
                keyIssues: specialResult.keyIssues
                  .filter((item: any): item is string => typeof item === 'string')
                  .map((item: string) => scrubUngroundedStrategyOverviewText(item.trim(), overviewEvidenceText))
                  .filter(Boolean),
                alignmentRiskPoints: specialResult.alignmentRiskPoints
                  .filter((item: any): item is string => typeof item === 'string')
                  .map((item: string) => scrubUngroundedStrategyOverviewText(item.trim(), overviewEvidenceText))
                  .filter(Boolean),
              });
            }
          } catch (_err: any) {
            // 専用生成失敗時も続行（バリデーションで後で引っかかる）
          }
        }

      }
    }

    // ★ 調査ログ②：返却直前の missionDescription 確認（フォールバック処理後）
    {
      if (Array.isArray(result?.departments)) {
        console.log('[STAGE3][API before return]', result.departments.map((d: any) => ({
          name: d?.name,
          missionDraft: d?.missionDraft?.substring(0, 60),
          missionDescription: d?.missionDescription?.substring(0, 60),
        })));
      }
    }

    // ★ TASK 4-1: 返却直前ログ（LLMのKRが潰れていないか確認）
    if (Array.isArray(result?.departments)) {
      for (const dept of result.departments) {
        if (!dept) continue;
        console.log('[proof][before_ensure]', {
          dept: dept.name,
          existing: dept?.lanes?.existing?.projects?.map((p: any) => ({
            title: p?.title,
            okrsLen: p?.okrs?.length ?? 0,
            kr0: p?.okrs?.[0]?.keyResults?.[0],
            kr1: p?.okrs?.[0]?.keyResults?.[1],
          })) ?? [],
          new: dept?.lanes?.new?.projects?.map((p: any) => ({
            title: p?.title,
            okrsLen: p?.okrs?.length ?? 0,
            kr0: p?.okrs?.[0]?.keyResults?.[0],
            kr1: p?.okrs?.[0]?.keyResults?.[1],
          })) ?? [],
        });
      }
    }

    // ★ STAGE3: TASK 2 - 反映度スコアリング（デバッグログ）
    if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1' && Array.isArray(result?.departments)) {
      for (const d of result.departments) {
        const deptName = pickName(d);
        const deptInput = deptInputByName.get(deptName);
        const deptAnswers6 = pickDeptAnswers6(deptInput);

        // ★修正: okrs も含める
        const allOkrs = [
          ...(d?.lanes?.existing?.projects || []).flatMap((p: any) =>
            (p.okrs || []).map((okr: any) => `${okr.objective || ''} ${(okr.keyResults || []).join(' ')}`)
          ),
          ...(d?.lanes?.new?.projects || []).flatMap((p: any) =>
            (p.okrs || []).map((okr: any) => `${okr.objective || ''} ${(okr.keyResults || []).join(' ')}`)
          ),
        ];

        const generatedText = [
          d?.missionDraft || '',
          d?.missionDescription || '',
          ...(d?.lanes?.existing?.projects || []).map((p: any) => `${p.title} ${p.reason || ''} ${p.hypothesis || ''}`),
          ...(d?.lanes?.new?.projects || []).map((p: any) => `${p.title} ${p.reason || ''} ${p.hypothesis || ''}`),
          ...allOkrs,
        ].join(' ');

        const { topTokens, coveragePct, hitTokens } = scoreDept6Impact(deptAnswers6, generatedText);
        console.log('[cascade][dept6][impact]', {
          dept: deptName,
          topTokens: topTokens.slice(0, 10),
          coveragePct,
          hitTokens,
        });
      }
	    }
	
	    const unresolvedStrategyGroundingIssues: Array<{
	      deptName: string;
	      lane: string;
	      slot: number;
	      title: string;
	      reasons: string[];
	    }> = [];
	    if (Array.isArray(result?.departments)) {
	      for (const dept of result.departments) {
	        const deptName = dept?.name ?? '';
	        for (const item of collectLaneProjects(dept)) {
	          if (!isCoreStrategyLane(item.laneType)) continue;
	          const validation = validateStrategyGrounding(item.project);
	          if (!validation.ok) {
	            unresolvedStrategyGroundingIssues.push({
	              deptName,
	              lane: item.laneType,
	              slot: item.slot,
	              title: item.project?.title ?? '',
	              reasons: validation.reasons,
	            });
	          }
	        }
	      }
	    }

	    const blockingStrategyGroundingIssues = unresolvedStrategyGroundingIssues.filter((issue) =>
	      issue.reasons.includes('generic_title')
	    );

	    if (unresolvedStrategyGroundingIssues.length > 0) {
	      console.warn('[cascade][strategy-grounding][blocked-final]', unresolvedStrategyGroundingIssues);
	      if (blockingStrategyGroundingIssues.length > 0 && process.env.ALLOW_UNGROUNDED_CASCADE !== '1') {
	        return new NextResponse(JSON.stringify({
	          error: 'STAGE2最終ストーリーに接続しない汎用プロジェクト案が残ったため、保存前に生成を停止しました。再生成してください。',
	          code: 'strategy_grounding_failed',
	          strategyTerms: strategyTerms.slice(0, 12),
	          invalidProjects: blockingStrategyGroundingIssues,
	        }), {
	          status: 422,
	          headers: { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
	        });
	      }
	      (result as any).qualityWarnings = {
	        strategyGrounding: unresolvedStrategyGroundingIssues,
	      };
	    }

	    // ★ TASK C: AI keyResults が空のプロジェクトを検出 & ログ出力
	    // 実際の retry は複雑なため、ここではログ出力のみ。ensureKeyResults() がテンプレ補完
	    const emptyKrProjects: {deptName: string; projectTitle: string; lane?: string}[] = [];
    if (Array.isArray(result?.departments)) {
      for (const dept of result.departments) {
        const deptName = dept?.name ?? '';
        const checkProject = (p: any, lane?: string) => {
          const krLen = p?.okrs?.[0]?.keyResults?.length ?? 0;
          if (krLen === 0) {
            emptyKrProjects.push({deptName, projectTitle: p?.title, lane});
          }
        };
        dept?.lanes?.existing?.projects?.forEach((p: any) => checkProject(p, 'existing'));
        dept?.lanes?.new?.projects?.forEach((p: any) => checkProject(p, 'new'));
        dept?.projects?.forEach((p: any) => checkProject(p));
      }

      // ログ出力：retry 対象となるプロジェクト
      for (const item of emptyKrProjects) {
        console.log(
          `[cascade][kpi][retry] project="${item.projectTitle}" dept="${item.deptName}" ` +
          `attempt=2 reason=ai_empty`
        );
      }
    }

	    // ★ TASK 2-2: 返却前に全プロジェクトに okrs を保証（LLMの漏れ補完 + AI再生成）
	    if (Array.isArray(result?.departments)) {
	      result.departments = await ensureOkrsForAllDepts(result.departments);
	    }

	    // ★ STAGE3品質強化: 汎用KPIをSTAGE2具体語ベースのKPIへ補正
	    if (Array.isArray(result?.departments)) {
	      for (const dept of result.departments) {
	        dept?.lanes?.existing?.projects?.forEach((p: any) => applyStrategicKpiGrounding(p, 'existing'));
	        dept?.lanes?.new?.projects?.forEach((p: any) => applyStrategicKpiGrounding(p, 'new'));
	        dept?.lanes?.intraCollab?.projects?.forEach((p: any) => applyStrategicKpiGrounding(p, 'intraCollab'));
	        dept?.lanes?.interCollab?.projects?.forEach((p: any) => applyStrategicKpiGrounding(p, 'interCollab'));
	        if (Array.isArray(dept?.projects)) {
	          for (const p of dept.projects) {
	            const sourceType = String(p?.sourceType ?? '') as CascadeLaneType;
	            applyStrategicKpiGrounding(p, sourceType);
	          }
	        }
	      }
	    }

	    // ★ TASK 5: AI成功率ログ（部門ごとに集計）
    if (Array.isArray(result?.departments)) {
      for (const dept of result.departments) {
        if (!dept?.name) continue;

        let totalProjects = 0;
        let aiProjects = 0;
        let templateProjects = 0;

        const checkProjects = (projects: any[]) => {
          if (!Array.isArray(projects)) return;
          for (const p of projects) {
            totalProjects++;
            const krSource = (p as any)?._krSource;
            if (krSource === 'AI') aiProjects++;
            else if (krSource === 'TEMPLATE') templateProjects++;
          }
        };

        // lanes.existing.projects と lanes.new.projects をチェック
        checkProjects(dept?.lanes?.existing?.projects);
        checkProjects(dept?.lanes?.new?.projects);
        // 旧形式も確認
        checkProjects(dept?.projects);

        if (totalProjects > 0) {
          console.log(
            `[generate-cascade][ai-rate] dept="${dept.name}" total=${totalProjects} ai=${aiProjects} template=${templateProjects} success_rate=${((aiProjects / totalProjects) * 100).toFixed(1)}%`
          );
        }
      }
    }

    // ★ TASK C: サーバ返却直前ログ（final段階：テンプレ注入後の確認）
    // [proof][final] に改名し、メタ情報も併記
    const ex0 = result?.departments?.[0]?.lanes?.existing?.projects?.[0] ?? result?.departments?.[0]?.projects?.[0];
    const ex0_krSource = (ex0 as any)?._krSource ?? '不明';
    const ex0_krReason = (ex0 as any)?._krReason ?? '情報なし';
    const ex0_krSourceDetail = (ex0 as any)?._krSourceDetail ?? '情報なし';
    const ex0_rawType = (ex0 as any)?._rawType ?? '不明';
    const ex0_rawLen = (ex0 as any)?._rawLen ?? 'N/A';

    console.log('[generate-cascade][proof][final] ★★★ KR PROOF ★★★');
    console.log('[generate-cascade][proof][final] ex0.title=', ex0?.title);
    console.log('[generate-cascade][proof][final] ex0.krSource=', ex0_krSource, 'reason=', ex0_krReason);
    console.log('[generate-cascade][proof][final] ex0.krSourceDetail=', ex0_krSourceDetail);
    console.log('[generate-cascade][proof][final] ex0.rawType=', ex0_rawType, 'rawLen=', ex0_rawLen);
    console.log('[generate-cascade][proof][final] ex0.okrsLen=', ex0?.okrs?.length, '個');
    if (ex0?.okrs?.[0]) {
      console.log('[generate-cascade][proof][final] ex0.okrs[0].objective=', ex0.okrs[0].objective);
      console.log('[generate-cascade][proof][final] ex0.okrs[0].keyResultsLen=', ex0.okrs[0].keyResults?.length, '個');
      if (ex0.okrs[0].keyResults?.[0]) {
        console.log('[generate-cascade][proof][final] ex0.okrs[0].keyResults[0].label=', ex0.okrs[0].keyResults[0].label);
      }
    }

    // ★ TASK 2-2: レスポンス直前メタ証明（project レベル vs okr0 レベル）
    const ex0_okr0 = (ex0 as any)?.okrs?.[0];
    console.log('[generate-cascade][meta-proof]', {
      dept: result?.departments?.[0]?.name ?? 'unknown',
      p0: {
        title: ex0?.title,
        proj_krSource: (ex0 as any)?._krSource,
        okr0_krSource: (ex0_okr0 as any)?._krSource,
        proj_detail: (ex0 as any)?._krSourceDetail,
        okr0_detail: (ex0_okr0 as any)?._krSourceDetail,
        okr0_rawType: (ex0_okr0 as any)?._rawType,
        okr0_rawLen: (ex0_okr0 as any)?._rawLen,
        okr0_aiCalled: (ex0_okr0 as any)?._aiCalled,
      },
    });

    /* ★ STAGE3拡張：各部門に reviewSummary を付与 */
    if (Array.isArray(result?.departments)) {
      // ★診断ログ：businessPortfolio の実データ構造を確認
      console.log('[diag][stage3:businessPortfolio:structure]', {
        type: typeof businessPortfolio,
        isArray: Array.isArray(businessPortfolio),
        hasUnits: !!businessPortfolio?.units,
        unitsCount: Array.isArray(businessPortfolio?.units) ? businessPortfolio.units.length : 0,
        unitsNames: Array.isArray(businessPortfolio?.units) ? businessPortfolio.units.map((u: any) => u?.name).filter(Boolean) : [],
        fullStructureSample: String(JSON.stringify(businessPortfolio) ?? '').slice(0, 500),
      });

      for (let deptIdx = 0; deptIdx < result.departments.length; deptIdx++) {
        const dept = result.departments[deptIdx];
        if (!dept?.name) continue;

        // 対応する入力情報を取得
        const deptInput = departments?.[deptIdx];

        const reviewSummary = buildDeptReviewSummary({
          deptName: dept.name,
          deptInput,
          generatedDept: dept,
          storyText: finalStoryText || storyText || '',
          strategySummary: strategySummary ?? '',
          businessPortfolio,
          financeSummary,
          csvFinanceData,
        });

        // ★ 返却値のチェック
        if (!Array.isArray(reviewSummary?.correctedItems) || !Array.isArray(reviewSummary?.reconsiderationPoints)) {
          console.warn('[warn][stage3:buildDeptReviewSummary:invalid-result]', {
            deptName: dept.name,
            correctedItemsType: typeof reviewSummary?.correctedItems,
            reconsiderationPointsType: typeof reviewSummary?.reconsiderationPoints,
            correctedItemsIsArray: Array.isArray(reviewSummary?.correctedItems),
            reconsiderationPointsIsArray: Array.isArray(reviewSummary?.reconsiderationPoints),
          });
        }

        // dept に reviewSummary を付与
        (dept as any).reviewSummary = {
          correctedItems: Array.isArray(reviewSummary?.correctedItems) ? reviewSummary.correctedItems : [],
          reconsiderationPoints: Array.isArray(reviewSummary?.reconsiderationPoints) ? reviewSummary.reconsiderationPoints : [],
        };
      }

      // ★ 部門間分析：重複・矛盾・協力パターンを検出
      // null を除外した安全な部門配列を作成
      const safeDepartments = (result.departments ?? []).filter(
        (d): d is NonNullable<(typeof result.departments)[number]> => !!d
      );

      const interDeptInsights = buildInterDeptCrossAnalysis(safeDepartments);

      if (Array.isArray(interDeptInsights) && interDeptInsights.length > 0) {
        console.log('[diag][stage3:interDeptAnalysis]', {
          analysisCount: interDeptInsights.length,
          byCategory: {
            overlaps: interDeptInsights.filter((i) => i.category === 'overlap').length,
            contradictions: interDeptInsights.filter((i) => i.category === 'contradiction').length,
            collaborations: interDeptInsights.filter((i) => i.category === 'collaboration').length,
          },
          bySeverity: {
            critical: interDeptInsights.filter((i) => i.severity === 'critical').length,
            warning: interDeptInsights.filter((i) => i.severity === 'warning').length,
            review: interDeptInsights.filter((i) => i.severity === 'review').length,
            info: interDeptInsights.filter((i) => i.severity === 'info').length,
          },
          samples: Array.isArray(interDeptInsights) ? interDeptInsights.slice(0, 3) : [],
        });

        // 部門ごとに該当する cross-insights を追加（オプション）
        for (const insight of interDeptInsights) {
          for (const deptName of insight.deptPair) {
            const d = safeDepartments.find((x) => (x as any).name === deptName);
            if (d) {
              if (!(d as any).reviewSummary) {
                (d as any).reviewSummary = {
                  correctedItems: [],
                  reconsiderationPoints: [],
                  crossDeptInsights: [],
                };
              }

              ((d as any).reviewSummary.crossDeptInsights ??= []).push({
                severity: insight.severity,
                category: insight.category,
                relatedDepts: Array.isArray(insight.deptPair)
                  ? insight.deptPair.filter((x) => x !== deptName)
                  : [],
                message: insight.message,
              });
            }
          }
        }
      }
    }

    // ★ CRITICAL: 返却前に4つのフィールド（currentPosition/strategicRole/keyIssues/alignmentRiskPoints）の完全性をチェック
    // これらは全部門について【必須】であり、不足している場合はエラーを返す
    const missingFieldsPerDept = result.departments.map((dept: any) => {
      const missing: string[] = [];

      if (!dept.currentPosition || typeof dept.currentPosition !== 'string' || !dept.currentPosition.trim()) {
        missing.push('currentPosition');
      }
      if (!dept.strategicRole || typeof dept.strategicRole !== 'string' || !dept.strategicRole.trim()) {
        missing.push('strategicRole');
      }
      if (!Array.isArray(dept.keyIssues) || dept.keyIssues.length === 0) {
        missing.push('keyIssues');
      }
      if (!Array.isArray(dept.alignmentRiskPoints) || dept.alignmentRiskPoints.length === 0) {
        missing.push('alignmentRiskPoints');
      }

      return { deptName: dept.name, missing };
    }).filter((item: any) => item.missing.length > 0);

    if (missingFieldsPerDept.length > 0) {
      return new NextResponse(
        JSON.stringify({
          error: '事業・部門別戦略の要点を生成できませんでした。もう一度お試しください。',
        }),
        {
          status: 400,
          headers: { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        }
      );
    }

    return new NextResponse(JSON.stringify(result), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'x-cascade-shape': 'v6-two-lanes-strategic-okr-layered',
      },
    });
  } catch (err: any) {
    console.error('❌ APIエラー（generate-cascade）:', {
      message: err?.message || err,
      stack: err?.stack,
      type: err?.constructor?.name,
      details: String(err),
    });
    return new NextResponse(JSON.stringify({ error: 'サーバーエラーが発生しました。' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
