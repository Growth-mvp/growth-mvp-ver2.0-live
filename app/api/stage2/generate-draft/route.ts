// /app/api/stage2/generate-draft/route.ts
// STAGE2：ドライなたたき台生成API（story-process形式に寄せて安定化 + CEO/MVV/SWOT反映を強制）
//
// 改修ポイント（このファイル内で完結）
// - ★「生成されない」主因：InputSchema/issueBlocks必須 & issueBlocks空で400 return を緩和
//   => issueBlocks/mvv/swot を optional + default で受け、論点ゼロでも生成続行（未入力と明記）
// - 第2章の固定書式に「根拠キーワード」行を追加
// - normalizeChapterBody：AIが第2章をobject/arrayで返しても固定書式に確実に文字列化
// - Repair(2nd pass)：固定書式と短い根拠キーワードの追記を最小修正で強制

import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { AI_MODELS, getTokenLimitParam, getTemperatureParam } from '@/lib/modelConfig';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership, assertMinRole } from '@/lib/server/rbacGuard';
import { logAuditEvent, extractAuditMetadata } from '@/lib/server/auditLog';
import { logInputGuard, checkSuspiciousKeywords } from '@/lib/inputGuardLogger';
import { z } from 'zod';

/* ===== OpenAI設定 ===== */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

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
 * ★改修：第2章固定書式に「根拠キーワード」行を含めて整形できるようにする
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

        // ★追加：根拠キーワードを拾う（いずれかのキー揺れを救う）
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
        out.push(`   根拠キーワード：${evText ? evText : '（未提示）'}`);
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
  '第4章：どう実行に落とすか（実行）',
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
    .split(/[\n,、。;；]+/g)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
  const short = parts.map((p) => (p.length > 18 ? p.slice(0, 18) : p));
  return Array.from(new Set(short)).slice(0, limit);
}

