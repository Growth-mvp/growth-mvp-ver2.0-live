// /app/api/generate-final-story/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getIndustryLabel as _getIndustryLabel } from '@/utils/industryTemplates';
import { saveFinalStory } from '@/utils/supabase';

/* =========================
 * OpenAI
 * =======================*/
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const ALLOW_MODELS = new Set<string>([
  'gpt-4o',
  'gpt-4o-2024-08-06',
  'gpt-4o-mini',
  'gpt-4o-mini-2024-07-18',
]);
function pickSafeModel() {
  const envModel = process.env.OPENAI_MODEL || process.env.NEXT_PUBLIC_OPENAI_MODEL || '';
  return ALLOW_MODELS.has(envModel) ? envModel : 'gpt-4o';
}
function modelSupportsJsonMode(m: string) {
  return /^gpt-4o($|-)/.test(m);
}

/* =========================
 * 見出し（短い固定）
 * =======================*/
const SIMPLE_HEADS = ['なぜ今', 'どう戦う', 'どんな未来', 'どう行動する'] as const;
const TITLE_TEMPLATES = [
  '第1章：なぜ今',
  '第2章：どう戦う',
  '第3章：どんな未来',
  '第4章：どう行動する',
] as const;

/* =========================
 * Utils
 * =======================*/
function sanitize(text: any, max = 4000): string {
  const s = text == null ? '' : typeof text === 'string' ? text : String(text);
  return s.replace(/\u0000/g, '').replace(/\s+$/g, '').slice(0, max);
}
function normalizeNewlines(s: string = '') { return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n'); }
function safeSerialize(v: any) { try { return JSON.parse(JSON.stringify(v)); } catch { return String(v); } }
function safeGetIndustryLabel(code: string, opts?: { full?: boolean }) {
  try { if (typeof _getIndustryLabel === 'function') return _getIndustryLabel(code, opts); } catch {}
  return code || '—';
}
function extractJsonLoose(raw: string): any | null {
  if (!raw) return null;
  const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
  const direct = tryParse(raw);
  if (direct && (typeof direct === 'object' || Array.isArray(direct))) return direct;
  const fence = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fence?.[1]) { const j = tryParse(fence[1]); if (j && (typeof j === 'object' || Array.isArray(j))) return j; }
  const obj = raw.match(/\{[\s\S]*\}/); if (obj?.[0]) { const j = tryParse(obj[0]); if (j && typeof j === 'object') return j; }
  const arr = raw.match(/\[[\s\S]*\]/); if (arr?.[0]) { const j = tryParse(arr[0]); if (Array.isArray(j)) return j; }
  return null;
}

/* =========================
 * 財務（軽量）
 * =======================*/
type FinanceRow = Record<string, any>;
type Trend = 'up' | 'flat' | 'down' | null;

function tryParseJsonLocal<T = any>(text: string): T | null { try { return JSON.parse(text); } catch { return null; } }
function coerceFinanceArray(src: unknown): any[] | undefined {
  if (Array.isArray(src)) return src as any[];
  if (typeof src !== 'string') return undefined;
  const j = tryParseJsonLocal(src); if (Array.isArray(j)) return j;
  const lines = src.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return undefined;
  const headers = lines[0].split(',').map(h => h.trim()).filter(Boolean);
  if (!headers.length) return undefined;
  const rows = lines.slice(1).map((ln) => {
    const cols = ln.split(',');
    const obj: Record<string, any> = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] ?? '').trim(); });
    return obj;
  });
  return rows;
}
function toNum(v: any): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[,\s％%]/g, '');
  if (!s || s.toLowerCase() === 'nan' || s.toLowerCase() === 'null') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function normKey(k: string) { return k.toLowerCase().replace(/\s+|[_\-（）()]/g, ''); }
