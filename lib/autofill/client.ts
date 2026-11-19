/* 依頼から候補までの一連の流れ（ブラウザ側）。会社の特定 → 決算期ごとの有価証券報告書 → 候補の組み立て。
 * 1回の呼び出しは1決算期分なので、進行状況を利用者に示せる。失敗しても自動で再試行しない。 */
import type { FilingCandidate } from './filingCandidates';
import { buildMultiYearCandidate, type FilerInfo, type ReportExtract } from './assemble';
import type { ExtractedFacts } from './xbrlFacts';
import type { SegmentExtract } from './segments';

export type PipelineProgress = { step: number; total: number; label: string };

export type IdentifyCandidate = { name: string; secCode: string | null; edinetCode: string; address: string; listed: boolean };

export type PipelineResult =
  | { status: 'FOUND'; candidate: FilingCandidate; fetchedAt: string; missingPeriods: string[] }
  | { status: 'AMBIGUOUS'; candidates: IdentifyCandidate[] }
  | { status: 'NOT_FOUND' | 'QUERY_UNCLEAR' | 'FISCAL_YEAR_UNKNOWN' | 'BUDGET_EXCEEDED' | 'NOT_YET_OPEN'; message: string };

type Post = (path: string, body: unknown) => Promise<{ ok: boolean; status: number; json: Record<string, any> }>;

export async function runAutofillPipeline(args: {
  text: string;
  companyId: string;
  strategyId: string;
  token: string;
  onProgress?: (p: PipelineProgress) => void;
  fetchImpl?: typeof fetch;
  now?: () => string;
}): Promise<PipelineResult> {
  const doFetch = args.fetchImpl ?? fetch;
  const post: Post = async (path, body) => {
    const res = await doFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${args.token}` },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    const json = raw ? (JSON.parse(raw) as Record<string, any>) : {};
    return { ok: res.ok, status: res.status, json };
  };
  const nowIso = args.now ?? (() => new Date().toISOString());
  const progress = (step: number, total: number, label: string) => args.onProgress?.({ step, total, label });

  progress(1, 3, '会社を特定しています（EDINETコードリスト）');
  const id = await post('/api/stage1/autofill/identify', { companyId: args.companyId, strategyId: args.strategyId, text: args.text });
  if (!id.ok) throw new Error(String(id.json.error ?? `identify_${id.status}`));
  const status = String(id.json.status);
  if (status === 'AMBIGUOUS') return { status: 'AMBIGUOUS', candidates: id.json.candidates as IdentifyCandidate[] };
  if (status !== 'FOUND') {
    const message: Record<string, string> = {
      NOT_FOUND: 'EDINETコードリストに、該当する会社が見つかりませんでした。証券コード（4桁）を付けてください。',
      QUERY_UNCLEAR: '会社名または証券コード（4桁）を含めてください。',
      FISCAL_YEAR_UNKNOWN: 'この会社の決算月が一覧から分からないため、取得できません。',
    };
    return { status: status as 'NOT_FOUND', message: message[status] ?? '取得できませんでした。' };
  }

  const filer = id.json.filer as FilerInfo & { consolidated?: boolean | null };
  const periods = id.json.periods as string[];
  const reports: ReportExtract[] = [];
  const missingPeriods: string[] = [];
  const total = 2 + periods.length;
  for (let i = 0; i < periods.length; i++) {
    const periodEnd = periods[i];
    progress(2 + i, total, `${periodEnd.slice(0, 4)}年${Number(periodEnd.slice(5, 7))}月期の有価証券報告書を確認しています`);
    const r = await post('/api/stage1/autofill/report', {
      companyId: args.companyId,
      strategyId: args.strategyId,
      edinetCode: filer.edinetCode,
      periodEnd,
    });
    if (!r.ok) throw new Error(String(r.json.error ?? `report_${r.status}`));
    if (r.json.status === 'FOUND') {
      const rep = r.json.report as {
        docId: string;
        docTypeCode: string | null;
        periodEnd: string;
        submitDate: string | null;
        amendedFromDocId: string | null;
        facts: ExtractedFacts;
        segments: SegmentExtract;
      };
      reports.push({ docId: rep.docId, docTypeCode: rep.docTypeCode, periodEnd: rep.periodEnd, submitDate: rep.submitDate, amendedFromDocId: rep.amendedFromDocId, facts: rep.facts, segments: rep.segments });
    } else {
      missingPeriods.push(periodEnd);
      if (r.json.status === 'BUDGET_EXCEEDED') {
        return { status: 'BUDGET_EXCEEDED', message: '書類の確認件数が上限に達したため、途中で止めました。時間をおいて再度依頼してください。' };
      }
    }
  }

  if (reports.length === 0) {
    return { status: 'NOT_FOUND', message: '直近の有価証券報告書が見つかりませんでした（提出後の期間を確認してください）。' };
  }
  progress(total, total, '候補を作成しています');
  const candidate = buildMultiYearCandidate({
    filer: { name: filer.name, secCode: filer.secCode, edinetCode: filer.edinetCode, listed: filer.listed, industryName: (filer as { industryName?: string | null }).industryName ?? null, address: filer.address },
    reports,
    fetchedAt: nowIso(),
  });
  return { status: 'FOUND', candidate, fetchedAt: nowIso(), missingPeriods };
}
