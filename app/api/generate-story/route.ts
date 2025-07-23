import { NextRequest, NextResponse } from 'next/server';
import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: NextRequest) {
  try {
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
      answers,
      answers2,
    } = await req.json();

    const financialSummary =
      Array.isArray(csvFinanceData) && csvFinanceData.length > 0
        ? `\n\n【参考財務データ（CSVアップロード）】\n${csvFinanceData
            .map((row: any) => Object.values(row).join(' / '))
            .join('\n')}`
        : '';

    const deepInsight = `\n\n【社員の生の声・深掘り回答】\n第1ラウンド回答:\n${(answers || [])
      .map((a: string, i: number) => `Q${i + 1}: ${a}`)
      .join('\n')}\n\n第2ラウンド回答:\n${(answers2 || [])
      .map((a: string, i: number) => `Q${i + 1}: ${a}`)
      .join('\n')}`;

    const storyPrompt = `
あなたは経営戦略の専門家であり、社員に対して「やさしく、わかりやすく」経営戦略をストーリーとして伝える役割です。
以下の経営情報をもとに、4章構成の戦略ストーリーを作成してください。

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
${deepInsight}

【出力フォーマット】
以下の4章構成で、各章の見出しは必ず「■」から始めてください。全ての章を出力してください。

■現状の危機や背景（なぜ今、変革しなければならないのか）
・この章では、会社が直面している外部環境・業界動向・財務課題・人材課題などを踏まえ、
　「このままでは成長が止まる／生き残れない」という危機感を社員が理解できるように、
　事実と感情の両面から語ってください。
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

    const storyCompletion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: storyPrompt }],
      temperature: 0.7,
    });

    const story = storyCompletion.choices[0]?.message?.content?.trim() || '';

    const summaryPrompt = `
以下の戦略ストーリーを読んで、社員に最初に読ませる「経営戦略の要約（200文字以内）」を1文で作ってください。

${story}
`.trim();

    const summaryCompletion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: summaryPrompt }],
      temperature: 0.5,
    });

    const summary = summaryCompletion.choices[0]?.message?.content?.trim() || '要約なし';

    return NextResponse.json({ story, summary });
  } catch (error) {
    console.error('❌ AIストーリー生成エラー:', error);
    return NextResponse.json(
      { error: 'ストーリー生成に失敗しました' },
      { status: 500 }
    );
  }
}