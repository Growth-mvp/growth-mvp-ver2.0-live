import { OpenAI } from 'openai';
import { NextResponse } from 'next/server';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const { chapterTitle, chapterBody, previousAnswer, stepNumber } = await req.json();
    console.log(`📥 受信章: ${chapterTitle}, ステップ: ${stepNumber}`);

    if (
      typeof chapterTitle !== 'string' ||
      typeof chapterBody !== 'string' ||
      typeof stepNumber !== 'number'
    ) {
      return NextResponse.json({ error: '必要なパラメータが不足しています' }, { status: 400 });
    }

    const promptsByChapter: Record<string, string> = {
      '現状の危機や背景': '経営者が社員にもっと感じてほしい危機的な状況とは何か？その本質的な意味を問い直す深い問いを設計してください。たとえば、現状の放置がもたらすリスク、競争優位の喪失、顧客離れなどの視点を盛り込んでください。',
      '経営者が描く未来の方向性': '未来像がなぜ魅力的なのか、なぜ今それを目指すのかを社員が内省し、共感を深められる問いを設計してください。たとえば、「その未来が実現すれば、顧客・社会・自分たちはどう変わるのか？」など。',
      'SWOTに基づいた戦略的な選択': 'なぜこの戦略が選ばれたのか？他の選択肢はなぜ選ばれなかったのか？という背景を社員が理解できる問いを設計してください。たとえば、「強みが活きる市場機会とは？」「最大の脅威をどう乗り越えるべきか？」など。',
      '社員に求める行動や期待': '社員にどのように行動してほしいのか、それが戦略とどうつながるのかを社員が自問自答できる問いを設計してください。たとえば、「自分の持ち場で起こせる変革とは？」「自分の担うべき役割とは？」など。',
    };

    const extraPrompt =
      Object.entries(promptsByChapter).find(([key]) => chapterTitle.includes(key))?.[1] ??
      'この章に関連する本質的な問いを設計してください。';

    const prompt = `
あなたはドラッカーのような経営思想家です。
この問いは、経営層（経営者や部門長）が自身の考えを深め、組織の方向性や意思決定の背景を言語化するための問いです。
表面的な問いではなく、「なぜ？」「どうして？」「背景は？」「具体的には？」という視点から思考を深掘りさせてください。

【章タイトル】
${chapterTitle}

【章の内容】
${chapterBody}

${stepNumber > 1 && previousAnswer
  ? `【直前の経営層の回答】\n${previousAnswer}\n\nこの回答を起点として、さらに深い洞察を促す問いを1問だけ作成してください。`
  : `${extraPrompt}\n\nこの章を深く理解させる問いを1問だけ作成してください。`
}

問いは、曖昧なスローガンではなく、構造的・本質的な経営課題に踏み込むものであること。
回答者が「本当にそうか？なぜそうなのか？」と立ち止まり、言語化したくなる問いにしてください。

【出力形式】
{
  "question": "～～～？",
  "reason": "～～～だからこの問いが重要"
}`.trim();

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'あなたは問いを設計するプロフェッショナルです。出力は必ず厳密なJSON形式（{ question, reason }）で返してください。補足や説明は禁止です。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
    });

    const raw = response.choices?.[0]?.message?.content ?? '{}';
    console.log(`📄 生成された問い:`, raw);

    let parsed: { question: string; reason: string };
    try {
      const jsonStart = raw.indexOf('{');
      const jsonEnd = raw.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error('JSONの開始/終了位置が見つかりません');
      }
      const jsonText = raw.slice(jsonStart, jsonEnd + 1);
      parsed = JSON.parse(jsonText);

      if (!parsed.question || !parsed.reason) {
        throw new Error('question または reason が不足');
      }

      parsed = {
        question: parsed.question ?? '質問の生成に失敗しました',
        reason: parsed.reason ?? 'AIから正しい理由が返りませんでした',
      };
    } catch (err) {
      console.warn('❗️JSONパース失敗:', raw);
      return NextResponse.json({ error: 'AI出力形式が不正です' }, { status: 500 });
    }

    return NextResponse.json({
      step: {
        stepNumber,
        question: parsed.question,
        reason: parsed.reason,
        answer: '',
      },
    });
  } catch (error) {
    console.error('❌ 単一質問生成エラー:', error);
    return NextResponse.json({ error: '質問生成に失敗しました' }, { status: 500 });
  }
}
