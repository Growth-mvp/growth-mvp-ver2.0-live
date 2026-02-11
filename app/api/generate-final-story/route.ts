/* eslint-disable @typescript-eslint/no-explicit-any */
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { getIndustryLabel as _getIndustryLabel } from '@/utils/industryTemplates';
import { saveFinalStory } from '@/utils/supabase';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';

/* =========================
 * モデル選択（簡素化）
 * =======================*/
const MODEL_PRIMARY =
  process.env.OPENAI_MODEL ?? process.env.NEXT_PUBLIC_OPENAI_MODEL ?? 'gpt-4o';
const MODEL_FALLBACK = 'gpt-4o-mini';
const SUPPORTS_JSON_MODE = /^gpt-4o($|-)/;

/* =========================
 * 勝ちパターン10選（④連携）
 * =======================*/
type WinningPatternKey =
  | 'priceLeader'
  | 'categoryKing'
  | 'nicheDomination'
  | 'platformPlay'
  | 'subscriptionMoat'
  | 'manufacturingKaizen'
  | 'serviceDelight'
  | 'dataNetwork'
  | 'brandTrust'
  | 'speedOperator';

/* =========================
 * 見出し（固定）
 * =======================*/
const SIMPLE_HEADS = ['なぜ今', 'どう戦う', 'どんな未来', 'どう行動する'] as const;
const TITLE_TEMPLATES = [
  '第1章：なぜ今',
  '第2章：どう戦う',
  '第3章：どんな未来',
  '第4章：どう行動する',
] as const;

/* =========================
 * Utils（必要最小限）
 * =======================*/
function sanitize(text: unknown, max = 4000): string {
  const s = text == null ? '' : typeof text === 'string' ? text : String(text);
  return s.replace(/\u0000/g, '').replace(/\s+$/g, '').slice(0, max);
}
function normalizeNewlines(s = ''): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
function safeSerialize(v: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
}
function safeGetIndustryLabel(code: string, opts?: { full?: boolean }): string {
  try {
      if (typeof _getIndustryLabel === 'function') return _getIndustryLabel(code, opts);
  } catch {}
  return code || '—';
}
function extractJsonLoose<T = any>(raw: string): T | null {
  if (!raw) return null;
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw);
  if (direct && (typeof direct === 'object' || Array.isArray(direct))) return direct;
  const fence = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const j = tryParse(fence[1]);
    if (j) return j;
  }
  const obj = raw.match(/\{[\s\S]*\}/);
  if (obj?.[0]) {
    const j = tryParse(obj[0]);
    if (j) return j;
  }
  const arr = raw.match(/\[[\s\S]*\]/);
  if (arr?.[0]) {
    const j = tryParse(arr[0]);
    if (j) return j;
  }
  return null;
}

/** 日本語テキストの余計な半角スペースを整理 */
function tidyJa(s: string): string {
  if (!s) return s;
  let out = s;
  // 漢字・ひらがな・カタカナ間の半角スペースを除去
  out = out.replace(
    /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[ ]+([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu,
    '$1$2',
  );
  // 記号前後の余計なスペース
  out = out.replace(/([、。％%！!？?」』）)＞>])[ ]+/gu, '$1');
  out = out.replace(/[ ]+([、。％%！!？?」』）)＞>])/gu, '$1');
  // 数字と％を詰める
  out = out.replace(/(\d)[ ]+％/g, '$1％');
  // 連続スペース縮約
  out = out.replace(/[ ]{2,}/g, ' ');
  return out;
}

/* =========================
 * 財務ミニ要約（スリム版）
 * =======================*/
type FinanceRow = Record<string, unknown>;
type Trend = 'up' | 'flat' | 'down' | null;

