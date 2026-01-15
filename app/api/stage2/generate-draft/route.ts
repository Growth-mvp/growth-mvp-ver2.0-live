// /app/api/stage2/generate-draft/route.ts
// STAGE2：ドライなたたき台生成API（story-process形式に寄せて安定化）
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';

/* ===== OpenAI設定 ===== */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const ALLOW_MODELS = new Set<string>([
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4o-mini-2024-07-18',
  'gpt-4o-2024-08-06',
]);

function pickSafeModel(): string {
  const envModel = process.env.OPENAI_MODEL || process.env.NEXT_PUBLIC_OPENAI_MODEL || '';
  return ALLOW_MODELS.has(envModel) ? envModel : 'gpt-4o-mini';
}

/* ===== 入力バリデーション ===== */
const IssueBlockSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  linkedMetrics: z.array(z.string()).optional(),
  scope: z.enum(['company', 'business']).optional(),
});

const MetricsSummarySchema = z
  .object({
    baseYear: z.number().optional(),
    revenueCagrPct: z.number().optional(),
    operatingMarginPct: z.number().optional(),
    operatingMarginPctLatest: z.number().optional(),
    operatingMarginRate: z.number().optional(),
    revenueGrowthRate: z.number().optional(),
    roic: z.number().optional(),
    roe: z.number().optional(),
    wacc: z.number().optional(),
    pbr: z.number().optional(),
    overallNote: z.string().optional(),
  })
  .passthrough();

const MVVSchema = z.object({
  thought: z.string().optional(),
  mission: z.string().optional(),
  vision: z.string().optional(),
  value: z.string().optional(),
});

const SWOTSchema = z.object({
  strength: z.string().optional(),
  weakness: z.string().optional(),
  opportunity: z.string().optional(),
  threat: z.string().optional(),
});

const InputSchema = z.object({
  issueBlocks: z.array(IssueBlockSchema),
  metricsSummary: MetricsSummarySchema.optional(),
  mvv: MVVSchema,
  swot: SWOTSchema,
  industry: z.string().optional(),
  segments: z.array(z.string()).optional(),
});

/* ===== 出力スキーマ ===== */
const StoryChapterSchema = z.object({
  title: z.string(),
  body: z.string(),
});

const WinPatternCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  valueDrivers: z.array(z.string()),
  rationale: z.string(),
  tradeoffs: z.string(),
  scope: z.enum(['company', 'segment']).optional(),
});

const OutputSchema = z.object({
  storyDraft: z.array(StoryChapterSchema),
  winPatternsCandidate: z.array(WinPatternCandidateSchema),
});

/* ===== ユーティリティ ===== */
function safeStringify(v: any): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function toLines(arr: any[]): string[] {
  return (Array.isArray(arr) ? arr : [])
    .map((x) => (typeof x === 'string' ? x.trim() : x))
    .filter(Boolean)
    .map((x) => (typeof x === 'string' ? x : safeStringify(x)));
}

/**
 * story-process形式を壊さないために、AIが body を object/array で返しても
 * 必ず「文字列」に正規化する（特に第2章対策）
 */
