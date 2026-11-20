/* 非上場企業の公開情報（公式サイトなど）から基本情報の候補を作る。保存はしない。送るのは会社名だけ。 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import { logAuditEvent } from '@/lib/server/auditLog';
import { authorizeAutofill, isId } from '@/lib/autofill/serverGuard';
import { searchPublicCompanyProfile } from '@/lib/autofill/publicSearch';
import { buildWebProfileCandidate } from '@/lib/autofill/publicCandidate';

type Body = { companyId?: unknown; strategyId?: unknown; name?: unknown };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (
    !body ||
    !isId(body.companyId) ||
    !isId(body.strategyId) ||
    typeof body.name !== 'string' ||
    body.name.trim().length < 2 ||
    body.name.length > 100
  ) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }
  const guard = await authorizeAutofill(req, body.companyId, body.strategyId);
  if (!guard.ok) return guard.response;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'web_search_not_configured' }, { status: 503 });

  const name = body.name.trim();
  const search = await searchPublicCompanyProfile(new OpenAI({ apiKey }), name);
  await logAuditEvent({
    companyId: guard.auth.companyId,
    actorUserId: guard.auth.userId,
    action: 'STAGE1_AUTOFILL_WEB',
    targetType: 'public_web',
    targetId: null,
    metadata: { searchStatus: search.status, factCount: search.facts.length },
  });

  if (search.status === 'timeout') return NextResponse.json({ status: 'SEARCH_TIMEOUT' });
  if (search.status === 'failed') return NextResponse.json({ status: 'SEARCH_FAILED' });
  if (search.status === 'no_results') return NextResponse.json({ status: 'NOT_FOUND' });

  const built = buildWebProfileCandidate({ query: name, facts: search.facts, confirmedOn: search.confirmedOn });
  if (built.status !== 'FOUND') return NextResponse.json({ status: 'NOT_CONFIRMED', message: built.message });
  return NextResponse.json({ status: 'FOUND', candidate: built.candidate, fetchedAt: new Date().toISOString() });
}