function buildMustQuotePhrases(input: z.infer<typeof InputSchema>) {
  const ceo = input.ceoIntent?.trim()
    ? [sanitize(input.ceoIntent, 40).replace(/[\r\n]+/g, ' ').trim()]
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

function extractSwotEvidenceLines(chapterBody: string): string[] {
  if (!chapterBody) return [];
  return chapterBody
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('根拠（SWOT）：') || line.includes('根拠キーワード：'))
    .map((line) =>
      line
        .replace(/^[-\s]*/, '')
        .replace(/^根拠（SWOT）：/, '')
        .replace(/^根拠キーワード：/, '')
        .replace(/\s+/g, '')
        .trim()
    )
    .filter(Boolean);
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
    missing.push(`第1章にCEO意図の短いキーワード（例: ${must.ceo[0]}）を1つ含める`);
  }

  if (must.mission.length > 0 && countHits(all, must.mission) < 1) {
    missing.push(`Missionの短いキーワードを本文に1つ含める（候補: ${must.mission.join(' / ')}）`);
  }

  if (must.vision.length > 0 && countHits(ch3, must.vision) < 1) {
    missing.push(`第3章にVisionのキーワードを1つ以上含める（候補: ${must.vision.join(' / ')}）`);
  }
  if (must.value.length > 0 && countHits(ch4, must.value) < 1) {
    missing.push(`第4章にValueのキーワードを1つ以上含める（候補: ${must.value.join(' / ')}）`);
  }

  if (must.o.length + must.t.length + must.s.length + must.w.length > 0 && !/根拠キーワード\s*[:：]/.test(ch2)) {
    missing.push(`第2章の各勝ち筋に「根拠キーワード：... / ... / ... / ...」を短く追加する`);
  }

  const swotEvidenceLines = extractSwotEvidenceLines(ch2);
  if (swotEvidenceLines.length >= 3 && new Set(swotEvidenceLines).size <= 1) {
    missing.push(
      `第2章の3ブロックで根拠キーワードが同一になっているため、各ブロックの戦略テーマに合わせて重点を変える`
    );
  }

  if (!/^\s*戦略結論\s*[:：]/m.test(ch2)) {
    missing.push(
      `第2章の先頭に、成長牽引軸・収益改善軸・再構築軸が分かる「戦略結論：」を追加する`
    );
  }

  if (!/事業ポートフォリオ判断\s*[:：]/.test(ch2)) {
    missing.push(
      `第2章に「事業ポートフォリオ判断：成長牽引軸：...｜収益改善軸：...｜再構築軸：...｜補助軸：...」を追加する`
    );
  }

  if (!/経営判断\s*[:：]/.test(ch2)) {
    missing.push(
      `第2章の各勝ち筋に「経営判断：」を追加し、投資配分・撤退/縮小・価格/原価・重点顧客・KPI変更のいずれを決めるべきか明示する`
    );
  }

  if (!/SWOT判断\s*[:：]/.test(ch2)) {
    missing.push(
      `第2章の各勝ち筋に「SWOT判断：S×O / W×T / S×T / W×O のいずれか：...」を追加し、SWOTから戦略が導かれる因果を明示する`
    );
  }

  if (/狙う価値ドライバー\s*[:：]\s*(成長機会の最大化|収益性の改善|事業構成の転換)\s*$/m.test(ch2)) {
    missing.push(
      `第2章の勝ち筋名が一般語に留まっているため、事業名・顧客・指標・提供価値を含む会社固有の名称へ修正する`
    );
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

【最重要：生成品質の基準（厳守）】
- これは説明文生成ではなく、経営会議に出す「戦略判断のたたき台」である。
- 「成長機会の最大化」「収益性の改善」「選択と集中」だけで終わる一般論は禁止。必ず入力にある事業名・顧客・指標・MVV・SWOTの具体語を使い、会社固有の判断にする。
- 第2章の冒頭は必ず「戦略結論：」で始める。ただし「AからBへシフト」という単純な移行表現は禁止。
- 戦略結論では、事業を「成長牽引軸」「収益改善軸」「再構築軸」を基本に役割分けし、何を変えるかを断定する。
- ただし事業セグメントが4つ以上ある場合、3分類に無理に押し込まず、「高付加価値化軸」「基盤技術軸」「ソリューション化軸」などの補助軸を使い、全セグメントを事業ポートフォリオ判断に必ず含める。
- 事業セグメントがある場合、必ず本文に全セグメント名を登場させる。3分類に収まらないセグメントは、補助軸として分類し、分類理由は財務指標・市場機会・SWOTのいずれかで説明する。
- 勝ち筋は「価値ドライバー名」ではなく、「どの市場/顧客/提供価値で、どの指標を改善するか」が分かる名称にする。
- 90日アクションは「調査する」だけで終わらせない。経営判断に必要な成果物（投資配分案、撤退候補、重点顧客、重点KPI、部門展開方針、価格/原価改善案など）を明記する。
- すべての章で「だから何を決めるべきか」が読めるようにし、分析メモではなく意思決定メモとして書く。
- 「それぐらい分かっている」と言われる内容は禁止。各勝ち筋には、経営者が議論すべき“具体的な判断”を1つ入れる。
- 各勝ち筋には「やめること」「変えるルール」「優先順位の変更」のいずれかを必ず含める。
- 既存KPI・既存投資・既存事業ポートフォリオのどこが過去延長なのかを1つ指摘する。
- 売上成長率が低い、または売上規模が横ばいの場合は、赤字危機ではなく「改善力・実行管理力はあるが、成長市場への事業転換が進み切っていない」という成長シフト未達の論点を第1章で明示する。

【最重要：SWOTから戦略を導く（厳守）】
- SWOTは飾りではない。第2章の事業分類・勝ち筋・経営判断・90日アクションは、必ずSWOTの組み合わせから導く。
- 各勝ち筋には必ず「SWOT判断：」を入れ、次のいずれかの型で判断根拠を書く。
  - S×O：強みを使って機会を取りに行く
  - W×T：弱みと脅威が重なる領域を縮小・改善する
  - S×T：強みで脅威を防ぎ、競争条件を変える
  - W×O：機会はあるが弱みが制約になっているため、先に能力補強する
- 「成長牽引軸」は原則 S×O または S×T で説明する。
- 「収益改善軸」は原則 W×T または S×T で説明する。
- 「再構築軸」は原則 W×T または W×O で説明する。
- SWOT判断がない勝ち筋は禁止。SWOT判断と経営判断が矛盾しないようにする。
- 機会(O)が大きくても、弱み(W)や脅威(T)が強い場合は、いきなり成長投資にせず「能力補強」「撤退基準」「小さく検証」を提案する。
- 強み(S)が明確でも、機会(O)が弱い場合は、過剰投資ではなく収益性改善・重点顧客の絞り込みを提案する。

【禁止表現：社員向けメッセージ（厳禁）】
以下の表現は本文に出してはいけない（社員向け訓示調になるため）：
- 新入社員にも分かる / 社員一人ひとり / 皆さん / あなたたちへ / 一緒に / 挑戦 / 努力 / 誇り / 覚悟 / 邁進 / 経営者の覚悟 / 社員に熱量が伝わる
- これらを使わず、客観的で論理的な経営用語に置き換える

【最重要：根拠の扱い（厳守）】
- CEO意図 / MVV / SWOT は、本文を長くするためではなく「判断の根拠」として使う。
- 入力文の長い引用は禁止。本文には核となる短いキーワードだけを使う。
- SWOTは詳細に貼り付けず、各戦略ブロックの「根拠キーワード」に最大4語で圧縮する。
- 第2章は根拠説明よりも「何を選び、何を見直すか」を優先する。
- 3つの勝ち筋は、成長投資、収益改善、事業見直しなど役割を分ける。ただし見出しは必ず会社固有の具体語を含める。
- 根拠キーワードには、必ずS/W/O/Tのうち2種類以上を含める。

【最重要：事業セグメント前提（厳守）】
- 入力に「事業セグメント前提」が与えられた場合、それを必ず本文に反映する
- 次の条件を必ず満たす：
  1) 第1章または第3章の冒頭に「当社の事業と顧客」という小見出しを作る（未入力なら"未入力"と明記）
  2) 各セグメント名を本文中に必ず1回以上登場させる
  3) 主要顧客（keyCustomers）を"具体語"として本文に含める（一般論禁止）
