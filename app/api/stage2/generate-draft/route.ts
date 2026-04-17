// /app/api/stage2/generate-draft/route.ts
// STAGE2：ドライなたたき台生成API（story-process形式に寄せて安定化 + CEO/MVV/SWOT反映を強制）
//
// 改修ポイント（このファイル内で完結）
// - ★「生成されない」主因：InputSchema/issueBlocks必須 & issueBlocks空で400 return を緩和
//   => issueBlocks/mvv/swot を optional + default で受け、論点ゼロでも生成続行（未入力と明記）
// - 第2章の固定書式に「根拠（SWOT）」行を追加（O/T各2件・S/W各1件）
// - normalizeChapterBody：AIが第2章をobject/arrayで返しても固定書式（根拠SWOT含む）に確実に文字列化
// - Repair(2nd pass)：固定書式とSWOT具体語の追記を最小修正で強制

import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership, assertMinRole } from '@/lib/server/rbacGuard';
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
  summary: z.string().optional(), // compactPayloadが参照
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
    roicPctLatest: z.number().optional(),
    roe: z.number().optional(),
    wacc: z.number().optional(),
    pbr: z.number().optional(),
    pbrManual: z.number().optional(),
    overallNote: z.string().optional(),
  })
  .passthrough();

const MVVSchema = z
  .object({
    thought: z.string().optional(),
    mission: z.string().optional(),
    vision: z.string().optional(),
    value: z.string().optional(),
  })
  .passthrough();

const SWOTSchema = z
  .object({
    strength: z.string().optional(),
    weakness: z.string().optional(),
    opportunity: z.string().optional(),
    threat: z.string().optional(),
  })
  .passthrough();

const BusinessSegmentDetailSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional().default(''),
    summary: z.string().optional(),
    keyCustomers: z.array(z.string()).optional().default([]),
    scope: z.string().optional(),
  })
  .passthrough();

/**
 * 事業ポートフォリオはプロジェクト側で型が揺れる可能性が高いので、
 * ここでは「あるなら受け取り、プロンプトへ文字列化して反映」する方針で緩く受ける。
 */
const BusinessPortfolioSchema = z.any().optional();

const SWOTSuggestionsSchema = z
  .object({
    opportunity: z.array(z.string()).optional(),
    threat: z.array(z.string()).optional(),
    generatedAt: z.string().optional(),
  })
  .optional();

const CompanyTargetSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    unit: z.string(),
    base: z.number(),
    low: z.number().optional(),
    high: z.number().optional(),
    dueYear: z.number().optional(),
    priority: z.number().optional(),
    linkedIssueIds: z.array(z.string()).optional(),
    rationale: z.string().optional(),
  })
  .passthrough();

/**
 * ★重要：生成されない主因対策
 * - issueBlocks/mvv/swot を optional + default で受ける
 * - STAGE1未完（論点ゼロ）でも生成可能に（プロンプトで未入力明記）
 * - companyTargets も optional + default で受ける（North Star未入力でも生成可能に）
 */
