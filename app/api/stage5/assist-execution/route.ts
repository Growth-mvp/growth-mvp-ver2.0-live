/* eslint-disable @typescript-eslint/no-explicit-any */
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';

/* ========= 型定義 ========= */
type AssistExecutionRequest = {
  projectTitle?: string;
  departmentName?: string;
  objective?: string;
  keyResults?: string[];
  progress?: number;
  memo: string;
  supportRequest?: string;
};

type AssistExecutionResponse = {
  directAnswer?: string;
  summary: string;
  issues: string[];
  nextActions: string[];
  supportDraft: string;
  reviewSignal: string;
};

/* ========= requestId 生成 ========= */
function makeRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `req_${Date.now()}`;
}

/* ========= システムプロンプト構築 ========= */
function buildAssistSystemPrompt(): string {
  return `あなたは、GROWTHのSTAGE5実行支援AIです。
役割は、プロジェクト担当者が入力した「進捗・気づき・違和感・困りごと・質問」を、実行が前に進む形に整理することです。

【最重要ルール：質問には先に直接答える】
ユーザー入力が質問形式の場合、単に「不明確である」「リサーチする」と整理するだけで終わらせないでください。
特に以下のような入力では、必ず directAnswer に具体的な回答を入れてください。
- 「具体的に何か」
- 「例を知りたい」
- 「何をすればよいか」
- 「どう進めればよいか」
- 「〇〇とは何か」

質問への回答では、プロジェクト名・部門名・Objective・KRがあれば、それに合わせて実務で使える具体例を3〜5個提示してください。
例：ユーザーが「製品強化とは具体的に何か、例を知りたい」と聞いた場合は、「製品強化が不明確です」で終わらせず、性能改善、機能追加、使いやすさ改善、サポート強化、競合差別化などの具体例を提示してください。

【業界・顧客別具体化ルール】
入力内容に「電子デバイス企業」「半導体企業」「製造業」「医療機器メーカー」「SaaS企業」など業界名・顧客種別・対象企業が含まれる場合は、その業界の部門・業務・評価軸に分解して回答してください。

具体例：
- 「電子デバイス企業向けの提案力強化」という質問に対しては、単に「顧客ニーズを調査する」「競合分析する」「提案資料を作成する」といった一般論で終わらせない
- 代わりに、以下の観点まで具体化してください：
  * その顧客企業のどの部門に向けた提案なのか（例：開発、調達、品質保証、生産技術、経営層など）
  * その部門は何を重視するのか（評価軸は何か）
  * どのような課題を想定できるのか
  * どのような提案資料・説明・データが必要なのか
  * 次回商談やヒアリングで何を聞くべきか
  * 1週間以内に何を作る・調べる・確認するべきか

【回答品質のルール】
- 「提案力強化」「製品強化」「顧客開拓」「市場進出」「営業強化」「連携強化」などの抽象的な表現について質問された場合は、抽象語をそのまま言い換えるだけでなく、実際の業務行動に分解してください
- 入力内容に基づいて、具体的かつ実行可能な提案をする
- 「リサーチする」「整理する」「競合分析する」だけで終わらず、その場で具体的な行動ステップ・例・選択肢・判断軸を出す
- 進捗が停滞している、目標が重複している等は、入力や文脈から明確に言える場合だけ書く
- ユーザーのメモを否定しない
- 迷い、違和感、止まりそうな点を重要な実行情報として扱う
- 経営者向けの抽象論ではなく、現場が次に動ける粒度で書く
- JSON形式が必須。Markdownや通常文章だけの応答は避ける

【あなたの役割】
- ユーザーの質問には、まず直接・具体的に答える
- ユーザーの進捗メモ・困りごと・違和感を整理する
- 現場の視点から、次の一手や支援依頼のたたき台を提案する
- STAGE3またはSTAGE4への見直しシグナルを提示する。ただし、根拠が弱い場合は断定せず「現時点では大きな見直しシグナルはありません」とする

【出力形式】
必ず以下のJSON形式で応答してください：
{
  "directAnswer": "ユーザーの質問への直接回答。質問でない場合は空文字。質問の場合は具体例や進め方を3〜5個含め、業界・顧客別の観点があれば部門別・課題別・評価軸別に分解する",
  "summary": "状況の要約（2-3文で、現在地と論点をシンプルに）",
  "issues": ["具体的な課題1（一般論ではなく、業界・顧客別の観点が必要な場合はそこまで分解）", "課題2", "課題3"],
  "nextActions": ["実行可能なアクション1（「調査する」ではなく「〇〇について△△を整理する」など具体的に）", "アクション2", "アクション3"],
  "supportDraft": "他部門や上司に支援を依頼する場合の文面たたき台。具体的な背景・理由・期待が分かる文面に",
  "reviewSignal": "STAGE3またはSTAGE4の見直しが必要な可能性があるか。通常の実行相談では『現時点では大きな見直しシグナルはありません』とし、プロジェクト目的とのズレ・KPIと実行内容のズレ・部門ミッションとの矛盾がある場合のみ見直し可能性を示す"
}

【directAnswer の具体性ガイド】
悪い例：「顧客ニーズを調査する、競合分析を行う、提案資料を作成する、フォローアップ体制を整備する」
良い例：「既存顧客3社について、開発・調達・品質保証・生産技術のどの部門に刺さる提案かを整理する。過去の失注案件を3件選び、負けた理由を価格・性能・納期・品質・提案内容に分類する。電子デバイス企業向けの提案資料を、開発部門向け・調達部門向け・品質保証部門向けに分けて作り直す」

【nextActions の具体性ガイド】
悪い例：「顧客ニーズを調査する」「競合分析を行う」「提案資料を作成する」
良い例：「既存顧客3社について、開発・調達・品質保証・生産技術のどの部門に刺さる提案かを整理する」「過去の失注案件を3件選び、負けた理由を価格・性能・納期・品質・提案内容に分類する」「電子デバイス企業向けの提案資料を、開発部門向け・調達部門向け・品質保証部門向けの3パターンに分けて作り直す」「次回商談で聞くべき質問を10個作る」

【issues の具体性ガイド】
悪い例：「提案内容の差別化が不十分」「顧客ニーズに対応できない」「提案プロセスが非効率」
良い例：「顧客企業内の開発・調達・品質保証・生産技術それぞれの関心事に合わせた提案になっていない可能性」「過去の失注理由が価格・性能・納期・品質・提案内容のどれに起因するか整理されていない可能性」「営業資料が顧客部門別ではなく、製品説明中心になっている可能性」

【supportDraft の具体性ガイド】
悪い例：「競合分析や顧客ニーズ調査に関する支援をお願いします」
良い例：「電子デバイス企業向けの提案力を高めるため、過去の商談・失注案件の整理と、顧客部門別の提案資料づくりに協力をお願いします。特に、開発部門・調達部門・品質保証部門・生産技術部門ごとに、どの課題に刺さる提案になっているかを一緒に確認したいです」

【reviewSignal の判断基準】
- 通常の実行相談や具体化相談では「現時点では大きな見直しシグナルはありません」とする
- 以下の場合のみ見直し可能性を示す：
  * プロジェクト目的とユーザーの相談内容が明らかにズレている
  * KPIと実行内容がつながっていない
  * STAGE4の実行計画が抽象的すぎて行動に落ちない
  * STAGE3の部門ミッションと明らかに矛盾している`;
}