- 事業ポートフォリオが与えられた場合、戦略案（第2章）と未来像（第3章）に矛盾がないよう反映する

【最重要：North Star Metrics（会社の数値目標）（厳守）】
- 入力に「会社の数値目標」が与えられた場合、その目標値（ラベル・基準値・単位）を本文に最低1つ以上含める
- 各North Star目標に紐付された論点がある場合、その論点を第2章（戦略）または第4章（行動）で「この論点が達成に必須」という文脈で引用する
- North Star目標が複数ある場合、最優先度のものを本文で明確に言及する
- 論点ID（issue-...）や「North Star未入力」などの内部表現は本文に出さない

【最重要：型（厳守）】
- storyDraft[i].body は必ず「文字列」で返す（配列やオブジェクトは禁止）
- 第2章は自由作文ではなく、必ず以下の固定書式の“文字列”にする（1)〜3) まで）
- ★第2章の各ブロックに「根拠キーワード」行を必ず含める（SWOT・財務・事業名から最大4語）
- ★各ブロックの「主要戦略」には、SWOTから戦略が導かれる因果を含める。単なるSWOTの貼り付けや後付けの根拠メモは禁止。
- ★3つのブロックで「根拠キーワード」行が同じ内容になることは禁止。各ブロックの狙う価値ドライバーに合わせて、主に使う根拠を変える。

【最重要：読みやすさ（厳守）】
- ユーザーは最初に「何を判断すべきか」を知りたい。各章は長文レポートではなく、経営判断のたたき台として読む順番を整える。
- 各章の冒頭1行目に必ず「要点：」を置き、その章の結論を80〜120字で書く。
- 第2章の冒頭1行目は必ず「戦略結論：」にする。ここに「成長牽引軸」「収益改善軸」「再構築軸」を基本として、それぞれの経営判断を明確に書く。4セグメント以上ある場合は補助軸も併記する。
- 第2章の各ブロックは、主要戦略1〜2行、90日アクション1〜2行、トレードオフ1行までに絞る。根拠キーワードは最大4語に圧縮する。
- 「根拠」「分析」「補足」が本文を圧迫しないよう、説明は短くし、同じ内容の繰り返しを避ける。
- 第1章、第3章、第4章は各350字以内。第2章は全体で900字以内。これを超える長文は禁止。
- 1文は80字以内を目安にする。1行に複数項目を詰め込まない。

