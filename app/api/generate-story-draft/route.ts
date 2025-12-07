// /app/api/generate-story-draft/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// ★ 追加：勝ちパターン辞書
import { topPatterns } from '@/lib/strategyPatterns.top';
import { mapTopToWin } from '@/lib/strategyPatterns.map';
import { buildWinPatternsFromIds } from '@/lib/winPatterns';
import type { WinPattern } from '@/types/strategy';

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
  const envModel =
    process.env.OPENAI_MODEL || process.env.NEXT_PUBLIC_OPENAI_MODEL || '';
  return ALLOW_MODELS.has(envModel) ? envModel : 'gpt-4o-mini';
}

// ✅ 見出しテンプレ（固定）
const TITLE_TEMPLATES = [
  '第1章：なぜ今（現状）',
  '第2章：どう戦う（戦略）',
  '第3章：どんな未来像（会社の未来像）',
  '第4章：どう行動する（行動）',
] as const;

// ✅ 各章のゴール（legacy / future で切替）
const CHAPTER_GOALS_LEGACY = [
  '現状：外因と内因を率直に示し、「このままではまずい」を共有する（責任転嫁はしない）。',
  '戦略：選ぶ/選ばないを明言し、Will（私の決意）とトレードオフ（やめること）を1点以上示す。原則（例：標準優先/学びを翌週反映）も明確に。',
  '未来像：顧客の風景で描く（SHOW, DON’T TELL）。売上などの数値は入力にある場合のみ用い、無ければ定性表現で希望を描く。',
  '行動：社員が主役で「自分で決める」を明言。判断の三つの問いと《目的／仮説／最初の一歩／やめること／合図》の雛形のみ提示（具体タスクや会議指示は禁止）。',
] as const;

