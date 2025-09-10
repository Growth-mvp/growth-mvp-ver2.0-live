// /app/api/generate-cascade/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { industryTemplates } from '@/utils/industryTemplates';
import { toTextStory, extractJsonObject, sanitizeText } from '@/app/api/_shared/utils';
import { z } from 'zod';

/* =========================
 * スキーマ（AI応答の検証用）
 * ======================= */
const ProjectSchema = z.object({
  title: z.string().min(1).catch(''),
  reason: z.string().default(''),
});

const DepartmentSchema = z.object({
  name: z.string().min(1).catch(''),
  missionDraft: z.string().default(''),
  projects: z.array(ProjectSchema).default([]),
});

const ResponseSchema = z.object({
  strategy: z
    .object({
      summary: z.string().default(''),
    })
    .default({ summary: '' }),
  departments: z.array(DepartmentSchema).default([]),
});

/* =========================
 * 小ユーティリティ
 * ======================= */
const toLinesFromCsv = (csvRows: any[], limit = 5) =>
  csvRows
    .slice(0, limit)
    .map((row: any, i: number) =>
      `【${i + 1}行目】 ${Object.entries(row)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')}`
    )
    .join('\n');

function onlyDeptNames(list: any[]): string[] {
  return (list || [])
    .map((d) => (typeof d?.name === 'string' ? d.name.trim() : ''))
    .filter(Boolean);
}

/* =========================
 * ハンドラ
 * ======================= */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

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
    } = body ?? {};

    // 前提チェック
    if (!Array.isArray(departments) || departments.length === 0) {
      return NextResponse.json(
        { error: '部門情報が未入力です。カスケード生成できません。' },
        { status: 400 }
      );
    }

    const storyText = toTextStory(story);
    const hasValidInput =
      (typeof strategySummary === 'string' && strategySummary.trim().length > 0) ||
      (typeof storyText === 'string' && storyText.trim().length > 0);
    if (!hasValidInput) {
      return NextResponse.json(
        { error: '経営戦略ストーリーと要約の両方が空です。どちらかを入力してください。' },
        { status: 400 }
      );
    }

    // 文字数・プロンプト組み立て
    const summary = (strategySummary?.trim() || storyText.slice(0, 160) || '（要約なし）');
    const financeText = Array.isArray(csvFinanceData) && csvFinanceData.length > 0
      ? toLinesFromCsv(csvFinanceData, 5)
      : '（財務データなし）';

    const departmentNames = onlyDeptNames(departments).join(', ');
    const industryContext = (industry && industryTemplates?.[industry]) || '';

    const prompt = `
あなたは世界最高の経営戦略コンサルタントです。以下の経営情報をもとに、部門ごとの戦略ミッションとプロジェクト案を簡潔に提案してください。

【業界背景・成功パターン】
${industryContext || '（該当テンプレートなし）'}

【経営者の想い】
${thought || '（未入力）'}

【MVV】
Mission: ${mission ?? ''}
Vision: ${vision ?? ''}
Value: ${value ?? ''}

【SWOT分析】
- 強み: ${strength ?? ''}
- 弱み: ${weakness ?? ''}
- 機会: ${opportunity ?? ''}
- 脅威: ${threat ?? ''}

【業種・売上・従業員数】
${industry ?? '（不明）'}、年商${revenue ?? '（不明）'}百万円、従業員${employees ?? '（不明）'}人

【CSV財務情報（参考）】
${financeText}

【経営戦略のストーリー（抜粋）】
${sanitizeText(storyText, 800) || '（ストーリー未入力）'}

【要約（参考）】
${summary}

【対象部門】
${departmentNames}

--- 出力フォーマット（日本語のJSONのみ、説明なし） ---
{
  "strategy": { "summary": "会社全体の経営戦略要約（2〜3文）" },
  "departments": [
    {
      "name": "部門名（入力に存在するもののみ）",
      "missionDraft": "この部門の戦略ミッション案（1〜2文。数値・指標があれば尚可）",
      "projects": [
        { "title": "プロジェクト名（名詞句）", "reason": "目的・ねらい・期待成果（1文）" }
      ]
    }
  ]
}
`.trim();

    /* ========== OpenAI 呼び出し ========== */
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.5,
      // 念のための最大トークン（JSONのみなので控えめ）
      max_tokens: 1000,
      messages: [
        { role: 'system', content: '必ずJSONのみを返し、日本語で。前後の説明は禁止。' },
        { role: 'user', content: prompt },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content || '';
    const parsed = extractJsonObject(raw);

    if (!parsed) {
      return NextResponse.json(
        { error: '生成結果のJSON解析に失敗しました。' },
        { status: 500 }
      );
    }

    // まずはスキーマで整形
    const safe = ResponseSchema.safeParse(parsed);
    if (!safe.success) {
      // 解析できたが形が不完全な場合でも極力整えて返す
      console.warn('generate-cascade: schema validation errors:', safe.error?.issues);
    }
    const normalized = (safe.success ? safe.data : parsed) as z.infer<typeof ResponseSchema>;

    // 入力部門名に含まれるものだけフィルタ
    const inputNames = new Set(onlyDeptNames(departments));
    const result = {
      strategy: {
        summary:
          typeof normalized?.strategy?.summary === 'string'
            ? normalized.strategy.summary
            : summary,
      },
      departments: Array.isArray(normalized?.departments)
        ? normalized.departments
            .map((d: any) => ({
              name: typeof d?.name === 'string' ? d.name.trim() : '',
              missionDraft: typeof d?.missionDraft === 'string' ? d.missionDraft.trim() : '',
              projects: Array.isArray(d?.projects)
                ? d.projects
                    .map((p: any) => ({
                      title: typeof p?.title === 'string' ? p.title.trim() : '',
                      reason: typeof p?.reason === 'string' ? p.reason.trim() : '',
                    }))
                    .filter((p: any) => p.title)
                : [],
            }))
            .filter((d: any) => d.name && inputNames.has(d.name))
        : [],
    };

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('❌ APIエラー（generate-cascade）:', err?.message || err);
    // OpenAI からのエラー内容を軽くマスクして返す（内部情報を漏らさない）
    return NextResponse.json({ error: 'サーバーエラーが発生しました。' }, { status: 500 });
  }
}