第2章：どう戦う（戦略）
戦略結論：...を成長牽引軸、...を収益改善軸、...を再構築軸と位置づけ、必要に応じて...を高付加価値化軸/基盤技術軸/ソリューション化軸として扱い、投資・撤退・KPIの判断基準を切り替える。
事業ポートフォリオ判断：成長牽引軸：...｜収益改善軸：...｜再構築軸：...｜補助軸：...
1) 勝ち筋：...
   狙う価値ドライバー：...
   SWOT判断：S×O / W×T / S×T / W×O のいずれか：...
   経営判断：...
   主要戦略：
   - ...
   90日アクション：
   - ...
   根拠キーワード：... / ... / ... / ...
   トレードオフ：...
2) 勝ち筋：...
   狙う価値ドライバー：...
   SWOT判断：S×O / W×T / S×T / W×O のいずれか：...
   経営判断：...
   主要戦略：
   - ...
   90日アクション：
   - ...
   根拠キーワード：... / ... / ... / ...
   トレードオフ：...
3) 勝ち筋：...
   狙う価値ドライバー：...
   SWOT判断：S×O / W×T / S×T / W×O のいずれか：...
   経営判断：...
   主要戦略：
   - ...
   90日アクション：
   - ...
   根拠キーワード：... / ... / ... / ...
   トレードオフ：...

【4章の要求（本文は具体的だが冗長にしない）】
1) 第1章（現状）：
- 冒頭1行目に「要点：」として、なぜ今変えるべきかを80〜120字で書く
- 冒頭に必ず「論点サマリ：」を置き、論点を3件、箇条書きで出す
  例）- 論点1：〇〇（スコープ：全社/事業）｜根拠指標：〇〇｜要約：〇〇
- その後、論点がなぜ重大か（影響/リスク/示唆）を具体に説明する
- さらに「CEO意図から見た危機・必然性」を1段落必ず含める（入力が未入力なら未入力と明記）

2) 第2章（戦略）：
- 上の固定書式（1)〜3)）で、価値ドライバー別に整理する
- 冒頭に必ず「戦略結論：」と「事業ポートフォリオ判断：」を置く
- 「事業ポートフォリオ判断」は、入力の事業セグメントがある場合は各セグメント名をすべて使い、成長牽引軸・収益改善軸・再構築軸を基本に分類する。4つ以上ある場合は高付加価値化軸・基盤技術軸・ソリューション化軸などの補助軸を追加してよい
- 主要戦略・90日アクション・トレードオフを必ず含める
- 各ブロックに「SWOT判断：」を必ず入れ、S×O / W×T / S×T / W×O のどれに基づく戦略かを明示する
- 各ブロックに「経営判断：」を必ず入れ、投資配分・撤退/縮小・価格/原価・重点顧客・KPI変更のいずれを決めるべきか明示する
- SWOT・財務・事業名から、判断に使った根拠を“根拠キーワード”に最大4語で含める
- 各ブロックは「強み×機会で攻める」「弱み×脅威を回避・克服する」「そのために何を選び、何を捨てるか」が読める文章にする
- 3つのブロックは同じ根拠の焼き直しにしない。1つ目は成長機会、2つ目は収益性/資本効率、3つ目は選択と集中/リソース配分のように、戦略論点を分けて書く
- 90日アクションは「調査」「分析」だけにせず、意思決定に使う成果物を1つ含める

3) 第3章（未来像）：
- 冒頭1行目に「要点：」として、戦略実現後の会社の姿を80〜120字で書く
- 戦略が成功した場合の未来像を、顧客価値・収益性・成長・資本効率・組織変化の観点で具体に描写する
- 単なる「高品質」「競争力」では終わらせず、顧客の利用シーンを描く。例：自動車、ドローン、医療機器、ロボット等の顧客が、認識・駆動・制御を必要とする場面で、当社が設計初期から関与する
- MVV（Mission/Vision/Value）のキーワードを少なくとも1つ以上含める（未入力なら未入力と明記）