function normalizeChapterBody(ch: any, fallback: string): string {
  const body = ch?.body ?? ch?.content ?? ch;

  if (typeof body === 'string') return body;

  // body が配列で返るケース（文字列 or オブジェクトブロック）
  if (Array.isArray(body)) {
    // 配列がすでに文字列なら連結
    if (body.every((x) => typeof x === 'string')) {
      return toLines(body).join('\n');
    }

    // 配列がオブジェクト（第2章の戦略ブロック想定）
    const blocks = body
      .map((b: any, idx: number) => {
        if (!b || typeof b !== 'object') return null;

        const driver =
          b.valueDriver ??
          b.driver ??
          b.title ??
          b.name ??
          b.value_driver ??
          b.valueDrivers?.[0] ??
          '';

        const strategies =
          b.mainStrategies ??
          b.strategies ??
          b.strategy ??
          b.主要戦略 ??
          b.main_strategies ??
          [];

        const actions =
          b.actions90 ??
          b.ninetyDays ??
          b.actions ??
          b['90days'] ??
          b['90日アクション'] ??
          b.actions_90 ??
          [];

        const tradeoff = b.tradeoff ?? b.tradeoffs ?? b.トレードオフ ?? b.trade_off ?? '';

        const sLines = toLines(Array.isArray(strategies) ? strategies : [strategies]);
        const aLines = toLines(Array.isArray(actions) ? actions : [actions]);

        // driver が空で、中身も薄いなら JSON をそのまま出す（最悪でも読めるように）
        if (!driver && sLines.length === 0 && aLines.length === 0) {
          return `${idx + 1})\n${safeStringify(b)}`;
        }

        const out: string[] = [];
        out.push(`${idx + 1}) 狙う価値ドライバー：${String(driver).trim() || '（未指定）'}`);
        out.push(`   主要戦略：`);
        out.push(...(sLines.length ? sLines.map((s) => `   - ${s}`) : [`   - （未生成）`]));
        out.push(`   90日アクション：`);
        out.push(...(aLines.length ? aLines.map((a) => `   - ${a}`) : [`   - （未生成）`]));
        out.push(`   トレードオフ：${String(tradeoff).trim() || '（未生成）'}`);

        return out.join('\n');
      })
      .filter(Boolean) as string[];

    if (blocks.length) return blocks.join('\n\n');
    return safeStringify(body);
  }

  // body が単一オブジェクトで返るケース（{ blocks: [...] } / { sections: [...] } / 単一ブロック）
  if (body && typeof body === 'object') {
    const maybeBlocks = (body as any).blocks ?? (body as any).sections ?? (body as any).items ?? (body as any).list;
    if (Array.isArray(maybeBlocks)) {
      return normalizeChapterBody(maybeBlocks, fallback);
    }

    // 単一ブロック（第2章の1ブロックだけ object で返ったケースを救う）
    const looksLikeStrategyBlock =
      'valueDriver' in body ||
      'driver' in body ||
      'mainStrategies' in body ||
      'strategies' in body ||
      'actions90' in body ||
      'tradeoff' in body ||
      'tradeoffs' in body;

    if (looksLikeStrategyBlock) {
      return normalizeChapterBody([body], fallback);
    }

    return safeStringify(body);
  }

  return fallback;
}

function sanitize(text: any, max = 8000): string {
  const s =
    text === null || text === undefined
      ? ''
      : typeof text === 'string'
      ? text
      : typeof text === 'object'
      ? safeStringify(text)
      : String(text);

  return s.replace(/\u0000/g, '').replace(/\s+$/g, '').slice(0, max);
}

function extractJsonLoose(raw: string): any | null {
  if (!raw) return null;
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw);
  if (direct && (typeof direct === 'object' || Array.isArray(direct))) return direct;

  const fence = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const j = tryParse(fence[1]);
    if (j && (typeof j === 'object' || Array.isArray(j))) return j;
  }

  const obj = raw.match(/\{[\s\S]*\}/);
  if (obj?.[0]) {
    const j = tryParse(obj[0]);
    if (j && typeof j === 'object') return j;
  }
  return null;
}

function generateId(): string {
  return 'wp_' + Math.random().toString(36).substring(2, 10);
}

/* ===== 4章タイトル（進捗表示は含めない） ===== */
const CHAPTER_TITLES = [
  '第1章：なぜ今（現状）',
  '第2章：どう戦う（戦略）',
  '第3章：どんな未来像（会社の未来像）',
  '第4章：どう行動する（行動）',
] as const;

