// /app/api/stage2/deep-dive/route.ts
// STAGE2：AI掘り下げ機能（Version 1）
//
// 役割：
// - 既存12問の回答を評価し、戦略を変える可能性の高い「次に考えるべき問い」を1問だけ生成
// - AI自身が戦略案を決めるのではなく、検証すべき論点を浮かび上がらせる

import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { getOpenAIModelParamsForProcess } from '@/lib/modelConfig';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership, assertMinRole } from '@/lib/server/rbacGuard';
import { logAuditEvent, extractAuditMetadata } from '@/lib/server/auditLog';
import { logInputGuard, checkSuspiciousKeywords } from '@/lib/inputGuardLogger';
import { z } from 'zod';

/* ===== 入力バリデーション ===== */
const InputSchema = z.object({
  questionId: z.string(),
  originalQuestion: z.string(),
  originalAnswer: z.string(),
  strategyDataId: z.string().min(1),
  companyName: z.string().optional(),
  industry: z.string().optional(),
  businessContent: z.string().optional(),
  customerSegment: z.string().optional(),
  answers12: z.array(z.object({
    id: z.string(),
    question: z.string().optional(),
    answer: z.string().optional(),
  })).optional(),
});

/* ===== 出力スキーマ ===== */
const OutputSchema = z.object({
  question: z.string(),
  rationale: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const t0 = Date.now();

  try {
    const admin = getSupabaseAdmin();

    // ★ 認証チェック
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // ★ リクエスト解析
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }

    // ★ 入力バリデーション
    const parseResult = InputSchema.safeParse(body);
    if (!parseResult.success) {
      console.error('[stage2/deep-dive] input validation failed', parseResult.error.flatten());
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.format() }, { status: 400 });
    }

    const input = parseResult.data;

    // ★ 疑わしいキーワード検出
    const suspiciousCheck = checkSuspiciousKeywords(
      `${input.originalAnswer}\n${input.originalQuestion}`
    );
    if (suspiciousCheck.detected) {
      logInputGuard('stage2_deep_dive_suspicious', suspiciousCheck, { userId, questionId: input.questionId });
      return NextResponse.json(
        { error: 'Input contains suspicious keywords' },
        { status: 400 }
      );
    }

    // ★ strategy_dataから対象会社を確認
    const { data: strategyRecord, error: strategyError } = await admin
      .from('strategy_data')
      .select('company_id')
      .eq('id', input.strategyDataId)
      .maybeSingle();

    if (strategyError || !strategyRecord?.company_id) {
      return NextResponse.json(
        { error: 'strategy_data_not_found' },
        { status: 404 }
      );
    }

    const strategyCompanyId = strategyRecord.company_id;

    // ★ メンバーシップ確認
    const membership = await requireMembership(admin, userId, strategyCompanyId);
    if (!membership) {
      return NextResponse.json({ error: 'not_a_member' }, { status: 403 });
    }

    // ★ ロール確認（manager以上）
    await assertMinRole(membership, 'manager');

    // ★ プロンプト生成
    const systemPrompt = buildSystemPrompt(input.questionId);
    const userPrompt = buildUserPrompt(input);

    console.log('[stage2/deep-dive] ★PROMPTS BUILT★', {
      questionId: input.questionId,
      systemLen: systemPrompt.length,
      userLen: userPrompt.length,
    });

    // ★ OpenAI 呼び出し
    const controller = new AbortController();
    const TIMEOUT_MS = 50000; // 50秒
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const params = getOpenAIModelParamsForProcess('stage2DeepDive');

    const response = await openai.chat.completions.create(
      {
        ...params,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      },
      { signal: controller.signal }
    );

    clearTimeout(timer);

    const rawResponse = response.choices?.[0]?.message?.content?.trim() || '';
    console.log('[stage2/deep-dive] ★OPENAI RESPONSE★', {
      model: response.model,
      finishReason: response.choices?.[0]?.finish_reason,
      contentExists: !!response.choices?.[0]?.message?.content,
      rawLen: rawResponse.length,
      preview: rawResponse.slice(0, 200),
      usage: {
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        reasoningTokens: (response.usage as any)?.reasoning_tokens,
      },
    });

    // ★ JSON抽出
    let parsed: unknown;
    try {
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(rawResponse);
      }
    } catch (e) {
      console.error('[stage2/deep-dive] JSON parse failed:', e);
      return NextResponse.json(
        { ok: false, error: 'Failed to parse AI response as JSON' },
        { status: 500 }
      );
    }

    // ★ 出力バリデーション
    const outputValidation = OutputSchema.safeParse(parsed);
    if (!outputValidation.success) {
      console.warn('[stage2/deep-dive] Output validation failed:', outputValidation.error.format());
      return NextResponse.json(
        { ok: false, error: 'AI response does not match expected format' },
        { status: 500 }
      );
    }

    const result = outputValidation.data;

    // ★ 監査ログ
    try {
      await logAuditEvent({
        companyId: strategyCompanyId,
        actorUserId: userId,
        action: 'stage2_deep_dive_generate',
        targetType: 'strategy_data',
        metadata: {
          questionId: input.questionId,
          generatedQuestionLen: result.question.length,
          hasRationale: !!result.rationale,
          durationMs: Date.now() - t0,
        },
        ...extractAuditMetadata(req),
      });
    } catch (auditErr) {
      console.warn('[stage2/deep-dive] audit log failed:', auditErr);
    }

    console.log('[stage2/deep-dive] ★SUCCESS★', {
      questionId: input.questionId,
      generatedQuestionLen: result.question.length,
      durationMs: Date.now() - t0,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    const isAbortError = err.name === 'AbortError';
    const status = isAbortError ? 504 : 500;
    const totalDurationMs = Date.now() - t0;

    console.error('[stage2/deep-dive] ★FATAL ERROR★', {
      name: err.name,
      message: err.message,
      status,
      durationMs: totalDurationMs,
      isTimeout: isAbortError,
    });

    return NextResponse.json(
      {
        ok: false,
        error: err.message || 'Server error',
        details: {
          status,
          isTimeout: isAbortError,
        },
      },
      { status }
    );
  }
}

