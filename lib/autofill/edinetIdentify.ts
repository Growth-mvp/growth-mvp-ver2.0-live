/* 会社名または証券コードから、EDINETの提出者（EDINETコード・証券コード）と有価証券報告書を特定する。
 * 提出日の範囲はシステムが決める。日本の上場企業の有価証券報告書は、決算期に応じて提出時期が集中するため、
 * その時期の窓を優先順に読む。窓は平日のみ、1日1回。合計の読み取り回数に上限を設ける。 */
import { ANNUAL_REPORT_CODE, listEdinetDocumentsForDate } from './edinetDocuments';
import { tickerOfSecCode, type EdinetDocument } from './companyCandidates';

export const AMENDED_REPORT_CODE = '130';
export const MAX_IDENTIFY_DAYS = 150;
export const AMENDMENT_WINDOW_DAYS = 45;
/** 有価証券報告書の提出が集中しやすい月（決算月の順）。直近の該当月から順に読む */
export const WINDOW_MONTH_PRIORITY = [6, 3, 4, 9, 12, 7, 10, 1, 2, 5, 8, 11] as const;

export type FilerRef = { name: string; secCode: string | null; edinetCode: string | null };

export type IdentifyResult =
  | { status: 'FOUND'; filer: FilerRef; annualReport: EdinetDocument; amendments: EdinetDocument[]; scannedDays: number }
  | { status: 'AMBIGUOUS'; candidates: FilerRef[]; scannedDays: number }
  | { status: 'NOT_FOUND'; scannedDays: number }
  | { status: 'BUDGET_EXCEEDED'; scannedDays: number };

export type IdentifyQuery = { name?: string; secCode?: string };
type DocLister = (date: string) => Promise<EdinetDocument[]>;

export function normalizeCompanyName(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/株式会社|有限会社|\(株\)|（株）|\s|　/g, '')
    .replace(/[・･.,、。]/g, '')
    .toLowerCase();
}

export function matchesQuery(doc: EdinetDocument, q: IdentifyQuery): boolean {
  if (q.secCode) return tickerOfSecCode(doc.secCode) === q.secCode;
  const name = normalizeCompanyName(q.name ?? '');
  return name.length >= 2 && normalizeCompanyName(doc.filerName).includes(name);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 日本時間の今日（時刻なし。UTCの各項目で日付を表す） */
function jstToday(now: number): Date {
  const jst = new Date(now + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
}

/** 指定の期間の平日（YYYY-MM-DD）を、新しい順に返す */
export function weekdaysDesc(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cur = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  while (cur.getTime() >= start) {
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(isoDay(cur));
    cur.setUTCDate(cur.getUTCDate() - 1);
  }
  return out;
}

/** 優先順の窓（各月の直近の該当期間。今日より後は含めない） */
export function windowsByPriority(now: number): Array<{ month: number; from: Date; to: Date }> {
  const today = jstToday(now);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  return WINDOW_MONTH_PRIORITY.map((month) => {
    const year = month <= m ? y : y - 1;
    const from = new Date(Date.UTC(year, month - 1, 1));
    const last = new Date(Date.UTC(year, month, 0));
    const to = last.getTime() > today.getTime() ? today : last;
    return { month, from, to };
  });
}

function filerRefOf(doc: EdinetDocument): FilerRef {
  return { name: doc.filerName, secCode: tickerOfSecCode(doc.secCode), edinetCode: doc.edinetCode };
}

function uniqueFilers(docs: EdinetDocument[]): FilerRef[] {
  const seen = new Map<string, FilerRef>();
  for (const d of docs) {
    const key = d.edinetCode ?? d.filerName;
    if (!seen.has(key)) seen.set(key, filerRefOf(d));
  }
  return [...seen.values()];
}

export async function identifyCompany(
  query: IdentifyQuery,
  opts: { now?: number; listDocs: DocLister },
): Promise<IdentifyResult> {
  const now = opts.now ?? Date.now();
  const today = jstToday(now);
  let scanned = 0;
  const read = async (day: string): Promise<EdinetDocument[] | null> => {
    if (scanned >= MAX_IDENTIFY_DAYS) return null;
    scanned++;
    return opts.listDocs(day);
  };

  for (const w of windowsByPriority(now)) {
    const matched: EdinetDocument[] = [];
    for (const day of weekdaysDesc(w.from, w.to)) {
      const docs = await read(day);
      if (docs === null) return { status: 'BUDGET_EXCEEDED', scannedDays: scanned };
      matched.push(...docs.filter((d) => matchesQuery(d, query)));
    }
    const annual = matched.filter((d) => d.docTypeCode === ANNUAL_REPORT_CODE);
    if (annual.length === 0) continue;

    const filers = uniqueFilers(matched.filter((d) => d.edinetCode));
    if (filers.length > 1) return { status: 'AMBIGUOUS', candidates: filers, scannedDays: scanned };

    const report = [...annual].sort((a, b) => (b.periodEnd ?? '').localeCompare(a.periodEnd ?? ''))[0];
    const amendments: EdinetDocument[] = [];
    const submitted = report.submitDate ? new Date(`${report.submitDate.slice(0, 10)}T00:00:00Z`) : null;
    if (submitted) {
      const to = new Date(Math.min(today.getTime(), submitted.getTime() + AMENDMENT_WINDOW_DAYS * 86400000));
      for (const day of weekdaysDesc(submitted, to).reverse()) {
        const docs = await read(day);
        if (docs === null) break;
        amendments.push(
          ...docs.filter(
            (d) => d.docTypeCode === AMENDED_REPORT_CODE && d.edinetCode === report.edinetCode && d.periodEnd === report.periodEnd,
          ),
        );
      }
    }
    return { status: 'FOUND', filer: filerRefOf(report), annualReport: report, amendments, scannedDays: scanned };
  }
  return { status: 'NOT_FOUND', scannedDays: scanned };
}

/** 依頼文から、証券コード（4桁）か会社名を取り出す。取り出せなければ null（推測で決めない） */
export function parseIdentifyQuery(text: string): IdentifyQuery | null {
  const code = /(?<!\d)(\d{4})(?!\d)/.exec(text.normalize('NFKC'));
  if (code) return { secCode: code[1] };
  const intent = /(基本情報|財務|有価証券報告書|有報|会社情報|企業情報|PL|BS|上場企業)/;
  const stripped = text
    .normalize('NFKC')
    .replace(/[「」『』"'“”]/g, ' ')
    .replace(/(自動入力|入力|取り込み|取り込ん|取り込|取得|反映|登録|検索|調べ|教えて|してください|して下さい|してほしい|して欲しい|してね|して|お願い|ください|ほしい|欲しい|基本情報|会社情報|企業情報|有価証券報告書|有報|財務データ|財務情報|財務|PL|BS|上場企業|上場情報|EDINET|エディネット|証券コード|会社|企業|株式会社|の|を|で|に|から|と|は|が|も|、|。|！|!|？|\?|情報)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hasCompanySuffix = /株式会社|\(株\)|（株）/.test(text);
  if (!intent.test(text) && !hasCompanySuffix) return null;
  const name = stripped.split(' ').find((t) => t.length >= 2) ?? '';
  return name ? { name } : null;
}