/* ===== プロンプト構築 ===== */
function buildSystemPrompt(): string {
  return `
あなたは経営戦略コンサルタントです。
STAGE1の論点と指標を根拠に、ドライで論理的なたたき台ストーリー（4章）と勝ち筋候補（2〜3案）を生成します。

【重要：トーン】
- エモーショナルな表現は避け、ファクトベースで論理的に書く
- 「我々は」「私たちは」などの主語は使わず、客観的に記述
- 数値や指標があれば積極的に引用する
- 抽象論より具体の方向性（何をどう変えるか）が伝わることを優先する

【最重要：型（厳守）】
- storyDraft[i].body は必ず「文字列」で返す（配列やオブジェクトは禁止）
- 第2章は自由作文ではなく、必ず以下の固定書式の“文字列”にする（1)〜3) まで）：

第2章：どう戦う（戦略）
1) 狙う価値ドライバー：...
   主要戦略：
   - ...
   90日アクション：
   - ...
   トレードオフ：...
2) 狙う価値ドライバー：...
   主要戦略：
   - ...
   90日アクション：
   - ...
   トレードオフ：...
3) 狙う価値ドライバー：...
   主要戦略：
   - ...
   90日アクション：
   - ...
   トレードオフ：...

【4章の要求（本文は必ず十分な長さ）】
1) 第1章（現状）：
- 冒頭に必ず「論点サマリ：」を置き、論点を3件、箇条書きで出す
  例）- 論点1：〇〇（スコープ：全社/事業）｜根拠指標：〇〇｜要約：〇〇
- その後、論点がなぜ重大か（影響/リスク/示唆）を具体に説明する

2) 第2章（戦略）：
- 上の固定書式（1)〜3)）で、価値ドライバー別に整理する
- 主要戦略・90日アクション・トレードオフを必ず含める

3) 第3章（未来像）：
- 戦略が成功した場合の未来像を、顧客価値・収益性・成長・資本効率・組織変化の観点で具体に描写する

4) 第4章（行動）：
- 最初の90日で何から着手するかを、施策の塊として提示する（KPIの例も含める）

【勝ち筋候補の要件】
- 2〜3案（比較検討可能な数）
- 各案に：name（勝ち筋名）、valueDrivers（改善したい指標/ドライバー）、rationale（根拠）、tradeoffs（副作用/捨てるもの）
- scope は会社全体なら "company"、事業部なら "segment"

【出力形式（厳守）】
必ずJSONのみ出力（コードブロックや説明文は禁止）
{
  "storyDraft": [
    {"title": "${CHAPTER_TITLES[0]}", "body": "..."},
    {"title": "${CHAPTER_TITLES[1]}", "body": "..."},
    {"title": "${CHAPTER_TITLES[2]}", "body": "..."},
    {"title": "${CHAPTER_TITLES[3]}", "body": "..."}
  ],
  "winPatternsCandidate": [
    {"id": "wp_xxx", "name": "...", "valueDrivers": ["収益性", "成長性"], "rationale": "...", "tradeoffs": "...", "scope": "company"}
  ]
}
`.trim();
}

