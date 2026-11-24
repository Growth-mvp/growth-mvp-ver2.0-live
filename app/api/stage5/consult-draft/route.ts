import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { openai } from '@/lib/openai';
import { AI_MODELS, MODEL_CONFIGURATIONS } from '@/lib/modelConfig';
import { getAuthUserIdFromBearer, requireMembership, assertCompanyScopeByStrategyId } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { logAuditEvent } from '@/lib/server/auditLog';
import { loadExecutionScope, parseExecutionInput } from '@/lib/ceoChat/executionScope';
import { formatConsultDraft, parseConsultDraft } from '@/lib/stage5/consultDraft';
import { buildConsultDraftUserPrompt, CONSULT_DRAFT_SYSTEM_PROMPT } from '@/lib/stage5/consultDraftPrompt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ID_MAX = 100;
const QUESTION_MAX = 1000;
const ANSWER_MAX = 4000;

const bodySchema = z.object({
  companyId: z.string().trim().min(1).max(ID_MAX),
  strategyId: z.string().trim().min(1).max(ID_MAX),
  departmentId: z.string().trim().min(1).max(ID_MAX),
  projectId: z.string().trim().min(1).max(ID_MAX),
  question: z.string().trim().min(1).max(QUESTION_MAX),
  answer: z.string().trim().min(1).max(ANSWER_MAX),
});

export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized', message: 'Bearer token is required' }, { status: 401 });
    }

    const raw = await req.json().catch(() => null);
    const parsedBody = bodySchema.safeParse(raw);
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
    }
    const body = parsedBody.data;

    const membership = await requireMembership(admin, userId, body.companyId);
    if (!membership || membership.companyId !== body.companyId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    try {
      await assertCompanyScopeByStrategyId(admin, membership, body.strategyId);
    } catch {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const execution = parseExecutionInput(
      { companyId: body.companyId, strategyId: body.strategyId, departmentId: body.departmentId, projectId: body.projectId },
      { companyId: body.companyId, strategyId: body.strategyId },
    );
    if (!execution.ok) {
      return NextResponse.json({ error: execution.error }, { status: execution.status });
    }
    const scope = await loadExecutionScope(admin, execution.value);
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }

    const completion = await openai.chat.completions.create({
      model: AI_MODELS.lightweight,
      max_completion_tokens: MODEL_CONFIGURATIONS.stage5ConsultDraft.maxCompletionTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: CONSULT_DRAFT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildConsultDraftUserPrompt({ scopeBlock: scope.promptBlock, question: body.question, answer: body.answer }),
        },
      ],
    });

    let json: unknown = null;
    try {
      json = JSON.parse(completion.choices[0]?.message?.content ?? 'null');
    } catch {
      json = null;
    }
    const draft = parseConsultDraft(json);
    if (!draft) {
      return NextResponse.json({ error: 'draft_invalid' }, { status: 502 });
    }

    await logAuditEvent({
      companyId: body.companyId,
      actorUserId: userId,
      action: 'STAGE5_CONSULT_DRAFT_CREATED',
      targetType: 'project',
      targetId: body.projectId,
      metadata: { strategyId: body.strategyId, departmentId: body.departmentId },
    });

    return NextResponse.json({ draft, text: formatConsultDraft(draft) }, { status: 200 });
  } catch (e) {
    console.error('[stage5/consult-draft] error', (e as Error)?.name ?? 'unknown');
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
