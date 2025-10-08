// /app/api/generate-projects-only/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { toTextStory, sanitizeText, extractJsonObject } from '@/app/api/_shared/utils';
import { getIndustryLabel } from '@/utils/industryTemplates'; // ★追加
import { z } from 'zod';

/* =========================
 * 入力スキーマ
 * ======================= */
const ReqSchema = z.object({
  departmentName: z.string().min(1, 'departmentName is required'),
  mission: z.string().min(1, 'mission is required'),
  story: z.any(), // string | Array<{title, body}>
  industry: z.string().optional(), // ★追加
});

/* =========================
 * ユーティリティ
 * ======================= */
function normalizeProjects(list: unknown[], max = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of Array.isArray(list) ? list : []) {
    const s = String(raw ?? '').trim();
    if (!s) continue;
    const key = s
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[！!。．.、,・\s]+$/g, '');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
      if (out.length >= max) break;
    }
  }
  return out;
}

function bulletsFallback(raw: string): string[] {
  return (
    raw
      .match(/^\s*[-・*]\s*(.+)$/gm)
      ?.map((l) => l.replace(/^\s*[-・*]\s*/, '').trim())
      .filter(Boolean) ?? []
  );
}

async function callOpenAIWithRetry(
  messages: { role: 'system' | 'user'; content: string }[],
  tries = 3
) {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o',
        temperature: 0.4,
        response_format: { type: 'json_object' },
        max_tokens: 500,
        messages,
      });
    } catch (e: any) {
      lastErr = e;
      const status = Number(e?.status ?? e?.code ?? 0);
      const retryable =
        status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      if (!retryable || i === tries - 1) break;
      const retryAfter = Number(e?.response?.headers?.get?.('retry-after')) || 0;
      const backoff = retryAfter > 0 ? retryAfter * 1000 : [300, 700, 1300][Math.min(i, 2)];
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

/* =========================
 * ハンドラ
 * ======================= */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json().catch(() => ({}));
    const parsed = ReqSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '必要な情報が不足しています（部門名、ミッション、ストーリー）' },
        { status: 400 }
      );
    }

    const { departmentName, mission, story, industry } = parsed.data;
    const storyText = toTextStory(story);
    const dept = departmentName.trim();
    const missionText = mission.trim();

    if (!dept || !missionText || !storyText?.trim()) {
      return NextResponse.json(
        { error: '必要な情報が不足しています（部門名、ミッション、ストーリー）' },
        { status: 400 }
      );
    }

    // ★業種の日本語化
    const industryLabel = industry ? getIndustryLabel(industry, { full: true }) : '';
    const industryLine = industryLabel
      ? `業種: ${industryLabel}${industry ? `（${industry}）` : ''}`
      : '業種: （未指定）';

    const prompt = `
${industryLine}
部門: ${dept}

以下は企業の経営戦略ストーリーです：

---
${sanitizeText(storyText, 2000)}
---

この経営戦略と部門ミッションに基づき、「${dept}」部門で注力すべき**実行可能なプロジェクト案**を3〜5件、簡潔な名詞句で提案してください。

【部門ミッション】
${sanitizeText(missionText, 800)}

# 出力要件
- 日本語
- JSONのみ。前後の説明文・コードフェンスは禁止
- 形式: {"projects":["...", "...", "..."] }
- 各タイトルは重複させず、業種・部門に即した具体的な実行プロジェクトを挙げること
`.trim();

    // OpenAI 呼び出し（JSON固定 & リトライ）
    let ai;
    try {
      ai = await callOpenAIWithRetry(
        [
          { role: 'system', content: 'あなたは有能な経営コンサルタントです。必ずJSONのみを返します。' },
          { role: 'user', content: prompt },
        ],
        3
      );
    } catch (e: any) {
      const status = Number(e?.status ?? e?.code ?? 500);
      const message = e?.message || 'OpenAI error';
      return NextResponse.json({ error: message }, { status: status === 429 ? 429 : 502 });
    }

    // 1) JSON → 2) ゆるく抽出 → 3) 箇条書きフォールバック
    const raw = ai?.choices?.[0]?.message?.content || '';
    const parsedOut = extractJsonObject<any>(raw);
    let projects: string[] =
      Array.isArray(parsedOut?.projects)
        ? (parsedOut!.projects as unknown[]).map((p) => String(p ?? ''))
        : [];

    if (projects.length === 0) {
      projects = bulletsFallback(raw);
    }

    // クレンジング & 重複排除 & 上限制限
    projects = normalizeProjects(projects, 6);

    return NextResponse.json({ projects }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    console.error('❌ プロジェクト再生成エラー:', err?.message || err);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