const InputSchema = z.object({
  issueBlocks: z.array(IssueBlockSchema).optional().default([]),
  metricsSummary: MetricsSummarySchema.optional(),
  ceoIntent: z.string().optional(), // CEO意図（経営者の思い）
  mvv: MVVSchema.optional().default({}),
  swot: SWOTSchema.optional().default({}),
  swotSuggestions: SWOTSuggestionsSchema, // AI提案のO/T候補（参考）
  companyTargets: z.array(CompanyTargetSchema).optional().default([]), // ★ North Star（会社の数値目標）
  industry: z.string().optional(),
  segments: z.array(z.string()).optional(),
  businessSegments: z.array(BusinessSegmentDetailSchema).optional().default([]),
  businessPortfolio: BusinessPortfolioSchema,
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
 *
 * ★改修：第2章固定書式に「根拠（SWOT）」行を含めて整形できるようにする
 */
function normalizeChapterBody(ch: any, fallback: string): string {
  const body = ch?.body ?? ch?.content ?? ch;

  if (typeof body === 'string') return body;

  if (Array.isArray(body)) {
    if (body.every((x) => typeof x === 'string')) {
      return toLines(body).join('\n');
    }

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

        // ★追加：根拠（SWOT）を拾う（いずれかのキー揺れを救う）
        const evidence =
          b.evidenceSwot ??
          b.swotEvidence ??
          b.evidence ??
          b.rationaleEvidence ??
          b['根拠（SWOT）'] ??
          b['根拠SWOT'] ??
          b['根拠'] ??
          null;

        const sLines = toLines(Array.isArray(strategies) ? strategies : [strategies]);
        const aLines = toLines(Array.isArray(actions) ? actions : [actions]);

        const evText =
          evidence === null || evidence === undefined
            ? ''
            : typeof evidence === 'string'
            ? evidence.trim()
            : Array.isArray(evidence)
            ? toLines(evidence).join(' / ')
            : typeof evidence === 'object'
            ? safeStringify(evidence)
            : String(evidence);

        if (!driver && sLines.length === 0 && aLines.length === 0 && !evText) {
          return `${idx + 1})\n${safeStringify(b)}`;
        }

        const out: string[] = [];
        out.push(`${idx + 1}) 狙う価値ドライバー：${String(driver).trim() || '（未指定）'}`);
        out.push(`   主要戦略：`);
        out.push(...(sLines.length ? sLines.map((s) => `   - ${s}`) : [`   - （未生成）`]));
        out.push(`   90日アクション：`);
        out.push(...(aLines.length ? aLines.map((a) => `   - ${a}`) : [`   - （未生成）`]));
        out.push(`   根拠（SWOT）：${evText ? evText : '（未提示）'}`);
        out.push(`   トレードオフ：${String(tradeoff).trim() || '（未生成）'}`);

        return out.join('\n');
      })
      .filter(Boolean) as string[];

    if (blocks.length) return blocks.join('\n\n');
    return safeStringify(body);
  }

  if (body && typeof body === 'object') {
    const maybeBlocks = (body as any).blocks ?? (body as any).sections ?? (body as any).items ?? (body as any).list;
    if (Array.isArray(maybeBlocks)) {
      return normalizeChapterBody(maybeBlocks, fallback);
    }

    const looksLikeStrategyBlock =
      'valueDriver' in body ||
      'driver' in body ||
      'mainStrategies' in body ||
      'strategies' in body ||
      'actions90' in body ||
      'tradeoff' in body ||
      'tradeoffs' in body ||
      'evidenceSwot' in body ||
      'swotEvidence' in body ||
      'evidence' in body ||
      '根拠（SWOT）' in body ||
      '根拠SWOT' in body ||
      '根拠' in body;

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

/**
 * ★診断用：JSON parse を堅牢化
 * - code fence を除去
 * - cleaned text を返す
 */
function cleanJsonString(raw: string): { cleaned: string; wasCleaned: boolean } {
  if (!raw) return { cleaned: '', wasCleaned: false };

  let text = raw.trim();

  // code fence 除去
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    text = fence[1].trim();
    return { cleaned: text, wasCleaned: true };
  }

  // markdown backtick 除去
  if (text.startsWith('`') && text.endsWith('`')) {
    text = text.slice(1, -1).trim();
    return { cleaned: text, wasCleaned: true };
  }

  return { cleaned: text, wasCleaned: false };
}

function extractJsonLoose(raw: string): { parsed: any | null; diagnostic: any } {
  const diagnostic: any = { rawLen: raw.length };

  if (!raw) return { parsed: null, diagnostic };

  const { cleaned, wasCleaned } = cleanJsonString(raw);
  diagnostic.wasCleaned = wasCleaned;
  diagnostic.cleanedLen = cleaned.length;

  const tryParse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch (e: any) {
      diagnostic.parseError = e?.message || String(e);
      return null;
    }
  };

  // 直接 parse（cleaned text）
  const direct = tryParse(cleaned);
  if (direct && (typeof direct === 'object' || Array.isArray(direct))) {
    diagnostic.method = 'direct';
    return { parsed: direct, diagnostic };
  }

  // {} を探す
  const obj = cleaned.match(/\{[\s\S]*\}/);
  if (obj?.[0]) {
    diagnostic.method = 'braceExtract';
    const j = tryParse(obj[0]);
    if (j && typeof j === 'object') return { parsed: j, diagnostic };
  }

  diagnostic.method = 'failed';
  return { parsed: null, diagnostic };
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

/* ===== 反映強制：引用フレーズ抽出（軽量） ===== */
function splitPhrases(s?: string, limit = 6): string[] {
  if (!s) return [];
  const raw = sanitize(s, 1200)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[「」『』"]/g, '')
    .trim();
  if (!raw) return [];
  const parts = raw
    .split(/[\n,、。・/／;；:：]+/g)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
  const short = parts.map((p) => (p.length > 40 ? p.slice(0, 40) : p));
  return Array.from(new Set(short)).slice(0, limit);
}

function buildMustQuotePhrases(input: z.infer<typeof InputSchema>) {
  const ceo = input.ceoIntent?.trim()
    ? [sanitize(input.ceoIntent, 120).replace(/[\r\n]+/g, ' ').trim()]
    : [];
  const mission = splitPhrases(input.mvv?.mission, 3);
  const vision = splitPhrases(input.mvv?.vision, 2);
  const value = splitPhrases(input.mvv?.value, 2);

  const s = splitPhrases(input.swot?.strength, 2);
  const w = splitPhrases(input.swot?.weakness, 2);
  const o = splitPhrases(input.swot?.opportunity, 8);
  const t = splitPhrases(input.swot?.threat, 8);

  return { ceo, mission, vision, value, s, w, o, t };
}

function countHits(text: string, candidates: string[]): number {
  if (!text || candidates.length === 0) return 0;
  const hay = text;
  let n = 0;
  for (const c of candidates) {
    const cc = c?.trim();
    if (!cc) continue;
    if (hay.includes(cc)) n += 1;
  }
  return n;
}

function computeCoverageIssues(
  story: { title: string; body: string }[],
  must: ReturnType<typeof buildMustQuotePhrases>
) {
  const all = story.map((c) => c.body).join('\n');
  const ch1 = story[0]?.body || '';
  const ch2 = story[1]?.body || '';
  const ch3 = story[2]?.body || '';
  const ch4 = story[3]?.body || '';

  const missing: string[] = [];

  if (must.ceo.length > 0 && countHits(ch1, must.ceo) < 1) {
    missing.push(`第1章にCEO意図の引用（例: ${must.ceo[0]}）を1つ以上含める`);
  }

  if (must.mission.length > 0 && countHits(all, must.mission) < 1) {
    missing.push(`Missionの固有フレーズを本文に1つ以上含める（候補: ${must.mission.join(' / ')}）`);
  }

  if (must.vision.length > 0 && countHits(ch3, must.vision) < 1) {
    missing.push(`第3章にVisionのキーワードを1つ以上含める（候補: ${must.vision.join(' / ')}）`);
  }
  if (must.value.length > 0 && countHits(ch4, must.value) < 1) {
    missing.push(`第4章にValueのキーワードを1つ以上含める（候補: ${must.value.join(' / ')}）`);
  }

  if (must.o.length > 0 && countHits(ch2, must.o) < 2) {
    missing.push(`第2章に機会（O）の具体語を2つ以上含める（候補: ${must.o.slice(0, 6).join(' / ')}）`);
  }
  if (must.t.length > 0 && countHits(ch2, must.t) < 2) {
    missing.push(`第2章に脅威（T）の具体語を2つ以上含める（候補: ${must.t.slice(0, 6).join(' / ')}）`);
  }
  if (must.s.length > 0 && countHits(ch2, must.s) < 1) {
    missing.push(`第2章に強み（S）の具体語を1つ以上含める（候補: ${must.s.join(' / ')}）`);
  }
  if (must.w.length > 0 && countHits(ch2, must.w) < 1) {
    missing.push(`第2章に弱み（W）の具体語を1つ以上含める（候補: ${must.w.join(' / ')}）`);
  }

  const hasBizHeading = ch1.includes('当社の事業と顧客') || ch3.includes('当社の事業と顧客');
  if (!hasBizHeading) {
    missing.push(`第1章または第3章の冒頭に小見出し「当社の事業と顧客」を含める`);
  }

  return missing;
}

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

【最重要：反映強制（厳守）】
- 入力のCEO意図 / MVV / SWOT は「参考」ではなく「根拠」である。本文に“具体語”として必ず登場させる。
- 特にMissionは落ちやすいので、Missionの固有語を本文に必ず含める（言い換えで誤魔化さない）。
- SWOTのO/Tは“最低各2件”を第2章で根拠として具体語のまま引用する（一般論は禁止）。

【最重要：事業セグメント前提（厳守）】
- 入力に「事業セグメント前提」が与えられた場合、それを必ず本文に反映する
- 次の条件を必ず満たす：
  1) 第1章または第3章の冒頭に「当社の事業と顧客」という小見出しを作る（未入力なら"未入力"と明記）
  2) 各セグメント名を本文中に必ず1回以上登場させる
  3) 主要顧客（keyCustomers）を"具体語"として本文に含める（一般論禁止）
