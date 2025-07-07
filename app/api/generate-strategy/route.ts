import { NextRequest, NextResponse } from "next/server";
import { OpenAI } from "openai";
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
      thought,
      mission,
      visionStatement,
      value,
      departments,
    } = body;

    // ✅ GPT用プロンプトに使用する部門名一覧
    const departmentNames = departments?.map((d: any) => d.name).filter(Boolean).join("、") || "";

    const prompt = `
あなたは大手企業向けの戦略コンサルタントです。

以下の経営情報をもとに、組織の変革を実現するためのカスケード構造を設計してください。
目的は「現場のマネージャーが納得し、実際のプロジェクトに落とし込み、チームメンバーが行動できるほど具体的で説得力のある構造」にすることです。

◉ 必ず以下の構造を含めてください：
- 経営戦略（summary）：方向性と狙いの背景を含めて明確に
- 部門戦略（指定された部門名のみ）：部門の役割・貢献目標を明示
- プロジェクト（各部門に1〜3件）：実際の現場行動としての施策を記述
- OKR（各プロジェクトにObjective1件、KeyResults2〜3件）：測定可能な行動指標で表現

◉ 可能な限り現実的・具体的な内容にしてください。
- 抽象的なキーワード（例：DX、グローバル化）だけではなく、「どこで・誰が・何を・どうする」を意識
- OKRは現場の社員が読んで「これなら実行できる」と思える粒度に
- 強み・弱み・機会・脅威を反映した戦略上の焦点が伝わること

【経営者の思い】
${thought}

【業種】：${industry}
【売上】：${revenue}億円
【社員数】：${employees}名

【MVV】
ミッション：${mission}
ビジョン：${visionStatement}
バリュー：${value}

【SWOT】
強み：${strength}
弱み：${weakness}
機会：${opportunity}
脅威：${threat}

【使用すべき部門名】：${departmentNames}
※上記の部門名のみを使用してください。GPTが勝手に新しい部門名を作らないようにしてください。
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

    // ✅ Supabase保存には「元の部門名（ユーザー入力）」を使う
    const { error } = await supabase.from("strategies").insert([
      {
        thought,
        industry,
        revenue,
        employees,
        mission,
        vision: visionStatement,
        value,
        strength,
        weakness,
        opportunity,
        threat,
        story,
        strategy: parsed.strategy,
        departments, // ← ここが修正ポイント（GPT出力ではなく元の入力）
      },
    ]);

    if (error) {
      console.error("❌ Supabase保存エラー:", error);
    }

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("生成エラー:", error);
    return NextResponse.json({ error: "生成に失敗しました。" }, { status: 500 });
  }
}