const CHAPTER_GOALS_FUTURE = [
  // 未来逆算でも章タイトルは固定のまま。本文で「未来から見た現状」「逆算課題」に寄せる。
  '未来から見た現状：3〜5年後の理想像を先に置き、そこから見える現在の制約・惰性・壁を率直に描く（過去/既存は“素材”として評価）。',
  '戦略（両利き）：内部変革×外部変革を統合。既存資産の再定義（Exploitation）と新価値創造（Exploration）を同時に設計。選ばないこと/やめることも明言。',
  '未来像：顧客・社員・社会の“情景”で示す（SHOW, DON’T TELL）。KPIが無ければKCI（創造の兆し）中心の定性で可視化。',
  '逆算アクション：短期KPI（守り）とKCI（Key Creation Indicator：創造の兆し）を併記。《目的／仮説／最初の一歩／やめること／合図》を雛形として提示（具体タスク過多は避ける）。',
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
  const candidates: any[] = [];
  const pushIfArray = (v: any) => {
    if (Array.isArray(v)) candidates.push(v);
  };

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

  const arr = candidates.find((a) => Array.isArray(a)) || [];
  if (!arr.length) return [];

  const getTitle = (o: any, i: number) =>
    sanitize(
      o?.title ??
        o?.heading ??
        o?.name ??
        o?.label ??
        `Chapter ${i + 1}`,
      120,
    );

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
  const storyArr: Array<{ title?: string; body?: string }> = Array.isArray(
    body?.story,
  )
    ? body.story
    : Array.isArray(body?.context?.story)
    ? body.context.story
    : [];

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

// ★ 追加：勝ちパターン辞書（t系）の要旨を生成
function buildTopPatternDigest(ids?: string[]) {
  const set = new Set((ids ?? []).map((s) => String(s).toLowerCase().trim()));
  const list = topPatterns
    .filter(
      (p) =>
        set.size === 0 || set.has(String(p.id).toLowerCase()),
    )
    .map(
      (p) =>
        `#${p.id} ${p.title}：${sanitize(p.summary ?? '', 280)}`,
    );
  return list.length
    ? `【参考：勝ちパターン10選】\n${list.join('\n')}`
    : '';
}

/* ============================================================
 * ★ 追加ヘルパー：事業ポートフォリオ＆財務サマリー要約
 * ==========================================================*/

/**
 * businessPortfolio から
 * 「事業名／売上構成比／成長率／利益率／ポジション」を抜き出して要約。
 * 型は厳密に想定せず、よくありそうなプロパティ名をゆるく拾う。
 */
function buildBusinessPortfolioDigest(portfolio: any): string {
  if (!Array.isArray(portfolio) || portfolio.length === 0) return '';

  const lines = portfolio.slice(0, 8).map((p: any) => {
    const name = sanitize(
      p?.name ??
        p?.businessName ??
        p?.segmentName ??
        p?.title ??
        '（名称未設定の事業）',
      80,
    );

    const share =
      p?.revenueShare ??
      p?.salesShare ??
      p?.share ??
      p?.ratio ??
      null;
    const growth =
      p?.growthRate ??
      p?.salesGrowth ??
      p?.growth ??
      null;
    const margin =
      p?.profitMargin ??
      p?.margin ??
      p?.opMargin ??
      null;
    const role =
      p?.positionLabel ??
      p?.position ??
      p?.category ??
      p?.role ??
      '';

    const metrics: string[] = [];
    if (share !== null && share !== undefined)
      metrics.push(`売上構成比 ${share}%`);
    if (growth !== null && growth !== undefined)
      metrics.push(`成長率 ${growth}%`);
    if (margin !== null && margin !== undefined)
      metrics.push(`利益率 ${margin}%`);

    const parts: string[] = [name];
    if (metrics.length) parts.push(metrics.join(' / '));
    if (role) parts.push(`ポジション: ${role}`);

    return '・' + parts.join(' ｜ ');
  });

  if (!lines.length) return '';
  return `【事業ポートフォリオ（主要事業の位置づけ）】\n${lines.join('\n')}`;
}

/**
 * financeSummary から「全社の規模感」と「直近数年のざっくりトレンド」を要約。
 * latestYear / latestYearTotal / byYear / trend など、ありそうなプロパティを緩く利用。
 */
function buildFinanceSummaryDigest(financeSummary: any): string {
  if (!financeSummary) return '';

  try {
    const lines: string[] = [];

    // 最新年度
    const latestYear =
      financeSummary.latestYear ??
      financeSummary.year ??
      (Array.isArray(financeSummary.years) &&
        financeSummary.years.length > 0
        ? financeSummary.years[financeSummary.years.length - 1]?.year
        : undefined);

    if (latestYear !== undefined) {
      let latestTotal =
        financeSummary.latestYearTotal ??
        financeSummary.totals?.[String(latestYear)] ??
        undefined;

      if (!latestTotal && Array.isArray(financeSummary.byYear)) {
        const found = financeSummary.byYear.find(
          (y: any) => String(y.year) === String(latestYear),
        );
        latestTotal = found?.total ?? found;
      }

      if (latestTotal) {
        const rev =
          latestTotal.revenue ??
          latestTotal.sales ??
          latestTotal.netSales ??
          latestTotal.net_revenue;
        const op =
          latestTotal.operatingIncome ??
          latestTotal.opIncome ??
          latestTotal.operatingProfit;
        const margin =
          latestTotal.opMargin ??
          latestTotal.margin ??
          latestTotal.operatingMargin;

        const metrics: string[] = [];
        if (rev !== undefined && rev !== null)
          metrics.push(`売上高: 約${rev}百万円`);
        if (op !== undefined && op !== null)
          metrics.push(`営業利益: 約${op}百万円`);
        if (margin !== undefined && margin !== null)
          metrics.push(`営業利益率: 約${margin}%`);

        if (metrics.length) {
          lines.push(
            '・最新年度（' +
              latestYear +
              '年）: ' +
              metrics.join(' / '),
          );
        }
      }
    }

    // 3年分くらいのトレンド
    const trendSource = Array.isArray(financeSummary.byYear)
      ? financeSummary.byYear
      : Array.isArray(financeSummary.trend)
      ? financeSummary.trend
      : null;

    if (trendSource && trendSource.length > 0) {
      const sliced = trendSource.slice(-3); // 直近3年程度
      sliced.forEach((y: any) => {
        const year = y.year ?? y.fiscalYear ?? '';
        const rev =
          y.revenue ?? y.sales ?? y.netSales ?? undefined;
        const op =
          y.operatingIncome ??
          y.opIncome ??
          y.operatingProfit ??
          undefined;
        const margin =
          y.opMargin ??
          y.margin ??
          y.operatingMargin ??
          undefined;

        const metrics: string[] = [];
        if (rev !== undefined && rev !== null)
          metrics.push(`売上 ${rev}`);
        if (op !== undefined && op !== null)
          metrics.push(`営利 ${op}`);
        if (margin !== undefined && margin !== null)
          metrics.push(`利益率 ${margin}%`);

        if (year && metrics.length) {
          lines.push(
            '・' + year + '年: ' + metrics.join(' / '),
          );
        }
      });
    }

    // 何も拾えなければ、ざっくりテキスト化
    if (!lines.length) {
      if (Array.isArray(financeSummary)) {
        financeSummary.slice(-3).forEach((row: any) => {
          lines.push(
            '・' +
              sanitize(
                Object.values(row).join(' / '),
                200,
              ),
          );
        });
      } else if (typeof financeSummary === 'object') {
        lines.push(
          '・' +
            sanitize(
              JSON.stringify(financeSummary),
              400,
            ),
        );
      }
    }

    if (!lines.length) return '';
    return `【財務サマリー（全社の規模感）】\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

type Mode = 'future' | 'legacy';

export async function POST(req: NextRequest) {
  try {
    // ---- デバッグ入口 ----
    const url = (req as any).nextUrl ?? new URL(req.url);
    const debug = url.searchParams.get('debug') || '';
    const model = pickSafeModel();

    if (debug === 'stub') {
      const story = TITLE_TEMPLATES.map((t, i) => ({
        title: t,
        body: `stub body ${i + 1}`,
      }));
      return NextResponse.json(
        { ok: true, phase: 'stub', story, _debug: { model } },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (debug === 'ping') {
      if (!process.env.OPENAI_API_KEY) {
        return NextResponse.json(
          { ok: false, model, error: 'NO_API_KEY' },
          { status: 500 },
        );
      }
      try {
        const c = await openai.chat.completions.create({
          model,
          messages: [{ role: 'user', content: 'pong' }],
          max_tokens: 5,
        });
        return NextResponse.json(
          {
            ok: true,
            model,
            usage: c.usage,
            content:
              c.choices?.[0]?.message?.content || '',
          },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      } catch (e: any) {
        return NextResponse.json(
          { ok: false, model, error: e?.message || String(e) },
          { status: 500 },
        );
      }
    }
    if (debug === 'json') {
      if (!process.env.OPENAI_API_KEY) {
        return NextResponse.json(
          { ok: false, model, error: 'NO_API_KEY' },
          { status: 500 },
        );
      }
      try {
        const c = await openai.chat.completions.create({
          model,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                '日本語で、必ず json のオブジェクト {"chapters":[{"title":"t","body":"b"}]} だけを返す。説明文やコードブロックは禁止。',
            },
            { role: 'user', content: 'テストなので1章で良い。' },
          ],
          max_tokens: 300,
        });
        return NextResponse.json(
          {
            ok: true,
            model,
            raw:
              c.choices?.[0]?.message?.content?.slice(
                0,
                400,
              ) || '',
          },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      } catch (e: any) {
        return NextResponse.json(
          { ok: false, model, error: e?.message || String(e) },
          { status: 500 },
        );
      }
    }

    // ---- 通常処理 ----
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY is missing' },
        { status: 500 },
      );
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
      financeSummary,      // ★ 追加：全社財務サマリー（任意）
      businessPortfolio,   // ★ 追加：事業ポートフォリオ配列（任意）
      temperature,
      patternIds,          // ★ t1,t2,... （TopPatternId[] 想定）
      mode: _mode,         // 'future' | 'legacy'（未指定は future）
      enhanceEmotion,      // ★ 追加：true/false（未指定はtrue）
    } = body || {};

    const mode: Mode = _mode === 'legacy' ? 'legacy' : 'future';

    // 既存の story（ドラフト/前回出力など）だけを参照に使う（Q&Aは使わない）
    const storyNote = buildStoryDigest(body);

    const financialSummary =
      Array.isArray(csvFinanceData) && csvFinanceData.length > 0
        ? `\n\n【参考財務データ（抜粋・元CSVより）】\n${csvFinanceData
            .slice(0, 12)
            .map((row: any) =>
              sanitize(
                Object.values(row).join(' / '),
                200,
              ),
            )
            .join('\n')}${
            csvFinanceData.length > 12 ? '\n…' : ''
          }`
        : '';

    // ★ 新規：財務サマリー＆事業ポートフォリオの要約テキスト
    const financeSummaryDigest = buildFinanceSummaryDigest(
      financeSummary,
    );
    const portfolioDigest = buildBusinessPortfolioDigest(
      businessPortfolio,
    );

    // ★ 追加：勝ちパターン要旨
    const patternDigest = buildTopPatternDigest(
      Array.isArray(patternIds) ? patternIds : undefined,
    );

    // ✅ systemPrompt（モードで切替 ＋ 魂の三要素を強制）
    const goals =
      mode === 'future'
        ? CHAPTER_GOALS_FUTURE
        : CHAPTER_GOALS_LEGACY;

    const systemPrompt = [
      mode === 'future'
        ? 'あなたは「未来逆算×両利きの経営」アーキテクトであり、同時に“社員の心を動かす経営者”です。'
        : 'あなたは「経営ストーリーの執筆者」であり、“社員の心を動かす経営者”です。',
      '論理の正確さだけでなく、情熱・覚悟・誇りを伴う語り口で書きます（コンサル調ではなく、経営者本人の声）。',
      '日本語で、必ず 4 章構成のドラフトを生成します。',
      '抽象論を避け、不可逆性・比較・トレードオフ・原則・「小さな勝ち体験」を適切に織り込みます。',
      '章タイトルはサーバ側で最終整形するため、内容の充実を優先し、JSON で返答してください。',
      '必ず json のオブジェクトだけを返してください（説明文やコードブロックは禁止）。',
      '',
      '【禁止/制限】',
      '- 深掘りQ&A（ユーザーの問い/答え）は参考ストーリーのインプットに使用しない。',
      '- 具体タスクの指示や会議体の新設を細かく書かない（行動章は「問いと雛形」に留める）。',
      '- 数値（売上/％など）は csvFinanceData / financeSummary / businessPortfolio に存在するもののみ使用可。無ければ定性表現に置換する。',
      '',
      '【各章のゴール】',
      `1) ${goals[0]}`,
      `2) ${goals[1]}`,
      `3) ${goals[2]}`,
      `4) ${goals[3]}`,
      '',
      '【魂の三要素（必須）】',
      '- 第2章には「誇り」に相当する1文を自然に挿入（私たちが大切に守り抜いてきた本質・流儀）。',
      '- 第3章には「賭け」に相当する1文を自然に挿入（未来へ踏み出す決断・リスクを受け止める覚悟）。',
      '- 第4章には「信念」に相当する1文を自然に挿入（仲間とやり抜く約束・何があってもブレない原則）。',
      '',
      '【ポートフォリオ／財務を踏まえた書き方】',
      '- 事業ポートフォリオから、「どの事業に賭け、どの事業を守り、どこを絞るのか」を第2章・第3章に自然に織り込む。',
      '- 財務サマリーからは、「会社全体の規模感」「成長か停滞か」といった大きな方向性のみを読み取り、詳細な損益計画には踏み込まない。',
      '',
      '【出力フォーマット（厳守）】',
      '出力は JSON のみ（コードフェンスや説明文を付けない）。',
      '形式: { "chapters": [{"title":"...","body":"..."} ×4], "summary": {"tagline":"...", "bullets":["..."]} }',
      '各章は 250〜400 字程度で簡潔に。',
      '',
      // ★ 参照知識
      patternDigest,
      // ★ future モードのときは追加の強調
      mode === 'future'
        ? [
            '',
            '【未来逆算×両利き（追加要件）】',
            '- 未来（Exploration）を起点に、過去/既存資産（Exploitation）を“未来の素材”として再定義する。',
            '- 内部変革（部門越境・役割破壊）と外部変革（顧客価値・市場・事業モデルの再定義）を両立する。',
            '- KPI（短期）とKCI（Key Creation Indicator：創造の兆し）を併記する。',
          ].join('\n')
        : '',
    ]
      .filter(Boolean)
      .join('\n');

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
      `- Vision : ${sanitize(vision, 300)}`,
      `- Value  : ${sanitize(value, 300)}`,
      '',
      '【SWOT】',
      `- 強み: ${sanitize(strength, 400)}`,
      `- 弱み: ${sanitize(weakness, 400)}`,
      `- 機会: ${sanitize(opportunity, 400)}`,
      `- 脅威: ${sanitize(threat, 400)}`,
      '',
      storyNote
        ? `【既存の章メモ（参考）】\n${storyNote}`
        : '',
      financeSummaryDigest, // ★ 全社財務サマリー
      portfolioDigest,      // ★ 事業ポートフォリオ
      financialSummary,     // （既存）元CSVの生テキスト抜粋
      '',
      '【執筆要件】',
      '- 章の見出し文言は最終的にサーバ側で上書きされるため、内容の質を最優先すること。',
      '- それぞれの章が上記のゴールと「魂の三要素」を満たすように書くこと。',
      '- 深掘りQ&Aの内容は参照しないこと。',
    ]
      .filter(Boolean)
      .join('\n');

    const temp =
      typeof temperature === 'number' ? temperature : 0.4;

    // ---- タイムアウト（ハング対策）----
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      45000,
    );
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
        { signal: controller.signal },
      );
      raw =
        c1.choices?.[0]?.message?.content?.trim() || '';
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
          { signal: controller.signal },
        );
        raw =
          c2.choices?.[0]?.message?.content?.trim() ||
          '';
      } catch (e2: any) {
        clearTimeout(timer);
        console.error(
          '❌ ストーリー生成API失敗:',
          e2?.message || e2,
        );
        return NextResponse.json(
          { error: e2?.message || 'OpenAI error' },
          { status: 500 },
        );
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
        {
          story: chapters,
          _debug: { model, fallback: true, mode },
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // ---- ここから「感情補正（二段階目）」 ※デフォルトON。失敗時は無視して続行 ----
    let enhancedChapters = coerced;
    const doEnhance = enhanceEmotion !== false; // 既定で true（未指定は有効）
    if (doEnhance) {
      try {
        const enhanceSystem =
          'あなたは経営者ストーリーのエディターです。構造を壊さず、「熱・覚悟・人間的な語り」を増幅します。出力はJSONのみ。';
        const enhanceUser = [
          '【編集方針】',
          '- 各章の論理は保ちつつ、語り口を「経営者本人の声」に寄せる。',
          '- 第2章に「誇り」、第3章に「賭け」、第4章に「信念」を、自然な1文として必ず含める。',
          '- 文体は断定的で、比喩は控えめ。SHOW, DON’T TELL を意識し、情景で伝える。',
          '- 各章は250〜400字の範囲を目安に整える（超過時は圧縮）。',
          '',
          '【対象JSON】',
          JSON.stringify(
            { chapters: enhancedChapters },
            null,
            2,
          ).slice(0, 6000), // 安全のため上限
          '',
          '【出力形式（厳守）】',
          '{"chapters":[{"title":"...","body":"..."}]} のみ。',
        ].join('\n');

        const cEnh =
          await openai.chat.completions.create({
            model,
            temperature: Math.min(0.6, temp + 0.1),
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: enhanceSystem },
              { role: 'user', content: enhanceUser },
            ],
            max_tokens: 900,
          });

        const rawEnh =
          cEnh.choices?.[0]?.message?.content?.trim() ||
          '';
        const parsedEnh = extractJsonLoose(rawEnh);
        const coercedEnh = coerceChapters(parsedEnh);
        if (coercedEnh?.length >= 4) {
          enhancedChapters = coercedEnh;
        }
      } catch {
        // 補正失敗時はそのまま続行（既存挙動維持）
      }
    }

    // サーバ側で章タイトル/順序を固定（本文はenhancedの中身を使用）
    const chapters = TITLE_TEMPLATES.map((title, i) => ({
      title,
      body: sanitize(
        enhancedChapters[i]?.body || '（この章は未生成です）',
        2400,
      ),
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
          tagline: sanitize(
            srcSummary.tagline || srcSummary.title || '',
            200,
          ),
          bullets: Array.isArray(srcSummary.bullets)
            ? srcSummary.bullets
                .slice(0, 6)
                .map((b: any) =>
                  sanitize(String(b || ''), 200),
                )
            : [],
        };
      }
    }

    // ★ 追加：勝ち筋候補（WinPattern[]）
    let winPatterns: WinPattern[] | undefined = undefined;
    try {
      const topIds = Array.isArray(patternIds)
        ? (patternIds.filter(
            (id: any) => typeof id === 'string',
          ) as string[])
        : [];
      const winIds = mapTopToWin(
        topIds as any, // TopPatternId[] 想定（実際にはUI側で制御）
      );
      winPatterns = buildWinPatternsFromIds(winIds);
    } catch {
      // 失敗しても全体処理は継続（付加情報なので）
      winPatterns = undefined;
    }

    return NextResponse.json(
      {
        story: chapters,
        summary,
        winPatterns, // ★ ここに勝ち筋候補を同梱
        _debug: { model, mode, enhanced: doEnhance === true },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    console.error(
      '❌ ストーリー生成エラー:',
      error?.message || error,
    );
    const status =
      error?.name === 'AbortError' ? 504 : 500;
    return NextResponse.json(
      { error: error?.message || 'Server error' },
      { status },
    );
  }
}