- 事業ポートフォリオが与えられた場合、戦略案（第2章）と未来像（第3章）に矛盾がないよう反映する

【最重要：North Star Metrics（会社の数値目標）（厳守）】
- 入力に「会社の数値目標」が与えられた場合、その目標値（ラベル・基準値・単位）を本文に最低1つ以上含める
- 各North Star目標に紐付された論点（linkedIssueIds）がある場合、その論点を第2章（戦略）または第4章（行動）で「この論点が達成に必須」という文脈で引用する
- North Star目標が複数ある場合、最優先度のものを本文で明確に言及する
- North Star目標が空の場合は「★North Star未入力のため、一般化した」と第1章の冒頭に明記する

【最重要：型（厳守）】
- storyDraft[i].body は必ず「文字列」で返す（配列やオブジェクトは禁止）
- 第2章は自由作文ではなく、必ず以下の固定書式の“文字列”にする（1)〜3) まで）
- ★第2章の各ブロックに「根拠（SWOT）」行を必ず含める（O/T各2件、S/W各1件の具体語を入れる）

第2章：どう戦う（戦略）
1) 狙う価値ドライバー：...
   主要戦略：
   - ...
   90日アクション：
   - ...
   根拠（SWOT）：機会(O): ... / ...｜脅威(T): ... / ...｜強み(S): ...｜弱み(W): ...
   トレードオフ：...
2) 狙う価値ドライバー：...
   主要戦略：
   - ...
   90日アクション：
   - ...
   根拠（SWOT）：機会(O): ... / ...｜脅威(T): ... / ...｜強み(S): ...｜弱み(W): ...
   トレードオフ：...
3) 狙う価値ドライバー：...
   主要戦略：
   - ...
   90日アクション：
   - ...
   根拠（SWOT）：機会(O): ... / ...｜脅威(T): ... / ...｜強み(S): ...｜弱み(W): ...
   トレードオフ：...

【4章の要求（本文は必ず十分な長さ）】
1) 第1章（現状）：
- 冒頭に必ず「論点サマリ：」を置き、論点を3件、箇条書きで出す
  例）- 論点1：〇〇（スコープ：全社/事業）｜根拠指標：〇〇｜要約：〇〇
- その後、論点がなぜ重大か（影響/リスク/示唆）を具体に説明する
- さらに「CEO意図から見た危機・必然性」を1段落必ず含める（入力が未入力なら未入力と明記）

2) 第2章（戦略）：
- 上の固定書式（1)〜3)）で、価値ドライバー別に整理する
- 主要戦略・90日アクション・トレードオフを必ず含める
- SWOTのO/Tを最低各2件、S/Wを最低各1件、具体語として“根拠（SWOT）”行に含める

3) 第3章（未来像）：
- 戦略が成功した場合の未来像を、顧客価値・収益性・成長・資本効率・組織変化の観点で具体に描写する
- MVV（Mission/Vision/Value）のキーワードを少なくとも1つ以上含める（未入力なら未入力と明記）

4) 第4章（行動）：
- 最初の90日で何から着手するかを、施策の塊として提示する（KPIの例も含める）
- Value（行動原則）に沿った実行ルールを最低1つ組み込む（未入力なら未入力と明記）

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

/**
 * businessSegments を「事業セグメント前提」として整形
 * 未入力は行ごと省略、keyCustomers は配列から join
 */
function buildBusinessSegmentsPreamble(segments?: any[]): string {
  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    return '';
  }

  const lines: string[] = [];
  for (const seg of segments) {
    const name = typeof seg?.name === 'string' ? seg.name.trim() : '';
    if (!name) continue;

    const summary = typeof seg?.summary === 'string' ? seg.summary.trim() : '';
    const keyCustomers = Array.isArray(seg?.keyCustomers)
      ? seg.keyCustomers
          .map((c: any) => (typeof c === 'string' ? c.trim() : ''))
          .filter(Boolean)
          .slice(0, 3)
          .join(', ')
      : '';

    lines.push(`- セグメント：${name}`);
    if (summary) lines.push(`  事業概要：${summary}`);
    if (keyCustomers) lines.push(`  主要顧客：${keyCustomers}`);
  }

  return lines.length > 0 ? `【事業セグメント前提】\n${lines.join('\n')}\n` : '';
}

function buildBusinessPortfolioText(portfolio: any): string {
  if (!portfolio) return '';
  if (typeof portfolio === 'string') {
    const s = portfolio.trim();
    return s ? `【現在の事業ポートフォリオ】\n${sanitize(s, 1800)}\n` : '';
  }
  if (Array.isArray(portfolio)) {
    const lines = portfolio
      .map((x) => {
        if (typeof x === 'string') return x.trim();
        if (x && typeof x === 'object') {
          const name = x.name ?? x.segmentName ?? x.title ?? x.business ?? x.id ?? '';
          const share = x.share ?? x.revenueShare ?? x.salesShare ?? x.mix ?? '';
          const note = x.note ?? x.comment ?? x.memo ?? '';
          const parts = [
            String(name || '').trim(),
            share !== '' ? `（比率: ${String(share).trim()}）` : '',
            note ? `- ${String(note).trim()}` : '',
          ]
            .filter(Boolean)
            .join(' ');
          return parts || safeStringify(x);
        }
        return String(x ?? '').trim();
      })
      .filter(Boolean);
    return lines.length
      ? `【現在の事業ポートフォリオ】\n- ${lines.join('\n- ')}\n`
      : `【現在の事業ポートフォリオ】\n${safeStringify(portfolio).slice(0, 1800)}\n`;
  }
  if (typeof portfolio === 'object') {
    return `【現在の事業ポートフォリオ】\n${sanitize(safeStringify(portfolio), 1800)}\n`;
  }
  return `【現在の事業ポートフォリオ】\n${sanitize(String(portfolio), 1800)}\n`;
}

