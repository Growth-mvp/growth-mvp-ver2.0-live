/* AI経営コンサルタントの経営点検（PHASE 3）。STAGE5・6の保存済みデータから事実を決め、
 * 事実が無ければAIを呼ばない。事実があれば、同じ企業・同じ日に1回だけAIが仮説と見直しの候補を書き、
 * 同じ事実を持つ同じ企業の利用者は、その所見を共有する。点検の事実は常に返す。 */
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
import { riskInputsOf } from '@/lib/companion/companionRiskSource';
import { isCompanionKilled } from '@/lib/companion/companionPolicy';
import { RISK_GUARD, buildRiskPrompt, isSeriousRisk, renderRiskFacts, riskStatusOf } from '@/lib/companion/companionRisk';
import {
  claimDailyRiskReview,
  finishClaim,
  jstDateOf,
  riskFingerprint,
  type ClaimKey,
} from '@/lib/companion/companionRiskClaim';

type Body = { companyId?: unknown; strategyId?: unknown };

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100;

export async function POST(req: Request) {
  if (isCompanionKilled(process.env.NEXT_PUBLIC_CEO_COMPANION_DISABLED)) {
    return NextResponse.json({ error: 'companion_disabled' }, { status: 503 });
  }
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

  const now = new Date();
  let facts;
  let coverage: string[];
  try {
    ({ facts, coverage } = riskInputsOf({
      csvFinanceData: strategy.csvFinanceData,
      companyId,
      financePL: strategy.financePL,
      financeBS: strategy.financeBS,
      departments: stage6PlanDepartments(strategy.departments),
      fiscalYearEnd: strategy.fiscalYearEnd as string | undefined,
      currentYear: now.getFullYear(),
      companyTargets: strategy.companyTargets,
      now,
    }));
  } catch (e: any) {
    console.error('[companion-risk-review] FACTS_FAILED', { message: e?.message });
    return NextResponse.json({ error: 'facts_failed' }, { status: 500 });
  }
  const status = riskStatusOf(facts, coverage);
  const checkedAt = now.toISOString();
  if (facts.length === 0) {
    return NextResponse.json({ status, facts: [], text: null, serious: false, coverage, aiState: 'NOT_NEEDED', checkedAt });
  }

  const lines = renderRiskFacts(facts);
  const key: ClaimKey = { companyId, strategyId, day: jstDateOf(now), fingerprint: riskFingerprint(facts) };
  const serious = isSeriousRisk(facts);

  const claim = await claimDailyRiskReview(admin, key);
  if (claim.kind === 'REUSE') {
    return NextResponse.json({ status: 'ISSUES', facts: lines, text: claim.finding, serious, coverage, aiState: 'REUSED', checkedAt });
  }
  if (claim.kind === 'BLOCKED') {
    return NextResponse.json({ status: 'ISSUES', facts: lines, text: null, serious, coverage, aiState: claim.state, checkedAt });
  }

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

  const finished = text
    ? await finishClaim(admin, key, { status: 'DONE', finding: text })
    : await finishClaim(admin, key, { status: 'FAILED' });
  if (!finished) console.error('[companion-risk-review] CLAIM_UPDATE_FAILED');

  await logAuditEvent({
    companyId,
    actorUserId: userId,
    action: 'COMPANION_RISK_REVIEW',
    targetType: 'strategy',
    targetId: strategyId,
    metadata: { factCount: facts.length, aiUsed: text !== null },
  });

  return NextResponse.json({
    status: 'ISSUES',
    facts: lines,
    text,
    serious,
    coverage,
    aiState: text ? 'GENERATED' : 'FAILED',
    checkedAt,
  });
}