/**
 * システムプロンプト生成 (Version 1.2.1 - 役割分担と深掘りゲート)
 */
function buildSystemPrompt(questionId: string): string {
  const systemBase = `あなたは、経営者の思考を深める戦略ファシリテーターです。

目的は回答を評価・批評することではなく、
回答の中にある「まだ考え切れていないこと」や「見落としている重要論点」を見つけ、
経営者自身がもう一段考えるための「次の1問」を提示することです。

内部では高度に考えて構いません。
ただし、提示する質問は、
- 平易で、わかりやすく、具体的な日本語にしてください
- 会議で口頭で聞いても、一度で意味が分かる表現にしてください`;

  const checkItems: Record<string, string> = {
    'ch0-q1': `
【役割：事業前提の脆弱性を診断する】

このセクションの目的は、
「顧客が自社を選ぶ理由」や「競争優位」を聞くことではない。

「現在の事業・収益・市場が成立している前提のうち、
何が崩れる可能性があるのか」
を掘り下げることである。

【禁止：以下の方向に進まない】
× 「それでも顧客が当社を選ぶ理由は何ですか？」
→ これはch1-q2の役割。ch0-q1ではない。

× 「当社の競争優位は何ですか？」
→ これはch1-q2の役割。ch0-q1ではない。

× 「顧客価値は何ですか？」
→ これはch1-q2の役割。ch0-q1ではない。

【推奨方向】
○ 「海外製品がさらに増えたとき、現在の事業のどこが最初に成り立たなくなりそうですか？」
○ 「価格競争がこのまま進んだ場合、今の収益の出し方はどこまで維持できそうですか？」
○ 「この変化が進むと、現在のビジネスモデルで最も影響を受ける部分はどこでしょうか？」

【内部確認項目】
① 回答は抽象的・一般論で止まっていないか
② 現在の事業・収益・市場前提のうち、何が崩れる可能性があるのか明確か
③ その前提は5〜10年後も成立するか
④ この変化によって最初に何が影響を受けるのか
⑤ 顧客行動、市場構造、技術、規制の変化を見落としていないか`,

    'ch1-q1': `
【役割：将来の需要・代替・顧客行動を診断する】

このセクションの目的は、
「5年後、現在の商品・需要・市場がどのように変わるのか」
を掘り下げることである。

ch1-q2の「顧客価値・なぜ選ぶか」に寄せすぎないこと。

【推奨方向】
○ 「5年後、お客様が今の商品を選ばなくなるとしたら、何に乗り換えると思いますか？」
○ 「将来、同じ課題を解決する別の方法が出てくるとしたら、何が考えられますか？」
○ 「顧客の買い方は変わるでしょうか」

【内部確認項目】
① 回答は抽象的・一般論で止まっていないか
② 今の商品への需要は本当に残るか検証されているか
③ 顧客の買い方は変わらないか
④ 代わりの商品・技術・サービスはないか
⑤ 顧客が内製化しないか、そもそも買わなくならないか
⑥ 新しい解決方法の出現を考えているか`,

    'ch1-q2': `
【役割：顧客価値を段階的に深掘りする】

このセクションの目的は、
「顧客は何に困り、何を実現したく、なぜ自社を選ぶのか」
を掘り下げることである。

ただし、回答の「成熟度」によって、進める質問を制限する。

【5つの内部レンズ（Lens）】

Lens 1：現在の商品を使う中での不便・負担
- 商品の使用、運搬、保管、発注、管理、廃棄などの過程での手間・負担・不満
- 既存付加価値向上につながる

Lens 2：顧客が解決したい困りごと
- 商品そのものから離れた、顧客の本質的な困りごと
- 商品への不満とは別の問い

Lens 3：顧客が実現したい状態
- 困りごとの解消から、顧客が本当に実現したい結果・状態へ

Lens 4：別の解決方法
- 別の商品、技術、サービス、内製化、そもそも商品を使わない方法
- 新しい事業機会につながる

Lens 5：自社を選ぶ理由
- 競合や別の解決方法がある中で、なぜ顧客が自社を選ぶのか
- 選ばれる理由を強くする、または新しく作る余地はないか

【成熟度による深掘りゲート】

--- Level 1：抽象的な価値表現（例：品質、価格、信頼、技術力、安心、ブランド）---

この段階では、「会社・商品の良さ」は見えているが、
顧客が「何に困っているか」「何を楽にしたいか」「何を避けたいか」「何を実現したいか」
がまだ見えていない状態。

進行可能なLens：Lens 1, 2, 3のみ
進行禁止：Lens 4, 5

特に、Lens 2「顧客が解決したい困りごと」を強く優先する。

例）
回答が「品質と価格」の場合：
○「この商品を使うことで、お客様はどんな困りごとを解決したいのでしょうか？」
○「この商品を使う中で、お客様が手間や負担に感じていることは何ですか？」

--- Level 2：顧客の困りごと・利用時負担が見えている（例：安全に保管したい、運搬負担を減らしたい）---

この段階では、顧客の具体的な困りごとや利用時負担が明確になっている。

進行可能なLens：Lens 1, 2, 3, 4, 5すべて
進行方向：すでに聞いたLensは繰り返さない。次の未検討領域へ進む。

例）
回答が「安全に保管し、漏れを防ぎたい」の場合：
- Lens 1, 2は聞き直さない
- Lens 3, 4, 5など次の段階へ進む

--- Level 3：自社を選ぶ理由まで明確（例：安定供給が選ばれる理由、小ロット対応が他社との差）---

この段階では、「なぜ自社を選ぶか」がすでに明確になっている。

進行禁止：Lens 5を繰り返さない
進行方向：「選ばれる理由をさらに強くできないか」「新しく作れないか」「代替手段が出ても維持できるか」

【Lens 5への進入条件（重要）】

Lens 5「自社を選ぶ理由」は戦略的に見えるのでAIが選びやすいが、
早すぎる段階で進むと深掘りが浅くなる。

以下の3つのうち、最低でも1つは具体化されていることが必須：
- 顧客が何を解決したいのか（Lens 2）
- 商品利用時の具体的な負担（Lens 1）
- 顧客が実現したい状態（Lens 3）

進入禁止の例）
「品質」「価格」「信頼」だけではLens 5へ進まない。
具体的な困りごと・負担・実現状態が見えるまで、Lens 1〜3を優先する。

【最終質問選択前のチェックリスト】

①この問いはch1-q2の役割に合っているか
②他の3つのdeepDive質問の役割と重複していないか
③回答者の現在の思考レベルを1段だけ進める問いか
④2段・3段先へ飛んでいないか
⑤既にanswers12で十分考えられていないか

③④を特に重視する。`,

    'ch1-q6': `
【役割：資源集中と戦略的優先度を診断する】

このセクションの目的は、
「何をやめることで、重要な領域へ資源を集中するのか」
を掘り下げることである。

【内部確認項目】
① 何をやめることで、重要な領域へ資源を移せるのか明確か
② 惰性で続けている活動はないか
③ 顧客価値が低い活動はないか
④ 他社と差がつかない活動はないか
⑤ 経営資源を分散させているもので優先度が低いものはないか
⑥ 収益性、成長性、戦略的重要性を見落としていないか

【質問方向】
「今やっていることの中で、やめてもお客様があまり困らないものは何ですか？」
など、顧客価値と経営資源の両面から、何をやめるべきかを考えさせる問い。`,
  };

  const checkItemsText = checkItems[questionId] || '';

  return `${systemBase}
${checkItemsText}

【最終選定基準】
- Impact：その前提が間違っていた場合、会社の売上・利益・競争力・事業継続にどれだけ影響か
- Uncertainty：その前提の確実性がどれだけ低いか
- Possibility of Strategy Change：その前提を検証することで、現在の戦略を大きく変える可能性か
- Answerability：回答者が一度読んだだけで意味を理解でき、自社・顧客・現場の具体的な場面を思い浮かべて答えられるか

【質問表現ルール】
- 原則1文
- 1つの論点だけを聞く
- 50〜70文字程度を目安に
- 会議で口頭で聞いても、一度で意味が分かる
- 専門用語を極力使わない
- コンサル用語を極力使わない
- AIが答えを示唆しすぎない
- 回答を誘導しすぎない
- 「？」は原則1つだけ

【出力形式】
出力は必ず JSON 形式にしてください。
JSON以外の文章、Markdown、コードフェンスは出力しないでください。

{
  "question": "経営者が次に考えるべき質問を1問",
  "rationale": "なぜこの問いを考える価値があるかを平易に1～2文"
}

rationaleは質問より難しくならないこと。`;
}

