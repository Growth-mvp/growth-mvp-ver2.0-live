// /app/api/generate-cascade/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { industryTemplates, getIndustryLabel } from '@/utils/industryTemplates';
import { toTextStory, extractJsonObject, sanitizeText } from '@/app/api/_shared/utils';
import { z } from 'zod';

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
    strategySummary: z.string().optional(),
    departments: z.array(DeptInputSchema).optional().default([]),

    // ★ここを緩和：配列/オブジェクトどちらも許容（strictで弾かない）
    csvFinanceData: z.any().optional(),

    financeSummary: z.any().optional(),
    businessPortfolio: z.any().optional(),

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
 * csvFinanceData から「表示用に抜粋できる“行配列”」を抽出する。
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
      strategySummary,
      departments,
      csvFinanceData,
      financeSummary,
      businessPortfolio,
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

    const storyText = toTextStory(story);
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

    const deptBlocks = departments
      .map((d) => {
        const name = pickName(d);
        const answers = (d?.answers || []) as Array<{ stepNumber: number; label?: string; answer?: string }>;
        const dir = d?.direction || '';
        const exps = trimList(d?.expectations, 4);
        const focuses = trimList(d?.focusThemes, 4);

        const ansLines = (answers || [])
          .sort((a, b) => (a?.stepNumber || 0) - (b?.stepNumber || 0))
          .slice(0, 6)
          .map((a) => `  - Q${a.stepNumber}${a.label ? `（${a.label}）` : ''}: ${sanitizeText(a?.answer || '', 220)}`)
          .join('\n');

        // ★ 部門別財務サマリー（部門名に一致する行を抽出）
        const deptFinanceSummaryText = (() => {
          if (!financeSummary) return '（財務データなし）';
          const summaryList = Array.isArray(financeSummary) ? financeSummary : [];
          const deptMatches = summaryList.filter((row: any) => {
            const businessUnit = String(row?.business_unit || row?.unitName || '').toLowerCase();
            const deptNameLower = name.toLowerCase();
            return businessUnit.includes(deptNameLower) || deptNameLower.includes(businessUnit);
          });
          if (deptMatches.length > 0) {
            return deptMatches
              .slice(0, 2)
              .map((row: any) => {
                const revenue = typeof row.revenue === 'number' ? `${Math.round(row.revenue / 100) / 10}M円` : row.revenue || 'N/A';
                return `${row.business_unit || row.unitName || ''}: 売上 ${revenue}, 利益率 ${row.profitMargin || 'N/A'}`;
              })
              .join(' / ');
          }
          return '（部門別財務不明）';
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
  seeds.projects:
${projSeed || '  - （なし）'}
  seeds.okr:
${okrSeed || '  - （なし）'}
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
- タイトル prefix（名詞句の前に付ける）：
  - 既存進化 #1: "[AI#1] " を付ける（例："[AI#1] 高付加価値案件の構造変化"）
  - 既存進化 #2: "[AI#2] " を付ける（例："[AI#2] 商談設計力の強化"）
  - 新規探索 #1: "[AI#3] " を付ける（例："[AI#3] 次世代サービス仮説検証"）
- これらの prefix は内部管理用で、提案内容には影響しない。
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

【プロジェクト設計ルール（仮説ベース＋2軸）】
- projects は「仮説ベースのプロジェクト」として設計する。
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
- hypothesis は「もし誰に対して/どの業務に対して◯◯を行えば、行動や体験がこう変わり、その結果 mainLever の指標がこう改善するはず」という形で1〜2文。

【★STAGE3拡張フィールド（必須）】
各プロジェクトに以下を必ず含めること：
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
      "missionDraft": "この部門の戦略ミッション案（1〜2文。構造変化/役割も含める）",
      "missionDescription": "missionDraft の背景・理由・狙い（2〜4文。部門の事業概要/主要顧客/部門別財務に言及すること）",
      "lanes": {
        "existing": {
          "projects": [
            {
              "title": "[AI#1] 高付加価値案件の構造変化",
              "reason": "目的（1文）",
              "hypothesis": "仮説（1〜2文）",
              "mainLever": "ACQ",
              "horizon": "short",
              "kind": "growth",
              "generatedBy": "ai",
              "generatedSlot": 1,
              "generatedGroup": "cascade_v1",
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
              "title": "[AI#2] 商談設計力の強化",
              "reason": "目的（1文）",
              "hypothesis": "仮説（1〜2文）",
              "mainLever": "ACQ",
              "horizon": "mid",
              "kind": "growth",
              "generatedBy": "ai",
              "generatedSlot": 2,
              "generatedGroup": "cascade_v1",
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
              "title": "[AI#3] 次世代サービス仮説検証",
              "reason": "目的（1文）",
              "hypothesis": "仮説（1〜2文）",
              "mainLever": "FUTURE",
              "horizon": "mid",
              "kind": "future",
              "generatedBy": "ai",
              "generatedSlot": 3,
              "generatedGroup": "cascade_v1",
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
- 各プロジェクトのタイトルは必ず "[AI#1]"〜"[AI#3]" の prefix で始まること。
- 各プロジェクトに generatedBy="ai"、generatedSlot (1/2/3)、generatedGroup="cascade_v1" を必ず含める。
- financeSummary / businessPortfolio とかけ離れた非現実（売上10倍等）は避ける。
- ★全プロジェクトに valueDriverLinks、skillRequirements、humanInvestments を必ず含める（空は不可）。
- valueDriverLinks は valueDriverKPIs の id から選ぶこと（自由記述禁止）。
- humanInvestments は最低2カテゴリを含めること。
- ★★重要：全プロジェクトで skillRequirements.executionSkills や humanInvestments が同一になることは絶対に禁止。各プロジェクトのアーキタイプ（品質/自動化/営業/新規/ITデータ/組織など）を推定し、それぞれに適したスキルと施策を割り当てること。
- ★対象部門の既存事業と大きく異なる领域（全く無関係な新規事業など）を提案しないこと。
`.trim();

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

              // フォールバック：プロジェクトが不足する場合
              const safeExistingProjects = existingProjects.length >= 2
                ? existingProjects
                : [
                    ...(existingProjects ?? []),
                    {
                      title: '[AI#2] 既存進化プロジェクト',
                      reason: '既存事業からPLに効く改善',
                      hypothesis: '既存顧客基盤から生まれる改善提案を構造化し実装する。',
                      mainLever: 'ARPU',
                      horizon: 'short',
                      kind: 'growth',
                    } as NormProject,
                  ].slice(0, 2);

              const safeNewProjects = newProjects.length >= 1
                ? newProjects
                : [
                    {
                      title: '[AI#3] 新規探索プロジェクト',
                      reason: '将来成長の可能性を検証する',
                      hypothesis: '特定の顧客課題に対し小さく提供すれば、反応が得られ、スケールの条件が見えるはず。',
                      mainLever: 'FUTURE',
                      horizon: 'mid',
                      kind: 'future',
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

              return {
                name,
                missionDraft,
                missionDescription,

                lanes: {
                  existing: {
                    projects: safeExistingProjects,
                  },
                  new: {
                    projects: safeNewProjects,
                  },
                },

                // ★ API安全策：lanes が返せるなら projects は空（重複防止）
                // 後方互換は x-cascade-shape ヘッダで判定して UI側が切り分ける
                projects: [],

                needsCollab: trimList(d?.needsCollab, 6),
                stopList: trimList(d?.stopList, 6),
                first90Days: trimList(d?.first90Days, 8),
                riskNotes: trimList(d?.riskNotes, 6),
              };
            })
            .filter(Boolean)
        : [],
    };

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
