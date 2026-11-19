/* 依頼文（会社名または証券コード）から、金融庁のEDINETコードリストで提出者を特定する（PHASE 5C）。
 * 書類の走査はしない。保存もしない。 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { logAuditEvent } from '@/lib/server/auditLog';
import { authorizeAutofill, isId } from '@/lib/autofill/serverGuard';
import { getCodeListIndex, type CodeListEntry } from '@/lib/autofill/edinetCodeList';
import { parseIdentifyQuery, recentPeriodEnds } from '@/lib/autofill/edinetIdentify';

type Body = { companyId?: unknown; strategyId?: unknown; text?: unknown };

const summarize = (e: CodeListEntry) => ({
  name: e.name,
  secCode: e.secCode,
  edinetCode: e.edinetCode,
  address: e.address,
  listed: e.listed,
});

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || !isId(body.companyId) || !isId(body.strategyId) || typeof body.text !== 'string' || body.text.length > 300) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }
  const guard = await authorizeAutofill(req, body.companyId, body.strategyId);
  if (!guard.ok) return guard.response;

  const query = parseIdentifyQuery(body.text);
  if (!query) return NextResponse.json({ status: 'QUERY_UNCLEAR', message: '会社名または証券コード（4桁）を含めてください' });

  let index;
  try {
    index = await getCodeListIndex();
  } catch (e: any) {
    console.error('[stage1-autofill] CODELIST_FAILED', { message: e?.message });
    return NextResponse.json({ error: 'codelist_unavailable' }, { status: 502 });
  }

  const hits = index.search(query);
  await logAuditEvent({
    companyId: guard.auth.companyId,
    actorUserId: guard.auth.userId,
    action: 'STAGE1_AUTOFILL_IDENTIFY',
    targetType: 'edinet_codelist',
    targetId: hits.length === 1 ? hits[0].edinetCode : null,
    metadata: { queryKind: query.secCode ? 'secCode' : 'name', hits: hits.length },
  });

  if (hits.length === 0) return NextResponse.json({ status: 'NOT_FOUND' });
  if (hits.length > 1) return NextResponse.json({ status: 'AMBIGUOUS', candidates: hits.slice(0, 10).map(summarize) });

  const filer = hits[0];
  if (filer.fiscalYearEndMonth === null) {
    return NextResponse.json({ status: 'FISCAL_YEAR_UNKNOWN', filer: summarize(filer) });
  }
  const periods = recentPeriodEnds({ month: filer.fiscalYearEndMonth, day: filer.fiscalYearEndDay });
  return NextResponse.json({
    status: 'FOUND',
    filer: {
      ...summarize(filer),
      industryName: filer.industryName,
      corporateNumber: filer.corporateNumber,
      consolidated: filer.consolidated,
      fiscalYearEndMonth: filer.fiscalYearEndMonth,
      fiscalYearEndDay: filer.fiscalYearEndDay,
    },
    periods,
    companyId: guard.auth.companyId,
    strategyId: guard.auth.strategyId,
  });
}
