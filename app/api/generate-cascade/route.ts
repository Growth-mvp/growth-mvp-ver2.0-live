import { NextRequest, NextResponse } from "next/server";
import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      vision,
      industry,
      revenue,
      employees,
      strength,
      weakness,
      opportunity,
      threat,
      story,
      departments, // ← 追加（ユーザー手入力部門）
    } = body;

    const departmentNames = departments?.map((d: any) => d.name).filter(Boolean).join("、") || "";

    const prompt = `
あなたは経営コンサルタントです。

以下の経営情報をもとに、戦略カスケード構造（4階層）をJSON形式で生成してください：

・経営戦略（summary）
・部門戦略（指定された部門名のみを使用）
・プロジェクト（各部門に1〜3件）
・OKR（各プロジェクトに1〜2件、ObjectiveとKey Resultの配列）

【業種】：${industry}
【売上】：${revenue}
【従業員数】：${employees}
【経営者の思い】：${vision}
【SWOT】
強み：${strength}
弱み：${weakness}
機会：${opportunity}
脅威：${threat}
【戦略ストーリー】：${story}

【使用すべき部門名】：${departmentNames}
※上記の部門名を必ず使ってください。新しい部門名は追加しないでください。

出力形式（JSON）：
{
  "strategy": {
    "summary": "..."
  },
  "departments": [
    {
      "name": "...",
      "strategy": "...",
      "projects": [
        {
          "name": "...",
          "description": "...",
          "okrs": [
            {
              "objective": "...",
              "keyResults": ["...", "..."]
            }
          ]
        }
      ]
    }
  ]
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const text = completion.choices[0].message.content || "";
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    const jsonText = text.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(jsonText);

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("生成エラー:", error);
    return NextResponse.json({ error: "生成に失敗しました。" }, { status: 500 });
  }
}
