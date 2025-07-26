import { NextRequest, NextResponse } from 'next/server';
import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: NextRequest) {
  try {
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
    } = body;

    const financialSummary =
      Array.isArray(csvFinanceData) && csvFinanceData.length > 0
        ? `\n\n【参考財務データ】\n${csvFinanceData
            .map((row: any) => Object.values(row).join(' / '))
            .join('\n')}`
        : '';

    const storyPrompt = `
あなたは経営戦略の専門家であり、社員に対して「やさしく、情熱をもって」経営戦略を伝える役割を担っています。
以下の経営情報をもとに、社員が納得して動きたくなるような、4章構成のストーリー（たたき台）を作成してください。

【出力トーンと形式】
- 口調：「社員に語りかける口調」
- 文体：やさしく、情熱をもって
- 表現：難解な用語は避け、できるだけ平易な言葉で
- 各章は必ず「■」で始めること

【経営者の思い】
${thought || '（経営者の思いが未入力）'}

【会社概要】
- 業種: ${industry}
- 売上高: ${revenue} 百万円
- 従業員数: ${employees} 人

【MVV（ミッション・ビジョン・バリュー）】
- Mission: ${mission}
- Vision: ${vision}
- Value: ${value}

【SWOT分析】
- 強み: ${strength}
- 弱み: ${weakness}
- 機会: ${opportunity}
- 脅威: ${threat}
${financialSummary}

【出力フォーマット（必ずすべて出力してください）】
■現状の危機や背景（なぜ今、変革しなければならないのか）
・会社が直面している外部環境・業界動向・財務課題・人材課題などを踏まえ、「このままでは成長が止まる／生き残れない」という危機感を社員が理解できるように、事実と感情の両面から語ってください。
・抽象論ではなく、具体的な「数字」や「変化」「競合の動き」も含めてください。

■経営者が描く未来の方向性（どこを目指すのか）
・会社が目指す理想の姿、実現したい未来像をわかりやすく伝えてください。

■SWOTに基づいた戦略的な選択（強み×機会などのクロス分析を含む）
・SWOTを組み合わせた戦略オプションを具体的に提案してください。

■社員に求める行動や期待（自分ごととして捉えてもらう）
・この戦略は一部の社員ではなく、全社員が一丸となって取り組む必要があります。
・競争力を早期に高め、成長を実現するためには、実行の「ボリューム」と「スピード」を高めることが重要です。
・全員が自分の業務の中で戦略をどう実行に移すかを考え、日々の判断や行動に反映させてください。
`.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: storyPrompt }],
      temperature: 0.7,
      max_tokens: 2000, // 出力長さを明示
    });

    const generatedStory = completion.choices?.[0]?.message?.content?.trim();

    if (!generatedStory || generatedStory.length < 100) {
      console.error('⚠️ ストーリー出力が不完全:', generatedStory);
      return NextResponse.json(
        { error: 'AIからの出力が不完全でした' },
        { status: 500 }
      );
    }

    console.log('✅ たたき台ストーリー出力成功');
    return NextResponse.json({ story: generatedStory });
  } catch (error: any) {
    console.error('❌ ストーリー生成エラー:', error?.message || error);
    return NextResponse.json(
      { error: 'ストーリーたたき台の生成に失敗しました' },
      { status: 500 }
    );
  }
}
