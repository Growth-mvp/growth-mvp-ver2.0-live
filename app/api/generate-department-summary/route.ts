// /app/api/generate-department-summary/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { sanitizeText, toTextStory } from '@/app/api/_shared/utils';

type AnswerStep = { stepNumber: number; question: string; reason: string; answer: string };

type ReqBody = {
  departmentName: string;
  story?: Array<{ title: string; body: string }> | string; // 経営ストーリー（任意）
  answers: AnswerStep[]; // 3問分（answer必須）
};

type OKR = { objective: string; keyResults: string[]; owner?: string };
type Out = { mission: string; projects: string[]; okrs: OKR[] };

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ReqBody;
    const dept = (body.departmentName || '').trim();
    if (!dept) return NextResponse.json({ error: 'departmentName が必要です' }, { status: 400 });

    const storyText = typeof body.story === 'string'
      ? body.story
      : toTextStory(body.story);

    const steps = (body.answers || []).sort((a,b)=>a.stepNumber-b.stepNumber);
    if (steps.length < 3 || steps.some(s => !s?.answer?.trim())) {
      return NextResponse.json({ error: '3問の回答（answer）が必要です' }, { status: 400 });
    }

    const context = `
部門: ${dept}
【経営ストーリー（要約入力）】
${sanitizeText(storyText || '', 1600) || '(未入力)'}
【部長の回答（1:役割/2:価値/3:集中と選択）】
${steps.map(s => `- Q${s.stepNumber}: ${sanitizeText(s.question,120)}\n  A: ${sanitizeText(s.answer,400)}`).join('\n')}
`.trim();

    const system = `
あなたは経営戦略ファシリテーターです。
部長の3つの回答を材料に、以下を日本語で「実行可能な形」に整形して JSON のみ返してください。
- mission: 80〜140字。存在意義と最終成果を1文で。
- projects: 3〜5件。重複や抽象語を避け、実行主体とアウトプットが想像できる粒度で。
- okrs: 1〜2セット。objectiveは短文、keyResultsは測定可能（数値or頻度）に。
制約:
- 出力は {"mission": "...", "projects": ["..."], "okrs":[{"objective":"...","keyResults":["..."],"owner":""}]} の JSON のみ。
- ストーリーに反する創作は禁止。回答の整合性を優先して簡潔に要約。
- 「やらないこと」はKRに含めない（別の意思決定とする）。
`.trim();

    const user = `
次の文脈を要約し、Mission/Projects/OKRを出力してください。
${context}
`.trim();

    const ai = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    const raw = ai.choices?.[0]?.message?.content ?? '';
    let parsed: Out | null = null;
    try { parsed = JSON.parse(raw) as Out; } catch {
      const m = raw.match(/\{[\s\S]*\}/m);
      if (m) parsed = JSON.parse(m[0]) as Out;
    }
    if (!parsed?.mission || !Array.isArray(parsed?.projects) || !Array.isArray(parsed?.okrs)) {
      return NextResponse.json({ error: 'LLM JSON parse error', raw }, { status: 502 });
    }

    // 整形
    const mission = String(parsed.mission || '').trim();
    const projects = parsed.projects.map(p => String(p||'').trim()).filter(Boolean).slice(0,5);
    const okrs = (parsed.okrs || []).slice(0,2).map(o => ({
      objective: String(o?.objective || '').trim(),
      keyResults: (o?.keyResults || []).map(k => String(k||'').trim()).filter(Boolean).slice(0,4),
      owner: o?.owner ? String(o.owner).trim() : undefined,
    }));

    return NextResponse.json({ mission, projects, okrs }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('dept-summary error:', e?.message || e);
    return NextResponse.json({ error: 'Server error', detail: e?.message || String(e) }, { status: 500 });
  }
}