function buildUserPrompt(input: z.infer<typeof InputSchema>): string {
  const { issueBlocks, metricsSummary, mvv, swot, industry, segments } = input;

  // 論点ブロックの整形
  const issueBlocksText = issueBlocks
    .map((ib, i) => {
      const metrics = ib.linkedMetrics?.length ? `（根拠指標: ${ib.linkedMetrics.join(', ')}）` : '';
      const scope = ib.scope === 'business' ? '【事業レベル】' : '【全社】';
      return `${i + 1}. ${scope} ${ib.title}${metrics}\n   ${ib.description || ''}`.trim();
    })
    .join('\n');

  // 指標サマリの整形
  const metricsText = metricsSummary
    ? [
        metricsSummary.roic !== undefined ? `ROIC: ${metricsSummary.roic.toFixed(1)}%` : null,
        metricsSummary.wacc !== undefined ? `WACC: ${metricsSummary.wacc.toFixed(1)}%` : null,
        metricsSummary.roic !== undefined && metricsSummary.wacc !== undefined
          ? `スプレッド: ${(metricsSummary.roic - metricsSummary.wacc).toFixed(1)}%`
          : null,
        metricsSummary.pbr !== undefined ? `PBR: ${metricsSummary.pbr.toFixed(2)}倍` : null,
        (metricsSummary.revenueCagrPct ?? metricsSummary.revenueGrowthRate) !== undefined
          ? `売上CAGR: ${(metricsSummary.revenueCagrPct ?? metricsSummary.revenueGrowthRate)?.toFixed(1)}%`
          : null,
        (metricsSummary.operatingMarginPct ??
          metricsSummary.operatingMarginPctLatest ??
          metricsSummary.operatingMarginRate) !== undefined
          ? `営業利益率: ${(
              metricsSummary.operatingMarginPct ??
              metricsSummary.operatingMarginPctLatest ??
              metricsSummary.operatingMarginRate
            )?.toFixed(1)}%`
          : null,
      ]
        .filter(Boolean)
        .join(' / ')
    : '（指標データなし）';

  return `【STAGE1で特定された論点】
${issueBlocksText}

【財務指標サマリ】
${metricsText}
${metricsSummary?.overallNote ? `所感: ${metricsSummary.overallNote}` : ''}

【MVV（ミッション・ビジョン・バリュー）】
- Mission: ${sanitize(mvv.mission, 300) || '（未入力）'}
- Vision: ${sanitize(mvv.vision, 300) || '（未入力）'}
- Value: ${sanitize(mvv.value, 300) || '（未入力）'}
${mvv.thought ? `- 経営者の思い: ${sanitize(mvv.thought, 500)}` : ''}

【SWOT分析】
- 強み: ${sanitize(swot.strength, 400) || '（未入力）'}
- 弱み: ${sanitize(swot.weakness, 400) || '（未入力）'}
- 機会: ${sanitize(swot.opportunity, 400) || '（未入力）'}
- 脅威: ${sanitize(swot.threat, 400) || '（未入力）'}

${industry ? `【業種】${industry}` : ''}
${segments?.length ? `【事業セグメント】${segments.join(', ')}` : ''}

上記の情報を踏まえ、4章ストーリーと勝ち筋候補（2〜3案）を生成してください。
第1章は必ず「論点サマリ：」を含め、根拠指標を可能な範囲で引用してください。
第2章は必ず固定書式（1)〜3)）の“文字列”で返してください。`;
}