function pickField(row: FinanceRow, keys: string[]): number | null {
  const map = new Map<string, string>();
  for (const kk of Object.keys(row)) map.set(normKey(kk), kk);
  for (const k of keys) {
    const found = map.get(normKey(k));
    if (found) {
      const n = toNum(row[found]);
      if (n != null) return n;
    }
  }
  for (const k of keys) {
    const nk = normKey(k);
    const maybe = [...map.keys()].find((kk) => kk.startsWith(nk));
    if (maybe) {
      const orig = map.get(maybe)!;
      const n = toNum(row[orig]);
      if (n != null) return n;
    }
  }
  return null;
}
function getYear(row: FinanceRow): number | null {
  const keys = ['year','年度','決算年度','会計年度','fiscalyear','期'];
  for (const k of keys) {
    const m = Object.keys(row).find((kk) => normKey(kk) === normKey(k));
    if (m) {
      const val = row[m];
      const y = String(val).match(/(20\d{2}|19\d{2})/); if (y) return Number(y[1]);
      const n = toNum(val); if (n != null) return n;
    }
  }
  for (const v of Object.values(row)) if (typeof v === 'string') {
    const y = v.match(/(20\d{2}|19\d{2})/); if (y) return Number(y[1]);
  }
  return null;
}
type FinanceSummary = {
  rowsUsed: number;
  latestYear?: number;
  latestSales?: number;
  latestOpProfit?: number | null;
  latestOpMargin?: number | null;
  latestGrossProfit?: number | null;
  latestGrossMargin?: number | null;
  latestEBITDAMargin?: number | null;
  latestOCF?: number | null;
  latestICF?: number | null;
  latestFCF?: number | null;
  latestEquityRatio?: number | null;
  latestROE?: number | null;
  latestROA?: number | null;
  revCagrPct?: number | null;
  trend?: Trend;
};
function buildFinanceSummary(csvFinanceData: any[] | string | undefined): FinanceSummary | null {
  const arr = coerceFinanceArray(csvFinanceData as any) ?? (Array.isArray(csvFinanceData) ? csvFinanceData : undefined);
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const normalized = arr
    .map((r) => {
      const year = getYear(r);
      const sales =
        pickField(r, ['sales','revenue','売上','売上高','売上(百万円)','売上高(百万円)']) ??
        (pickField(r, ['売上高(万円)','売上(万円)']) != null
          ? (pickField(r, ['売上高(万円)','売上(万円)']) as number) * 0.1
          : null);
      const cogs = pickField(r, ['cogs','売上原価']);
      let grossProfit = pickField(r, ['grossprofit','粗利','売上総利益']);
      if (grossProfit == null && sales != null && cogs != null) grossProfit = sales - cogs;

      const opProfit = pickField(r, ['operatingprofit','営業利益','営業利益(百万円)']);
      let opMargin = pickField(r, ['operatingmargin','営業利益率']);
      if (opMargin == null && opProfit != null && sales != null && sales !== 0) {
        opMargin = (opProfit / sales) * 100;
      }

      const ebitdaMargin =
        (opProfit != null && sales != null && sales !== 0)
          ? ((opProfit as number) / (sales as number)) * 100 // D&Aがなければ概算せず、未使用想定
          : null;

      const ocf = pickField(r, ['operatingcashflow','営業cf','営業キャッシュフロー']);
      const icf = pickField(r, ['investingcashflow','投資cf','投資キャッシュフロー']);
      const fcf = ocf != null && icf != null ? ocf + icf : pickField(r, ['freecashflow','フリーcf','フリーキャッシュフロー']);

      const equity = pickField(r, ['equity','自己資本']);
      const totalAssets = pickField(r, ['totalassets','総資産']);
      const equityRatio = equity != null && totalAssets != null && totalAssets !== 0 ? (equity / totalAssets) * 100 : null;
      const net = pickField(r, ['netincome','純利益','当期純利益']);
      const roe = net != null && equity != null && equity !== 0 ? (net / equity) * 100 : null;
      const roa = net != null && totalAssets != null && totalAssets !== 0 ? (net / totalAssets) * 100 : null;

      let grossMargin: number | null = null;
      if (grossProfit != null && sales != null && sales !== 0) grossMargin = (grossProfit / sales) * 100;

      return {
        year, sales, grossProfit, grossMargin, opProfit, opMargin,
        ebitdaMargin, ocf, icf, fcf, equityRatio, roe, roa, raw: r,
      };
    })
    .filter((x) => x.year != null || x.sales != null);

  if (normalized.length === 0) return null;

  normalized.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  const latest = normalized[0];

  const revPoints = normalized
    .filter((r) => r.year != null && r.sales != null)
    .slice()
    .sort((a, b) => a.year! - b.year!);

  let revCagrPct: number | null = null;
  if (revPoints.length >= 2) {
    const first = revPoints[0];
    const last = revPoints[revPoints.length - 1];
    const years = (last.year! - first.year!) || 1;
    if (first.sales! > 0 && years > 0) {
      const cagr = Math.pow((last.sales! as number) / (first.sales! as number), 1 / years) - 1;
      revCagrPct = cagr * 100;
    }
  }

  let trend: Trend = null;
  if (revPoints.length >= 2) {
    const diffs = revPoints.slice(1).map((p, i) => p.sales! - revPoints[i].sales!);
    const up = diffs.every((d) => d >= 0);
    const down = diffs.every((d) => d <= 0);
    trend = up ? 'up' : down ? 'down' : 'flat';
  }

  return {
    rowsUsed: arr.length,
    latestYear: latest.year ?? undefined,
    latestSales: latest.sales ?? undefined,
    latestOpProfit: latest.opProfit ?? null,
    latestOpMargin: latest.opMargin ?? null,
    latestGrossProfit: latest.grossProfit ?? null,
    latestGrossMargin: latest.grossMargin ?? null,
    latestEBITDAMargin: latest.ebitdaMargin ?? null,
    latestOCF: latest.ocf ?? null,
    latestICF: latest.icf ?? null,
    latestFCF: latest.fcf ?? null,
    latestEquityRatio: latest.equityRatio ?? null,
    latestROE: latest.roe ?? null,
    latestROA: latest.roa ?? null,
    revCagrPct, trend,
  };
}

