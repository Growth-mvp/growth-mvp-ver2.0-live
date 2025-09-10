// /app/api/generate-projects-only/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { toTextStory, sanitizeText, extractJsonObject } from '@/app/api/_shared/utils';

export async function POST(req: NextRequest) {
  try {
    const { departmentName, mission, story } = await req.json();

    const storyText = toTextStory(story);
    const dept = typeof departmentName === 'string' ? departmentName.trim() : '';
    const missionText = typeof mission === 'string' ? mission.trim() : '';

    if (!dept || !missionText || !storyText.trim()) {
      return NextResponse.json(
        { error: '必要な情報が不足しています（部門名、ミッション、ストーリー）' },
        { status: 400 }
      );
    }

    const prompt = `
以下は企業の経営戦略ストーリーです：

---
${sanitizeText(storyText, 2000)}
---

この戦略と以下の部門ミッションに基づき、「${dept}」部門で注力すべき**実行可能な**プロジェクト案を3〜5件、簡潔な名詞句で提案してください。

【部門ミッション】
${sanitizeText(missionText, 800)}

# 出力要件
- 日本語
- JSONのみ。前後の説明文・コードフェンスは禁止
- 形式: {"projects":["...", "...", "..."] }
- 各タイトルは重複させず、実務でそのまま使えるレベルで具体的に
`.trim();

    // JSON固定で生成
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'あなたは有能な経営コンサルタントです。必ずJSONのみを返します。' },
        { role: 'user', content: prompt },
      ],
    });

    // 1) 期待：純JSON  2) 念のため：フォールバック抽出
    const raw = completion.choices?.[0]?.message?.content || '';
    let parsed = extractJsonObject(raw);
    let projects: string[] = Array.isArray(parsed?.projects) ? parsed.projects : [];

    if (projects.length === 0) {
      // フォールバック（万一JSONでない場合の保険）
      const fallback = raw.match(/^\s*[-・*]\s*(.+)$/gm)?.map((l) => l.replace(/^\s*[-・*]\s*/, '').trim()) ?? [];
      projects = fallback;
    }

    // 後処理：クレンジング
    projects = (projects || [])
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter((p) => p.length > 0)
      .filter((p, i, arr) => arr.indexOf(p) === i) // 重複排除
      .slice(0, 6); // 安全上限

    return NextResponse.json({ projects });
  } catch (err) {
    console.error('❌ プロジェクト再生成エラー:', err);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
