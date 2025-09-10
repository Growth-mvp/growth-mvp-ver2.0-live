// /app/api/generate-story-draft/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

/**
 * 出力は常に { story: {title, body}[] }（最低4章に満たす）＋ summary(任意)
 * 章タイトルは固定テンプレで上書きして順序を安定化。
 */

// ---- OpenAI ----
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// ---- モデルの安全選択（環境変数が変でも既定に落とす）----
const ALLOW_MODELS = new Set<string>([
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4o-mini-2024-07-18',
  'gpt-4o-2024-08-06',
]);
function pickSafeModel() {
  const envModel = process.env.OPENAI_MODEL || process.env.NEXT_PUBLIC_OPENAI_MODEL || '';
  return ALLOW_MODELS.has(envModel) ? envModel : 'gpt-4o-mini';
}

// ✅ 新構成：見出しと順序をGROWTH最新版に変更
const TITLE_TEMPLATES = [
  '第1章：なぜ今（現状）',
  '第2章：どう戦う（戦略）',
  '第3章：どんな未来像（会社の未来像）',
  '第4章：どう行動する（行動）',
] as const;

// ✅ 各章のゴールも新構成に合わせて再定義（社員が主役／問いと原則を重視）
const CHAPTER_GOALS = [
  '現状：外因と内因を率直に示し、「このままではまずい」を共有する（責任転嫁はしない）。',
  '戦略：選ぶ/選ばないを明言し、Will（私の決意）とトレードオフ（やめること）を1点以上示す。原則（例：標準優先/学びを翌週反映）も明確に。',
  '未来像：顧客の風景で描く（SHOW, DON’T TELL）。売上などの数値は入力にある場合のみ用い、無ければ定性表現で希望を描く。',
  '行動：社員が主役で「自分で決める」を明言。判断の三つの問いと《目的／仮説／最初の一歩／やめること／合図》の雛形のみ提示（具体タスクや会議指示は禁止）。',
] as const;

/** 未入力は空文字に。JSON.stringifyは使わない */
function sanitize(text: any, max = 2400): string {
  const s =
    text === null || text === undefined
      ? ''
      : typeof text === 'string'
      ? text
      : String(text);
  return s.replace(/\u0000/g, '').replace(/\s+$/g, '').slice(0, max);
}

/** ざっくりJSON抽出: json_object / ```json / 最初の {...} / 配列トップレベルにも対応 */
function extractJsonLoose(raw: string): any | null {
  if (!raw) return null;
  const tryParse = (s: string) => {
    try { return JSON.parse(s); } catch { return null; }
  };
  // 1) そのまま（オブジェクト/配列 両方許容）
  const direct = tryParse(raw);
  if (direct && (typeof direct === 'object' || Array.isArray(direct))) return direct;
  // 2) ```json ... ```
  const fence = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const j = tryParse(fence[1]);
    if (j && (typeof j === 'object' || Array.isArray(j))) return j;
  }
  // 3) 最初の {...}
  const obj = raw.match(/\{[\s\S]*\}/);
  if (obj?.[0]) {
    const j = tryParse(obj[0]);
    if (j && typeof j === 'object') return j;
  }
  // 4) 最初の [...]（トップレベル配列）
  const arr = raw.match(/\[[\s\S]*\]/);
  if (arr?.[0]) {
    const j = tryParse(arr[0]);
    if (Array.isArray(j)) return j;
  }
  return null;
}

/** 任意のJSONから章配列を抽出・正規化 */
function coerceChapters(parsed: any): Array<{ title?: string; body?: string }> {
  if (!parsed) return [];
  // 候補パスを総当りで探す
  const candidates: any[] = [];
  const pushIfArray = (v: any) => { if (Array.isArray(v)) candidates.push(v); };

  if (Array.isArray(parsed)) candidates.push(parsed);
  if (parsed && typeof parsed === 'object') {
    pushIfArray(parsed.chapters);
    pushIfArray(parsed.story);
    pushIfArray(parsed.stories);
    pushIfArray(parsed.sections);
    pushIfArray(parsed.data?.chapters);
    pushIfArray(parsed.data?.story);
    pushIfArray(parsed.result?.chapters);
  }

  const arr = candidates.find(a => Array.isArray(a)) || [];
  if (!arr.length) return [];

  // 章オブジェクト化：本文フィールドの別名にも対応
  const getTitle = (o: any, i: number) =>
    sanitize(o?.title ?? o?.heading ?? o?.name ?? o?.label ?? `Chapter ${i + 1}`, 120);

  const getBody = (o: any) => {
    const raw =
      o?.body ??
      o?.content ??
      o?.text ??
      o?.summary ??
      o?.description ??
      (typeof o === 'string' ? o : '');
    return sanitize(raw, 2400);
  };

  return arr.map((item: any, i: number) => ({
    title: getTitle(item, i),
    body: getBody(item),
  }));
}

