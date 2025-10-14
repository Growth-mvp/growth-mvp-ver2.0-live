export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { getIndustryLabel as _getIndustryLabel } from '@/utils/industryTemplates';
import { saveFinalStory } from '@/utils/supabase';

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
  // 漢字・ひらがな・カタカナの間の半角スペースを除去
  out = out.replace(
    /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[ ]+([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu,
    '$1$2',
  );
  // 記号の直前/直後の余計な半角スペースを削除
  out = out.replace(/([、。％%！!？?」』）)＞>])[ ]+/gu, '$1');
  out = out.replace(/[ ]+([、。％%！!？?」』）)＞>])/gu, '$1');
  // 数字と％の間のスペースを詰める
  out = out.replace(/(\d)[ ]+％/g, '$1％');
  // 連続スペースを単一化
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

  const base: Record<string, unknown> = {
    model,
    temperature,
    max_tokens,
    presence_penalty,
    frequency_penalty,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
  if (SUPPORTS_JSON_MODE.test(model)) {
    (base as any).response_format = { type: 'json_object' };
  }

  try {
    const resp = await openai.chat.completions.create(base as any, {
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

function ensureBridges(
  sections: { heading: string; body: string }[],
): { heading: string; body: string }[] {
  const bridges: Record<string, string> = {
    'なぜ今': '──では我々は、衰退を避けるために『どう戦う』べきなのか？',
    'どう戦う': '──この戦略を進め、我々は『どんな未来』を実現するのか？',
    'どんな未来': '──この未来を実現するために、我々は『どう行動する』べきなのか？',
  };
  return sections.map((s, i) => {
    const b = bridges[s.heading];
    if (!b || i === sections.length - 1) return s;
    const txt = normalizeNewlines(s.body || '');
    if (/──/.test(txt) || /どう戦う|どんな未来|どう行動する/.test(txt.slice(-50))) return s;
    return { ...s, body: (txt.trim() + '\n' + b).trim() };
  });
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
    // オプション：ポートフォリオ連携（存在時のみ）
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
    if (!portfolio?.businesses?.length) return '';
    const focus = portfolio?.focus ? `／注力=${portfolio.focus}` : '';
    const list = portfolio.businesses
      .slice(0, 6)
      .map(b => b?.name)
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

  const s2 = [
    '資源の再配分：やめることを明確化し、勝ち筋に集中する。',
    ...howBullets.map((b) => `・${b}`),
    'やらないこと：汎用ビルド、カスタム過多、非中核の横展開は抑制。',
  ].join('\n');

  const s3 = [
    '3年後、指名検索は現在比＋30％、プロダクトNPSは＋10を目指す。',
    '主要セグメントでの導入期間は半減、TTV短縮で事例創出→紹介の循環へ。',
    '現場の時間は価値体験へ再配置され、解約率は構造的に低下する。',
  ].join('\n');

  const s4 = [
    `まず今四半期：トップ3課題に直結する改善→顧客の体感に効く一撃を出す。`,
    `やめること：成果に寄与しないカスタム/個別最適の横展開。`,
    `各人の期待行動：学びを共有し、速く試し、速く直す（${sanitize(thought, 120) || '覚悟と誠実さ'}）。`,
    'この難局を伝説へ変えるのは、私たち自身だ。',
  ].join('\n');

  let sections = [
    { heading: 'なぜ今', body: s1 },
    { heading: 'どう戦う', body: s2 },
    { heading: 'どんな未来', body: s3 },
    { heading: 'どう行動する', body: s4 },
  ];

  // ブリッジ & 整形
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

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const {
      userId,
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
      budgets, // { longform: [min, max] } など（現状は未使用・互換のため残置）
      patterns, // ④ 追加：勝ちパターンの連携（string[] | WinningPatternKey[]）
      // 追加：STAGE1由来のポートフォリオ（任意）
      portfolio, // { businesses:[{name,...}], focus?:string }
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

    // 勝ちパターン表記（未指定なら '—'）
    const patternsArr: string[] = Array.isArray(patterns)
      ? (patterns as Array<string | WinningPatternKey>).map((p) => String(p))
      : [];
    const patternsLine = patternsArr.length ? patternsArr.join(', ') : '—';

    void budgets; // 未使用（互換のため残置）

    /* ---------- System ---------- */
    const systemPrompt = `
あなたは経営者であり、すべての社員とともに成長を実現に導くリーダーです。会社の存続と繁栄を賭けた、最も重要な戦略を社員全員に伝えるため、以下の構成で「腹の底からの本音のメッセージ」を起草してください。

【構成指示（執筆時の思考の軸）】
1. 【衝撃と共感から始める】
- 現状への率直な危機感を、具体の事実で語れ。美辞麗句は禁止。
2. 【選択と集中の覚悟】
- やめることを明示し、資源集中の必然性を腹落ちさせよ。
3. 【描く勝利のイメージ（具体）】
- 3年後の顧客の風景を描写せよ（数字が無ければ定性表現で代替）。
4. 【各個人への熱いバトン】
- 「変えろ」「挑戦しろ」「成長しろ」を、期待行動として言い切れ。
5. 【結束への呼びかけ】
- 創業の想いをにじませ、難局を伝説へ変える決意で締めよ。

【文体とトーン】
- 形式張らず、人間の語りで。覚悟と期待が伝わる言葉を選べ。

【勝ちパターン（必ず反映）】
- 入力された勝ちパターンに整合する語り・事例・トレードオフを織り込むこと。
- 「やらないこと」の宣言も勝ちパターンの選択理由と整合させること。

【統合と出力ルール（厳守）】
- 上記5要素を次の4章に自然に統合（5は第4章の締めへ）。
- 見出しは固定：なぜ今 / どう戦う / どんな未来 / どう行動する
- 各章は2〜4段落。数値は fin_json にあるもののみ使用（捏造禁止）。
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

    // 任意：ポートフォリオの要約（STAGE1 連携）
    const portfolioSummary = (() => {
      const p = portfolio as any;
      if (!p?.businesses?.length) return '—';
      const list = (p.businesses as any[])
        .slice(0, 8)
        .map((b) => b?.name)
        .filter(Boolean)
        .join('・');
      const focus = p?.focus ? `（注力=${p.focus}）` : '';
      return list ? `${list}${focus}` : '—';
    })();

    const userPrompt = `
【会社】業種=${industryJp || (typeof industry === 'string' ? industry : '—')}／売上=${
      revenue ? `${revenue}百万円` : '—'
    }／人数=${employees ? `${employees}人` : '—'}
【MVV】M=${sanitize(mission, 300) || '—'}／V=${
      sanitize(vision, 300) || '—'
    }／Val=${sanitize(value, 300) || '—'}
【SWOT】S=${sanitize(strength, 400) || '—'}／W=${
      sanitize(weakness, 400) || '—'
    }／O=${sanitize(opportunity, 400) || '—'}／T=${sanitize(threat, 400) || '—'}
【勝ちパターン】${patternsLine}
【事業ポートフォリオ】${portfolioSummary}
【経営者の思い(断片)】${sanitize(thought, 600) || '—'}

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

    let finalStory, longform, sections;

    if (!usedHeuristic && raw) {
      type GenOut = { sections?: Array<{ heading?: string; body?: string }> };
      const parsed = extractJsonLoose<GenOut>(raw);

      sections =
        Array.isArray(parsed?.sections) && parsed!.sections!.length >= 4
          ? coerceToSimpleHeads(parsed!.sections!)
          : coerceToSimpleHeads(parsed?.sections || []);

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
        portfolio: (portfolio as any) ?? null,
      });
      finalStory = h.finalStory;
      longform = h.longform;
      sections = h.sections;
    }

    // 任意保存（存在すれば実行）
    if (typeof userId === 'string' && userId && typeof saveFinalStory === 'function') {
      try {
        await saveFinalStory(userId, finalStory as any, '');
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