/**
 * ユーザープロンプト生成 (Version 1.2)
 */
function buildUserPrompt(input: {
  questionId: string;
  originalQuestion: string;
  originalAnswer: string;
  companyName?: string;
  industry?: string;
  businessContent?: string;
  customerSegment?: string;
  answers12?: Array<{
    id: string;
    question?: string;
    answer?: string;
  }>;
}): string {
  let context = '';
  if (input.companyName) context += `会社名：${input.companyName}\n`;
  if (input.industry) context += `業界：${input.industry}\n`;
  if (input.businessContent) context += `事業内容：${input.businessContent}\n`;
  if (input.customerSegment) context += `顧客セグメント：${input.customerSegment}\n`;

  // ★ Version 1.2: 他の回答をコンテキストとして利用
  let otherAnswersContext = '';
  if (input.answers12 && Array.isArray(input.answers12)) {
    const otherAnswers = input.answers12.filter(
      (a) => a.id !== input.questionId && a.answer?.trim()
    );
    if (otherAnswers.length > 0) {
      otherAnswersContext = '\n\n【他の質問への回答（参考）】\n\n';
      otherAnswers.forEach((a) => {
        otherAnswersContext += `Q: ${a.question?.substring(0, 60) || a.id}\nA: ${a.answer?.substring(0, 200)}\n\n`;
      });
      otherAnswersContext += '※ 他の回答ですでに十分考えられていることは繰り返さないでください。\n';
      otherAnswersContext += '※ 他の回答との矛盾があれば、それも重要論点として考慮してください。';
    }
  }

  return `【現在の回答を診断してください】

${context}

【対象の質問】
${input.originalQuestion}

【経営者の回答】
${input.originalAnswer}
${otherAnswersContext}

この回答の現在地を診断し、
まだ考えられていない重要領域を見つけてください。

戦略を変える可能性が最も高い「次に考えるべき問い」を1つだけ生成してください。`;
}
