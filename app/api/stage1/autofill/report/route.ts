/* 決算期ごとの有価証券報告書（訂正があれば訂正後）を探し、構造化データから企業情報・財務・セグメントを取り出す（PHASE 5C）。
 * 1回の依頼で1決算期だけを扱う（利用者の画面で進行状況を示すため、呼び出しを分ける）。保存はしない。 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { authorizeAutofill, isDay, isId } from '@/lib/autofill/serverGuard';
import { listAnnualDocsForDate } from '@/lib/autofill/edinetDocuments';
import { downloadEdinetCsvZip } from '@/lib/autofill/edinetDocuments';
import { findAnnualReportForPeriod } from '@/lib/autofill/edinetIdentify';
import { decodeEdinetText, parseEdinetCsv, readZipEntries } from '@/lib/autofill/edinetZip';
import { extractFacts } from '@/lib/autofill/xbrlFacts';
import { extractSegments } from '@/lib/autofill/segments';
import type { EdinetDocument } from '@/lib/autofill/companyCandidates';

type Body = { companyId?: unknown; strategyId?: unknown; edinetCode?: unknown; periodEnd?: unknown };

const EDINET_CODE = /^E\d{5}$/;

function pickCsv(entries: Array<{ name: string; data: Buffer }>, docId: string) {
  return (
    entries.find((e) => /jpcrp.*asr/.test(e.name)) ??
    entries.find((e) => e.name.toLowerCase().endsWith('.csv') && e.name.includes(docId)) ??
    entries.find((e) => e.name.toLowerCase().endsWith('.csv'))
  );
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (
    !body ||
    !isId(body.companyId) ||
    !isId(body.strategyId) ||
    typeof body.edinetCode !== 'string' ||
    !EDINET_CODE.test(body.edinetCode) ||
    !isDay(body.periodEnd)
  ) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }
  const guard = await authorizeAutofill(req, body.companyId, body.strategyId);
  if (!guard.ok) return guard.response;

  const apiKey = process.env.EDINET_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'edinet_not_configured' }, { status: 503 });

  const periodEnd = body.periodEnd;
  const edinetCode = body.edinetCode;
  let found;
  try {
    found = await findAnnualReportForPeriod(
      { edinetCode, periodEnd },
      { listDocs: (day) => listAnnualDocsForDate(day, apiKey) },
    );
  } catch (e: any) {
    console.error('[stage1-autofill] EDINET_LIST_FAILED', { message: e?.message, status: e?.status });
    return NextResponse.json({ error: 'edinet_unavailable' }, { status: 502 });
  }
  if (found.status !== 'FOUND') {
    return NextResponse.json({ status: found.status, scannedDays: found.scannedDays, periodEnd });
  }

  // 訂正報告書がある時は、その構造化データを採用する（元の書類との関係を示す）
  const doc: EdinetDocument = found.amendments[0] ?? found.annual;
  try {
    const zip = await downloadEdinetCsvZip(doc.docId, apiKey);
    const entries = readZipEntries(zip);
    const csv = pickCsv(entries, doc.docId);
    if (!csv) throw new Error('csv_not_found');
    const rows = parseEdinetCsv(decodeEdinetText(csv.data));
    const facts = extractFacts(rows);
    const segments = extractSegments(rows, facts.periodEnd);
    return NextResponse.json({
      status: 'FOUND',
      periodEnd,
      scannedDays: found.scannedDays,
      report: {
        docId: doc.docId,
        docTypeCode: doc.docTypeCode,
        periodEnd: doc.periodEnd ?? periodEnd,
        submitDate: doc.submitDate,
        amendedFromDocId: found.amendments.length > 0 ? found.annual.docId : null,
        facts,
        segments,
      },
    });
  } catch (e: any) {
    console.error('[stage1-autofill] EDINET_CSV_FAILED', { message: e?.message, status: e?.status });
    return NextResponse.json({ error: 'edinet_unavailable' }, { status: 502 });
  }
}