/* =========================
 * Q&A（直近3件を引用）
 * =======================*/
type AnswerStep = { stepNumber: number; question: string; reason: string; answer: string };
type ChapterAnswers = { chapterIndex: number; chapterTitle: string; steps: AnswerStep[] };

function buildAnswersRich(a2: ChapterAnswers[] = [], take = 3) {
  const blocks: string[] = [];
  const by = [...a2].sort((a,b)=> (a.chapterIndex??0)-(b.chapterIndex??0)).slice(0,4);
  for (const chap of by) {
    const steps = (chap.steps ?? []).slice(-take);
    const quotes = steps
      .map(s => (s.answer || s.reason || '').trim())
      .filter(Boolean)
      .map(t => `「${sanitize(t, 60)}」`);
    if (quotes.length) blocks.push(`- ${chap.chapterTitle || `第${(chap.chapterIndex ?? 0)+1}章`} の現場の声: ${quotes.join(' / ')}`);
  }
  return blocks.join('\n');
}

/* =========================
 * OpenAI 呼び出し（JSON強制・フォールバック）
 * =======================*/
async function callOpenAIChat(args: {
  model: string;
  temperature: number;
  max_tokens: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  system: string;
  user: string;
}) {
  const { model, temperature, max_tokens, presence_penalty = 0.7, frequency_penalty = 0.3, system, user } = args;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 58_000);

  const base: any = {
    model,
    temperature,
    max_tokens,
    presence_penalty,
    frequency_penalty,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
  if (modelSupportsJsonMode(model)) {
    base.response_format = { type: 'json_object' };
  }

  try {
    const resp = await openai.chat.completions.create(base, { signal: controller.signal });
    clearTimeout(timer);
    return resp.choices?.[0]?.message?.content?.trim() ?? '';
  } catch (e: any) {
    clearTimeout(timer);
    const status = e?.status ?? e?.response?.status ?? (e?.name === 'AbortError' ? 504 : 500);
    if ((status === 429 || status >= 500) && args.model !== 'gpt-4o-mini') {
      return await callOpenAIChat({ ...args, model: 'gpt-4o-mini' });
    }
    throw { status, message: e?.message || 'OpenAI error', type: 'openai_error', raw: safeSerialize(e) };
  }
}

/* =========================
 * 軽い正規化＆ブリッジ補助
 * =======================*/
type SectionLike = { heading?: string; body?: string };