4) 第4章（行動）：
- 冒頭1行目に「要点：」として、最初の90日で何から始めるかを80〜120字で書く
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
    S: compactSwotArray(typeof swot.strength === 'string' ? swot.strength.split(/[\n,、。;；]/) : []),
    W: compactSwotArray(typeof swot.weakness === 'string' ? swot.weakness.split(/[\n,、。;；]/) : []),
    O: compactSwotArray(typeof swot.opportunity === 'string' ? swot.opportunity.split(/[\n,、。;；]/) : []),
    T: compactSwotArray(typeof swot.threat === 'string' ? swot.threat.split(/[\n,、。;；]/) : []),
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
          summary: clip(String(s?.summary ?? s?.scope ?? ''), 160),
          keyCustomers: Array.isArray(s?.keyCustomers)
            ? s.keyCustomers
                .map((c: any) => clip(String(c ?? '').trim(), 40))
                .filter(Boolean)
                .slice(0, 3)
            : [],
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
【判断に使う短いキーワード（長文引用禁止）】
- CEO意図: ${mustCeo.length ? mustCeo.join(' / ') : '（未入力）'}
- Mission: ${mustMission.length ? mustMission.join(' / ') : '（未入力）'}
- Vision: ${mustVision.length ? mustVision.join(' / ') : '（未入力）'}
- Value: ${mustValue.length ? mustValue.join(' / ') : '（未入力）'}
- 強みS: ${mustS.length ? mustS.join(' / ') : '（未入力）'}
- 弱みW: ${mustW.length ? mustW.join(' / ') : '（未入力）'}
- 機会O: ${mustO.length ? mustO.slice(0, 4).join(' / ') : '（未入力）'}
- 脅威T: ${mustT.length ? mustT.slice(0, 4).join(' / ') : '（未入力）'}
`.trim();

  const mustFollow = `【重要（厳守・整合性チェック）】
