/* 上場企業の基本情報の入力候補を、公開資料（EDINET）から作る（PHASE 5A）。
 * 保存はしない。候補は画面で利用者が承認した後にだけ、既存の入力処理で反映する。 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { assertMinRole, getAuthUserIdFromBearer, requireMembership, resolveCompanyIdFromStrategyId } from '@/lib/server/rbacGuard';
import { logAuditEvent } from '@/lib/server/auditLog';
import { candidateFromDocument } from '@/lib/autofill/companyCandidates';
import { findDocumentsForTicker, listEdinetDocumentsForRange, validateRange } from '@/lib/autofill/edinetDocuments';

type Body = { companyId?: unknown; strategyId?: unknown; secCode?: unknown; fromDate?: unknown; toDate?: unknown };

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100;
const isTicker = (v: unknown): v is string => typeof v === 'string' && /^\d{4}$/.test(v);
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_STAGE1_AUTOFILL_DISABLED === 'true') {
    return NextResponse.json({ error: 'autofill_disabled' }, { status: 503 });
  }
  const admin = getSupabaseAdmin();
  const userId = await getAuthUserIdFromBearer(admin, req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || !isId(body.companyId) || !isId(body.strategyId) || !isTicker(body.secCode) || !isDay(body.fromDate) || !isDay(body.toDate)) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }
  const { companyId, strategyId, secCode, fromDate, toDate } = body;
  const rangeError = validateRange(fromDate, toDate);
  if (rangeError) return NextResponse.json({ error: 'invalid_range', message: rangeError }, { status: 400 });

  const membership = await requireMembership(admin, userId, companyId);
  if (!membership) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    await assertMinRole(membership, 'manager');
  } catch {
    return NextResponse.json({ error: 'insufficient_role' }, { status: 403 });
  }

  const strategyCompany = await resolveCompanyIdFromStrategyId(admin, strategyId);
  if (strategyCompany !== companyId) {
    return NextResponse.json({ error: 'strategy_mismatch' }, { status: 403 });
  }

  const apiKey = process.env.EDINET_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'edinet_not_configured' }, { status: 503 });

  let docs;
  try {
    docs = await listEdinetDocumentsForRange(fromDate, toDate, apiKey);
  } catch (e: any) {
    console.error('[stage1-autofill] EDINET_READ_FAILED', { message: e?.message, status: e?.status });
    return NextResponse.json({ error: 'edinet_unavailable' }, { status: 502 });
  }

  const matches = findDocumentsForTicker(docs, secCode);
  const fetchedAt = new Date().toISOString();
  const best = matches[0] ?? null;
  const candidate = best ? candidateFromDocument(best, fetchedAt) : null;

  await logAuditEvent({
    companyId,
    actorUserId: userId,
    action: 'STAGE1_AUTOFILL_CANDIDATES',
    targetType: 'edinet_document',
    targetId: best?.docId ?? null,
    metadata: { secCode, fromDate, toDate, matchCount: matches.length },
  });

  return NextResponse.json({
    companyId,
    strategyId,
    fetchedAt,
    candidate,
    matches: matches.map((d) => ({
      docId: d.docId,
      docTypeCode: d.docTypeCode,
      filerName: d.filerName,
      periodEnd: d.periodEnd,
      docDescription: d.docDescription,
    })),
  });
}