function tryParseJsonLocal<T = any>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function coerceFinanceArray(src: unknown): FinanceRow[] | undefined {
  if (Array.isArray(src)) return src as FinanceRow[];
  if (typeof src !== 'string') return undefined;
  const j = tryParseJsonLocal(src);
  if (Array.isArray(j)) return j as FinanceRow[];
  const lines = src.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return undefined;
  const headers = lines[0].split(',').map((h) => h.trim()).filter(Boolean);
  if (!headers.length) return undefined;
  const rows = lines.slice(1).map((ln) => {
    const cols = ln.split(',');
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (cols[i] ?? '').trim();
    });
    return obj as FinanceRow;
  });
  return rows;
}
function toNum(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[,\s％%]/g, '');
  if (!s || s.toLowerCase() === 'nan' || s.toLowerCase() === 'null') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function normKey(k: string): string {
  return k.toLowerCase().replace(/\s+|[_\-（）()]/g, '');
}
function pickField(row: FinanceRow, keys: string[]): number | null {
  const map = new Map<string, string>();
  for (const kk of Object.keys(row)) map.set(normKey(kk), kk);
  for (const k of keys) {
    const found = map.get(normKey(k));
    if (found) {
      const n = toNum((row as any)[found]);
      if (n != null) return n;
    }
  }
  for (const k of keys) {
    const nk = normKey(k);
    const maybe = [...map.keys()].find((kk) => kk.startsWith(nk));
    if (maybe) {
      const orig = map.get(maybe)!;
      const n = toNum((row as any)[orig]);
      if (n != null) return n;
    }
  }
  return null;
}
function getYear(row: FinanceRow): number | null {
  const keys = ['year', '年度', '決算年度', '会計年度', 'fiscalyear', '期'];
  for (const k of keys) {
    const m = Object.keys(row).find((kk) => normKey(kk) === normKey(k));
    if (m) {
      const val = (row as any)[m];
      const y = String(val).match(/(20\d{2}|19\d{2})/);
      if (y) return Number(y[1]);
      const n = toNum(val);
      if (n != null) return n;
    }
  }
  for (const v of Object.values(row))
    if (typeof v === 'string') {
      const y = v.match(/(20\d{2}|19\d{2})/);
      if (y) return Number(y[1]);
    }
  return null;
}
type FinanceSummary = {
  rowsUsed: number;
  latestYear?: number;
  latestSales?: number;
  latestOpMargin?: number | null;
  revCagrPct?: number | null;
  trend?: Trend;
};
function buildFinanceSummary(csvFinanceData: unknown): FinanceSummary | null {
  const arr =
    coerceFinanceArray(csvFinanceData) ??
    (Array.isArray(csvFinanceData) ? (csvFinanceData as FinanceRow[]) : undefined);
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const normalized = arr
    .map((r) => {
      const year = getYear(r);
      const sales =
        pickField(r, ['sales', 'revenue', '売上', '売上高', '売上(百万円)', '売上高(百万円)']) ??
        (pickField(r, ['売上高(万円)', '売上(万円)']) != null
          ? ((pickField(r, ['売上高(万円)', '売上(万円)']) as number) ?? 0) * 0.1
          : null);
      const opProfit = pickField(r, ['operatingprofit', '営業利益', '営業利益(百万円)']);
      let opMargin = pickField(r, ['operatingmargin', '営業利益率']);
      if (opMargin == null && opProfit != null && sales != null && sales !== 0) {
        opMargin = (opProfit / sales) * 100;
      }
      return { year, sales, opMargin };
    })
    .filter((x) => x.year != null || x.sales != null);

  if (normalized.length === 0) return null;

  normalized.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  const latest = normalized[0];

  const revPoints = normalized
    .filter((r) => r.year != null && r.sales != null)
    .slice()
    .sort((a, b) => (a.year as number) - (b.year as number));

  let revCagrPct: number | null = null;
  if (revPoints.length >= 2) {
    const first = revPoints[0];
    const last = revPoints[revPoints.length - 1];
    const years = (last.year! - first.year!) || 1;
    if ((first.sales! as number) > 0 && years > 0) {
      const cagr = Math.pow((last.sales! as number) / (first.sales! as number), 1 / years) - 1;
      revCagrPct = cagr * 100;
    }
  }

  let trend: Trend = null;
  if (revPoints.length >= 2) {
    const diffs = revPoints
      .slice(1)
      .map((p, i) => (p.sales! as number) - (revPoints[i].sales! as number));
    const up = diffs.every((d) => d >= 0);
    const down = diffs.every((d) => d <= 0);
    trend = up ? 'up' : down ? 'down' : 'flat';
  }

  return {
    rowsUsed: arr.length,
    latestYear: latest.year ?? undefined,
    latestSales: latest.sales ?? undefined,
    latestOpMargin: latest.opMargin ?? null,
    revCagrPct,
    trend,
  };
}

