// /app/api/stage2/generate-final/route.ts
// STAGE2：最終ストーリー生成API（社員向け熱量を持った語り）
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

/* ===== OpenAI設定 ===== */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const MODEL_PRIMARY =
  process.env.OPENAI_MODEL ?? process.env.NEXT_PUBLIC_OPENAI_MODEL ?? 'gpt-4o';
const MODEL_FALLBACK = 'gpt-4o-mini';
const SUPPORTS_JSON_MODE = /^gpt-4o($|-)/;

/* ===== 4章タイトル ===== */
const CHAPTER_TITLES = [
  '第1章：なぜ今',
  '第2章：どう戦う',
  '第3章：どんな未来',
  '第4章：どう行動する',
] as const;

/* ===== ユーティリティ ===== */
function sanitize(text: unknown, max = 2400): string {
  const s = text === null || text === undefined ? '' : typeof text === 'string' ? text : String(text);
  return s.replace(/\u0000/g, '').replace(/\s+$/g, '').slice(0, max);
}

function extractJsonLoose<T = unknown>(raw: string): T | null {
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
  return null;
}

/** 日本語テキストの余計な半角スペースを整理 */
function tidyJa(s: string): string {
  if (!s) return s;
  let out = s;
  out = out.replace(
    /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[ ]+([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu,
    '$1$2',
  );
  out = out.replace(/([、。％%！!？?」』）)＞>])[ ]+/gu, '$1');
  out = out.replace(/[ ]+([、。％%！!？?」』）)＞>])/gu, '$1');
  out = out.replace(/(\d)[ ]+％/g, '$1％');
  out = out.replace(/[ ]{2,}/g, ' ');
  return out;
}

/* ===== 12問の回答を整形 ===== */
type Stage2Answer = {
  id: string;
  question: string;
  answer?: string;
  required?: boolean;
};

function formatAnswers12(answers: Stage2Answer[]): string {
  if (!answers || answers.length === 0) return '（未回答）';
  const answered = answers.filter((a) => a.answer?.trim());
  if (answered.length === 0) return '（未回答）';
  return answered
    .map((a) => `Q: ${a.question.slice(0, 60)}...\nA: ${sanitize(a.answer, 300)}`)
    .join('\n\n');
}

/* ===== プロンプト構築 ===== */
function buildSystemPrompt(): string {
  return `あなたは「未来逆算×両利きの経営」を率いる経営者であり、全社員に本音と覚悟を届けるストーリーファシリテーターです。

【執筆の核心】
1. 【衝撃と共感から始める】過去の延長をやめ、3〜5年先の"当たり前"から今を見直す。事実で危機を語る。
2. 【選択と集中の覚悟】勝つところに資源を寄せ、やめることを明言。
3. 【勝利のイメージを描く】顧客の一場面で価値を見える化。数値があれば引用、なければ定性で可視化。
4. 【各個人への熱いバトン】期待行動を言い切る。「自分で決める」「速く試す」「学びを翌週反映」。

【魂の三要素（必ず自然文で挿入）】
- 第2章に「誇り」を示す一文（私たちが守り抜いてきた本質・流儀）
- 第3章に「賭け」を示す一文（未来へ踏み出す決断・リスクを受け止める覚悟）
- 第4章に「信念」を示す一文（仲間とやり抜く、何があってもブレない原則）

【勝ち筋の反映】
- 選択された勝ち筋に整合する語り・事例・トレードオフを織り込む
- 「やらないこと」宣言は、選んだ勝ち筋のロジックと矛盾させない

【出力制約（厳守）】
- 4章構成：なぜ今 / どう戦う / どんな未来 / どう行動する
- 各章2〜4段落。社員が読んで腹に落ちる語り口で。
- 章末は必ず「。」で完結させる（途中で切れない）
- 出力はJSONのみ：
{
  "finalStory": [
    {"title": "第1章：なぜ今", "body": "..."},
    {"title": "第2章：どう戦う", "body": "..."},
    {"title": "第3章：どんな未来", "body": "..."},
    {"title": "第4章：どう行動する", "body": "..."}
  ]
}`;
}

type GenerateFinalInput = {
  issueBlocks?: Array<{ title: string; description?: string; linkedMetrics?: string[] }>;
  metricsSummary?: Record<string, unknown>;
  mvv?: { thought?: string; mission?: string; vision?: string; value?: string };
  swot?: { strength?: string; weakness?: string; opportunity?: string; threat?: string };
  storyDraft?: Array<{ title: string; body: string }>;
  winPatternsCandidate?: Array<{ id: string; name: string; valueDrivers?: string[]; rationale?: string }>;
  selectedWinPatternId?: string;
  answers12?: Stage2Answer[];
  industry?: string;
  segments?: string[];
};

