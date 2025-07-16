import { NextRequest, NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import { industryTemplates } from '@/utils/industryTemplates';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const {
      thought,
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
      strategySummary,
      departments,
      csvFinanceData,
    } = await req.json();

    if (!Array.isArray(departments) || departments.length === 0) {
      return NextResponse.json(
        { error: '部門情報が未入力です。カスケード生成できません。' },
        { status: 400 }
      );
    }

    const hasValidInput = !!(story?.trim() || strategySummary?.trim());
    if (!hasValidInput) {
      return NextResponse.json(
        { error: '経営戦略ストーリーと要約の両方が空です。どちらかを入力してください。' },
        { status: 400 }
      );
    }

    const summary = strategySummary?.trim() || story?.trim()?.slice(0, 100) || '（要約なし）';

    const financeText =
      Array.isArray(csvFinanceData) && csvFinanceData.length > 0
        ? csvFinanceData
            .slice(0, 5)
            .map((row: any, i: number) =>
              `【${i + 1}行目】 ${Object.entries(row)
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ')}`
            )
            .join('\n')
        : '（財務データなし）';

    const departmentNames = departments.map((d: any) => d.name).join(', ');
    const industryContext = industryTemplates[industry] || '';

    const prompt = `
あなたは世界最高の経営戦略コンサルタントです。以下の経営情報をもとに、経営戦略 → 部門戦略 → プロジェクト → OKR の順にロジカルに分解してください。

【業界背景・成功パターン】
${industryContext}

【経営者の想い】
${thought || '（未入力）'}

【MVV】
Mission: ${mission}
Vision: ${vision}
Value: ${value}

【SWOT分析】
- 強み: ${strength}
- 弱み: ${weakness}
- 機会: ${opportunity}
- 脅威: ${threat}

【業種・売上・従業員数】
${industry}、年商${revenue}百万円、従業員${employees}人

【CSV財務情報（参考）】
${financeText}

【経営戦略のストーリー（抜粋）】
${story?.slice(0, 500) || '（ストーリー未入力）'}

【要約】
${summary}

【対象部門】
${departmentNames}

以下の形式に厳密に従って、**日本語の純粋なJSON**のみを返してください。前後に説明は不要です。既存の部門名以外は出力しないでください。

{
  "strategy": {
    "summary": "会社全体の経営戦略要約（現状の危機・方向性・優先課題など）"
  },
  "departments": [
    {
      "name": "部門名",
      "strategy": "この部門が担うべき戦略的役割を明確に記述",
      "projects": [
        {
          "name": "プロジェクト名（戦略推進のための活動名）",
          "description": "このプロジェクトの目的・ねらい・達成姿勢などを簡潔に記述",
          "okrs": [
            {
              "objective": "O: プロジェクトの定性的な達成目標",
              "keyResults": [
                "KR1: 測定可能な成果指標1",
                "KR2: 測定可能な成果指標2"
              ]
            }
          ]
        }
      ]
    }
  ]
}`.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'あなたは有能な経営戦略コンサルタントです。必ずJSON形式のみを返し、日本語で記述し、前後の説明文は禁止です。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.6,
    });

    const content = completion.choices?.[0]?.message?.content || '';
    console.log('🟢 GPT出力:', content);

    let json = null;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('JSON形式が見つかりません');
      json = JSON.parse(jsonMatch[0]);

      if (!json.strategy || !json.strategy.summary) {
        json.strategy = { summary };
      }
    } catch (jsonError) {
      console.error('⚠️ JSON解析エラー:', jsonError);
      console.error('⚠️ GPT出力:', content);
      return NextResponse.json(
        { error: '生成結果のJSON解析に失敗しました。' },
        { status: 500 }
      );
    }

    return NextResponse.json(json || {});
  } catch (err) {
    console.error('❌ APIエラー（generate-cascade）:', err);
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました。' },
      { status: 500 }
    );
  }
}