/* =========================
 * Q&A（直近3件を引用）
 * =======================*/
type AnswerStep = { stepNumber: number; question: string; reason: string; answer: string };
type ChapterAnswers = { chapterIndex: number; chapterTitle: string; steps: AnswerStep[] };

function buildAnswersRich(a2: ChapterAnswers[] = [], take = 3): string {
  const blocks: string[] = [];
  const by = [...a2]
    .sort((a, b) => (a.chapterIndex ?? 0) - (b.chapterIndex ?? 0))
    .slice(0, 4);
  for (const chap of by) {
    const steps = (chap.steps ?? []).slice(-take);
    const quotes = steps
      .map((s) => (s.answer || s.reason || '').trim())
      .filter(Boolean)
      .map((t) => `「${sanitize(t, 60)}」`);
    if (quotes.length)
      blocks.push(
        `- ${chap.chapterTitle || `第${(chap.chapterIndex ?? 0) + 1}章`} の現場の声: ${quotes.join(
          ' / ',
        )}`,
      );
  }
  return blocks.join('\n');
}

/* =========================
 * 事業ポートフォリオ正規化
 * =======================*/
type NormalizedBusiness = {
  name: string;
  revenueShare?: number;
  growth?: number;
  margin?: number;
};
type NormalizedPortfolio = {
  businesses?: NormalizedBusiness[];
  focus?: string;
};

function normalizePortfolioInput(
  portfolio: unknown,
  businessPortfolio: unknown,
): NormalizedPortfolio | null {
  // ① 旧形式 { businesses: [...], focus?: string } が来ている場合
  const p = portfolio as any;
  if (p && Array.isArray(p.businesses)) {
    const businesses: NormalizedBusiness[] = (p.businesses as any[]).map((b) => ({
      name:
        b?.name ??
        b?.businessName ??
        b?.segmentName ??
        b?.title ??
        '（名称未設定の事業）',
      revenueShare:
        typeof b?.revenueShare === 'number'
          ? b.revenueShare
          : typeof b?.salesShare === 'number'
          ? b.salesShare
          : typeof b?.share === 'number'
          ? b.share
          : undefined,
      growth:
        typeof b?.growthRate === 'number'
          ? b.growthRate
          : typeof b?.growth === 'number'
          ? b.growth
          : undefined,
      margin:
        typeof b?.profitMargin === 'number'
          ? b.profitMargin
          : typeof b?.margin === 'number'
          ? b.margin
          : undefined,
    }));
    return { businesses, focus: p?.focus };
  }

  // ② 新形式 businessPortfolio: BusinessPortfolioItem[] 想定
  if (Array.isArray(businessPortfolio) && businessPortfolio.length) {
    const businesses: NormalizedBusiness[] = (businessPortfolio as any[]).map((b) => ({
      name:
        b?.name ??
        b?.businessName ??
        b?.segmentName ??
        b?.title ??
        '（名称未設定の事業）',
      revenueShare:
        typeof b?.revenueShare === 'number'
          ? b.revenueShare
          : typeof b?.salesShare === 'number'
          ? b.salesShare
          : typeof b?.share === 'number'
          ? b.share
          : undefined,
      growth:
        typeof b?.growthRate === 'number'
          ? b.growthRate
          : typeof b?.growth === 'number'
          ? b.growth
          : undefined,
      margin:
        typeof b?.profitMargin === 'number'
          ? b.profitMargin
          : typeof b?.margin === 'number'
          ? b.margin
          : undefined,
    }));
    return { businesses };
  }

  return null;
}

/* =========================
 * OpenAI 呼び出し（JSON強制＋フォールバック）
 * =======================*/
type ChatArgs = {
  model: string;
  temperature: number;
  max_tokens: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  system: string;
  user: string;
};

