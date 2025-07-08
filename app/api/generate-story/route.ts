import { NextRequest, NextResponse } from 'next/server';
import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const {
      vision,
      industry,
      revenue,
      employees,
      strength,
      weakness,
      opportunity,
      threat,
      csvFinanceData,
    } = await req.json();

    // 財務情報があれば、プロンプトに含める
    const financialSummary = csvFinanceData?.length
      ? `\n\n【参考財務データ（CSVアップロード）】\n${csvFinanceData
          .map((row: any) => Object.values(row).join(' / '))
          .join('\n')}`
      : '';

    const prompt = `
あなたは経営戦略の専門家です。
以下の情報をもとに、社員が理解できるような戦略ストーリーを4つの章に分けて生成してください。

【ビジョン・事業背景】
- 業種: ${industry}
- 売上高: ${revenue} 百万円
- 従業員数: ${employees} 人
- ビジョン: ${vision}

【SWOT分析】
- 強み: ${strength}
- 弱み: ${weakness}
- 機会: ${opportunity}
- 脅威: ${threat}

${financialSummary}

【出力フォーマット】
### ① 現状の危機や背景（なぜ今、変革が必要なのか）
...

### ② 経営者が描く未来の方向性（どこを目指すのか）
...

### ③ SWOTに基づいた戦略的な選択（強み×機会などのクロス分析を含む）
...

### ④ 社員に求める行動や期待（自分ごととして捉えてもらう）
...
`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });

    const story = completion.choices[0]?.message?.content;

    return NextResponse.json({ story });
  } catch (error) {
    console.error('❌ AIストーリー生成エラー:', error);
    return NextResponse.json({ error: 'ストーリー生成に失敗しました' }, { status: 500 });
  }
}
