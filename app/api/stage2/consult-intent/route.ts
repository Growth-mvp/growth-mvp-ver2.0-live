import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { openai } from '@/lib/openai';
import { AI_MODELS, MODEL_CONFIGURATIONS } from '@/lib/modelConfig';
import { assertCompanyScopeByStrategyId, assertMinRole, getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { logAuditEvent } from '@/lib/server/auditLog';
import { splitSentences } from '@/lib/consult/sentenceSelection';
import { buildCeoIntentDraft, buildCeoIntentUserPrompt, CEO_INTENT_SYSTEM_PROMPT, ceoIntentSelectionSchema } from '@/lib/stage2/ceoIntent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ID_MAX = 100;
const QUESTION_MAX = 1000;
const ANSWER_MAX = 4000;

const bodySchema = z.object({
  companyId: z.string().trim().min(1).max(ID_MAX),
  strategyId: z.string().trim().min(1).max(ID_MAX),
  question: z.string().trim().min(1).max(QUESTION_MAX),
  answer: z.string().trim().min(1).max(ANSWER_MAX),
});

export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const parsedBody = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
    }
    const body = parsedBody.data;

    const membership = await requireMembership(admin, userId, body.companyId);
    if (!membership || membership.companyId !== body.companyId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    try {
      await assertMinRole(membership, 'admin');
      await assertCompanyScopeByStrategyId(admin, membership, body.strategyId);
    } catch {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const sentences = splitSentences(body.question);
    if (sentences.length === 0) {
      return NextResponse.json({ error: 'no_sentences' }, { status: 422 });
    }

    const completion = await openai.chat.completions.create({
      model: AI_MODELS.lightweight,
      max_completion_tokens: MODEL_CONFIGURATIONS.stage2ConsultIntent.maxCompletionTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: CEO_INTENT_SYSTEM_PROMPT },
        { role: 'user', content: buildCeoIntentUserPrompt({ sentences, answer: body.answer }) },
      ],
    });

    let json: unknown = null;
    try {
      json = JSON.parse(completion.choices[0]?.message?.content ?? 'null');
    } catch {
      json = null;
    }
    if (!ceoIntentSelectionSchema.safeParse(json).success) {
      return NextResponse.json({ error: 'draft_invalid' }, { status: 502 });
    }
    const text = buildCeoIntentDraft({ question: body.question, selection: json });
    if (!text) {
      return NextResponse.json({ error: 'no_relevant_sentences' }, { status: 422 });
    }

    await logAuditEvent({
      companyId: body.companyId,
      actorUserId: userId,
      action: 'STAGE2_CONSULT_INTENT_CREATED',
      targetType: 'strategy',
      targetId: body.strategyId,
      metadata: { field: 'ceoIntent' },
    });

    return NextResponse.json({ text }, { status: 200 });
  } catch (e) {
    console.error('[stage2/consult-intent] error', (e as Error)?.name ?? 'unknown');
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