async function callOpenAIChat(args: ChatArgs): Promise<string> {
  const {
    model,
    temperature,
    max_tokens,
    presence_penalty = 0.7,
    frequency_penalty = 0.3,
    system,
    user,
  } = args;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 58_000);

  const base: ChatCompletionCreateParamsNonStreaming = {
    model,
    temperature,
    max_tokens,
    presence_penalty,
    frequency_penalty,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    ...(SUPPORTS_JSON_MODE.test(model)
      ? { response_format: { type: 'json_object' as const } }
      : {}),
  };

  try {
    const resp = await openai.chat.completions.create(base, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return resp.choices?.[0]?.message?.content?.trim() ?? '';
  } catch (e: any) {
    clearTimeout(timer);
    const status =
      e?.status ?? e?.response?.status ?? (e?.name === 'AbortError' ? 504 : 500);
    // 429/5xx → フォールバック（mini）
    if ((status === 429 || status >= 500) && args.model !== MODEL_FALLBACK) {
      return await callOpenAIChat({ ...args, model: MODEL_FALLBACK });
    }
    throw {
      status,
      message: e?.message || 'OpenAI error',
      type: 'openai_error',
      raw: safeSerialize(e),
    };
  }
}

/* =========================
 * 軽い正規化＆ブリッジ補助
 * =======================*/
type SectionLike = { heading?: string; body?: string };

function coerceToSimpleHeads(
  sections: SectionLike[],
): { heading: string; body: string }[] {
  const arr = Array.isArray(sections) ? sections : [];
  const out: { heading: string; body: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const src = arr[i] || {};
    out.push({
      heading: SIMPLE_HEADS[i],
      body: sanitize(src.body || '', 4000) || '（この章は未生成です）',
    });
  }
  return out;
}

const ENABLE_BRIDGES = false; // 将来 true にすれば復活できる

function ensureBridges(
  sections: { heading: string; body: string }[],
): { heading: string; body: string }[] {
  // 章間ブリッジを差し込まないバージョン
  return sections;
}

/* =========================
 * 429/5xx 時のヒューリスティック最終ストーリー生成
 * =======================*/
