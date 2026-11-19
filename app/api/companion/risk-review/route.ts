/* AI経営コンサルタントの経営点検（PHASE 3）。STAGE5・6の保存済みデータから事実を決め、
 * 事実が無ければAIを呼ばない。事実があれば、AIが仮説と見直しの候補だけを書く。 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { getOpenAIModelParamsForProcess } from '@/lib/modelConfig';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { logAuditEvent } from '@/lib/server/auditLog';
import { getFullStrategyDataByStrategyId } from '@/utils/supabase/strategy';
import { normalizeStrategyData } from '@/utils/supabase/normalize';
import { stage6PlanDepartments } from '@/lib/cascade/projectLifecycle';
import { riskFactsFromStrategy } from '@/lib/companion/companionRiskSource';
import { RISK_GUARD, buildRiskPrompt, renderRiskFacts } from '@/lib/companion/companionRisk';

type Body = { companyId?: unknown; strategyId?: unknown };

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100;

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const userId = await getAuthUserIdFromBearer(admin, req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || !isId(body.companyId) || !isId(body.strategyId)) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }
  const { companyId, strategyId } = body;

  const membership = await requireMembership(admin, userId, companyId);
  if (!membership) return NextResponse.json({ error: 'no membership' }, { status: 403 });

  const { data: row, error } = await getFullStrategyDataByStrategyId(strategyId, companyId, admin);
  if (error || !row) return NextResponse.json({ error: 'strategy not found' }, { status: 404 });
  const strategy = normalizeStrategyData(row) as unknown as Record<string, unknown>;

  const facts = riskFactsFromStrategy({
    csvFinanceData: strategy.csvFinanceData,
    companyId,
    financePL: strategy.financePL,
    financeBS: strategy.financeBS,
    departments: stage6PlanDepartments(strategy.departments),
    fiscalYearEnd: strategy.fiscalYearEnd as string | undefined,
    currentYear: new Date().getFullYear(),
    companyTargets: strategy.companyTargets,
    now: new Date(),
  });
  if (facts.length === 0) return NextResponse.json({ facts: [], text: null });

  const lines = renderRiskFacts(facts);
  let text: string | null = null;
  try {
    const completion = await openai.chat.completions.create({
      ...getOpenAIModelParamsForProcess('ceoRiskReview'),
      messages: [
        { role: 'system', content: RISK_GUARD },
        { role: 'user', content: buildRiskPrompt(lines) },
      ],
    });
    text = completion.choices[0]?.message?.content?.trim() || null;
  } catch (e: any) {
    console.error('[companion-risk-review] OPENAI_CALL_FAILED', { name: e?.name, status: e?.status });
  }

  await logAuditEvent({
    companyId,
    actorUserId: userId,
    action: 'COMPANION_RISK_REVIEW',
    targetType: 'strategy',
    targetId: strategyId,
    metadata: { factCount: facts.length, aiUsed: text !== null },
  });

  return NextResponse.json({ facts: lines, text });
}
