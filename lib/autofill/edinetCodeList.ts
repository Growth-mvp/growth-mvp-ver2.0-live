/* 金融庁のEDINETコードリスト（上場・非上場を含む提出者の一覧）を読み、会社名・証券コードから提出者を引く。
 * 会社の特定はこの一覧で行い、EDINETの書類一覧を走査して探さない（API呼び出しを減らす）。
 * 一覧は24時間だけ保持する（依頼のたびに取得しない）。 */
import { readZipEntries } from './edinetZip';
import { normalizeCompanyName } from './edinetIdentify';

export const EDINET_CODELIST_URL = 'https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip';
export const CODELIST_TTL_MS = 24 * 60 * 60 * 1000;

export type CodeListEntry = {
  edinetCode: string;
  listed: boolean;
  consolidated: boolean | null;
  fiscalYearEndMonth: number | null;
  fiscalYearEndDay: number | null;
  name: string;
  nameKana: string;
  address: string;
  industryName: string | null;
  secCode: string | null;
  corporateNumber: string | null;
};

/** CSVの1行を、引用符つきの項目に分ける（項目の中のカンマに対応） */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseFiscalYearEnd(text: string): { month: number; day: number } | null {
  const m = /^(\d{1,2})月(\d{1,2})日$/.exec(text.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { month, day } : null;
}

/** 証券コードは5桁（末尾0）で入るため、4桁に直す */
export function secCodeOf(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}$/.test(s)) return s;
  if (/^\d{5}$/.test(s) && s.endsWith('0')) return s.slice(0, 4);
  return null;
}

/** 一覧の本文（復号済み）を読む。先頭にメタ情報の行があるため、ヘッダー行（ＥＤＩＮＥＴコード）から読む */
export function parseCodeListText(text: string): CodeListEntry[] {
  const lines = text.split(/\r?\n/);
  const header = lines.findIndex((l) => l.startsWith('"ＥＤＩＮＥＴコード"') || l.startsWith('ＥＤＩＮＥＴコード'));
  if (header < 0) return [];
  const out: CodeListEntry[] = [];
  for (const line of lines.slice(header + 1)) {
    if (!line.trim()) continue;
    const c = splitCsvLine(line);
    if (c.length < 13 || !c[0].startsWith('E')) continue;
    const fye = parseFiscalYearEnd(c[5] ?? '');
    out.push({
      edinetCode: c[0].trim(),
      listed: c[2].trim() === '上場',
      consolidated: c[3].trim() === '有' ? true : c[3].trim() === '無' ? false : null,
      fiscalYearEndMonth: fye?.month ?? null,
      fiscalYearEndDay: fye?.day ?? null,
      name: c[6].trim(),
      nameKana: c[8].trim(),
      address: c[9].trim(),
      industryName: c[10].trim() || null,
      secCode: secCodeOf(c[11] ?? ''),
      corporateNumber: c[12].trim() || null,
    });
  }
  return out;
}

/** zip（Shift_JIS のCSV）を文字列にする */
export function decodeCodeListZip(zip: Buffer): string {
  const entry = readZipEntries(zip).find((e) => e.name.toLowerCase().endsWith('.csv'));
  if (!entry) throw new Error('codelist_csv_not_found');
  return new TextDecoder('shift_jis').decode(entry.data);
}

export class CodeListIndex {
  private readonly byCode = new Map<string, CodeListEntry>();
  private readonly byName = new Map<string, CodeListEntry[]>();
  private readonly bySec = new Map<string, CodeListEntry>();

  constructor(public readonly entries: CodeListEntry[]) {
    for (const e of entries) {
      this.byCode.set(e.edinetCode, e);
      if (e.secCode) this.bySec.set(e.secCode, e);
      const key = normalizeCompanyName(e.name);
      this.byName.set(key, [...(this.byName.get(key) ?? []), e]);
    }
  }

  get size(): number {
    return this.entries.length;
  }

  byEdinetCode(code: string): CodeListEntry | null {
    return this.byCode.get(code) ?? null;
  }

  /** 証券コード（4桁）か、会社名（表記ゆれを吸収）で引く。候補が複数なら全部返す（推測で1社に決めない） */
  search(query: { secCode?: string; name?: string }): CodeListEntry[] {
    if (query.secCode) {
      const hit = this.bySec.get(query.secCode);
      return hit ? [hit] : [];
    }
    const name = normalizeCompanyName(query.name ?? '');
    if (name.length < 2) return [];
    const exact = this.byName.get(name) ?? [];
    if (exact.length > 0) return exact;
    const partial = this.entries.filter((e) => normalizeCompanyName(e.name).includes(name));
    return partial.slice(0, 20);
  }
}

let cache: { index: CodeListIndex; loadedAt: number } | null = null;
let inflight: Promise<CodeListIndex> | null = null;

/** コードリストを取得する（24時間は保持。同時の取得は1回にまとめる） */
export async function getCodeListIndex(opts: { now?: number; fetchImpl?: typeof fetch } = {}): Promise<CodeListIndex> {
  const now = opts.now ?? Date.now();
  if (cache && now - cache.loadedAt < CODELIST_TTL_MS) return cache.index;
  if (!inflight) {
    inflight = (async () => {
      const doFetch = opts.fetchImpl ?? fetch;
      const res = await doFetch(EDINET_CODELIST_URL, { method: 'GET' });
      if (!res.ok) throw new Error(`codelist_http_${res.status}`);
      const zip = Buffer.from(await res.arrayBuffer());
      const index = new CodeListIndex(parseCodeListText(decodeCodeListZip(zip)));
      cache = { index, loadedAt: now };
      return index;
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** 試験用：保持している一覧を消す */
export function resetCodeListCacheForTest(): void {
  cache = null;
  inflight = null;
}