function heuristicFinal(
  args: {
    industryJp: string;
    revenue?: unknown;
    employees?: unknown;
    mission?: unknown;
    vision?: unknown;
    value?: unknown;
    strength?: unknown;
    weakness?: unknown;
    opportunity?: unknown;
    threat?: unknown;
    finMini: {
      year?: number;
      sales?: number;
      opm?: number | null;
      rev_cagr?: number | null;
      trend?: Trend | null;
    } | null;
    patterns: string[];
    thought?: unknown;
    portfolio?: {
      businesses?: Array<{ name: string; revenueShare?: number; margin?: number; growth?: number }>;
      focus?: string;
    } | null;
  },
) {
  const {
    industryJp,
    revenue,
    employees,
    mission,
    vision,
    value,
    strength,
    weakness,
    opportunity,
    threat,
    finMini,
    patterns,
    thought,
    portfolio,
  } = args;

  const header = `業種=${industryJp || '—'}／売上=${revenue ? `${revenue}百万円` : '—'}／人数=${employees ? `${employees}人` : '—'}`;
  const finLine =
    finMini
      ? `（財務）最新年度=${finMini.year ?? '—'}／売上=${finMini.sales ?? '—'}／営業利益率=${finMini.opm ?? '—'}％／CAGR=${finMini.rev_cagr == null ? '—' : `${(finMini.rev_cagr as number).toFixed(1)}％`}／トレンド=${finMini.trend ?? '—'}`
      : '（財務）—';

  const pat = patterns.length ? `【勝ちパターン】${patterns.join(', ')}` : '【勝ちパターン】—';

  const portfolioLine = (() => {
    const pf = portfolio as any;
    if (!pf?.businesses?.length) return '';
    const focus = pf?.focus ? `／注力=${pf.focus}` : '';
    const list = (pf.businesses as any[])
      .slice(0, 6)
      .map((b) => b?.name)
      .filter(Boolean)
      .join('・');
    return `\n【事業ポートフォリオ】${list || '—'}${focus}`;
  })();

  const s1 = [
    header,
    `M=${sanitize(mission, 200) || '—'}／V=${sanitize(vision, 200) || '—'}／Val=${sanitize(value, 200) || '—'}`,
    `S=${sanitize(strength, 200) || '—'}／W=${sanitize(weakness, 200) || '—'}／O=${sanitize(opportunity, 200) || '—'}／T=${sanitize(threat, 200) || '—'}`,
    finLine,
    pat + portfolioLine,
  ].join('\n');

  const howBullets: string[] = [];
  if (patterns.includes('subscriptionMoat')) {
    howBullets.push('サブスク継続価値の明文化（やめない理由）と先回りCS');
  }
  if (patterns.includes('platformPlay')) {
    howBullets.push('主要SaaS/APIとの接続をテンプレ化し、導入→価値発現を短縮');
  }
  if (patterns.includes('serviceDelight')) {
    howBullets.push('オンボーディングTTVを短縮し、NPS・紹介の循環を作る');
  }
  if (patterns.includes('manufacturingKaizen')) {
    howBullets.push('内製ツール×標準作業で欠陥と手戻りを継続削減');
  }
  if (patterns.includes('dataNetwork')) {
    howBullets.push('利用データのネットワーク効果で精度向上→解約率低下');
  }
  if (howBullets.length === 0) {
    howBullets.push('重点セグメント集中と、勝ち筋に沿った投資配分の徹底');
  }

  // ★フォールバック時も第2章冒頭に「自社の勝ち筋：〜」を1行入れる
  const winningLine =
    patterns.length > 0
      ? `自社の勝ち筋：${patterns.join(' / ')}`
      : '自社の勝ち筋：選んだ勝ちパターンに沿って、資源を集中して勝ち切る';

  const s2 = [
    winningLine,
    '資源の再配分：やめることを明確化し、勝ち筋に集中する。',
    ...howBullets.map((b) => `・${b}`),
    'やらないこと：汎用ビルド、カスタム過多、非中核の横展開は抑制。',
    '──ここに、私たちの「誇り」を賭ける。安易な拡張よりも、本質的な価値で勝つ。',
  ].join('\n');

  const s3 = [
    '3年後、指名検索は現在比＋30％、プロダクトNPSは＋10を目指す。',
    '主要セグメントでの導入期間は半減、TTV短縮で事例創出→紹介の循環へ。',
    '現場の時間は価値体験へ再配置され、解約率は構造的に低下する。',
    '──未知に踏み出す「賭け」を受け止める。迷いなく、未来の当たり前をこちらから作る。',
  ].join('\n');

  const s4 = [
    `まず今四半期：トップ3課題に直結する改善→顧客の体感に効く一撃を出す。`,
    `やめること：成果に寄与しないカスタム/個別最適の横展開。`,
    `各人の期待行動：学びを共有し、速く試し、速く直す（${sanitize(thought, 120) || '覚悟と誠実さ'}）。`,
    '──どんな逆風でも「信念」は曲げない。仲間とやり抜く、ここからが本番だ。',
  ].join('\n');

  let sections = [
    { heading: 'なぜ今', body: s1 },
    { heading: 'どう戦う', body: s2 },
    { heading: 'どんな未来', body: s3 },
    { heading: 'どう行動する', body: s4 },
  ];

  sections = ensureBridges(sections);
  sections = sections.map((s) => ({ ...s, body: tidyJa(normalizeNewlines(s.body)) }));

  const longform = sections
    .map((s) => `【${s.heading}】\n${sanitize(normalizeNewlines(s.body), 4000)}`)
    .join('\n\n');

  const bodies = sections.map((s) => s.body);
  const finalStory = TITLE_TEMPLATES.map((title, i) => ({
    title,
    body: bodies[i] || '（この章は未生成です）',
  }));

  return { finalStory, longform, sections };
}

/* =========================
 * 二段階目：感情エディット（任意）
 * =======================*/
