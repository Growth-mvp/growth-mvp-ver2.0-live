import { NextRequest, NextResponse } from 'next/server';
import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const {
      vision,
      mission,
      industry,
      revenue,
      employees,
      value,
      strength,
      weakness,
      opportunity,
      threat,
      story,
      departments,
      csvFinanceData,
    } = await req.json();

    const financeText = csvFinanceData && Array.isArray(csvFinanceData)
      ? csvFinanceData
          .slice(0, 5)
          .map((row: any, i: number) =>
            `【${i + 1}行目】 ${Object.entries(row)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ')}`)
          .join('\n')
      : '（財務データなし）';

    const prompt = `
あなたは経営戦略の専門家です。
以下の経営情報をもとに、経営戦略を部門戦略→プロジェクト→OKRへと分解してください。

【経営者の思い】
${story}

【業界・規模】
業種: ${industry}, 売上: ${revenue}百万円, 従業員数: ${employees}人

【MVV】
Mission: ${mission}
Vision: ${vision}
Value: ${value}

【SWOT分析】
Strength: ${strength}
Weakness: ${weakness}
Opportunity: ${opportunity}
Threat: ${threat}

【CSV財務データ（参考）】
${financeText}

【部門名一覧】
${departments.map((d: any) => d.name).join(', ')}

上記の情報をもとに、以下の形式で**純粋なJSONのみを返してください**。
前後に説明文を絶対に含めないでください。

{
  "strategy": {
    "summary": "全体経営戦略をここに記述"
  },
  "departments": [
    {
      "name": "部門名",
      "strategy": "部門戦略の要約",
      "projects": [
        {
          "name": "プロジェクト名",
          "description": "目的や概要",
          "okrs": [
            {
              "objective": "O: 目標",
              "keyResults": [
                "KR1: 定量的指標1",
                "KR2: 定量的指標2"
              ]
            }
          ]
        }
      ]
    }
  ]
}
    `.trim();

    const chatCompletion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'あなたは優秀な戦略コンサルタントであり、必ずJSON形式のみで回答します。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
    });

    const content = chatCompletion.choices[0].message.content;

    let json = null;
    try {
      if (content) {
        // 最初の { から 最後の } までを抽出して JSON.parse
        const start = content.indexOf('{');
        const end = content.lastIndexOf('}');
        const jsonString = content.substring(start, end + 1);
        json = JSON.parse(jsonString);
      }
    } catch (jsonError) {
      console.error('⚠️ JSON解析エラー:', jsonError);
      console.error('⚠️ OpenAIからの出力:', content);
      return NextResponse.json(
        { error: '生成結果のJSON解析に失敗しました。' },
        { status: 500 }
      );
    }

    return NextResponse.json(json || {});
  } catch (err) {
    console.error('❌ APIエラー:', err);
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました。' },
      { status: 500 }
    );
  }
}
