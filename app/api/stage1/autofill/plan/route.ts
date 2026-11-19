/* AI経営コンサルタントの依頼（会社名または証券コード）から、有価証券報告書の入力候補を作る（PHASE 5B）。
 * 保存はしない。候補は利用者が承認した後に、既存の入力処理で反映する。 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { assertMinRole, getAuthUserIdFromBearer, requireMembership, resolveCompanyIdFromStrategyId } from '@/lib/server/rbacGuard';
import { logAuditEvent } from '@/lib/server/auditLog';
import { downloadEdinetCsvZip, EdinetHttpError, listEdinetDocumentsForDate } from '@/lib/autofill/edinetDocuments';
import { identifyCompany, parseIdentifyQuery } from '@/lib/autofill/edinetIdentify';
import { decodeEdinetText, parseEdinetCsv, readZipEntries } from '@/lib/autofill/edinetZip';
import { extractFacts } from '@/lib/autofill/xbrlFacts';
import { buildFilingCandidate } from '@/lib/autofill/filingCandidates';

type Body = { companyId?: unknown; strategyId?: unknown; text?: unknown };

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100;

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_STAGE1_AUTOFILL_DISABLED === 'true') {
    return NextResponse.json({ error: 'autofill_disabled' }, { status: 503 });
  }
  const admin = getSupabaseAdmin();
  const userId = await getAuthUserIdFromBearer(admin, req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || !isId(body.companyId) || !isId(body.strategyId) || typeof body.text !== 'string' || body.text.length > 300) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }
  const { companyId, strategyId, text } = body;

  const membership = await requireMembership(admin, userId, companyId);
  if (!membership) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    await assertMinRole(membership, 'manager');
  } catch {
    return NextResponse.json({ error: 'insufficient_role' }, { status: 403 });
  }
  const strategyCompany = await resolveCompanyIdFromStrategyId(admin, strategyId);
  if (strategyCompany !== companyId) return NextResponse.json({ error: 'strategy_mismatch' }, { status: 403 });

  const query = parseIdentifyQuery(text);
  if (!query) return NextResponse.json({ status: 'QUERY_UNCLEAR', message: '会社名または証券コード（4桁）を含めてください' });

  const apiKey = process.env.EDINET_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'edinet_not_configured' }, { status: 503 });

  const fetchedAt = new Date().toISOString();
  let result;
  try {
    result = await identifyCompany(query, { listDocs: (day) => listEdinetDocumentsForDate(day, apiKey) });
  } catch (e: any) {
    console.error('[stage1-autofill] EDINET_IDENTIFY_FAILED', { message: e?.message, status: e?.status });
    return NextResponse.json({ error: 'edinet_unavailable' }, { status: 502 });
  }

  if (result.status !== 'FOUND') {
    await logAuditEvent({ companyId, actorUserId: userId, action: 'STAGE1_AUTOFILL_PLAN', targetType: 'edinet_query', targetId: null, metadata: { status: result.status, scannedDays: result.scannedDays } });
    return NextResponse.json({
      status: result.status,
      scannedDays: result.scannedDays,
      candidates: result.status === 'AMBIGUOUS' ? result.candidates : undefined,
    });
  }

  const latestAmendment = [...result.amendments].sort((a, b) => (b.submitDate ?? '').localeCompare(a.submitDate ?? ''))[0] ?? null;
  const doc = latestAmendment ?? result.annualReport;
  let facts;
  try {
    const zip = await downloadEdinetCsvZip(doc.docId, apiKey);
    const entries = readZipEntries(zip);
    const main = entries.find((e) => /jpcrp.*asr/.test(e.name)) ?? entries.find((e) => e.name.toLowerCase().endsWith('.csv'));
    if (!main) throw new Error('csv_not_found');
    facts = extractFacts(parseEdinetCsv(decodeEdinetText(main.data)));
  } catch (e: any) {
    console.error('[stage1-autofill] EDINET_CSV_FAILED', { message: e?.message, status: e?.status });
    const status = e instanceof EdinetHttpError ? 502 : 500;
    return NextResponse.json({ error: 'edinet_unavailable' }, { status });
  }

  const candidate = buildFilingCandidate({
    doc,
    facts,
    fetchedAt,
    amendedFromDocId: latestAmendment ? result.annualReport.docId : null,
  });

  await logAuditEvent({
    companyId,
    actorUserId: userId,
    action: 'STAGE1_AUTOFILL_PLAN',
    targetType: 'edinet_document',
    targetId: doc.docId,
    metadata: { scannedDays: result.scannedDays, docTypeCode: doc.docTypeCode, amended: latestAmendment !== null },
  });

  return NextResponse.json({ status: 'FOUND', companyId, strategyId, fetchedAt, scannedDays: result.scannedDays, candidate });
}