/* ========= ユーザープロンプト構築 ========= */
function buildAssistUserPrompt(req: AssistExecutionRequest): string {
  const lines: string[] = [];

  if (req.projectTitle) {
    lines.push(`【プロジェクト】${req.projectTitle}`);
  }
  if (req.departmentName) {
    lines.push(`【部門】${req.departmentName}`);
  }
  if (req.objective) {
    lines.push(`【目的（Objective）】${req.objective}`);
  }
  if (req.keyResults && Array.isArray(req.keyResults) && req.keyResults.length > 0) {
    lines.push(`【主要成果（KR）】`);
    req.keyResults.forEach((kr, i) => {
      lines.push(`  ${i + 1}. ${kr}`);
    });
  }
  if (typeof req.progress === 'number') {
    lines.push(`【進捗率】${Math.round(req.progress * 100)}%`);
  }

  lines.push('');
  lines.push('【実行メモ】');
  lines.push(req.memo || '（メモなし）');

  if (req.supportRequest) {
    lines.push('');
    lines.push('【既に考えている支援依頼内容】');
    lines.push(req.supportRequest);
  }

  lines.push('');
  lines.push('上記のプロジェクト状況と実行メモを踏まえて、整理結果をJSON形式で返してください。');
  lines.push('実行メモが質問の場合は、directAnswerで質問に直接答えたうえで、summary / issues / nextActions も整理してください。');
  lines.push('');
  lines.push('重要：実行メモの中に「電子デバイス企業」「半導体」「医療機器」「SaaS」など業界名や「顧客企業」「提案先」などの顧客種別が含まれている場合は、');
  lines.push('その業界・顧客の部門（開発、調達、品質保証、生産技術、営業、経営層など）・業務・評価軸に分解して具体的に回答してください。');
  lines.push('「調査する」「分析する」「整理する」といった抽象的な表現ではなく、実行可能な具体的な業務行動に分解してください。');

  return lines.join('\n');
}

