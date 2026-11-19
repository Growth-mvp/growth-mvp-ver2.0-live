/* EDINETの提出書類一覧（日付単位）を読み、証券コードで書類を探す。再試行はしない（429などで過剰に呼ばない）。 */
import { tickerOfSecCode, type EdinetDocument } from './companyCandidates';

export const EDINET_DOCUMENTS_URL = 'https://api.edinet-fsa.go.jp/api/v2/documents.json';
export const ANNUAL_REPORT_CODE = '120';
export const MAX_RANGE_DAYS = 31;

export class EdinetHttpError extends Error {
  constructor(public readonly status: number) {
    super(`edinet_http_${status}`);
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export function parseEdinetDocuments(json: unknown): EdinetDocument[] {
  const results = (json as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: EdinetDocument[] = [];
  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    const row = r as Record<string, unknown>;
    const docId = str(row.docID);
    if (!docId) continue;
    out.push({
      docId,
      secCode: str(row.secCode),
      edinetCode: str(row.edinetCode),
      filerName: str(row.filerName) ?? '',
      docTypeCode: str(row.docTypeCode),
      docDescription: str(row.docDescription),
      periodStart: str(row.periodStart),
      periodEnd: str(row.periodEnd),
      submitDate: str(row.submitDateTime),
      withdrawn: row.withdrawalStatus === '1',
    });
  }
  return out;
}

export async function listEdinetDocumentsForDate(
  date: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EdinetDocument[]> {
  const url = `${EDINET_DOCUMENTS_URL}?date=${encodeURIComponent(date)}&type=2&Subscription-Key=${encodeURIComponent(apiKey)}`;
  const res = await fetchImpl(url, { method: 'GET' });
  if (!res.ok) throw new EdinetHttpError(res.status);
  return parseEdinetDocuments(await res.json());
}

function dayList(from: string, to: string): string[] {
  const days: string[] = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur.getTime() <= end.getTime()) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

export function validateRange(from: string, to: string): string | null {
  const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
  if (!isDate(from) || !isDate(to)) return '日付は YYYY-MM-DD で指定してください';
  if (from > to) return '開始日は終了日より前にしてください';
  if (dayList(from, to).length > MAX_RANGE_DAYS) return `期間は${MAX_RANGE_DAYS}日以内にしてください`;
  return null;
}

/** 日付の範囲を1日ずつ順に読む。途中でエラーになったら、そこで止める */
export async function listEdinetDocumentsForRange(
  from: string,
  to: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EdinetDocument[]> {
  const error = validateRange(from, to);
  if (error) throw new Error(error);
  const all: EdinetDocument[] = [];
  for (const day of dayList(from, to)) {
    all.push(...(await listEdinetDocumentsForDate(day, apiKey, fetchImpl)));
  }
  return all;
}

/** 証券コード（4桁）の書類を、有価証券報告書を優先し、新しい決算期から並べる。取下げの書類は除く */
export function findDocumentsForTicker(docs: EdinetDocument[], ticker: string): EdinetDocument[] {
  return docs
    .filter((d) => !d.withdrawn && tickerOfSecCode(d.secCode) === ticker)
    .sort((a, b) => {
      const ar = a.docTypeCode === ANNUAL_REPORT_CODE ? 0 : 1;
      const br = b.docTypeCode === ANNUAL_REPORT_CODE ? 0 : 1;
      if (ar !== br) return ar - br;
      return (b.periodEnd ?? '').localeCompare(a.periodEnd ?? '');
    });
}

export const EDINET_DOCUMENT_URL = 'https://api.edinet-fsa.go.jp/api/v2/documents';

/** 書類の構造化データ（CSVを含むzip）を1回だけ取得する。再試行はしない */
export async function downloadEdinetCsvZip(docId: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  if (!/^S\d[A-Z0-9]{7}$/.test(docId)) throw new Error('invalid_doc_id');
  const url = `${EDINET_DOCUMENT_URL}/${docId}?type=5&Subscription-Key=${encodeURIComponent(apiKey)}`;
  const res = await fetchImpl(url, { method: 'GET' });
  if (!res.ok) throw new EdinetHttpError(res.status);
  return Buffer.from(await res.arrayBuffer());
}