- 上の「事業セグメント前提」がある場合、必ず本文に反映する
- 第1章または第3章の冒頭に「当社の事業と顧客」という小見出しを入れる（未入力なら未入力と明記）
- 各セグメント名を本文中に必ず1回以上登場させる
- 主要顧客（keyCustomers）を具体語として本文に含める（一般論禁止）
- 事業ポートフォリオがある場合、戦略案（第2章）と未来像（第3章）に矛盾がないよう反映する
- 4つ以上の事業セグメントがある場合、3分類に収まらない事業を補助軸で扱い、全セグメントを第2章に必ず含める
- 売上成長率が低い場合は、第1章で「成長シフト未達」の論点を明示する
【戦略判断MUST】
- 第2章の1行目は必ず「戦略結論：」で始め、成長牽引軸・収益改善軸・再構築軸を明示する。4セグメント以上ある場合は補助軸も使い、全セグメントを落とさない
- 「AからBへシフト」のような単純な移行表現は禁止。事業ごとの役割分担として書く
- 第2章の2行目は必ず「事業ポートフォリオ判断：成長牽引軸：...｜収益改善軸：...｜再構築軸：...｜補助軸：...」にする
- 「成長機会の最大化」「収益性の改善」「事業構成の転換」だけの見出しは禁止。必ず具体の市場/顧客/事業/提供価値/指標を入れる
- 各90日アクションは、調査・分析そのものではなく、経営会議で判断できる成果物名まで書く
- 各勝ち筋に「SWOT判断：」を入れ、S×O / W×T / S×T / W×O のどれに基づく判断かを明示する
- 各勝ち筋に「経営判断：」を入れ、投資配分・撤退/縮小・価格/原価・重点顧客・KPI変更のいずれを決めるべきか明示する
- 「やめること」「変えるルール」「優先順位の変更」のいずれかを含める
【整合性MUST】
- CEO意図が入力されている場合、第1章（現状）に「CEO意図から見た危機・必然性」を1段落含める
- 第2章（戦略）では、SWOTを長文引用せず、各ブロックの「根拠キーワード」に最大4語で圧縮する
- 第2章で強み（S）・弱み（W）から対策を最低1件以上導出する
- 成長牽引軸・収益改善軸・再構築軸の分類理由は、必ずSWOT判断と一致させる
- SWOT判断が W×T の場合、成長投資ではなく、原価・価格・撤退基準・縮小・リスク低減のいずれかを提案する
- SWOT判断が S×O の場合、重点顧客・市場・投資配分・提供価値のいずれかを具体化する
- SWOT判断が W×O の場合、先に補強すべき能力・体制・KPIを明示する
- SWOT判断が S×T の場合、強みによって脅威を回避する競争条件・差別化要素を明示する
- ★第2章は各ブロックに「根拠キーワード：... / ... / ... / ...」を必ず含める
- ★第2章の3ブロックで、同じ根拠キーワードを機械的に繰り返さない
- ★各ブロックの主要戦略は、SWOTを列挙するだけでなく「だから何を選ぶのか」まで書く
- 第3章（未来像）には、MVV（特にVision/Mission/Value）のキーワードを最低1つ含める
- 第3章（未来像）には、顧客の利用シーン（どの顧客が、どの場面で、何を実現するか）を最低1つ含める
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
上記キーワードは長文引用せず、必要な箇所に短く織り込んでください。
第1章は必ず「論点サマリ：」を含め、根拠指標を可能な範囲で引用してください。
第2章は必ず固定書式（1)〜3)）の"文字列"で返し、各ブロックに「根拠キーワード」行を必ず含めてください。
最重要：第2章の先頭は「戦略結論：」で始め、成長牽引軸・収益改善軸・再構築軸を基本に、必要に応じて補助軸も使って、会社固有の資源配分・見直し対象を断定してください。入力された全事業セグメントを落とさないでください。
各勝ち筋では必ず「SWOT判断：S×O / W×T / S×T / W×O のいずれか」を書き、そのSWOT判断から経営判断と90日アクションが導かれるようにしてください。`;
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
- 第2章は固定書式を維持しつつ、「根拠キーワード」を最大4語で短く追記する
- 第2章の各ブロックに「根拠キーワード：... / ... / ... / ...」を必ず含める
- 第2章の3ブロックで、同じ根拠キーワードを機械的に繰り返さない
- SWOTやMVVの長文引用は禁止。貼り付けず、短いキーワードに圧縮する
- 第2章の先頭が「戦略結論：」で始まっていない場合は必ず追加する
- 「成長機会の最大化」「収益性の改善」「事業構成の転換」など一般語だけの勝ち筋名は、入力に含まれる事業名・顧客・指標・MVV・SWOT具体語を含む名前へ修正する
- 各勝ち筋に「SWOT判断：」がない場合は追加し、S×O / W×T / S×T / W×O のどれに基づく戦略かを短く書く
- 各勝ち筋に「経営判断：」がない場合は追加し、何を決めるべきかを短く書く
- 90日アクションが「調査」「分析」だけの場合は、投資配分案・撤退候補・重点顧客・重点KPI・部門展開方針など、意思決定成果物を短く追記する
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

【参考キーワード（長文引用禁止・必要なものだけ短く使う）】
- CEO意図: ${must.ceo.length ? must.ceo.join(' / ') : '（未入力）'}
- Mission: ${must.mission.length ? must.mission.join(' / ') : '（未入力）'}
- Vision: ${must.vision.length ? must.vision.join(' / ') : '（未入力）'}
- Value: ${must.value.length ? must.value.join(' / ') : '（未入力）'}
- 強み(S): ${must.s.length ? must.s.join(' / ') : '（未入力）'}
- 弱み(W): ${must.w.length ? must.w.join(' / ') : '（未入力）'}
- 機会(O): ${must.o.length ? must.o.slice(0, 4).join(' / ') : '（未入力）'}
- 脅威(T): ${must.t.length ? must.t.slice(0, 4).join(' / ') : '（未入力）'}

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

    let body: any;
    try {
      body = await req.json();
    } catch (e) {
      console.error('[stage2/generate-draft] JSON parse error (request body):', e);
      return NextResponse.json({ ok: false, stage: 'request-parse', error: 'Invalid JSON in request body' }, { status: 400 });
    }

    // ★ PING モード判定（最初に、認証のみで許可）
    if (body.__ping === true || body.__ping === 'true') {
      console.log('[stage2/generate-draft] PING MODE - immediate pong response');
      const pingMembership = await requireMembership(admin, userId);
      if (!pingMembership) {
        return NextResponse.json({ __pong: false, error: 'unauthorized' }, { status: 401 });
      }
      return NextResponse.json(
        { __pong: true, timestamp: new Date().toISOString(), message: 'API is alive' },
        { status: 200 }
      );
    }

    // ★ 通常生成フロー：strategyDataId を取得・必須チェック
    const requestedStrategyDataId = [
      body.strategyDataId,
      body.strategy_data_id,
      body.strategyId,
      body.strategy_id,
    ].find((id) => typeof id === 'string' && id.trim());

    if (!requestedStrategyDataId) {
      return NextResponse.json({ ok: false, error: 'strategyDataId is required' }, { status: 400 });
    }

    // strategy_data.company_id を取得
    const { data: strategyRecord, error: strategyError } = await admin
      .from('strategy_data')
      .select('company_id')
      .eq('id', requestedStrategyDataId)
      .maybeSingle();

    if (strategyError || !strategyRecord || !strategyRecord.company_id) {
      return NextResponse.json({ ok: false, error: 'strategyDataId not found or invalid' }, { status: 404 });
    }

    const strategyCompanyId = strategyRecord.company_id;

    // ★ strategyCompanyId を明示指定して membership を検証
    const membershipForStrategy = await requireMembership(admin, userId, strategyCompanyId);
    if (!membershipForStrategy) {
      return NextResponse.json({ ok: false, error: 'not a member of this company' }, { status: 403 });
    }

    // ★ Role チェック: manager 以上のみ許可
    try {
      await assertMinRole(membershipForStrategy, 'manager');
    } catch {
      console.error('[stage2/generate-draft] Auth failed: insufficient_role');
      return NextResponse.json({ ok: false, stage: 'auth', error: 'insufficient_role' }, { status: 403 });
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

    const model = AI_MODELS.reasoning;
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_AI_MODELS === '1') {
      console.log(`[AI] stage2-draft → ${model}`);
    }
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

      // 【入力充足度ログ】OpenAI呼び出し直前に観測ログを出力
      const requestId = req.headers.get('x-request-id') || `req_${Date.now()}`;
      const strategyDataId = requestedStrategyDataId;
      const hasCompanyInfo = !!(compact.mvv.mission || compact.mvv.vision || compact.mvv.value);
      const hasStage1Context = !!(compact.mvv.mission || compact.mvv.vision);
      const hasStage2Answers = compact.issueBlocks.length > 0;
      const hasStage2Story = false; // stage2-draft では既に完成ストーリーはない
      const hasStage3Context = compact.businessSegments.length > 0;
      const hasStage4Context = false; // stage2-draft では执行計画ない

      const inputFlags = [hasCompanyInfo, hasStage1Context, hasStage2Answers, hasStage2Story, hasStage3Context, hasStage4Context];
      const meaningfulInputScore = Math.round((inputFlags.filter(Boolean).length / inputFlags.length) * 100);

      const suspiciousKeywords = checkSuspiciousKeywords(userPrompt);

      logInputGuard({
        requestId,
        apiName: 'stage2/generate-draft',
        companyId: strategyCompanyId,
        strategyId: strategyDataId,
        meaningfulInputScore,
        hasCompanyInfo,
        hasStage1Context,
        hasStage2Answers,
        hasStage2Story,
        hasStage3Context,
        hasStage4Context,
        promptLength: userPromptLen,
        suspiciousKeywordFlags: suspiciousKeywords,
      });

      tOpenAIStart = Date.now();
      const completion = await openai.chat.completions.create(
        {
          model,
          ...getTemperatureParam(model, 0.25),
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          ...getTokenLimitParam(model, 8000),
          ...(model.startsWith('gpt-5.6') ? { reasoning_effort: 'low' } : {}),
        },
        { signal: controller.signal }
      );

      raw = completion.choices?.[0]?.message?.content?.trim() || '';
      const dur = Date.now() - tOpenAIStart;

      const choice = completion.choices?.[0];
      console.log('[stage2/generate-draft] ★OPENAI RESPONSE DIAGNOSTIC★', {
        finishReason: choice?.finish_reason,
        hasContent: Boolean(choice?.message?.content),
        contentLength: choice?.message?.content?.length ?? 0,
        promptTokens: completion.usage?.prompt_tokens,
        completionTokens: completion.usage?.completion_tokens,
        totalTokens: completion.usage?.total_tokens,
      });

      console.log('[stage2/generate-draft] ★AFTER OPENAI 1ST ATTEMPT SUCCESS★', {
        durationMs: `${dur}ms`,
        rawLen: raw.length,
        hasContent: !!raw,
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
            ...getTemperatureParam(model, 0.25),
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            ...getTokenLimitParam(model, 8000),
            ...(model.startsWith('gpt-5.6') ? { reasoning_effort: 'low' } : {}),
          },
          { signal: controller.signal }
        );

        raw = completion2.choices?.[0]?.message?.content?.trim() || '';
        const tOpenAI2Dur = Date.now() - tOpenAI2;

        const choice2 = completion2.choices?.[0];
        console.log('[stage2/generate-draft] ★OPENAI RESPONSE DIAGNOSTIC (2ND ATTEMPT)★', {
          finishReason: choice2?.finish_reason,
          hasContent: Boolean(choice2?.message?.content),
          contentLength: choice2?.message?.content?.length ?? 0,
          promptTokens: completion2.usage?.prompt_tokens,
          completionTokens: completion2.usage?.completion_tokens,
          totalTokens: completion2.usage?.total_tokens,
        });

        console.log('[stage2/generate-draft] ★AFTER OPENAI 2ND ATTEMPT SUCCESS★', {
          durationMs: `${tOpenAI2Dur}ms`,
          rawLen: raw.length,
          hasContent: !!raw,
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

    console.log('[stage2/generate-draft] ★JSON PARSE START★', { rawLen: raw.length });

    const { parsed, diagnostic } = extractJsonLoose(raw);
    console.log('[stage2/generate-draft] ★JSON PARSE RESULT★', diagnostic);

    if (!parsed) {
      console.error('[stage2/generate-draft] ★JSON PARSE FAILED★', {
        diagnostic,
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
      if (process.env.NODE_ENV === 'development' || process.env.DEBUG_AI_MODELS === '1') {
        console.log(`[AI] stage2-draft-repair → ${model}`);
      }
      console.log('[stage2/generate-draft] ★REPAIR PHASE START★', {
        missingCount: missing.length,
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
            ...getTemperatureParam(model, 0.0),
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: buildRepairSystemPrompt() },
              { role: 'user', content: buildRepairUserPrompt(repairPayload, missing, must) },
            ],
            ...getTokenLimitParam(model, 4000),
            ...(model.startsWith('gpt-5.6') ? { reasoning_effort: 'low' } : {}),
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

    // ★ 監査ログ記録
    try {
      await logAuditEvent({
        companyId: strategyCompanyId,
        actorUserId: userId,
        action: 'stage2_generate_draft',
        targetType: 'strategy_data',
        metadata: {
          storyDraftCount: finalStory.length,
          winPatternsCount: normalizedWinPatterns.length,
          issueBlocksCount: input.issueBlocks?.length || 0,
          hasMVV: !!input.mvv?.mission,
          hasSWOT: !!(input.swot?.strength || input.swot?.weakness || input.swot?.opportunity || input.swot?.threat),
          totalDurationMs,
        },
        ...extractAuditMetadata(req),
      });
    } catch (auditErr) {
      console.warn('[stage2/generate-draft] audit log failed (non-blocking):', auditErr);
    }

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