/* ========= JSON パース（失敗時のフォールバック対応） ========= */
function safeParseAssistResponse(text: string): AssistExecutionResponse | null {
  try {
    // JSONオブジェクト部分を抽出（```json ... ``` が含まれることもあるため）
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }
    const parsed = JSON.parse(jsonText);

    // 必須フィールドをチェック
    if (
      typeof parsed.summary !== 'string' ||
      !Array.isArray(parsed.issues) ||
      !Array.isArray(parsed.nextActions) ||
      typeof parsed.supportDraft !== 'string' ||
      typeof parsed.reviewSignal !== 'string'
    ) {
      return null;
    }

    return {
      directAnswer: typeof parsed.directAnswer === 'string' ? parsed.directAnswer.trim() : '',
      summary: parsed.summary.trim() || '状況が十分に整理できませんでした',
      issues: Array.isArray(parsed.issues) ? parsed.issues.filter((x: any) => typeof x === 'string').map((x: string) => x.trim()) : [],
      nextActions: Array.isArray(parsed.nextActions)
        ? parsed.nextActions.filter((x: any) => typeof x === 'string').map((x: string) => x.trim())
        : [],
      supportDraft: parsed.supportDraft.trim() || '支援依頼の詳細は必要に応じて補足してください',
      reviewSignal: parsed.reviewSignal.trim() || '内容をご確認のうえ、判断してください',
    };
  } catch {
    return null;
  }
}

/* ========= route ========= */
export async function POST(req: Request) {
  const requestId = makeRequestId();

  try {
    // --- ENV チェック ---
    if (!process.env.OPENAI_API_KEY) {
      console.error('[assist-execution]', requestId, 'missing_env: OPENAI_API_KEY');
      return NextResponse.json(
        {
          error: 'missing_env',
          message: 'Server configuration error',
          requestId,
        },
        { status: 500 }
      );
    }

    // --- リクエスト解析 ---
    let body: AssistExecutionRequest | null = null;
    try {
      body = (await req.json()) as AssistExecutionRequest;
    } catch {
      console.error('[assist-execution]', requestId, 'invalid_payload');
      return NextResponse.json(
        {
          error: 'invalid_payload',
          message: 'Request body must be valid JSON',
          requestId,
        },
        { status: 400 }
      );
    }

    if (!body || typeof body.memo !== 'string' || body.memo.trim().length === 0) {
      console.error('[assist-execution]', requestId, 'empty_memo');
      return NextResponse.json(
        {
          error: 'empty_memo',
          message: 'Memo field is required and must not be empty',
          requestId,
        },
        { status: 400 }
      );
    }

    // --- OpenAI 呼び出し ---
    console.log('[assist-execution]', requestId, 'calling_openai', {
      projectTitle: body.projectTitle ? body.projectTitle.substring(0, 20) : undefined,
      memoLength: body.memo.length,
    });

    const systemPrompt = buildAssistSystemPrompt();
    const userPrompt = buildAssistUserPrompt(body);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const rawContent = (completion.choices[0]?.message?.content || '{}').trim();

    console.log('[assist-execution]', requestId, 'openai_response_received', {
      contentLength: rawContent.length,
    });

    // --- JSON パース（フォールバック対応） ---
    let result = safeParseAssistResponse(rawContent);

    if (!result) {
      console.warn('[assist-execution]', requestId, 'json_parse_failed', {
        contentSnippet: rawContent.substring(0, 100),
      });

      // フォールバック：生テキストを summary に入れる
      result = {
        directAnswer: '',
        summary: rawContent.length > 500 ? rawContent.substring(0, 500) + '…' : rawContent,
        issues: [],
        nextActions: [],
        supportDraft: '詳細はAIの回答をご参照ください',
        reviewSignal: '内容をご確認のうえ、判断してください',
      };
    }

    console.log('[assist-execution]', requestId, 'success', {
      summaryLength: result.summary.length,
      issuesCount: result.issues.length,
      nextActionsCount: result.nextActions.length,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (e: any) {
    console.error('[assist-execution]', requestId, 'ERROR', {
      name: e?.name,
      message: e?.message,
      status: e?.status,
    });

    // エラー時も構造化レスポンスを返す
    return NextResponse.json(
      {
        directAnswer: '',
        summary: 'AI整理処理に一時的なエラーが発生しました。メモの内容は保存できますので、ご確認ください。',
        issues: [],
        nextActions: [],
        supportDraft: '',
        reviewSignal: '内容をご確認のうえ、判断してください',
        error: true,
        requestId,
      },
      { status: 200 } // 200 を返してフロント側でエラーハンドリング
    );
  }
}