function coerceToSimpleHeads(sections: SectionLike[]): { heading: string; body: string }[] {
  // 順序は生成のままにしつつ、見出しだけ短い固定へ強制
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

function ensureBridges(sections: { heading: string; body: string }[]) {
  // 各章の末尾に、次章へ繋ぐ一行を“なめらかに”補助（既に書いてあれば何もしない）
  const bridges: Record<string, string> = {
    'なぜ今': '──では我々は、衰退を避けるために『どう戦う』べきなのか？',
　　'どう戦う': '──この戦略を進め、我々は『どんな未来』を実現するのか？',
    'どんな未来': '──この未来を実現するために、我々は『どう行動する』べきなのか？',
    
  };
  return sections.map((s, i) => {
    const b = bridges[s.heading];
    if (!b || i === sections.length - 1) return s;
    const txt = normalizeNewlines(s.body || '');
    // 既に「──」で終わる/次章名を含むブリッジがあれば追記しない
    if (/──/.test(txt) || /どう戦う|どんな未来|どう行動する/.test(txt.slice(-50))) return s;
    return { ...s, body: (txt.trim() + '\n' + b).trim() };
  });
}

/* =========================
 * ルート
 * =======================*/
export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY is missing' }, { status: 500 });
    }

    const model = pickSafeModel();
    const body = await req.json();

    const {
      userId,
      thought, mission, vision, value,
      industry, revenue, employees,
      strength, weakness, opportunity, threat,
      csvFinanceData,
      answers2,
      temperature = 0.95,
      budgets, // { longform: [min, max] } など
    } = body || {};

    const fin = buildFinanceSummary(csvFinanceData);
    const industryJp = safeGetIndustryLabel(industry || '', { full: true });

    const finMini = fin ? {
      year: fin.latestYear,
      sales: fin.latestSales,
      gm: fin.latestGrossMargin,
      opm: fin.latestOpMargin,
      ebitda_m: fin.latestEBITDAMargin,
      ocf: fin.latestOCF,
      icf: fin.latestICF,
      fcf: fin.latestFCF,
      eqr: fin.latestEquityRatio,
      roe: fin.latestROE,
      roa: fin.latestROA,
      rev_cagr: fin.revCagrPct,
      trend: fin.trend,
    } : null;

    const LF_MIN = budgets?.longform?.[0] ?? 1600;
    const LF_MAX = budgets?.longform?.[1] ?? 2400;

   /* ---------- System（cinematic＋ブリッジ＋MLK要素統合） ---------- */
