import { NextRequest, NextResponse } from 'next/server';
import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const titleTemplates = [
  '第1章：現状の危機や背景（なぜ今、変革しなければならないのか）',
  '第2章：経営者が描く未来の方向性（どこを目指すのか）',
  '第3章：SWOTに基づいた戦略的な選択（強み×機会などのクロス分析を含む）',
  '第4章：社員に求める行動や期待（自分ごととして捉えてもらう）',
];

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
■経営者が描く未来の方向性（どこを目指すのか）
■SWOTに基づいた戦略的な選択（強み×機会などのクロス分析を含む）
■社員に求める行動や期待（自分ごととして捉えてもらう）
`.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: storyPrompt }],
      temperature: 0.7,
      max_tokens: 2000,
    });

    const generatedStory = completion.choices?.[0]?.message?.content?.trim();

    if (!generatedStory || generatedStory.length < 100) {
      console.error('⚠️ ストーリー出力が不完全:', generatedStory);
      return NextResponse.json(
        { error: 'AIからの出力が不完全でした' },
        { status: 500 }
      );
    }

    // 「■」で分割 → 各章ごとにパース
    const rawSections = generatedStory.split('■').map((s) => s.trim()).filter(Boolean);

    const story = rawSections.slice(0, 4).map((body, idx) => ({
      title: titleTemplates[idx] || `第${idx + 1}章`,
      body,
    }));

    console.log('✅ たたき台ストーリー出力成功');
    return NextResponse.json({ story });
  } catch (error: any) {
    console.error('❌ ストーリー生成エラー:', error?.message || error);
    return NextResponse.json(
      { error: 'ストーリーたたき台の生成に失敗しました' },
      { status: 500 }
    );
  }
}
