// /app/api/generate-cascade/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { industryTemplates, getIndustryLabel } from '@/utils/industryTemplates';
import { toTextStory, extractJsonObject, sanitizeText } from '@/app/api/_shared/utils';
import { z } from 'zod';

/* =========================
 * スキーマ（AI応答の検証用：後方互換＋拡張）
 * ======================= */
const ProjectSchema = z.object({
  title: z.string().min(1).catch(''),
  reason: z.string().default(''),
});

const OKRSpec = z.object({
  objective: z.string().default(''),
  keyResults: z.array(z.string()).default([]),
  owner: z.string().optional().default(''),
});

const DepartmentSchema = z.object({
  name: z.string().min(1).catch(''),
  missionDraft: z.string().default(''),
  projects: z.array(ProjectSchema).default([]),

  // 追加（任意）
  okrDraft: z.array(OKRSpec).optional().default([]),
  needsCollab: z.array(z.string()).optional().default([]), // 他部門と何をやるか
  stopList: z.array(z.string()).optional().default([]), // やめる/諦める
  first90Days: z.array(z.string()).optional().default([]), // 90日アクション
  riskNotes: z.array(z.string()).optional().default([]), // リスクと対策メモ
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

const DeptInputSchema = z
  .object({
    name: z.string().optional(), // "name" or 旧"departmentName"許容
    departmentName: z.string().optional(),
    missionDraft: z.string().optional(),
    projects: z.array(z.string()).optional(),
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

const ReqSchema = z.object({
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

  // 既存：CSV生データ
  csvFinanceData: z.array(z.record(z.any())).optional().default([]),

  // 追加：Step3 以降の財務サマリー & ポートフォリオ（あれば参照）
  financeSummary: z.any().optional(),
  businessPortfolio: z.any().optional(),
});

/* =========================
 * 小ユーティリティ
 * ======================= */
const toLinesFromCsv = (csvRows: any[], limit = 5) =>
  (csvRows || [])
    .slice(0, limit)
    .map((row: any, i: number) =>
      `【${i + 1}行目】 ${Object.entries(row || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')}`,
    )
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

/* =========================
 * 財務サマリ / ポートフォリオをテキスト化（AI用）
 * ======================= */

/** Step3 の financeSummary (JSONB) を簡易テキストへ */
function summarizeFinanceSummary(financeSummary: any, limitYears = 4): string {
  if (!financeSummary) return '（サマリー未入力）';

  // Step3 側の構造：単純配列 or { rows: [...] } の両方を許容
  const rows: any[] = Array.isArray(financeSummary)
    ? financeSummary
    : Array.isArray(financeSummary?.rows)
    ? financeSummary.rows
    : [];

  if (!rows.length) return '（サマリー未入力）';

  // 年×事業の代表値を抜粋
  const lines: string[] = [];
  const byYear = new Map<number | string, any[]>();

  for (const r of rows) {
    const y = (r.year ?? r.fiscal_year ?? r.yearLabel ?? 'N/A') as number | string;
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(r);
  }

  const sortedYears = [...byYear.keys()].sort();
  for (const y of sortedYears.slice(0, limitYears)) {
    const group = byYear.get(y) || [];
    const yearLabel = String(y);
    // 各年について代表的な2〜3ユニット
    const unitLines = group
      .slice(0, 3)
      .map((r: any) => {
        const bu = r.business_unit ?? r.unitName ?? '全社';
        const rev = r.revenue ?? r.sales ?? r.net_sales;
        const op = r.operating_income ?? r.op ?? r.operatingProfit;
        const margin =
          r.operating_margin_pct ??
          r.opMargin ??
          (rev ? Math.round(((op ?? 0) / Number(rev || 1)) * 1000) / 10 : undefined);

        const revStr = rev != null ? `${rev}百万円` : '—';
        const opStr = op != null ? `${op}百万円` : '—';
        const mStr = margin != null ? `${margin}%` : '—';
        return `    - ${bu}: 売上=${revStr}, 営業利益=${opStr}, 利益率=${mStr}`;
      })
      .join('\n');

    lines.push(`  <${yearLabel}年>:\n${unitLines || '    - （データ不足）'}`);
  }

  return lines.join('\n');
}

/** businessPortfolio（B/Sマトリクス風）を簡易テキストへ */
function summarizeBusinessPortfolio(bp: any, limitUnits = 8): string {
  if (!bp || typeof bp !== 'object') return '（ポートフォリオ未入力）';

  const units: any[] = Array.isArray(bp.units) ? bp.units : [];
  if (!units.length) return '（ポートフォリオ未入力）';

  const lines = units.slice(0, limitUnits).map((u: any) => {
    const name = u.name ?? u.label ?? '不明ユニット';
    const rev = u.revenue ?? u.sales ?? u.netSales;
    const op = u.operatingProfit ?? u.profit ?? u.op;
    const growth = u.growthRate ?? u.growth ?? u.salesGrowthRate;
    const margin = u.profitMargin ?? u.margin ?? u.opMargin;

    const revStr = rev != null ? `${rev}百万円` : '—';
    const opStr = op != null ? `${op}百万円` : '—';
    const gStr = growth != null ? `${growth}%` : '—';
    const mStr = margin != null ? `${mStrFromUnknown(margin)}%` : '—';

    const pos =
      typeof growth === 'number' && typeof margin === 'number'
        ? growth >= 0 && margin >= 0
          ? '高成長×高収益（攻めの投資候補）'
          : growth >= 0 && margin < 0
          ? '高成長×低収益（テコ入れ前提の投資）'
          : growth < 0 && margin >= 0
          ? '低成長×高収益（収穫・守り）'
          : '低成長×低収益（撤退・縮小候補）'
        : 'ポジション不明';

    return `  - ${name}: 売上=${revStr}, 利益=${opStr}, 成長率=${gStr}, 利益率=${mStr} → ${pos}`;
  });

  return lines.join('\n');
}

function mStrFromUnknown(v: any): number {
  if (typeof v === 'number') return v;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  return NaN;
}

/* =========================
 * ハンドラ
 * ======================= */
export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsedReq = ReqSchema.safeParse(raw);

    if (!parsedReq.success) {
      return new NextResponse(JSON.stringify({ error: '入力の形式が不正です。' }), {
        status: 400,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
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
    } = parsedReq.data;

    if (!Array.isArray(departments) || departments.length === 0) {
      return new NextResponse(
        JSON.stringify({ error: '部門情報が未入力です。カスケード生成できません。' }),
        {
          status: 400,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        },
      );
    }

    const storyText = toTextStory(story);
    const hasValidInput =
      (typeof strategySummary === 'string' && strategySummary.trim().length > 0) ||
      (typeof storyText === 'string' && storyText.trim().length > 0);
    if (!hasValidInput) {
      return new NextResponse(
        JSON.stringify({
          error: '経営戦略ストーリーと要約の両方が空です。どちらかを入力してください。',
        }),
        {
          status: 400,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        },
      );
    }

    /* =========================
     * プロンプト組み立て（Ver4拡張）
     * ======================= */
    const summary =
      strategySummary?.trim() || storyText.slice(0, 160) || '（要約なし）';

    // 旧CSVの素の抜粋（参考情報）
    const financeCsvText =
      Array.isArray(csvFinanceData) && csvFinanceData.length > 0
        ? toLinesFromCsv(csvFinanceData, 5)
        : '（CSVベースの財務データなし）';

    // 新FinanceSummary / BusinessPortfolioのサマリ
    const financeSummaryText = summarizeFinanceSummary(financeSummary);
    const portfolioText = summarizeBusinessPortfolio(businessPortfolio);

    // 日本語ラベル補完
    const industryLabel = industry ? getIndustryLabel(industry, { full: true }) : '';
    const industryLine = industryLabel
      ? `${industryLabel}${industry ? `（${industry}）` : ''}`
      : industry ?? '（不明）';
    const industryContext = (industry && industryTemplates?.[industry]) || '';

    // 部門ごとの詳細文脈
    const deptBlocks = departments
      .map((d) => {
        const name = pickName(d);
        const answers = (d?.answers || []) as Array<{
          stepNumber: number;
          label?: string;
          answer?: string;
        }>;
        const dir = d?.direction || '';
        const exps = trimList(d?.expectations, 4);
        const focuses = trimList(d?.focusThemes, 4);

        const ansLines = (answers || [])
          .sort((a, b) => (a?.stepNumber || 0) - (b?.stepNumber || 0))
          .slice(0, 6)
          .map(
            (a) =>
              `  - Q${a.stepNumber}${
                a.label ? `（${a.label}）` : ''
              }: ${sanitizeText(a?.answer || '', 220)}`,
          )
          .join('\n');

        const projSeed = trimList(d?.projects, 5)
          .map((p) => `  - ${sanitizeText(p, 100)}`)
          .join('\n');

        const okrSeed = (Array.isArray(d?.okrs) ? d!.okrs! : [])
          .slice(0, 2)
          .map((o: any, i: number) => {
            const kr = trimList(o?.keyResults, 3)
              .map((k) => `"${sanitizeText(k, 80)}"`)
              .join(', ');
            return `  - OKR${i + 1}: O="${sanitizeText(
              o?.objective || '',
              100,
            )}" KR=[${kr}]`;
          })
          .join('\n');

        return `
[部門] ${name}
  direction: ${sanitizeText(dir || '', 140) || '（未設定）'}
  expectations:
${exps
  .map((e) => `    - ${sanitizeText(e, 120)}`)
  .join('\n') || '    - （未設定）'}
  focusThemes:
${focuses
  .map((f) => `    - ${sanitizeText(f, 120)}`)
  .join('\n') || '    - （未設定）'}
  answers (1..6):
${ansLines || '  - （未回答）'}
  seeds.projects:
${projSeed || '  - （なし）'}
  seeds.okr:
${okrSeed || '  - （なし）'}
`.trim();
      })
      .join('\n\n');

    const prompt = `
あなたは世界最高の経営戦略コンサルタントです。以下の情報をもとに、部門ごとの「実行に落ちる」提案を返してください。
- 入力には Ver4 のサマリー（direction/expectations/focusThemes）と 6回答（役まわり/既存/未来/犠牲/協力/撤退）が含まれる場合があります。
- 既存案（missionDraft/projects/okrs）があれば尊重し、矛盾や重複を取り除いて磨き直します。
- financeSummary / businessPortfolio に記載された売上・営業利益・利益率・成長率などとつながる OKR を優先し、「この部門の活動がどの財務指標をどれだけ動かすのか」が想像できる構造にしてください。

【業界背景・成功パターン】
${industryContext || '（該当テンプレートなし）'}

【経営者の想い】
${thought || '（未入力）'}

【MVV】
Mission: ${mvvMission ?? ''} / Vision: ${vision ?? ''} / Value: ${value ?? ''}

【SWOT】
強み: ${strength ?? ''} / 弱み: ${weakness ?? ''} / 機会: ${opportunity ?? ''} / 脅威: ${threat ?? ''}

【業種・規模】
${industryLine}、年商${String(revenue ?? '（不明）')}百万円、従業員${String(
      employees ?? '（不明）',
    )}人

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

--- 出力（日本語のJSONのみ、説明禁止） ---
{
  "strategy": { "summary": "会社全体の経営戦略要約（2〜3文）" },
  "departments": [
    {
      "name": "部門名（入力に存在するもののみ）",
      "missionDraft": "この部門の戦略ミッション案（1〜2文。どの財務指標に効くかも含める）",
      "projects": [
      { "title": "プロジェクト名（名詞句）", "reason": "目的・ねらい・期待成果（1文）" }
      ],
      "okrDraft": [
        {
          "objective": "短文：どの財務指標をどう変えるか（例：◯◯事業の売上成長と利益率改善）",
          "keyResults": [
            "主要指標1（例：売上◯◯◯百万円／前年+◯◯%）",
            "主要指標2（例：営業利益率◯◯%／+◯ポイント）",
            "活動指標（例：新規顧客◯◯社、アップセル率◯◯% など）"
          ],
          "owner": "任意：主要責任者ロール（例：営業部長）"
        }
      ],
      "needsCollab": ["誰と何をする（例：営業×マーケ：高付加価値案件の創出）"],
      "stopList": ["やめる/諦める項目（KRには含めない）"],
      "first90Days": ["最初の90日でやること（週/マイルストン粒度）"],
      "riskNotes": ["主要リスクと対処の一言"]
    }
  ]
}
制約：
- 「撤退/やめる（Q6）」や「犠牲（Q4）」に反するプロジェクトは提案しない。
- 「連携（Q5）」が必要な案件は needsCollab に明記し、プロジェクト名にも連携の相手/役割が想像できる表現にする。
- OKR は各部門1〜2セット、KRは必ず「数値＋期間」を含めて測定可能にする（％/百万円/件/人など）。
- financeSummary / businessPortfolio の数値とかけ離れた非現実的な目標（売上10倍など）は避け、現実的なレンジに留める。
- やめる/諦める項目は KR には含めず stopList にまとめる。
`.trim();

    /* =========================
     * OpenAI 呼び出し（JSON強制）
     * ======================= */
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0.35,
      max_tokens: 1600,
      messages: [
        { role: 'system', content: '必ずJSONのみを返し、日本語で。前後の説明は禁止。' },
        { role: 'user', content: prompt },
      ],
    });

    const rawContent = completion.choices?.[0]?.message?.content || '';
    const parsed = extractJsonObject(rawContent);

    if (!parsed) {
      return new NextResponse(
        JSON.stringify({ error: '生成結果のJSON解析に失敗しました。' }),
        {
          status: 500,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        },
      );
    }

    // スキーマ整形
    const safe = ResponseSchema.safeParse(parsed);
    if (!safe.success) {
      console.warn('generate-cascade: schema validation errors:', safe.error?.issues);
    }
    const normalized = (safe.success ? safe.data : parsed) as z.infer<
      typeof ResponseSchema
    >;

    // 入力部門名でフィルタ（余計な部門を落とす）
    const inputNames = new Set(onlyDeptNames(departments));
    const result = {
      strategy: {
        summary:
          typeof normalized?.strategy?.summary === 'string' &&
          normalized.strategy.summary.trim()
            ? normalized.strategy.summary.trim()
            : summary,
      },
      departments: Array.isArray(normalized?.departments)
        ? normalized.departments
            .map((d: any) => ({
              name: typeof d?.name === 'string' ? d.name.trim() : '',
              missionDraft:
                typeof d?.missionDraft === 'string'
                  ? d.missionDraft.trim()
                  : '',
              projects: Array.isArray(d?.projects)
                ? d.projects
                    .map((p: any) => ({
                      title:
                        typeof p?.title === 'string' ? p.title.trim() : '',
                      reason:
                        typeof p?.reason === 'string' ? p.reason.trim() : '',
                    }))
                    .filter((p: any) => p.title)
                : [],
              okrDraft: Array.isArray(d?.okrDraft)
                ? d.okrDraft
                    .map((o: any) => ({
                      objective:
                        typeof o?.objective === 'string'
                          ? o.objective.trim()
                          : '',
                      keyResults: Array.isArray(o?.keyResults)
                        ? o.keyResults
                            .map((k: any) =>
                              String(k || '').trim(),
                            )
                            .filter(Boolean)
                            .slice(0, 4)
                        : [],
                      owner:
                        typeof o?.owner === 'string' ? o.owner.trim() : '',
                    }))
                    .filter(
                      (o: any) =>
                        o.objective ||
                        ((o.keyResults?.length ?? 0) > 0),
                    )
                : [],
              needsCollab: trimList(d?.needsCollab, 6),
              stopList: trimList(d?.stopList, 6),
              first90Days: trimList(d?.first90Days, 8),
              riskNotes: trimList(d?.riskNotes, 6),
            }))
            .filter((d: any) => d.name && inputNames.has(d.name))
        : [],
    };

    return new NextResponse(JSON.stringify(result), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'x-cascade-shape': 'v4-6step-finance-aware',
      },
    });
  } catch (err: any) {
    console.error('❌ APIエラー（generate-cascade）:', err?.message || err);
    return new NextResponse(
      JSON.stringify({ error: 'サーバーエラーが発生しました。' }),
      {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      },
    );
  }
}