/**
 * ★ F-1) 軽量化ヘルパー：プロンプト入力をコンパクト化
 * 目的：OpenAI呼び出しを 10-20秒で返す
 * 手法：issueBlocks/swot/metrics/segments を要点だけに圧縮
 */
function clip(s: any, n: number): string {
  const str = typeof s === 'string' ? s : String(s ?? '');
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function compactPayload(input: z.infer<typeof InputSchema>) {
  const issueBlocks = Array.isArray(input.issueBlocks)
    ? input.issueBlocks
        .slice(0, 5)
        .map((b: any) => ({
          title: clip(String(b?.title ?? ''), 120),
          summary: clip(String(b?.summary ?? b?.description ?? ''), 240),
        }))
    : [];

  const swot = input?.swot ?? {};
  const compactSwotArray = (arr: any[]): string[] =>
    Array.isArray(arr)
      ? arr
          .slice(0, 3)
          .map((x) => clip(String(x ?? ''), 200))
          .filter(Boolean)
      : [];

  const swotCompact = {
    S: compactSwotArray(typeof swot.strength === 'string' ? swot.strength.split(/[\n,、。・/／]/) : []),
    W: compactSwotArray(typeof swot.weakness === 'string' ? swot.weakness.split(/[\n,、。・/／]/) : []),
    O: compactSwotArray(typeof swot.opportunity === 'string' ? swot.opportunity.split(/[\n,、。・/／]/) : []),
    T: compactSwotArray(typeof swot.threat === 'string' ? swot.threat.split(/[\n,、。・/／]/) : []),
  };

  const round1 = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : undefined;

  const ms = input?.metricsSummary ?? null;
  const metricsCompact = ms
    ? {
        revenueCagrPct: round1(ms.revenueCagrPct),
        operatingMarginPctLatest: round1(ms.operatingMarginPctLatest),
        roic: round1((ms as any).roicPctLatest ?? ms.roic),
        pbr: (ms as any).pbr ?? (ms as any).pbrManual ?? undefined,
      }
    : null;

  const businessSegments = Array.isArray(input.businessSegments)
    ? input.businessSegments
        .slice(0, 8)
        .map((s: any) => ({
          name: clip(String(s?.name ?? ''), 60),
        }))
        .filter((s: any) => s.name)
    : [];

  const ceoIntent = clip(String(input.ceoIntent ?? ''), 200);

  const mvv = input?.mvv ?? {};
  const mvvCompact = {
    mission: clip(String(mvv.mission ?? ''), 150),
    vision: clip(String(mvv.vision ?? ''), 150),
    value: clip(String(mvv.value ?? ''), 100),
  };

  // ★ companyTargets 軽量化（最大6件）
  const companyTargets = Array.isArray(input.companyTargets)
    ? input.companyTargets
        .slice(0, 6)
        .map((t: any) => ({
          label: clip(String(t?.label ?? ''), 60),
          unit: clip(String(t?.unit ?? ''), 30),
          base: typeof t?.base === 'number' ? t.base : undefined,
          low: typeof t?.low === 'number' ? t.low : undefined,
          high: typeof t?.high === 'number' ? t.high : undefined,
          dueYear: typeof t?.dueYear === 'number' ? t.dueYear : undefined,
          linkedIssueIds: Array.isArray(t?.linkedIssueIds) ? t.linkedIssueIds.slice(0, 3) : [],
          rationale: clip(String(t?.rationale ?? ''), 150),
        }))
        .filter((t: any) => t.label && Number.isFinite(t.base))
    : [];

  return {
    issueBlocks,
    swot: swotCompact,
    metrics: metricsCompact,
    businessSegments,
    ceoIntent,
    mvv: mvvCompact,
    companyTargets,
  };
}

function buildUserPrompt(
  input: z.infer<typeof InputSchema>,
  precomputedCompact?: ReturnType<typeof compactPayload>
): string {
  const compact = precomputedCompact ?? compactPayload(input);

  const {
    metricsSummary,
    mvv: mvvOrig,
    swot,
    swotSuggestions,
    industry,
    segments,
    businessPortfolio,
  } = input;

  // compactから取得
  const issueBlocks = compact.issueBlocks;
  const ceoIntent = compact.ceoIntent;
  const businessSegments = compact.businessSegments;
  const mvv = { ...(mvvOrig ?? {}), ...(compact.mvv ?? {}) };
  const companyTargets = compact.companyTargets ?? [];

  const swotCompact = {
    strength: compact.swot.S.join(' / '),
    weakness: compact.swot.W.join(' / '),
    opportunity: compact.swot.O.join(' / '),
    threat: compact.swot.T.join(' / '),
  };

  // ★論点ゼロでも生成続行：プロンプトで未入力明記
  const issueBlocksText =
    issueBlocks.length > 0
      ? issueBlocks
          .map((ib, i) => `${i + 1}. ${ib.title}\n   ${ib.summary || ''}`.trim())
          .join('\n')
      : '（論点未入力：STAGE1の論点が未生成/未保存のため、一般化してドラフトを作成する）';

  const businessSegmentsPreamble = buildBusinessSegmentsPreamble(businessSegments);
  const portfolioText = buildBusinessPortfolioText(businessPortfolio);

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

  const segmentsText = segments?.length ? `【事業セグメント（名称のみ）】${segments.join(', ')}` : '';

  const ceoIntentText = ceoIntent?.trim() ? sanitize(ceoIntent, 600) : '';

  const swotSuggestionsBlock =
    swotSuggestions && (swotSuggestions.opportunity?.length || swotSuggestions.threat?.length)
      ? `
【AI提案のSWOT候補（参考）】
- 提案機会: ${swotSuggestions.opportunity?.slice(0, 3).join(' / ') || 'なし'}
- 提案脅威: ${swotSuggestions.threat?.slice(0, 3).join(' / ') || 'なし'}`
      : '';

  // ★North Star Metricsブロック
  const northStarBlock =
    companyTargets && companyTargets.length > 0
      ? `
【会社の数値目標（North Star Metrics）】
${companyTargets
  .map((target) => {
    // linkedIssueIds を issueBlocks のタイトルに解決
    const linkedIssueTitles = target.linkedIssueIds
      .map((issueId: string) => {
        // issueId は IssueBlock.title として保存されている
        const matchedIssue = issueBlocks.find((ib) => ib.title === issueId);
        return matchedIssue ? matchedIssue.title : issueId;
      })
      .filter(Boolean);

    // 範囲表記（low/highがあれば）
    const rangeText = target.low !== undefined && target.high !== undefined
      ? `（${target.low}〜${target.high}）`
      : target.low !== undefined
      ? `（最低: ${target.low}）`
      : target.high !== undefined
      ? `（最大: ${target.high}）`
      : '';

    // 年度表記
    const dueYearText = target.dueYear ? `【到達年度: ${target.dueYear}年】` : '';

    // 紐付論点
    const linkedIssuesText = linkedIssueTitles.length > 0
      ? `【紐付論点】${linkedIssueTitles.join(' / ')}`
      : '【紐付論点】未入力';

    return `
- ${target.label}: ${target.base}${target.unit}${rangeText}
  ${dueYearText}
  ${linkedIssuesText}
  ${target.rationale}`.trim();
  })
  .join('\n')}`
      : '【会社の数値目標（North Star Metrics）】（未入力）';

  const mustCeo = compact.ceoIntent ? [compact.ceoIntent] : [];
  const mustMission = compact.mvv.mission ? [compact.mvv.mission] : [];
  const mustVision = compact.mvv.vision ? [compact.mvv.vision] : [];
  const mustValue = compact.mvv.value ? [compact.mvv.value] : [];
  const mustS = compact.swot.S;
  const mustW = compact.swot.W;
  const mustO = compact.swot.O;
  const mustT = compact.swot.T;

  const mustQuotesBlock = `
【必須引用フレーズ（★そのまま本文に含める／言い換え禁止）】
- CEO意図（第1章に1つ以上）: ${mustCeo.length ? mustCeo.join(' / ') : '（未入力）'}
- Mission（本文に1つ以上）: ${mustMission.length ? mustMission.join(' / ') : '（未入力）'}
- Vision（第3章に1つ以上）: ${mustVision.length ? mustVision.join(' / ') : '（未入力）'}
- Value（第4章に1つ以上）: ${mustValue.length ? mustValue.join(' / ') : '（未入力）'}
- 強みS（第2章に1つ以上）: ${mustS.length ? mustS.join(' / ') : '（未入力）'}
- 弱みW（第2章に1つ以上）: ${mustW.length ? mustW.join(' / ') : '（未入力）'}
- 機会O（第2章に2つ以上）: ${mustO.length ? mustO.join(' / ') : '（未入力）'}
- 脅威T（第2章に2つ以上）: ${mustT.length ? mustT.join(' / ') : '（未入力）'}
`.trim();

  const mustFollow = `【重要（厳守・整合性チェック）】
- 上の「事業セグメント前提」がある場合、必ず本文に反映する
- 第1章または第3章の冒頭に「当社の事業と顧客」という小見出しを入れる（未入力なら未入力と明記）
- 各セグメント名を本文中に必ず1回以上登場させる
- 主要顧客（keyCustomers）を具体語として本文に含める（一般論禁止）
- 事業ポートフォリオがある場合、戦略案（第2章）と未来像（第3章）に矛盾がないよう反映する
【整合性MUST】
- CEO意図が入力されている場合、第1章（現状）に「CEO意図から見た危機・必然性」を1段落含める
- 第2章（戦略）では、SWOT分析の「機会（O）」「脅威（T）」を最低各2件ずつ“具体語のまま”根拠として引用する（一般論禁止）
- 第2章で強み（S）・弱み（W）から対策を最低1件以上ずつ導出する（具体語を含める）
- ★第2章は各ブロックに「根拠（SWOT）：機会(O): ... / ...｜脅威(T): ... / ...｜強み(S): ...｜弱み(W): ...」を必ず含める
- 第3章（未来像）には、MVV（特にVision/Mission/Value）のキーワードを最低1つ含める
- 第4章（90日計画）には、Value（行動原則）に沿った実行ルールを最低1つ組み込む
- CEO/MVV/SWOTが空の場合は「★未入力のため一般化した」と明記してハルシネを防ぐ
- ★論点が未入力の場合は「★論点未入力のため一般化した」を第1章の冒頭に明記する`;

  return `${businessSegmentsPreamble || ''}${segmentsText ? segmentsText + '\n\n' : ''}${portfolioText || ''}

${mustQuotesBlock}

${mustFollow}

【STAGE1で特定された論点】
${issueBlocksText}

【財務指標サマリ】
${metricsText}
${metricsSummary?.overallNote ? `所感: ${metricsSummary.overallNote}` : ''}

【CEO意図・経営者の思い】
${ceoIntentText ? `"${ceoIntentText}"` : '（未入力）'}

【MVV（ミッション・ビジョン・バリュー）】
- Mission: ${sanitize(mvv.mission, 300) || '（未入力）'}
- Vision: ${sanitize(mvv.vision, 300) || '（未入力）'}
- Value: ${sanitize(mvv.value, 300) || '（未入力）'}
${mvv.thought ? `- 経営者の思い: ${sanitize(mvv.thought, 500)}` : ''}

【SWOT分析】
- 強み: ${sanitize(swotCompact.strength, 300) || '（未入力）'}
- 弱み: ${sanitize(swotCompact.weakness, 300) || '（未入力）'}
- 機会: ${sanitize(swotCompact.opportunity, 300) || '（未入力）'}
- 脅威: ${sanitize(swotCompact.threat, 300) || '（未入力）'}${swotSuggestionsBlock}

${northStarBlock}

${industry ? `【業種】${industry}` : ''}

上記の情報を踏まえ、4章ストーリーと勝ち筋候補（2〜3案）を生成してください。
必須引用フレーズは“そのまま”本文に含め、CEO意図・MVV・SWOT を根拠として明示的に組み込んでください。
第1章は必ず「論点サマリ：」を含め、根拠指標を可能な範囲で引用してください。
第2章は必ず固定書式（1)〜3)）の"文字列"で返し、各ブロックに「根拠（SWOT）」行を必ず含めてください。`;
}

/* ===== 反映不足時のリペア（2nd pass） ===== */
function buildRepairSystemPrompt(): string {
  return `
あなたは経営戦略コンサルタント兼エディタです。
与えられたJSON（storyDraft/winPatternsCandidate）を「最小限の修正」で要件に適合させてください。

【★★★最重要：返却形式（必須）★★★】
- 出力は VALID JSON のみ（絶対に説明文・markdown・code fence 禁止）
- 必ず以下の形式で返す（括弧内は例）：
  {"storyDraft": [...], "winPatternsCandidate": [...]}
- storyDraft は「4つの章すべて」を配列で返す（差分だけでなく全体）
- 各章は {"title": "第X章：...", "body": "..."} の形式
- body は必ず「文字列」（オブジェクト/配列は禁止）

【厳守】
- コードブロック（markdown フェンス）は絶対に使用禁止
- JSON形式が壊れていないことを確認してから返す
- 既存の構造（キー名/配列数/章タイトル）は維持
- 修正対象は主に storyDraft[i].body（文字列のみ）
- 第2章は固定書式を維持しつつ、指定の具体語を「根拠（SWOT）」として追記（言い換えで誤魔化さない）
- 第2章の各ブロックに「根拠（SWOT）：機会(O):.../..｜脅威(T):.../..｜強み(S):...｜弱み(W):...」を必ず含める
- 文章量は必要最低限の追記に留める（全面書き換え禁止）
- JSON の特殊文字（ダブルクォート、バックスラッシュなど）は必ずエスケープする
`.trim();
}

function buildRepairUserPrompt(
  original: any,
  missing: string[],
  must: ReturnType<typeof buildMustQuotePhrases>
): string {
  return `
【不足している要件（これを満たすよう最小限修正）】
${missing.length > 0 ? missing.map((m, i) => `${i + 1}. ${m}`).join('\n') : '（なし）'}

【必須引用フレーズ（言い換え禁止・正確に本文に含める）】
- CEO意図: ${must.ceo.length ? must.ceo.join(' / ') : '（未入力）'}
- Mission: ${must.mission.length ? must.mission.join(' / ') : '（未入力）'}
- Vision: ${must.vision.length ? must.vision.join(' / ') : '（未入力）'}
- Value: ${must.value.length ? must.value.join(' / ') : '（未入力）'}
- 強み(S): ${must.s.length ? must.s.join(' / ') : '（未入力）'}
- 弱み(W): ${must.w.length ? must.w.join(' / ') : '（未入力）'}
- 機会(O): ${must.o.length ? must.o.slice(0, 6).join(' / ') : '（未入力）'}
- 脅威(T): ${must.t.length ? must.t.slice(0, 6).join(' / ') : '（未入力）'}

【修正対象JSON（4章すべてを返してください）】
${safeStringify(original)}

【返却チェックリスト】
- [ ] 返却は VALID JSON のみ（説明文なし）
- [ ] コードブロック（markdown フェンス）は使わない
- [ ] storyDraft は4つの章すべてを含む
- [ ] 各 body は文字列型
- [ ] 不足要件をすべて満たす内容
`.trim();
}

/* ===== APIハンドラ ===== */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const host = req.headers.get('host') || 'unknown';
  const method = req.method;
  const contentLength = req.headers.get('content-length') || '?';
  console.log('[stage2/generate-draft] ★REQUEST RECEIVED★', {
    at: new Date().toISOString(),
    host,
    method,
    contentLength,
    openaiKeyExists: !!process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL || process.env.NEXT_PUBLIC_OPENAI_MODEL || 'NOT SET',
  });

  try {
    // Bearer token authentication and membership validation
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      console.error('[stage2/generate-draft] Auth failed: no userId');
      return NextResponse.json({ ok: false, stage: 'auth', error: 'unauthorized' }, { status: 401 });
    }
    const membership = await requireMembership(admin, userId);
    if (!membership) {
      console.error('[stage2/generate-draft] Auth failed: no membership');
      return NextResponse.json({ ok: false, stage: 'auth', error: 'forbidden' }, { status: 403 });
    }

    // ★ Role チェック: admin / manager のみ許可
    try {
      await assertMinRole(membership, 'manager');
    } catch {
      console.error('[stage2/generate-draft] Auth failed: insufficient_role');
      return NextResponse.json({ ok: false, stage: 'auth', error: 'insufficient_role' }, { status: 403 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch (e) {
      console.error('[stage2/generate-draft] JSON parse error (request body):', e);
      return NextResponse.json({ ok: false, stage: 'request-parse', error: 'Invalid JSON in request body' }, { status: 400 });
    }

    if (body.__ping === true || body.__ping === 'true') {
      console.log('[stage2/generate-draft] PING MODE - immediate pong response');
      return NextResponse.json(
        { __pong: true, timestamp: new Date().toISOString(), message: 'API is alive' },
        { status: 200 }
      );
    }

    console.log('[stage2/generate-draft] ★API KEY & MODEL CHECK★');
    if (!process.env.OPENAI_API_KEY) {
      console.error('[stage2/generate-draft] CRITICAL: OPENAI_API_KEY is missing');
      return NextResponse.json({ ok: false, stage: 'env-check', error: 'OPENAI_API_KEY is missing' }, { status: 500 });
    }

    const parseResult = InputSchema.safeParse(body);
    if (!parseResult.success) {
      console.error('[stage2/generate-draft] input validation failed', parseResult.error.flatten());
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.format() }, { status: 400 });
    }

    console.log('[stage2/generate-draft] ★INPUT VALIDATION PASSED★');
    const input = parseResult.data;

    console.log('[stage2/generate-draft] ★PAYLOAD SUMMARY★', {
      issueBlocksCount: input.issueBlocks?.length ?? 0,
      businessSegmentsCount: input.businessSegments?.length ?? 0,
      hasCeoIntent: !!input.ceoIntent?.trim(),
      hasMVV: {
        mission: !!input.mvv?.mission?.trim(),
        vision: !!input.mvv?.vision?.trim(),
        value: !!input.mvv?.value?.trim(),
      },
      hasSWOT: {
        strength: !!input.swot?.strength?.trim(),
        weakness: !!input.swot?.weakness?.trim(),
        opportunity: !!input.swot?.opportunity?.trim(),
        threat: !!input.swot?.threat?.trim(),
      },
      hasMetricsSummary: !!input.metricsSummary,
      hasCompanyTargets: (input.companyTargets?.length ?? 0) > 0,
      hasBusinessPortfolio: !!input.businessPortfolio,
      hasIndustry: !!input.industry?.trim(),
      hasSegments: (input.segments?.length ?? 0) > 0,
    });

    // ★生成されない主因の撤去：issueBlocks空でも続行（ただしログで警告）
    if ((input.issueBlocks?.length ?? 0) === 0) {
      console.warn('[stage2/generate-draft] issueBlocks is empty -> proceed with generalized draft');
    }

    const model = pickSafeModel();
    console.log('[stage2/generate-draft] model:', model);

    const compact = compactPayload(input);

    console.log('[stage2/generate-draft] ★BUILDING PROMPTS★');
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(input, compact);
    const totalPromptLen = systemPrompt.length + userPrompt.length;
    console.log('[stage2/generate-draft] ★PROMPTS BUILT★', {
      systemLen: systemPrompt.length,
      userLen: userPrompt.length,
      totalLen: totalPromptLen,
      systemPreview: systemPrompt.slice(0, 200),
    });

    const controller = new AbortController();
    const TIMEOUT_MS = 90000; // ★ 延長：55秒 → 90秒
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let raw = '';
    let tOpenAIStart = 0;

    try {
      const elapsedMs = Date.now() - t0;
      const systemPromptLen = systemPrompt.length;
      const userPromptLen = userPrompt.length;

      console.log('[stage2/generate-draft] ★BEFORE OPENAI 1ST ATTEMPT★', {
        model,
        timeoutMs: TIMEOUT_MS,
        elapsedMs: `${elapsedMs}ms`,
        systemPromptLen,
        userPromptLen,
        totalPromptLen: systemPromptLen + userPromptLen,
        compactInfo: {
          issueBlocksCount: compact.issueBlocks.length,
          swotCounts: {
            S: compact.swot.S.length,
            W: compact.swot.W.length,
            O: compact.swot.O.length,
            T: compact.swot.T.length,
          },
          segmentsCount: compact.businessSegments.length,
        },
      });

      tOpenAIStart = Date.now();
      const completion = await openai.chat.completions.create(
        {
          model,
          temperature: 0.25,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 5200,
        },
        { signal: controller.signal }
      );

      raw = completion.choices?.[0]?.message?.content?.trim() || '';
      const dur = Date.now() - tOpenAIStart;
      console.log('[stage2/generate-draft] ★AFTER OPENAI 1ST ATTEMPT SUCCESS★', {
        durationMs: `${dur}ms`,
        rawLen: raw.length,
        hasContent: !!raw,
        rawPreview: raw.slice(0, 300),
      });
    } catch (e: any) {
      const dur = tOpenAIStart ? Date.now() - tOpenAIStart : undefined;
      console.error('[stage2/generate-draft] ★1ST OPENAI ATTEMPT FAILED★', {
        duration: dur ? `${dur}ms` : 'unknown',
        errorName: e?.name,
        errorMessage: e?.message || String(e),
        isAbortError: e?.name === 'AbortError',
        errorCode: e?.code,
      });

      try {
        const elapsedMs = Date.now() - t0;
        console.log('[stage2/generate-draft] ★BEFORE OPENAI 2ND ATTEMPT (retry without response_format)★', {
          model,
          timeoutMs: TIMEOUT_MS,
          elapsedMs: `${elapsedMs}ms`,
          reason: 'retry without response_format',
        });

        const tOpenAI2 = Date.now();
        const completion2 = await openai.chat.completions.create(
          {
            model,
            temperature: 0.25,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_tokens: 5200,
          },
          { signal: controller.signal }
        );

        raw = completion2.choices?.[0]?.message?.content?.trim() || '';
        const tOpenAI2Dur = Date.now() - tOpenAI2;
        console.log('[stage2/generate-draft] ★AFTER OPENAI 2ND ATTEMPT SUCCESS★', {
          durationMs: `${tOpenAI2Dur}ms`,
          rawLen: raw.length,
          hasContent: !!raw,
          rawPreview: raw.slice(0, 300),
        });
      } catch (e2: any) {
        const totalDurationMs = Date.now() - t0;
        clearTimeout(timer);
        console.error('[stage2/generate-draft] ★BOTH OPENAI ATTEMPTS FAILED★', {
          attempt1_error: e?.message || String(e),
          attempt2_error: e2?.message || String(e2),
          attempt2_name: e2?.name,
          attempt2_code: e2?.code,
          totalDurationMs: `${totalDurationMs}ms`,
          isAbortError: e2?.name === 'AbortError',
          stack: e2?.stack ? e2.stack.substring(0, 500) : 'no stack',
        });
        return NextResponse.json(
          {
            ok: false,
            stage: 'openai-failed',
            error: e2?.message || 'OpenAI API error',
            details: {
              attempt1: e?.message,
              attempt2: e2?.message,
              attempts: 2,
              totalDurationMs,
              isTimeout: e2?.name === 'AbortError',
            },
          },
          { status: 500 }
        );
      }
    } finally {
      clearTimeout(timer);
    }

    console.log('[stage2/generate-draft] ★JSON PARSE START★', { rawLen: raw.length, rawPreview: raw.slice(0, 200) });

    const { parsed, diagnostic } = extractJsonLoose(raw);
    console.log('[stage2/generate-draft] ★JSON PARSE RESULT★', diagnostic);

    if (!parsed) {
      console.error('[stage2/generate-draft] ★JSON PARSE FAILED★', {
        diagnostic,
        rawFirst1000: raw.slice(0, 1000),
      });
      return NextResponse.json(
        {
          ok: false,
          stage: 'json-parse-failed',
          error: 'Failed to parse AI response',
          details: {
            diagnostic,
            rawLen: raw.length,
          },
        },
        { status: 500 }
      );
    }

    let storyDraft = parsed.storyDraft || parsed.story || parsed.chapters || [];
    if (!Array.isArray(storyDraft)) storyDraft = [];

    if (process.env.NODE_ENV === 'development') {
      console.log(
        '[stage2/generate-draft] parsed.storyDraft lengths:',
        (storyDraft as any[]).map((ch: any, i: number) => `Ch${i}: ${(ch?.body || ch?.content || '').length}`)
      );
    }

    const normalizedStory = CHAPTER_TITLES.map((title, i) => {
      const fallback = '（この章は未生成です）';
      const ch = (storyDraft as any[])[i] ?? null;
      const bodyText = normalizeChapterBody(ch, fallback);
      return {
        title,
        body: sanitize(bodyText || fallback, 8000),
      };
    });

    if (process.env.NODE_ENV === 'development') {
      console.log(
        '[stage2/generate-draft] normalizedStory lengths:',
        normalizedStory.map((ch, i) => `Ch${i}: ${ch.body.length}`)
      );
    }

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

    // ===== 反映不足チェック → 必要なら2nd passで最小修正 =====
    const must = buildMustQuotePhrases(input);
    const missing = computeCoverageIssues(normalizedStory, must);

    let finalStory = normalizedStory;

    if (missing.length > 0) {
      console.log('[stage2/generate-draft] ★REPAIR PHASE START★', {
        missingCount: missing.count,
        missing: missing.slice(0, 3),
      });

      const repairController = new AbortController();
      const repairTimer = setTimeout(() => repairController.abort(), 35000);

      const repairPayload = {
        storyDraft: finalStory,
        winPatternsCandidate: normalizedWinPatterns,
      };

      try {
        console.log('[stage2/generate-draft] ★BEFORE REPAIR OPENAI CALL★', {
          payloadSize: safeStringify(repairPayload).length,
          missingCount: missing.length,
        });

        const completionRepair = await openai.chat.completions.create(
          {
            model,
            temperature: 0.0,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: buildRepairSystemPrompt() },
              { role: 'user', content: buildRepairUserPrompt(repairPayload, missing, must) },
            ],
            max_tokens: 2600,
          },
          { signal: repairController.signal }
        );

        const raw2 = completionRepair.choices?.[0]?.message?.content?.trim() || '';
        console.log('[stage2/generate-draft] ★AFTER REPAIR OPENAI CALL★', {
          raw2Len: raw2.length,
          raw2Preview: raw2.slice(0, 200),
        });

        const { parsed: parsed2, diagnostic: diag2 } = extractJsonLoose(raw2);
        console.log('[stage2/generate-draft] ★REPAIR JSON PARSE RESULT★', {
          diagnostic: diag2,
          hasStoryDraft: !!parsed2?.storyDraft,
          storyDraftIsArray: Array.isArray(parsed2?.storyDraft),
        });

        if (parsed2?.storyDraft && Array.isArray(parsed2.storyDraft)) {
          const repairedStory = CHAPTER_TITLES.map((title, i) => {
            const fallback = '（この章は未生成です）';
            const ch = (parsed2.storyDraft as any[])[i] ?? null;
            const bodyText = normalizeChapterBody(ch, fallback);
            return {
              title,
              body: sanitize(bodyText || fallback, 8000),
            };
          });

          const missingAfter = computeCoverageIssues(repairedStory, must);
          if (missingAfter.length <= missing.length) {
            finalStory = repairedStory;
            console.log('[stage2/generate-draft] ★REPAIR APPLIED★', {
              missingBefore: missing.length,
              missingAfter: missingAfter.length,
              improvement: missing.length - missingAfter.length,
            });
          } else {
            console.warn('[stage2/generate-draft] ★REPAIR REJECTED (worse)★', {
              missingBefore: missing.length,
              missingAfter: missingAfter.length,
            });
          }
        } else {
          console.warn('[stage2/generate-draft] ★REPAIR PARSE FAILED → KEEP ORIGINAL★', {
            diagnostic: diag2,
            raw2Len: raw2.length,
            raw2First500: raw2.slice(0, 500),
          });
        }
      } catch (e: any) {
        console.error('[stage2/generate-draft] ★REPAIR CALL FAILED → KEEP ORIGINAL★', {
          errorMessage: e?.message || String(e),
          errorName: e?.name,
          isAbortError: e?.name === 'AbortError',
        });
      } finally {
        clearTimeout(repairTimer);
      }
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[stage2/generate-draft] winPatternsCandidate count:', normalizedWinPatterns.length);
    }

    const result = {
      storyDraft: finalStory,
      winPatternsCandidate: normalizedWinPatterns,
    };

    const outputValidation = OutputSchema.safeParse(result);
    if (!outputValidation.success) {
      console.warn('[stage2/generate-draft] Output validation warning:', outputValidation.error.format());
    }

    const totalDurationMs = Date.now() - t0;
    // ★ 修正3：レスポンス返却直前ログ
    console.log('[stage2/generate-draft] END - preparing response', {
      storyDraftCount: finalStory.length,
      storyDraftLengths: finalStory.map((ch, i) => `Ch${i}: ${ch.body.length}`),
      winPatternsCount: normalizedWinPatterns.length,
      hasRepair: missing.length > 0,
      totalDurationMs: `${totalDurationMs}ms`,
      at: new Date().toISOString(),
    });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: any) {
    const status = error?.name === 'AbortError' ? 504 : 500;
    const totalDurationMs = Date.now() - t0;
    console.error('[stage2/generate-draft] ★★FATAL SERVER ERROR★★', {
      name: error?.name,
      message: error?.message || String(error),
      status,
      totalDurationMs: `${totalDurationMs}ms`,
      isAbortError: error?.name === 'AbortError',
      code: error?.code,
      cause: error?.cause ? String(error.cause) : undefined,
      stack: error?.stack ? error.stack.substring(0, 800) : 'no stack',
    });
    return NextResponse.json(
      {
        ok: false,
        stage: 'fatal-error',
        error: error?.message || 'Server error',
        details: {
          status,
          totalDurationMs,
          isTimeout: error?.name === 'AbortError',
          errorName: error?.name,
        },
      },
      { status }
    );
  }
}
