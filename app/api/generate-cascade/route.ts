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
あなたは世界最高の経営戦略コンサルタントです。以下の経営情報をもとに、部門ごとの戦略ミッションとプロジェクト案を簡潔に提案してください。

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

--- 出力フォーマット（日本語のJSONのみ、説明なし） ---

{
  "strategy": {
    "summary": "会社全体の経営戦略要約"
  },
  "departments": [
    {
      "name": "部門名",
      "missionDraft": "この部門の戦略ミッション案",
      "projects": [
        {
          "title": "プロジェクト名",
          "reason": "目的・ねらい・達成の姿勢など"
        }
      ]
    }
  ]
}
`.trim();

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

    let parsed: any = null;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('JSON形式が見つかりません');
      parsed = JSON.parse(jsonMatch[0]);
    } catch (jsonError) {
      console.error('⚠️ JSON解析エラー:', jsonError);
      console.error('⚠️ GPT出力:', content);
      return NextResponse.json(
        { error: '生成結果のJSON解析に失敗しました。' },
        { status: 500 }
      );
    }

    // 構造の整合性チェック・補完
    const result = {
      strategy: parsed.strategy || { summary },
      departments: Array.isArray(parsed.departments)
        ? parsed.departments
            .filter((d: any) => departments.some((orig: any) => orig.name === d.name))
            .map((d: any) => ({
              name: d.name,
              missionDraft: d.missionDraft || '',
              projects: Array.isArray(d.projects)
                ? d.projects.map((p: any) => ({
                    title: p.title,
                    reason: p.reason || '',
                  }))
                : [],
            }))
        : [],
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error('❌ APIエラー（generate-cascade）:', err);
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました。' },
      { status: 500 }
    );
  }
}