const systemPrompt = `
あなたは経営者であり、すべての社員とともに成長を実現に導くリーダーです。会社の存続と繁栄を賭けた、最も重要な戦略を社員全員に伝えるため、以下の構成で「腹の底からの本音のメッセージ」を起草してください。

【構成指示（執筆時の思考の軸）】
1. 【衝撃と共感から始める】
- 現在の我々の事業に対する「率直な危機感」を、具体的な数字や競合の動き（例：あの新興企業X社のシェア急伸、顧客の購買行動の根本的な変化）を挙げて説明せよ。美辞麗句は一切排除する。
- 「我々の現状は、もはや『成功』ではなく『衰退への危機』だ」といった、認識を揺さぶる強い表現を用いよ。

2. 【選択と集中の覚悟】
- これから「やめること」「捨てる事業」を明確に示せ。その決定が痛みを伴うものであればあるほど、なぜそれが必要なのかを情熱を込めて説明せよ。
- 例：「採算の取れないA事業からは撤退します。その領域ではもう勝てない。だからこそ、全資源をB領域に注ぎ込むのです。」

3. 【描く勝利のイメージ（具体的過ぎるほどに）】
- 3年後、我々は具体的に何を達成しているのか？「売上○○億」ではなく、その先の「顧客の風景」を描写せよ。
- 例：「3年後、我々のソリューションは小売業のスタンダードとなり、街中のあちこちで我々が関わった価値提供の現場が見られるようになっているだろう。」

4. 【各個人への熱いバトン】
- この戦略は「経営陣がやるもの」ではなく「一人ひとりが主役になるもの」だと言い切れ。
- 各社員に問いかける形で、期待する行動を以下の観点で示せ：
  - 「変えろ」：経営戦略を軸に、自分の仕事のやり方、既存の常識を。
  - 「挑戦しろ」：権限は委譲する。自分で決めていいから、今すぐ始めろ。失敗はこの際、許容する。
  - 「成長しろ」：必要なスキルは会社が投資する。しかし、自ら学ぶ者だけが次の機会を掴める。

5. 【結束への呼びかけ】
- 最後に、創業時の想いや、会社への深い愛情をにじませ、「この難局を、我々の手で次の伝説に変えよう」という熱意で締めくくれ。

【文体とトーンの指示】
- 形式張った「社長メッセージ」であってはならない。熱量のある、人間同士の「語り」にせよ。
- 誇張ではなく、本気の「覚悟」と「期待」を感じさせる言葉を選べ。
- 長さは自由。ただし、核心を外さないこと。

【統合と出力ルール（厳守）】
- 上記5要素を、以下の4章見出しに自然に統合して書くこと。5の「結束への呼びかけ」は第4章の締めに織り込むこと。
- 見出しは次の4つの語句・順序で固定：なぜ今 / どう戦う / どんな未来 / どう行動する
- 各見出しの直後で改行し、2〜4段落で綴る。
- 数値は入力 fin_json に存在するもののみ使用可。無い場合は「目安」「短縮」「上向き」などの定性表現に置換すること（捏造禁止）。
- 出力はJSONのみ。以下のスキーマに完全準拠すること：
{
  "sections":[
    {"heading":"なぜ今","body":"..."},
    {"heading":"どう戦う","body":"..."},
    {"heading":"どんな未来","body":"..."},
    {"heading":"どう行動する","body":"..."}
  ]
}
`.trim();



    /* ---------- User（素材は薄く、現場の声は太く） ---------- */
    const answersRich = buildAnswersRich(Array.isArray(answers2) ? answers2 : [], 3);

    const userPrompt = `
【会社】業種=${industryJp || industry || '—'}／売上=${revenue ? `${revenue}百万円` : '—'}／人数=${employees ? `${employees}人` : '—'}
【MVV】M=${sanitize(mission, 300) || '—'}／V=${sanitize(vision, 300) || '—'}／Val=${sanitize(value, 300) || '—'}
【SWOT】S=${sanitize(strength, 400) || '—'}／W=${sanitize(weakness, 400) || '—'}／O=${sanitize(opportunity, 400) || '—'}／T=${sanitize(threat, 400) || '—'}
【経営者の思い(Will/断片)】${sanitize(thought, 600) || '—'}

【fin_json】
${JSON.stringify(finMini)}

【現場の声（直近から抽出/引用候補）】
${answersRich || '—'}

【出力仕様】上記の制約・形式を厳守。`.trim();

    /* ---------- OpenAI 呼び出し ---------- */
    let raw = '';
    try {
      raw = await callOpenAIChat({
        model,
        temperature: typeof temperature === 'number' ? temperature : 0.95,
        max_tokens: 2300,
        presence_penalty: 0.7,
        frequency_penalty: 0.3,
        system: systemPrompt,
        user: userPrompt,
      });
    } catch (detail: any) {
      console.error('❌ OpenAI error detail:', detail);
      const status = detail?.status ?? 500;
      return NextResponse.json(
        { error: 'OpenAI error', detail: { status, message: detail?.message, type: detail?.type }, _debug: { model } },
        { status }
      );
    }

    /* ---------- パース/整形（見出しは短い語に統一、章末に滑らかなブリッジ） ---------- */
    type GenOut = { sections?: Array<{ heading?: string; body?: string }> };
    const parsed = extractJsonLoose(raw) as GenOut | null;

    let sections: { heading: string; body: string }[] = [];
    if (Array.isArray(parsed?.sections) && parsed!.sections!.length >= 4) {
      sections = coerceToSimpleHeads(parsed!.sections!);
    } else {
      // 乱れた場合でも短い見出しに固定
      sections = coerceToSimpleHeads(parsed?.sections || []);
    }

    sections = ensureBridges(sections);

    // 読み物（見出し＋本文）
    const longform = sections
      .map(s => `【${s.heading}】\n${sanitize(normalizeNewlines(s.body), 4000)}`)
      .join('\n\n');

    // UI用：固定見出しに変換（短いタイトル）
    const bodies = sections.map(s => s.body);
    const finalStory = TITLE_TEMPLATES.map((title, i) => ({ title, body: bodies[i] || '（この章は未生成です）' }));

    // 任意保存
    if (body?.userId && typeof saveFinalStory === 'function') {
      try { await saveFinalStory(body.userId, finalStory as any, ''); }
      catch (e) { console.warn('⚠️ final_stories 保存に失敗（続行）:', (e as any)?.message || e); }
    }

    return NextResponse.json(
      { finalStory, longform, sections, _debug: { model } },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    console.error('❌ 最終ストーリー生成エラー:', error?.message || error);
    const status = error?.name === 'AbortError' ? 504 : 500;
    return NextResponse.json({ error: '最終ストーリーの生成に失敗しました', detail: String(error) }, { status });
  }
}
