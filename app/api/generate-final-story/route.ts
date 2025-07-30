import { OpenAI } from 'openai';
import { NextRequest, NextResponse } from 'next/server';

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
        ? `\n\n【参考財務データ】\n${csvFinanceData
            .map((row: any) => Object.values(row).join(' / '))
            .join('\n')}`
        : '';

    const deepInsight = `【社員の生の声・深掘り回答】

第1ラウンド回答（たたき台を踏まえた感想）:
${Array.isArray(answers)
  ? answers.map((a: string, i: number) => `Q${i + 1}: ${a}`).join('\n')
  : '（未回答）'}

第2ラウンド（章ごとの深掘りQ&A）:
${Array.isArray(answers2)
  ? answers2
      .map((chapterObj: any, chapterIndex: number) => {
        const title = chapterObj?.chapterTitle || `第${chapterIndex + 1}章`;
        const steps = Array.isArray(chapterObj?.steps) ? chapterObj.steps : [];
        const qaText = steps
          .map(
            (step: any, i: number) =>
              `  Q${i + 1}: ${step?.question || '（質問不明）'}\n  A${i + 1}: ${
                step?.answer || '（未回答）'
              }`
          )
          .join('\n');
        return `■${title}\n${qaText}`;
      })
      .join('\n\n')
  : '（深掘り回答なし）'}
`;

    const storyPrompt = `
あなたは優れた経営ストーリーテラーです。以下の情報をもとに、社員に深く響く経営戦略ストーリーを作成してください。

【経営者の思い】
${thought || '（未入力）'}

【会社概要】
- 業種: ${industry || '未入力'}
- 売上高: ${revenue || '未入力'} 百万円
- 従業員数: ${employees || '未入力'} 人

【MVV（ミッション・ビジョン・バリュー）】
- Mission: ${mission || '未入力'}
- Vision: ${vision || '未入力'}
- Value: ${value || '未入力'}

【SWOT分析】
- 強み: ${strength || '未入力'}
- 弱み: ${weakness || '未入力'}
- 機会: ${opportunity || '未入力'}
- 脅威: ${threat || '未入力'}
${financialSummary}
${deepInsight}

【出力形式】
以下の4章構成で、各章の見出しは必ず「■」で始めてください。

■現状の危機や背景
■目指す方向性
■SWOTに基づいた戦略的な選択
■社員に求める行動や期待

・抽象論ではなく、社員の現実に響く具体性と納得感を重視してください。
・各章を自然な流れでつなげ、1つの物語のように仕上げてください。
`;

    const storyResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: storyPrompt }],
      temperature: 0.7,
    });

    const storyText = storyResponse.choices[0]?.message?.content?.trim() || '';

    const storyChapters =
      storyText.match(/■[^\n]+\n[\s\S]*?(?=(■[^\n]+\n)|$)/g)?.map((section: string) => {
        const [titleLine, ...bodyLines] = section.trim().split('\n');
        return {
          title: titleLine.replace(/^■/, '').trim(),
          body: bodyLines.join('\n').trim(),
        };
      }) || [];

    const summaryPrompt = `
以下のストーリーを読んで、社員が最初に読む「要約文（200文字以内）」を1文で作成してください。

${storyText}
`;

    const summaryResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: summaryPrompt }],
      temperature: 0.5,
    });

    const summary = summaryResponse.choices[0]?.message?.content?.trim() || '要約なし';

    return NextResponse.json({
      story: storyChapters,
      summary,
    });
  } catch (error: any) {
    console.error('❌ 最終ストーリー生成エラー:', error);
    return NextResponse.json(
      { error: '最終ストーリーの生成に失敗しました' },
      { status: 500 }
    );
  }
}