/* ===== APIハンドラ ===== */
export async function POST(req: NextRequest) {
  try {
    // API Key チェック
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY is missing' }, { status: 500 });
    }

    const body = await req.json();

    // 入力バリデーション
    const parseResult = InputSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.format() }, { status: 400 });
    }

    const input = parseResult.data;

    // 論点が空の場合
    if (input.issueBlocks.length === 0) {
      return NextResponse.json({ error: 'issueBlocks is empty. Please complete STAGE1 first.' }, { status: 400 });
    }

    const model = pickSafeModel();
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(input);

    // OpenAI API呼び出し（タイムアウトはやや長めに：aborted対策）
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 75000);

    let raw = '';
    try {
      const completion = await openai.chat.completions.create(
        {
          model,
          temperature: 0.25,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 4800,
        },
        { signal: controller.signal }
      );
      raw = completion.choices?.[0]?.message?.content?.trim() || '';
    } catch (e: any) {
      // フォールバック（JSON強制を外す）
      try {
        const completion2 = await openai.chat.completions.create(
          {
            model,
            temperature: 0.25,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_tokens: 4800,
          },
          { signal: controller.signal }
        );
        raw = completion2.choices?.[0]?.message?.content?.trim() || '';
      } catch (e2: any) {
        clearTimeout(timer);
        console.error('[stage2/generate-draft] OpenAI error:', e2?.message || e2);
        return NextResponse.json({ error: e2?.message || 'OpenAI API error' }, { status: 500 });
      }
    } finally {
      clearTimeout(timer);
    }

    // 開発環境：観測ログ（raw length）
    if (process.env.NODE_ENV === 'development') {
      console.log(`[stage2/generate-draft] raw length: ${raw.length}`);
    }

    // JSON抽出
    const parsed = extractJsonLoose(raw);
    if (!parsed) {
      console.error('[stage2/generate-draft] Failed to parse JSON:', raw.slice(0, 500));
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
    }

    // storyDraft の抽出
    let storyDraft = parsed.storyDraft || parsed.story || parsed.chapters || [];
    if (!Array.isArray(storyDraft)) storyDraft = [];

    // 開発環境：観測ログ（parsed storyDraft lengths）
    if (process.env.NODE_ENV === 'development') {
      console.log(
        '[stage2/generate-draft] parsed.storyDraft lengths:',
        (storyDraft as any[]).map((ch: any, i: number) => `Ch${i}: ${(ch?.body || ch?.content || '').length}`)
      );
    }

    // 4章に満たない場合は補完（章本文は8000文字まで許容）
    const normalizedStory = CHAPTER_TITLES.map((title, i) => {
      const fallback = '（この章は未生成です）';
      const ch = (storyDraft as any[])[i] ?? null;
      const bodyText = normalizeChapterBody(ch, fallback);
      return {
        title,
        body: sanitize(bodyText || fallback, 8000),
      };
    });

    // 開発環境：観測ログ（normalized story lengths）
    if (process.env.NODE_ENV === 'development') {
      console.log(
        '[stage2/generate-draft] normalizedStory lengths:',
        normalizedStory.map((ch, i) => `Ch${i}: ${ch.body.length}`)
      );
    }

    // winPatternsCandidate の正規化
    let winPatternsCandidate = parsed.winPatternsCandidate || parsed.winPatterns || parsed.candidates || [];
    if (!Array.isArray(winPatternsCandidate)) winPatternsCandidate = [];

    const normalizedWinPatterns = (winPatternsCandidate as any[]).slice(0, 5).map((wp: any, i: number) => ({
      id: wp.id || generateId(),
      name: sanitize(wp.name || wp.title || `勝ち筋候補 ${i + 1}`, 100),
      valueDrivers: Array.isArray(wp.valueDrivers)
        ? wp.valueDrivers.map((v: any) => sanitize(String(v), 50))
        : Array.isArray(wp.valueDriver)
        ? wp.valueDriver.map((v: any) => sanitize(String(v), 50))
        : [],
      rationale: sanitize(wp.rationale || wp.reason || '', 900),
      tradeoffs: sanitize(wp.tradeoffs || wp.tradeoff || '', 900),
      scope: wp.scope === 'segment' ? 'segment' : 'company',
    }));

    // 勝ち筋候補が0件の場合、フォールバック生成
    if (normalizedWinPatterns.length === 0) {
      normalizedWinPatterns.push({
        id: generateId(),
        name: '収益性改善',
        valueDrivers: ['営業利益率', 'ROIC'],
        rationale: '論点から導かれる基本的な改善方向',
        tradeoffs: '短期的な成長投資とのバランス',
        scope: 'company',
      });
    }

    // 開発環境：観測ログ（winPatternsCandidate length）
    if (process.env.NODE_ENV === 'development') {
      console.log('[stage2/generate-draft] winPatternsCandidate count:', normalizedWinPatterns.length);
    }

    const result = {
      storyDraft: normalizedStory,
      winPatternsCandidate: normalizedWinPatterns,
    };

    // 出力バリデーション（ログ用）
    const outputValidation = OutputSchema.safeParse(result);
    if (!outputValidation.success) {
      console.warn('[stage2/generate-draft] Output validation warning:', outputValidation.error.format());
    }

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: any) {
    console.error('[stage2/generate-draft] Server error:', error?.message || error);
    const status = error?.name === 'AbortError' ? 504 : 500;
    return NextResponse.json({ error: error?.message || 'Server error' }, { status });
  }
}