/** story を短い要約列にしてプロンプトへ（※ Q&Aは使わない） */
function buildStoryDigest(body: any): string {
  const storyArr: Array<{ title?: string; body?: string }> =
    Array.isArray(body?.story) ? body.story : Array.isArray(body?.context?.story) ? body.context.story : [];

  if (!storyArr?.length) return '';
  return storyArr
    .slice(0, 4)
    .map((c: any, i: number) => {
      const t = sanitize(c?.title ?? `Chapter ${i + 1}`, 80);
      const b = sanitize(c?.body ?? '', 280);
      return `- ${t}: ${b}`;
    })
    .join('\n');
}

export async function POST(req: NextRequest) {
  try {
    // ---- デバッグ入口 ----
    const url = (req as any).nextUrl ?? new URL(req.url);
    const debug = url.searchParams.get('debug') || '';
    const model = pickSafeModel();

    if (debug === 'stub') {
      const story = TITLE_TEMPLATES.map((t, i) => ({ title: t, body: `stub body ${i + 1}` }));
      return NextResponse.json(
        { ok: true, phase: 'stub', story, _debug: { model } },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }
    if (debug === 'ping') {
      if (!process.env.OPENAI_API_KEY) {
        return NextResponse.json({ ok: false, model, error: 'NO_API_KEY' }, { status: 500 });
      }
      try {
        const c = await openai.chat.completions.create({
          model,
          messages: [{ role: 'user', content: 'pong' }],
          max_tokens: 5,
        });
        return NextResponse.json(
          { ok: true, model, usage: c.usage, content: c.choices?.[0]?.message?.content || '' },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      } catch (e: any) {
        return NextResponse.json({ ok: false, model, error: e?.message || String(e) }, { status: 500 });
      }
    }
    if (debug === 'json') {
      if (!process.env.OPENAI_API_KEY) {
        return NextResponse.json({ ok: false, model, error: 'NO_API_KEY' }, { status: 500 });
      }
      try {
        const c = await openai.chat.completions.create({
          model,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: '日本語で、必ず json のオブジェクト {"chapters":[{"title":"t","body":"b"}]} だけを返す。説明文やコードブロックは禁止。',
            },
            { role: 'user', content: 'テストなので1章で良い。' },
          ],
          max_tokens: 300,
        });
        return NextResponse.json(
          { ok: true, model, raw: c.choices?.[0]?.message?.content?.slice(0, 400) || '' },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      } catch (e: any) {
        return NextResponse.json({ ok: false, model, error: e?.message || String(e) }, { status: 500 });
      }
    }

    // ---- 通常処理 ----
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY is missing' }, { status: 500 });
    }

    const body = await req.json();

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
      temperature,
    } = body || {};

    // 既存の story（ドラフト/前回出力など）だけを参照に使う（Q&Aは使わない）
    const storyNote = buildStoryDigest(body);

    const financialSummary =
      Array.isArray(csvFinanceData) && csvFinanceData.length > 0
        ? `\n\n【参考財務データ（抜粋）】\n${csvFinanceData
            .slice(0, 12)
            .map((row: any) => sanitize(Object.values(row).join(' / '), 200))
            .join('\n')}${csvFinanceData.length > 12 ? '\n…' : ''}`
        : '';

    // ✅ systemPrompt：新構成／数値捏造禁止／社員主役を明記
    const systemPrompt = [
      'あなたは経営者に伴走するストーリーファシリテーターです。',
      '日本語で、必ず 4 章構成のドラフトを生成します。',
      '抽象論を避け、不可逆性・比較・トレードオフ・原則・「小さな勝ち体験」を適切に織り込みます。',
      '章タイトルはサーバ側で最終整形するため、内容の充実を優先し、JSON で返答してください。',
      '必ず json のオブジェクトだけを返してください（説明文やコードブロックは禁止）。',
      '',
      '【禁止/制限】',
      '- 深掘りQ&A（ユーザーの問い/答え）は参考ストーリーのインプットに使用してはいけません。入力に含まれていても無視してください。',
      '- 具体タスクの指示や会議体の新設を細かく書かない（行動章は「問いと雛形」に留める）。',
      '- 数値（売上/％など）は csvFinanceData に存在するもののみ使用可。無ければ定性表現（目安/短縮/上向き等）に置換する。',
      '',
      '【各章のゴール】',
      `1) ${CHAPTER_GOALS[0]}`,
      `2) ${CHAPTER_GOALS[1]}`,
      `3) ${CHAPTER_GOALS[2]}`,
      `4) ${CHAPTER_GOALS[3]}`,
      '',
      '【出力フォーマット（厳守）】',
      '出力は JSON のみ（コードフェンスや説明文を付けない）。',
      '形式: { "chapters": [{"title":"...","body":"..."} ×4], "summary": {"tagline":"...", "bullets":["..."]} }',
      '各章は 250〜400 字程度で簡潔に。',
    ].join('\n');

    const userPrompt = [
      '【経営者の思い】',
      sanitize(thought, 1000) || '（未入力）',
      '',
      '【会社概要】',
      `- 業種: ${sanitize(industry, 120)}`,
      `- 売上高: ${sanitize(revenue, 120)} 百万円`,
      `- 従業員数: ${sanitize(employees, 120)} 人`,
      '',
      '【MVV】',
      `- Mission: ${sanitize(mission, 300)}`,
      `- Vision: ${sanitize(vision, 300)}`,
      `- Value: ${sanitize(value, 300)}`,
      '',
      '【SWOT】',
      `- 強み: ${sanitize(strength, 400)}`,
      `- 弱み: ${sanitize(weakness, 400)}`,
      `- 機会: ${sanitize(opportunity, 400)}`,
      `- 脅威: ${sanitize(threat, 400)}`,
      '',
      storyNote ? `【既存の章メモ（参考）】\n${storyNote}` : '',
      financialSummary,
      '',
      '【執筆要件】',
      '- 章の見出し文言は最終的にサーバ側で上書きされるため、内容の質を最優先すること。',
      '- それぞれの章が上記のゴールを満たすように書くこと。',
      '- 深掘りQ&Aの内容は参照しないこと。',
    ]
      .filter(Boolean)
      .join('\n');

    const temp = typeof temperature === 'number' ? temperature : 0.4;

    // ---- タイムアウト（ハング対策） ----
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    let raw = '';
    try {
      // 1回目: JSON強制
      const c1 = await openai.chat.completions.create(
        {
          model,
          temperature: temp,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 1600,
        },
        { signal: controller.signal }
      );
      raw = c1.choices?.[0]?.message?.content?.trim() || '';
    } catch (e: any) {
      // 2回目: JSON強制を外してフォールバック
      try {
        const c2 = await openai.chat.completions.create(
          {
            model,
            temperature: temp,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_tokens: 1600,
          },
          { signal: controller.signal }
        );
        raw = c2.choices?.[0]?.message?.content?.trim() || '';
      } catch (e2: any) {
        clearTimeout(timer);
        console.error('❌ ストーリー生成API失敗:', e2?.message || e2);
        return NextResponse.json({ error: e2?.message || 'OpenAI error' }, { status: 500 });
      }
    } finally {
      clearTimeout(timer);
    }

    // --- ゆるい抽出 → 多形対応で章配列を取り出す ---
    const parsedLoose = extractJsonLoose(raw);
    const coerced = coerceChapters(parsedLoose);

    // フォールバック（章が取れない時）
    if (!coerced.length) {
      const chapters = TITLE_TEMPLATES.map((title) => ({
        title,
        body: '（この章は未生成です）',
      }));
      return NextResponse.json(
        { story: chapters, _debug: { model, fallback: true } },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // サーバ側で章タイトル/順序を固定（本文はcoercedの中身を使用）
    const chapters = TITLE_TEMPLATES.map((title, i) => ({
      title,
      body: sanitize(coerced[i]?.body || '（この章は未生成です）', 2400),
    }));

    // summary は色々な形を許容
    let summary: any = undefined;
    const srcSummary =
      parsedLoose?.summary ??
      parsedLoose?.data?.summary ??
      parsedLoose?.result?.summary ??
      null;

    if (srcSummary) {
      if (typeof srcSummary === 'string') {
        summary = sanitize(srcSummary, 300);
      } else {
        summary = {
          tagline: sanitize(srcSummary.tagline || srcSummary.title || '', 200),
          bullets: Array.isArray(srcSummary.bullets)
            ? srcSummary.bullets.slice(0, 6).map((b: any) => sanitize(String(b || ''), 200))
            : [],
        };
      }
    }

    return NextResponse.json(
      { story: chapters, summary, _debug: { model } },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    console.error('❌ ストーリー生成エラー:', error?.message || error);
    const status = error?.name === 'AbortError' ? 504 : 500;
    return NextResponse.json({ error: error?.message || 'Server error' }, { status });
  }
}