function buildUserPrompt(input: GenerateFinalInput): string {
  const {
    issueBlocks = [],
    metricsSummary = {},
    mvv = {},
    swot = {},
    storyDraft = [],
    winPatternsCandidate = [],
    selectedWinPatternId,
    answers12 = [],
    industry,
    segments,
  } = input;

  // 選択された勝ち筋を特定
  const selectedWp = selectedWinPatternId
    ? winPatternsCandidate.find((wp) => wp.id === selectedWinPatternId)
    : winPatternsCandidate[0];

  const winPatternText = selectedWp
    ? `【選択された勝ち筋】${selectedWp.name}\n- 価値ドライバー: ${selectedWp.valueDrivers?.join(', ') || '—'}\n- 根拠: ${selectedWp.rationale || '—'}`
    : '【勝ち筋】未選択';

  // 論点サマリ
  const issuesText = issueBlocks.length > 0
    ? issueBlocks.map((ib, i) => `${i + 1}. ${ib.title}${ib.linkedMetrics?.length ? `（${ib.linkedMetrics.join(', ')}）` : ''}`).join('\n')
    : '（論点なし）';

  // 指標サマリ
  const ms = metricsSummary as Record<string, number | string | undefined>;
  const metricsText = [
    ms.roic !== undefined ? `ROIC: ${Number(ms.roic).toFixed(1)}%` : null,
    ms.wacc !== undefined ? `WACC: ${Number(ms.wacc).toFixed(1)}%` : null,
    ms.pbr !== undefined ? `PBR: ${Number(ms.pbr).toFixed(2)}倍` : null,
  ].filter(Boolean).join(' / ') || '（指標なし）';

  // たたき台ストーリーの要約
  const draftSummary = storyDraft.length > 0
    ? storyDraft.map((ch) => `【${ch.title}】${ch.body.slice(0, 200)}...`).join('\n')
    : '（たたき台なし）';

  // 12問の回答
  const answersText = formatAnswers12(answers12);

  return `【会社情報】
業種: ${industry || '—'}
${segments?.length ? `事業セグメント: ${segments.join(', ')}` : ''}

【STAGE1の論点】
${issuesText}

【財務指標】
${metricsText}

【MVV】
- Mission: ${sanitize(mvv.mission, 200) || '—'}
- Vision: ${sanitize(mvv.vision, 200) || '—'}
- Value: ${sanitize(mvv.value, 200) || '—'}
${mvv.thought ? `- 経営者の思い: ${sanitize(mvv.thought, 300)}` : ''}

【SWOT】
- 強み: ${sanitize(swot.strength, 200) || '—'}
- 弱み: ${sanitize(swot.weakness, 200) || '—'}
- 機会: ${sanitize(swot.opportunity, 200) || '—'}
- 脅威: ${sanitize(swot.threat, 200) || '—'}

${winPatternText}

【たたき台ストーリー（参考）】
${draftSummary}

【12問への回答（経営者の声）】
${answersText}

上記の情報を踏まえ、社員に熱量と覚悟が伝わる最終ストーリーを4章構成で生成してください。
たたき台を基盤としつつ、12問の回答で得られた経営者の思いを織り込み、「誇り」「賭け」「信念」を自然に含めてください。`;
}