async function enhanceEmotionIfNeeded(
  sections: { heading: string; body: string }[],
  thought: unknown,
  patternsLine: string,
  temperature: number,
  model: string,
  enable: boolean,
): Promise<{ heading: string; body: string }[]> {
  if (!enable) return sections;

  try {
    const system = [
      'あなたは経営ストーリーのエディターです。構造を壊さずに「経営者の語り口」へ整え、熱・覚悟・人間的な説得力を増幅します。',
      '出力は JSON のみ。{"sections":[{"heading":"なぜ今","body":"..."},...]} の形式で返す。',
    ].join('\n');

    const user = [
      '【編集方針】',
      '- 第2章に「誇り」／第3章に「賭け」／第4章に「信念」を、自然な一文として必ず含める（既にあれば自然に残す）。',
      '- 現場が腹落ちする具体性（情景・比較・選択）を強める。比喩は控えめ、断定的文体で。',
      '- 文量は各章2〜4段落、長すぎるときは圧縮。',
      '',
      `【勝ちパターン】${patternsLine || '—'}`,
      `【経営者の思い（断片）】${sanitize(thought, 600) || '—'}`,
      '',
      '【対象JSON】',
      JSON.stringify({ sections }).slice(0, 7000),
      '',
      '【出力形式（厳守）】',
      '{"sections":[{"heading":"なぜ今","body":"..."}]} のみ。',
    ].join('\n');

    const base: ChatCompletionCreateParamsNonStreaming = {
      model,
      temperature: Math.min(0.7, (typeof temperature === 'number' ? temperature : 0.95) + 0.1),
      max_tokens: 1200,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...(SUPPORTS_JSON_MODE.test(model)
        ? { response_format: { type: 'json_object' as const } }
        : {}),
    };

    const r = await openai.chat.completions.create(base);
    const raw = r.choices?.[0]?.message?.content?.trim() || '';
    const parsed = extractJsonLoose<{ sections?: { heading?: string; body?: string }[] }>(raw);
    const enhanced = Array.isArray(parsed?.sections) ? parsed!.sections! : null;
    if (!enhanced || enhanced.length < 4) return sections;

    let fixed = coerceToSimpleHeads(enhanced);
    fixed = ensureBridges(fixed).map((s) => ({ ...s, body: tidyJa(normalizeNewlines(s.body)) }));
    return fixed;
  } catch {
    return sections;
  }
}

/* =========================
 * ルート
 * =======================*/
