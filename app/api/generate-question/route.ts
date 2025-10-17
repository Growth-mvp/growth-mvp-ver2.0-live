// /app/api/generate-question/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { clampStepDyn, maxStepsForChapter, TEMPLATE12 } from './helpers';

export async function POST(req: Request) {
  const { chapterIndex = 0, stepNumber = 1 } = await req.json();

  const ch = Number(chapterIndex) | 0;
  const max = maxStepsForChapter(ch);
  const step = clampStepDyn(ch, Number(stepNumber) || 1, 1);

  const tpl = (TEMPLATE12[ch] ?? [])[step - 1];
  if (!tpl) {
    return NextResponse.json({ error: 'No template for chapter/step' }, { status: 400 });
  }

  return NextResponse.json({
    step: {
      stepNumber: step,
      depth: 'exec',     // 表示用。固定でOK（不要なら消しても良い）
      question: tpl.question,
      reason: tpl.reason,
      answer: '',
    },
    meta: {
      chapterIndex: ch,
      maxSteps: max,
      mode: 'pure12',
    },
  });
}
