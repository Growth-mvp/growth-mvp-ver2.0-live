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
    } = await req.json();

    const financialSummary =
      Array.isArray(csvFinanceData) && csvFinanceData.length > 0
        ? `\n\n【参考財務データ（CSVアップロード）】\n${csvFinanceData
            .map((row: any) => Object.values(row).join(' / '))
            .join('\n')}`
        : '';

    // --- 1. 戦略ストーリー生成プロンプト ---
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

【出力フォーマット】
以下の4章構成で、各章の見出しは必ず「■」から始めてください。全ての章を出力してください。

■現状の危機や背景（なぜ今、変革が必要なのか）
...

■経営者が描く未来の方向性（どこを目指すのか）
...

■SWOTに基づいた戦略的な選択（強み×機会などのクロス分析を含む）
...

■社員に求める行動や期待（自分ごととして捉えてもらう）
この章では、社員にとっての意味や意義に加えて、
必ず「3つ以上の具体的な行動例」を提示してください。
例：「週に1回、業務改善提案を提出」「毎月1件の新規顧客開拓」「定例会でKPI進捗を共有する」など
`.trim();

    const storyCompletion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: storyPrompt }],
      temperature: 0.7,
    });

    const story = storyCompletion.choices[0]?.message?.content?.trim() || '';

    // --- 2. 要約生成プロンプト（社員が最初に読む用） ---
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
