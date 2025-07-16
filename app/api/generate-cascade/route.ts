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

    // ✅ 入力チェック
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
あなたは経営戦略の専門家です。
以下の経営情報をもとに、経営戦略を部門戦略→プロジェクト→OKRへと分解してください。

【業界背景・成功戦略パターン】
${industryContext}

【経営戦略の要約】
${summary}

【経営者の思い】
${thought || '（経営者の思いが未入力です）'}

【経営戦略のストーリー】
${story || '（ストーリー未入力）'}

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
${departmentNames}

上記の情報をもとに、以下の形式で**純粋なJSONのみを返してください**。
前後に説明文を絶対に含めないでください。
すでに記載されている部門名以外は絶対に追加・変更しないでください。

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
}`.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'あなたは優秀な戦略コンサルタントです。必ずJSON形式のみを返し、説明文は一切含めてはいけません。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
    });

    const content = completion.choices?.[0]?.message?.content || '';
    console.log('🔵 GPT生データ:', content);

    let json = null;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('JSON形式が見つかりません');
      const jsonString = jsonMatch[0];
      json = JSON.parse(jsonString);

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