/* ===== APIハンドラ ===== */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  // ★ 修正3：リクエスト受領ログ
  console.log('[stage2/generate-final] POST ENTER', {
    at: new Date().toISOString(),
    method: req.method,
    contentLength: req.headers.get('content-length'),
  });

  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error('[stage2/generate-final] OPENAI_API_KEY is missing');
      return NextResponse.json(
        { error: 'OPENAI_API_KEY is missing' },
        { status: 500 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as GenerateFinalInput;
    console.log('[stage2/generate-final] input parsed', {
      issueBlocksCount: body.issueBlocks?.length ?? 0,
      winPatternsCandidateCount: body.winPatternsCandidate?.length ?? 0,
      answers12Count: body.answers12?.length ?? 0,
      selectedWinPatternId: body.selectedWinPatternId,
    });

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(body);
    console.log('[stage2/generate-final] prompts built', {
      systemLen: systemPrompt.length,
      userLen: userPrompt.length,
    });

    // OpenAI API呼び出し
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 58000);

    let raw = '';
    let usedModel = MODEL_PRIMARY;
    let tOpenAI = 0;

    try {
      // ★ 修正3：OpenAI 呼び出し開始ログ
      tOpenAI = Date.now();
      console.log('[stage2/generate-final] BEFORE openai.chat.completions.create (1st attempt)', {
        model: MODEL_PRIMARY,
        temperature: 0.85,
        maxTokens: 3600,
      });

      const completion = await openai.chat.completions.create(
        {
          model: MODEL_PRIMARY,
          temperature: 0.85,
          max_tokens: 3600,
          presence_penalty: 0.6,
          frequency_penalty: 0.3,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          ...(SUPPORTS_JSON_MODE.test(MODEL_PRIMARY)
            ? { response_format: { type: 'json_object' as const } }
            : {}),
        },
        { signal: controller.signal }
      );
      raw = completion.choices?.[0]?.message?.content?.trim() || '';
      // ★ 修正3：OpenAI 返却ログ
      const dur1 = Date.now() - tOpenAI;
      console.log('[stage2/generate-final] AFTER openai.chat.completions.create (1st attempt)', {
        durationMs: `${dur1}ms`,
        rawLen: raw.length,
        hasContent: !!raw,
      });
    } catch (e: unknown) {
      // フォールバック
      const dur1 = tOpenAI ? Date.now() - tOpenAI : undefined;
      const err1 = e as Error;
      console.warn(
        '[stage2/generate-final] 1st OpenAI attempt failed' + (dur1 ? ` (duration: ${dur1}ms)` : ''),
        err1?.message || e
      );

      usedModel = MODEL_FALLBACK;
      try {
        // ★ 修正3：フォールバック OpenAI 呼び出し開始ログ
        tOpenAI = Date.now();
        console.log('[stage2/generate-final] BEFORE openai.chat.completions.create (2nd attempt - fallback)', {
          model: MODEL_FALLBACK,
          reason: '1st attempt failed',
        });

        const completion2 = await openai.chat.completions.create(
          {
            model: MODEL_FALLBACK,
            temperature: 0.85,
            max_tokens: 3600,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' as const },
          },
          { signal: controller.signal }
        );
        raw = completion2.choices?.[0]?.message?.content?.trim() || '';
        // ★ 修正3：フォールバック OpenAI 返却ログ
        const dur2 = Date.now() - tOpenAI;
        console.log('[stage2/generate-final] AFTER openai.chat.completions.create (2nd attempt - fallback)', {
          durationMs: `${dur2}ms`,
          rawLen: raw.length,
          hasContent: !!raw,
        });
      } catch (e2: unknown) {
        clearTimeout(timer);
        const dur2 = tOpenAI ? Date.now() - tOpenAI : undefined;
        const err2 = e2 as Error;
        const totalDurationMs = Date.now() - t0;
        // ★ 修正3：error 詳細ログ
        console.error('[stage2/generate-final] OpenAI fallback error (both attempts failed)', {
          name: err2?.name,
          message: err2?.message || e2,
          duration1Ms: dur1,
          duration2Ms: dur2,
          totalDurationMs: `${totalDurationMs}ms`,
          isAbortError: err2?.name === 'AbortError',
          stack: err2?.stack?.substring(0, 300),
        });
        return NextResponse.json(
          { error: err2?.message || 'OpenAI API error' },
          { status: 500 }
        );
      }
    } finally {
      clearTimeout(timer);
    }

    // JSON抽出
    type ParsedOutput = { finalStory?: Array<{ title?: string; body?: string }> };
    const parsed = extractJsonLoose<ParsedOutput>(raw);
    if (!parsed) {
      console.error('[stage2/generate-final] Failed to parse JSON:', raw.slice(0, 500));
      return NextResponse.json(
        { error: 'Failed to parse AI response' },
        { status: 500 }
      );
    }

    // finalStory の正規化
    let rawStory = parsed.finalStory || [];
    if (!Array.isArray(rawStory)) rawStory = [];

    const finalStory = CHAPTER_TITLES.map((title, i) => {
      const src = rawStory[i];
      let body = sanitize(src?.body || '（この章は未生成です）', 4000);
      // 章末が「。」で終わるように補正
      body = tidyJa(body);
      if (body && !body.endsWith('。') && !body.endsWith('！') && !body.endsWith('？')) {
        body = body.replace(/[、,\s]+$/, '') + '。';
      }
      return { title, body };
    });

    // ★ 修正3：レスポンス返却直前ログ
    const totalDurationMs = Date.now() - t0;
    console.log('[stage2/generate-final] END - preparing response', {
      finalStoryCount: finalStory.length,
      finalStoryLengths: finalStory.map((ch, i) => `Ch${i}: ${ch.body.length}`),
      usedModel,
      totalDurationMs: `${totalDurationMs}ms`,
      at: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        finalStory,
        _debug: { model: usedModel },
      },
      {
        headers: { 'Cache-Control': 'no-store' },
      }
    );

  } catch (error: unknown) {
    const err = error as Error;
    const totalDurationMs = Date.now() - t0;
    // ★ 修正3：catch の error 詳細ログ
    console.error('[stage2/generate-final] FATAL Server error', {
      name: err?.name,
      message: err?.message || error,
      totalDurationMs: `${totalDurationMs}ms`,
      isAbortError: err?.name === 'AbortError',
      stack: err?.stack?.substring(0, 500),
    });
    const status = err?.name === 'AbortError' ? 504 : 500;
    return NextResponse.json(
      { error: err?.message || 'Server error' },
      { status }
    );
  }
}