export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return new NextResponse(
        JSON.stringify({ error: 'OPENAI_API_KEY is missing' }),
        {
          status: 500,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        },
      );
    }

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

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const {
      thought,
      mission,
      vision,
      value,
      industry,
      revenue,
      employees,
      strength,
      weakness,
      opportunity,
      threat,
      csvFinanceData,
      answers2,
      temperature = 0.95,
      budgets, // 互換のため残置
      patterns, // string[] | WinningPatternKey[]
      portfolio, // 旧形式 { businesses: [...], focus?: string }
      businessPortfolio, // 新形式 BusinessPortfolioItem[]（任意）
      enhanceEmotion, // ★ 追加：true/false（未指定はtrue）
    } = body;

    const fin = buildFinanceSummary(csvFinanceData);
    const industryJp = safeGetIndustryLabel(
      typeof industry === 'string' ? industry : '',
      { full: true },
    );

    const finMini =
      fin != null
        ? {
            year: fin.latestYear,
            sales: fin.latestSales,
            opm: fin.latestOpMargin,
            rev_cagr: fin.revCagrPct,
            trend: fin.trend,
          }
        : null;

    const patternsArr: string[] = Array.isArray(patterns)
      ? (patterns as Array<string | WinningPatternKey>).map((p) => String(p))
      : [];
    const patternsLine = patternsArr.length ? patternsArr.join(', ') : '—';

    // 旧 portfolio / 新 businessPortfolio を統合して正規化
    const normalizedPortfolio = normalizePortfolioInput(portfolio, businessPortfolio);

    void budgets; // 未使用（互換のため残置）

    /* ---------- System ---------- */
    const systemPrompt = `
あなたは「未来逆算×両利きの経営」を率いる経営者であり、全社員に本音と覚悟を届けるストーリーファシリテーターです。以下の構成で、役割の殻を壊し、外へ価値を広げる行進を描いてください。

【執筆の中核（VISIONモード／未来→現在の逆算）】
1. 【衝撃と共感から始める】過去の延長をやめ、3〜5年先の“当たり前”から今を見直す。事実で危機を語る。
2. 【選択と集中の覚悟】勝つ所に資源を寄せ、やめることを明言。内部越境（営業×開発×生産×人事）を前提に。
3. 【描く勝利のイメージ】顧客の一場面で価値を見える化（SHOW, DON’T TELL）。数値が無ければ定性で可視化（KCI=創造の兆し）。
4. 【各個人への熱いバトン】期待行動を言い切る。「自分で決める」「速く試す」「学びを翌週反映」。

【魂の三要素（必ず自然文で挿入）】
- 第2章に「誇り」を示す一文（私たちが守り抜いてきた本質・流儀）。
- 第3章に「賭け」を示す一文（未来へ踏み出す決断・リスクを受け止める覚悟）。
- 第4章に「信念」を示す一文（仲間とやり抜く、何があってもブレない原則）。

【勝ちパターン（必ず反映）】
- 入力された勝ちパターンに整合する語り・事例・トレードオフを織り込む。
- 「やらないこと」宣言は、選んだパターンのロジックと矛盾させない。

【事業ポートフォリオを踏まえた書き方】
- 主要事業の売上比率・成長率・利益率が与えられている場合、「どこで勝ちに行くか／どこを維持・縮小するか」を第2〜3章で自然に言語化する。
- ただし個別事業の詳細な損益計画には入り込みすぎず、「勝ち筋」との整合がわかる粒度で語る。

【自社の勝ち筋（一文）の扱い】
- ユーザーコンテンツの「現場の声（直近から抽出/引用候補）」は、全12問の回答のエッセンスである。
- これらをもとに、「私たちは◯◯で勝つ」という一文の「自社の勝ち筋」をあなた自身で組み立てること。
- 第2章「どう戦う」の本文の最初または2段落目以内に、「自社の勝ち筋：〜」という一文を必ず1回だけ明記すること。
- 以降の段落・他章の内容は、この一文と矛盾しないように、資源配分・やめること・KPI・人の動き方を描くこと。

【出力制約（厳守）】
- 次の4章構成で自然に統合：なぜ今 / どう戦う / どんな未来 / どう行動する
- 各章2〜4段落。数値は fin_json のみ参照（創作禁止）。社員が読んで腹に落ちる語り。
- 出力はJSONのみ、スキーマ：
{
  "sections":[
    {"heading":"なぜ今","body":"..."},
    {"heading":"どう戦う","body":"..."},
    {"heading":"どんな未来","body":"..."},
    {"heading":"どう行動する","body":"..."}
  ]
}
`.trim();

    /* ---------- User（素材） ---------- */
    const answersRich = buildAnswersRich(
      Array.isArray(answers2) ? (answers2 as ChapterAnswers[]) : [],
      3,
    );

    const portfolioSummary = (() => {
      const p = normalizedPortfolio as any;
      if (!p?.businesses?.length) return '—';
      const list = (p.businesses as any[])
        .slice(0, 8)
        .map((b) => {
          const name = b?.name ?? '（名称未設定の事業）';
          const bits: string[] = [];
          if (typeof b?.revenueShare === 'number')
            bits.push(`売上比${b.revenueShare}%`);
          if (typeof b?.growth === 'number')
            bits.push(`成長${b.growth}%`);
          if (typeof b?.margin === 'number')
            bits.push(`利益率${b.margin}%`);
          return bits.length ? `${name}（${bits.join(' / ')}）` : name;
        })
        .filter(Boolean)
        .join('・');
      const focus = p?.focus ? `（注力=${p.focus}）` : '';
      return list ? `${list}${focus}` : '—';
    })();

    const userPrompt = `
【会社】業種=${industryJp || (typeof industry === 'string' ? industry : '—')}／売上=${revenue ? `${revenue}百万円` : '—'}／人数=${employees ? `${employees}人` : '—'}
【MVV】M=${sanitize(mission, 300) || '—'}／V=${sanitize(vision, 300) || '—'}／Val=${sanitize(value, 300) || '—'}
【SWOT】S=${sanitize(strength, 400) || '—'}／W=${sanitize(weakness, 400) || '—'}／O=${sanitize(opportunity, 400) || '—'}／T=${sanitize(threat, 400) || '—'}
【勝ちパターン】${patternsLine}
【事業ポートフォリオ】${portfolioSummary}
【経営者の思い(断片)】${sanitize(thought, 1000) || '—'}

【fin_json】
${JSON.stringify(finMini)}

【現場の声（直近から抽出/引用候補）】
${answersRich || '—'}

【出力仕様】上記の制約・形式を厳守。`.trim();

    /* ---------- OpenAI 呼び出し or ヒューリスティック ---------- */
    let raw = '';
    let usedModel = MODEL_PRIMARY;
    let usedHeuristic = false;

    try {
      raw = await callOpenAIChat({
        model: MODEL_PRIMARY,
        temperature:
          typeof temperature === 'number' && Number.isFinite(temperature)
            ? (temperature as number)
            : 0.95,
        max_tokens: 2300,
        presence_penalty: 0.7,
        frequency_penalty: 0.3,
        system: systemPrompt,
        user: userPrompt,
      });
    } catch (_detail: any) {
      usedHeuristic = true;
      usedModel = 'heuristic-fallback';
    }

    let finalStory, longform, sections: { heading: string; body: string }[];

    if (!usedHeuristic && raw) {
      type GenOut = { sections?: Array<{ heading?: string; body?: string }> };
      const parsed = extractJsonLoose<GenOut>(raw);

      sections =
        Array.isArray(parsed?.sections) && parsed!.sections!.length >= 4
          ? coerceToSimpleHeads(parsed!.sections!)
          : coerceToSimpleHeads(parsed?.sections || []);

      // 二段階目のエモーショナル補正（既定ON）
      const doEnhance = enhanceEmotion !== false;
      sections = await enhanceEmotionIfNeeded(
        sections,
        thought,
        patternsLine,
        typeof temperature === 'number' ? temperature : 0.95,
        MODEL_PRIMARY,
        doEnhance,
      );

      sections = ensureBridges(sections);
      sections = sections.map((s) => ({ ...s, body: tidyJa(normalizeNewlines(s.body)) }));

      longform = sections
        .map((s) => `【${s.heading}】\n${sanitize(normalizeNewlines(s.body), 4000)}`)
        .join('\n\n');

      const bodies = sections.map((s) => s.body);
      finalStory = TITLE_TEMPLATES.map((title, i) => ({
        title,
        body: bodies[i] || '（この章は未生成です）',
      }));
    } else {
      const h = heuristicFinal({
        industryJp,
        revenue,
        employees,
        mission,
        vision,
        value,
        strength,
        weakness,
        opportunity,
        threat,
        finMini,
        patterns: patternsArr,
        thought,
        portfolio: (normalizedPortfolio as any) ?? null,
      });
      finalStory = h.finalStory;
      longform = h.longform;
      sections = h.sections;
    }

    // 任意保存（存在すれば実行）
    if (typeof userId === 'string' && userId && typeof saveFinalStory === 'function') {
      try {
        await saveFinalStory(userId, finalStory as any, {});
      } catch (e: any) {
        console.warn('⚠️ final_stories 保存に失敗（続行）:', e?.message || e);
      }
    }

    return new NextResponse(
      JSON.stringify({
        finalStory,
        longform,
        sections,
        _debug: {
          model: usedModel,
          patterns: patternsArr,
          heuristic: usedHeuristic,
          enhanced: enhanceEmotion !== false,
        },
      }),
      {
        headers: {
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
          'x-fallback-used': String(usedHeuristic),
        },
        status: 200,
      },
    );
  } catch (error: any) {
    console.error('❌ 最終ストーリー生成エラー:', error?.message || error);
    const status = error?.name === 'AbortError' ? 504 : 500;
    return new NextResponse(
      JSON.stringify({
        error: '最終ストーリーの生成に失敗しました',
        detail: String(error),
      }),
      { status, headers: { 'content-type': 'application/json; charset=utf-8' } },
    );
  }
}
