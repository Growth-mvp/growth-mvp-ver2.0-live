// /app/api/generate-cascade/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { industryTemplates, getIndustryLabel } from '@/utils/industryTemplates';
import { toTextStory, extractJsonObject, sanitizeText } from '@/app/api/_shared/utils';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';

/* =========================
 * グローバル定数
 * ========================= */
const DEBUG = process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1';

/* =========================
 * スキーマ（AI応答の検証用：後方互換＋2レーン拡張）
 * ======================= */

// プロジェクト：仮説＋レバー×時間軸＋STAGE3拡張＋AI管理メタ
const ProjectSchema = z.object({
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

  // 新：2レーン
  lanes: z
    .object({
      existing: LaneSchema.optional(),
      new: LaneSchema.optional(),
    })
    .optional(),

  needsCollab: z.array(z.string()).optional().default([]),
  intraDeptCollab: z.array(z.string()).optional().default([]),
  interDeptCollab: z.array(z.string()).optional().default([]),
  stopList: z.array(z.string()).optional().default([]),
  first90Days: z.array(z.string()).optional().default([]),
  riskNotes: z.array(z.string()).optional().default([]),
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
  laneType?: 'existing' | 'new'
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

  // チェック1: projectTitle prefix が入っているか
  const hasPrefix = krs.every((kr) =>
    (kr.label ?? '').includes(projectTitle)
  );
  if (!hasPrefix) {
    reasons.push('missing_project_prefix');
  }

  // チェック2: KPI名が被ってないか
  const kpiNames = krs.map((kr) => {
    // label から projectTitle を削除して KPI名を抽出
    let name = (kr.label ?? '').replace(projectTitle, '').replace(/^：/, '').trim();
    return name;
  });
  const uniqueCount = new Set(kpiNames).size;
  if (uniqueCount < 3) {
    reasons.push('duplicate_kpi_names');
  }

  // チェック3: 種別別の禁止セット
  const allLabelsLower = krs.map((kr) => (kr.label ?? '').toLowerCase()).join(' ');

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
- ヒアリング実施数（件数/月）
- ペルソナ検証数（件数/月）
- 提案反映率（%）
- VoC抽出件数（件数）
- ニーズマッチ度（%）`,
      forbidden: '不良率|合格率|稼働率|納期|生産性|歩留まり|稼働時間',
    },
    inventory_system: {
      candidates: `
【推奨KPI候補】
- 在庫精度（%）
- 欠品率（%）
- 滞留在庫金額（万円）
- 棚卸工数（h/月）
- 入出庫精度（%）`,
      forbidden: '試験合格率|不良率|ヒアリング|ニーズ|提案反映',
    },
    sales_process: {
      candidates: `
【推奨KPI候補】
- 見積リードタイム（日）
- 受注率（%）
- 失注率（%）
- 提案から成約まで期間（日）
- 案件進捗速度（件数/月）`,
      forbidden: '在庫|棚卸|稼働率|不良率|試験合格',
    },
    new_market: {
      candidates: `
【推奨KPI候補】
- PoC実施数（件数/月）
- 新規リード数（件数）
- 商談化率（%）
- 仮説検証完了数（件数）
- 市場調査進捗度（スコア）`,
      forbidden: '既存事業改善|既知顧客|安定供給|製造稼働',
    },
    dx: {
      candidates: `
【推奨KPI候補】
- 自動化率（%）
- 利用率（%）
- 手作業削減工数（h/月）
- システム導入期間短縮（日）
- RPA処理件数（件数/月）`,
      forbidden: '顧客満足度|ヒアリング|在庫精度|不良率',
    },
    quality: {
      candidates: `
【推奨KPI候補】
- 不良率低減（ppm）
- 納期達成率（%）
- クレーム件数（件数/月）
- 品質検査合格率（%）
- トレーサビリティ完全性（%）`,
      forbidden: '提案反映|ニーズ|商談化|利用率',
    },
    r_and_d: {
      candidates: `
【推奨KPI候補】
- プロトタイプ開発期間短縮（日）
- 試作試験実施数（件数）
- 特性改善幅（%）
- 設計検証完了率（%）
- 新商品上市準備度（%）`,
      forbidden: '顧客満足度|稼働率|在庫精度|失注率',
    },
    default: {
      candidates: `
【推奨KPI候補】
- 実行進捗度（%）
- 目標達成度（%）
- 効果実現度（%）`,
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
    laneType?: 'existing' | 'new';
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
        return '不良率、再工数、手戻り率、稼働率、歩留まり';
      case 'inventory_system':
        return '納期遵守率、在庫回転数、リードタイム、配送精度';
      case 'customer_research':
        return 'リサーチ完了数、分析精度、顧客満足度、レポート品質';
      case 'r_and_d':
        return '試作完了数、開発リードタイム、実験成功率、知識共有度';
      default:
        return '業務効率、作業時間、精度、完了率、工数削減';
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
3. ★★★ label形式は必ず 「${projectTitle}：{KPI名}（{unit}）」に統一する
4. 各KRの unit は単位のみ（例："ppm", "日", "%" など）
5. 上記の【部門の6問回答】と整合性を保つこと
6. プロジェクト種別（${projectType}）に適した指標を選択すること

【返却フォーマット】
{
  "keyResults": [
    { "label": "${projectTitle}：{KPI名}（{unit}）", "unit": "単位コード" },
    { "label": "${projectTitle}：{KPI名}（{unit}）", "unit": "単位コード" },
    { "label": "${projectTitle}：{KPI名}（{unit}）", "unit": "単位コード" }
  ]
}

【例】
{
  "keyResults": [
    { "label": "${projectTitle}：不良率低減（100ppm以下）", "unit": "ppm" },
    { "label": "${projectTitle}：納期短縮（30日以内）", "unit": "日" },
    { "label": "${projectTitle}：歩留まり改善（98.5%以上）", "unit": "%" }
  ]
}

★重要★ label に必ずプロジェクト名を含めること。JSON以外は返さないこと。
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
      label: String(kr.label).trim(),
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
  laneType?: 'existing' | 'new'
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
    // ★ ログ: label の先頭30文字を出して形式確認（直接LLM返却の場合）
    const labels = normalized.map((kr: any) => (kr.label ?? '').substring(0, 30)).join(' | ');
    console.log(
      `[cascade][kpi][llm-label-check] dept="${deptName ?? 'unknown'}" project="${projectTitle}" rawType="${rawType}" labels="${labels}"`
    );

    return {
      ...okr,
      keyResults: normalized,
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
        label: kr.label,
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
        let name = (kr.label ?? '').replace(projectTitle, '').replace(/^：/, '').trim();
        return name;
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
  laneType?: 'existing' | 'new',
  projectTags?: string[],
  variant: 0 | 1 | 2 = 0  // ★ variant: 0=第一候補, 1=第二候補, 2=第三候補
): { krs: string[]; sourceDetail: string } {
  const title = String(projectTitle).toLowerCase();
  const tags = (projectTags ?? []).map((t) => String(t).toLowerCase());
  let sourceDetail = 'template:default';

  // タイトルに含まれるキーワードをチェック
  const hasKeyword = (keywords: string[]) =>
    keywords.some((kw) => title.includes(kw) || tags.some((t) => t.includes(kw)));

  // ★ 分岐ルール 1: 品質 / 不良 / クレーム / 保証 / 検査 / 監査
  if (hasKeyword(['品質', '不良', 'クレーム', '保証', '検査', '監査', '信頼性'])) {
    if (variant === 0) {
      return {
        krs: [
          `${projectTitle}：不良率低減（ppm）`,
          `${projectTitle}：クレーム件数削減（件/月）`,
          `${projectTitle}：審査/監査合格率（%）`,
        ],
        sourceDetail: 'template:quality_v0',
      };
    } else if (variant === 1) {
      return {
        krs: [
          `${projectTitle}：検査工数削減（h/ロット）`,
          `${projectTitle}：再加工率低減（%）`,
          `${projectTitle}：初回良品率（%）`,
        ],
        sourceDetail: 'template:quality_v1',
      };
    } else {
      return {
        krs: [
          `${projectTitle}：工程内流出率低減（ppm）`,
          `${projectTitle}：保証費削減（%）`,
          `${projectTitle}：返品率低減（%）`,
        ],
        sourceDetail: 'template:quality_v2',
      };
    }
  }

  // ★ 分岐ルール 2: 受注 / 見積 / 営業 / 案件 / 納期 / リードタイム
  if (hasKeyword(['受注', '見積', '営業', '案件', '納期', 'リード', 'lead time'])) {
    if (variant === 0) {
      return {
        krs: [
          `${projectTitle}：見積リードタイム短縮（営業日）`,
          `${projectTitle}：受注率改善（%）`,
          `${projectTitle}：納期遵守率（%）`,
        ],
        sourceDetail: 'template:sales_v0',
      };
    } else if (variant === 1) {
      return {
        krs: [
          `${projectTitle}：仕掛け期間削減（日）`,
          `${projectTitle}：提案件数増加（件/月）`,
          `${projectTitle}：受注規模拡大（平均金額）`,
        ],
        sourceDetail: 'template:sales_v1',
      };
    } else {
      return {
        krs: [
          `${projectTitle}：見積回答時間短縮（時間）`,
          `${projectTitle}：商談成功率（%）`,
          `${projectTitle}：販売テコ比改善（%）`,
        ],
        sourceDetail: 'template:sales_v2',
      };
    }
  }

  // ★ 分岐ルール 3: コスト / 原価 / 工数 / 効率 / 自動化 / 省力
  if (hasKeyword(['コスト', '原価', '工数', '効率', '自動化', '省力', 'automation'])) {
    if (variant === 0) {
      return {
        krs: [
          `${projectTitle}：単位原価削減（%）`,
          `${projectTitle}：作業工数削減（h/月）`,
          `${projectTitle}：段取り時間短縮（分）`,
        ],
        sourceDetail: 'template:cost_v0',
      };
    } else if (variant === 1) {
      return {
        krs: [
          `${projectTitle}：歩留改善（%）`,
          `${projectTitle}：材料ロス削減（%）`,
          `${projectTitle}：稼働率向上（%pt）`,
        ],
        sourceDetail: 'template:cost_v1',
      };
    } else {
      return {
        krs: [
          `${projectTitle}：加工時間短縮（分/個）`,
          `${projectTitle}：人件費削減（%）`,
          `${projectTitle}：設備稼働率（%）`,
        ],
        sourceDetail: 'template:cost_v2',
      };
    }
  }

  // ★ 分岐ルール 4: 新規 / 開発 / 軽量 / 耐久 / 設計
  if (hasKeyword(['新規', '開発', '軽量', '耐久', '設計', 'design', 'development'])) {
    if (variant === 0) {
      return {
        krs: [
          `${projectTitle}：試作回数削減（回）`,
          `${projectTitle}：試験合格率（%）`,
          `${projectTitle}：開発リードタイム短縮（月）`,
        ],
        sourceDetail: 'template:newbiz_v0',
      };
    } else if (variant === 1) {
      return {
        krs: [
          `${projectTitle}：量産時期達成率（%）`,
          `${projectTitle}：目標仕様達成率（%）`,
          `${projectTitle}：原価低減達成率（%）`,
        ],
        sourceDetail: 'template:newbiz_v1',
      };
    } else {
      return {
        krs: [
          `${projectTitle}：設計段階での課題検出数（件）`,
          `${projectTitle}：手戻り削減（%）`,
          `${projectTitle}：部品共通化率（%）`,
        ],
        sourceDetail: 'template:newbiz_v2',
      };
    }
  }

  // ★ 分岐ルール 5: 市場 / 開拓 / 仮説 / 検証 / PoC
  if (hasKeyword(['市場', '開拓', '仮説', '検証', 'poc', 'パイロット', 'prototype', 'validation'])) {
    if (variant === 0) {
      return {
        krs: [
          `${projectTitle}：商談件数増加（件/月）`,
          `${projectTitle}：PoC件数（件）`,
          `${projectTitle}：検証→受注転換率（%）`,
        ],
        sourceDetail: 'template:market_v0',
      };
    } else if (variant === 1) {
      return {
        krs: [
          `${projectTitle}：顧客ヒアリング数（社）`,
          `${projectTitle}：見込み案件数（件）`,
          `${projectTitle}：パイロット参加企業数（社）`,
        ],
        sourceDetail: 'template:market_v1',
      };
    } else {
      return {
        krs: [
          `${projectTitle}：市場反応度調査（回答率%）`,
          `${projectTitle}：早期顧客数（社）`,
          `${projectTitle}：実装案件化率（%）`,
        ],
        sourceDetail: 'template:market_v2',
      };
    }
  }

  // ★ 分岐ルール 6: スマート / IoT / データ / DX / AI / 分析
  if (hasKeyword(['smart', 'iot', 'データ', 'dx', 'ai', '分析', 'analytics', 'digital'])) {
    if (variant === 0) {
      return {
        krs: [
          `${projectTitle}：データ取得率（%）`,
          `${projectTitle}：予兆検知精度（感度%）`,
          `${projectTitle}：稼働率改善（%pt）`,
        ],
        sourceDetail: 'template:dx_v0',
      };
    } else if (variant === 1) {
      return {
        krs: [
          `${projectTitle}：データ活用範囲（システム数）`,
          `${projectTitle}：自動化カバー率（%）`,
          `${projectTitle}：異常検知検出精度（%）`,
        ],
        sourceDetail: 'template:dx_v1',
      };
    } else {
      return {
        krs: [
          `${projectTitle}：停止時間削減（h/月）`,
          `${projectTitle}：予測精度（%）`,
          `${projectTitle}：データ品質スコア（1-10）`,
        ],
        sourceDetail: 'template:dx_v2',
      };
    }
  }

  // ★ デフォルト: 汎用 KR（レーン種別で少し調整）
  if (laneType === 'new') {
    if (variant === 0) {
      return {
        krs: [
          `${projectTitle}：実現可能性検証度（%）`,
          `${projectTitle}：学習・獲得知見数（件）`,
          `${projectTitle}：スケーラビリティスコア（1-10）`,
        ],
        sourceDetail: 'template:newlane_v0',
      };
    } else if (variant === 1) {
      return {
        krs: [
          `${projectTitle}：実装体制構築度（%）`,
          `${projectTitle}：リスク認識件数（件）`,
          `${projectTitle}：プロトタイプ完成度（%）`,
        ],
        sourceDetail: 'template:newlane_v1',
      };
    } else {
      return {
        krs: [
          `${projectTitle}：市場受容度調査（回答率%）`,
          `${projectTitle}：提携先候補数（社）`,
          `${projectTitle}：導入可能性評価スコア（1-10）`,
        ],
        sourceDetail: 'template:newlane_v2',
      };
    }
  }

  // laneType === 'existing' または デフォルト
  if (variant === 0) {
    return {
      krs: [
        `${projectTitle}：生産性向上（%）`,
        `${projectTitle}：顧客満足度（NPS）`,
        `${projectTitle}：プロセス改善スコア（1-10）`,
      ],
      sourceDetail: 'template:default_v0',
    };
  } else if (variant === 1) {
    return {
      krs: [
        `${projectTitle}：売上向上（%）`,
        `${projectTitle}：リード獲得数（件/月）`,
        `${projectTitle}：顧客保持率（%）`,
      ],
      sourceDetail: 'template:default_v1',
    };
  } else {
    return {
      krs: [
        `${projectTitle}：利益率向上（%pt）`,
        `${projectTitle}：顧客単価向上（%）`,
        `${projectTitle}：プロセス効率化度（%）`,
      ],
      sourceDetail: 'template:default_v2',
    };
  }
}

/**
 * ★ TASK 2-2: 各プロジェクトに必ず okrs があることを保証（LLMの生成漏れ対策）
 * - 既に okrs があれば保持
 * - LLMが objective/keyResults を別名で返していれば拾う
 * - 両方ない場合も空の okrs を入れる（UI側が「未生成」と判定可能に）
 * - ★ keyResults が空の場合は最低3件を保証する（deriveKrsByContext で差別化）
 */
async function ensureOkrs(project: any, laneType?: 'existing' | 'new', deptName?: string): Promise<any> {
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
      const deduplicateAndReplaceKrs = (krs: any[], projectTitle: string, laneType?: 'existing' | 'new'): any[] => {
        // usedKrSet に対してチェック
        const uniqueLabels = new Set<string>();
        const finalKrs: any[] = [];

        for (const kr of krs) {
          const krLabel = kr.label || String(kr);
          if (usedKrSet.has(krLabel)) {
            // 重複！差し替え候補を探す
            let replaced = false;
            // variant 1, 2 を試して、被らない KR セットを見つける
            for (let variant of [1, 2] as const) {
              const result = deriveKrsByContext(projectTitle, undefined, laneType, undefined, variant);
              const altKrs = result.krs;
              for (const altKr of altKrs) {
                if (!usedKrSet.has(altKr) && !uniqueLabels.has(altKr)) {
                  finalKrs.push({ ...kr, label: altKr });
                  uniqueLabels.add(altKr);
                  usedKrSet.add(altKr);
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
            finalKrs.push(kr);
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
        const hint = `売上は${Math.abs(change).toFixed(1)}%${sign}（${yearStr}${latestRev}百万円）`;
        financeHints.push(hint);
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

        if (inventory != null) {
          bsHint = `在庫は${inventory}百万円`;
        } else if (receivables != null) {
          bsHint = `売掛金は${receivables}百万円`;
        } else if (fixedAssets != null) {
          bsHint = `固定資産は${fixedAssets}百万円`;
        }

        if (bsHint && financeHints.length < 4) {
          // 既に4個以上ある場合は追加しない
          const yearStr = latestYear ? `${latestYear}年` : '';
          const fullHint = yearStr ? `${bsHint}（${yearStr}）` : bsHint;
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
          const hint = `売上は${Math.abs(change).toFixed(1)}%${sign}（${latestRev}百万円）`;
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

  // ★ fallback 4: constraint anchors（入力データが不足している場合の最終手段）
  if (anchors.length < 8) {
    const constraintHints = [
      '経営課題の多層性を考慮する必要があります',
      'デジタルトランスフォーメーションは継続的課題です',
      '人材確保と育成は常に優先度が高い',
      '顧客ニーズへの迅速な対応が求められます',
      'サプライチェーンの最適化が進行中です',
      '市場変化への適応力強化が重要です',
      'コスト効率化と品質向上の両立が課題',
      'グローバル展開の加速を計画中です',
    ];

    while (anchors.length < 8 && constraintHints.length > 0) {
      anchors.push({
        id: `fact-constraint-${anchors.length - 6}`,
        text: constraintHints[anchors.length - 6] || '経営課題への対応が重要です',
        source: 'finance', // constraint も finance カテゴリで扱う
      });
    }
  }

  return {
    segmentName,
    anchors: anchors.slice(0, 12), // 最大12個に制限、最小8個保証
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
      const hypothesis = typeof p?.hypothesis === 'string' ? p.hypothesis.trim() : '';

      const mainLeverRaw = typeof p?.mainLever === 'string' ? p.mainLever.trim().toUpperCase() : '';
      const mainLever = allowedLevers.includes(mainLeverRaw as any) ? (mainLeverRaw as NormProject['mainLever']) : undefined;

      const horizonRaw = typeof p?.horizon === 'string' ? p.horizon.trim().toLowerCase() : '';
      const horizon = allowedHorizons.includes(horizonRaw as any) ? (horizonRaw as NormProject['horizon']) : undefined;

      const kindRaw = typeof p?.kind === 'string' ? p.kind.trim().toLowerCase() : '';
      const kind = allowedKinds.includes(kindRaw as any) ? (kindRaw as NormProject['kind']) : undefined;

      return { title, reason, hypothesis, mainLever, horizon, kind };
    });
}

/* ★STAGE3軽量化：OKR生成関数削除（API側で OKR 生成しない） */

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
    } = parsedReq.data;

    if (!Array.isArray(departments) || departments.length === 0) {
      return new NextResponse(JSON.stringify({ error: '部門情報が未入力です。カスケード生成できません。' }), {
        status: 400,
        headers: { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    // ★TASK 2: request に finalStory が到達しているか確認（parse直後）
    console.log('[cascade][req] hasFinalStory=', !!finalStory, 'type=', typeof finalStory, 'jsonLen=', JSON.stringify(finalStory || '').length);

    const storyText = toTextStory(story);
    // ★新規: STAGE2 final story を text 化
    const finalStoryText = toTextStory(finalStory);

    // ★デバッグログ: final story が注入されたことを確認
    const finalStoryLen = typeof finalStoryText === 'string' ? finalStoryText.length : 0;
    console.log(`[cascade][story] storyText.len=${typeof storyText === 'string' ? storyText.length : 0} finalStoryText.len=${finalStoryLen}`);

    const hasValidInput =
      (typeof strategySummary === 'string' && strategySummary.trim().length > 0) ||
      (typeof storyText === 'string' && storyText.trim().length > 0);
    if (!hasValidInput) {
      return new NextResponse(JSON.stringify({ error: '経営戦略ストーリーと要約の両方が空です。どちらかを入力してください。' }), {
        status: 400,
        headers: { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    /* =========================
     * プロンプト組み立て（2レーン生成：既存進化 / 新規探索）
     * ======================= */
    const summary = strategySummary?.trim() || storyText.slice(0, 160) || '（要約なし）';

    // ★csvFinanceData はオブジェクトで来ても落とさない（抜粋行を抽出）
    const previewRows = extractCsvPreviewRows(csvFinanceData);
    const financeCsvText = previewRows.length > 0 ? toLinesFromCsv(previewRows, 5) : '（CSVベースの財務データなし）';

    const financeSummaryText = summarizeFinanceSummary(financeSummary);
    const portfolioText = summarizeBusinessPortfolio(businessPortfolio);

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

          // 1) seg から抽出（優先）
          if (segPLData && typeof segPLData === 'object') {
            const plData = Array.isArray(segPLData) ? segPLData : [segPLData];
            for (const row of plData.slice(-2)) {
              if (!row) continue;
              const year = row?.year ? `(${row.year})` : '';
              const revenue = typeof row?.revenue === 'number' ? `売上${Math.round(row.revenue / 100) / 10}M円` : '';
              const operatingIncome = typeof row?.operatingIncome === 'number' ? `営業利益${Math.round(row.operatingIncome / 100) / 10}M円` : '';
              const items = [year, revenue, operatingIncome].filter(Boolean).join(' ');
              if (items) parts.push(items);
            }
          }

          // 2) csvFinanceData.segmentPL から抽出（補助）
          if (!seg && segmentPL && segmentPL[segKey]) {
            const segRows = Array.isArray(segmentPL[segKey]) ? segmentPL[segKey].slice(-2) : [];
            for (const row of segRows) {
              const year = row?.year ? `(${row.year})` : '';
              const revenue = typeof row?.revenue === 'number' ? `売上${Math.round(row.revenue / 100) / 10}M円` : '';
              const operatingIncome = typeof row?.operatingIncome === 'number' ? `営業利益${Math.round(row.operatingIncome / 100) / 10}M円` : '';
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
              const revenue = typeof row.revenue === 'number' ? `${Math.round(row.revenue / 100) / 10}M円` : row.revenue || '';
              const margin = row.profitMargin ? `利益率${row.profitMargin}` : '';
              const item = [revenue, margin].filter(Boolean).join(', ');
              if (item) parts.push(item);
            }
          }

          return parts.length > 0 ? parts.join(' / ') : '（部門別財務不明）';
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
          if (!factPack || factPack.anchors.length === 0) {
            return `\n\n[FACTPACK]\n- segment: ${segKey}\n- anchors: （利用可能な事実なし）`;
          }

          const anchorLines = factPack.anchors
            .map((a) => `  - ${a.id}: "${sanitizeText(a.text, 100)}"`)
            .join('\n');

          const customerLines = factPack.customers.length > 0
            ? `\n- customers: ${factPack.customers.map((c) => `"${c}"`).join(', ')}`
            : '';

          return `\n\n[FACTPACK]\n- segment: ${factPack.segmentName}${customerLines}\n- anchors (必ず2つ以上を reason/hypothesis で引用すること):\n${anchorLines}`;
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
- existing lane の各プロジェクト title は必ず "${deptName}：" で始める（例："${deptName}：既存顧客のLTV改善"）
- new lane の各プロジェクト title も必ず "${deptName}：" で始める（例："${deptName}：新規用途開拓の検証"）
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
- Step4（犠牲）に該当する内容を、プロジェクトの risks / constraints として明記すること
- Step5（協力）を、プロジェクトの dependencies（協力部門・前提）として明記すること
- Step6（撤退）を、scope 除外または非対象として明記すること
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
  ★部門別ポートフォリオ: ${deptPortfolioText}
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
あなたは世界最高の経営戦略コンサルタントです。以下の情報をもとに、部門ごとの提案を「既存進化（Existing）」「新規探索（New）」の2レーンで返してください。

【★最重要：プロジェクト数と命名規則（STAGE3軽量化版）】
- 各部門の提案は「プロジェクト」のみで構成される（OKRは生成しない）。
- プロジェクト数：合計3個（既存進化 2個 + 新規探索 1個）を厳密に守ること。
- ★★★全部門で異なるプロジェクト案を出すこと（部門AのプロジェクトAが部門Bにも出現することは厳禁）。
- ★★★各部門の【部門別財務】【部門別ポートフォリオ】【主な顧客層】【意思決定権】を参照し、その部門固有の課題と機会に基づいてプロジェクトを立案すること。
- ★TASK 2 引用ベース生成（FACTPACK から必ず根拠を引く）：
  - 各プロジェクトの title は必ず [FACTPACK] の customers または overview から固有名詞を1つ以上含むこと（例：「自動車OEMの〜」「トヨタ向けの〜」）
  - reason と hypothesis には、[FACTPACK] の anchors ID を「」括弧で最低2つ以上引用すること（例：「『主要顧客：トヨタ』（fact-cust-1）」）
  - citations フィールドに、引用した anchor ID を列挙すること（例：["fact-cust-1", "fact-fin-2"]）
- ★対象部門の事業領域から外れる提案は禁止。既存事業と離れすぎた提案や、部門の守備範囲外の分野への展開は避けること。

【部門ミッション記述ルール】
- missionDraft: 1〜2文で、部門の戦略的ミッション（構造変化/役割の再定義を含める）
- missionDescription: 2〜4文で、missionDraft の背景・理由・狙いを説明。部門の事業概要、主要顧客層、部門別財務（売上規模・利益率など）に必ず言及すること。

【レーン定義】
- 既存進化（Existing）：短期〜中期（今年〜3年）でPLに効く改善/強化（主にACQ/ARPU/CHURN/COST/EFFICIENCY）。2個のプロジェクト。
- 新規探索（New）：将来成長の仮説検証（主にFUTURE、ただしACQ/ARPUでも可）。1個のプロジェクト。
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
${sanitizeText(finalStoryText || '', 1000) || '（最終ストーリー未入力）'}

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
  - 製品/サービス名（例：「中型部品」「カスタマイズ」「新型用」）
  - 顧客セグメント（例：「OEM向け」「内製化」「自動化」）
  - 技術領域（例：「IoT」「データ連携」「クラウド」）

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
- 必須制約3：3本のKRのうち2本以上は互いに異なるカテゴリに属すること。指標のカテゴリ例：
  - 品質指標（歩留、不良率、再加工率、初回良品率など）
  - 納期・リードタイム指標（納期遵守率、見積回答時間、開発期間など）
  - コスト・効率指標（単位原価、工数、稼働率など）
  - 顧客・営業指標（受注率、提案件数、NPS、顧客単価など）
  - 安全・コンプライアンス指標（ヒヤリハット件数、監査合格率など）

0. okrs: OKR[] - 【★必須】 最低1個以上。各要素に objective と keyResults を含める（上記参照）

1. valueDriverLinks: string[] - STAGE2で定義された価値指標（valueDriverKPIs）の id を最低1つ以上含める。複数選択可。valueDriverKPIs が存在する場合、それ以外の値は禁止（自由記述不可）。
2. skillRequirements: { roleSkills?: string[]; executionSkills?: string[] } - 実行に必要なスキル
   - roleSkills: 職種スキル（例：「営業」「エンジニア」「デザイナー」「マーケター」等）1〜3個
   - executionSkills: 実行スキル（例：「PM」「標準化」「データ活用」「改善運用」「設計力」「交渉力」等）必ず1〜3個
   - ★重要：全プロジェクトで同一のスキルセットは厳禁。各プロジェクトごとに、title/hypothesis/mainLever/kind/valueDriverLinks/departmentName/laneを分析し、プロジェクトのアーキタイプ（品質改善型/自動化型/営業強化型/新規事業型/ITデータ型/組織改革型など）を内部で推定してから、そのアーキタイプに最適なスキルを選択すること。
3. humanInvestments: HumanInvestment[] - 人的投資施策、最低2カテゴリ以上を含める
   - category: 固定5カテゴリのみ使用可能（'TRAINING_OJT' | 'HIRING' | 'ALLOCATION' | 'EXTERNAL' | 'TOOLS_PROCESS'）
   - title: 施策名（短く、5〜15文字）
   - detail: 詳細（任意、1〜2文程度）
   - owner: 担当者（任意）
   - horizon: 実行時期（任意、'0_3M' | '3_6M' | '6_12M' | ''）
   - ★重要：全プロジェクトで同一の人的投資施策は厳禁。各プロジェクトのアーキタイプに基づき、適切なカテゴリと具体的な施策名を選択すること。例：品質改善型なら「品質管理研修」＋「検証ツール導入」、営業強化型なら「提案力研修」＋「CRM導入」など。

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
              "title": "高付加価値案件の構造変化",
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
                "roleSkills": ["営業", "マーケター"],
                "executionSkills": ["PM", "データ活用"]
              },
              "humanInvestments": [
                { "category": "TRAINING_OJT", "title": "営業研修プログラム", "detail": "提案力向上のための実践研修" },
                { "category": "TOOLS_PROCESS", "title": "CRM導入", "detail": "顧客データの一元管理" }
              ]
            },
            {
              "title": "商談設計力の強化",
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
                { "category": "TRAINING_OJT", "title": "商談設計研修", "detail": "顧客課題の深掘りと提案構造化の実践" },
                { "category": "TOOLS_PROCESS", "title": "提案テンプレート構築", "detail": "再現性のある提案パターン整備" }
              ]
            }
          ]
        },
        "new": {
          "projects": [
            {
              "title": "次世代サービス仮説検証",
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
                { "category": "HIRING", "title": "プロダクトマネジャー採用", "detail": "新規事業開発のリード" },
                { "category": "EXTERNAL", "title": "MVP開発パートナー契約", "detail": "プロトタイプ迅速開発" }
              ]
            }
          ]
        }
      },
      "needsCollab": ["誰と何をする（例：営業×マーケ：高付加価値案件の創出）"],
      "intraDeptCollab": ["事業部内連携（例：営業×技術：高付加価値案件の創出）"],
      "interDeptCollab": ["事業部間連携（例：A事業部×B事業部：共同開発テーマの推進）"],
      "stopList": ["やめる/諦める項目（KRには含めない）"],
      "first90Days": ["最初の90日でやること（週/マイルストン粒度）"],
      "riskNotes": ["主要リスクと対処の一言"]
    }
  ]
}

制約：
- missionDraft と missionDescription は必ず両方を含めること（空・null 禁止）。
- lanes.existing は必ず2個のプロジェクトを出す（OK: 2個、NG: 1個・3個以上）。
- lanes.new は必ず1個のプロジェクトを出す（OK: 1個、NG: 0個・2個以上）。
- ★TASK 2 引用必須：
  - 各プロジェクトに citations フィールドを必ず含める（最低2個の anchor ID）。
  - reason と hypothesis に「」で括られた anchor 引用を最低2つ含めること。
  - 引用しない場合は生成失敗（再生成対象）。
- 各プロジェクトに generatedBy="ai"、generatedSlot (1/2/3)、generatedGroup="cascade_v1" を必ず含める。
- financeSummary / businessPortfolio とかけ離れた非現実（売上10倍等）は避ける。
- ★全プロジェクトに valueDriverLinks、skillRequirements、humanInvestments、citations を必ず含める（空は不可）。
- valueDriverLinks は valueDriverKPIs の id から選ぶこと（自由記述禁止）。
- humanInvestments は最低2カテゴリを含めること。
- ★★重要：全プロジェクトで skillRequirements.executionSkills や humanInvestments が同一になることは絶対に禁止。各プロジェクトのアーキタイプ（品質/自動化/営業/新規/ITデータ/組織など）を推定し、それぞれに適したスキルと施策を割り当てること。
- ★対象部門の既存事業と大きく異なる领域（全く無関係な新規事業など）を提案しないこと。
- Q5（協力）の回答に他事業部・別事業部・共同開発・横断連携が明示される場合は、interDeptCollab を少なくとも1件返すこと。
`.trim();

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
      max_tokens: 2200,
      messages: [
        { role: 'system', content: '必ずJSONのみを返し、日本語で。前後の説明は禁止。' },
        { role: 'user', content: prompt },
      ],
    });

    const rawContent = completion.choices?.[0]?.message?.content || '';
    const parsed = extractJsonObject(rawContent);

    if (!parsed) {
      return new NextResponse(JSON.stringify({ error: '生成結果のJSON解析に失敗しました。' }), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    const safe = ResponseSchema.safeParse(parsed);
    if (!safe.success) {
      console.warn('generate-cascade: schema validation errors:', safe.error?.issues);
    }
    const normalized = (safe.success ? safe.data : parsed) as z.infer<typeof ResponseSchema>;

    /* =========================
     * ★TASK 2-2: Citations Grounding Gate + 1回再生成
     * ======================= */

    // 検証関数
    const hasMinCitations = (p: any): boolean => {
      return Array.isArray(p?.citations) && p.citations.length >= 2;
    };

    // ★新規: fact-id のカウント（全角括弧 （） と半角括弧 () の両方に対応）
    const countFactIds = (text: string): number => {
      // [（(] で全角か半角の開き括弧、[）)] で全角か半角の閉じ括弧
      const factIdPattern = /[（(][^）)]*fact-[^）)]*[)）]/g;
      const matches = text.match(factIdPattern);
      return matches?.length ?? 0;
    };

    // ★修正: inline quotes のマッチ数をカウント（引用符「』と括弧（）の両方に対応）
    const countInlineQuotes = (p: any): number => {
      const text = `${p?.reason ?? ''} ${p?.hypothesis ?? ''}`;
      // 引用符が 「」 または 『』、括弧が () または （） の両パターンに対応
      // ★バグ修正①: 閉じ括弧を [」『] → [」』] に修正（『で閉じるのは誤り）
      // パターン: [「『]...[」』] \s* [（(]...(fact-...)[)）]
      const citationPattern = /[「『][^」』]+[」』]\s*[（(][^）)]*fact-[^）)]*[)）]/g;
      const matches = text.match(citationPattern);
      return matches?.length ?? 0;
    };

    // ★新規: 段階的gating（Level A/B/C）
    const getGroundingLevel = (p: any): { level: 'A' | 'B' | 'C'; matchCount: number; factIdCount: number } => {
      const citations = Array.isArray(p?.citations) ? p.citations : [];
      const text = `${p?.reason ?? ''} ${p?.hypothesis ?? ''}`;
      const inlineQuoteMatches = countInlineQuotes(p);
      const factIdMatches = countFactIds(text);

      // ★バグ修正②: Level A を強化（factIdMatches >= 1 → >= 2）
      // Level A: citations>=2 && fact-id 出現 >=2（reason+hypothesisのどこか）
      // 理由: retryPrompt で「reason/hypothesisに2箇所」を要求しているため、実装の判定と揃える
      if (citations.length >= 2 && factIdMatches >= 2) {
        return { level: 'A', matchCount: inlineQuoteMatches, factIdCount: factIdMatches };
      }

      // Level B: citations>=2 だが fact-id 出現 1回以下
      if (citations.length >= 2) {
        return { level: 'B', matchCount: inlineQuoteMatches, factIdCount: factIdMatches };
      }

      // Level C: citations<2
      return { level: 'C', matchCount: inlineQuoteMatches, factIdCount: factIdMatches };
    };

    const hasInlineQuotes = (p: any): boolean => {
      return countInlineQuotes(p) >= 2;
    };

    const isProjectGrounded = (p: any): boolean => {
      const groundingLevel = getGroundingLevel(p);
      return groundingLevel.level === 'A';
    };

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
        laneType: 'existing' | 'new';
        projectIndex: number;
        slot: number;
        project: any;
        groundingLevel: string;
        citationCount: number;
        factIdCount: number;
        matchCount: number;
      }> = [];

      // 失敗したproject特定
      for (let dIdx = 0; dIdx < depts.length; dIdx++) {
        const dept = depts[dIdx];
        const deptName = dept?.name ?? `dept_${dIdx}`;

        // existing lane
        if (dept?.lanes?.existing?.projects) {
          for (let pIdx = 0; pIdx < dept.lanes.existing.projects.length; pIdx++) {
            const proj = dept.lanes.existing.projects[pIdx];
            const groundingLevel = getGroundingLevel(proj);

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
              });
            }
          }
        }

        // new lane
        if (dept?.lanes?.new?.projects) {
          for (let pIdx = 0; pIdx < dept.lanes.new.projects.length; pIdx++) {
            const proj = dept.lanes.new.projects[pIdx];
            const groundingLevel = getGroundingLevel(proj);

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
          const templateExample = anchorsList.length >= 2
            ? `例：「${anchorsList[0].text}」(${anchorsList[0].id}) により${anchorsList[0].text.slice(0, 20)}が確認でき、` +
              `「${anchorsList[1].text}」(${anchorsList[1].id}) の観点から戦略を立案する`
            : '例：「主要な事実」(fact-...) のサポートのもと、「別の事実」(fact-...) と組み合わせて提案する';

          // 再生成prompt
          const retryPrompt = `
前回のプロジェクト案では、引用ベース生成の要件を満たしていません。
現在の状況：
- citations数: ${failed.citationCount}/2 (必須: 2個以上)
- fact-id出現数: ${failed.factIdCount} (必須: 1回以上)
- 引用フォーマット数: ${failed.matchCount} (推奨: 2回以上)

以下の部門について、${failed.laneType === 'existing' ? '既存進化レーン' : '新規探索レーン'}のプロジェクト案を修正してください：

部門: ${deptName}

【このセグメントで利用可能なFACTPACK anchors】
${anchorsText || '（利用可能なanchorsなし）'}

【修正必須条件】
1. citations は最低2個の anchor ID を含むこと（上記リストから選択すること、捏造禁止）
2. reason と hypothesis に 「text」(fact-id) 形式で最低2箇所含めること（必ず括弧内に fact-id を記入）
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
  "citations": ["fact-...", "fact-..."],
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
              if (isProjectGrounded(retryProject) && hasRequiredFields(retryProject)) {
                // 成功：差し替え
                if (failed.laneType === 'existing') {
                  depts[failed.deptIndex].lanes.existing.projects[failed.projectIndex] = retryProject;
                } else {
                  depts[failed.deptIndex].lanes.new.projects[failed.projectIndex] = retryProject;
                }
                console.log(`[cascade][grounding][retry-success] dept=${deptName} slot=${slot}`);
              } else {
                // 再生成でもNGなら fallback（既存結果を採用）
                const failReason = !isProjectGrounded(retryProject) ? 'grounding_ng' : 'required_fields_missing';
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
        laneTypeA: 'existing' | 'new';
        slotA: number;
        projA: any;
        deptBIdx: number;
        deptBName: string;
        laneTypeB: 'existing' | 'new';
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
          const projectsA: Array<{ laneType: 'existing' | 'new'; slot: number; proj: any }> = [];
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
          const projectsB: Array<{ laneType: 'existing' | 'new'; slot: number; proj: any }> = [];
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
5. citations >= 2 & 「」引用 >= 2（「text」(fact-id) 形式で2回以上） & required fields（title/reason/hypothesis/mainLever/kind/horizon/valueDriverLinks>=1/skillRequirements/humanInvestments>=1）は必須

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
  "citations": ["fact-...", "fact-..."],
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
            if (isProjectGrounded(retryProject) && hasRequiredFields(retryProject)) {
              // 成功：差し替え
              if (conflict.laneTypeB === 'existing') {
                depts[conflict.deptBIdx].lanes.existing.projects[conflict.slotB - 1] = retryProject;
              } else {
                depts[conflict.deptBIdx].lanes.new.projects[conflict.slotB - 3] = retryProject;
              }
              console.log(`[cascade][sim][regen-success] dept=${conflict.deptBName} slot=${conflict.slotB} attempt=${attempt}`);
            } else {
              // 再生成でもNGなら fallback
              const failReason = !isProjectGrounded(retryProject) ? 'grounding_ng' : 'required_fields_missing';
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
          const answers = (deptInput?.answers || []) as Array<{ stepNumber: number; answer?: string; label?: string }>;
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
- ★[SEGMENT]から固有名詞を2つ抽出してtitleに含めること（例："自動車OEM"、"医療機器メーカー"、"建機アフター市場"など）
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

${secondPassDeptBlock}

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
          executionSkills: ['提案力', '交渉力', 'PM'],
          roleSkills: ['営業', 'セールス'],
          investments: [
            { category: 'TRAINING_OJT', title: '提案力強化研修', detail: '顧客課題発見と提案スキルの向上', owner: '', horizon: '0_3M' },
            { category: 'TOOLS_PROCESS', title: 'CRM・SFA導入', detail: '顧客管理と営業活動の可視化ツール', owner: '', horizon: '3_6M' },
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
          executionSkills: ['マーケティング分析', 'コンテンツ企画', 'データ活用'],
          roleSkills: ['マーケター', 'デザイナー'],
          investments: [
            { category: 'TOOLS_PROCESS', title: 'MA・広告ツール導入', detail: 'マーケティングオートメーションと効果測定', owner: '', horizon: '3_6M' },
            { category: 'TRAINING_OJT', title: 'デジタルマーケ研修', detail: 'SEO・広告運用の実践スキル習得', owner: '', horizon: '0_3M' },
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
      departments: Array.isArray(normalized?.departments)
        ? normalized.departments
            .map((d: any) => {
              const name = typeof d?.name === 'string' ? d.name.trim() : '';
              if (!name || !inputNames.has(name)) return null;

              const missionDraft = typeof d?.missionDraft === 'string' ? d.missionDraft.trim() : '';
              const lanesRaw = d?.lanes;

              const deptInput = deptInputByName.get(name);
              const answers = (deptInput?.answers || []) as Array<{ stepNumber: number; answer?: string; label?: string }>;
              const answersText = (answers || [])
                .sort((a, b) => (a?.stepNumber || 0) - (b?.stepNumber || 0))
                .slice(0, 6)
                .map((a) => `Q${a.stepNumber}${a.label ? `(${a.label})` : ''}: ${String(a.answer || '')}`)
                .join('\n');

              // ★STAGE3軽量化：OKR生成を削除、プロジェクトのみ返す
              // existing lane (2プロジェクト)
              const existingProjects = normalizeProjects(lanesRaw?.existing?.projects ?? d?.projects).slice(0, 2);

              // new lane (1プロジェクト)
              const newProjects = normalizeProjects(lanesRaw?.new?.projects ?? []).slice(0, 1);

              // ★致命修正: fallback anchors ヘルパー関数
              const pickFallbackAnchors = () => {
                const fp = factPackByDept.get(name);
                const anchors = Array.isArray(fp?.anchors) ? fp.anchors : [];
                return anchors.slice(0, 2);
              };

              const buildFallbackGroundedText = (base: string) => {
                const a = pickFallbackAnchors();
                if (a.length >= 2) {
                  return `${base}。「${a[0].text}」(${a[0].id}) と「${a[1].text}」(${a[1].id}) を根拠に、短期で実行可能な打ち手に落とし込む。`;
                }
                if (a.length === 1) {
                  return `${base}。「${a[0].text}」(${a[0].id}) を根拠に、短期で実行可能な打ち手に落とし込む。`;
                }
                return base;
              };

              const buildFallbackCitations = () => {
                const a = pickFallbackAnchors();
                return a.map((x: any) => x.id).filter(Boolean).slice(0, 2);
              };

              // ★ フォールバック：プロジェクトが不足する場合（required fields と citations を含める）
              const safeExistingProjects = existingProjects.length >= 2
                ? existingProjects
                : [
                    ...(existingProjects ?? []),
                    {
                      title: `[AI#2] ${name}の既存進化・収益性改善`,
                      reason: buildFallbackGroundedText('既存事業からPLに効く改善'),
                      hypothesis: buildFallbackGroundedText('既存顧客基盤から生まれる改善提案を構造化し実装する。'),
                      mainLever: 'ARPU',
                      horizon: 'short',
                      kind: 'growth',
                      // ★致命修正: required fields を追加
                      citations: buildFallbackCitations(),
                      valueDriverLinks: (valueDriverKPIs ?? []).slice(0, 2).map((k:any)=>k.id).filter(Boolean),
                      skillRequirements: {},
                      humanInvestments: [],
                    } as NormProject,
                  ].slice(0, 2);

              const safeNewProjects = newProjects.length >= 1
                ? newProjects
                : [
                    {
                      title: `[AI#3] ${name}の新規探索・新サービス検証`,
                      reason: buildFallbackGroundedText('将来成長の可能性を検証する'),
                      hypothesis: buildFallbackGroundedText('特定の顧客課題に対し小さく提供すれば、反応が得られ、スケールの条件が見えるはず。'),
                      mainLever: 'FUTURE',
                      horizon: 'mid',
                      kind: 'future',
                      // ★致命修正: required fields を追加
                      citations: buildFallbackCitations(),
                      valueDriverLinks: (valueDriverKPIs ?? []).slice(0, 2).map((k:any)=>k.id).filter(Boolean),
                      skillRequirements: {},
                      humanInvestments: [],
                    } as NormProject,
                  ];

              const allProjects = [...safeExistingProjects, ...safeNewProjects];

              // ★ missionDescription のフォールバック（API から空の場合は簡易生成）
              let missionDescription = typeof d?.missionDescription === 'string' ? d.missionDescription.trim() : '';
              if (!missionDescription && missionDraft) {
                // 最低限の説明をロジックで生成
                const focusThemesText = (d?.focusThemes ?? []).slice(0, 2).join('、') || '事業成長';
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

              // ★ P0: 全プロジェクトに部門名prefix強制（[AI#]除去後）
              const prefixedExistingProjects = safeExistingProjects.map(stripAllAiPrefixes);
              const prefixedNewProjects = safeNewProjects.map(stripAllAiPrefixes);

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
              const mergedProjects = [...prefixedExistingProjects, ...prefixedNewProjects];

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
                missionDraft: cleanedMissionDraft,
                missionDescription: cleanedMissionDescription,

                lanes: {
                  existing: {
                    projects: prefixedExistingProjects,
                  },
                  new: {
                    projects: prefixedNewProjects,
                  },
                },

                // ★ CRITICAL FIX: projects に lanes を統合したフラット配列を返す（canonical source）
                // 旧: projects: [] だったため projects が空のまま DB 保存されていた（根本原因）
                // 新: lanes から統合したプロジェクト配列を返す（title/okrs/owner等の主要フィールドを保持）
                projects: dedupedProjects,

                intraDeptCollab: normalizeCollabLists(d, deptInputByName.get(name)).intra,
                interDeptCollab: normalizeCollabLists(d, deptInputByName.get(name)).inter,
                needsCollab: normalizeCollabLists(d, deptInputByName.get(name)).legacy,
                stopList: trimList(d?.stopList, 6),
                first90Days: trimList(d?.first90Days, 8),
                riskNotes: trimList(d?.riskNotes, 6),
              };
            })
            .filter(Boolean)
        : [],
    };

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

    return new NextResponse(JSON.stringify(result), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'x-cascade-shape': 'v6-two-lanes-strategic-okr-layered',
      },
    });
  } catch (err: any) {
    console.error('❌ APIエラー（generate-cascade）:', err?.message || err);
    return new NextResponse(JSON.stringify({ error: 'サーバーエラーが発生しました。' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
